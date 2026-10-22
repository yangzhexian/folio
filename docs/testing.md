# Testing Folio

The test suite uses synthetic values and temporary directories. It does not read the user's source documents or open the installed desktop library.

## Automated checks

| Command | What it verifies |
| --- | --- |
| `npm run build` | TypeScript checking and the production frontend bundle |
| `npm test` | Search across bilingual fields and filenames, copy formatting and sensitive-field exclusion, independent template records, file-size formatting, and chronological and localized title sorting |
| `npm run test:e2e` | Browser interface workflows in Chromium |
| `cargo test --manifest-path src-tauri/Cargo.toml` | SQLite persistence, attachment handling, ZIP validation, and restore recovery using temporary directories |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust and Tauri integration compilation |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Rust source formatting |
| `npm run desktop:build` | Windows release executable and NSIS packaging |

Install browser support once with `npx playwright install chromium`. Playwright starts the Vite server on `http://127.0.0.1:1420`, or reuses an existing server outside CI. Each test gets an isolated browser context, and browser preview data resets on reload. Failed tests retain a screenshot and trace under `test-results/`; an HTML report is written to `playwright-report/`.

If the browser download is blocked but Google Chrome is already installed, run these PowerShell commands:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

To inspect a failed trace, run `npx playwright show-trace` with the path printed by the test runner. Test screenshots and reports are ignored by Git and contain only synthetic example data.

## Browser coverage

The fourteen browser tests cover multiword search with Chinese and English labels, an empty result and reset, the search keyboard shortcut, custom record creation and editing, multiline values, field labels, tags and notes, stable focus while typing, favorite filtering, record deletion and immediate undo, sensitive-value masking, full-record clipboard exclusion, explicit individual-value copying, English/Chinese switching and preference persistence, unsaved edit confirmation, browser data reset, and clear handling of native-only file actions. They also cover all six sort orders, different creation and modification times after editing, preserved selection when favorites or language changes reorder the list, persisted sorting across filters and reloads, the simplified bilingual toolbar, and record creation from an empty library.

Sorting unit tests include timezone-aware chronology, natural numeric ordering for English and Chinese titles, deterministic ties, malformed dates, input immutability, and validation of saved preferences.

The resource and layout check observes network requests during reload and language switching, rejects external HTTP or HTTPS origins, checks for JavaScript runtime errors, and verifies there is no horizontal page overflow at the minimum 900 × 620 desktop size. It writes English, Chinese, and compact preview screenshots to `artifacts/`. This is a regression check for those observed interactions, rather than an operating-system network audit.

## Native storage coverage

Rust tests use isolated temporary vaults to exercise record persistence after reopening, attachment import and duplicate names, source preservation, filename sanitization and traversal rejection, batch-import rollback, delete and undo behavior, backup round trips, invalid archive schemas and paths, attachment metadata mismatch, recovery from an interrupted restore, and exclusion of deleted data from exports. Export validation also rejects a synthetic manifest larger than the restore limit.

## Latest recorded validation

After the interface simplification on 2026-10-22, all 19 frontend unit tests and 14 browser tests passed with installed Google Chrome. The production frontend, Windows release executable, and NSIS installer were rebuilt successfully. English and Chinese screenshots were inspected at 1440 × 1000 and 900 × 620, along with the empty library at 900 × 620; the toolbar remained accessible and the certificate and language icons were distinct. The storage implementation was unchanged, and native GUI workflows were not repeated for this interface update.

During the initial implementation on 2026-10-22, all eight browser cases passed with installed Google Chrome on Windows. The managed Playwright Chromium download failed with `ECONNRESET`, so the supported `PLAYWRIGHT_CHANNEL=chrome` fallback was used. The first browser run caught a modal focus regression while typing; after the modal lifecycle was fixed, the complete CRUD flow passed. All nine frontend unit tests and 16 native storage tests passed. Rust formatting and compilation checks passed, and the Windows release executable and NSIS installer were built successfully.

The real Windows release was launched with a new, disposable library. Native record creation saved a synthetic value into SQLite, and its individual copy action produced the correct operating-system clipboard text. The native file picker imported a synthetic text file, both source and managed copy had identical SHA-256 hashes, the copied absolute path resolved to that managed file, and Explorer opened its containing folder. The shell-reveal action remained busy during this first check, so shell calls and storage work were moved off the UI thread and the vault mutex is now released before shell integration. The updated code passed compilation, all 16 Rust tests, all eight browser tests, and release packaging. The user stopped Computer Use with Escape before the final native relaunch; responsiveness after that fix, native restart persistence, and native backup/restore dialog workflows have not been reverified through the GUI. Storage persistence and backup/restore remain covered by Rust tests. The installer was generated but not installed during verification.

## Desktop verification boundary

Browser tests exercise the in-memory preview adapter. They do not prove that Windows native file dialogs, Explorer reveal actions, WebView2 clipboard integration, installer behavior, or installed-app persistence work on every machine. Rust tests exercise the storage layer, while a real desktop smoke test is needed to cover the boundary between the webview and native commands.

Before distributing a build, use a disposable desktop library to create a record, relaunch and confirm persistence, attach two synthetic files with the same basename, verify both originals remain unchanged, copy a path, reveal the managed file, rename it, and verify the extension. Export the library, make a small change, restore the export, and confirm both record data and file bytes are recovered. Check English and Chinese labels, test an offline launch, and retain an independent backup before testing with real personal information.
