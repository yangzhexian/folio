"""Compare Folio CLI reads on the same disposable synthetic libraries, using Python 3."""

import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone


def peak_mib(pid):
    """Read the Windows process high-water mark while Popen still owns the process."""
    if os.name != "nt":
        return None
    from ctypes import wintypes

    class MemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD), ("faults", wintypes.DWORD),
            ("peak_working_set", ctypes.c_size_t), ("remaining", ctypes.c_size_t * 7),
        ]

    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    read_counters = ctypes.windll.psapi.GetProcessMemoryInfo
    read_counters.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
    process = kernel.OpenProcess(0x1010, False, pid)  # QUERY_LIMITED_INFORMATION | VM_READ
    if not process:
        return None
    try:
        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        if read_counters(process, ctypes.byref(counters), counters.cb):
            return counters.peak_working_set / (1024 * 1024)
        return None
    finally:
        kernel.CloseHandle(process)


def invoke(binary, root, *args, payload=None):
    encoded = json.dumps(payload).encode() if payload is not None else None
    start = time.perf_counter()
    with subprocess.Popen([binary, "--data-dir", root, *args], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        stdout, stderr = process.communicate(encoded)
        elapsed = (time.perf_counter() - start) * 1000
        if process.returncode:
            raise RuntimeError(stderr.decode(errors="replace"))
        peak = peak_mib(process.pid)
    return elapsed, json.loads(stdout)["data"], peak


def seed(binary, root, size):
    fields = [
        {"id": f"field-{i}", "label": f"Field {i}", "value": "Example value " * 4,
         "kind": "text", "sensitive": i == 1}
        for i in range(8)
    ]
    bootstrap = {"id": str(uuid.UUID(int=0)), "category": "identity", "title": "Fixture"}
    invoke(binary, root, "create", "--input", "-", payload=bootstrap)
    vault = root / "vault"
    db = sqlite3.connect(vault / "folio.sqlite3")
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("DELETE FROM records WHERE id=?", (bootstrap["id"],))
        for index in range(1, size + 1):
            record_id = str(uuid.UUID(int=index))
            stamp = (datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=index))
            stamp = stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            record = {**bootstrap, "id": record_id, "title": f"Example {index}", "subtitle": "",
                      "createdAt": stamp, "updatedAt": stamp, "tags": [], "notes": "",
                      "fields": fields, "favorite": False}
            db.execute("INSERT INTO records(id,body) VALUES(?,?)", (record_id, json.dumps(record)))
            folder = vault / "attachments" / record_id
            folder.mkdir()
            for offset in range(2):
                file_id = uuid.UUID(int=(index << 64) + offset)
                name = f"identity_{index * 2 + offset:012x}.txt"
                file = folder / name
                file.write_bytes(b"example" * 32)
                attachment = {"id": str(file_id), "recordId": record_id, "fileName": name,
                              "originalName": "example.txt", "relativePath": file.relative_to(vault).as_posix(),
                              "size": file.stat().st_size, "createdAt": stamp, "revision": str(file_id)}
                db.execute("INSERT INTO attachments(id,record_id,body) VALUES(?,?,?)",
                           (str(file_id), record_id, json.dumps(attachment)))
        db.commit()
    finally:
        db.close()


def measure(root, binaries, size, samples, operations):
    seed(next(iter(binaries.values())), root, size)
    database = root / "vault" / "folio.sqlite3"
    digest = hashlib.sha256(database.read_bytes()).digest()
    for operation in operations:
        args = ["get", "--id", str(uuid.UUID(int=size))] if operation == "get" else [operation]
        timings = {label: [] for label in binaries}
        peaks = {label: [] for label in binaries}
        reference = None
        for round_index in range(samples + 1):
            order = list(binaries)
            if round_index % 2:
                order.reverse()
            for label in order:
                elapsed, data, peak = invoke(binaries[label], root, *args)
                if operation == "info":
                    data.pop("version")
                if reference is None:
                    reference = data
                elif data != reference:
                    raise RuntimeError(f"{operation} returned different data for {label}")
                if round_index:
                    timings[label].append(elapsed)
                    if peak is not None:
                        peaks[label].append(peak)
        for label, values in timings.items():
            p95 = sorted(values)[math.ceil(samples * 0.95) - 1]
            peak = f"{max(peaks[label]):.2f}" if peaks[label] else "n/a"
            print(f"{size:7} {size * 2:11} {operation:12} {label:10} "
                  f"{statistics.median(values):10.2f} {p95:10.2f} {peak:>10}", flush=True)
    if hashlib.sha256(database.read_bytes()).digest() != digest:
        raise RuntimeError("A read operation changed the synthetic database")


def measure_stores(runners, samples):
    labels = ["baseline", "candidate"]
    results = {label: {} for label in labels}
    environment = {**os.environ, "FOLIO_BENCH_SINGLE_SAMPLE": "1"}
    for index in range(samples):
        paired = list(zip(labels, runners))
        if index % 2:
            paired.reverse()
        for label, runner in paired:
            output = subprocess.check_output(
                [runner.resolve(strict=True), "backend_workloads", "--ignored", "--nocapture"],
                env=environment, text=True, encoding="utf-8",
            )
            sample = next(line for line in output.splitlines() if line.startswith("FOLIO_SAMPLE "))
            for operation, elapsed in json.loads(sample.removeprefix("FOLIO_SAMPLE ")).items():
                results[label].setdefault(operation, []).append(elapsed)
    print("operation    build       median(ms)    p95(ms)")
    for operation in ["snapshot", "backup", "restore", "import"]:
        for label in labels:
            values = results[label][operation]
            p95 = sorted(values)[math.ceil(samples * 0.95) - 1]
            print(f"{operation:12} {label:10} {statistics.median(values):10.2f} {p95:10.2f}")


def main():
    default = Path(__file__).resolve().parents[1] / "src-tauri/target/release/folio-cli"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path,
                        default=default.with_suffix(".exe") if os.name == "nt" else default)
    parser.add_argument("--baseline", type=Path, help="Optional release binary for paired comparison")
    parser.add_argument("--sizes", type=int, nargs="+", default=[100, 1000, 10000])
    parser.add_argument("--samples", type=int, default=15)
    parser.add_argument("--operations", nargs="+", choices=["info", "list", "get"],
                        default=["info", "list", "get"])
    parser.add_argument("--store-runners", type=Path, nargs=2, metavar=("BASELINE", "CANDIDATE"),
                        help="Compare two Rust unit-test executables built with the same storage benchmark")
    args = parser.parse_args()
    if min(args.sizes) < 1 or args.samples < 1:
        parser.error("Sizes and sample count must be positive")
    if args.store_runners:
        measure_stores(args.store_runners, args.samples)
        return
    binaries = {}
    if args.baseline:
        binaries["baseline"] = args.baseline.resolve(strict=True)
    binaries["candidate"] = args.candidate.resolve(strict=True)
    print("records attachments operation    build       median(ms)    p95(ms)  peak(MiB)", flush=True)
    for size in args.sizes:
        with tempfile.TemporaryDirectory(prefix="folio-benchmark-") as folder:
            measure(Path(folder) / "data", binaries, size, args.samples, args.operations)


if __name__ == "__main__":
    main()
