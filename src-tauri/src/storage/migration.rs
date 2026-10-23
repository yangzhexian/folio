use super::*;
use std::time::SystemTime;

const READY_MARKER: &str = "migration-ready.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MigrationMarker {
    schema_version: u32,
    source: String,
}

struct CopiedFile {
    source: PathBuf,
    size: u64,
    modified: SystemTime,
}

impl Store {
    pub fn open_installed(root: PathBuf, legacy: &Path) -> Result<Self> {
        Self::prepare_installed(&root, legacy).map_err(|error| {
            format!("Cannot open Folio data at {}. Use a writable installation folder or grant this account write access, then restart Folio. Existing data has been preserved. Details: {error}", display_path(&root))
        })
    }

    fn prepare_installed(root: &Path, legacy: &Path) -> Result<Self> {
        fs::create_dir_all(root).map_err(err)?;
        let store = Self {
            root: root.canonicalize().map_err(err)?,
        };
        store.check_writable()?;
        // Existing destination recovery always takes precedence over older app-local data.
        store.recover_interrupted_restore()?;
        if store.vault().exists() {
            if !store.vault().join("folio.sqlite3").is_file() {
                return Err("The existing data/vault folder is incomplete; restore its database before restarting.".into());
            }
        } else if !store.resume_ready_migration()? {
            store.migrate_legacy(legacy)?;
        }
        Self::open(store.root)
    }

    fn check_writable(&self) -> Result<()> {
        let probe = self.root.join(format!(".write-check-{}", Uuid::new_v4()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&probe)
                .map_err(err)?;
            file.write_all(b"Folio").map_err(err)?;
            file.sync_all().map_err(err)
        })();
        let cleanup = fs::remove_file(&probe);
        result?;
        cleanup.map_err(err)
    }

    fn resume_ready_migration(&self) -> Result<bool> {
        let mut ready = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(err)? {
            let entry = entry.map_err(err)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name
                .strip_prefix("migration-")
                .is_some_and(|id| validate_id(id).is_ok())
                && entry.path().join(READY_MARKER).is_file()
            {
                let marker: MigrationMarker = serde_json::from_slice(
                    &fs::read(entry.path().join(READY_MARKER)).map_err(err)?,
                )
                .map_err(err)?;
                if marker.schema_version != 1 {
                    return Err("Unsupported migration marker.".into());
                }
                ready.push(entry.path());
            }
        }
        if ready.len() > 1 {
            return Err(
                "Multiple completed migration copies need manual recovery; no vault was replaced."
                    .into(),
            );
        }
        if let Some(staging) = ready.pop() {
            self.publish_migrated_vault(&staging)?;
            return Ok(true);
        }
        Ok(false)
    }

    fn migrate_legacy(&self, legacy: &Path) -> Result<()> {
        if !legacy.exists() {
            return Ok(());
        }
        let legacy = legacy.canonicalize().map_err(err)?;
        if legacy == self.root {
            return Ok(());
        }
        let mut sources = Vec::new();
        for entry in fs::read_dir(&legacy).map_err(err)? {
            let entry = entry.map_err(err)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "vault"
                || name == "restore-journal.json"
                || name.starts_with("previous-")
                || name.starts_with("restore-")
                || name.starts_with("invalid-restore-journal-")
            {
                sources.push(entry.path());
            }
        }
        if sources.is_empty() {
            return Ok(());
        }
        if !legacy.join("vault").exists() && !legacy.join("restore-journal.json").is_file() {
            return Err("Legacy recovery copies exist without an active vault or restore journal. Recover that library before migrating.".into());
        }
        let staging = self.root.join(format!("migration-{}", Uuid::new_v4()));
        fs::create_dir(&staging).map_err(err)?;
        let mut copied = Vec::new();
        for source in sources {
            let destination = staging.join(source.file_name().ok_or("Invalid legacy data entry.")?);
            copy_entry(&source, &destination, &mut copied)?;
        }
        for file in copied {
            let metadata = fs::metadata(&file.source).map_err(err)?;
            if metadata.len() != file.size || metadata.modified().map_err(err)? != file.modified {
                return Err(
                    "Legacy data changed while copying. Close other Folio instances and retry."
                        .into(),
                );
            }
        }
        validate_staged_vault(&staging)?;
        let marker = MigrationMarker {
            schema_version: 1,
            source: display_path(&legacy),
        };
        let temporary = staging.join("migration-ready.tmp");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(&serde_json::to_vec(&marker).map_err(err)?)
            .map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        fs::rename(temporary, staging.join(READY_MARKER)).map_err(err)?;
        self.publish_migrated_vault(&staging)
    }

    fn publish_migrated_vault(&self, staging: &Path) -> Result<()> {
        if self.vault().exists() {
            return Err(
                "The installation vault already exists; migration did not replace it.".into(),
            );
        }
        validate_staged_vault(staging)?;
        // This is the only commit step. Recovery copies and the source marker remain in staging.
        fs::rename(staging.join("vault"), self.vault()).map_err(err)
    }
}

