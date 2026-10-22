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

async fn with_blocking_store<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce(&Store) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_store(&state, action)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn localized(locale: &Option<String>, en: &str, zh: &str) -> String {
    if locale.as_deref() == Some("zh") {
        zh.to_owned()
    } else {
        en.to_owned()
    }
}

#[tauri::command]
async fn load_snapshot(app: tauri::AppHandle) -> Result<Snapshot> {
    with_blocking_store(app, Store::snapshot).await
}

#[tauri::command]
async fn save_record(app: tauri::AppHandle, record: ProfileRecord) -> Result<ProfileRecord> {
    with_blocking_store(app, move |store| store.save_record(record)).await
}

#[tauri::command]
async fn delete_record(app: tauri::AppHandle, id: String) -> Result<()> {
    with_blocking_store(app, move |store| store.delete_record(&id)).await
}

#[tauri::command]
async fn import_attachments(
    app: tauri::AppHandle,
    record_id: String,
    locale: Option<String>,
) -> Result<Vec<Attachment>> {
    let title = localized(&locale, "Add files to Folio", "添加文件到 Folio");
    let picker_app = app.clone();
    let paths = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = picker_app.dialog().file().set_title(title);
        if let Ok(directory) = picker_app.path().document_dir() {
            dialog = dialog.set_directory(directory);
        }
        dialog.blocking_pick_files()
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
    with_blocking_store(app, move |store| store.import_files(&record_id, &paths)).await
}

#[tauri::command]
async fn import_dropped_attachments(
    app: tauri::AppHandle,
    record_id: String,
    paths: Vec<String>,
) -> Result<Vec<Attachment>> {
    with_blocking_store(app, move |store| {
        store.import_dropped_files(&record_id, &paths)
    })
    .await
}

#[tauri::command]
async fn rename_attachment(app: tauri::AppHandle, id: String, name: String) -> Result<Attachment> {
    with_blocking_store(app, move |store| store.rename_attachment(&id, &name)).await
}

#[tauri::command]
async fn remove_attachment(app: tauri::AppHandle, id: String) -> Result<()> {
    with_blocking_store(app, move |store| store.remove_attachment(&id)).await
}

#[tauri::command]
async fn restore_attachment(app: tauri::AppHandle, id: String) -> Result<Attachment> {
    with_blocking_store(app, move |store| store.restore_attachment(&id)).await
}

#[tauri::command]
async fn attachment_path(app: tauri::AppHandle, id: String) -> Result<String> {
    with_blocking_store(app, move |store| {
        store.attachment_path(&id).map(|path| display_path(&path))
    })
    .await
}

#[tauri::command]
async fn reveal_attachment(app: tauri::AppHandle, id: String) -> Result<()> {
    let path = with_blocking_store(app, move |store| store.attachment_path(&id)).await?;
    // Shell COM work must run off the UI thread, with no vault lock held.
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_data_dir(app: tauri::AppHandle) -> Result<()> {
    let path = with_blocking_store(app, |store| Ok(display_path(store.root()))).await?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn export_backup(app: tauri::AppHandle, locale: Option<String>) -> Result<Option<String>> {
    let title = localized(&locale, "Export Folio backup", "导出 Folio 备份");
    let filename = format!(
        "folio-backup-{}.zip",
        chrono::Local::now().format("%Y-%m-%d-%H%M%S")
    );
    let picker_app = app.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = picker_app.dialog().file().set_title(title);
        if let Ok(directory) = picker_app.path().document_dir() {
            dialog = dialog.set_directory(directory);
        }
        dialog
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
    let output_path = display_path(&path);
    with_blocking_store(app, move |store| store.export_backup(&path)).await?;
    Ok(Some(output_path))
}

#[tauri::command]
async fn restore_backup(app: tauri::AppHandle, locale: Option<String>) -> Result<bool> {
    let title = localized(&locale, "Restore Folio backup", "恢复 Folio 备份");
    let picker_app = app.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = picker_app.dialog().file().set_title(title);
        if let Ok(directory) = picker_app.path().document_dir() {
            dialog = dialog.set_directory(directory);
        }
        dialog
            .add_filter("Folio backup", &["zip"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    with_blocking_store(app, move |store| store.restore_backup(&path)).await?;
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
            import_dropped_attachments,
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
