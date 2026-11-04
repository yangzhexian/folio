---
name: folio-data-entry
description: "Create and update local Folio records, edit or delete individual fields, and import, rename, replace, or remove attachments through the Folio backend CLI. Use when a user asks an agent to enter or maintain information and files in their Folio library."
---

# Folio Data Entry

Use `folio-cli` to enter user-provided information directly through Folio's local backend. Keep the user's existing fields, attachment relationships, and intended library location intact. Do not edit SQLite files or copy files directly into the managed attachment directory.

## Locate the intended library

Find `folio-cli.exe` beside the installed `Folio.exe`, in a supplied release folder, or on PATH. A source checkout can build it with `npm run backend:build`. Do not assume that a repository's development vault is the user's installed library.

Run `folio-cli --data-dir <absolute-data-directory> info` and inspect the resolved path and existence before reading or writing. The directory is Folio's `data` directory, containing `vault/folio.sqlite3`, not the `vault` directory itself. Without `--data-dir`, the CLI uses `data` beside its executable. Use an explicit path once the intended library is identified. The application's Settings panel displays that path. If multiple plausible libraries exist and the user's context does not resolve the choice, ask which one to use; do not create a new library merely because a guessed path is empty.

## Prepare and enter records

Read [references/cli.md](references/cli.md) for commands, the record example, exit codes, and retry behavior. Use the installed CLI's `schema` output as the authoritative input contract. Write payloads as UTF-8 JSON with a serializer; do not place sensitive values in command-line arguments or shell-built JSON strings. Keep working payloads outside version control and remove transient copies after verification when they are no longer needed.

Use only supplied or verified information. Preserve original spelling and values, leave unavailable fields empty or omit them, and avoid inventing dates, identifiers, credentials, or translations of the person's content. Field labels may have English `label` and Chinese `labelZh` values. Mark identity numbers and other user-designated private fields as sensitive; masking is not encryption. Field array order becomes the display order.

For a new record, generate one canonical lowercase UUID and retain it through validation, creation, and any retry. Check `list` or the relevant `get` result first when the request refers to an existing entry. Run `validate --input <record.json>` before `create --input <record.json>`. Creation must not overwrite an existing ID.

Read `get --id <id>` before an update. For one existing field, prefer `field-update --record-id <id> --field-id <field-id> --expected-updated-at <record.updatedAt> --input <patch.json>`; only supplied editable properties change, and field ID/order are preserved. Use `field-delete` with those identifiers and revision when the user requests removal of that field. Field deletion has no separate trash or CLI undo; keep any values needed for the user's requested recovery outside the active library until verified.

Use `update --input <record.json> --expected-updated-at <record.updatedAt>` for complete record changes, additions, or reordering that the targeted commands cannot express. This replaces record content, so preserve unrelated fields and properties. Pass the exact timestamp string returned by `get`. On a revision conflict, reread and reconcile the requested change with the latest contents; do not blindly retry or remove another editor's changes.

The user's request to enter, edit, replace, or remove the specified data authorizes that work; do not add a separate confirmation ritual. Ask only when a material value, target library, deletion target, replacement scope, or conflicting instruction cannot be resolved from context.

## Attach and verify

Use `attach --record-id <id> --input <paths.json>` with a JSON array of absolute source-file paths. The backend validates and copies the originals, assigns managed names, and records the relationship. Record creation and attachment import are separate operations; retain and report a successfully created record if the later attachment step fails. Do not claim the whole workflow rolled back.

For an existing attachment, take its ID and opaque `revision` from the latest `get`. Use `attachment-rename`, `attachment-replace`, or `attachment-delete` with `--record-id`, `--attachment-id`, and `--expected-revision`. Rename and replacement take JSON input described in [references/cli.md](references/cli.md). Do not substitute the record timestamp for an attachment revision. These commands keep the attachment associated with the same record, and revision conflicts require a fresh read before any reconciliation.

Replacement publishes a fresh managed filename while retaining the attachment ID. Its `previousPath` points to the unchanged prior managed bytes retained for recovery; those unreferenced bytes are not part of normal attachment lists or exports. The original source is also preserved. The old managed filename remains occupied, so do not promise that a later rename can reuse it. Attachment deletion is a soft deletion: normal reads and previews hide the ID, while its bytes remain on disk. Neither deletion nor replacement is a secure erase operation, and no attachment undo command is exposed by the CLI.

Check exit status and the structured result after each mutation. Verify with `get --id <id>` before reporting completion, including the targeted field or attachment, unrelated content that must be preserved, and absence of removed IDs. If a command's outcome is unknown, inspect the latest record and attachments before retrying. Reusing the same record UUID prevents duplicate record creation. Attachment import and replacement are not idempotent, and every successful mutation may advance its revision; do not retry a workflow blindly.

All file processing remains local. Do not upload records or attachments or start a network service for this workflow. Folio can stay open: backend operations coordinate through a local lock, and the desktop refreshes on focus when no editor or operation is active. A busy result is retryable after the competing operation finishes; do not terminate Folio or discard an open editor to force a write. Report the record IDs, what changed, attachment outcomes, and any unresolved conflicts without unnecessarily repeating sensitive values.
