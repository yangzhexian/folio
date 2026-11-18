use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024 * 1024;

mod agent;
mod attachments;
mod backup;
mod categories;
mod database;
mod migration;
mod preview;
mod preview_window;
mod queries;
mod records;
use agent::next_revision;
pub(crate) use attachments::validate_local_drop_path;
use attachments::{managed_name, safe_extension, validate_relative_path};
use categories::{read_category_catalog, require_registered_category, write_category_catalog};
use database::{find_record, get_attachment, read_attachments, read_records, require_record};

/// Coordinate complete application/CLI operations, including vault replacement.
/// The guard lives outside `vault`, so restore cannot move it out of the lock scope.
pub fn operation_lock(root: &Path, create_root: bool) -> Result<File> {
    if create_root {
        fs::create_dir_all(root).map_err(err)?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(".folio-operation.lock"))
        .map_err(err)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(std::fs::TryLockError::WouldBlock) => return Err("LIBRARY_BUSY".into()),
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Debug)]
pub struct Store {
    root: PathBuf,
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
}

pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        value.strip_prefix("\\\\?\\").unwrap_or(&value).to_owned()
    }
}

#[cfg(test)]
mod tests;
