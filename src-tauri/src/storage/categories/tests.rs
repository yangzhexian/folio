use super::*;
use serde_json::{json, Value};
use tempfile::TempDir;

fn custom() -> CategoryDefinition {
    CategoryDefinition {
        id: format!("collection-{}", Uuid::new_v4()),
        name_en: "Travel".into(),
        name_zh: "旅行".into(),
        icon: "plane".into(),
    }
}

fn record(category: &str) -> ProfileRecord {
    ProfileRecord {
        id: Uuid::new_v4().to_string(),
        category: category.into(),
        title: "Synthetic category record".into(),
        subtitle: String::new(),
        tags: vec![],
        favorite: false,
        fields: vec![],
        notes: String::new(),
        created_at: now(),
        updated_at: now(),
    }
}

fn add_category(store: &Store) -> CategoryCatalog {
    let mut categories = builtin_categories();
    categories.insert(0, custom());
    store.save_categories(categories, "builtin-v1").unwrap()
}

fn manifest(path: &Path) -> Value {
    let mut zip = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
    serde_json::from_reader(zip.by_name("manifest.json").unwrap()).unwrap()
}

fn write_manifest(path: &Path, value: &Value) {
    let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(&serde_json::to_vec(value).unwrap()).unwrap();
    zip.finish().unwrap();
}

#[test]
fn default_and_legacy_catalog_reads_do_not_write_database() {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    assert_eq!(store.agent_categories().unwrap(), builtin_catalog());
    let db = store.connection().unwrap();
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM category_catalog", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
    db.execute("DROP TABLE category_catalog", []).unwrap();
    drop(db);
    let before = fs::read(store.vault().join("folio.sqlite3")).unwrap();
    let legacy = Store::agent_existing(store.root.clone()).unwrap();
    assert_eq!(legacy.agent_categories().unwrap(), builtin_catalog());
    let snapshot = legacy.agent_snapshot().unwrap();
    assert_eq!(snapshot.categories, builtin_categories());
    assert_eq!(snapshot.categories_revision, "builtin-v1");
    assert_eq!(
        before,
        fs::read(store.vault().join("folio.sqlite3")).unwrap()
    );
}

#[test]
fn categories_persist_normalize_reorder_and_reject_stale_or_removed_ids() {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    let mut values = builtin_categories();
    values[0].name_en = "  Personal details  ".into();
    values[0].name_zh = " 个人资料 ".into();
    values[0].icon = "shield".into();
    values.insert(0, custom());
    let first = store.save_categories(values, "builtin-v1").unwrap();
    assert_eq!(first.categories[1].name_en, "Personal details");
    assert_eq!(first.categories[1].name_zh, "个人资料");
    assert_ne!(first.revision, "builtin-v1");
    let reopened = Store::open(store.root.clone()).unwrap();
    assert_eq!(reopened.agent_categories().unwrap(), first);
    let mut reordered = first.categories.clone();
    reordered.reverse();
    let second = store.save_categories(reordered, &first.revision).unwrap();
    assert_ne!(second.revision, first.revision);
    assert_eq!(
        store
            .save_categories(first.categories.clone(), &first.revision)
            .unwrap_err(),
        "CATEGORY_CONFLICT"
    );
    assert_eq!(
        store
            .save_categories(builtin_categories(), &second.revision)
            .unwrap_err(),
        "INVALID_CATEGORIES"
    );
    assert_eq!(store.agent_categories().unwrap(), second);
    assert_eq!(store.snapshot().unwrap().categories, second.categories);
}

#[test]
fn concurrent_catalog_saves_allow_only_one_writer_for_the_expected_revision() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("data");
    Store::open(root.clone()).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let writers: Vec<_> = ["First catalog", "Second catalog"]
        .into_iter()
        .map(|name| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let store = Store::agent_existing(root).unwrap();
                let mut categories = builtin_categories();
                categories[0].name_en = name.into();
                barrier.wait();
                store.save_categories(categories, "builtin-v1")
            })
        })
        .collect();
    let results: Vec<_> = writers
        .into_iter()
        .map(|writer| writer.join().unwrap())
        .collect();
    let winner = results
        .iter()
        .find_map(|result| result.as_ref().ok())
        .unwrap();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .find_map(|result| result.as_ref().err())
            .unwrap(),
        "CATEGORY_CONFLICT"
    );
    assert_eq!(
        Store::agent_existing(root)
            .unwrap()
            .agent_categories()
            .unwrap(),
        *winner
    );
}

