use super::*;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

fn input() -> Value {
    json!({"id": "00000000-0000-4000-8000-000000000101", "category": "identity", "title": "Synthetic CLI record", "fields": [{"id": "name", "label": "Name", "labelZh": "姓名", "value": "Example Person", "kind": "text", "sensitive": false}]})
}

fn run(root: &Path, options: &[&str], input: &Value) -> CliResult<Value> {
    let args = arguments(
        options.iter().map(OsString::from).collect(),
        root.to_path_buf(),
    )?;
    execute(args, &mut input.to_string().as_bytes())
}

#[test]
fn validation_info_schema_and_missing_reads_do_not_initialize_a_vault() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("not-created");
    assert_eq!(
        run(&root, &["info"], &Value::Null).unwrap()["data"]["libraryExists"],
        false
    );
    assert_eq!(
        run(&root, &["schema"], &Value::Null).unwrap()["data"]["schemaVersion"],
        1
    );
    assert_eq!(
        run(&root, &["validate", "--input", "-"], &input()).unwrap()["data"]["valid"],
        true
    );
    assert_eq!(
        run(&root, &["list"], &Value::Null).unwrap_err().code,
        "LIBRARY_NOT_FOUND"
    );
    assert!(!root.exists());
}

#[test]
fn create_is_non_destructive_and_reports_duplicate_or_deleted_ids() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("data");
    let created = run(&root, &["create", "--input", "-"], &input()).unwrap();
    assert_eq!(created["data"]["record"]["fields"][0]["labelZh"], "姓名");
    let mut changed = input();
    changed["title"] = "Unexpected overwrite".into();
    assert_eq!(
        run(&root, &["create", "--input", "-"], &changed)
            .unwrap_err()
            .code,
        "RECORD_EXISTS"
    );
    let summary = run(&root, &["list"], &Value::Null).unwrap();
    assert_eq!(summary["data"]["records"].as_array().unwrap().len(), 1);
    assert_eq!(
        summary["data"]["records"][0]["title"],
        "Synthetic CLI record"
    );
    assert!(summary["data"]["records"][0].get("fields").is_none());
    Store::agent_existing(root.clone())
        .unwrap()
        .delete_record(input()["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        run(&root, &["create", "--input", "-"], &input())
            .unwrap_err()
            .code,
        "RECORD_EXISTS"
    );
}

#[test]
fn updates_are_revision_checked_and_timestamp_changes_cannot_be_spoofed() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("data");
    let created =
        run(&root, &["create", "--input", "-"], &input()).unwrap()["data"]["record"].clone();
    let old = created["updatedAt"].as_str().unwrap();
    let mut changed = created.clone();
    changed["title"] = "Updated".into();
    changed["createdAt"] = "2000-01-01T00:00:00Z".into();
    let saved = run(
        &root,
        &["update", "--input", "-", "--expected-updated-at", old],
        &changed,
    )
    .unwrap()["data"]["record"]
        .clone();
    assert_eq!(saved["createdAt"], created["createdAt"]);
    assert_ne!(saved["updatedAt"], created["updatedAt"]);
    assert_eq!(saved["fields"], created["fields"]);
    assert_eq!(
        run(
            &root,
            &["update", "--input", "-", "--expected-updated-at", old],
            &changed
        )
        .unwrap_err()
        .code,
        "RECORD_CONFLICT"
    );
    let store = Store::agent_existing(root).unwrap();
    assert_eq!(
        store
            .save_record(serde_json::from_value(created).unwrap())
            .unwrap_err(),
        "RECORD_CONFLICT"
    );
    let next = store
        .save_record(serde_json::from_value(saved.clone()).unwrap())
        .unwrap();
    assert_ne!(next.updated_at, saved["updatedAt"].as_str().unwrap());
}

