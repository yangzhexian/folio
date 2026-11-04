use super::*;
use tempfile::TempDir;

fn setup() -> (TempDir, Store, ProfileRecord, Attachment) {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    let record = store
        .agent_create(ProfileRecord {
            id: Uuid::new_v4().to_string(),
            category: "identity".into(),
            title: "Synthetic edit tests".into(),
            subtitle: "Keep subtitle".into(),
            tags: vec!["Keep tag".into()],
            favorite: true,
            notes: "Keep notes".into(),
            created_at: now(),
            updated_at: now(),
            fields: vec![Field {
                id: "first".into(),
                label: "First".into(),
                label_zh: Some("第一项".into()),
                value: "Preserve".into(),
                kind: FieldKind::Text,
                sensitive: false,
            }],
        })
        .unwrap();
    let source = temp.path().join("original.pdf");
    fs::write(&source, b"Original managed content").unwrap();
    let attachment = store.import_files(&record.id, &[source]).unwrap().remove(0);
    (temp, store, record, attachment)
}

fn token(attachment: &Attachment) -> &str {
    attachment.metadata.revision.as_deref().unwrap()
}

#[test]
fn legacy_attachment_reads_have_stable_tokens_without_database_writes() {
    let (_temp, store, record, attachment) = setup();
    let mut legacy = attachment.metadata.clone();
    legacy.revision = None;
    store
        .connection()
        .unwrap()
        .execute(
            "UPDATE attachments SET body=?1 WHERE id=?2",
            params![serde_json::to_string(&legacy).unwrap(), legacy.id],
        )
        .unwrap();
    let before = fs::read(store.vault().join("folio.sqlite3")).unwrap();
    let first = store.agent_snapshot().unwrap().attachments.remove(0);
    let second = store.agent_snapshot().unwrap().attachments.remove(0);
    assert!(token(&first).starts_with("legacy-"));
    assert_eq!(token(&first), token(&second));
    assert_eq!(
        fs::read(store.vault().join("folio.sqlite3")).unwrap(),
        before
    );
    let renamed = store.rename_attachment(&legacy.id, "passport").unwrap();
    assert_ne!(token(&renamed), token(&first));
    assert_eq!(
        store
            .check_attachment_revision(&legacy.id, token(&first))
            .unwrap_err(),
        "ATTACHMENT_CONFLICT"
    );
    assert!(store
        .check_attachment_revision(&legacy.id, token(&renamed))
        .is_ok());
    assert_eq!(
        store
            .agent_attachment_delete(&record.id, &legacy.id, token(&first))
            .unwrap_err(),
        "ATTACHMENT_CONFLICT"
    );
    let same_name = store.rename_attachment(&legacy.id, "passport").unwrap();
    assert_ne!(token(&same_name), token(&renamed));
    store
        .agent_attachment_delete(&record.id, &legacy.id, token(&same_name))
        .unwrap();
    assert_eq!(
        store
            .check_attachment_revision(&legacy.id, token(&same_name))
            .unwrap_err(),
        "ATTACHMENT_CONFLICT"
    );
    assert!(store.attachment_path(&legacy.id).is_err());
    assert!(store.attachment_preview(&legacy.id).is_err());
    assert!(store.agent_snapshot().unwrap().attachments.is_empty());
    let restored = store.restore_attachment(&legacy.id).unwrap();
    assert_ne!(token(&restored), token(&same_name));
    assert_eq!(
        store
            .agent_attachment_rename(&record.id, &legacy.id, token(&same_name), "stale")
            .unwrap_err(),
        "ATTACHMENT_CONFLICT"
    );
}

#[test]
fn backup_uses_the_original_attachment_shape_and_restore_assigns_fresh_revisions() {
    let (temp, store, record, attachment) = setup();
    let backup = temp.path().join("legacy-compatible.zip");
    store.export_backup(&backup).unwrap();
    let mut archive = zip::ZipArchive::new(File::open(&backup).unwrap()).unwrap();
    let mut manifest = String::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    let value: Value = serde_json::from_str(&manifest).unwrap();
    let keys: std::collections::BTreeSet<_> = value["attachments"][0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "id",
            "recordId",
            "originalName",
            "fileName",
            "relativePath",
            "size",
            "createdAt"
        ]
        .into_iter()
        .collect()
    );
    assert_eq!(value["schemaVersion"], 1);
    // The exported manifest has the old schema and exercises old-backup input.
    let restored = Store::open(temp.path().join("restored")).unwrap();
    restored.restore_backup(&backup).unwrap();
    let files = restored.agent_snapshot().unwrap().attachments;
    assert_eq!(files[0].metadata.id, attachment.metadata.id);
    assert_eq!(files[0].metadata.record_id, record.id);
    assert_ne!(token(&files[0]), token(&attachment));
    assert!(Uuid::parse_str(token(&files[0])).is_ok());
    assert_eq!(
        fs::read(&files[0].absolute_path).unwrap(),
        b"Original managed content"
    );
    assert_eq!(
        restored
            .agent_attachment_delete(&record.id, &attachment.metadata.id, token(&attachment))
            .unwrap_err(),
        "ATTACHMENT_CONFLICT"
    );
}

