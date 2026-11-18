use super::*;
use std::time::Instant;

/// Run with cargo test --lib backend_workloads -- --ignored --nocapture.
/// Aggregate durations only. Both vaults and every generated file live in TempDir.
#[test]
#[ignore = "manual storage benchmark"]
fn backend_workloads() {
    const RECORDS: usize = 128;
    let single_sample = std::env::var_os("FOLIO_BENCH_SINGLE_SAMPLE").is_some();
    let samples = if single_sample { 1 } else { 15 };
    let (temp, store) = store();
    let sample = source(&temp, "sample.bin", &[42; 4096]);
    for i in 0..RECORDS {
        let mut item = record();
        item.id = Uuid::from_u128((i + 1) as u128).to_string();
        item.title = format!("Synthetic {i}");
        let saved = store.save_record(item).unwrap();
        store
            .import_files(&saved.id, &[sample.clone(), sample.clone()])
            .unwrap();
    }
    let backup = temp.path().join("benchmark.zip");
    let restored = Store::open(temp.path().join("restored")).unwrap();
    let mut snapshots = Vec::new();
    let mut exports = Vec::new();
    let mut restores = Vec::new();
    let mut imports = Vec::new();
    for i in 0..=samples {
        let start = Instant::now();
        let snapshot = store.snapshot().unwrap();
        let snapshot_time = start.elapsed();
        assert_eq!(snapshot.attachments.len(), 2 * RECORDS);
        let start = Instant::now();
        store.export_backup(&backup).unwrap();
        let export_time = start.elapsed();
        let start = Instant::now();
        restored.restore_backup(&backup).unwrap();
        let restore_time = start.elapsed();
        let start = Instant::now();
        restored
            .import_files(&snapshot.records[0].id, std::slice::from_ref(&sample))
            .unwrap();
        let import_time = start.elapsed();
        if i > 0 {
            snapshots.push(snapshot_time);
            exports.push(export_time);
            restores.push(restore_time);
            imports.push(import_time);
        }
    }
    let mut measurements = serde_json::Map::new();
    for (operation, mut durations) in [
        ("snapshot", snapshots),
        ("backup", exports),
        ("restore", restores),
        ("import", imports),
    ] {
        durations.sort();
        let median = durations[samples / 2].as_secs_f64() * 1000.0;
        let p95 = durations[(samples * 95).div_ceil(100) - 1].as_secs_f64() * 1000.0;
        measurements.insert(operation.into(), median.into());
        println!(
            "{operation}: {RECORDS} records, {} attachments, {samples} samples, median {median:.2} ms, p95 {p95:.2} ms",
            2 * RECORDS,
        );
    }
    if single_sample {
        println!("FOLIO_SAMPLE {}", serde_json::Value::Object(measurements));
    }
}
