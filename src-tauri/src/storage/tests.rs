use super::*;
use tempfile::TempDir;

fn record() -> ProfileRecord {
    ProfileRecord {
        id: Uuid::new_v4().to_string(),
        category: "identity".into(),
        title: "个人资料".into(),
        subtitle: "Private information".into(),
        tags: vec!["personal".into()],
        favorite: false,
        fields: vec![Field {
            id: "full-name".into(),
            label: "Name".into(),
            label_zh: Some("姓名".into()),
            value: "Example Person".into(),
            kind: FieldKind::Text,
            sensitive: false,
        }],
        notes: "Example only".into(),
        created_at: now(),
        updated_at: now(),
    }
}

fn store() -> (TempDir, Store) {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    (temp, store)
}

fn source(temp: &TempDir, name: &str, contents: &[u8]) -> PathBuf {
    let path = temp.path().join(name);
    fs::write(&path, contents).unwrap();
    path
}

#[test]
fn record_crud_persists_and_soft_delete_can_be_undone() {
    let (_temp, store) = store();
    let initial = store.save_record(record()).unwrap();
    let mut edited = initial.clone();
    edited.title = "Updated title".into();
    edited.created_at = "2000-01-01T00:00:00Z".into();
    let edited = store.save_record(edited).unwrap();
    assert_eq!(edited.created_at, initial.created_at);
    let reopened = Store::open(store.root.clone()).unwrap();
    assert_eq!(
        reopened.snapshot().unwrap().records[0].title,
        "Updated title"
    );
    reopened.delete_record(&initial.id).unwrap();
    assert!(reopened.snapshot().unwrap().records.is_empty());
    reopened.save_record(edited).unwrap();
    assert_eq!(reopened.snapshot().unwrap().records.len(), 1);
}

#[test]
fn attachments_are_copied_named_and_deleted_reversibly() {
    let (temp, store) = store();
    let record = store.save_record(record()).unwrap();
    let original = source(&temp, "身份证.pdf", b"private example");
    let attachments = store
        .import_files(&record.id, &[original.clone(), original.clone()])
        .unwrap();
    assert_eq!(attachments.len(), 2);
    assert_ne!(
        attachments[0].metadata.file_name,
        attachments[1].metadata.file_name
    );
    assert!(attachments[0]
        .metadata
        .file_name
        .starts_with("identity__个人资料__"));
    assert_eq!(fs::read(&original).unwrap(), b"private example");
    let id = &attachments[0].metadata.id;
    let renamed = store.rename_attachment(id, "证件: 正面?").unwrap();
    assert!(renamed
        .metadata
        .file_name
        .starts_with("identity__证件_-正面__"));
    assert!(renamed.metadata.file_name.ends_with(".pdf"));
    assert!(store.rename_attachment(id, "../../escape").is_err());
    assert!(store.rename_attachment(id, "C:\\escape").is_err());
    store.remove_attachment(id).unwrap();
    assert_eq!(store.snapshot().unwrap().attachments.len(), 1);
    assert!(store.attachment_path(id).is_err());
    store.restore_attachment(id).unwrap();
    assert_eq!(store.snapshot().unwrap().attachments.len(), 2);
    store.delete_record(&record.id).unwrap();
    assert!(store.snapshot().unwrap().attachments.is_empty());
    store.save_record(record).unwrap();
    assert_eq!(store.snapshot().unwrap().attachments.len(), 2);
}

#[test]
fn filename_rules_reject_traversal_and_reserved_names() {
    assert_eq!(safe_stem("CON"), "_CON");
    assert_eq!(safe_stem(" A/B:C? "), "A_B_C");
    assert_eq!(safe_stem("..."), "untitled");
    let id = Uuid::new_v4();
    for path in [
        "../escape".to_owned(),
        "/absolute/file".into(),
        format!("attachments/{id}/../escape"),
        format!("attachments/{id}/C:escape"),
        format!("attachments/{id}/CON.pdf"),
        format!("attachments/{id}/file."),
        format!("attachments/{id}/..\\escape"),
    ] {
        assert!(validate_relative_path(&path).is_err(), "accepted {path}");
    }
    validate_relative_path(&format!("attachments/{id}/材料.pdf")).unwrap();
}

