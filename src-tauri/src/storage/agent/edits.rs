use super::*;
use serde_json::Value;

#[cfg(test)]
mod tests;

impl Store {
    pub fn check_attachment_revision(&self, id: &str, expected: &str) -> Result<()> {
        let attachment = get_attachment(&self.connection()?, id, false).map_err(|error| {
            if error == "Attachment not found." {
                "ATTACHMENT_CONFLICT".to_owned()
            } else {
                error
            }
        })?;
        check_revision(&attachment, expected)
    }

    pub fn validate_agent_field_patch(patch: &Value) -> Result<()> {
        let fields = patch.as_object().ok_or("INVALID_FIELD_PATCH")?;
        if fields.is_empty() {
            return Err("INVALID_FIELD_PATCH".into());
        }
        for (key, value) in fields {
            let valid = match key.as_str() {
                "label" => value
                    .as_str()
                    .is_some_and(|text| !text.trim().is_empty() && text.len() <= 1_000),
                "labelZh" => {
                    value.is_null() || value.as_str().is_some_and(|text| text.len() <= 1_000)
                }
                "value" => value.as_str().is_some_and(|text| text.len() <= 1_000_000),
                "kind" => serde_json::from_value::<FieldKind>(value.clone()).is_ok(),
                "sensitive" => value.is_boolean(),
                _ => false,
            };
            if !valid {
                return Err("INVALID_FIELD_PATCH".into());
            }
        }
        Ok(())
    }

    pub fn agent_field_update(
        &self,
        record_id: &str,
        field_id: &str,
        expected: &str,
        patch: &Value,
    ) -> Result<ProfileRecord> {
        Self::validate_agent_field_patch(patch)?;
        self.agent_edit_field(record_id, field_id, expected, Some(patch))
    }

    pub fn agent_field_delete(
        &self,
        record_id: &str,
        field_id: &str,
        expected: &str,
    ) -> Result<ProfileRecord> {
        self.agent_edit_field(record_id, field_id, expected, None)
    }

