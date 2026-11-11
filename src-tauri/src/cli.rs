//! Local automation entrypoint. No webview, HTTP listener, or remote service is started.
use crate::model::{
    builtin_catalog, now, require_category, validate_date, validate_id, validate_record,
    CategoryCatalog, Field, ProfileRecord, CATEGORY_ICONS,
};
use crate::storage::{display_path, operation_lock, Store};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;

const MAX_INPUT_BYTES: u64 = 8 * 1024 * 1024;
const HELP: &str = "Folio local data CLI\n\nUsage: folio-cli [--data-dir ABSOLUTE_DIRECTORY] COMMAND [OPTIONS]\n\nCommands:\n  info                                      Show the selected library path and existence\n  schema                                    Print current category IDs, input schemas, and limits\n  categories                                Read category names, icons, order, and revision\n  list                                      List active record summaries\n  get --id UUID                             Read a record and its attachment revisions\n  validate --input FILE                     Validate record JSON without writing\n  create --input FILE                       Create one record; an existing ID is rejected\n  update --input FILE --expected-updated-at TIMESTAMP\n                                            Replace one active record if its revision matches\n  attach --record-id UUID --input FILE       Import a JSON array of absolute file paths\n  field-update --record-id UUID --field-id ID --expected-updated-at TIMESTAMP --input FILE\n                                            Patch one field without changing other fields\n  field-delete --record-id UUID --field-id ID --expected-updated-at TIMESTAMP\n                                            Delete one field, preserving remaining order\n  attachment-rename --record-id UUID --attachment-id UUID --expected-revision TOKEN --input FILE\n                                            Rename using JSON {\"name\":\"stem\"}\n  attachment-replace --record-id UUID --attachment-id UUID --expected-revision TOKEN --input FILE\n                                            Replace bytes using JSON {\"path\":\"absolute source path\"}\n  attachment-delete --record-id UUID --attachment-id UUID --expected-revision TOKEN\n                                            Soft-delete one active attachment\n\nUse --input - to read UTF-8 JSON from stdin. The default data directory is data\nbeside this executable. Use info before writing to an existing library. Commands\nreturn JSON; errors go to stderr. Exit codes: 0 success, 1 operation failed,\n2 invalid arguments/input, 3 revision or record conflict. No files are uploaded.\n";

#[derive(Debug)]
struct CliError {
    code: &'static str,
    message: String,
    exit: i32,
}
type CliResult<T> = std::result::Result<T, CliError>;

fn error(code: &'static str, message: impl Into<String>, exit: i32) -> CliError {
    CliError {
        code,
        message: message.into(),
        exit,
    }
}

