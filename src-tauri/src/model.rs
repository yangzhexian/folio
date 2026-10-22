use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;

pub const CATEGORIES: &[&str] = &[
    "identity",
    "education",
    "experience",
    "research",
    "awards",
    "skills",
    "contacts",
    "documents",
    "custom",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Field {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_zh: Option<String>,
    pub value: String,
    pub kind: FieldKind,
    pub sensitive: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldKind {
    Text,
    Multiline,
    Date,
    Email,
    Phone,
    Url,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileRecord {
    pub id: String,
    pub category: String,
    pub title: String,
    pub subtitle: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub fields: Vec<Field>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredAttachment {
    pub id: String,
    pub record_id: String,
    pub original_name: String,
    pub file_name: String,
    pub relative_path: String,
    pub size: u64,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    #[serde(flatten)]
    pub metadata: StoredAttachment,
    pub absolute_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub records: Vec<ProfileRecord>,
    pub attachments: Vec<Attachment>,
    pub data_dir: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupManifest {
    pub schema_version: u32,
    pub created_at: String,
    pub records: Vec<ProfileRecord>,
    pub attachments: Vec<StoredAttachment>,
}

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn validate_id(id: &str) -> Result<()> {
    let parsed = Uuid::parse_str(id).map_err(|_| "Invalid identifier.".to_owned())?;
    if parsed.to_string() != id {
        return Err("Identifiers must use canonical lowercase UUID format.".into());
    }
    Ok(())
}

pub fn validate_date(value: &str) -> Result<()> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| "Invalid timestamp.".to_owned())
}

pub fn validate_record(record: &ProfileRecord) -> Result<()> {
    validate_id(&record.id)?;
    if !CATEGORIES.contains(&record.category.as_str()) {
        return Err("Unknown category.".into());
    }
    if record.title.trim().is_empty() || record.title.chars().count() > 200 {
        return Err("Title must contain 1–200 characters.".into());
    }
    if record.subtitle.len() > 4_000 || record.notes.len() > 1_000_000 {
        return Err("Record text is too long.".into());
    }
    if record.tags.len() > 100 || record.tags.iter().any(|tag| tag.len() > 200) {
        return Err("Too many tags or a tag is too long.".into());
    }
    if record.fields.len() > 500 {
        return Err("A record can contain at most 500 fields.".into());
    }
    let mut ids = HashSet::new();
    for field in &record.fields {
        // Template field identifiers may be readable names; record and attachment IDs are UUIDs.
        if field.id.is_empty() || field.id.len() > 200 || !ids.insert(&field.id) {
            return Err("Field identifiers must be unique and nonempty.".into());
        }
        if field.label.trim().is_empty()
            || field.label.len() > 1_000
            || field.label_zh.as_ref().is_some_and(|v| v.len() > 1_000)
            || field.value.len() > 1_000_000
        {
            return Err("Invalid field label or value length.".into());
        }
    }
    validate_date(&record.created_at)?;
    validate_date(&record.updated_at)?;
    Ok(())
}
