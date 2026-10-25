# Folio roadmap

This roadmap describes proposed work after the current 0.3.0 application. The items below are planned, not released, and their order reflects user value and implementation dependencies rather than promised dates. Folio should remain a small, bilingual desktop library whose records, attachments, indexes, and backups stay on the user's computer.

## Current foundation

Folio already supports structured records, bilingual field search, direct value copying, positional field insertion, pointer and keyboard field ordering, local attachment import, managed filenames, opening attachments in the default application, light and dark themes, and manual ZIP backup and restore. Data is stored beside the executable in `data`. Attachments currently open outside Folio; there is no built-in image or PDF viewer. Deleted items are retained on disk with a short Undo action, but there is no persistent trash interface. Records, attachments, and backups are not encrypted.

## First: preview attachments inside Folio

Add a compact preview panel for PNG, JPG/JPEG, and PDF files. Clicking a supported attachment should open its preview in Folio while keeping the parent record accessible. Keep explicit actions for **Open externally**, **Copy path**, and **Show in folder**, including for unsupported formats. Build the image preview first, then reuse its navigation and loading states for PDF.

| Area | Proposed behavior | Acceptance checks |
| --- | --- | --- |
| Images | Fit to panel, actual size, zoom, pan, and temporary rotation; move between the selected record's attachments. | Portrait and landscape images, transparent PNGs, large dimensions, and Unicode filenames display correctly; rotation never modifies the source file. |
| PDF | Page count, previous/next page, direct page entry, fit width, zoom, text selection, and document search where the PDF contains text. | Multipage and Chinese-language documents work offline; scanned PDFs remain viewable without implying OCR; invalid or password-protected files receive a clear supported action or fallback. |
| Interaction | Loading and error states, Escape to close, predictable focus return, and keyboard navigation; preserve the existing record selection. | The viewer remains usable at the application's minimum window size and in both languages and themes; repeated opening and closing does not accumulate render tasks or object URLs. |
| Resource use | Load pages on demand, cancel obsolete rendering, release decoded images and PDF workers when closing, and provide a fallback for files beyond measured preview limits. | Large or malformed files cannot indefinitely block editing or navigation; tests cover rapid attachment switching and a file removed or renamed during preview. |

The proposed PDF implementation uses a locally bundled PDF.js display layer and worker, with the necessary fonts and character maps shipped with Folio. PDF.js documents separate display and viewer layers and supports page rendering with scale and rotation; this allows Folio to use its own compact controls. No CDN or hosted document viewer is required. See the official [PDF.js architecture and distribution guide](https://mozilla.github.io/pdf.js/getting_started/) and [rendering examples](https://mozilla.github.io/pdf.js/examples/).

Extend the existing Rust attachment-ID lookup so the preview can read only active, validated managed files. Do not accept arbitrary paths from the webview or expose a broad filesystem scope to implement preview. Choose a bounded binary-read or scoped streaming design after measuring large PDFs; avoid sending entire large files as base64 JSON. Review CSP changes for bundled workers and local image sources explicitly, retain the restriction on remote connections, and avoid enabling PDF scripting or embedded executable content. Tauri's [capability guidance](https://v2.tauri.app/security/capabilities/) and [CSP guidance](https://v2.tauri.app/security/csp/) define the relevant boundaries; custom Rust commands still need their own input and path validation.

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