fn copy_entry(source: &Path, destination: &Path, copied: &mut Vec<CopiedFile>) -> Result<()> {
    let metadata = fs::symlink_metadata(source).map_err(err)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Legacy data contains a redirected file or folder. Copy it to a regular local folder before migrating.".into());
        }
    }
    if metadata.file_type().is_symlink() {
        return Err(
            "Legacy data contains a symbolic link; migration stopped without changing it.".into(),
        );
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(err)?;
        for entry in fs::read_dir(source).map_err(err)? {
            let entry = entry.map_err(err)?;
            copy_entry(&entry.path(), &destination.join(entry.file_name()), copied)?;
        }
    } else if metadata.is_file() {
        let mut input = File::open(source).map_err(err)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(err)?;
        let size = std::io::copy(
            &mut Read::by_ref(&mut input).take(metadata.len().saturating_add(1)),
            &mut output,
        )
        .map_err(err)?;
        if size != metadata.len() {
            return Err(
                "Legacy data changed while copying; retry after closing other instances.".into(),
            );
        }
        output.sync_all().map_err(err)?;
        copied.push(CopiedFile {
            source: source.to_owned(),
            size,
            modified: metadata.modified().map_err(err)?,
        });
    } else {
        return Err("Legacy data contains an unsupported file type.".into());
    }
    Ok(())
}

