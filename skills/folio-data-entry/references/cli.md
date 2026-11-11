# Folio backend CLI

The CLI is a local executable shipped beside Folio. It does not launch the desktop interface or expose a network port. Use its `schema` command to check the installed version's exact contract.

## Invocation

```powershell
$folioCli = 'D:\Apps\Folio\folio-cli.exe'
$folioData = 'D:\Apps\Folio\data'
& $folioCli --data-dir $folioData info
& $folioCli --data-dir $folioData schema
& $folioCli --data-dir $folioData categories
& $folioCli --data-dir $folioData list
& $folioCli --data-dir $folioData validate --input 'D:\PrivateWork\record.json'
& $folioCli --data-dir $folioData create --input 'D:\PrivateWork\record.json'
& $folioCli --data-dir $folioData get --id '30a81577-b68d-449a-9d4a-0b1c5398b231'
```

These paths and the UUID are illustrative. Resolve the actual executable and library, and generate a new UUID for each genuinely new record. Read-only commands and validation do not initialize an empty vault. On an empty path, `categories` and `schema` return the nine builtin definitions with revision `builtin-v1` without creating files. Creation can initialize the explicitly chosen data directory only after its category has been validated.

On an explicitly selected new library, `info` reports `libraryExists: false`, and `list` or `get` returns `LIBRARY_NOT_FOUND` with exit code 1. This is expected before the first successful `create`. If the user intended an existing library, correct the path instead of creating an empty replacement.

| Command | Effect |
| --- | --- |
| `info` | Report the resolved data directory and whether a library exists. |
| `schema` | Describe accepted inputs, capabilities, and the selected library's current category IDs and definitions. |
| `categories` | Read the ordered category definitions and their catalog revision. |
| `list` | List active record summaries. |
| `get --id UUID` | Read an active record and its attachments. |
| `validate --input FILE` | Validate a record payload without writing the library. |
| `create --input FILE` | Create a new record; reject an existing ID. |
| `update --input FILE --expected-updated-at VALUE` | Replace an active record only if its stored revision still matches. |
| `attach --record-id UUID --input FILE` | Import the JSON array of local source paths into that record. |
| `field-update --record-id UUID --field-id ID --expected-updated-at VALUE --input FILE` | Patch only the specified properties of one field, preserving its ID and position. |
| `field-delete --record-id UUID --field-id ID --expected-updated-at VALUE` | Delete only that field, preserving the order of remaining fields. |
| `attachment-rename --record-id UUID --attachment-id UUID --expected-revision TOKEN --input FILE` | Rename the managed file using a filename suffix. |
| `attachment-replace --record-id UUID --attachment-id UUID --expected-revision TOKEN --input FILE` | Replace an attachment's bytes while preserving its ID and record association. |
| `attachment-delete --record-id UUID --attachment-id UUID --expected-revision TOKEN` | Soft-delete only that active attachment. |

The installed CLI's `schema` returns `capabilities`; check for the intended command before using a version that may predate targeted edits. Schema version 2 adds field and attachment editing. Schema version 3 adds `categories.read` and discovers category definitions and the record category enum from the selected library. Mutation results include `data.record` for field edits/deletion, `data.attachment` for attachment rename/replacement, and `data.deleted: true` plus the removed IDs for attachment deletion. Replacement also returns `data.previousPath`.

## Category discovery

`categories` returns `data.categories`, `data.revision`, and `data.dataDir`. Each ordered definition has `id`, `nameEn`, `nameZh`, and `icon`. `schema`, `list`, and `get` also return `data.categories` and `data.categoriesRevision`. Names and icons can be customized, and the catalog order controls the desktop's category display. Use the exact ID from the intended library; translating, renaming, or reordering a category does not change that ID or move its records and existing attachment files.

The nine builtin IDs remain `identity`, `education`, `experience`, `research`, `awards`, `skills`, `contacts`, `documents`, and `custom`. Additional IDs use `collection-<canonical lowercase UUID>`. Do not generate a custom category ID in a record payload before the category exists: `validate`, `create`, and `update` require registry membership and return `UNKNOWN_CATEGORY` for an unregistered ID. Match the user's requested category using the current English and Chinese names; ask about a material ambiguity instead of silently selecting an unrelated builtin category.