fn storage_error(message: String) -> CliError {
    match message.as_str() {
        "UNKNOWN_CATEGORY" => error("UNKNOWN_CATEGORY", "Use an exact registered category ID from categories or schema for this library.", 2),
        "INVALID_CATEGORIES" => error("INVALID_CATEGORIES", "The category catalog is invalid. Preserve existing IDs and use valid unique names and icons.", 2),
        "CATEGORY_CONFLICT" => error("CATEGORY_CONFLICT", "The category catalog changed. Read categories again and reconcile the requested changes.", 3),
        "RECORD_EXISTS" => error(
            "RECORD_EXISTS",
            "That record ID already exists. Read it with get before deciding whether to update it.",
            3,
        ),
        "RECORD_CONFLICT" => error(
            "RECORD_CONFLICT",
            "The record changed. Read its latest revision and reconcile changes before updating.",
            3,
        ),
        "RECORD_NOT_FOUND" => error("RECORD_NOT_FOUND", "No active record has that ID.", 1),
        "FIELD_NOT_FOUND" => error("FIELD_NOT_FOUND", "No field with that ID exists in the selected record.", 1),
        "INVALID_FIELD_ID" => error("INVALID_FIELD_ID", "A field ID must contain 1-200 UTF-8 bytes.", 2),
        "INVALID_FIELD_PATCH" => error("INVALID_FIELD_PATCH", "Use a nonempty object containing valid label, labelZh, value, kind, or sensitive properties. Only labelZh accepts null.", 2),
        "ATTACHMENT_NOT_FOUND" => error("ATTACHMENT_NOT_FOUND", "No active attachment with that ID belongs to the selected record.", 1),
        "ATTACHMENT_CONFLICT" => error("ATTACHMENT_CONFLICT", "The attachment changed. Read get again and reconcile the requested edit with its latest revision.", 3),
        "INVALID_ATTACHMENT_SOURCE" => error("INVALID_ATTACHMENT_SOURCE", "Choose an absolute path to a regular local file up to 2 GiB.", 2),
        "LIBRARY_NOT_FOUND" => error(
            "LIBRARY_NOT_FOUND",
            "No library exists at the selected data directory. Check info and --data-dir.",
            1,
        ),
        "LIBRARY_RECOVERY_REQUIRED" => error(
            "LIBRARY_RECOVERY_REQUIRED",
            "An interrupted restore needs recovery. Open Folio before using this library.",
            1,
        ),
        "LIBRARY_BUSY" => error(
            "LIBRARY_BUSY",
            "Another operation is using the library. Retry after it finishes.",
            1,
        ),
        _ => error("STORAGE_ERROR", message, 1),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordInput {
    id: String,
    category: String,
    title: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    favorite: bool,
    #[serde(default)]
    fields: Vec<Field>,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttachmentRenameInput {
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttachmentReplaceInput {
    path: String,
}

impl RecordInput {
    fn record(self) -> CliResult<ProfileRecord> {
        let record = ProfileRecord {
            id: self.id,
            category: self.category,
            title: self.title,
            subtitle: self.subtitle,
            tags: self.tags,
            favorite: self.favorite,
            fields: self.fields,
            notes: self.notes,
            created_at: self.created_at.unwrap_or_else(now),
            updated_at: self.updated_at.unwrap_or_else(now),
        };
        validate_record(&record).map_err(|message| {
            if message == "UNKNOWN_CATEGORY" {
                storage_error(message)
            } else {
                error("INVALID_RECORD", message, 2)
            }
        })?;
        Ok(record)
    }
}

struct Arguments {
    command: String,
    root: PathBuf,
    options: HashMap<String, OsString>,
}

fn arguments(values: Vec<OsString>, default_root: PathBuf) -> CliResult<Arguments> {
    let mut command = None;
    let mut root = default_root;
    let mut seen_root = false;
    let mut options = HashMap::new();
    let mut input = values.into_iter();
    while let Some(value) = input.next() {
        let flag = value.to_str().ok_or_else(|| {
            error(
                "INVALID_ARGUMENT",
                "Command and option names must be valid Unicode.",
                2,
            )
        })?;
        if flag.starts_with("--") {
            if !matches!(
                flag,
                "--data-dir"
                    | "--input"
                    | "--id"
                    | "--record-id"
                    | "--expected-updated-at"
                    | "--field-id"
                    | "--attachment-id"
                    | "--expected-revision"
            ) {
                return Err(error(
                    "INVALID_ARGUMENT",
                    format!("Unknown option: {flag}"),
                    2,
                ));
            }
            let next = input.next().ok_or_else(|| {
                error("INVALID_ARGUMENT", format!("Missing value for {flag}."), 2)
            })?;
            if flag == "--data-dir" {
                if seen_root {
                    return Err(error(
                        "INVALID_ARGUMENT",
                        "--data-dir was provided more than once.",
                        2,
                    ));
                }
                seen_root = true;
                root = PathBuf::from(next);
            } else if options.insert(flag.to_owned(), next).is_some() {
                return Err(error(
                    "INVALID_ARGUMENT",
                    format!("{flag} was provided more than once."),
                    2,
                ));
            }
        } else if command.replace(flag.to_owned()).is_some() {
            return Err(error(
                "INVALID_ARGUMENT",
                "Unexpected positional argument.",
                2,
            ));
        }
    }
    let command = command.ok_or_else(|| {
        error(
            "INVALID_ARGUMENT",
            "A command is required. Run folio-cli --help.",
            2,
        )
    })?;
    let allowed: &[&str] = match command.as_str() {
        "info" | "schema" | "categories" | "list" => &[],
        "get" => &["--id"],
        "validate" | "create" => &["--input"],
        "update" => &["--input", "--expected-updated-at"],
        "attach" => &["--record-id", "--input"],
        "field-update" => &[
            "--record-id",
            "--field-id",
            "--expected-updated-at",
            "--input",
        ],
        "field-delete" => &["--record-id", "--field-id", "--expected-updated-at"],
        "attachment-rename" | "attachment-replace" => &[
            "--record-id",
            "--attachment-id",
            "--expected-revision",
            "--input",
        ],
        "attachment-delete" => &["--record-id", "--attachment-id", "--expected-revision"],
        _ => {
            return Err(error(
                "INVALID_ARGUMENT",
                format!("Unknown command: {command}"),
                2,
            ))
        }
    };
    if options.len() != allowed.len() || allowed.iter().any(|flag| !options.contains_key(*flag)) {
        return Err(error(
            "INVALID_ARGUMENT",
            format!(
                "{command} requires exactly these options: {}",
                allowed.join(", ")
            ),
            2,
        ));
    }
    if !root.is_absolute() {
        return Err(error(
            "INVALID_ARGUMENT",
            "--data-dir must be an absolute path.",
            2,
        ));
    }
    crate::storage::validate_local_drop_path(&root).map_err(|_| {
        error(
            "INVALID_ARGUMENT",
            "--data-dir must name an absolute directory on a local drive.",
            2,
        )
    })?;
    let existing = root.ancestors().find(|path| path.exists()).ok_or_else(|| {
        error(
            "INVALID_ARGUMENT",
            "The data directory has no existing local parent.",
            2,
        )
    })?;
    let resolved = existing
        .canonicalize()
        .map_err(|failure| error("INVALID_ARGUMENT", failure.to_string(), 2))?;
    crate::storage::validate_local_drop_path(&resolved).map_err(|_| {
        error(
            "INVALID_ARGUMENT",
            "The data directory cannot redirect to a network or device path.",
            2,
        )
    })?;
    if root.exists() {
        if !root.is_dir() {
            return Err(error(
                "INVALID_ARGUMENT",
                "--data-dir must name a directory, not a file.",
                2,
            ));
        }
        root = root
            .canonicalize()
            .map_err(|failure| error("INVALID_ARGUMENT", failure.to_string(), 2))?;
    }
    Ok(Arguments {
        command,
        root,
        options,
    })
}

fn option_text<'a>(args: &'a Arguments, flag: &str) -> CliResult<&'a str> {
    args.options[flag].to_str().ok_or_else(|| {
        error(
            "INVALID_ARGUMENT",
            format!("{flag} must be valid Unicode."),
            2,
        )
    })
}

fn read_input(args: &Arguments, stdin: &mut dyn Read) -> CliResult<Vec<u8>> {
    let value = &args.options["--input"];
    let mut reader: Box<dyn Read + '_> = if value == "-" {
        Box::new(stdin)
    } else {
        Box::new(File::open(value).map_err(|failure| {
            error(
                "INPUT_ERROR",
                format!("Cannot read JSON input: {failure}"),
                2,
            )
        })?)
    };
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|failure| error("INPUT_ERROR", failure.to_string(), 2))?;
    if bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err(error(
            "INPUT_TOO_LARGE",
            "JSON input must not exceed 8 MiB.",
            2,
        ));
    }
    Ok(bytes
        .strip_prefix(b"\xef\xbb\xbf")
        .unwrap_or(&bytes)
        .to_vec())
}