fn validate_staged_vault(root: &Path) -> Result<()> {
    let candidate = Store {
        root: root.canonicalize().map_err(err)?,
    };
    candidate.recover_interrupted_restore()?;
    let database = candidate.vault().join("folio.sqlite3");
    if !database.is_file() {
        return Err("The copied library has no database.".into());
    }
    // Recover a copied SQLite rollback journal in staging, never in the source library.
    let db = Connection::open(&database).map_err(err)?;
    let integrity: String = db
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(err)?;
    if integrity != "ok" {
        return Err("The copied database failed its integrity check.".into());
    }
    drop(db);
    if !candidate.live_vault_is_intact() {
        return Err("The copied database did not pass its integrity check; the original library is unchanged.".into());
    }
    candidate.snapshot()?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(database)
        .map_err(err)?
        .sync_all()
        .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn record(title: &str) -> ProfileRecord {
        ProfileRecord {
            id: Uuid::new_v4().to_string(),
            category: "identity".into(),
            title: title.into(),
            subtitle: String::new(),
            tags: vec![],
            favorite: false,
            fields: vec![],
            notes: String::new(),
            created_at: now(),
            updated_at: now(),
        }
    }

    #[test]
    fn migration_copies_records_files_soft_deletions_and_recovery_copies() {
        let temp = TempDir::new().unwrap();
        let legacy_root = temp.path().join("legacy");
        let legacy = Store::open(legacy_root.clone()).unwrap();
        let active = legacy.save_record(record("Active")).unwrap();
        let deleted = legacy.save_record(record("Deleted")).unwrap();
        legacy.delete_record(&deleted.id).unwrap();
        let source = temp.path().join("evidence.pdf");
        fs::write(&source, b"evidence").unwrap();
        let imported = legacy
            .import_files(&active.id, &[source])
            .unwrap()
            .remove(0);
        let recovery_name = format!("previous-{}", Uuid::new_v4());
        fs::create_dir(legacy_root.join(&recovery_name)).unwrap();
        fs::write(
            legacy_root.join(&recovery_name).join("keep.txt"),
            b"recovery",
        )
        .unwrap();
        let original_db = fs::read(legacy.vault().join("folio.sqlite3")).unwrap();
        let destination = temp.path().join("installed/data");
        let migrated = Store::open_installed(destination, &legacy_root).unwrap();
        assert_eq!(migrated.snapshot().unwrap().records[0].id, active.id);
        assert_eq!(
            fs::read(migrated.attachment_path(&imported.metadata.id).unwrap()).unwrap(),
            b"evidence"
        );
        migrated.save_record(deleted).unwrap();
        assert_eq!(migrated.snapshot().unwrap().records.len(), 2);
        assert_eq!(
            fs::read(legacy.vault().join("folio.sqlite3")).unwrap(),
            original_db
        );
        assert_eq!(legacy.snapshot().unwrap().records.len(), 1);
        let staging = fs::read_dir(migrated.root())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.join(READY_MARKER).is_file())
            .unwrap();
        assert_eq!(
            fs::read(staging.join(recovery_name).join("keep.txt")).unwrap(),
            b"recovery"
        );
        assert!(!staging.join("vault").exists());
    }

    #[test]
    fn existing_destination_vault_is_never_overwritten() {
        let temp = TempDir::new().unwrap();
        let legacy = Store::open(temp.path().join("legacy")).unwrap();
        legacy.save_record(record("Legacy")).unwrap();
        let destination = temp.path().join("data");
        let installed = Store::open(destination.clone()).unwrap();
        let current = installed.save_record(record("Current")).unwrap();
        let reopened = Store::open_installed(destination, legacy.root()).unwrap();
        assert_eq!(reopened.snapshot().unwrap().records[0].id, current.id);
        assert_eq!(fs::read_dir(reopened.root()).unwrap().count(), 1);
    }

    #[test]
    fn migration_recovers_a_copied_restore_journal_without_touching_original() {
        let temp = TempDir::new().unwrap();
        let legacy = Store::open(temp.path().join("legacy")).unwrap();
        let saved = legacy
            .save_record(record("Before interrupted restore"))
            .unwrap();
        let journal = RestoreJournal {
            previous: format!("previous-{}", Uuid::new_v4()),
            staging: format!("restore-{}", Uuid::new_v4()),
        };
        fs::rename(legacy.vault(), legacy.root.join(&journal.previous)).unwrap();
        let journal_bytes = serde_json::to_vec(&journal).unwrap();
        fs::write(legacy.root.join("restore-journal.json"), &journal_bytes).unwrap();
        let migrated = Store::open_installed(temp.path().join("data"), legacy.root()).unwrap();
        assert_eq!(migrated.snapshot().unwrap().records[0].id, saved.id);
        assert!(!legacy.vault().exists());
        assert_eq!(
            fs::read(legacy.root.join("restore-journal.json")).unwrap(),
            journal_bytes
        );
        assert!(legacy
            .root
            .join(&journal.previous)
            .join("folio.sqlite3")
            .exists());
    }

    #[test]
    fn ready_migration_resumes_after_interruption_and_ignores_partial_copies() {
        let temp = TempDir::new().unwrap();
        let destination = temp.path().join("data");
        let ready = destination.join(format!("migration-{}", Uuid::new_v4()));
        let staged = Store::open(ready.clone()).unwrap();
        let saved = staged.save_record(record("Completed copy")).unwrap();
        let marker = MigrationMarker {
            schema_version: 1,
            source: "old location".into(),
        };
        fs::write(
            ready.join(READY_MARKER),
            serde_json::to_vec(&marker).unwrap(),
        )
        .unwrap();
        let partial = destination.join(format!("migration-{}", Uuid::new_v4()));
        fs::create_dir(&partial).unwrap();
        fs::write(partial.join("incomplete.txt"), b"partial").unwrap();
        let resumed =
            Store::open_installed(destination, &temp.path().join("missing-legacy")).unwrap();
        assert_eq!(resumed.snapshot().unwrap().records[0].id, saved.id);
        assert!(partial.join("incomplete.txt").exists());
    }

    #[test]
    fn invalid_migration_never_publishes_empty_vault_and_source_survives() {
        let temp = TempDir::new().unwrap();
        let legacy = temp.path().join("legacy");
        fs::create_dir_all(legacy.join("vault")).unwrap();
        fs::write(legacy.join("vault/folio.sqlite3"), b"corrupt database").unwrap();
        let destination = temp.path().join("data");
        let error = Store::open_installed(destination.clone(), &legacy).unwrap_err();
        assert!(error.contains("Existing data has been preserved"));
        assert!(!destination.join("vault").exists());
        assert_eq!(
            fs::read(legacy.join("vault/folio.sqlite3")).unwrap(),
            b"corrupt database"
        );
    }

    #[test]
    fn unwritable_location_reports_requested_path_without_fallback() {
        let temp = TempDir::new().unwrap();
        let destination = temp.path().join("data");
        fs::write(&destination, b"existing unrelated file").unwrap();
        let error =
            Store::open_installed(destination.clone(), &temp.path().join("legacy")).unwrap_err();
        assert!(error.contains(&display_path(&destination)));
        assert!(error.contains("writable installation folder"));
        assert_eq!(fs::read(destination).unwrap(), b"existing unrelated file");
    }
}
