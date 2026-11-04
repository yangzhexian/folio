# Folio

A small desktop library for personal details, education, experience, research, contacts, and supporting documents. Folio uses Tauri 2, React, TypeScript, and SQLite to keep records and managed files on your computer. Its interface supports English and Simplified Chinese.

[![Folio introduction: organize personal details, find and copy fields, manage files, and choose your appearance](docs/media/folio-preview.gif)](docs/media/folio-intro.mp4)

**[Watch or download the full introduction](docs/media/folio-intro.mp4)**: 60.6 seconds, 2K (2560 × 1440), English titles with Chinese captions and original instrumental music. The right-hand window follows one uninterrupted operation from search and editing through image/PDF preview, file management, and appearance changes. The embedded 1080p GIF (1920 × 1080) shows the complete approximately 60-second tour at normal speed; a [static poster](docs/media/folio-poster.png) is also available. All records shown are fictional demonstration data captured in Folio 0.4.1. Built with [Remotion](https://github.com/remotion-dev/remotion); [storyboard](video/storyboard.md) and [source and reproduction instructions](video/README.md).

Download the Windows installer from [Folio v0.4.1](https://github.com/yangzhexian/folio/releases/tag/v0.4.1). The release also includes a portable desktop/CLI package, the agent skill, and file checksums.

## Features

- Create records from bilingual templates or start with custom fields.
- Search titles, field names, values, notes, tags, and attachment names with bilingual field synonyms; copy or locate matching fields directly from results.
- Insert fields at any position and reorder them by dragging or keyboard; navigate the date calendar by month or year.
- Sort records by modification time, creation time, or title in either direction; keep the chosen order across sessions.
- Copy individual values or a formatted record. Sensitive fields are masked in the detail view and excluded from full-record copying.
- Keep multiple education, work, project, publication, award, certificate, or contact records without forcing everything into a single form.
- Attach local files, give them consistent names, open them with the default application, copy their full paths, and reveal them in the system file manager.
- Preview PNG, JPG/JPEG, and PDF attachments inside Folio with zoom, attachment switching, and PDF page navigation; all decoding happens locally.
- Drop files onto a record, or choose a destination after dropping into the file library.
- Use light or dark appearance with five accent colors; the default remains light sage.
- Export a local backup and restore an existing library from it.
- Let agents enter data through a local CLI and reusable skill, with validated JSON, revision-checked updates, and managed attachment imports.

## Development

Install a current Node.js LTS release, Rust with the MSVC toolchain, Microsoft C++ Build Tools, and Microsoft Edge WebView2 on Windows. The exact platform prerequisites are maintained in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/). The desktop bundle in this repository targets Windows NSIS installers.

```powershell
npm install
npm run desktop
```

The first desktop build downloads Rust dependencies and can take several minutes. Dependency installation and building may require internet access; the installed application's personal-library features work locally.

```powershell
npm run desktop:build
```

The build first compiles `folio-cli.exe`, then bundles it and the data-entry skill with the desktop application. The executables are under `src-tauri/target/release/`; Windows installers are under `src-tauri/target/release/bundle/nsis/`. `src-tauri/tauri.release.conf.json` maps the CLI, skill, and license into the installation directory without making development builds depend on previously built release files. The build wrapper remaps Rust source paths to portable prefixes, keeping machine-specific home and checkout paths out of release binaries.

To inspect just the interface, run `npm run dev` and open `http://127.0.0.1:1420`. Browser preview uses synthetic example records held in memory. Changes reset on reload, and native file and backup operations require the desktop application. The browser preview never loads your desktop database.

## Using the library

Choose **New** in the record list toolbar, select a template, and fill only the fields you need. At compact window widths, this button appears as **+**, with a **New record** tooltip. **Edit** lets you change the title, collection, tags, notes, and field definitions; custom fields can also have separate English and Chinese labels. Search accepts multiple words, including Chinese text, and requires every word to match somewhere in a record or its attachment names.

Matching fields appear under each record in search results, with a copy action and a click target that scrolls to the field in the detail pane. Sensitive values remain masked in these results while **Settings → Hide sensitive fields** is enabled. Search recognizes common variants such as `QQ 号` / `QQ号`, `mobile` / `phone` / `手机` / `手机号`, and `document number` / `证件号` / `身份证号`, plus email, WeChat, address, postal code, and birth-date labels. Synonyms are based on field names; literal values remain searchable.

Each field has an **Add field** control below it that inserts immediately after that field. A control above the first field inserts at the beginning. Drag a field's grip to reorder it; holding near the editor's top or bottom scrolls the list, and **Escape** cancels the drag. With a grip focused, **Up**, **Down**, **Home**, and **End** move the field while preserving its contents. Open a date field's calendar to browse dates. Its header places **Previous year** and **Next year** outside the month navigation buttons. Browsing months or years only changes the displayed calendar; the field changes when a day is selected. Dates can also be entered as `YYYY-MM-DD`. New contact templates no longer include a student rail destination; existing saved fields are preserved.

The list toolbar also offers six sort orders: modification time or creation time with newest or oldest first, and title in ascending or descending order. The default is most recently modified first. The chosen order persists across searches, collections, language changes, and restarts; changing it keeps the current record selected. Title ordering follows the interface language and compares embedded numbers naturally.

**Settings → Hide sensitive fields** is enabled by default. The eye button immediately before **Copy record** shows or hides all nonempty sensitive fields in the selected record; individual eye buttons remain available. Switching records or enabling masking again clears temporary reveals. Disable the setting to show values normally in both details and search results and remove all show/hide controls. The preference persists across restarts and does not change which fields are marked sensitive or which values **Copy record** excludes.

Use the star to keep frequently used records in **Favorites**. Individual field copy buttons copy the actual value, including a sensitive value when explicitly requested. **Copy record** omits fields marked sensitive. Masking is a display convenience rather than encryption, and searching still includes sensitive field values. Notes and ordinary fields are copied as entered, so place values that need masking in a sensitive field.

Use **Add files** from a saved record to copy supporting documents into the managed library. Import keeps the original file in its original location. Click a PNG, JPG/JPEG, or PDF filename to open Folio's independent preview window; other formats open with the operating system's default application. The preview also provides **Open externally**, **Copy path**, and **Show in folder**. Change the interface language in **Settings**; this changes interface and template labels without translating your own record content.

The desktop preview has its own title bar and native minimize, maximize, move, and resize controls. Its **Keep on top** button keeps it above other windows until unpinned. The main library remains usable, and opening another supported attachment reuses the preview window. Language and appearance changes follow the main window. Active previews refresh when an attachment is renamed, replaced, or removed; a replacement resets its page and zoom. Closing the main window closes its preview. Browser-only demonstrations use an embedded viewer.

The preview's top arrows switch between supported attachments in the current record, or the current filtered results in **Files**. Use the bottom controls to zoom from 25% to 400% relative to the fitted view and return to **Fit to view**. Drag an enlarged image or PDF page to pan; scrolling remains available. PDFs provide previous/next page and direct page entry. **Left/Right** switch attachments, **Page Up/Page Down** turn PDF pages, **+/-** zoom, **0** fits the view, and **Escape** closes the preview; the embedded browser viewer returns focus to the filename. Shortcuts do not interfere with page-number entry.

Preview reads only active managed attachments by ID and never changes their contents. Images are limited to 32 MiB, 16,384 pixels on either side, and 40 million pixels in total; PDFs are limited to 64 MiB. Large, unavailable, damaged, or password-protected files show a concise fallback message and can still be opened externally. PDF.js, its worker, fonts, character maps, color profiles, and decoders ship with the application. No file is uploaded and no CDN or hosted viewer is used. PDF preview renders pages without running document scripts or interactive forms. PDF text selection, document search, OCR, and an in-app password prompt are not part of this version.

Drag one or more files from Windows Explorer onto Folio to import them. When a record is open, the drop overlay shows its title and files attach to that record. In **Files**, an empty library, or a view without a selected record, dropping opens a destination chooser: select an existing record or create a document record with an editable title. Canceling the chooser leaves files untouched. Close open dialogs before dropping files, and wait for a running import to finish. A failed new-document import removes its empty record so the operation can be retried; a failed reload after a completed import only retries loading, avoiding duplicate copies. Drag import accepts local regular files, not folders, URLs, network shares, or Windows alternate streams. The same size and batch limits as file-picker import apply.

Open **Settings → Appearance** to choose **Light** or **Dark** and one of **Sage**, **Blue**, **Violet**, **Rose**, or **Amber**. The sun/moon button in the top bar switches appearance quickly. **Reset appearance** restores the original light sage theme. Theme and color preferences persist across restarts, and the desktop title bar follows the selected light/dark mode.

New managed files follow `collection_12-character-id.extension`, for example `identity_9cedf69724b8.pdf`. **Rename** edits that generated suffix, so entering `passport` produces `identity_passport.pdf`; the collection prefix and safe extension are retained automatically. Spaces become hyphens, unsafe filename characters are sanitized, and Unicode names are retained. Files are stored in separate record folders, and conflicting names within a record are rejected without overwriting either file. Existing filenames remain usable and only change when explicitly renamed. A single import accepts up to 100 regular files, with a maximum of 2 GiB per file.

## Agent data entry

Folio includes [the Folio Data Entry skill](skills/folio-data-entry/SKILL.md) and `folio-cli.exe`. Other agents can create or update structured records and import attachments through the same local Rust backend used by the desktop app. The installer places the CLI beside `Folio.exe` and the skill in `skills/folio-data-entry`. To build only the CLI from source, run `npm run backend:build`.

Install the complete `folio-data-entry` directory in your agent's skill directory, or ask an agent to read its `SKILL.md` directly. For Codex, the usual location is `~/.codex/skills/folio-data-entry`. A request can be as simple as: "Use $folio-data-entry to add the supplied contact and documents to my Folio library." Give the actual data path when the intended library is not already clear.

```powershell
& 'D:\Apps\Folio\folio-cli.exe' --data-dir 'D:\Apps\Folio\data' info
& 'D:\Apps\Folio\folio-cli.exe' schema
& 'D:\Apps\Folio\folio-cli.exe' --data-dir 'D:\Apps\Folio\data' validate --input 'D:\PrivateWork\record.json'
& 'D:\Apps\Folio\folio-cli.exe' --data-dir 'D:\Apps\Folio\data' create --input 'D:\PrivateWork\record.json'
```

These paths are examples. Read [the CLI reference](skills/folio-data-entry/references/cli.md) for the JSON schema, commands, revision checks, exit codes, and safe retry behavior. Agents should inspect `info` before writing, keep sensitive values in UTF-8 input files or stdin, and verify mutations with `get`. The `update` command replaces the complete record and requires its exact previous `updatedAt`; they preserve unrelated fields by reading the latest record first. Importing attachments copies originals into the managed library. Record creation and attachment import are separate operations, and repeating an attachment import can create another copy.

Version 0.4.2 adds `field-update` and `field-delete` for a specific field without replacing unrelated record contents. They require the record's exact `updatedAt`. `attachment-rename`, `attachment-replace`, and `attachment-delete` require an attachment ID, its record ID, and the exact attachment `revision` returned by `get`. Removing an attachment uses the existing soft-delete behavior. Replacement keeps its attachment ID, parent record, and creation time while copying new source bytes into a fresh managed filename; the original source and previous managed file remain intact. The returned previous path is a recovery copy, and its filename stays reserved while it exists. Read the CLI reference before reconciling a conflict or retrying a command whose result is unknown.

Folio can stay open during agent entry. Backend operations share a short-lived local lock, including backup restoration. When Folio regains focus it reloads external changes at a safe boundary, preserving open editors and ongoing operations. If a saved record changed while an editor was open, saving reports a translated conflict and keeps the draft for reconciliation. This workflow starts no network listener and never requires agents to edit SQLite or the managed attachment directory directly.

## Privacy and storage

Folio does not require an account, run a cloud synchronization service, or send your personal records to a remote server. The desktop frontend is bundled with the application and uses Tauri commands for local storage operations. The production content security policy does not allow remote network connections.

The SQLite database, managed attachments, and exported backups are **not encrypted**. Anyone with access to those files can read their contents. Use the operating system's account permissions and disk encryption if that protection is needed. Copying a value places it on the operating system clipboard, which may also be visible to clipboard history or other applications. **Settings → Data folder** shows the actual resolved storage location.

Private sample files are not included in this repository. Git ignores databases, local data directories, build outputs, and test artifacts. Templates describe common information fields; the desktop library starts empty.

The default data directory is `data` beside `Folio.exe`, inside the installation folder. **Settings → Data folder** shows the actual path and provides copy and open actions. The active library contains `data\vault\folio.sqlite3` and `data\vault\attachments\<record-id>\<managed-filename>`. The Windows installer uses a per-user installation; its generated update and uninstall routines preserve this data folder. A custom installation folder must be writable by the current user. Folio shows an actionable error if it cannot write there and never silently selects another location. Interface language, record sorting, theme, and accent preferences are stored in the local webview's storage.

On the first launch without an installation vault, Folio copies an existing library from its previous application-data location (normally `%LOCALAPPDATA%\dev.folio.desktop`). Close other Folio instances before upgrading. Migration validates a staged copy before activating it and leaves the old library untouched. An existing installation vault always takes precedence and is never overwritten by migration. Recovery folders copied from the old location remain under `data\migration-<uuid>`; interrupted completed copies can resume on the next launch. Moving the executable to a different folder also changes its data location, so move the adjacent `data` folder with it to keep using that library.

Deleting a record or removing an attachment hides it from the library and offers **Undo** for 12 seconds. The underlying data and files remain on disk; deletion is not secure erasure, and there is no trash management or permanent-purge interface in this version. After the undo notification expires, recovery requires a backup or manual recovery of the local data.

## Backups and recovery

**Settings → Export backup** creates a local ZIP containing a versioned JSON manifest and the active attachments. It includes sensitive fields in plain text and excludes deleted records and removed attachments. Store backups outside the active vault; the exporter rejects destinations inside it. Copying a backup to another disk is a manual operation, and no background cloud backup is configured.

**Restore backup** replaces the current library after confirmation and validates the archive before switching the active vault. The previous library is retained in a `previous-<uuid>` directory beside `vault`. Restoring is replacement rather than merging, and the interface does not automatically switch back to a recovery copy. Close Folio before manually working with its data directories, keep the existing `vault` under a different name, and copy the chosen recovery directory to `vault` if manual rollback is needed.

The current backup format is version 1. Limits are 2 GiB per attachment, 10 GiB of total uncompressed archive content, a 32 MiB manifest, and 100,000 attachment entries. Export applies the same limits as restore. A missing or externally changed managed file can prevent a complete backup; reimport the correct source file before exporting. Recovery copies are intentionally retained and may consume additional disk space.

## Architecture

| Area | Responsibility |
| --- | --- |
| `src/App.tsx` | Library navigation, record editing, file management, and settings |
| `src/templates.ts` | Bilingual record templates and empty-record creation |
| `src/i18n.ts` | English and Simplified Chinese interface text |
| `src/domain.ts` | Search, localized labels, copy formatting, and file-size formatting |
| `src/FieldEditor.tsx` / `src/fieldEditing.ts` | Pointer and keyboard field ordering and positional insertion |
| `src/DatePicker.tsx` | Editable dates and an inline calendar with month/year navigation |
| `src/sorting.ts` | Chronological and localized title ordering, stable ties, and saved preference validation |
| `src/theme.ts` | Appearance preferences and theme application |
| `src/useFileDrop.ts` | Native drop-event lifecycle and browser navigation protection |
| `src/useExternalChanges.ts` | Deferred focus refresh and stale-snapshot rejection during external editing |
| `src/api.ts` | Tauri command bridge and isolated in-memory browser preview |
| `src/AttachmentPreview.tsx` / `src/PdfPreview.tsx` | Bilingual attachment viewer, bounded image/PDF rendering, navigation, and resource cleanup |
| `src/PreviewWindowApp.tsx` / `src/previewWindow.ts` | Independent preview lifecycle, settings synchronization, and pinning |
| `src-tauri/src/preview_window.rs` | Native preview creation, scoped session metadata, and window lifecycle |
| `src-tauri/src/storage/preview.rs` | Active-file authorization, bounded binary reads, and format/dimension validation |
| `src-tauri/src/cli.rs` / `src-tauri/src/storage/agent.rs` | Structured local CLI, non-overwriting creation, and revision-checked updates |
| `skills/folio-data-entry/` | Agent workflow, input contract, and verification/retry guidance |
| `src-tauri/src/` | SQLite persistence, native dialogs, attachment operations, and backup handling |
| `src-tauri/capabilities/` | Native capabilities exposed to the application window |
| `tests/*.e2e.ts` | Browser interface regression tests with synthetic records |
| `video/` | Separate Remotion project, synthetic UI captures, and original soundtrack generation |

## Roadmap

The next priorities are below. These are proposed improvements, not features in the current release; see the [detailed roadmap and acceptance checks](docs/roadmap.md).

| Order | Focus | Planned outcome |
| --- | --- | --- |
| 1 | Preview follow-ups | Build on the shipped image/PDF viewer with temporary image rotation, PDF text selection and search, and measured improvements for larger documents. |
| 2 | Everyday experience | Recover unsaved drafts, improve keyboard access and import feedback, remember workspace layout, and support reusable personal templates. |
| 3 | Recovery and maintenance | Restore deleted items from a persistent Trash view, improve backup visibility and verification, and report missing or changed attachments. |
| 4 | Larger libraries | Measure performance, add targeted search and list improvements, and consider mapped CSV/JSON imports, batch actions, and optional offline OCR. |
| 5 | Optional protection | Evaluate encryption for the complete vault, including attachments, indexes, drafts, previews, and backups. |

Version 0.4.0 delivers the first attachment-preview milestone: PNG/JPG/JPEG and PDF viewing, zoom, attachment switching, and PDF page navigation. All planned storage and processing remain local.

## Rebuilding the introduction

The video has its own dependency lockfile and is not included in the desktop application bundle. From the repository root:

```powershell
npm ci --prefix video
npm run video:render
```

This generates the full MP4, README GIF preview, and poster in `docs/media/` from the checked-in synthetic captures. Use `npm run video:capture` after interface changes and `npm run video:studio` to edit the animation interactively. See [video/README.md](video/README.md) for browser prerequisites, checks, and the scene timeline.

## Checks

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

If a managed Chromium download is unavailable, Playwright can use an installed Chrome browser instead:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

See [docs/testing.md](docs/testing.md) for test coverage, commands, and the limits of browser testing. Use Conventional Commits for complete changes, for example `feat: add record templates`, `fix: preserve attachment extensions`, or `test: cover record editing`.

## Design references

Folio is built on [Tauri](https://github.com/tauri-apps/tauri). Its compact sidebar and list/detail layout take visual inspiration from [Paperclip](https://github.com/paperclipai/paperclip), adapted to a personal information library.
