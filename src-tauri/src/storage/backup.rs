use super::*;
use std::collections::HashSet;
use zip::write::SimpleFileOptions;

const MAX_BACKUP_SIZE: u64 = 10 * 1024 * 1024 * 1024;
const MAX_MANIFEST_SIZE: u64 = 32 * 1024 * 1024;
const MAX_BACKUP_ENTRIES: usize = 100_001;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RestoreJournal {
    pub(super) previous: String,
    pub(super) staging: String,
}

impl Store {
    pub fn export_backup(&self, destination: &Path) -> Result<()> {
        if destination.is_dir() {
            return Err("Choose a file as the backup destination.".into());
        }
        // Export beside the requested destination, then rename after a complete, synced ZIP.
        let parent = destination.parent().ok_or("Choose a backup location.")?;
        let resolved_parent = parent.canonicalize().map_err(err)?;
        if resolved_parent.starts_with(self.vault().canonicalize().map_err(err)?) {
            return Err("Save backups outside the active vault.".into());
        }
        let temporary = resolved_parent.join(format!(".folio-export-{}.tmp", Uuid::new_v4()));
        let result = self.write_backup(&temporary);
        if let Err(error) = result {
            let _ = fs::remove_file(temporary);
            return Err(error);
        }
        // Windows cannot rename over an existing file; retain that file until replacement succeeds.
        let previous = resolved_parent.join(format!(".folio-previous-{}.tmp", Uuid::new_v4()));
        let existed = destination.exists();
        if existed {
            if let Err(error) = fs::rename(destination, &previous) {
                let _ = fs::remove_file(&temporary);
                return Err(err(error));
            }
        }
        if let Err(error) = fs::rename(&temporary, destination) {
            if existed {
                let _ = fs::rename(&previous, destination);
            }
            let _ = fs::remove_file(temporary);
            return Err(err(error));
        }
        if existed {
            let _ = fs::remove_file(previous);
        }
        Ok(())
    }

    fn write_backup(&self, path: &Path) -> Result<()> {
        let db = self.connection()?;
        let catalog = read_category_catalog(&db)?;
        let customized = catalog.categories != builtin_categories();
        let records = read_records(&db)?;
        for record in &records {
            validate_record(record)?;
            require_category(&catalog.categories, &record.category)?;
        }
        let manifest = BackupManifest {
            schema_version: if customized { 2 } else { 1 },
            created_at: now(),
            records,
            categories: customized.then_some(catalog.categories),
            attachments: read_attachments(&db)?
                .into_iter()
                .map(|mut attachment| {
                    // Concurrency revisions describe a live vault, not portable backup contents.
                    attachment.revision = None;
                    attachment
                })
                .collect(),
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(err)?;
        if manifest_bytes.len() as u64 > MAX_MANIFEST_SIZE {
            return Err("Backup manifest exceeds the 32 MB limit.".into());
        }
        if manifest.attachments.len() + 1 > MAX_BACKUP_ENTRIES {
            return Err("Backup has too many entries.".into());
        }
        let mut archive = zip::ZipWriter::new(
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(err)?,
        );
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);
        archive.start_file("manifest.json", options).map_err(err)?;
        archive.write_all(&manifest_bytes).map_err(err)?;
        let mut total = manifest_bytes.len() as u64;
        let vault = self.vault().canonicalize().map_err(err)?;
        for attachment in manifest.attachments {
            if attachment.size > MAX_FILE_SIZE {
                return Err("An attachment exceeds the 2 GB size limit.".into());
            }
            total = total
                .checked_add(attachment.size)
                .ok_or("Backup size overflow.")?;
            if total > MAX_BACKUP_SIZE {
                return Err("Backup exceeds the 10 GB limit.".into());
            }
            let source = Self::resolve_existing_in(&vault, &attachment.relative_path)?;
            let mut input = File::open(source).map_err(err)?;
            if input.metadata().map_err(err)?.len() != attachment.size {
                return Err("An attachment changed on disk. Reimport it before backing up.".into());
            }
            archive
                .start_file(&attachment.relative_path, options)
                .map_err(err)?;
            let written = std::io::copy(
                &mut Read::by_ref(&mut input).take(attachment.size + 1),
                &mut archive,
            )
            .map_err(err)?;
            if written != attachment.size {
                return Err("An attachment changed on disk. Reimport it before backing up.".into());
            }
        }
        archive.finish().map_err(err)?.sync_all().map_err(err)
    }