fn parse_input<T: serde::de::DeserializeOwned>(
    args: &Arguments,
    stdin: &mut dyn Read,
) -> CliResult<T> {
    serde_json::from_slice(&read_input(args, stdin)?)
        .map_err(|failure| error("INVALID_JSON", format!("Expected UTF-8 JSON: {failure}"), 2))
}

fn schema(catalog: &CategoryCatalog) -> Value {
    let category_ids: Vec<_> = catalog
        .categories
        .iter()
        .map(|category| &category.id)
        .collect();
    json!({
        "schemaVersion": 3,
        "capabilities": ["categories.read", "records.create", "records.update", "fields.update", "fields.delete", "attachments.import", "attachments.rename", "attachments.replace", "attachments.delete"],
        "categories": catalog.categories,
        "categoriesRevision": catalog.revision,
        "categoryIcons": CATEGORY_ICONS,
        "categorySemantics": "Use an exact category ID from this library's categories command, never a translated label. Existing builtin IDs remain stable; custom IDs use collection- followed by a canonical lowercase UUID. Add, rename, reorder, or change category icons in Folio's category manager. Category names and icons do not change record IDs or existing attachment paths.",
        "record": {
            "type": "object", "additionalProperties": false, "required": ["id", "category", "title"],
            "properties": {
                "id": {"type": "string", "format": "uuid", "description": "Canonical lowercase UUID. Generate it once and retain it for verification/retries."},
                "category": {"type": "string", "enum": category_ids},
                "title": {"type": "string", "minLength": 1, "maxLength": 200},
                "subtitle": {"type": "string", "default": ""},
                "tags": {"type": "array", "items": {"type": "string"}, "default": []},
                "favorite": {"type": "boolean", "default": false},
                "notes": {"type": "string", "default": ""},
                "fields": {"type": "array", "default": [], "maxItems": 500, "items": {
                    "type": "object", "additionalProperties": false,
                    "required": ["id", "label", "value", "kind", "sensitive"],
                    "properties": {
                        "id": {"type": "string", "description": "Unique, nonempty field ID within this record; readable IDs are supported."},
                        "label": {"type": "string"}, "labelZh": {"type": "string"}, "value": {"type": "string"},
                        "kind": {"enum": ["text", "multiline", "date", "email", "phone", "url"]}, "sensitive": {"type": "boolean"}
                    }
                }},
                "createdAt": {"type": "string", "format": "date-time", "description": "Optional valid timestamp. Managed by the backend."},
                "updatedAt": {"type": "string", "format": "date-time", "description": "Optional valid timestamp. Use get's updatedAt for the update command's expected revision."}
            }
        },
        "limits": {"jsonInputBytes": MAX_INPUT_BYTES, "categories": 100, "categoryNameCharacters": 60, "subtitleUtf8Bytes": 4000, "notesUtf8Bytes": 1000000, "tags": 100, "tagUtf8Bytes": 200, "fieldIdUtf8Bytes": 200, "fieldLabelUtf8Bytes": 1000, "fieldValueUtf8Bytes": 1000000, "attachmentsPerCommand": 100, "attachmentBytes": 2147483648u64},
        "attachmentInput": {"type": "array", "items": {"type": "string", "description": "Absolute path to a local regular source file."}, "maxItems": 100},
        "fieldPatch": {"type": "object", "additionalProperties": false, "minProperties": 1, "properties": {
            "label": {"type": "string"}, "labelZh": {"type": ["string", "null"]}, "value": {"type": "string"},
            "kind": {"enum": ["text", "multiline", "date", "email", "phone", "url"]}, "sensitive": {"type": "boolean"}
        }},
        "attachmentRenameInput": {"type": "object", "additionalProperties": false, "required": ["name"], "properties": {"name": {"type": "string", "minLength": 1, "maxLength": 200, "description": "Filename suffix without path separators; category prefix and current extension are managed automatically."}}},
        "attachmentReplaceInput": {"type": "object", "additionalProperties": false, "required": ["path"], "properties": {"path": {"type": "string", "description": "Absolute path to a regular local source file, up to 2 GiB."}}},
        "fieldSemantics": "field-update patches one field without changing its ID or array position; labelZh:null clears its Chinese label. field-delete removes only the chosen field. Both require the exact record.updatedAt from get and advance it. Field deletion has no separate trash or CLI undo.",
        "attachmentRevisionSemantics": "get returns each attachment.revision as an opaque token. attachment-rename, attachment-replace, and attachment-delete require --expected-revision and the correct --record-id. GUI rename/removal/restore and CLI replacement rotate the token. Legacy metadata gets a stable derived token without a database write. Restore assigns fresh tokens; backups omit them.",
        "attachmentReplacementSemantics": "Replacement preserves attachment ID, record ID, and createdAt. It updates originalName, size, extension, managed path, and revision. A shortened old suffix plus a fresh version suffix forms the new filename. Copy and database commit complete before publication. The original source and previous managed copy remain unchanged; previousPath identifies the unreferenced recovery copy. That old name stays reserved while its file exists. Failed replacements preserve the active attachment.",
        "attachmentDeletionSemantics": "attachment-delete hides only that attachment using existing soft deletion. The managed bytes remain on disk; normal get, preview, and mutation commands cannot access the removed ID. No CLI undo command is provided. Verify absence with get after an uncertain result.",
        "updateSemantics": "Full replacement of editable record content, not a partial patch. Fetch the latest record and preserve unrelated fields. createdAt is preserved and updatedAt always advances.",
        "attachmentSemantics": "Import copies source files. A repeated attach command creates new managed copies; verify get after an uncertain result before retrying."
    })
}

