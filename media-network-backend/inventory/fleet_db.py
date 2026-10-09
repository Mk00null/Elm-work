#!/usr/bin/env python3
"""fleet_db.py — SQLite inventory of deployed TV endpoints.

Examples:
  fleet_db.py --add --device-id TV-001 --model "Onn 4K Pro" --mac AA:BB:CC:DD:EE:FF \
      --ip 100.64.0.11 --location apartment --rustdesk-id 123456789 --iptv-exp 2027-01-31 --torbox yes
  fleet_db.py --update TV-001 --ip 192.168.1.60 --notes "moved to bedroom"
  fleet_db.py --list [--expiring 30]
  fleet_db.py --search 192.168.1
  fleet_db.py --delete TV-001
  fleet_db.py --export-devices ../scripts/maintenance/devices.conf
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "fleet.db"
MODELS = ("Onn 4K Pro", "RockTek G2")
MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    device_id            TEXT PRIMARY KEY,
    model                TEXT NOT NULL CHECK (model IN ('Onn 4K Pro', 'RockTek G2')),
    mac_address          TEXT UNIQUE,
    assigned_ip          TEXT,
    rustdesk_id          TEXT,
    iptv_expiration_date DATE,
    torbox_api_bound     BOOLEAN NOT NULL DEFAULT 0,
    deployment_notes     TEXT,
    location             TEXT
);
"""
LOCATIONS = ("apartment", "home", "partner", "office", "second-home")
# CLI flag -> column
FIELDS = {"model": "model", "mac": "mac_address", "ip": "assigned_ip",
          "rustdesk_id": "rustdesk_id", "iptv_exp": "iptv_expiration_date",
          "torbox": "torbox_api_bound", "notes": "deployment_notes", "location": "location"}


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute(SCHEMA)
    # migrate databases created before the location column existed
    if "location" not in {r[1] for r in conn.execute("PRAGMA table_info(devices)")}:
        conn.execute("ALTER TABLE devices ADD COLUMN location TEXT")
    return conn


def validate(values: dict) -> dict:
    """Normalise and validate user input; raises ValueError."""
    out = {}
    for flag, col in FIELDS.items():
        v = values.get(flag)
        if v is None:
            continue
        if flag == "model" and v not in MODELS:
            raise ValueError(f"model must be one of {MODELS}")
        if flag == "mac":
            if not MAC_RE.match(v):
                raise ValueError(f"invalid MAC address: {v}")
            v = v.upper().replace("-", ":")
        if flag == "iptv_exp":
            v = date.fromisoformat(v).isoformat()  # raises on bad date
        if flag == "torbox":
            if v.lower() not in ("yes", "no", "true", "false", "1", "0"):
                raise ValueError("--torbox must be yes/no")
            v = int(v.lower() in ("yes", "true", "1"))
        out[col] = v
    return out


def print_rows(rows) -> None:
    rows = list(rows)
    if not rows:
        print("(no devices)")
        return
    cols = ["device_id", "model", "mac_address", "assigned_ip", "rustdesk_id",
            "location", "iptv_expiration_date", "torbox_api_bound", "deployment_notes"]
    heads = ["ID", "MODEL", "MAC", "IP", "RUSTDESK", "SITE", "IPTV EXP", "TORBOX", "NOTES"]
    data = [[("yes" if r[c] else "no") if c == "torbox_api_bound" else str(r[c] or "-")
             for c in cols] for r in rows]
    widths = [max(len(h), *(len(d[i]) for d in data)) for i, h in enumerate(heads)]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*heads))
    print(fmt.format(*("-" * w for w in widths)))
    for d in data:
        print(fmt.format(*d))


def main() -> int:
    ap = argparse.ArgumentParser(description="TV fleet inventory",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    act = ap.add_mutually_exclusive_group(required=True)
    act.add_argument("--add", action="store_true")
    act.add_argument("--update", metavar="DEVICE_ID")
    act.add_argument("--list", action="store_true")
    act.add_argument("--search", metavar="TERM")
    act.add_argument("--delete", metavar="DEVICE_ID")
    act.add_argument("--export-devices", metavar="FILE", help="write devices.conf for maintenance scripts")
    ap.add_argument("--device-id")
    ap.add_argument("--model", choices=MODELS)
    ap.add_argument("--mac")
    ap.add_argument("--ip")
    ap.add_argument("--rustdesk-id")
    ap.add_argument("--iptv-exp", metavar="YYYY-MM-DD")
    ap.add_argument("--torbox", metavar="yes|no")
    ap.add_argument("--notes")
    ap.add_argument("--location", choices=LOCATIONS, help="site the box lives at")
    ap.add_argument("--expiring", type=int, metavar="DAYS", help="with --list: IPTV expiring within N days")
    ap.add_argument("--db", type=Path, default=DB_PATH)
    a = ap.parse_args()

    try:
        conn = connect(a.db)
        values = validate(vars(a))
        with conn:
            if a.add:
                if not a.device_id or not a.model:
                    ap.error("--add requires --device-id and --model")
                values["device_id"] = a.device_id
                cols = ", ".join(values)
                conn.execute(f"INSERT INTO devices ({cols}) VALUES ({', '.join('?' * len(values))})",
                             tuple(values.values()))
                print(f"added {a.device_id}")
            elif a.update:
                if not values:
                    ap.error("--update needs at least one field to change")
                sets = ", ".join(f"{c} = ?" for c in values)
                cur = conn.execute(f"UPDATE devices SET {sets} WHERE device_id = ?",
                                   (*values.values(), a.update))
                if cur.rowcount == 0:
                    raise LookupError(f"no device {a.update}")
                print(f"updated {a.update}")
            elif a.delete:
                if conn.execute("DELETE FROM devices WHERE device_id = ?", (a.delete,)).rowcount == 0:
                    raise LookupError(f"no device {a.delete}")
                print(f"deleted {a.delete}")
            elif a.list:
                if a.expiring is not None:
                    cutoff = (date.today() + timedelta(days=a.expiring)).isoformat()
                    rows = conn.execute("SELECT * FROM devices WHERE iptv_expiration_date <= ? "
                                        "ORDER BY iptv_expiration_date", (cutoff,))
                else:
                    rows = conn.execute("SELECT * FROM devices ORDER BY location, device_id")
                print_rows(rows)
            elif a.search:
                like = f"%{a.search}%"
                print_rows(conn.execute(
                    "SELECT * FROM devices WHERE device_id LIKE ? OR model LIKE ? OR mac_address LIKE ? "
                    "OR assigned_ip LIKE ? OR rustdesk_id LIKE ? OR deployment_notes LIKE ? OR location LIKE ?", (like,) * 7))
            elif a.export_devices:
                rows = conn.execute("SELECT device_id, assigned_ip, location FROM devices "
                                    "WHERE assigned_ip IS NOT NULL ORDER BY location")
                lines = [f"{r['assigned_ip']} {r['device_id']}@{r['location'] or 'unknown'}" for r in rows]
                Path(a.export_devices).write_text("# generated by fleet_db.py\n" + "\n".join(lines) + "\n")
                print(f"wrote {len(lines)} devices to {a.export_devices}")
    except (ValueError, LookupError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except sqlite3.IntegrityError as e:
        print(f"error: constraint violated ({e})", file=sys.stderr)
        return 1
    except sqlite3.Error as e:
        print(f"database error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
