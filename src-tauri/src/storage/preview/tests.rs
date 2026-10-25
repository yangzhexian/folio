use super::*;
use crate::model::{now, Attachment, ProfileRecord};
use rusqlite::params;
use std::fs::{self, OpenOptions};
use std::io::Cursor;
use tempfile::TempDir;
use uuid::Uuid;

// A complete 1 x 1 PNG. JPEG cases exercise its bounded marker/header reader;
// decoding image bodies remains the browser's responsibility.
const PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 96, 0, 2, 0, 0, 5, 0, 1,
    169, 245, 152, 169, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];
const JPEG: &[u8] = &[
    0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff,
    0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0xff, 0xd9,
];
const PDF: &[u8] = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";

fn fixture(name: &str, contents: &[u8]) -> (TempDir, Store, Attachment, ProfileRecord) {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    let record = store
        .save_record(ProfileRecord {
            id: Uuid::new_v4().to_string(),
            category: "documents".into(),
            title: "Preview test".into(),
            subtitle: String::new(),
            tags: Vec::new(),
            favorite: false,
            fields: Vec::new(),
            notes: String::new(),
            created_at: now(),
            updated_at: now(),
        })
        .unwrap();
    let path = temp.path().join(name);
    fs::write(&path, contents).unwrap();
    let attachment = store.import_files(&record.id, &[path]).unwrap().remove(0);
    (temp, store, attachment, record)
}

fn read(store: &Store, attachment: &Attachment) -> Result<Vec<u8>> {
    store.attachment_preview(&attachment.metadata.id)?.read()
}

#[test]
fn preview_returns_original_binary_for_supported_types_and_uppercase_extensions() {
    for (name, bytes) in [
        ("image.PNG", PNG),
        ("photo.JPG", JPEG),
        ("photo.JPEG", JPEG),
        ("file.PDF", PDF),
    ] {
        let (_temp, store, mut attachment, _record) = fixture(name, bytes);
        // Import normalization normally lowercases extensions. Check older metadata too.
        attachment.metadata.file_name = attachment.metadata.file_name.to_uppercase();
        store
            .connection()
            .unwrap()
            .execute(
                "UPDATE attachments SET body=?1 WHERE id=?2",
                params![
                    serde_json::to_string(&attachment.metadata).unwrap(),
                    attachment.metadata.id
                ],
            )
            .unwrap();
        assert_eq!(read(&store, &attachment).unwrap(), bytes);
    }
}

#[test]
fn preview_accepts_camera_jpeg_trailers_and_pdf_preambles() {
    let mut jpeg = JPEG.to_vec();
    jpeg.extend_from_slice(b"camera motion-photo trailer");
    assert!(validate_jpeg(&jpeg).is_ok());
    let mut pdf = b"\xef\xbb\xbf".to_vec();
    pdf.extend_from_slice(PDF);
    assert!(validate_pdf(&pdf).is_ok());
    let mut late_header = vec![b' '; 1024];
    late_header.extend_from_slice(PDF);
    assert_eq!(validate_pdf(&late_header).unwrap_err(), INVALID);
}

#[test]
fn preview_requires_an_active_attachment_and_active_parent() {
    let (_temp, store, attachment, record) = fixture("image.png", PNG);
    store.remove_attachment(&attachment.metadata.id).unwrap();
    assert_eq!(read(&store, &attachment).unwrap_err(), UNAVAILABLE);
    store.restore_attachment(&attachment.metadata.id).unwrap();
    store.delete_record(&record.id).unwrap();
    // Even an inconsistent active attachment flag cannot bypass the parent check.
    store
        .connection()
        .unwrap()
        .execute("UPDATE attachments SET deleted=0", [])
        .unwrap();
    assert_eq!(read(&store, &attachment).unwrap_err(), UNAVAILABLE);
    for id in ["../../outside".to_owned(), Uuid::new_v4().to_string()] {
        assert_eq!(store.attachment_preview(&id).unwrap_err(), UNAVAILABLE);
    }
}

#[test]
fn preview_missing_or_non_regular_files_use_an_opaque_error() {
    let (_temp, store, attachment, _record) = fixture("image.png", PNG);
    let path = store.attachment_path(&attachment.metadata.id).unwrap();
    fs::remove_file(&path).unwrap();
    assert_eq!(read(&store, &attachment).unwrap_err(), UNAVAILABLE);
    fs::create_dir(&path).unwrap();
    assert_eq!(read(&store, &attachment).unwrap_err(), UNAVAILABLE);
}

