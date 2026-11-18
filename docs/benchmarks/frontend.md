# Frontend baseline and window measurements

These measurements compare the Windows release frontend at `v0.4.3` with the shared controls and indexed search. Data is synthetic. The JavaScript benchmark checks the result set at each scale. The browser benchmark checks that a visible search produces the expected record.

## Search projection

Run `node scripts/bench-ui.mjs --ref v0.4.3` and `node scripts/bench-ui.mjs` in the candidate checkout using the same Node installation. This benchmark covers in-memory computation independent of rendering or disk. Each collection has as many attachments as records. Values are median milliseconds from 11 samples on Windows x64, Node 24.15.0.

| Records | Initial browse, baseline / candidate | First search, baseline / candidate | Six warm queries, baseline / candidate |
| ---: | ---: | ---: | ---: |
| 100 | 0.81 / 0.03 | 1.25 / 0.68 | 7.05 / 0.09 |
| 1,000 | 17.34 / 0.14 | 18.49 / 6.14 | 124.55 / 0.68 |
| 10,000 | 656.13 / 1.78 | 223.79 / 62.74 | 970.61 / 8.49 |

At 10,000 records, warm-query p95 was 1,182.11 / 17.36 ms. Building the index on first search is included in the first-search column. Result checksums matched at all sizes.

## Browser rendering

Build the baseline and candidate with their lockfiles in separate directories. Run `node scripts/bench-window.mjs <baseline-dist> <candidate-dist>` from the candidate checkout. Set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome and `FOLIO_BENCH_SAMPLES=9` to reproduce this sample count. Each pass alternates build order, uses a fresh browser context, supplies one field and one attachment per record through the Tauri mock, and waits for the actual release application to paint. Ready time is relative to navigation start. Search time covers input, reconciliation to one matching result and the following paint opportunity. Heap is the larger of two Chromium JS heap samples, at ready and after search. CLI peak working set is measured separately.

| Records | Ready p50 / p95 (ms), baseline → candidate | Input to result p50 / p95 (ms), baseline → candidate | Sampled heap p50 (MiB), baseline → candidate |
| ---: | --- | --- | ---: |
| 100 | 203 / 276 → 171 / 250 | 30 / 60 → 29 / 31 | 4 → 4 |
| 1,000 | 289 / 369 → 271 / 336 | 31 / 55 → 31 / 69 | 23 → 14 |
| 10,000 | 2,399 / 3,333 → 1,410 / 1,540 | 286 / 380 → 247 / 300 | 151 → 149 |

At 10,000 records, the list still creates a full DOM representation on initial display. This explains why the user-visible time is substantially longer than the isolated search calculation. The benchmark uses a loopback server and simulated snapshot delivery. OS process launch, SQLite I/O and WebView2 initialization require separate measurement.

A second 15-sample comparison also improved 10,000-record median readiness (3,508 to 2,570 ms) and search (408 to 389 ms). On the 1,000-record fixture the short runs showed a higher search tail, so a separate 61-pair check used `FOLIO_BENCH_SIZES=1000` and `FOLIO_BENCH_SAMPLES=61`. Median search was 45 to 44 ms and p95 was 55 to 56 ms. Median sampled heap was 22 to 20 MiB. Absolute timings varied with concurrent build activity. The first two comparisons agreed on the large-library improvement, and the focused run did not reproduce a greater-than-10% medium-library slowdown.
