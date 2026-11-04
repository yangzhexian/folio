use super::{get_attachment, Attachment, Result, Store};

impl Store {
    /// Return only active metadata in the caller's original order, never a library snapshot.
    pub fn preview_window_attachments(&self, ids: &[String]) -> Result<Vec<Attachment>> {
        let db = self.connection()?;
        let mut files = Vec::with_capacity(ids.len());
        for id in ids {
            let Ok(metadata) = get_attachment(&db, id, false) else {
                continue;
            };
            let extension = std::path::Path::new(&metadata.file_name)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "pdf") {
                continue;
            }
            // Resolve through the same vault boundary checks used by file operations.
            if let Ok(file) = self.public_attachment(metadata) {
                files.push(file);
            }
        }
        Ok(files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{now, ProfileRecord};
    use std::fs;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn record(store: &Store) -> ProfileRecord {
        store
            .save_record(ProfileRecord {
                id: Uuid::new_v4().to_string(),
                category: "documents".into(),
                title: "Preview scope".into(),
                subtitle: String::new(),
                tags: vec![],
                favorite: false,
                notes: String::new(),
                fields: vec![],
                created_at: now(),
                updated_at: now(),
            })
            .unwrap()
    }

    #[test]
    fn metadata_preserves_scope_order_and_skips_unsupported_or_inactive_rows() {
        let temp = TempDir::new().unwrap();
        let store = Store::open(temp.path().join("data")).unwrap();
        let parent = record(&store);
        let mut files = vec![];
        for name in ["first.png", "second.pdf", "notes.txt", "outside.jpg"] {
            let path = temp.path().join(name);
            fs::write(&path, b"synthetic metadata fixture").unwrap();
            files.push(store.import_files(&parent.id, &[path]).unwrap().remove(0));
        }
        let ids = vec![
            files[1].metadata.id.clone(),
            files[2].metadata.id.clone(),
            files[0].metadata.id.clone(),
            Uuid::new_v4().to_string(),
        ];
        let selected = store.preview_window_attachments(&ids).unwrap();
        assert_eq!(
            selected
                .iter()
                .map(|file| &file.metadata.id)
                .collect::<Vec<_>>(),
            vec![&files[1].metadata.id, &files[0].metadata.id]
        );
        assert!(selected
            .iter()
            .all(|file| file.metadata.id != files[3].metadata.id));
        store.remove_attachment(&files[1].metadata.id).unwrap();
        assert_eq!(store.preview_window_attachments(&ids).unwrap().len(), 1);
        store.delete_record(&parent.id).unwrap();
        // Even an inconsistent active attachment flag cannot bypass its deleted parent.
        store
            .connection()
            .unwrap()
            .execute("UPDATE attachments SET deleted=0", [])
            .unwrap();
        assert!(store.preview_window_attachments(&ids).unwrap().is_empty());
    }

    #[test]
    fn missing_file_metadata_remains_available_for_actionable_viewer_errors() {
        let temp = TempDir::new().unwrap();
        let store = Store::open(temp.path().join("data")).unwrap();
        let parent = record(&store);
        let path = temp.path().join("missing.PNG");
        fs::write(&path, b"synthetic fixture").unwrap();
        let file = store.import_files(&parent.id, &[path]).unwrap().remove(0);
        fs::remove_file(store.attachment_path(&file.metadata.id).unwrap()).unwrap();
        let selected = store
            .preview_window_attachments(&[file.metadata.id.clone()])
            .unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].metadata.id, file.metadata.id);
        assert!(store.attachment_preview(&file.metadata.id).is_err());
    }
}
