# Backend performance

## Local measurements on November 18, 2026

The comparison used the v0.4.3 store and the scoped read queries introduced in `1f23aa9` on one Windows 11 x64 machine, with Rust 1.97.1 and Python 3.12.7. Each synthetic record had eight fields and two managed text attachments. The CLI script created each library in its own temporary directory, passed its absolute data directory to both binaries, compared their JSON output and verified the database hash after the reads.

### Release CLI

Each sample includes a new CLI process, SQLite access, JSON serialization and collection of stdout. The script warmed each binary once per command, alternated their execution order over 15 rounds, and measured the median, nearest-rank p95 and largest Windows peak working set. With 15 observations the reported p95 is the slowest observation. The operating system file cache was warm. Each cell shows v0.4.3 followed by the candidate.

| Records | Command | Median (ms) | p95 (ms) | Peak working set (MiB) |
| ---: | --- | ---: | ---: | ---: |
| 100 | `info` | 16.22 → 17.22 | 20.81 → 37.19 | 4.42 → 4.41 |
| 100 | `list` | 75.12 → 18.52 | 117.21 → 39.20 | 6.32 → 6.31 |
| 100 | `get` | 77.20 → 19.46 | 178.11 → 23.53 | 6.34 → 5.64 |
| 1,000 | `info` | 18.09 → 16.58 | 20.22 → 18.27 | 4.42 → 4.41 |
| 1,000 | `list` | 714.83 → 35.57 | 1,212.44 → 41.07 | 11.55 → 9.67 |
| 1,000 | `get` | 717.56 → 19.03 | 948.97 → 25.20 | 11.56 → 5.68 |
| 10,000 | `info` | 18.18 → 18.10 | 23.27 → 22.89 | 4.42 → 4.41 |
| 10,000 | `list` | 7,289.88 → 225.99 | 12,816.81 → 739.40 | 57.27 → 24.08 |
| 10,000 | `get` | 6,194.71 → 20.00 | 10,152.22 → 22.92 | 46.47 → 5.65 |

A 99-round repeat of the 100-record `info` control with the binaries in the same directory gave medians of 22.51 and 22.46 ms and p95 values of 95.42 and 99.38 ms. Process startup varied with host load. The `list` and `get` improvements grew with library size. Listing uses indexed counts for each record's active attachments. Fetching one record reads that record and resolves only its active attachments in stored order.

SQLite's query plan showed one record scan and an `attachment_record` index search for each count on `list`. The detail query used the records primary-key index and an `attachment_record` index search for the selected ID.

### Rust storage operations

Both stores ran the same benchmark in the Cargo test profile. Each of the 21 paired samples used 128 records, 256 managed 4 KiB attachments and one warm-up. Every sample started with its own temporary library. The runner alternated which build ran first. These measurements cover store work inside the Rust process.

| Operation | Median, v0.4.3 (ms) | Median, candidate (ms) | p95, v0.4.3 (ms) | p95, candidate (ms) |
| --- | ---: | ---: | ---: | ---: |
| Desktop snapshot | 202.62 | 167.68 | 416.62 | 331.71 |
| Export backup | 557.15 | 466.05 | 955.09 | 904.01 |
| Restore backup | 872.35 | 865.13 | 1,421.69 | 1,365.31 |
| Import one 4 KiB file | 13.91 | 13.26 | 17.97 | 23.46 |

Small-file import has an open tail-latency check. Its p95 increased by 5.49 ms (30.6%) while its median improved by 0.65 ms. Concurrent media production contributed host load, and earlier runs grouped by binary showed substantial variation across all four operations. Repeat the paired measurement on an idle machine before attributing the import tail difference to the refactor.

## Reproducing the comparison

Build each revision with `npm run backend:build` in a separate checkout. Supply the baseline executable and run from the candidate checkout. The runner uses the Python standard library. Peak working set measurement uses Windows process counters.

```powershell
$baselineCli = Resolve-Path ../folio-baseline/src-tauri/target/release/folio-cli.exe
python scripts/bench-backend.py --baseline $baselineCli
python scripts/bench-backend.py --samples 99 --sizes 100 --operations info --baseline $baselineCli
```

Run the opt-in storage benchmark from a checkout with Cargo. It creates a disposable store containing 128 records and 256 managed 4 KiB attachments. It times the full desktop snapshot, backup export, restore, and import of one additional 4 KiB file after restore. The timings cover Rust store operations, and exclude GUI rendering and IPC.

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib backend_workloads -- --ignored --nocapture
```

For paired storage measurements, use the same benchmark module in each checkout. For a baseline that predates the benchmark, copy `src-tauri/src/storage/tests/benchmark.rs` into the temporary baseline checkout and add `mod benchmark;` to its `src-tauri/src/storage/tests.rs`. Build both test executables with the same Cargo profile. The final `compiler-artifact` JSON for `folio_lib` gives the test executable path. The Python runner alternates the two binaries, and each measured sample follows a warm-up on its own temporary library.

```powershell
function Get-StoreRunner($manifest) {
    $build = cargo test --locked --manifest-path $manifest --lib --no-run --message-format=json
    if ($LASTEXITCODE -ne 0) { throw 'Test build failed.' }
    $build | ConvertFrom-Json | Where-Object { $_.target.name -eq 'folio_lib' -and $_.executable } | Select-Object -Last 1 -ExpandProperty executable
}
$baselineTests = Get-StoreRunner ../folio-baseline/src-tauri/Cargo.toml
$candidateTests = Get-StoreRunner src-tauri/Cargo.toml
python scripts/bench-backend.py --store-runners $baselineTests $candidateTests --samples 21
```
