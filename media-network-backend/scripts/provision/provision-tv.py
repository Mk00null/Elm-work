#!/usr/bin/env python3
"""provision-tv.py — set up a new Vidar TV box in one command.

Steps (each logged; --dry-run prints the adb commands without running them):
  1. adb connect to the box
  2. install every APK in scripts/provision/apks/ (Vidar TV, RustDesk, Tailscale,
     Jellyfin, TiviMate, Stremio, Projectivy — download them yourself, see apks/README.md)
  3. NextDNS Private DNS (if NEXTDNS_PROFILE_ID is set)
  4. quiet the box: no screensaver ads, faster animations, stay awake on power
  5. set Vidar TV (or Projectivy) as the home app
  6. record the box in inventory/fleet.db and regenerate devices.conf

Example:
  ./provision-tv.py --ip 100.64.0.11 --device-id APT-LIVING --model "RockTek G2" --location apartment
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
APK_DIR = HERE / "apks"
FLEET_DB = ROOT / "inventory/fleet_db.py"
DEVICES_CONF = ROOT / "scripts/maintenance/devices.conf"
HOME_APPS = ["com.vidar.tv/com.google.jetstream.MainActivity",
             "com.spocky.projengmenu/.ui.home.MainActivity"]

SETTINGS = [  # (namespace, key, value) — safe, reversible tweaks
    ("global", "window_animation_scale", "0.5"),
    ("global", "transition_animation_scale", "0.5"),
    ("global", "animator_duration_scale", "0.5"),
    ("global", "stay_on_while_plugged_in", "7"),
    ("secure", "screensaver_enabled", "0"),
    ("global", "auto_time", "1"),
]


class Runner:
    def __init__(self, target: str, dry: bool):
        self.target, self.dry = target, dry

    def adb(self, *args: str, check: bool = True) -> str:
        cmd = ["adb", "-s", self.target, *args]
        print("  $", " ".join(cmd))
        if self.dry:
            return ""
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if check and r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout).strip())
        return r.stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ip", required=True, help="box IP (Tailscale 100.x or LAN)")
    ap.add_argument("--device-id", required=True)
    ap.add_argument("--model", required=True, choices=["Onn 4K Pro", "RockTek G2"])
    ap.add_argument("--location", required=True,
                    choices=["apartment", "home", "partner", "office", "second-home"])
    ap.add_argument("--mac")
    ap.add_argument("--rustdesk-id")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not a.dry_run and not shutil.which("adb"):
        print("error: adb not found (install Android platform-tools)", file=sys.stderr)
        return 1
    target = a.ip if ":" in a.ip else f"{a.ip}:5555"
    run = Runner(target, a.dry_run)

    print(f"[1/6] Connecting to {target}")
    if not a.dry_run:
        out = subprocess.run(["adb", "connect", target], capture_output=True, text=True, timeout=20).stdout
        if "connected" not in out:
            print(f"error: {out.strip() or 'no answer'} — is network debugging on and the prompt accepted?", file=sys.stderr)
            return 1

    print("[2/6] Installing apps")
    apks = sorted(APK_DIR.glob("*.apk"))
    if not apks:
        print("  (no APKs in scripts/provision/apks — skipping; see apks/README.md)")
    for apk in apks:
        try:
            run.adb("install", "-r", "-g", str(apk))
        except RuntimeError as e:
            print(f"  ! {apk.name}: {e}")

    print("[3/6] Private DNS")
    prof = os.environ.get("NEXTDNS_PROFILE_ID")
    if prof:
        run.adb("shell", "settings", "put", "global", "private_dns_mode", "hostname")
        run.adb("shell", "settings", "put", "global", "private_dns_specifier", f"{prof}.dns.nextdns.io")
    else:
        print("  (NEXTDNS_PROFILE_ID not set — skipping)")

    print("[4/6] Quieting the box")
    for ns, key, val in SETTINGS:
        run.adb("shell", "settings", "put", ns, key, val, check=False)

    print("[5/6] Home app")
    for comp in HOME_APPS:
        pkg = comp.split("/")[0]
        if a.dry_run or pkg in run.adb("shell", "pm", "list", "packages", pkg, check=False):
            run.adb("shell", "cmd", "package", "set-home-activity", comp, check=False)
            print(f"  home app → {pkg}")
            break
    else:
        print("  (Vidar TV / Projectivy not installed — keeping stock launcher)")

    print("[6/6] Registering in the fleet database")
    mac = a.mac
    if not mac and not a.dry_run:
        mac = run.adb("shell", "cat", "/sys/class/net/wlan0/address", check=False) or None
    base = [sys.executable, str(FLEET_DB)]
    fields = ["--device-id", a.device_id, "--model", a.model, "--ip", a.ip, "--location", a.location]
    if mac:
        fields += ["--mac", mac]
    if a.rustdesk_id:
        fields += ["--rustdesk-id", a.rustdesk_id]
    cmds = [base + ["--add"] + fields, base + ["--export-devices", str(DEVICES_CONF)]]
    for c in cmds:
        print("  $", " ".join(c))
        if not a.dry_run:
            r = subprocess.run(c, capture_output=True, text=True)
            if r.returncode and "constraint" in r.stderr:   # already registered → update instead
                upd = base + ["--update", a.device_id] + fields[2:]
                r = subprocess.run(upd, capture_output=True, text=True)
            print("   ", (r.stdout or r.stderr).strip())

    print(f"\nDone: {a.device_id} at {a.location}. Next: open RustDesk on the TV, set the ID server to "
          "the server's Tailscale IP, then add --rustdesk-id with fleet_db.py --update.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