#[test]
fn replacement_preserves_identity_sources_previous_bytes_and_unrelated_content() {
    let (temp, store, record, attachment) = setup();
    let renamed = store
        .rename_attachment(&attachment.metadata.id, "passport")
        .unwrap();
    let source = temp.path().join("updated.PNG");
    fs::write(&source, b"Updated content").unwrap();
    let (replaced, previous) = store
        .agent_attachment_replace(
            &record.id,
            &attachment.metadata.id,
            token(&renamed),
            source.to_str().unwrap(),
        )
        .unwrap();
    assert_eq!(previous, renamed.absolute_path);
    assert_eq!(fs::read(&previous).unwrap(), b"Original managed content");
    assert_eq!(fs::read(&source).unwrap(), b"Updated content");
    assert_eq!(
        fs::read(&replaced.absolute_path).unwrap(),
        b"Updated content"
    );
    assert_eq!(replaced.metadata.id, attachment.metadata.id);
    assert_eq!(replaced.metadata.record_id, record.id);
    assert_eq!(replaced.metadata.created_at, attachment.metadata.created_at);
    assert_eq!(replaced.metadata.original_name, "updated.PNG");
    assert_eq!(replaced.metadata.size, 15);
    assert!(replaced
        .metadata
        .file_name
        .starts_with("identity_passport-"));
    assert!(replaced.metadata.file_name.ends_with(".png"));
    assert!(validate_relative_path(&replaced.metadata.relative_path).is_ok());
    assert_ne!(token(&replaced), token(&renamed));
    assert_eq!(
        serde_json::to_value(&store.agent_snapshot().unwrap().records[0]).unwrap(),
        serde_json::to_value(record.clone()).unwrap()
    );
    let same_source = replaced.absolute_path.clone();
    let (again, again_previous) = store
        .agent_attachment_replace(
            &record.id,
            &attachment.metadata.id,
            token(&replaced),
            &same_source,
        )
        .unwrap();
    assert_eq!(fs::read(&same_source).unwrap(), b"Updated content");
    assert_eq!(again_previous, same_source);
    assert_ne!(token(&again), token(&replaced));
    assert_ne!(
        again.metadata.relative_path,
        replaced.metadata.relative_path
    );
    assert_eq!(again.metadata.size, replaced.metadata.size);
    assert_eq!(store.agent_snapshot().unwrap().attachments.len(), 1);
}

#[test]
fn invalid_sources_and_database_failures_leave_the_active_attachment_unchanged() {
    let (temp, store, record, attachment) = setup();
    let source = temp.path().join("replacement.pdf");
    fs::write(&source, b"Replacement bytes").unwrap();
    let parent = Path::new(&attachment.absolute_path).parent().unwrap();
    let original_metadata = serde_json::to_value(&attachment).unwrap();
    for source in [temp.path().to_str().unwrap(), "relative.pdf"] {
        assert!(store
            .agent_attachment_replace(
                &record.id,
                &attachment.metadata.id,
                token(&attachment),
                source
            )
            .is_err());
    }
    store.connection().unwrap().execute_batch("CREATE TRIGGER fail_attachment_update BEFORE UPDATE ON attachments BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END;").unwrap();
    assert!(store
        .agent_attachment_replace(
            &record.id,
            &attachment.metadata.id,
            token(&attachment),
            source.to_str().unwrap()
        )
        .is_err());
    assert_eq!(
        serde_json::to_value(&store.agent_snapshot().unwrap().attachments[0]).unwrap(),
        original_metadata
    );
    assert_eq!(
        fs::read(&attachment.absolute_path).unwrap(),
        b"Original managed content"
    );
    assert_eq!(fs::read(&source).unwrap(), b"Replacement bytes");
    assert_eq!(fs::read_dir(parent).unwrap().count(), 1);
}

#[test]
fn old_names_are_not_overwritten_and_removed_or_wrong_record_ids_are_inaccessible() {
    let (temp, store, record, attachment) = setup();
    let renamed = store
        .rename_attachment(&attachment.metadata.id, "passport")
        .unwrap();
    let source = temp.path().join("replacement.pdf");
    fs::write(&source, b"Replacement bytes").unwrap();
    let (replaced, _) = store
        .agent_attachment_replace(
            &record.id,
            &attachment.metadata.id,
            token(&renamed),
            source.to_str().unwrap(),
        )
        .unwrap();
    assert!(store
        .agent_attachment_rename(
            &record.id,
            &attachment.metadata.id,
            token(&replaced),
            "passport"
        )
        .is_err());
    assert_eq!(
        fs::read(&renamed.absolute_path).unwrap(),
        b"Original managed content"
    );
    let other = store
        .agent_create(ProfileRecord {
            id: Uuid::new_v4().to_string(),
            ..record.clone()
        })
        .unwrap();
    assert_eq!(
        store
            .agent_attachment_delete(&other.id, &attachment.metadata.id, token(&replaced))
            .unwrap_err(),
        "ATTACHMENT_NOT_FOUND"
    );
    store
        .agent_attachment_delete(&record.id, &attachment.metadata.id, token(&replaced))
        .unwrap();
    assert_eq!(
        store
            .agent_attachment_replace(
                &record.id,
                &attachment.metadata.id,
                token(&replaced),
                source.to_str().unwrap()
            )
            .unwrap_err(),
        "ATTACHMENT_NOT_FOUND"
    );
    assert_eq!(
        store
            .agent_attachment_rename(
                &record.id,
                &attachment.metadata.id,
                token(&replaced),
                "removed"
            )
            .unwrap_err(),
        "ATTACHMENT_NOT_FOUND"
    );
    assert!(store.attachment_path(&attachment.metadata.id).is_err());
    assert!(store.attachment_preview(&attachment.metadata.id).is_err());
    assert_eq!(
        fs::read(&replaced.absolute_path).unwrap(),
        b"Replacement bytes"
    );
    assert_eq!(fs::read(&source).unwrap(), b"Replacement bytes");
}
