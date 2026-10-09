#!/usr/bin/env python3
"""vidar_backup.py — nightly backup of Vidar configuration (not media).

Archives: .env, inventory/fleet.db, RustDesk keys, and the data/ folders of
Uptime Kuma, Jellyseerr, Bazarr and Home Assistant, plus Jellyfin's config
(Windows: %ProgramData%\\Jellyfin\\Server\\config and \\data, without caches).
Keeps BACKUP_KEEP_DAYS days locally; copies to RCLONE_REMOTE if set.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def sources() -> list[Path]:
    paths = [ROOT / ".env", ROOT / "inventory/fleet.db", ROOT / "data/rustdesk",
             ROOT / "data/uptime-kuma", ROOT / "data/jellyseerr", ROOT / "data/bazarr",
             ROOT / "data/homeassistant", ROOT / "data/jellyfin/config"]
    pd = os.environ.get("ProgramData")
    if pd:
        paths += [Path(pd) / "Jellyfin/Server/config", Path(pd) / "Jellyfin/Server/data"]
    return [p for p in paths if p.exists()]


SKIP = ("cache", "transcodes", "metadata", "logs", ".gitkeep")


def main() -> int:
    load_env()
    dest = Path(os.environ.get("BACKUP_DIR", ROOT / "backups"))
    if not dest.is_absolute():
        dest = ROOT / dest
    dest.mkdir(parents=True, exist_ok=True)
    keep = int(os.environ.get("BACKUP_KEEP_DAYS", "14"))
    out = dest / f"vidar-{datetime.now():%Y%m%d-%H%M}.tar.gz"

    srcs = sources()
    if not srcs:
        print("nothing to back up yet")
        return 0
    with tarfile.open(out, "w:gz") as tar:
        for p in srcs:
            tar.add(p, arcname=str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else f"external/{p.name}",
                    filter=lambda ti: None if any(s in ti.name.lower() for s in SKIP) else ti)
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB) from {len(srcs)} sources")

    cutoff = time.time() - keep * 86400
    for old in dest.glob("vidar-*.tar.gz"):
        if old.stat().st_mtime < cutoff:
            old.unlink()
            print(f"pruned {old.name}")

    remote = os.environ.get("RCLONE_REMOTE")
    if remote:
        if not shutil.which("rclone"):
            print("RCLONE_REMOTE set but rclone not installed", file=sys.stderr)
            return 1
        r = subprocess.run(["rclone", "copy", str(out), remote], capture_output=True, text=True)
        print("cloud copy:", "ok" if r.returncode == 0 else r.stderr.strip())
        return r.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