Category definitions are edited in Folio's category manager; the CLI does not expose catalog mutation. The catalog supports additions, edits, and reordering, with at most 100 categories; existing categories cannot be removed. Both names are trimmed, contain 1-60 Unicode characters without control characters, and must be unique within their locale after case-insensitive comparison. `schema.categoryIcons` provides the curated icon identifiers. The category catalog has its own opaque revision, independent of record timestamps and attachment tokens. A stale catalog save returns `CATEGORY_CONFLICT`, and invalid definitions return `INVALID_CATEGORIES`.

Backups containing customized definitions or order use backup schema 2 and preserve the complete ordered catalog. Exact default catalogs continue to export backup schema 1 for compatibility. Folio accepts legacy schema 1 backups with the default nine categories and validates all record category references before replacing a vault. Restore assigns a fresh category catalog revision; category revisions are not exported. A backup restore replaces the catalog along with the vault and retains the previous vault for recovery.

## Record payload

```json
{
  "id": "30a81577-b68d-449a-9d4a-0b1c5398b231",
  "category": "contacts",
  "title": "Example contact",
  "subtitle": "Synthetic skill example",
  "tags": ["Example"],
  "favorite": false,
  "notes": "",
  "fields": [
    {
      "id": "email",
      "label": "Email",
      "labelZh": "邮箱",
      "value": "example@example.invalid",
      "kind": "email",
      "sensitive": false
    }
  ]
}
```

The backend manages creation and modification timestamps. For updates, retain the exact `updatedAt` returned by `get` as the `--expected-updated-at` value, rather than generating one or changing its formatting. Existing timestamps in a fetched record do not authorize an overwrite by themselves.

PowerShell can convert JSON timestamps to `DateTime` values and change their formatting. In PowerShell 7.5 or newer, use `ConvertFrom-Json -DateKind String` to retain the exact revision. In older shells, use a JSON parser that preserves strings, such as Node.js `JSON.parse` or Python `json.loads`, instead of converting a timestamp back from a date object.

```powershell
$raw = & $folioCli --data-dir $folioData get --id $recordId
if ($LASTEXITCODE -ne 0) { throw 'Could not read the current record.' }
$reply = $raw | ConvertFrom-Json -DateKind String
$expectedRevision = $reply.data.record.updatedAt
$record = $reply.data.record
# Modify only the requested properties, then serialize the complete record as UTF-8 JSON.
# Pass $expectedRevision unchanged to update --expected-updated-at.
```

Use a category ID discovered from this library's `categories` or `schema` output. Field kinds are `text`, `multiline`, `date`, `email`, `phone`, and `url`. Record IDs use canonical lowercase UUIDs. Field IDs are unique, nonempty strings within their record; preserve existing IDs when changing values or order. Consult `schema` for current size and validation limits.

An attachment payload is a JSON array such as `["D:\\Documents\\example-certificate.pdf", "D:\\Pictures\\example-portrait.png"]`. Pass local regular files, not directories, URLs, network shares, or Windows alternate streams. The importer accepts at most 100 paths per command and 2 GiB per file, preserves the original source files, and rejects unsafe sources. It may copy a previously imported source again if explicitly invoked again.

## Targeted field changes

Read the current record and identify the field by its stable `id`, not its translated label or array index. `field-update` accepts a nonempty JSON object containing any of `label`, `labelZh`, `value`, `kind`, and `sensitive`. Omitted properties stay unchanged. Set `labelZh` to `null` to remove the Chinese label; other properties reject `null`. A patch cannot change a field ID, move it, or add a new field. Existing record and field validation limits still apply.

```json
{
  "value": "updated@example.invalid",
  "sensitive": true,
  "labelZh": "邮箱"
}
```

```powershell
& $folioCli --data-dir $folioData field-update --record-id $recordId --field-id 'email' --expected-updated-at $expectedRevision --input 'D:\PrivateWork\field-patch.json'
# Read get again before a subsequent edit or deletion; the record revision has advanced.
& $folioCli --data-dir $folioData field-delete --record-id $recordId --field-id 'email' --expected-updated-at $latestRevision
```

