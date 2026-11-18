use super::*;
use std::path::Component;

impl Store {
    pub fn import_dropped_files(
        &self,
        record_id: &str,
        paths: &[String],
    ) -> Result<Vec<Attachment>> {
        validate_id(record_id)?;
        if paths.len() > 100 {
            return Err("Import at most 100 files at a time.".into());
        }
        // Validate the whole native drop before copying anything. The shared importer then
        // applies its usual size limit, managed names, transaction, and failure cleanup.
        let paths = paths
            .iter()
            .map(|value| {
                if value.len() > 131_072 || value.contains('\0') {
                    return Err("Invalid dropped file path.".into());
                }
                let path = PathBuf::from(value);
                validate_local_drop_path(&path)?;
                let resolved = path.canonicalize().map_err(err)?;
                validate_local_drop_path(&resolved)?;
                let metadata = fs::metadata(&resolved).map_err(err)?;
                if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE {
                    return Err("Drop regular files up to 2 GB. Folders cannot be imported.".into());
                }
                Ok(resolved)
            })
            .collect::<Result<Vec<_>>>()?;
        self.import_files(record_id, &paths)
    }

    pub fn import_files(&self, record_id: &str, paths: &[PathBuf]) -> Result<Vec<Attachment>> {
        validate_id(record_id)?;
        if paths.len() > 100 {
            return Err("Import at most 100 files at a time.".into());
        }
        let mut db = self.connection()?;
        let record = require_record(&db, record_id)?;
        let tx = db.transaction().map_err(err)?;
        let mut created = Vec::new();
        let result = (|| {
            let mut attachments = Vec::new();
            for source in paths {
                let metadata = fs::metadata(source).map_err(err)?;
                if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE {
                    return Err("Only regular files up to 2 GB can be imported.".into());
                }
                let original_name = source
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("Invalid source filename.")?
                    .to_owned();
                let id = Uuid::new_v4().to_string();
                let suffix = id.replace('-', "");
                let file_name = managed_name(
                    &record.category,
                    &suffix[..12],
                    safe_extension(source).as_deref(),
                );
                let relative_path = format!("attachments/{record_id}/{file_name}");
                let destination = self.safe_destination(&relative_path)?;
                fs::create_dir_all(
                    destination
                        .parent()
                        .ok_or("Invalid attachment directory.")?,
                )
                .map_err(err)?;
                let mut input = File::open(source).map_err(err)?;
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&destination)
                    .map_err(err)?;
                created.push(destination.clone());
                let size = std::io::copy(
                    &mut Read::by_ref(&mut input).take(MAX_FILE_SIZE + 1),
                    &mut output,
                )
                .map_err(err)?;
                if size > MAX_FILE_SIZE {
                    return Err("File grew beyond the 2 GB size limit.".into());
                }
                output.sync_all().map_err(err)?;
                drop(output);
                let attachment = StoredAttachment {
                    id,
                    record_id: record_id.to_owned(),
                    original_name,
                    file_name,
                    relative_path,
                    size,
                    created_at: now(),
                    revision: Some(Uuid::new_v4().to_string()),
                };
                tx.execute(
                    "INSERT INTO attachments(id,record_id,body) VALUES(?1,?2,?3)",
                    params![
                        attachment.id,
                        record_id,
                        serde_json::to_string(&attachment).map_err(err)?
                    ],
                )
                .map_err(err)?;
                attachments.push(self.public_attachment(attachment)?);
            }
            tx.commit().map_err(err)?;
            Ok(attachments)
        })();
        if result.is_err() {
            for path in created {
                let _ = fs::remove_file(path);
            }
        }
        result
    }

    pub fn rename_attachment(&self, id: &str, name: &str) -> Result<Attachment> {
        if name.trim().is_empty()
            || name.contains(['/', '\\'])
            || name == "."
            || name == ".."
            || name.chars().count() > 200
        {
            return Err("Use a filename stem of 1–200 characters without path separators.".into());
        }
        let mut db = self.connection()?;
        let mut attachment = get_attachment(&db, id, false)?;
        let record = require_record(&db, &attachment.record_id)?;
        let original = self.resolve_existing(&attachment.relative_path)?;
        let new_name = managed_name(
            &record.category,
            name,
            safe_extension(Path::new(&attachment.file_name)).as_deref(),
        );
        attachment.revision = Some(Uuid::new_v4().to_string());
        if new_name == attachment.file_name {
            db.execute(
                "UPDATE attachments SET body=?1 WHERE id=?2 AND deleted=0",
                params![serde_json::to_string(&attachment).map_err(err)?, id],
            )
            .map_err(err)?;
            return self.public_attachment(attachment);
        }
        let relative_path = format!("attachments/{}/{new_name}", attachment.record_id);
        let destination = self.safe_destination(&relative_path)?;
        // create_new plus copy prevents overwriting even under case-insensitive Windows filenames.
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(err)?;
        let copied = (|| {
            let mut input = File::open(&original).map_err(err)?;
            std::io::copy(&mut input, &mut output).map_err(err)?;
            output.sync_all().map_err(err)?;
            Ok::<(), String>(())
        })();
        drop(output);
        if let Err(error) = copied {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
        attachment.file_name = new_name;
        attachment.relative_path = relative_path;
        let update = (|| {
            let tx = db.transaction().map_err(err)?;
            tx.execute(
                "UPDATE attachments SET body=?1 WHERE id=?2",
                params![serde_json::to_string(&attachment).map_err(err)?, id],
            )
            .map_err(err)?;
            tx.commit().map_err(err)
        })();
        if let Err(error) = update {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
        // An interrupted cleanup can leave an unreferenced copy, but never a missing managed file.
        let _ = fs::remove_file(original);
        self.public_attachment(attachment)
    }

    pub fn remove_attachment(&self, id: &str) -> Result<()> {
        let db = self.connection()?;
        let mut attachment = get_attachment(&db, id, false)?;
        attachment.revision = Some(Uuid::new_v4().to_string());
        db.execute(
            "UPDATE attachments SET deleted=1, body=?1 WHERE id=?2",
            params![serde_json::to_string(&attachment).map_err(err)?, id],
        )
        .map_err(err)?;
        Ok(())
    }

    pub fn restore_attachment(&self, id: &str) -> Result<Attachment> {
        let db = self.connection()?;
        let mut attachment = get_attachment(&db, id, true)?;
        require_record(&db, &attachment.record_id)?;
        self.resolve_existing(&attachment.relative_path)?;
        attachment.revision = Some(Uuid::new_v4().to_string());
        db.execute(
            "UPDATE attachments SET deleted=0, body=?1 WHERE id=?2",
            params![serde_json::to_string(&attachment).map_err(err)?, id],
        )
        .map_err(err)?;
        self.public_attachment(attachment)
    }

    pub fn attachment_path(&self, id: &str) -> Result<PathBuf> {
        let db = self.connection()?;
        let attachment = get_attachment(&db, id, false)?;
        self.resolve_existing(&attachment.relative_path)
    }

    pub(super) fn public_attachment(&self, metadata: StoredAttachment) -> Result<Attachment> {
        Self::public_attachment_in(&self.vault().canonicalize().map_err(err)?, metadata)
    }

    pub(super) fn public_attachment_in(
        vault: &Path,
        mut metadata: StoredAttachment,
    ) -> Result<Attachment> {
        metadata.revision = Some(agent::attachment_revision(&metadata)?);
        let path = Self::safe_destination_in(vault, &metadata.relative_path)?;
        Ok(Attachment {
            metadata,
            absolute_path: display_path(&path),
        })
    }

    pub(super) fn safe_destination(&self, relative: &str) -> Result<PathBuf> {
        Self::safe_destination_in(&self.vault().canonicalize().map_err(err)?, relative)
    }

    fn safe_destination_in(vault: &Path, relative: &str) -> Result<PathBuf> {
        validate_relative_path(relative)?;
        let path = vault.join(relative);
        // Reject redirected parents (symlinks and Windows junctions) before writing.
        let mut ancestor = path.parent().ok_or("Invalid file path.")?;
        while !ancestor.exists() {
            ancestor = ancestor.parent().ok_or("Invalid file path.")?;
        }
        if !ancestor.canonicalize().map_err(err)?.starts_with(vault) {
            return Err("Attachment path escapes the local vault.".into());
        }
        if path.exists() && !path.canonicalize().map_err(err)?.starts_with(vault) {
            return Err("Attachment path escapes the local vault.".into());
        }
        Ok(path)
    }

    pub(super) fn resolve_existing(&self, relative: &str) -> Result<PathBuf> {
        Self::resolve_existing_in(&self.vault().canonicalize().map_err(err)?, relative)
    }

    pub(super) fn resolve_existing_in(vault: &Path, relative: &str) -> Result<PathBuf> {
        let path = Self::safe_destination_in(vault, relative)?;
        let actual = path.canonicalize().map_err(err)?;
        if !actual.is_file() {
            return Err("Attachment is not a regular file.".into());
        }
        Ok(actual)
    }
}

pub(crate) fn validate_local_drop_path(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err("Drop files using absolute local paths.".into());
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
        let drive = match path.components().next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
                _ => {
                    return Err(
                        "Network and device paths cannot be imported by drag and drop.".into(),
                    )
                }
            },
            _ => return Err("Drop files using absolute local paths.".into()),
        };
        if path.components().any(|part| match part {
            Component::Normal(value) => value.to_string_lossy().contains(':'),
            _ => false,
        }) {
            return Err("Alternate file streams cannot be imported.".into());
        }
        let root: Vec<u16> = format!("{}:\\\0", char::from(drive))
            .encode_utf16()
            .collect();
        // SAFETY: root is a NUL-terminated UTF-16 drive root valid for this call.
        let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
        // DRIVE_REMOVABLE, DRIVE_FIXED, DRIVE_CDROM, DRIVE_RAMDISK; reject remote/unknown.
        if !matches!(drive_type, 2 | 3 | 5 | 6) {
            return Err(
                "Drop files stored on a local drive. Network drives are not supported.".into(),
            );
        }
    }
    #[cfg(not(windows))]
    if path.to_string_lossy().starts_with("//") {
        return Err("Network paths cannot be imported by drag and drop.".into());
    }
    Ok(())
}