#[test]
fn failed_batch_import_rolls_back_database_and_copied_files() {
    let (temp, store) = store();
    let record = store.save_record(record()).unwrap();
    let good = source(&temp, "good.txt", b"safe");
    let result = store.import_files(&record.id, &[good, temp.path().join("missing.txt")]);
    assert!(result.is_err());
    assert!(store.snapshot().unwrap().attachments.is_empty());
    assert_eq!(
        fs::read_dir(store.vault().join("attachments").join(&record.id))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn dropped_files_use_managed_names_and_preserve_originals() {
    let (temp, store) = store();
    let saved = store.save_record(record()).unwrap();
    let original = source(&temp, "个人证件.pdf", b"local document");
    let imported = store
        .import_dropped_files(&saved.id, &[original.to_string_lossy().into_owned()])
        .unwrap();
    assert_eq!(imported.len(), 1);
    assert_eq!(imported[0].metadata.original_name, "个人证件.pdf");
    assert!(imported[0]
        .metadata
        .file_name
        .starts_with("identity__个人资料__"));
    assert!(imported[0].metadata.file_name.ends_with(".pdf"));
    assert_eq!(fs::read(&original).unwrap(), b"local document");
    assert_eq!(
        fs::read(store.attachment_path(&imported[0].metadata.id).unwrap()).unwrap(),
        b"local document"
    );
}

#[test]
fn dropped_batch_rejects_folders_missing_files_and_relative_paths_without_changes() {
    let (temp, store) = store();
    let saved = store.save_record(record()).unwrap();
    let good = source(&temp, "good.txt", b"valid local file")
        .to_string_lossy()
        .into_owned();
    let invalid = [
        temp.path().to_string_lossy().into_owned(),
        temp.path()
            .join("missing.txt")
            .to_string_lossy()
            .into_owned(),
        "relative.txt".into(),
        "https://example.com/file.txt".into(),
        "file:///C:/private.txt".into(),
        "invalid\0path".into(),
    ];
    for path in invalid {
        assert!(store
            .import_dropped_files(&saved.id, &[good.clone(), path])
            .is_err());
        assert!(store.snapshot().unwrap().attachments.is_empty());
        assert!(!store.vault().join("attachments").join(&saved.id).exists());
    }
    assert!(store
        .import_dropped_files(&saved.id, &vec![good; 101])
        .is_err());
    assert!(store.snapshot().unwrap().attachments.is_empty());
}

#[cfg(windows)]
#[test]
fn dropped_windows_paths_reject_network_devices_and_alternate_streams() {
    for value in [
        r"\\server\share\file.txt",
        r"\\?\UNC\server\share\file.txt",
        r"\\.\PhysicalDrive0",
        r"\\?\GLOBALROOT\Device\HarddiskVolume1\file.txt",
        r"C:relative.txt",
        r"\root-relative.txt",
        r"C:\file.txt:secret",
    ] {
        assert!(
            validate_local_drop_path(Path::new(value)).is_err(),
            "accepted {value}"
        );
    }
}

#[test]
fn backup_round_trip_restores_metadata_files_and_keeps_previous_vault() {
    let (temp, store) = store();
    let record = store.save_record(record()).unwrap();
    let original = source(&temp, "evidence.pdf", b"saved evidence");
    let attachment = store
        .import_files(&record.id, &[original])
        .unwrap()
        .remove(0);
    let backup = temp.path().join("backup.zip");
    store.export_backup(&backup).unwrap();
    store.delete_record(&record.id).unwrap();
    let mut other = self::record();
    other.title = "After backup".into();
    store.save_record(other).unwrap();
    store.restore_backup(&backup).unwrap();
    let snapshot = store.snapshot().unwrap();
    assert_eq!(snapshot.records.len(), 1);
    assert_eq!(snapshot.records[0].id, record.id);
    assert_eq!(snapshot.attachments.len(), 1);
    assert_eq!(
        fs::read(store.attachment_path(&attachment.metadata.id).unwrap()).unwrap(),
        b"saved evidence"
    );
    assert!(fs::read_dir(store.root()).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("previous-")));
    assert!(!store.root().join("restore-journal.json").exists());
}

fn write_archive(path: &Path, entries: &[(&str, &[u8])]) {
    let mut archive = zip::ZipWriter::new(File::create(path).unwrap());
    for (name, bytes) in entries {
        archive
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        archive.write_all(bytes).unwrap();
    }
    archive.finish().unwrap();
}

#[test]
fn invalid_archives_never_replace_live_data() {
    let (temp, store) = store();
    let record = store.save_record(record()).unwrap();
    let invalid = temp.path().join("bad.zip");
    let valid_manifest = serde_json::to_vec(&BackupManifest {
        schema_version: 1,
        created_at: now(),
        records: vec![],
        attachments: vec![],
    })
    .unwrap();
    write_archive(
        &invalid,
        &[("manifest.json", &valid_manifest), ("../escape", b"bad")],
    );
    assert!(store.restore_backup(&invalid).is_err());
    assert!(!temp.path().join("escape").exists());
    let invalid_manifest = serde_json::to_vec(&BackupManifest {
        schema_version: 999,
        created_at: now(),
        records: vec![],
        attachments: vec![],
    })
    .unwrap();
    write_archive(&invalid, &[("manifest.json", &invalid_manifest)]);
    assert!(store.restore_backup(&invalid).is_err());
    write_archive(&invalid, &[("manifest.json", b"not json")]);
    assert!(store.restore_backup(&invalid).is_err());
    assert_eq!(store.snapshot().unwrap().records[0].id, record.id);
}

#[test]
fn mismatched_backup_attachment_and_duplicate_records_are_rejected() {
    let (temp, store) = store();
    let record = record();
    let path = temp.path().join("bad.zip");
    let duplicate = BackupManifest {
        schema_version: 1,
        created_at: now(),
        records: vec![record.clone(), record.clone()],
        attachments: vec![],
    };
    let bytes = serde_json::to_vec(&duplicate).unwrap();
    write_archive(&path, &[("manifest.json", &bytes)]);
    assert!(store.restore_backup(&path).is_err());
    let relative = format!("attachments/{}/example.txt", record.id);
    let attachment = StoredAttachment {
        id: Uuid::new_v4().to_string(),
        record_id: record.id.clone(),
        original_name: "example.txt".into(),
        file_name: "example.txt".into(),
        relative_path: relative.clone(),
        size: 100,
        created_at: now(),
    };
    let manifest = BackupManifest {
        schema_version: 1,
        created_at: now(),
        records: vec![record],
        attachments: vec![attachment],
    };
    let bytes = serde_json::to_vec(&manifest).unwrap();
    write_archive(&path, &[("manifest.json", &bytes), (&relative, b"short")]);
    assert!(store.restore_backup(&path).is_err());
    assert!(store.snapshot().unwrap().records.is_empty());
}

#[test]
fn startup_recovers_interrupted_swap_from_previous_vault() {
    let (_temp, store) = store();
    let record = store.save_record(record()).unwrap();
    let journal = RestoreJournal {
        previous: format!("previous-{}", Uuid::new_v4()),
        staging: format!("restore-{}", Uuid::new_v4()),
    };
    fs::write(
        store.root.join("restore-journal.json"),
        serde_json::to_vec(&journal).unwrap(),
    )
    .unwrap();
    fs::rename(store.vault(), store.root.join(&journal.previous)).unwrap();
    let recovered = Store::open(store.root.clone()).unwrap();
    assert_eq!(recovered.snapshot().unwrap().records[0].id, record.id);
    assert!(!recovered.root.join("restore-journal.json").exists());
}

#[test]
fn recovery_rejects_journal_path_traversal() {
    let (_temp, store) = store();
    let journal = RestoreJournal {
        previous: "../../outside".into(),
        staging: "restore-invalid".into(),
    };
    fs::write(
        store.root.join("restore-journal.json"),
        serde_json::to_vec(&journal).unwrap(),
    )
    .unwrap();
    assert!(Store::open(store.root.clone()).is_err());
}

#[test]
fn partial_journal_is_quarantined_when_original_vault_is_intact() {
    let (_temp, store) = store();
    let saved = store.save_record(record()).unwrap();
    for partial in [
        b"".as_slice(),
        br#"{"previous":"previous-"#.as_slice(),
        b"not json".as_slice(),
    ] {
        fs::write(store.root.join("restore-journal.json"), partial).unwrap();
        let reopened = Store::open(store.root.clone()).unwrap();
        assert_eq!(reopened.snapshot().unwrap().records[0].id, saved.id);
        assert!(!reopened.root.join("restore-journal.json").exists());
    }
    let quarantined = fs::read_dir(store.root())
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("invalid-restore-journal-")
        })
        .count();
    assert_eq!(quarantined, 3);
}