    pub fn restore_backup(&self, source: &Path) -> Result<()> {
        let staging_name = format!("restore-{}", Uuid::new_v4());
        let staging = self.root.join(&staging_name);
        fs::create_dir(&staging).map_err(err)?;
        let prepare = self.prepare_restore(source, &staging);
        if let Err(error) = prepare {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        let previous_name = format!("previous-{}", Uuid::new_v4());
        let previous = self.root.join(&previous_name);
        let journal = RestoreJournal {
            previous: previous_name,
            staging: staging_name,
        };
        let journal_path = self.root.join("restore-journal.json");
        if let Err(error) = self.publish_restore_journal(&journal) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        if let Err(error) = fs::rename(self.vault(), &previous) {
            let _ = fs::remove_file(&journal_path);
            let _ = fs::remove_dir_all(&staging);
            return Err(err(error));
        }
        if let Err(error) = fs::rename(&staging, self.vault()) {
            // Keep journal on failed rollback so the next launch can recover safely.
            if fs::rename(&previous, self.vault()).is_ok() {
                let _ = fs::remove_file(&journal_path);
            }
            return Err(err(error));
        }
        // Previous vault is deliberately retained: restoring a backup is reversible on disk.
        fs::remove_file(journal_path).map_err(err)?;
        Ok(())
    }

    pub(super) fn publish_restore_journal(&self, journal: &RestoreJournal) -> Result<()> {
        let path = self.root.join("restore-journal.json");
        if path.exists() {
            return Err(
                "A previous restore requires recovery. Restart Folio before restoring again."
                    .into(),
            );
        }
        let temporary = self
            .root
            .join(format!("restore-journal-{}.tmp", Uuid::new_v4()));
        let result = (|| {
            let bytes = serde_json::to_vec(journal).map_err(err)?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(err)?;
            file.write_all(&bytes).map_err(err)?;
            file.sync_all().map_err(err)?;
            drop(file);
            // Publish only complete, synced JSON before moving the live vault.
            fs::rename(&temporary, &path).map_err(err)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    fn prepare_restore(&self, source: &Path, staging: &Path) -> Result<()> {
        let mut archive = zip::ZipArchive::new(File::open(source).map_err(err)?).map_err(err)?;
        if archive.len() > MAX_BACKUP_ENTRIES {
            return Err("Backup has too many entries.".into());
        }
        let mut entries = HashSet::new();
        let mut total = 0_u64;
        for index in 0..archive.len() {
            let entry = archive.by_index(index).map_err(err)?;
            let name = entry.name().to_owned();
            if name != "manifest.json" {
                validate_relative_path(&name)?;
            }
            if entry.is_dir()
                || !entries.insert(name.clone())
                || entry
                    .unix_mode()
                    .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(
                    "Backup contains duplicate, directory, or symbolic link entries.".into(),
                );
            }
            let limit = if name == "manifest.json" {
                MAX_MANIFEST_SIZE
            } else {
                MAX_FILE_SIZE
            };
            if entry.size() > limit {
                return Err("Backup entry exceeds its size limit.".into());
            }
            total = total
                .checked_add(entry.size())
                .ok_or("Backup size overflow.")?;
            if total > MAX_BACKUP_SIZE {
                return Err("Backup exceeds the 10 GB unpacked limit.".into());
            }
        }
        let manifest: BackupManifest = {
            let file = archive.by_name("manifest.json").map_err(err)?;
            let mut bytes = Vec::new();
            file.take(MAX_MANIFEST_SIZE + 1)
                .read_to_end(&mut bytes)
                .map_err(err)?;
            if bytes.len() as u64 > MAX_MANIFEST_SIZE {
                return Err("Backup manifest is too large.".into());
            }
            serde_json::from_slice(&bytes).map_err(err)?
        };
        let categories = match (manifest.schema_version, &manifest.categories) {
            (1, None) => builtin_categories(),
            (2, Some(categories)) => normalize_categories(categories.clone())?,
            (1 | 2, _) => return Err("Invalid category catalog in backup.".into()),
            _ => return Err("Unsupported backup schema version.".into()),
        };
        validate_date(&manifest.created_at)?;
        let mut record_ids = HashSet::new();
        for record in &manifest.records {
            validate_record(record)?;
            require_category(&categories, &record.category)?;
            if !record_ids.insert(record.id.clone()) {
                return Err("Backup contains duplicate records.".into());
            }
        }
        let mut attachment_ids = HashSet::new();
        let mut expected = HashSet::from(["manifest.json".to_owned()]);
        for attachment in &manifest.attachments {
            validate_id(&attachment.id)?;
            validate_id(&attachment.record_id)?;
            validate_date(&attachment.created_at)?;
            validate_relative_path(&attachment.relative_path)?;
            let required = format!(
                "attachments/{}/{}",
                attachment.record_id, attachment.file_name
            );
            if !record_ids.contains(&attachment.record_id)
                || !attachment_ids.insert(attachment.id.clone())
                || !expected.insert(attachment.relative_path.clone())
                || required != attachment.relative_path
                || attachment.original_name.len() > 1_024
                || attachment.size > MAX_FILE_SIZE
            {
                return Err("Invalid attachment metadata in backup.".into());
            }
            let file = archive.by_name(&attachment.relative_path).map_err(err)?;
            if file.size() != attachment.size {
                return Err("Backup attachment size does not match its metadata.".into());
            }
        }
        if entries != expected {
            return Err("Backup contains unexpected or missing files.".into());
        }
        let mut db = Self::connection_at(staging)?;
        let tx = db.transaction().map_err(err)?;
        write_category_catalog(
            &tx,
            &CategoryCatalog {
                categories,
                revision: Uuid::new_v4().to_string(),
            },
        )?;
        for record in &manifest.records {
            tx.execute(
                "INSERT INTO records(id,body) VALUES(?1,?2)",
                params![record.id, serde_json::to_string(record).map_err(err)?],
            )
            .map_err(err)?;
        }
        for attachment in &manifest.attachments {
            let target = staging.join(&attachment.relative_path);
            fs::create_dir_all(target.parent().ok_or("Invalid restore path.")?).map_err(err)?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)
                .map_err(err)?;
            let mut entry = archive.by_name(&attachment.relative_path).map_err(err)?;
            let copied = std::io::copy(&mut entry.by_ref().take(attachment.size + 1), &mut output)
                .map_err(err)?;
            if copied != attachment.size {
                return Err("Backup attachment data is truncated or oversized.".into());
            }
            // Reading to EOF verifies ZIP CRC, including zero-length files.
            let mut extra = [0_u8; 1];
            if entry.read(&mut extra).map_err(err)? != 0 {
                return Err("Unexpected trailing attachment data.".into());
            }
            output.sync_all().map_err(err)?;
            let mut restored = attachment.clone();
            restored.revision = Some(Uuid::new_v4().to_string());
            tx.execute(
                "INSERT INTO attachments(id,record_id,body) VALUES(?1,?2,?3)",
                params![
                    attachment.id,
                    attachment.record_id,
                    serde_json::to_string(&restored).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        drop(db);
        Ok(())
    }

    pub(super) fn recover_interrupted_restore(&self) -> Result<()> {
        let path = self.root.join("restore-journal.json");
        if !path.exists() {
            return Ok(());
        }
        let bytes = fs::read(&path).map_err(err)?;
        let journal: RestoreJournal = match serde_json::from_slice(&bytes) {
            Ok(journal) => journal,
            Err(error) => {
                // Earlier versions could leave partial JSON before moving the original vault.
                // Quarantine it only when an existing database passes a read-only integrity check.
                if self.live_vault_is_intact() {
                    let quarantine = self
                        .root
                        .join(format!("invalid-restore-journal-{}.json", Uuid::new_v4()));
                    fs::rename(&path, quarantine).map_err(err)?;
                    return Ok(());
                }
                return Err(format!(
                    "Recovery journal is invalid and the live vault cannot be verified: {error}"
                ));
            }
        };
        for (name, prefix) in [
            (&journal.previous, "previous-"),
            (&journal.staging, "restore-"),
        ] {
            validate_id(
                name.strip_prefix(prefix)
                    .ok_or("Invalid recovery journal.")?,
            )?;
        }
        let previous = self.root.join(&journal.previous);
        if !self.vault().exists() {
            if previous.is_dir() {
                fs::rename(previous, self.vault()).map_err(err)?;
            } else {
                return Err(
                    "Interrupted restore requires manual recovery; original vault not found."
                        .into(),
                );
            }
        }
        // Do not delete previous/staging data during recovery; keep both available to the user.
        fs::remove_file(path).map_err(err)
    }

    pub(super) fn live_vault_is_intact(&self) -> bool {
        let inspect = || -> Result<()> {
            let db = Connection::open_with_flags(
                self.vault().join("folio.sqlite3"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(err)?;
            let integrity: String = db
                .query_row("PRAGMA quick_check", [], |row| row.get(0))
                .map_err(err)?;
            if integrity != "ok" {
                return Err("Database integrity check failed.".into());
            }
            db.prepare("SELECT id,body,deleted FROM records LIMIT 0")
                .map_err(err)?;
            db.prepare("SELECT id,record_id,body,deleted FROM attachments LIMIT 0")
                .map_err(err)?;
            Ok(())
        };
        inspect().is_ok()
    }
}
