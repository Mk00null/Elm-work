# Provisioning Runbook — Home Media Network

Workbench steps for bringing a new Android TV box (Onn 4K Pro / RockTek G2)
onto your home network. Run the backend first (`docker compose up -d`, then
`./check-services.sh`).

## 1. Initialize
Boot, finish Google TV setup, join the bench Wi-Fi (5 GHz for the Onn — its
Ethernet port is 100 Mbps; use wired Gigabit on the G2), install all system updates.

## 2. Developer unlock
Settings → System → About → click **Android TV OS build** 7×.
Developer options → enable **USB debugging** (and **Network debugging** if present).
Allow **Install unknown apps** for your file manager / Downloader.
From the server: `adb connect <box-ip>:5555` and accept the prompt on the TV
("Always allow").

## 3. Register in inventory
```bash
inventory/fleet_db.py --add --device-id TV-001 --model "Onn 4K Pro" \
  --mac <MAC> --ip <IP> --notes "living room"
inventory/fleet_db.py --export-devices scripts/maintenance/devices.conf
```
Use the box's Tailscale `100.x` IP (see MULTI_SITE.md) and add `--location <site>`.

## 4. Remote anchor (RustDesk)
`adb install rustdesk-<ver>-aarch64.apk` (from github.com/rustdesk/rustdesk/releases).
In RustDesk → Settings → ID/Relay server: ID server `support.<domain>.com`,
key = contents of `data/rustdesk/id_ed25519.pub`. Enable unattended access
with a strong, per-device password stored in your password manager.
Record the ID: `fleet_db.py --update TV-001 --rustdesk-id <ID>`.
> RustDesk needs raw TCP/UDP — forward 21115-21117/tcp + 21116/udp on the
> router with a DNS-only record; a Cloudflare HTTP tunnel won't carry it.

## 5. DNS
`NEXTDNS_PROFILE_ID=<id> scripts/network/configure-nextdns.sh profiles`,
then run the two `adb shell settings put global private_dns_*` lines from
`scripts/network/out/endpoints.txt`.

## 6. Live TV (legal free channels)
Install TiviMate (or any M3U player). Add free FAST playlists you are licensed
to use, e.g. the iptv-org Pluto/Samsung TV Plus/Plex lists with their XMLTV
guides. Add any paid service you personally subscribe to with its own credentials.

## 7. Jellyfin client
Install Jellyfin for Android TV from Play Store. Server `https://jelly.<domain>.com`,
log in with a per-user account; play one item to confirm playback/transcoding.

## 8. Automation & verification
Install `scripts/maintenance/crontab.txt` on the server. Then:
```bash
scripts/maintenance/fleet_health.py              # ADB reachable, uptime
scripts/maintenance/android-maintenance-fleet.sh --dry-run
./check-services.sh
```
Connect once via RustDesk from another device to confirm remote control.
