#!/usr/bin/env python3
"""provision-tv.py — set up a new Vidar TV box in one command.

Steps (each logged; --dry-run prints the adb commands without running them):
  1. adb connect to the box
  2. apps from apps.json: sideload APKs found in scripts/provision/apks/, and for
     Play-only apps open their Play Store page on the TV (choose groups with --apps)
  3. NextDNS Private DNS (if NEXTDNS_PROFILE_ID is set)
  4. quiet the box: no screensaver ads, faster animations, stay awake on power
  5. set Vidar TV (or Projectivy) as the home app
  6. record the box in inventory/fleet.db and regenerate devices.conf

Example:
  ./provision-tv.py --ip 100.64.0.11 --device-id APT-LIVING --model "RockTek G2" --location apartment
"""
from __future__ import annotations

import argparse
import json
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
    # privacy: no usage/diagnostic reporting, no ad-ID personalization prompts
    ("global", "send_action_app_error", "0"),
    ("secure", "send_action_app_error", "0"),
    ("global", "dropbox_max_files", "0"),
    ("secure", "limit_ad_tracking", "1"),
]
# Google TV recommendation/ad surfaces disabled per-user (reversible: pm enable <pkg>)
DISABLE_PKGS = ["com.google.android.tvrecommendations", "com.google.android.feedback",
                "com.google.android.leanbacklauncher.recommendations"]


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
    ap.add_argument("--apps", default="core,free_tv,extras",
                    help="comma list of groups from apps.json (core, free_tv, extras)")
    ap.add_argument("--no-wait", action="store_true",
                    help="don't pause for Play Store installs; just list what's missing")
    ap.add_argument("--check-vpn", action="store_true",
                    help="only print the box's public IP and Tailscale exit-node state, then exit")
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

    if a.check_vpn:
        ip = run.adb("shell", "curl", "-s", "https://am.i.mullvad.net/json", check=False) or \
            run.adb("shell", "wget", "-qO-", "https://am.i.mullvad.net/json", check=False)
        print("  public IP / VPN:", ip or "(no curl/wget on the box: open am.i.mullvad.net in a browser on the TV)")
        return 0

    print("[2/6] Installing apps")
    catalog = json.loads((HERE / "apps.json").read_text())
    wanted = [app for g in a.apps.split(",") for app in catalog.get(g.strip(), [])]
    installed = "" if a.dry_run else run.adb("shell", "pm", "list", "packages", check=False)
    missing_play = []
    for app in wanted:
        if f"package:{app['package']}" in installed.split():
            print(f"  ✓ {app['name']}")
            continue
        apk = APK_DIR / app.get("apk", "")
        if app["source"] == "apk" and apk.is_file():
            try:
                run.adb("install", "-r", "-g", str(apk))
                print(f"  + {app['name']} (sideloaded)")
            except RuntimeError as e:
                print(f"  ! {app['name']}: {e}")
        elif app["source"] == "apk":
            print(f"  ! {app['name']}: put {app['apk']} in scripts/provision/apks/")
        else:
            missing_play.append(app)
    for app in missing_play:
        run.adb("shell", "am", "start", "-a", "android.intent.action.VIEW",
                "-d", f"market://details?id={app['package']}", check=False)
        if a.no_wait or a.dry_run:
            print(f"  → {app['name']}: opened in Play Store")
        else:
            input(f"  → {app['name']}: press Install on the TV, then Enter here… ")
    for extra in sorted(APK_DIR.glob("*.apk")):   # any other APKs you dropped in
        if extra.name not in {app.get("apk") for app in wanted}:
            run.adb("install", "-r", "-g", str(extra), check=False)

    print("[3/6] Private DNS")
    prof = os.environ.get("NEXTDNS_PROFILE_ID")
    if prof:
        run.adb("shell", "settings", "put", "global", "private_dns_mode", "hostname")
        run.adb("shell", "settings", "put", "global", "private_dns_specifier", f"{prof}.dns.nextdns.io")
    else:
        print("  (NEXTDNS_PROFILE_ID not set — skipping)")

    print("[4/6] Quieting the box + privacy")
    for ns, key, val in SETTINGS:
        run.adb("shell", "settings", "put", ns, key, val, check=False)
    for pkg in DISABLE_PKGS:
        run.adb("shell", "pm", "disable-user", "--user", "0", pkg, check=False)
    # Google's own toggle for ad personalization can only be flipped by hand:
    run.adb("shell", "am", "start", "-a", "com.google.android.gms.settings.ADS_PRIVACY", check=False)
    print("  → on the TV: turn on 'Opt out of Ads Personalization' / 'Delete advertising ID'")
    print("  → then in Tailscale: Exit node → Mullvad city, Allow LAN access (see VPN.md)")

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
