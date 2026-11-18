use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordSummary {
    id: String,
    category: String,
    title: String,
    updated_at: String,
    field_count: usize,
    attachment_count: usize,
}

impl Store {
    pub fn snapshot(&self) -> Result<Snapshot> {
        // The desktop may recover a hot SQLite rollback journal left by an interrupted writer.
        let db = self.connection()?;
        let records = read_records(&db)?;
        let catalog = read_category_catalog(&db)?;
        for record in &records {
            require_category(&catalog.categories, &record.category)?;
        }
        let stored = read_attachments(&db)?;
        let vault = self.vault().canonicalize().map_err(err)?;
        let attachments = stored
            .into_iter()
            .map(|a| Self::public_attachment_in(&vault, a))
            .collect::<Result<_>>()?;
        Ok(Snapshot {
            records,
            attachments,
            data_dir: display_path(&self.root),
            categories: catalog.categories,
            categories_revision: catalog.revision,
        })
    }

    pub fn agent_list(&self) -> Result<(Vec<RecordSummary>, CategoryCatalog)> {
        let db = self.read_connection()?;
        let catalog = read_category_catalog(&db)?;
        // The correlated count uses attachment_record and never opens a managed file.
        let mut statement = db.prepare(
            "SELECT r.body, (SELECT COUNT(*) FROM attachments a WHERE a.record_id=r.id AND a.deleted=0)
             FROM records r WHERE r.deleted=0 ORDER BY json_extract(r.body, '$.updatedAt') DESC",
        ).map_err(err)?;
        let mut rows = statement.query([]).map_err(err)?;
        let mut summaries = Vec::new();
        while let Some(row) = rows.next().map_err(err)? {
            let body: String = row.get(0).map_err(err)?;
            let record: ProfileRecord = serde_json::from_str(&body).map_err(err)?;
            require_category(&catalog.categories, &record.category)?;
            summaries.push(RecordSummary {
                id: record.id,
                category: record.category,
                title: record.title,
                updated_at: record.updated_at,
                field_count: record.fields.len(),
                attachment_count: row.get(1).map_err(err)?,
            });
        }
        Ok((summaries, catalog))
    }

    pub fn agent_get(&self, id: &str) -> Result<(ProfileRecord, Vec<Attachment>, CategoryCatalog)> {
        let db = self.read_connection()?;
        let catalog = read_category_catalog(&db)?;
        let record = find_record(&db, id)?.ok_or("RECORD_NOT_FOUND")?;
        require_category(&catalog.categories, &record.category)?;
        let vault = self.vault().canonicalize().map_err(err)?;
        let mut statement = db
            .prepare("SELECT body FROM attachments WHERE record_id=?1 AND deleted=0 ORDER BY rowid")
            .map_err(err)?;
        let rows = statement
            .query_map([id], |row| row.get::<_, String>(0))
            .map_err(err)?;
        let mut attachments = Vec::new();
        for row in rows {
            let metadata = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            attachments.push(Self::public_attachment_in(&vault, metadata)?);
        }
        Ok((record, attachments, catalog))
    }
}
