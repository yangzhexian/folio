use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;
use zip::write::SimpleFileOptions;

const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024 * 1024;
const MAX_BACKUP_SIZE: u64 = 10 * 1024 * 1024 * 1024;
const MAX_MANIFEST_SIZE: u64 = 32 * 1024 * 1024;
const MAX_BACKUP_ENTRIES: usize = 100_001;

mod migration;
mod preview;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Debug)]
pub struct Store {
    root: PathBuf,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RestoreJournal {
    previous: String,
    staging: String,
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(err)?;
        let store = Self {
            root: root.canonicalize().map_err(err)?,
        };
        store.recover_interrupted_restore()?;
        store.connection()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn vault(&self) -> PathBuf {
        self.root.join("vault")
    }

    fn connection(&self) -> Result<Connection> {
        Self::connection_at(&self.vault())
    }

    fn connection_at(vault: &Path) -> Result<Connection> {
        fs::create_dir_all(vault.join("attachments")).map_err(err)?;
        let db = Connection::open(vault.join("folio.sqlite3")).map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        db.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = DELETE;
             PRAGMA synchronous = FULL;
             CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, body TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), body TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
             CREATE INDEX IF NOT EXISTS attachment_record ON attachments(record_id);"
        ).map_err(err)?;
        Ok(db)
    }

    pub fn snapshot(&self) -> Result<Snapshot> {
        let db = self.connection()?;
        let records = read_records(&db)?;
        let stored = read_attachments(&db)?;
        let attachments = stored
            .into_iter()
            .map(|a| self.public_attachment(a))
            .collect::<Result<_>>()?;
        Ok(Snapshot {
            records,
            attachments,
            data_dir: display_path(&self.root),
        })
    }

    pub fn save_record(&self, mut record: ProfileRecord) -> Result<ProfileRecord> {
        validate_record(&record)?;
        let mut db = self.connection()?;
        let tx = db.transaction().map_err(err)?;
        let previous: Option<String> = tx
            .query_row("SELECT body FROM records WHERE id=?1", [&record.id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if let Some(body) = previous {
            record.created_at = serde_json::from_str::<ProfileRecord>(&body)
                .map_err(err)?
                .created_at;
        }
        record.title = record.title.trim().to_owned();
        record.updated_at = now();
        tx.execute("INSERT INTO records(id, body, deleted) VALUES(?1, ?2, 0) ON CONFLICT(id) DO UPDATE SET body=excluded.body, deleted=0", params![record.id, serde_json::to_string(&record).map_err(err)?]).map_err(err)?;
        tx.execute(
            "UPDATE attachments SET deleted=0 WHERE record_id=?1 AND deleted=2",
            [&record.id],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(record)
    }

    pub fn delete_record(&self, id: &str) -> Result<()> {
        validate_id(id)?;
        let mut db = self.connection()?;
        let tx = db.transaction().map_err(err)?;
        require_record(&tx, id)?;
        tx.execute("UPDATE records SET deleted=1 WHERE id=?1", [id])
            .map_err(err)?;
        tx.execute(
            "UPDATE attachments SET deleted=2 WHERE record_id=?1 AND deleted=0",
            [id],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }

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
        if new_name == attachment.file_name {
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
        get_attachment(&db, id, false)?;
        db.execute("UPDATE attachments SET deleted=1 WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }

    pub fn restore_attachment(&self, id: &str) -> Result<Attachment> {
        let db = self.connection()?;
        let attachment = get_attachment(&db, id, true)?;
        require_record(&db, &attachment.record_id)?;
        self.resolve_existing(&attachment.relative_path)?;
        db.execute("UPDATE attachments SET deleted=0 WHERE id=?1", [id])
            .map_err(err)?;
        self.public_attachment(attachment)
    }

    pub fn attachment_path(&self, id: &str) -> Result<PathBuf> {
        let db = self.connection()?;
        let attachment = get_attachment(&db, id, false)?;
        self.resolve_existing(&attachment.relative_path)
    }

    fn public_attachment(&self, metadata: StoredAttachment) -> Result<Attachment> {
        let path = self.safe_destination(&metadata.relative_path)?;
        Ok(Attachment {
            metadata,
            absolute_path: display_path(&path),
        })
    }

    fn safe_destination(&self, relative: &str) -> Result<PathBuf> {
        validate_relative_path(relative)?;
        let vault = self.vault().canonicalize().map_err(err)?;
        let path = vault.join(relative);
        // Reject redirected parents (symlinks and Windows junctions) before writing.
        let mut ancestor = path.parent().ok_or("Invalid file path.")?;
        while !ancestor.exists() {
            ancestor = ancestor.parent().ok_or("Invalid file path.")?;
        }
        if !ancestor.canonicalize().map_err(err)?.starts_with(&vault) {
            return Err("Attachment path escapes the local vault.".into());
        }
        if path.exists() && !path.canonicalize().map_err(err)?.starts_with(&vault) {
            return Err("Attachment path escapes the local vault.".into());
        }
        Ok(path)
    }

    fn resolve_existing(&self, relative: &str) -> Result<PathBuf> {
        let path = self.safe_destination(relative)?;
        let actual = path.canonicalize().map_err(err)?;
        if !actual.is_file() {
            return Err("Attachment is not a regular file.".into());
        }
        Ok(actual)
    }

    pub fn export_backup(&self, destination: &Path) -> Result<()> {
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
            fs::rename(destination, &previous).map_err(err)?;
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
        let manifest = BackupManifest {
            schema_version: 1,
            created_at: now(),
            records: read_records(&db)?,
            attachments: read_attachments(&db)?,
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
            let source = self.resolve_existing(&attachment.relative_path)?;
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

    fn publish_restore_journal(&self, journal: &RestoreJournal) -> Result<()> {
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
        if manifest.schema_version != 1 {
            return Err("Unsupported backup schema version.".into());
        }
        validate_date(&manifest.created_at)?;
        let mut record_ids = HashSet::new();
        for record in &manifest.records {
            validate_record(record)?;
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
            tx.execute(
                "INSERT INTO attachments(id,record_id,body) VALUES(?1,?2,?3)",
                params![
                    attachment.id,
                    attachment.record_id,
                    serde_json::to_string(attachment).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        drop(db);
        Ok(())
    }

    fn recover_interrupted_restore(&self) -> Result<()> {
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

    fn live_vault_is_intact(&self) -> bool {
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

fn read_records(db: &Connection) -> Result<Vec<ProfileRecord>> {
    let mut statement = db.prepare("SELECT body FROM records WHERE deleted=0 ORDER BY json_extract(body, '$.updatedAt') DESC").map_err(err)?;
    let rows = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

fn read_attachments(db: &Connection) -> Result<Vec<StoredAttachment>> {
    let mut statement = db.prepare("SELECT a.body FROM attachments a JOIN records r ON r.id=a.record_id WHERE a.deleted=0 AND r.deleted=0 ORDER BY a.rowid").map_err(err)?;
    let rows = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

fn require_record(db: &Connection, id: &str) -> Result<ProfileRecord> {
    let body: String = db
        .query_row(
            "SELECT body FROM records WHERE id=?1 AND deleted=0",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or("Record not found.")?;
    serde_json::from_str(&body).map_err(err)
}

fn get_attachment(db: &Connection, id: &str, include_deleted: bool) -> Result<StoredAttachment> {
    validate_id(id)?;
    let query = if include_deleted {
        "SELECT body FROM attachments WHERE id=?1"
    } else {
        "SELECT a.body FROM attachments a JOIN records r ON r.id=a.record_id WHERE a.id=?1 AND a.deleted=0 AND r.deleted=0"
    };
    let body: String = db
        .query_row(query, [id], |r| r.get(0))
        .optional()
        .map_err(err)?
        .ok_or("Attachment not found.")?;
    serde_json::from_str(&body).map_err(err)
}

pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        value.strip_prefix("\\\\?\\").unwrap_or(&value).to_owned()
    }
}

fn validate_local_drop_path(path: &Path) -> Result<()> {
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

fn safe_extension(path: &Path) -> Option<String> {
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

fn managed_name(category: &str, suffix: &str, extension: Option<&str>) -> String {
    let suffix = safe_stem(suffix);
    let base = format!("{}_{}", safe_stem(category), suffix.trim_start_matches('_'));
    match extension {
        Some(value) => format!("{base}.{value}"),
        None => base,
    }
}

fn validate_relative_path(value: &str) -> Result<()> {
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

#[cfg(test)]
mod tests;