#[test]
fn catalog_validation_rejects_unsafe_ids_icons_names_duplicates_and_limits() {
    let initial = builtin_categories();
    let mut invalid = Vec::new();
    let mut values = initial.clone();
    values.remove(0);
    invalid.push(values);
    for name in ["", "  ", "line\nbreak", &"x".repeat(61)] {
        let mut values = initial.clone();
        values[0].name_en = name.into();
        invalid.push(values);
    }
    let mut values = initial.clone();
    values[0].name_en = " education ".into();
    invalid.push(values);
    let mut values = initial.clone();
    values[0].name_zh = "教育经历".into();
    invalid.push(values);
    let mut values = initial.clone();
    values[0].icon = "https://example.invalid/icon.svg".into();
    invalid.push(values);
    let mut values = initial.clone();
    values.push(values[0].clone());
    invalid.push(values);
    for id in [
        "../escape",
        "collection-../escape",
        "collection-00000000-0000-4000-8000-00000000000A",
        "new-category",
    ] {
        let mut value = custom();
        value.id = id.into();
        let mut values = initial.clone();
        values.push(value);
        invalid.push(values);
    }
    let mut too_many = initial.clone();
    for index in 0..92 {
        let mut value = custom();
        value.name_en = format!("Category {index}");
        value.name_zh = format!("分类 {index}");
        too_many.push(value);
    }
    invalid.push(too_many);
    for values in invalid {
        assert_eq!(
            normalize_categories(values).unwrap_err(),
            "INVALID_CATEGORIES"
        );
    }
    let mut valid = initial;
    valid[0].name_en = "字".repeat(60);
    assert!(normalize_categories(valid).is_ok());
}

#[test]
fn record_membership_is_checked_in_every_write_and_attachment_prefix_stays_stable() {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    let unknown = custom().id;
    assert_eq!(
        store.save_record(record(&unknown)).unwrap_err(),
        "UNKNOWN_CATEGORY"
    );
    assert_eq!(
        store.agent_create(record(&unknown)).unwrap_err(),
        "UNKNOWN_CATEGORY"
    );
    let catalog = add_category(&store);
    let id = &catalog.categories[0].id;
    let mut saved = store.agent_create(record(id)).unwrap();
    saved.title = "Updated synthetic record".into();
    saved = store
        .agent_update(saved.clone(), &saved.updated_at)
        .unwrap();
    let mut invalid = saved.clone();
    invalid.category = unknown;
    assert_eq!(
        store
            .agent_update(invalid.clone(), &saved.updated_at)
            .unwrap_err(),
        "UNKNOWN_CATEGORY"
    );
    assert_eq!(store.save_record(invalid).unwrap_err(), "UNKNOWN_CATEGORY");
    let source = temp.path().join("example.txt");
    fs::write(&source, b"synthetic bytes").unwrap();
    let file = store
        .import_files(&saved.id, &[source.clone()])
        .unwrap()
        .remove(0);
    assert!(file.metadata.file_name.starts_with(&format!("{id}_")));
    assert!(file.metadata.file_name.ends_with(".txt"));
    let mut renamed = catalog.categories.clone();
    renamed[0].name_en = "Trips".into();
    renamed[0].name_zh = "出行".into();
    store.save_categories(renamed, &catalog.revision).unwrap();
    let snapshot = store.snapshot().unwrap();
    assert_eq!(snapshot.records[0].category, *id);
    assert_eq!(
        snapshot.attachments[0].metadata.relative_path,
        file.metadata.relative_path
    );
    assert_eq!(fs::read(&file.absolute_path).unwrap(), b"synthetic bytes");
    assert_eq!(fs::read(source).unwrap(), b"synthetic bytes");
}

#[test]
fn customized_backup_round_trip_preserves_catalog_records_and_files() {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    let catalog = add_category(&store);
    let record = store
        .save_record(record(&catalog.categories[0].id))
        .unwrap();
    let source = temp.path().join("example.txt");
    fs::write(&source, b"backup bytes").unwrap();
    let imported = store.import_files(&record.id, &[source]).unwrap().remove(0);
    let backup = temp.path().join("backup.zip");
    store.export_backup(&backup).unwrap();
    let exported = manifest(&backup);
    assert_eq!(exported["schemaVersion"], 2);
    assert_eq!(
        exported["categories"],
        serde_json::to_value(&catalog.categories).unwrap()
    );
    assert!(exported.get("categoriesRevision").is_none());
    assert!(exported["attachments"][0].get("revision").is_none());
    let restored = Store::open(temp.path().join("restored")).unwrap();
    restored.restore_backup(&backup).unwrap();
    let snapshot = restored.snapshot().unwrap();
    assert_eq!(snapshot.categories, catalog.categories);
    assert_ne!(snapshot.categories_revision, catalog.revision);
    assert_eq!(snapshot.records[0].category, catalog.categories[0].id);
    assert_eq!(snapshot.attachments[0].metadata.id, imported.metadata.id);
    assert_eq!(
        fs::read(&snapshot.attachments[0].absolute_path).unwrap(),
        b"backup bytes"
    );
}

