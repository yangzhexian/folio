# Folio maintenance SOP

## Route a change

| Change | Start here | Evidence to keep |
| --- | --- | --- |
| Add a feature | Describe the user action and expected result. Find the closest existing flow in the [architecture guide](architecture.md). Use the [UI guide](interface.md) for visible changes. | A working path from the real entry point, both locales where visible, and coverage for one normal and one relevant failure path. |
| Fix a defect | Reproduce it with a synthetic record or file. Identify the first layer that breaks the documented behavior. | A failing case before the fix, a passing case afterwards, and a check of the other callers of that layer. |
| Refactor or optimize | Write down the observable contract first. Compare the same fixture, build mode and machine before and after. | Equivalent outputs and selection, conflict or recovery behavior. Include timings, memory or query plans for performance changes. |
| Change persisted data or a public interface | Check the [storage contract](storage.md) and both desktop and CLI consumers. | Old-vault reads, upgrade and reopen, backup round trip, conflict and failure cases. |
| Change the introduction | Use synthetic fixtures and the [media project](../../video/README.md). | Both renders, decoded dimensions and duration, and visual checks of the altered operations. |

## From change to merge

1. Identify the affected entry points, current behavior and intended result. For changes to a public format or cross-layer dependency, record the compatibility and rollback decisions next to the relevant contract.
2. Implement one coherent change and reuse its nearest working example. Run focused tests while editing. A pure move, a behavior fix and a measured performance improvement can be reviewed and reverted independently.
3. From a clean checkout use Node 24, the lockfile (`npm ci`), Chromium (`npx playwright install chromium`) and the Windows Rust/MSVC and WebView2 prerequisites in the [project guide](../../README.md). Run `npm run check`. It checks the public Git index, documentation links and application versions, compiles TypeScript and the production bundle, runs Vitest, checks Rust formatting, and runs Rust and Playwright tests. The installed Chrome fallback is documented in the [test guide](../testing.md).
4. For a native boundary, vault, installer or bundled frontend change, run `npm run check:native` on Windows and `npm run desktop:build`. The smoke command builds a separate executable and CLI, creates a fresh synthetic library, exercises real WebView2, and writes local evidence under the ignored `artifacts/native/`. The build needs sufficient space for a separate Cargo release target. For a media change run the video type and playback checks documented in the media project.
5. Stage the intended files, review `git diff --cached --stat` and the staged diff, then rerun `npm run check:public`. It checks indexed paths and text for common credentials and local data. Manually inspect media, EXIF, archive contents, binaries and screenshots before publishing. Public fixtures must be synthetic and reproducible. Keep real vaults, local paths and raw diagnostic reports out of public artifacts.
6. Commit in English using Conventional Commits, for example `fix(preview): restore focus after switching files`. In the PR describe commands, results, compatibility and any remaining manual checks. GitHub Actions runs the same core checks on PRs and main. Native and media changes enable their additional jobs. Manual dispatch enables both.

## Release and recovery

When a release is requested, align the application version in the npm manifest and lockfile, Cargo manifest and lockfile, and Tauri configuration. Use the tested commit for both the tag and the release builds. Build the desktop installer and portable desktop/CLI package, include the data-entry skill, inspect their contents, and generate SHA-256 checksums. Cross-check the filenames, README download link, release notes and public download hashes.

Exercise installation and upgrade in a disposable Windows account or CI runner with a synthetic vault. Check that a previously installed library, managed file bytes and paths survive the upgrade, and verify that the installed CLI and GUI agree. Verify the previous supported backup formats before publishing. For source-only regressions revert the focused commit. For a storage change document recovery against the retained pre-upgrade copy and check compatibility before pointing an earlier executable at the modified vault.

## Performance review

Measure 100, 1,000 and 10,000 synthetic records on the same machine and build mode as the comparison commit. For timing, record absolute p50 and p95, sample count, fixture density and cache state. Keep a separate measure of first use, steady-state operations and memory. The [window and search benchmark](../benchmarks/frontend.md) records the browser fixture, and the [storage benchmark](../benchmarks/backend.md) records the CLI and vault workloads. Repeat an apparent slowdown above 10% when it exceeds baseline variation. Isolate reproducible regressions before merge and label noisy tails explicitly.