Both commands compare and advance the record's `updatedAt` inside a transaction. They preserve unrelated record properties and all other fields. Deletion removes the field from the record immediately and has no field trash or CLI undo. A missing field returns `FIELD_NOT_FOUND`, and a stale record revision returns `RECORD_CONFLICT`. Keep the user's requested target precise; a missing ID does not authorize deletion of a similarly named field.

## Existing attachment changes

Use the selected attachment's own `revision` from `get`, together with its `id` and parent record ID. The revision is an opaque string; it is not the record's timestamp or a content checksum. Legacy attachments receive a stable derived token on read without a database write. Successful GUI and CLI changes rotate tokens, including replacing a file with the same size or name. A restored backup receives fresh tokens, and exported backup manifests omit them.

`attachment-rename` takes `{"name":"passport"}`. Supply the suffix only; the backend adds the current record category and preserves the existing extension, for example `identity_passport.pdf`. Names are normalized using the same rules as the desktop. Path separators and empty names are rejected, and occupied destinations are never overwritten.

`attachment-replace` takes `{"path":"D:\\Documents\\replacement.pdf"}`. It accepts one absolute local regular file up to 2 GiB and applies the same source-path protections as import. Replacement preserves attachment ID, record ID, and creation time; it changes the source filename, byte size, managed path, extension, and revision. The new managed name retains a shortened current suffix and appends a fresh 12-hex version suffix, for example `identity_passport-83fe4a697bd1.pdf`.

```powershell
# Obtain $attachmentId and $attachmentRevision from the latest get result.
& $folioCli --data-dir $folioData attachment-rename --record-id $recordId --attachment-id $attachmentId --expected-revision $attachmentRevision --input 'D:\PrivateWork\rename.json'
# Read get again to obtain the next revision before another command.
& $folioCli --data-dir $folioData attachment-replace --record-id $recordId --attachment-id $attachmentId --expected-revision $nextRevision --input 'D:\PrivateWork\replacement.json'
& $folioCli --data-dir $folioData attachment-delete --record-id $recordId --attachment-id $attachmentId --expected-revision $latestAttachmentRevision
```

Replacement writes and syncs a new managed copy before committing metadata. Failed replacements leave the active attachment and original source unchanged. The previous managed bytes remain at `data.previousPath` as an unreferenced recovery copy; they are excluded from normal lists and backup exports. Their old filename remains occupied, so a later rename to that exact name fails safely while the file exists. Repeated replacements can retain multiple prior copies. Do not remove those copies or the original source unless the user separately requests that cleanup.

`attachment-delete` uses soft deletion, retaining the managed bytes while hiding that ID from normal reads, previews, and mutations. It is not secure erasure. The CLI has no restore command; do not invent an undo action or edit database flags. Verify the requested ID is absent from the active attachment list after success. Other attachments and the parent record stay unchanged.

`ATTACHMENT_CONFLICT` means the attachment revision changed; reread `get` and reconcile before proceeding. `ATTACHMENT_NOT_FOUND` means no active attachment with that ID belongs to the supplied record, which includes removed attachments and incorrect parent associations. A stale GUI rename or deletion is also rejected when it supplies the old attachment revision.

## Results and recovery

Success is JSON on stdout with `ok: true`, `command`, and `data`. Failure is JSON on stderr with `ok: false` and `error.code` / `error.message`. Exit 0 means success, 2 means invalid command usage or input, 3 means a record or attachment revision conflict, and other failures use exit 1. Check the exit code before parsing a success result.

After an unknown create outcome, read the same UUID and compare the requested contents. An existing ID is not proof that this attempt succeeded. After an unknown field or attachment mutation, inspect the current values, active IDs, managed filename, size, and revision before deciding whether work remains. For replacement, inspect the resulting managed file when its name and size are insufficient to verify the intended content. Missing IDs may confirm a requested deletion, but never justify deleting a different item. Import and replacement must not be retried blindly. Do not retry an entire record-plus-attachment workflow as though it were one transaction.

If an update conflicts, keep the proposed values, read the current record, and merge only changes authorized by the user. Preserve unrelated new fields and attachments. A local busy result means another Folio operation holds the library lock; wait for that operation and retry within the user's task scope. Stop and report a persistent failure instead of looping indefinitely or bypassing backend checks.
