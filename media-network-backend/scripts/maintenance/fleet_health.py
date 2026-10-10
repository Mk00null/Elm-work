#!/usr/bin/env python3
"""fleet_health.py — ADB reachability + uptime check for TV endpoints.

Reads devices.conf (``<ip[:port]> <label>``), and for each device measures TCP
connect latency to the ADB port, attempts ``adb connect``, and reads uptime.
Results are appended to fleet_health.log (one JSON line per device) and a
table is printed. Exit code is the number of unreachable devices.

Usage: fleet_health.py [--config devices.conf] [--log fleet_health.log] [--quiet]
"""
from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ADB_TIMEOUT = 10


def load_devices(path: Path) -> list[tuple[str, str]]:
    """Parse the device list, skipping blanks/comments."""
    devices = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if not parts or parts[0].startswith("#"):
            continue
        target = parts[0] if ":" in parts[0] else f"{parts[0]}:5555"
        devices.append((target, parts[1] if len(parts) > 1 else target))
    return devices


def tcp_latency(target: str, timeout: float = 3.0) -> float | None:
    """Return TCP connect time to the ADB port in ms, or None if closed."""
    host, port = target.rsplit(":", 1)
    start = time.perf_counter()
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return round((time.perf_counter() - start) * 1000, 1)
    except OSError:
        return None


def adb(*args: str) -> str:
    """Run adb, returning stdout ('' on failure/timeout)."""
    try:
        r = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=ADB_TIMEOUT)
        return r.stdout.strip()
    except (subprocess.TimeoutExpired, OSError):
        return ""


def check(target: str, label: str, have_adb: bool) -> dict:
    rec = {"ts": datetime.now(timezone.utc).isoformat(), "label": label, "target": target,
           "tcp_ms": tcp_latency(target), "adb": "unreachable", "uptime_h": None, "adb_ms": None}
    if rec["tcp_ms"] is None or not have_adb:
        if not have_adb and rec["tcp_ms"] is not None:
            rec["adb"] = "port-open (adb missing)"
        return rec
    adb("connect", target)
    start = time.perf_counter()
    state = adb("-s", target, "get-state")
    rec["adb_ms"] = round((time.perf_counter() - start) * 1000, 1)
    rec["adb"] = state or "unauthorized/offline"
    if state == "device":
        raw = adb("-s", target, "shell", "cat", "/proc/uptime")
        try:
            rec["uptime_h"] = round(float(raw.split()[0]) / 3600, 2)
        except (ValueError, IndexError):
            pass
    return rec


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=HERE / "devices.conf")
    ap.add_argument("--log", type=Path, default=HERE / "fleet_health.log")
    ap.add_argument("--quiet", action="store_true", help="log only, no table")
    a = ap.parse_args()

    if not a.config.exists():
        print(f"error: {a.config} not found", file=sys.stderr)
        return 1
    devices = load_devices(a.config)
    if not devices:
        print("no devices registered in", a.config)
        return 0
    have_adb = shutil.which("adb") is not None

    results = [check(t, l, have_adb) for t, l in devices]
    with a.log.open("a") as fh:
        for r in results:
            fh.write(json.dumps(r) + "\n")

    if not a.quiet:
        print(f"{'DEVICE':<24}{'TARGET':<22}{'TCP ms':>8}{'ADB ms':>8}  {'STATE':<22}{'UPTIME h':>9}")
        for r in results:
            print(f"{r['label']:<24}{r['target']:<22}{str(r['tcp_ms'] or '-'):>8}"
                  f"{str(r['adb_ms'] or '-'):>8}  {r['adb']:<22}{str(r['uptime_h'] or '-'):>9}")
    return sum(r["adb"] != "device" for r in results)


if __name__ == "__main__":
    sys.exit(main())