#[test]
fn partial_journal_without_live_vault_is_preserved_for_recovery() {
    let (_temp, store) = store();
    let previous = store.root.join(format!("previous-{}", Uuid::new_v4()));
    fs::rename(store.vault(), &previous).unwrap();
    fs::write(store.root.join("restore-journal.json"), b"{").unwrap();
    assert!(Store::open(store.root.clone()).is_err());
    assert!(store.root.join("restore-journal.json").exists());
    assert!(!store.vault().exists());
    assert!(previous.join("folio.sqlite3").exists());
}

#[test]
fn journal_publication_is_complete_and_does_not_overwrite_existing_recovery() {
    let (_temp, store) = store();
    let journal = RestoreJournal {
        previous: format!("previous-{}", Uuid::new_v4()),
        staging: format!("restore-{}", Uuid::new_v4()),
    };
    store.publish_restore_journal(&journal).unwrap();
    let published = fs::read(store.root.join("restore-journal.json")).unwrap();
    let read: RestoreJournal = serde_json::from_slice(&published).unwrap();
    assert_eq!(read.previous, journal.previous);
    assert!(store.publish_restore_journal(&journal).is_err());
    assert_eq!(
        fs::read(store.root.join("restore-journal.json")).unwrap(),
        published
    );
    assert!(!fs::read_dir(store.root()).unwrap().any(|entry| entry
        .unwrap()
        .path()
        .extension()
        .is_some_and(|ext| ext == "tmp")));
}

