"""Tools the Vidar Assistant can call. Read tools run freely; write tools need a ✅."""
from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "inventory/fleet.db"
MAINT = ROOT / "scripts/maintenance"
HEALTH_LOG = MAINT / "fleet_health.log"

READ_TOOLS = {"fleet_status", "server_status", "diagnose"}
WRITE_TOOLS = {"restart_tv", "run_maintenance"}

TOOL_SPECS = [
    {"type": "function", "function": {"name": "fleet_status", "description": "Live status of every TV (online, uptime, latency).",
                                      "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "server_status", "description": "Server disk usage and load.",
                                      "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "diagnose", "description": "Recent health history for one TV.",
                                      "parameters": {"type": "object", "properties": {"device_id": {"type": "string"}}, "required": ["device_id"]}}},
    {"type": "function", "function": {"name": "restart_tv", "description": "Reboot one TV (asks the user first).",
                                      "parameters": {"type": "object", "properties": {"device_id": {"type": "string"}}, "required": ["device_id"]}}},
    {"type": "function", "function": {"name": "run_maintenance", "description": "Clear app caches and reboot; device_id or 'all' (asks first).",
                                      "parameters": {"type": "object", "properties": {"device_id": {"type": "string"}}, "required": ["device_id"]}}},
]


def _devices() -> list[dict]:
    if not DB.exists():
        return []
    with sqlite3.connect(DB) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute("SELECT device_id, model, assigned_ip, location FROM devices")]


def _device(device_id: str) -> dict | None:
    return next((d for d in _devices() if d["device_id"].lower() == str(device_id).lower()), None)


def _history(device_id: str, n: int = 20) -> list[dict]:
    if not HEALTH_LOG.exists():
        return []
    out = []
    for line in HEALTH_LOG.read_text(errors="ignore").splitlines()[-3000:]:
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("label", "").split("@")[0].lower() == device_id.lower():
            out.append(r)
    return out[-n:]


def _adb_target(dev: dict) -> str:
    ip = dev["assigned_ip"]
    return ip if ":" in ip else f"{ip}:5555"


def run_tool(name: str, args: dict) -> dict:
    try:
        if name == "fleet_status":
            rows = []
            for d in _devices():
                h = _history(d["device_id"], 1)
                last = h[-1] if h else {}
                rows.append({"id": d["device_id"], "location": d["location"], "state": last.get("adb", "no data"),
                             "uptime_h": last.get("uptime_h"), "tcp_ms": last.get("tcp_ms"), "checked": last.get("ts")})
            online = sum(r["state"] == "device" for r in rows)
            lines = [f"{r['id']} ({r['location']}): {'online' if r['state'] == 'device' else r['state']}" for r in rows]
            return {"devices": rows, "summary": f"{online}/{len(rows)} TVs online\n" + "\n".join(lines)}
        if name == "server_status":
            du = shutil.disk_usage(ROOT)
            return {"disk_used_pct": round(du.used / du.total * 100, 1), "disk_free_gb": round(du.free / 1e9, 1)}
        if name == "diagnose":
            return {"device_id": args.get("device_id"), "history": _history(args.get("device_id", ""))}
        if name == "restart_tv":
            dev = _device(args.get("device_id", ""))
            if not dev:
                return {"error": "unknown device"}
            t = _adb_target(dev)
            subprocess.run(["adb", "connect", t], capture_output=True, timeout=15)
            r = subprocess.run(["adb", "-s", t, "reboot"], capture_output=True, text=True, timeout=30)
            return {"ok": r.returncode == 0, "output": (r.stdout + r.stderr).strip()}
        if name == "run_maintenance":
            script = MAINT / "android-maintenance-fleet.sh"
            target = args.get("device_id", "all")
            cmd = ["bash", str(script)]
            if target != "all":
                dev = _device(target)
                if not dev:
                    return {"error": "unknown device"}
                one = MAINT / ".one-device.conf"
                one.write_text(f"{dev['assigned_ip']} {dev['device_id']}\n")
                cmd.append(str(one))
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
            return {"ok": r.returncode == 0, "log_tail": r.stdout[-1500:]}
    except Exception as e:  # report, don't crash the bot
        return {"error": str(e)}
    return {"error": f"unknown tool {name}"}


if __name__ == "__main__":  # quick manual test: python fleet_tools.py fleet_status
    print(json.dumps(run_tool(sys.argv[1] if len(sys.argv) > 1 else "fleet_status", {}), indent=2))