fn selected_catalog(args: &Arguments) -> CliResult<CategoryCatalog> {
    // A new/empty path reports builtins without creating a folder, lock, or database.
    if !args.root.is_dir() {
        return Ok(builtin_catalog());
    }
    if !args.root.join("vault/folio.sqlite3").exists()
        && !args.root.join("restore-journal.json").exists()
    {
        return Ok(builtin_catalog());
    }
    let _guard = operation_lock(&args.root, false).map_err(storage_error)?;
    Store::agent_existing(args.root.clone())
        .map_err(storage_error)?
        .agent_categories()
        .map_err(storage_error)
}

fn execute(args: Arguments, stdin: &mut dyn Read) -> CliResult<Value> {
    let command = args.command.as_str();
    let value = match command {
        "info" => {
            json!({"version": env!("CARGO_PKG_VERSION"), "dataDir": display_path(&args.root), "libraryExists": args.root.join("vault/folio.sqlite3").is_file()})
        }
        "schema" => schema(&selected_catalog(&args)?),
        "categories" => {
            let catalog = selected_catalog(&args)?;
            json!({"categories": catalog.categories, "revision": catalog.revision, "dataDir": display_path(&args.root)})
        }
        "validate" => {
            let record = parse_input::<RecordInput>(&args, stdin)?.record()?;
            require_category(&selected_catalog(&args)?.categories, &record.category)
                .map_err(storage_error)?;
            json!({"valid": true, "id": record.id, "category": record.category, "fieldCount": record.fields.len()})
        }
        "create" => {
            let record = parse_input::<RecordInput>(&args, stdin)?.record()?;
            // Reject an unknown category before initializing a new vault; the backend
            // checks membership again inside the write transaction.
            require_category(&selected_catalog(&args)?.categories, &record.category)
                .map_err(storage_error)?;
            let _guard = operation_lock(&args.root, true).map_err(storage_error)?;
            let store = Store::open(args.root.clone()).map_err(storage_error)?;
            json!({"record": store.agent_create(record).map_err(storage_error)?, "dataDir": display_path(store.root())})
        }
        _ => {
            // Parse and validate mutating input before touching the selected library.
            let record = if command == "update" {
                Some(parse_input::<RecordInput>(&args, stdin)?.record()?)
            } else {
                None
            };
            let expected = if args.options.contains_key("--expected-updated-at") {
                let value = option_text(&args, "--expected-updated-at")?;
                validate_date(value).map_err(|message| error("INVALID_ARGUMENT", message, 2))?;
                Some(value)
            } else {
                None
            };
            let paths = if command == "attach" {
                Some(parse_input::<Vec<String>>(&args, stdin)?)
            } else {
                None
            };
            let id = if command == "get" {
                Some(option_text(&args, "--id")?)
            } else if args.options.contains_key("--record-id") {
                Some(option_text(&args, "--record-id")?)
            } else {
                None
            };
            if let Some(id) = id {
                validate_id(id).map_err(|message| error("INVALID_ARGUMENT", message, 2))?;
            }
            let field_id = if args.options.contains_key("--field-id") {
                let value = option_text(&args, "--field-id")?;
                if value.is_empty() || value.len() > 200 {
                    return Err(storage_error("INVALID_FIELD_ID".into()));
                }
                Some(value)
            } else {
                None
            };
            let patch = if command == "field-update" {
                let value = parse_input::<Value>(&args, stdin)?;
                Store::validate_agent_field_patch(&value).map_err(storage_error)?;
                Some(value)
            } else {
                None
            };
            let attachment_id = if args.options.contains_key("--attachment-id") {
                let value = option_text(&args, "--attachment-id")?;
                validate_id(value).map_err(|message| error("INVALID_ARGUMENT", message, 2))?;
                Some(value)
            } else {
                None
            };
            let revision = if args.options.contains_key("--expected-revision") {
                let value = option_text(&args, "--expected-revision")?;
                if value.is_empty() || value.len() > 200 || value.contains('\0') {
                    return Err(error(
                        "INVALID_ARGUMENT",
                        "Pass the exact attachment revision returned by get.",
                        2,
                    ));
                }
                Some(value)
            } else {
                None
            };
            let rename = if command == "attachment-rename" {
                let value = parse_input::<AttachmentRenameInput>(&args, stdin)?;
                if value.name.trim().is_empty()
                    || value.name.contains(['/', '\\'])
                    || value.name == "."
                    || value.name == ".."
                    || value.name.chars().count() > 200
                {
                    return Err(error(
                        "INVALID_ARGUMENT",
                        "Use a filename stem of 1-200 characters without path separators.",
                        2,
                    ));
                }
                Some(value.name)
            } else {
                None
            };
            let replacement = if command == "attachment-replace" {
                Some(parse_input::<AttachmentReplaceInput>(&args, stdin)?.path)
            } else {
                None
            };
            if !args.root.is_dir() {
                return Err(storage_error("LIBRARY_NOT_FOUND".into()));
            }
            let _guard = operation_lock(&args.root, false).map_err(storage_error)?;
            let store = Store::agent_existing(args.root.clone()).map_err(storage_error)?;
            match command {
                "list" => {
                    let snapshot = store.agent_snapshot().map_err(storage_error)?;
                    let records: Vec<Value> = snapshot.records.iter().map(|record| json!({"id": record.id, "category": record.category, "title": record.title, "updatedAt": record.updated_at, "fieldCount": record.fields.len(), "attachmentCount": snapshot.attachments.iter().filter(|file| file.metadata.record_id == record.id).count()})).collect();
                    json!({"records": records, "dataDir": snapshot.data_dir, "categories": snapshot.categories, "categoriesRevision": snapshot.categories_revision})
                }
                "get" => {
                    let snapshot = store.agent_snapshot().map_err(storage_error)?;
                    let record = snapshot
                        .records
                        .into_iter()
                        .find(|record| Some(record.id.as_str()) == id)
                        .ok_or_else(|| storage_error("RECORD_NOT_FOUND".into()))?;
                    let attachments: Vec<_> = snapshot
                        .attachments
                        .into_iter()
                        .filter(|file| file.metadata.record_id == record.id)
                        .collect();
                    json!({"record": record, "attachments": attachments, "dataDir": snapshot.data_dir, "categories": snapshot.categories, "categoriesRevision": snapshot.categories_revision})
                }
                "update" => {
                    json!({"record": store.agent_update(record.unwrap(), expected.unwrap()).map_err(storage_error)?, "dataDir": display_path(store.root())})
                }
                "attach" => {
                    json!({"attachments": store.import_dropped_files(id.unwrap(), &paths.unwrap()).map_err(storage_error)?, "dataDir": display_path(store.root())})
                }
                "field-update" => {
                    json!({"record": store.agent_field_update(id.unwrap(), field_id.unwrap(), expected.unwrap(), patch.as_ref().unwrap()).map_err(storage_error)?, "dataDir": display_path(store.root())})
                }
                "field-delete" => {
                    json!({"record": store.agent_field_delete(id.unwrap(), field_id.unwrap(), expected.unwrap()).map_err(storage_error)?, "deletedFieldId": field_id.unwrap(), "dataDir": display_path(store.root())})
                }
                "attachment-rename" => {
                    json!({"attachment": store.agent_attachment_rename(id.unwrap(), attachment_id.unwrap(), revision.unwrap(), rename.as_ref().unwrap()).map_err(storage_error)?, "dataDir": display_path(store.root())})
                }
                "attachment-replace" => {
                    let (attachment, previous_path) = store
                        .agent_attachment_replace(
                            id.unwrap(),
                            attachment_id.unwrap(),
                            revision.unwrap(),
                            replacement.as_ref().unwrap(),
                        )
                        .map_err(storage_error)?;
                    json!({"attachment": attachment, "previousPath": previous_path, "dataDir": display_path(store.root())})
                }
                "attachment-delete" => {
                    store
                        .agent_attachment_delete(
                            id.unwrap(),
                            attachment_id.unwrap(),
                            revision.unwrap(),
                        )
                        .map_err(storage_error)?;
                    json!({"deleted": true, "attachmentId": attachment_id.unwrap(), "recordId": id.unwrap(), "dataDir": display_path(store.root())})
                }
                _ => unreachable!(),
            }
        }
    };
    Ok(json!({"ok": true, "command": command, "data": value}))
}

pub fn main_entry(args: impl Iterator<Item = OsString>) -> i32 {
    let values: Vec<_> = args.collect();
    if values.is_empty()
        || values.as_slice() == [OsString::from("--help")]
        || values.as_slice() == [OsString::from("help")]
    {
        print!("{HELP}");
        return 0;
    }
    let root = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("data")));
    let result = root
        .ok_or_else(|| {
            error(
                "ENVIRONMENT_ERROR",
                "Cannot locate the executable directory.",
                1,
            )
        })
        .and_then(|root| arguments(values, root))
        .and_then(|args| execute(args, &mut std::io::stdin().lock()));
    match result {
        Ok(value) => {
            let mut stdout = std::io::stdout().lock();
            if writeln!(stdout, "{value}").is_err() {
                return 1;
            }
            0
        }
        Err(failure) => {
            let value =
                json!({"ok": false, "error": {"code": failure.code, "message": failure.message}});
            let _ = writeln!(std::io::stderr().lock(), "{value}");
            failure.exit
        }
    }
}

#[cfg(test)]
mod tests;