    fn agent_edit_field(
        &self,
        record_id: &str,
        field_id: &str,
        expected: &str,
        patch: Option<&Value>,
    ) -> Result<ProfileRecord> {
        validate_id(record_id)?;
        validate_date(expected)?;
        if field_id.is_empty() || field_id.len() > 200 {
            return Err("INVALID_FIELD_ID".into());
        }
        let mut db = self.connection()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut record = agent_record(&tx, record_id)?;
        if record.updated_at != expected {
            return Err("RECORD_CONFLICT".into());
        }
        let index = record
            .fields
            .iter()
            .position(|field| field.id == field_id)
            .ok_or("FIELD_NOT_FOUND")?;
        if let Some(patch) = patch {
            let mut field = serde_json::to_value(&record.fields[index]).map_err(err)?;
            for (key, value) in patch.as_object().ok_or("INVALID_FIELD_PATCH")? {
                field[key] = value.clone();
            }
            record.fields[index] =
                serde_json::from_value(field).map_err(|_| "INVALID_FIELD_PATCH".to_owned())?;
        } else {
            record.fields.remove(index);
        }
        validate_record(&record)?;
        require_registered_category(&tx, &record.category)?;
        record.updated_at = next_revision(&record.updated_at)?;
        tx.execute(
            "UPDATE records SET body=?1 WHERE id=?2 AND deleted=0",
            params![serde_json::to_string(&record).map_err(err)?, record_id],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(record)
    }

    // Callers hold the shared operation lock across revision validation and mutation.
    // GUI attachment mutations use the same lock and rotate this metadata revision.
    pub fn agent_attachment_rename(
        &self,
        record_id: &str,
        id: &str,
        expected: &str,
        name: &str,
    ) -> Result<Attachment> {
        self.agent_checked_attachment(record_id, id, expected)?;
        self.rename_attachment(id, name)
    }

    pub fn agent_attachment_delete(&self, record_id: &str, id: &str, expected: &str) -> Result<()> {
        self.agent_checked_attachment(record_id, id, expected)?;
        self.remove_attachment(id)
    }

    fn agent_checked_attachment(
        &self,
        record_id: &str,
        id: &str,
        expected: &str,
    ) -> Result<StoredAttachment> {
        validate_id(record_id)?;
        let db = self.connection()?;
        checked_attachment(&db, record_id, id, expected)
    }

    pub fn agent_attachment_replace(
        &self,
        record_id: &str,
        id: &str,
        expected: &str,
        source: &str,
    ) -> Result<(Attachment, String)> {
        validate_id(record_id)?;
        validate_id(id)?;
        if source.len() > 131_072 || source.contains('\0') {
            return Err("INVALID_ATTACHMENT_SOURCE".into());
        }
        let source = PathBuf::from(source);
        validate_local_drop_path(&source).map_err(|_| "INVALID_ATTACHMENT_SOURCE".to_owned())?;
        let source = source.canonicalize().map_err(err)?;
        validate_local_drop_path(&source).map_err(|_| "INVALID_ATTACHMENT_SOURCE".to_owned())?;
        let mut input = File::open(&source).map_err(err)?;
        let before = input.metadata().map_err(err)?;
        if !before.is_file() || before.len() > MAX_FILE_SIZE {
            return Err("INVALID_ATTACHMENT_SOURCE".into());
        }
        let original_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("INVALID_ATTACHMENT_SOURCE")?
            .to_owned();
        let mut db = self.connection()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut attachment = checked_attachment(&tx, record_id, id, expected)?;
        let record = agent_record(&tx, record_id)?;
        let previous_path = self.resolve_existing(&attachment.relative_path)?;
        let stem = Path::new(&attachment.file_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or("Invalid managed filename.")?;
        let suffix = stem
            .split_once('_')
            .map(|(_, suffix)| suffix)
            .unwrap_or(stem);
        let suffix: String = suffix.chars().take(45).collect();
        let version = Uuid::new_v4().simple().to_string();
        let name = managed_name(
            &record.category,
            &format!("{suffix}-{}", &version[..12]),
            safe_extension(&source).as_deref(),
        );
        let relative_path = format!("attachments/{record_id}/{name}");
        let destination = self.safe_destination(&relative_path)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(err)?;
        let copied = (|| {
            let size = std::io::copy(
                &mut Read::by_ref(&mut input).take(MAX_FILE_SIZE + 1),
                &mut output,
            )
            .map_err(err)?;
            let after = input.metadata().map_err(err)?;
            if size > MAX_FILE_SIZE
                || size != before.len()
                || size != after.len()
                || before.modified().map_err(err)? != after.modified().map_err(err)?
            {
                return Err(
                    "The replacement source changed while copying. Retry from a stable local file."
                        .into(),
                );
            }
            output.sync_all().map_err(err)?;
            Ok(size)
        })();
        drop(output);
        let result = copied.and_then(|size| {
            attachment.file_name = name;
            attachment.relative_path = relative_path;
            attachment.original_name = original_name;
            attachment.size = size;
            attachment.revision = Some(Uuid::new_v4().to_string());
            let public = self.public_attachment(attachment.clone())?;
            tx.execute(
                "UPDATE attachments SET body=?1 WHERE id=?2 AND deleted=0",
                params![serde_json::to_string(&attachment).map_err(err)?, id],
            )
            .map_err(err)?;
            tx.commit().map_err(err)?;
            Ok((public, display_path(&previous_path)))
        });
        if result.is_err() {
            let _ = fs::remove_file(destination);
        }
        // The previous managed bytes stay at previous_path as an unreferenced recovery
        // copy. Never remove the supplied source, even when it is a managed file.
        result
    }
}

fn agent_record(db: &Connection, id: &str) -> Result<ProfileRecord> {
    let body: Option<String> = db
        .query_row(
            "SELECT body FROM records WHERE id=?1 AND deleted=0",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    serde_json::from_str(&body.ok_or("RECORD_NOT_FOUND")?).map_err(err)
}

fn checked_attachment(
    db: &Connection,
    record_id: &str,
    id: &str,
    expected: &str,
) -> Result<StoredAttachment> {
    validate_id(id)?;
    agent_record(db, record_id)?;
    let body: Option<String> = db
        .query_row(
            "SELECT body FROM attachments WHERE id=?1 AND record_id=?2 AND deleted=0",
            params![id, record_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    let attachment: StoredAttachment =
        serde_json::from_str(&body.ok_or("ATTACHMENT_NOT_FOUND")?).map_err(err)?;
    check_revision(&attachment, expected)?;
    Ok(attachment)
}

fn check_revision(attachment: &StoredAttachment, expected: &str) -> Result<()> {
    if attachment_revision(attachment)? != expected {
        return Err("ATTACHMENT_CONFLICT".into());
    }
    Ok(())
}
