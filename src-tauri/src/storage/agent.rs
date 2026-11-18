use super::*;

mod edits;

pub(super) fn attachment_revision(attachment: &StoredAttachment) -> Result<String> {
    if let Some(revision) = &attachment.revision {
        return Ok(revision.clone());
    }
    // FNV-1a-128 over the canonical legacy metadata JSON. This is an optimistic
    // concurrency token, not an authentication or content-integrity guarantee.
    let mut hash = 0x6c62272e07bb014262b821756295c58du128;
    for byte in serde_json::to_vec(attachment).map_err(err)? {
        hash ^= u128::from(byte);
        hash = hash.wrapping_mul(0x0000000001000000000000000000013bu128);
    }
    Ok(format!("legacy-{hash:032x}"))
}

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

    pub fn agent_create(&self, mut record: ProfileRecord) -> Result<ProfileRecord> {
        validate_record(&record)?;
        let mut db = self.connection()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        require_registered_category(&tx, &record.category)?;
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
        require_registered_category(&tx, &record.category)?;
        let previous = find_record(&tx, &record.id)?.ok_or("RECORD_NOT_FOUND")?;
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
