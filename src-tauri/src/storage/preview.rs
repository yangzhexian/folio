use super::{get_attachment, File, Path, Read, Result, Store};

pub const MAX_IMAGE_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_PDF_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMAGE_SIDE: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

const UNAVAILABLE: &str = "PREVIEW_UNAVAILABLE";
const UNSUPPORTED: &str = "PREVIEW_UNSUPPORTED";
const TOO_LARGE: &str = "PREVIEW_TOO_LARGE";
const INVALID: &str = "PREVIEW_INVALID";

#[derive(Clone, Copy, Debug)]
enum PreviewKind {
    Png,
    Jpeg,
    Pdf,
}

/// An already-open managed file. Resolve authorization while the store is locked,
/// then move this handle to a blocking worker without holding the vault mutex.
#[derive(Debug)]
pub struct AttachmentPreview {
    file: File,
    kind: PreviewKind,
}

impl Store {
    pub fn attachment_preview(&self, id: &str) -> Result<AttachmentPreview> {
        let db = self.connection().map_err(|_| UNAVAILABLE.to_owned())?;
        // The shared lookup joins the parent record and requires both to be active.
        let attachment = get_attachment(&db, id, false).map_err(|_| UNAVAILABLE.to_owned())?;
        let path = self
            .resolve_existing(&attachment.relative_path)
            .map_err(|_| UNAVAILABLE.to_owned())?;
        let file = File::open(&path).map_err(|_| UNAVAILABLE.to_owned())?;
        let kind = match Path::new(&attachment.file_name)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("png") => PreviewKind::Png,
            Some("jpg" | "jpeg") => PreviewKind::Jpeg,
            Some("pdf") => PreviewKind::Pdf,
            _ => return Err(UNSUPPORTED.into()),
        };
        let preview = AttachmentPreview { file, kind };
        preview.check_file()?;
        Ok(preview)
    }
}

impl AttachmentPreview {
    fn limit(&self) -> u64 {
        match self.kind {
            PreviewKind::Png | PreviewKind::Jpeg => MAX_IMAGE_PREVIEW_BYTES,
            PreviewKind::Pdf => MAX_PDF_PREVIEW_BYTES,
        }
    }

    fn check_file(&self) -> Result<()> {
        let metadata = self.file.metadata().map_err(|_| UNAVAILABLE.to_owned())?;
        if !metadata.is_file() {
            return Err(UNAVAILABLE.into());
        }
        if metadata.len() > self.limit() {
            return Err(TOO_LARGE.into());
        }
        Ok(())
    }

    pub fn read(self) -> Result<Vec<u8>> {
        self.check_file()?;
        let limit = self.limit();
        // The cap is enforced on the actual stream too, including growth after metadata.
        let bytes = read_bounded(self.file, limit)?;
        match self.kind {
            PreviewKind::Png => validate_png(&bytes)?,
            PreviewKind::Jpeg => validate_jpeg(&bytes)?,
            PreviewKind::Pdf => validate_pdf(&bytes)?,
        }
        Ok(bytes)
    }
}

fn read_bounded(reader: impl Read, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE.to_owned())?;
    if bytes.len() as u64 > limit {
        return Err(TOO_LARGE.into());
    }
    Ok(bytes)
}

fn validate_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(INVALID.into());
    }
    if width > MAX_IMAGE_SIDE
        || height > MAX_IMAGE_SIDE
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(TOO_LARGE.into());
    }
    Ok(())
}

fn validate_png(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 45
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR")
        || !bytes.ends_with(b"\0\0\0\0IEND\xaeB`\x82")
    {
        return Err(INVALID.into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    validate_dimensions(width, height)
}

fn validate_jpeg(bytes: &[u8]) -> Result<()> {
    // Some camera JPEGs append motion-photo data after EOI. Its marker must exist,
    // but need not be the final bytes of the attachment.
    if !bytes.starts_with(b"\xff\xd8\xff") || !bytes.windows(2).any(|marker| marker == b"\xff\xd9")
    {
        return Err(INVALID.into());
    }
    let mut offset = 2;
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            return Err(INVALID.into());
        }
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset).ok_or(INVALID)?;
        offset += 1;
        if matches!(marker, 0x00 | 0xd8 | 0xd9 | 0xda) {
            return Err(INVALID.into());
        }
        if matches!(marker, 0x01 | 0xd0..=0xd7) {
            continue;
        }
        let length_bytes = bytes.get(offset..offset + 2).ok_or(INVALID)?;
        let length = usize::from(u16::from_be_bytes(length_bytes.try_into().unwrap()));
        if length < 2 || offset + length > bytes.len() {
            return Err(INVALID.into());
        }
        // SOF markers carry dimensions; C4, C8 and CC are other segment types.
        if (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
            if length < 8 {
                return Err(INVALID.into());
            }
            let height = u16::from_be_bytes([bytes[offset + 3], bytes[offset + 4]]);
            let width = u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]);
            return validate_dimensions(u32::from(width), u32::from(height));
        }
        offset += length;
    }
    Err(INVALID.into())
}

fn validate_pdf(bytes: &[u8]) -> Result<()> {
    // PDF.js accepts the header within the first 1,024 bytes, including files
    // carrying a byte-order mark or a short scanner preamble.
    let header = bytes[..bytes.len().min(1024)].windows(8).any(|candidate| {
        candidate.starts_with(b"%PDF-")
            && candidate[5].is_ascii_digit()
            && candidate[6] == b'.'
            && candidate[7].is_ascii_digit()
    });
    if !header {
        return Err(INVALID.into());
    }
    // PDF.js performs full parsing locally; checking its signature here avoids
    // passing unrelated content to the renderer without parsing a document twice.
    Ok(())
}

#[cfg(test)]
mod tests;
