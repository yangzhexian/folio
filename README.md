# Folio

A small desktop library for personal details, education, experience, research, contacts, and supporting documents. Folio uses Tauri 2, React, TypeScript, and SQLite to keep records and managed files on your computer. Its interface supports English and Simplified Chinese.

## Features

- Create records from bilingual templates or start with custom fields.
- Search titles, field names, values, notes, tags, and attachment names; filter by collection or favorites.
- Copy individual values or a formatted record. Sensitive fields are masked in the detail view and excluded from full-record copying.
- Keep multiple education, work, project, publication, award, certificate, or contact records without forcing everything into a single form.
- Attach local files, give them consistent names, copy their full paths, and reveal them in the system file manager.
- Export a local backup and restore an existing library from it.

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

The build places the application executable and Windows installer under `src-tauri/target/release/`. Generated bundles are under `src-tauri/target/release/bundle/nsis/`.

To inspect just the interface, run `npm run dev` and open `http://127.0.0.1:1420`. Browser preview uses synthetic example records held in memory. Changes reset on reload, and native file and backup operations require the desktop application. The browser preview never loads your desktop database.

## Using the library

Choose **New record**, select a template, and fill only the fields you need. **Edit** lets you change the title, collection, tags, notes, and field definitions; custom fields can also have separate English and Chinese labels. Search accepts multiple words, including Chinese text, and requires every word to match somewhere in a record or its attachment names.

Use the star to keep frequently used records in **Favorites**. Individual field copy buttons copy the actual value, including a sensitive value when explicitly requested. **Copy record** omits fields marked sensitive. Masking is a display convenience rather than encryption, and searching still includes sensitive field values. Notes and ordinary fields are copied as entered, so place values that need masking in a sensitive field.

Use **Add files** from a saved record to copy supporting documents into the managed library. Import keeps the original file in its original location. The file library provides rename, copy-path, and show-in-folder actions. Change the interface language in **Settings**; this changes interface and template labels without translating your own record content.

Managed files follow `collection__title__12-character-id.extension`, for example `education__Masters-degree__a1b2c3d4e5f6.pdf`. Spaces become hyphens, unsafe filename characters are sanitized, and Unicode names are retained. The identifier prevents collisions. Rename changes the descriptive part while keeping a safe extension and unique identifier. A single import accepts up to 100 regular files, with a maximum of 2 GiB per file.

## Privacy and storage

Folio does not require an account, run a cloud synchronization service, or send your personal records to a remote server. The desktop frontend is bundled with the application and uses Tauri commands for local storage operations. The production content security policy does not allow remote network connections.

The SQLite database, managed attachments, and exported backups are **not encrypted**. Anyone with access to those files can read their contents. Use the operating system's account permissions and disk encryption if that protection is needed. Copying a value places it on the operating system clipboard, which may also be visible to clipboard history or other applications. Windows can redirect application data when launched from a packaged host; **Settings → Data folder** shows the actual resolved storage location.

Private sample files are not included in this repository. Git ignores databases, local data directories, build outputs, and test artifacts. Templates describe common information fields; the desktop library starts empty.

On Windows, the default application data directory is `%LOCALAPPDATA%\dev.folio.desktop`. **Settings → Data folder** shows the actual path and provides copy and open actions. The active library contains `vault\folio.sqlite3` and `vault\attachments\<record-id>\<managed-filename>`. The interface language preference is stored in the local webview's storage.

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
| `src/api.ts` | Tauri command bridge and isolated in-memory browser preview |
| `src-tauri/src/` | SQLite persistence, native dialogs, attachment operations, and backup handling |
| `src-tauri/capabilities/` | Native capabilities exposed to the application window |
| `tests/*.e2e.ts` | Browser interface regression tests with synthetic records |

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
