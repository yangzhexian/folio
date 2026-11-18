# Application architecture

| Responsibility | Owner | Boundary |
| --- | --- | --- |
| Window composition | React main window and `PreviewWindowApp` selected in `src/main.tsx` | The main window owns selection, editor and library state. The child reads its preview session and has its own native window controls. |
| Interaction and presentation | Feature components, shared controls, CSS variables and bilingual dictionaries | Keep keyboard handlers, labels and focus behavior with the control. Derive view data from the snapshot or preferences. |
| Domain logic | TypeScript modules for search, sorting, fields, dates, categories, attachment naming and preview formats | Prefer pure functions for deterministic rules. Validate newly persisted values again in Rust. |
| Platform access | `src/api.ts`, the preview-window adapter and Tauri event hooks | Route real desktop operations through IPC. The in-memory browser adapter uses synthetic data and exposes the existing fallback behavior. |
| Application operations | Rust `Store`, shared by the Tauri commands and `folio-cli` | Adapters parse arguments, enforce window permissions, acquire the operation lock, translate results and preserve error contracts. Store operations own validation, transactions, revisions and file recovery. |
| Persistence | SQLite and managed files under the selected vault | Keep SQL, path resolution and filesystem side effects in storage. See the [storage contract](storage.md). |

Trace each change through the actual caller. A preview toolbar operation may affect both the browser fallback and the native child. A field edit may be observed by a concurrently open GUI or CLI. Refresh only when safe, retain unsaved drafts, ignore stale async responses, and preserve selection by stable ID. The CLI is machine-readable. Keep its JSON envelope, stdout/stderr separation, positional flags and conflict codes stable.

The Rust storage modules separate connection setup (`database`), selection (`queries`), mutations (`records` and `attachments`), and archive handling (`backup`). The CLI adapter uses the same stored models as desktop operations and maps errors into its existing JSON envelope. Exit codes are 0 for success, 1 for an operation failure, 2 for invalid arguments or input, and 3 for a revision or record conflict.

Keep application data on the machine. Bundle runtime fonts or use system fonts, bundle the PDF worker, and use managed attachment IDs for reads. The production CSP and window capabilities document the runtime boundary. Review the main window and attachment-preview capabilities separately when introducing a native action. Media and maintenance dependencies belong outside the shipped application bundle.
