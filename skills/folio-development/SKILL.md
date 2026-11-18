---
name: folio-development
description: Add features to Folio, fix desktop or CLI behavior, and refactor its React, Tauri and SQLite implementation using the repository maintenance SOP. Use for changes to the application or its developer tooling. For operations on an actual personal library, use folio-data-entry.
---

# Develop Folio

Work in the Folio checkout. Resolve the root with `git rev-parse --show-toplevel` and open `docs/development/README.md` there. This also works when the skill has been copied into a harness's skill directory. The checked-out SOP and tests describe the version being edited.

## Choose a path

- **Add a feature.** Identify its real entry point and the closest existing interaction. Use the architecture map to put rendering, platform calls and persistence with their current owners. For a new preview action, check both viewer presentations, the shared button, the two locale labels and the child window's native capabilities.
- **Modify or fix behavior.** Reproduce the reported operation with synthetic data. Follow its stable ID from the UI or CLI into the store, including the failure path. For a targeted field or attachment edit, check that unrelated fields, order, bytes and revisions survive, and that an already-open editor can handle a conflicting write.
- **Refactor or improve performance.** Freeze the externally visible results and measure a repeatable workload on both revisions. Keep behavior-preserving moves separate from changes in query shape or user behavior. Treat indexed lookups, masked result text, attachment order, empty libraries and read-only legacy data as observable contracts.

Open `docs/development/interface.md` for controls, copy, themes and keyboard behavior. Open `docs/development/storage.md` when the change reaches a transaction, file, CLI output or archive. Consult `docs/development/architecture.md` for ownership across these boundaries. Use project-relative paths and the check commands in the SOP with any harness.

## Hand off

Run focused checks for the affected entry points, then the applicable repository checks from the SOP. Use isolated synthetic vaults for tests. For concurrent checkouts, set `FOLIO_TEST_PORT` to a free port for that checkout so its browser tests use its own application. Report the behavior exercised, measured outcomes and any native or hosted checks still pending. Group finished changes into independently verifiable English Conventional Commits.
