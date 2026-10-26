use super::*;

impl Store {
    pub fn agent_existing(root: PathBuf) -> Result<Self> {
        if !root.join("vault/folio.sqlite3").is_file() {
            return Err("LIBRARY_NOT_FOUND".into());
        }
        if root.join("restore-journal.json").exists() {
            return Err("LIBRARY_RECOVERY_REQUIRED".into());
        }
        Ok(Self {
            root: root.canonicalize().map_err(err)?,
        })
    }

    pub fn agent_snapshot(&self) -> Result<Snapshot> {
        let db = Connection::open_with_flags(
            self.vault().join("folio.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(err)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        let records = read_records(&db)?;
        let attachments = read_attachments(&db)?
            .into_iter()
            .map(|item| self.public_attachment(item))
            .collect::<Result<_>>()?;
        Ok(Snapshot {
            records,
            attachments,
            data_dir: display_path(&self.root),
        })
    }

    pub fn agent_create(&self, mut record: ProfileRecord) -> Result<ProfileRecord> {
        validate_record(&record)?;
        let mut db = self.connection()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM records WHERE id=?1)",
                [&record.id],
                |row| row.get(0),
            )
            .map_err(err)?;
        if exists {
            return Err("RECORD_EXISTS".into());
        }
        record.title = record.title.trim().to_owned();
        record.created_at = now();
        record.updated_at = record.created_at.clone();
        tx.execute(
            "INSERT INTO records(id, body, deleted) VALUES(?1, ?2, 0)",
            params![record.id, serde_json::to_string(&record).map_err(err)?],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(record)
    }

    pub fn agent_update(&self, mut record: ProfileRecord, expected: &str) -> Result<ProfileRecord> {
        validate_record(&record)?;
        validate_date(expected)?;
        let mut db = self.connection()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let body: Option<String> = tx
            .query_row(
                "SELECT body FROM records WHERE id=?1 AND deleted=0",
                [&record.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?;
        let previous: ProfileRecord =
            serde_json::from_str(&body.ok_or("RECORD_NOT_FOUND")?).map_err(err)?;
        if previous.updated_at != expected {
            return Err("RECORD_CONFLICT".into());
        }
        record.title = record.title.trim().to_owned();
        record.created_at = previous.created_at;
        record.updated_at = next_revision(&previous.updated_at)?;
        tx.execute(
            "UPDATE records SET body=?1 WHERE id=?2 AND deleted=0",
            params![serde_json::to_string(&record).map_err(err)?, record.id],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(record)
    }
}

pub(super) fn next_revision(previous: &str) -> Result<String> {
    let previous = chrono::DateTime::parse_from_rfc3339(previous)
        .map_err(err)?
        .with_timezone(&chrono::Utc);
    let current = chrono::Utc::now();
    let value = if current.timestamp_millis() <= previous.timestamp_millis() {
        previous
            .checked_add_signed(chrono::Duration::milliseconds(1))
            .ok_or("Timestamp is outside the supported range.")?
    } else {
        current
    };
    Ok(value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}