pub(super) fn safe_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|v| v.to_str())
        .filter(|v| {
            !v.is_empty() && v.chars().count() <= 20 && v.chars().all(|c| c.is_alphanumeric())
        })
        .map(str::to_lowercase)
}

pub fn safe_stem(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else if c.is_whitespace() {
                '-'
            } else {
                c
            }
        })
        .take(70)
        .collect();
    let cleaned = cleaned.trim_matches(['.', ' ', '-', '_']);
    let mut cleaned = if cleaned.is_empty() {
        "untitled".to_owned()
    } else {
        cleaned.to_owned()
    };
    let base = cleaned.split('.').next().unwrap_or("").to_uppercase();
    if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && base.as_bytes()[3].is_ascii_digit())
    {
        cleaned.insert(0, '_');
    }
    cleaned
}

pub(super) fn managed_name(category: &str, suffix: &str, extension: Option<&str>) -> String {
    let suffix = safe_stem(suffix);
    let base = format!("{}_{}", safe_stem(category), suffix.trim_start_matches('_'));
    match extension {
        Some(value) => format!("{base}.{value}"),
        None => base,
    }
}

pub(super) fn validate_relative_path(value: &str) -> Result<()> {
    if value.contains(['\\', ':']) || value.contains('\0') || value.len() > 1_024 {
        return Err("Unsafe backup or attachment path.".into());
    }
    let components: Vec<_> = Path::new(value).components().collect();
    if components.len() != 3
        || components
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Unsafe backup or attachment path.".into());
    }
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() != 3 || parts[0] != "attachments" {
        return Err("Unsafe backup or attachment path.".into());
    }
    validate_id(parts[1])?;
    let filename = parts[2];
    if filename.is_empty()
        || filename.ends_with(['.', ' '])
        || filename
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || filename == "."
        || filename == ".."
    {
        return Err("Unsafe attachment filename.".into());
    }
    let stem = filename.split('.').next().unwrap_or("").to_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        return Err("Reserved attachment filename.".into());
    }
    Ok(())
}