#[test]
fn legacy_backups_keep_old_shape_and_restore_defaults_with_fresh_revision() {
    let temp = TempDir::new().unwrap();
    let source = Store::open(temp.path().join("source")).unwrap();
    source.save_record(record("identity")).unwrap();
    let backup = temp.path().join("legacy.zip");
    source.export_backup(&backup).unwrap();
    let value = manifest(&backup);
    assert_eq!(value["schemaVersion"], 1);
    assert!(value.get("categories").is_none());
    assert_eq!(value.as_object().unwrap().len(), 4);
    let target = Store::open(temp.path().join("target")).unwrap();
    let catalog = add_category(&target);
    target.restore_backup(&backup).unwrap();
    let restored = target.snapshot().unwrap();
    assert_eq!(restored.categories, builtin_categories());
    assert_ne!(restored.categories_revision, "builtin-v1");
    assert_ne!(restored.categories_revision, catalog.revision);
    assert_eq!(
        target
            .save_categories(catalog.categories, &catalog.revision)
            .unwrap_err(),
        "CATEGORY_CONFLICT"
    );
}

#[test]
fn invalid_catalog_or_missing_membership_backup_never_replaces_live_vault() {
    let temp = TempDir::new().unwrap();
    let store = Store::open(temp.path().join("data")).unwrap();
    let saved = store.save_record(record("identity")).unwrap();
    let before = fs::read(store.vault().join("folio.sqlite3")).unwrap();
    let path = temp.path().join("bad.zip");
    let unknown = record(&custom().id);
    let base = json!({"schemaVersion":2,"createdAt":now(),"categories":builtin_categories(),"records":[unknown],"attachments":[]});
    let mut missing = base.clone();
    missing.as_object_mut().unwrap().remove("categories");
    let mut wrong_version = base.clone();
    wrong_version["schemaVersion"] = 1.into();
    let mut duplicate = base.clone();
    duplicate["records"] = json!([]);
    duplicate["categories"][0]["nameEn"] = "education".into();
    for value in [base, missing, wrong_version, duplicate] {
        write_manifest(&path, &value);
        assert!(store.restore_backup(&path).is_err());
        assert_eq!(
            fs::read(store.vault().join("folio.sqlite3")).unwrap(),
            before
        );
        assert_eq!(store.snapshot().unwrap().records[0].id, saved.id);
    }
}

#[test]
fn migration_copies_custom_catalog_without_changing_source_library() {
    let temp = TempDir::new().unwrap();
    let legacy_root = temp.path().join("legacy");
    let legacy = Store::open(legacy_root.clone()).unwrap();
    let catalog = add_category(&legacy);
    legacy
        .save_record(record(&catalog.categories[0].id))
        .unwrap();
    let before = fs::read(legacy.vault().join("folio.sqlite3")).unwrap();
    let migrated = Store::open_installed(temp.path().join("installed"), &legacy_root).unwrap();
    assert_eq!(migrated.agent_categories().unwrap(), catalog);
    assert_eq!(
        migrated.snapshot().unwrap().records[0].category,
        catalog.categories[0].id
    );
    assert_eq!(
        fs::read(legacy.vault().join("folio.sqlite3")).unwrap(),
        before
    );
}

#[test]
fn migration_rejects_unregistered_record_references_without_publishing_or_changing_source() {
    let temp = TempDir::new().unwrap();
    let legacy_root = temp.path().join("legacy");
    let legacy = Store::open(legacy_root.clone()).unwrap();
    let orphan = record(&custom().id);
    legacy
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO records(id,body) VALUES(?1,?2)",
            params![orphan.id, serde_json::to_string(&orphan).unwrap()],
        )
        .unwrap();
    let before = fs::read(legacy.vault().join("folio.sqlite3")).unwrap();
    let destination = temp.path().join("installed");
    assert!(Store::open_installed(destination.clone(), &legacy_root).is_err());
    assert!(!destination.join("vault").exists());
    assert_eq!(
        fs::read(legacy.vault().join("folio.sqlite3")).unwrap(),
        before
    );
    assert_eq!(legacy.agent_snapshot().unwrap_err(), "UNKNOWN_CATEGORY");
}
