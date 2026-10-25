# Folio roadmap

This roadmap tracks the delivered 0.4.0 preview foundation and proposed follow-up work. The remaining items are planned, not released, and their order reflects user value and implementation dependencies rather than promised dates. Folio should remain a small, bilingual desktop library whose records, attachments, indexes, and backups stay on the user's computer.

## Current foundation

Folio supports structured records, bilingual field search, direct value copying, positional field insertion, pointer and keyboard field ordering, local attachment import, managed filenames, built-in PNG/JPG/JPEG and PDF preview, light and dark themes, and manual ZIP backup and restore. Data is stored beside the executable in `data`. Deleted items are retained on disk with a short Undo action, but there is no persistent trash interface. Records, attachments, and backups are not encrypted.

## Delivered: the attachment preview foundation

Version 0.4.0 opens supported attachments in a compact, bilingual preview dialog with zoom, fit, drag-to-pan, and attachment switching. PDFs support previous/next page and direct page entry. Navigation stays within the current record or the filtered Files results. **Open externally**, **Copy path**, and **Show in folder** remain available. Unsupported formats continue to open externally. Escape returns focus to the filename, and a failed or slow preview does not prevent switching or closing.

| Follow-up | Proposed behavior | Acceptance checks |
| --- | --- | --- |
| Images | Add temporary rotation and an explicit actual-size mode alongside the fitted view. | Rotation never modifies the source file; transparent images, portrait photos, and Unicode filenames stay usable. |
| PDF | Add text selection, document search where a text layer exists, and fit-width mode. | Chinese and English text works offline; scanned pages do not imply OCR; selection and search remain usable while zooming. |
| Protected documents | Evaluate a local password prompt. | Passwords remain transient and are never saved with records or logs; cancellation and retry destroy the previous loading task. |
| Larger files | Measure the current bounded-read limits and evaluate scoped streaming if needed. | Large or malformed files cannot indefinitely block editing or navigation; decoded pages, object URLs, and workers remain bounded. |

The implemented PDF viewer uses a locally bundled PDF.js display layer and worker, with fonts, character maps, color profiles, and decoders shipped with Folio. It renders pages onto a canvas, without a scripting layer or interactive form controls. No CDN or hosted document viewer is used. See the official [PDF.js architecture and distribution guide](https://mozilla.github.io/pdf.js/getting_started/) and [rendering examples](https://mozilla.github.io/pdf.js/examples/).

Rust resolves only active attachment IDs with active parent records, validates the managed path, and returns bounded binary IPC data. Images are limited to 32 MiB, 16,384 pixels per side, and 40 million pixels total; PDFs are limited to 64 MiB. PDF backing canvases are capped at 16 million pixels and 8192 pixels per side. The CSP permits bundled workers, same-origin assets, local blob images/fonts, and local WASM decoding while keeping remote connections blocked. Future preview changes should preserve these boundaries. Tauri's [capability guidance](https://v2.tauri.app/security/capabilities/) and [CSP guidance](https://v2.tauri.app/security/csp/) remain relevant; custom Rust commands still need their own input and path validation.

## Next: smoother everyday use

| Priority | Proposed improvement | Acceptance checks |
| --- | --- | --- |
| High | Preserve an unsaved editor draft after an unexpected close, with a clear restore/discard choice on reopening. | Restoring a draft never overwrites a saved record automatically; discard removes the draft; drafts stay local and follow any future vault protection design. |
| High | Make keyboard actions consistent across search, record lists, editors, calendars, and attachment previews; provide a small shortcut reference. | Tab order and visible focus work in both languages; shortcuts do not trigger behind dialogs or interfere with text entry; screen-reader labels describe icon buttons. |
| High | Improve import feedback with a per-file outcome and progress for larger batches while retaining safe retry behavior. | Cancel and retry have documented results, completed files do not duplicate, and originals remain unchanged. |
| Medium | Remember window size, selected record, and pane widths; add a comfortable compact layout without extra permanent toolbar text. | Restored windows remain visible after monitor changes; the minimum supported size has no clipped primary actions; long labels and filenames remain accessible. |
| Medium | Let users duplicate a record as a starting point and save reusable personal templates. | New records receive independent IDs; the user explicitly chooses whether values are copied; attachment copies and links are never created implicitly. |

## Next: visible recovery and safer maintenance

Add a persistent **Trash** view for deleted records and removed attachments, with their deletion time, a restore action, and a clearly separated permanent-delete action. This completes the existing soft-delete design: recovery should remain available after the current 12-second Undo notification disappears. Restore must preserve record relationships and handle filename conflicts without overwriting files. Permanent deletion needs a concise confirmation and must not claim secure erasure.

Improve backup management with the last successful backup time, an optional reminder, archive verification before restore, and a clear summary of the library that will be replaced. Keep manual export usable without background tasks. An optional local rotation policy can follow once retention, destination failure, disk space, and interruption recovery are tested. Never delete recovery folders or the only known good backup implicitly.

Offer a **Library health** action that reports missing or changed attachments and retained recovery folders. Start with a read-only report and user-directed repair or cleanup. Acceptance checks should cover corrupted archives, missing files, interrupted writes, installer upgrades, and recovery using a disposable Windows library in addition to existing Rust and browser tests.

## Later: larger libraries and richer retrieval

The current UI loads a complete snapshot and filters it in memory. Establish repeatable measurements with synthetic libraries at several sizes before changing that architecture. Measure startup, search latency, import responsiveness, and peak memory. Introduce paged queries, an SQLite search index, or list virtualization only where those measurements show a benefit, while preserving bilingual synonyms, sensitive-field masking, stable sorting, and selection behavior.

Then consider batch tagging, explicit duplicate-file detection, and CSV/JSON import with field mapping and a preview of changes. Imports should report validation errors before writing and offer a dry run. Detecting identical files should suggest an action rather than silently merging records or deleting originals.

Optional offline OCR for scanned attachments is a separate later feature. It should require an explicit action, show progress and cancellation, retain the original file, and identify extracted text as machine-generated. Evaluate Chinese and English accuracy, model distribution size, local indexing, and deletion of derived text before committing to an implementation. OCR is not part of the initial PDF preview.

## Later: optional vault protection

Evaluate encryption only as a complete vault design covering the SQLite database, attachments, search indexes, thumbnails, drafts, temporary preview files, and backups. Define key derivation and storage, unlock behavior, recovery expectations, migration, and backup compatibility before adding a password screen. Use reviewed cryptographic components and seek a focused security review. A screen lock or masked field alone must never be presented as encryption.

Cloud synchronization and hosted processing are outside this roadmap. Any future proposal that changes where personal data is stored or processed requires a separate product decision and explicit user control.

## Delivery checks

Ship each milestone as a focused Conventional Commit series with an updated README and release notes. Keep browser tests based on synthetic data, retain Rust tests for filesystem and recovery behavior, and run native Windows checks for preview rendering, file associations, offline launch, and installer upgrade behavior. Validate both interface languages, light/dark appearance, keyboard use, and the minimum supported window size before calling a feature complete.
