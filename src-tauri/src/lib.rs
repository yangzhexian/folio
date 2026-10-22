mod model;
mod storage;

use model::{Attachment, ProfileRecord, Result, Snapshot};
use std::path::PathBuf;
use std::sync::Mutex;
use storage::{display_path, Store};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

struct AppState(Mutex<Store>);

fn with_store<T>(
    state: &State<'_, AppState>,
    action: impl FnOnce(&Store) -> Result<T>,
) -> Result<T> {
    let store = state
        .0
        .lock()
        .map_err(|_| "The local vault is busy. Restart Folio to continue.".to_owned())?;
    action(&store)
}

fn localized(locale: &Option<String>, en: &str, zh: &str) -> String {
    if locale.as_deref() == Some("zh") {
        zh.to_owned()
    } else {
        en.to_owned()
    }
}

#[tauri::command]
fn load_snapshot(state: State<'_, AppState>) -> Result<Snapshot> {
    with_store(&state, Store::snapshot)
}

#[tauri::command]
fn save_record(state: State<'_, AppState>, record: ProfileRecord) -> Result<ProfileRecord> {
    with_store(&state, |store| store.save_record(record))
}

#[tauri::command]
fn delete_record(state: State<'_, AppState>, id: String) -> Result<()> {
    with_store(&state, |store| store.delete_record(&id))
}

#[tauri::command]
async fn import_attachments(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    record_id: String,
    locale: Option<String>,
) -> Result<Vec<Attachment>> {
    let title = localized(&locale, "Add files to Folio", "添加文件到 Folio");
    let paths = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(title).blocking_pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };
    let paths: Vec<PathBuf> = paths
        .into_iter()
        .map(|path| path.into_path().map_err(|e| e.to_string()))
        .collect::<Result<_>>()?;
    with_store(&state, |store| store.import_files(&record_id, &paths))
}

#[tauri::command]
fn rename_attachment(state: State<'_, AppState>, id: String, name: String) -> Result<Attachment> {
    with_store(&state, |store| store.rename_attachment(&id, &name))
}

#[tauri::command]
fn remove_attachment(state: State<'_, AppState>, id: String) -> Result<()> {
    with_store(&state, |store| store.remove_attachment(&id))
}

#[tauri::command]
fn restore_attachment(state: State<'_, AppState>, id: String) -> Result<Attachment> {
    with_store(&state, |store| store.restore_attachment(&id))
}

#[tauri::command]
fn attachment_path(state: State<'_, AppState>, id: String) -> Result<String> {
    with_store(&state, |store| {
        store.attachment_path(&id).map(|path| display_path(&path))
    })
}

#[tauri::command]
fn reveal_attachment(state: State<'_, AppState>, id: String) -> Result<()> {
    with_store(&state, |store| {
        let path = store.attachment_path(&id)?;
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn open_data_dir(state: State<'_, AppState>) -> Result<()> {
    with_store(&state, |store| {
        tauri_plugin_opener::open_path(display_path(store.root()), None::<&str>)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
async fn export_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    locale: Option<String>,
) -> Result<Option<String>> {
    let title = localized(&locale, "Export Folio backup", "导出 Folio 备份");
    let filename = format!(
        "folio-backup-{}.zip",
        chrono::Local::now().format("%Y-%m-%d-%H%M%S")
    );
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .set_file_name(filename)
            .add_filter("Folio backup", &["zip"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Ok(None);
    };
    let mut path = path.into_path().map_err(|e| e.to_string())?;
    if path.extension().is_none() {
        path.set_extension("zip");
    }
    with_store(&state, |store| store.export_backup(&path))?;
    Ok(Some(display_path(&path)))
}

#[tauri::command]
async fn restore_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    locale: Option<String>,
) -> Result<bool> {
    let title = localized(&locale, "Restore Folio backup", "恢复 Folio 备份");
    let path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .add_filter("Folio backup", &["zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    with_store(&state, |store| store.restore_backup(&path))?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            let store = Store::open(root).map_err(std::io::Error::other)?;
            app.manage(AppState(Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            save_record,
            delete_record,
            import_attachments,
            rename_attachment,
            remove_attachment,
            restore_attachment,
            attachment_path,
            reveal_attachment,
            open_data_dir,
            export_backup,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Folio");
}