#[test]
fn preview_rejects_unsupported_extensions_and_mismatched_signatures() {
    let (_temp, store, attachment, _record) = fixture("picture.svg", PNG);
    assert_eq!(read(&store, &attachment).unwrap_err(), UNSUPPORTED);
    for (name, bytes) in [
        ("photo.jpg", PNG),
        ("photo.png", JPEG),
        ("file.pdf", b"not a PDF".as_slice()),
        ("empty.png", b"".as_slice()),
    ] {
        let (_temp, store, attachment, _record) = fixture(name, bytes);
        assert_eq!(read(&store, &attachment).unwrap_err(), INVALID);
    }
}

#[test]
fn preview_rejects_oversized_files_and_files_grown_after_opening() {
    for (name, bytes, limit) in [
        ("image.png", PNG, MAX_IMAGE_PREVIEW_BYTES),
        ("file.pdf", PDF, MAX_PDF_PREVIEW_BYTES),
    ] {
        let (_temp, store, attachment, _record) = fixture(name, bytes);
        let opened = store.attachment_preview(&attachment.metadata.id).unwrap();
        let file = OpenOptions::new()
            .write(true)
            .open(store.attachment_path(&attachment.metadata.id).unwrap())
            .unwrap();
        file.set_len(limit + 1).unwrap();
        assert_eq!(read(&store, &attachment).unwrap_err(), TOO_LARGE);
        assert_eq!(opened.read().unwrap_err(), TOO_LARGE);
    }
    // Also verify the stream cap independently of metadata, using a tiny budget.
    assert_eq!(read_bounded(Cursor::new([0; 9]), 8).unwrap_err(), TOO_LARGE);
    assert_eq!(read_bounded(Cursor::new([0; 8]), 8).unwrap(), [0; 8]);
}

#[test]
fn preview_rejects_image_pixel_bombs_and_malformed_headers_before_decoding() {
    let mut png = PNG.to_vec();
    png[16..20].copy_from_slice(&16_385u32.to_be_bytes());
    assert_eq!(validate_png(&png).unwrap_err(), TOO_LARGE);
    png[16..20].copy_from_slice(&8_000u32.to_be_bytes());
    png[20..24].copy_from_slice(&8_000u32.to_be_bytes());
    assert_eq!(validate_png(&png).unwrap_err(), TOO_LARGE);
    png[16..20].copy_from_slice(&0u32.to_be_bytes());
    assert_eq!(validate_png(&png).unwrap_err(), INVALID);
    assert_eq!(validate_png(&PNG[..30]).unwrap_err(), INVALID);
    let mut jpeg = JPEG.to_vec();
    jpeg[13..15].copy_from_slice(&8_000u16.to_be_bytes());
    jpeg[15..17].copy_from_slice(&8_000u16.to_be_bytes());
    assert_eq!(validate_jpeg(&jpeg).unwrap_err(), TOO_LARGE);
    jpeg[4..6].copy_from_slice(&0u16.to_be_bytes());
    assert_eq!(validate_jpeg(&jpeg).unwrap_err(), INVALID);
    assert_eq!(
        validate_jpeg(b"\xff\xd8\xff\xe0\xff\xff\xff\xd9").unwrap_err(),
        INVALID
    );
    assert_eq!(
        validate_jpeg(b"\xff\xd8\xff\xda\0\x02\xff\xd9").unwrap_err(),
        INVALID
    );
}

#[test]
fn preview_rejects_database_path_traversal() {
    let (_temp, store, mut attachment, _record) = fixture("image.png", PNG);
    attachment.metadata.relative_path = "../outside.png".into();
    store
        .connection()
        .unwrap()
        .execute(
            "UPDATE attachments SET body=?1 WHERE id=?2",
            params![
                serde_json::to_string(&attachment.metadata).unwrap(),
                attachment.metadata.id
            ],
        )
        .unwrap();
    assert_eq!(read(&store, &attachment).unwrap_err(), UNAVAILABLE);
}

#[cfg(any(unix, windows))]
#[test]
fn preview_rejects_redirected_attachment_directories() {
    let (temp, store, attachment, _record) = fixture("image.png", PNG);
    let managed = store.attachment_path(&attachment.metadata.id).unwrap();
    let parent = managed.parent().unwrap();
    let outside = temp.path().join("outside");
    fs::rename(parent, &outside).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, parent).unwrap();
    #[cfg(windows)]
    {
        // Junctions need no symlink privilege and exercise Windows canonicalization.
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(parent)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Unable to create test junction: {:?}",
            output
        );
    }
    assert_eq!(read(&store, &attachment).unwrap_err(), UNAVAILABLE);
    // Remove only the link before TempDir cleanup, leaving its target untouched.
    #[cfg(unix)]
    fs::remove_file(parent).unwrap();
    #[cfg(windows)]
    fs::remove_dir(parent).unwrap();
    assert!(outside.join(&attachment.metadata.file_name).exists());
}
