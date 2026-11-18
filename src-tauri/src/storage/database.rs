use super::*;

const SQLITE_BUSY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

impl Store {
    pub(super) fn read_connection(&self) -> Result<Connection> {
        let db = Connection::open_with_flags(
            self.vault().join("folio.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(err)?;
        db.busy_timeout(SQLITE_BUSY_TIMEOUT).map_err(err)?;
        Ok(db)
    }

    pub(super) fn connection(&self) -> Result<Connection> {
        Self::connection_at(&self.vault())
    }

    pub(super) fn connection_at(vault: &Path) -> Result<Connection> {
        fs::create_dir_all(vault.join("attachments")).map_err(err)?;
        let db = Connection::open(vault.join("folio.sqlite3")).map_err(err)?;
        db.busy_timeout(SQLITE_BUSY_TIMEOUT).map_err(err)?;
        db.execute_batch(concat!(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = DELETE;
             PRAGMA synchronous = FULL;",
            include_str!("schema.sql"),
        ))
        .map_err(err)?;
        Ok(db)
    }
}

pub(super) fn read_records(db: &Connection) -> Result<Vec<ProfileRecord>> {
    let mut statement = db.prepare("SELECT body FROM records WHERE deleted=0 ORDER BY json_extract(body, '$.updatedAt') DESC").map_err(err)?;
    let rows = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

pub(super) fn read_attachments(db: &Connection) -> Result<Vec<StoredAttachment>> {
    let mut statement = db.prepare("SELECT a.body FROM attachments a JOIN records r ON r.id=a.record_id WHERE a.deleted=0 AND r.deleted=0 ORDER BY a.rowid").map_err(err)?;
    let rows = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

pub(super) fn find_record(db: &Connection, id: &str) -> Result<Option<ProfileRecord>> {
    let body: Option<String> = db
        .query_row(
            "SELECT body FROM records WHERE id=?1 AND deleted=0",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    body.map(|json| serde_json::from_str(&json).map_err(err))
        .transpose()
}

pub(super) fn require_record(db: &Connection, id: &str) -> Result<ProfileRecord> {
    find_record(db, id)?.ok_or_else(|| "Record not found.".into())
}

pub(super) fn get_attachment(
    db: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<StoredAttachment> {
    validate_id(id)?;
    let query = if include_deleted {
        "SELECT body FROM attachments WHERE id=?1"
    } else {
        "SELECT a.body FROM attachments a JOIN records r ON r.id=a.record_id WHERE a.id=?1 AND a.deleted=0 AND r.deleted=0"
    };
    let body: String = db
        .query_row(query, [id], |r| r.get(0))
        .optional()
        .map_err(err)?
        .ok_or("Attachment not found.")?;
    serde_json::from_str(&body).map_err(err)
}
