use crate::{
    model::{validate_id, Attachment, Result},
    with_blocking_store,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "attachment-preview";
const SESSION_EVENT: &str = "folio:preview-session";

#[derive(Clone, Default)]
struct Selection {
    revision: u64,
    id: String,
    ids: Vec<String>,
}

#[derive(Default)]
pub struct PreviewWindowState {
    selection: Mutex<Selection>,
    creating: AtomicBool,
    main_closed: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSession {
    revision: u64,
    id: String,
    files: Vec<Attachment>,
    pinned: bool,
}

fn require_window(label: &str, expected: &str) -> Result<()> {
    if label == expected {
        Ok(())
    } else {
        Err("PREVIEW_UNAVAILABLE".into())
    }
}

fn is_preview_route(url: &tauri::Url, trusted: &tauri::Url) -> bool {
    // Compare the protocol tuple explicitly: tauri:// URLs have opaque URL origins on Unix.
    url.scheme() == trusted.scheme()
        && url.host_str() == trusted.host_str()
        && url.port_or_known_default() == trusted.port_or_known_default()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.path(), "/" | "/index.html")
        && url.query() == Some("view=preview")
}

fn validate_selection(id: &str, ids: Vec<String>) -> Result<Vec<String>> {
    if ids.is_empty() || ids.len() > 10_000 {
        return Err("PREVIEW_UNAVAILABLE".into());
    }
    validate_id(id).map_err(|_| "PREVIEW_UNAVAILABLE".to_owned())?;
    let mut seen = HashSet::new();
    let mut unique = Vec::with_capacity(ids.len());
    for candidate in ids {
        validate_id(&candidate).map_err(|_| "PREVIEW_UNAVAILABLE".to_owned())?;
        if seen.insert(candidate.clone()) {
            unique.push(candidate);
        }
    }
    if !seen.contains(id) {
        return Err("PREVIEW_UNAVAILABLE".into());
    }
    Ok(unique)
}

#[tauri::command]
pub async fn open_preview_window(
    app: tauri::AppHandle,
    window: WebviewWindow,
    id: String,
    ids: Vec<String>,
) -> Result<bool> {
    require_window(window.label(), "main")?;
    let ids = validate_selection(&id, ids)?;
    let files = with_blocking_store(app.clone(), move |store| {
        store.preview_window_attachments(&ids)
    })
    .await?;
    if !files.iter().any(|file| file.metadata.id == id) {
        return Err("PREVIEW_UNAVAILABLE".into());
    }
    let state = app.state::<PreviewWindowState>();
    if state.main_closed.load(Ordering::SeqCst) {
        return Err("PREVIEW_UNAVAILABLE".into());
    }
    {
        let mut selection = state
            .selection
            .lock()
            .map_err(|_| "PREVIEW_UNAVAILABLE".to_owned())?;
        selection.revision = selection.revision.wrapping_add(1);
        selection.id = id;
        selection.ids = files.into_iter().map(|file| file.metadata.id).collect();
    }
    if let Some(preview) = app.get_webview_window(LABEL) {
        preview
            .emit(SESSION_EVENT, ())
            .map_err(|error| error.to_string())?;
        preview.unminimize().map_err(|error| error.to_string())?;
        preview.show().map_err(|error| error.to_string())?;
        preview.set_focus().map_err(|error| error.to_string())?;
        return Ok(true);
    }
    // Concurrent clicks update the shared selection; only one native window is created.
    let trusted_url = window.url().map_err(|error| error.to_string())?;
    if state.creating.swap(true, Ordering::SeqCst) {
        return Ok(true);
    }
    let built = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App("index.html?view=preview".into()),
    )
    .title("Folio - Preview")
    .inner_size(1000.0, 760.0)
    .min_inner_size(600.0, 420.0)
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .decorations(true)
    .always_on_top(false)
    .theme(window.theme().ok())
    .center()
    .disable_drag_drop_handler()
    .on_navigation(move |url| is_preview_route(url, &trusted_url))
    .build();
    state.creating.store(false, Ordering::SeqCst);
    let preview = built.map_err(|error| error.to_string())?;
    if state.main_closed.load(Ordering::SeqCst) {
        let _ = preview.destroy();
        return Err("PREVIEW_UNAVAILABLE".into());
    }
    Ok(true)
}

#[tauri::command]
pub async fn load_preview_session(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<PreviewSession> {
    require_window(window.label(), LABEL)?;
    let selection = app
        .state::<PreviewWindowState>()
        .selection
        .lock()
        .map_err(|_| "PREVIEW_UNAVAILABLE".to_owned())?
        .clone();
    let files = with_blocking_store(app, move |store| {
        store.preview_window_attachments(&selection.ids)
    })
    .await?;
    Ok(PreviewSession {
        revision: selection.revision,
        id: selection.id,
        files,
        pinned: window
            .is_always_on_top()
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub fn set_preview_pinned(window: WebviewWindow, pinned: bool) -> Result<bool> {
    require_window(window.label(), LABEL)?;
    window
        .set_always_on_top(pinned)
        .map_err(|error| error.to_string())?;
    Ok(pinned)
}

/// Wait for actual main-window destruction: a cancelled unsaved-edit close must keep the preview alive.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
        if let Some(state) = window.app_handle().try_state::<PreviewWindowState>() {
            state.main_closed.store(true, Ordering::SeqCst);
        }
        if let Some(preview) = window.app_handle().get_webview_window(LABEL) {
            let _ = preview.destroy();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_requires_canonical_ids_and_deduplicates_without_reordering() {
        let first = "00000000-0000-4000-8000-000000000001".to_owned();
        let second = "00000000-0000-4000-8000-000000000002".to_owned();
        assert_eq!(
            validate_selection(&first, vec![second.clone(), first.clone(), second.clone()])
                .unwrap(),
            vec![second, first.clone()]
        );
        assert!(validate_selection(&first, vec![]).is_err());
        assert!(validate_selection(&first, vec!["../file.pdf".into()]).is_err());
        assert!(validate_selection("00000000-0000-4000-8000-000000000003", vec![first]).is_err());
    }
    #[test]
    fn preview_commands_reject_other_window_labels() {
        assert!(require_window("main", LABEL).is_err());
        assert!(require_window(LABEL, "main").is_err());
        assert!(require_window(LABEL, LABEL).is_ok());
    }

    #[test]
    fn navigation_is_limited_to_the_fixed_local_preview_route() {
        for base in [
            "http://tauri.localhost/",
            "tauri://localhost/",
            "http://localhost:1420/",
        ] {
            let trusted = tauri::Url::parse(base).unwrap();
            assert!(is_preview_route(
                &trusted.join("index.html?view=preview").unwrap(),
                &trusted
            ));
            assert!(!is_preview_route(
                &trusted
                    .join("index.html?view=preview&path=private.pdf")
                    .unwrap(),
                &trusted
            ));
            assert!(!is_preview_route(
                &trusted.join("index.html").unwrap(),
                &trusted
            ));
            assert!(!is_preview_route(
                &tauri::Url::parse("https://example.com/index.html?view=preview").unwrap(),
                &trusted
            ));
        }
    }
}