#[test]
fn backup_excludes_soft_deleted_items() {
    let (temp, store) = store();
    let record = store.save_record(record()).unwrap();
    let original = source(&temp, "a.txt", b"one");
    let attachment = store
        .import_files(&record.id, &[original])
        .unwrap()
        .remove(0);
    store.remove_attachment(&attachment.metadata.id).unwrap();
    let backup = temp.path().join("clean.zip");
    store.export_backup(&backup).unwrap();
    let mut archive = zip::ZipArchive::new(File::open(backup).unwrap()).unwrap();
    assert_eq!(archive.len(), 1);
    let manifest: BackupManifest =
        serde_json::from_reader(archive.by_name("manifest.json").unwrap()).unwrap();
    assert!(manifest.attachments.is_empty());
    assert_eq!(manifest.records.len(), 1);
}

#[test]
fn invalid_records_are_rejected_before_storage() {
    let (_temp, store) = store();
    let mut invalid = record();
    invalid.id = "../escape".into();
    assert!(store.save_record(invalid).is_err());
    let mut invalid = record();
    invalid.fields.push(invalid.fields[0].clone());
    assert!(store.save_record(invalid).is_err());
    let mut invalid = record();
    invalid.category = "unknown".into();
    assert!(store.save_record(invalid).is_err());
    assert!(store.snapshot().unwrap().records.is_empty());
}

#[test]
fn export_rejects_manifest_that_restore_cannot_accept() {
    let (temp, store) = store();
    let mut large = record();
    large.fields = (0..35)
        .map(|index| Field {
            id: format!("field-{index}"),
            label: "Large field".into(),
            label_zh: None,
            value: "x".repeat(1_000_000),
            kind: FieldKind::Multiline,
            sensitive: false,
        })
        .collect();
    store.save_record(large).unwrap();
    let destination = temp.path().join("large.zip");
    let error = store.export_backup(&destination).unwrap_err();
    assert!(error.contains("32 MB"));
    assert!(!destination.exists());
}

#[test]
fn grown_attachment_aborts_export_and_preserves_existing_backup() {
    let (temp, store) = store();
    let saved = store.save_record(record()).unwrap();
    let original = source(&temp, "small.txt", b"small");
    let imported = store
        .import_files(&saved.id, &[original])
        .unwrap()
        .remove(0);
    let managed = store.attachment_path(&imported.metadata.id).unwrap();
    let mut file = OpenOptions::new().append(true).open(managed).unwrap();
    file.write_all(&vec![b'x'; 100_000]).unwrap();
    drop(file);
    let destination = temp.path().join("existing.zip");
    fs::write(&destination, b"previous backup must survive").unwrap();
    let error = store.export_backup(&destination).unwrap_err();
    assert!(error.contains("changed on disk"));
    assert_eq!(
        fs::read(destination).unwrap(),
        b"previous backup must survive"
    );
    assert!(!fs::read_dir(temp.path()).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".folio-export-")));
}