#[test]
fn active_reads_preserve_database_bytes_and_return_associated_attachments() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("data");
    run(&root, &["create", "--input", "-"], &input()).unwrap();
    let source = temp.path().join("source.txt");
    fs::write(&source, "Synthetic attachment").unwrap();
    let imported = run(
        &root,
        &[
            "attach",
            "--record-id",
            input()["id"].as_str().unwrap(),
            "--input",
            "-",
        ],
        &json!([source]),
    )
    .unwrap();
    assert_eq!(imported["data"]["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(fs::read(&source).unwrap(), b"Synthetic attachment");
    let before = fs::read(root.join("vault/folio.sqlite3")).unwrap();
    let result = run(
        &root,
        &["get", "--id", input()["id"].as_str().unwrap()],
        &Value::Null,
    )
    .unwrap();
    assert_eq!(result["data"]["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(
        result["data"]["record"]["fields"][0]["value"],
        "Example Person"
    );
    assert_eq!(fs::read(root.join("vault/folio.sqlite3")).unwrap(), before);
    assert!(run(
        &root,
        &[
            "attach",
            "--record-id",
            input()["id"].as_str().unwrap(),
            "--input",
            "-"
        ],
        &json!([source, temp.path()])
    )
    .is_err());
    assert_eq!(
        run(
            &root,
            &["get", "--id", input()["id"].as_str().unwrap()],
            &Value::Null
        )
        .unwrap()["data"]["attachments"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn malformed_commands_and_inputs_fail_before_mutating_storage() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("absent");
    for options in [
        vec!["update", "--input", "-"],
        vec!["list", "--id", "x"],
        vec!["create", "--input", "-", "--input", "-"],
        vec!["info", "--data-dir", "relative"],
    ] {
        assert!(run(&root, &options, &input()).is_err());
    }
    let mut invalid = input();
    invalid["unexpected"] = true.into();
    assert_eq!(
        run(&root, &["create", "--input", "-"], &invalid)
            .unwrap_err()
            .code,
        "INVALID_JSON"
    );
    invalid = input();
    invalid["fields"][0]["id"] = "".into();
    assert_eq!(
        run(&root, &["create", "--input", "-"], &invalid)
            .unwrap_err()
            .code,
        "INVALID_RECORD"
    );
    assert!(!root.exists());
}

#[test]
fn a_data_directory_cannot_be_a_regular_file() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("source.txt");
    fs::write(&path, "Preserve this source").unwrap();
    assert_eq!(
        run(&path, &["info"], &Value::Null).unwrap_err().code,
        "INVALID_ARGUMENT"
    );
    assert_eq!(fs::read_to_string(path).unwrap(), "Preserve this source");
}

#[cfg(windows)]
#[test]
fn windows_data_directory_rejects_network_device_and_alternate_stream_paths() {
    for path in [
        r"\\server\share\data",
        r"\\?\UNC\server\share\data",
        r"\\.\C:\data",
        r"C:\data:stream",
    ] {
        assert_eq!(
            run(Path::new(path), &["info"], &Value::Null)
                .unwrap_err()
                .code,
            "INVALID_ARGUMENT"
        );
    }
}

#[test]
fn input_reader_accepts_utf8_bom_and_caps_actual_stream_length() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("absent");
    let args = arguments(
        vec!["validate".into(), "--input".into(), "-".into()],
        root.clone(),
    )
    .unwrap();
    let mut with_bom = b"\xef\xbb\xbf".to_vec();
    with_bom.extend_from_slice(input().to_string().as_bytes());
    assert!(execute(args, &mut with_bom.as_slice()).is_ok());
    let args = arguments(vec!["validate".into(), "--input".into(), "-".into()], root).unwrap();
    assert_eq!(
        execute(args, &mut std::io::repeat(b' ').take(MAX_INPUT_BYTES + 1))
            .unwrap_err()
            .code,
        "INPUT_TOO_LARGE"
    );
}

#[test]
fn concurrent_creates_share_operation_guard_and_never_overwrite() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("data");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let mut threads = Vec::new();
    for _ in 0..2 {
        let root = root.clone();
        let barrier = barrier.clone();
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            run(&root, &["create", "--input", "-"], &input())
        }));
    }
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .find_map(|result| result.as_ref().err())
            .unwrap()
            .code,
        "RECORD_EXISTS"
    );
}

#[test]
fn operation_lock_survives_vault_directory_replacement() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("data");
    let first = operation_lock(&root, true).unwrap();
    fs::create_dir(root.join("vault")).unwrap();
    fs::rename(root.join("vault"), root.join("previous-test")).unwrap();
    fs::create_dir(root.join("vault")).unwrap();
    let other = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.join(".folio-operation.lock"))
        .unwrap();
    assert!(matches!(
        other.try_lock(),
        Err(std::fs::TryLockError::WouldBlock)
    ));
    drop(first);
    assert!(other.try_lock().is_ok());
}
