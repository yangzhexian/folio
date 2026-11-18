use super::*;

impl Store {
    pub fn save_record(&self, mut record: ProfileRecord) -> Result<ProfileRecord> {
        validate_record(&record)?;
        let mut db = self.connection()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        require_registered_category(&tx, &record.category)?;
        let previous: Option<(String, i64)> = tx
            .query_row(
                "SELECT body, deleted FROM records WHERE id=?1",
                [&record.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((body, deleted)) = previous {
            let previous = serde_json::from_str::<ProfileRecord>(&body).map_err(err)?;
            if deleted == 0 && record.updated_at != previous.updated_at {
                return Err("RECORD_CONFLICT".into());
            }
            record.created_at = previous.created_at;
            record.updated_at = next_revision(&previous.updated_at)?;
        } else {
            record.updated_at = now();
        }
        record.title = record.title.trim().to_owned();
        tx.execute("INSERT INTO records(id, body, deleted) VALUES(?1, ?2, 0) ON CONFLICT(id) DO UPDATE SET body=excluded.body, deleted=0", params![record.id, serde_json::to_string(&record).map_err(err)?]).map_err(err)?;
        tx.execute(
            "UPDATE attachments SET deleted=0 WHERE record_id=?1 AND deleted=2",
            [&record.id],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(record)
    }

    pub fn delete_record(&self, id: &str) -> Result<()> {
        validate_id(id)?;
        let mut db = self.connection()?;
        let tx = db.transaction().map_err(err)?;
        require_record(&tx, id)?;
        tx.execute("UPDATE records SET deleted=1 WHERE id=?1", [id])
            .map_err(err)?;
        tx.execute(
            "UPDATE attachments SET deleted=2 WHERE record_id=?1 AND deleted=0",
            [id],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
}
