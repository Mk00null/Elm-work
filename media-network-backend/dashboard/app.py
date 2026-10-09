"""Vidar Dashboard — web control panel for the TV fleet.

Reads the fleet database (inventory/fleet.db) and the health log
(scripts/maintenance/fleet_health.log); actions run ADB against one box.

Run locally:  uvicorn app:app --port 8080     (from this folder)
Env: VIDAR_DB, VIDAR_HEALTH_LOG, JELLYFIN_URL, JELLYFIN_API_KEY, DASHBOARD_TOKEN
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import urllib.request
from collections import defaultdict
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DB = Path(os.environ.get("VIDAR_DB", ROOT / "inventory/fleet.db"))
HEALTH_LOG = Path(os.environ.get("VIDAR_HEALTH_LOG", ROOT / "scripts/maintenance/fleet_health.log"))
JELLYFIN_URL = os.environ.get("JELLYFIN_URL", "http://localhost:8096").rstrip("/")
JELLYFIN_KEY = os.environ.get("JELLYFIN_API_KEY", "")
TOKEN = os.environ.get("DASHBOARD_TOKEN", "")

app = FastAPI(title="Vidar Dashboard")


def require_token(x_vidar_token: str = Header(default="")) -> None:
    """Actions need the token when DASHBOARD_TOKEN is set."""
    if TOKEN and x_vidar_token != TOKEN:
        raise HTTPException(401, "Wrong or missing dashboard password")


def devices() -> list[dict]:
    if not DB.exists():
        return []
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute("SELECT * FROM devices ORDER BY device_id")]


def health_history(limit_lines: int = 5000) -> dict[str, list[dict]]:
    """Latest health records per device label (newest last)."""
    hist: dict[str, list[dict]] = defaultdict(list)
    if not HEALTH_LOG.exists():
        return hist
    lines = HEALTH_LOG.read_text(errors="ignore").splitlines()[-limit_lines:]
    for line in lines:
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        hist[rec.get("label", "").split("@")[0]].append(rec)
    return hist


def merged_fleet() -> list[dict]:
    hist = health_history()
    out = []
    for d in devices():
        recs = hist.get(d["device_id"], [])
        last = recs[-1] if recs else {}
        out.append({
            **d,
            "online": last.get("adb") == "device",
            "state": last.get("adb", "no data"),
            "uptime_h": last.get("uptime_h"),
            "tcp_ms": last.get("tcp_ms"),
            "checked": last.get("ts"),
            "latency": [r.get("tcp_ms") for r in recs[-48:]],
        })
    return out


def jellyfin_sessions() -> list[dict]:
    if not JELLYFIN_KEY:
        return []
    try:
        req = urllib.request.Request(f"{JELLYFIN_URL}/Sessions?ActiveWithinSeconds=600",
                                     headers={"X-Emby-Token": JELLYFIN_KEY})
        with urllib.request.urlopen(req, timeout=4) as r:
            data = json.load(r)
    except Exception:
        return []
    return [{
        "user": s.get("UserName"), "device": s.get("DeviceName"),
        "title": (s.get("NowPlayingItem") or {}).get("Name"),
        "transcoding": bool(s.get("TranscodingInfo")),
    } for s in data if s.get("NowPlayingItem")]


def server_stats() -> dict:
    disk = shutil.disk_usage(DB.parent if DB.parent.exists() else ROOT)
    stats = {"disk_used_pct": round(disk.used / disk.total * 100, 1),
             "disk_free_gb": round(disk.free / 1e9, 1)}
    try:
        load = os.getloadavg()[0]
        stats["load"] = round(load, 2)
    except (AttributeError, OSError):
        pass
    return stats


@app.get("/api/fleet")
def api_fleet():
    return {"devices": merged_fleet(), "server": server_stats(), "streams": jellyfin_sessions()}


ACTIONS = {
    "restart": ["reboot"],
    "trim": ["shell", "pm", "trim-caches", "999G"],
}


@app.post("/api/devices/{device_id}/{action}", dependencies=[Depends(require_token)])
def api_action(device_id: str, action: str):
    if action not in ACTIONS:
        raise HTTPException(404, "Unknown action")
    dev = next((d for d in devices() if d["device_id"] == device_id), None)
    if not dev or not dev.get("assigned_ip"):
        raise HTTPException(404, "Device not found or has no IP")
    if not shutil.which("adb"):
        raise HTTPException(503, "adb isn't installed on the server")
    target = dev["assigned_ip"] if ":" in dev["assigned_ip"] else f'{dev["assigned_ip"]}:5555'
    subprocess.run(["adb", "connect", target], capture_output=True, timeout=15)
    r = subprocess.run(["adb", "-s", target, *ACTIONS[action]], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise HTTPException(502, f"adb failed: {r.stderr.strip() or r.stdout.strip()}")
    return {"ok": True, "device": device_id, "action": action}


@app.get("/")
def index():
    return FileResponse(HERE / "static/index.html")
