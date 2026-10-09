# Vidar — 7 TVs across 5 locations

```
                 ┌──────────── Home server (Minisforum, at "home") ───────────┐
                 │ Jellyfin · RustDesk hbbs/hbbr · fleet_db · cron maintenance│
                 └───────┬───────────────────────────────┬────────────────────┘
          Tailscale mesh │ (ADB, RustDesk, Jellyfin LAN)  │ Cloudflare tunnel
                         │                               │ jelly.<domain>.com
   ┌──────────┬──────────┼──────────┬──────────┐         │ (browsers/phones)
 apartment   home     partner    office   second-home
  2 TVs      2 TVs     1 TV       1 TV      1 TV
```

## Why Tailscale
Only the "home" TVs share the server's LAN. ADB (port 5555) and RustDesk must
**never** be exposed to the internet, and TVs at other sites sit behind other
routers. Tailscale (free for personal use, up to 100 devices) puts every box
on a private `100.x.y.z` network, so the maintenance cron, `fleet_health.py`
and RustDesk reach all 7 boxes as if they were local — no port forwarding at
any location.

1. Server: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
2. Each TV: install **Tailscale** from Play Store, sign in, enable
   "Run on startup / Always-on". Disable key expiry for the box in the admin console.
3. Use the TV's `100.x` address as `--ip` in `fleet_db.py`.
4. RustDesk ID server on every TV: the server's Tailscale IP (e.g. `100.64.0.1`)
   — this also solves the "RustDesk can't go through Cloudflare" problem.
5. Jellyfin server URL on every TV: `http://100.64.0.1:8096` (fastest, private);
   `https://jelly.<domain>.com` stays for phones/browsers.

## Bandwidth budget
All remote TVs stream from your home **upload**. 4K remux ≈ 40–80 Mbps,
1080p ≈ 8–15 Mbps. With e.g. 40 Mbps upload: set each Jellyfin remote user's
*Internet streaming bitrate limit* to ~12 Mbps (Dashboard → Users → Playback)
and enable hardware transcoding (uncomment `/dev/dri` in docker-compose.yml;
Dashboard → Playback → VAAPI). The Home-site TVs stay full quality on LAN.

## Register the fleet
```bash
cd inventory
./fleet_db.py --add --device-id APT-LIVING --model "RockTek G2" --ip 100.64.0.11 --location apartment
./fleet_db.py --add --device-id APT-BED    --model "Onn 4K Pro" --ip 100.64.0.12 --location apartment
./fleet_db.py --add --device-id HOME-LIVING --model "RockTek G2" --ip 100.64.0.21 --location home
./fleet_db.py --add --device-id HOME-BED   --model "Onn 4K Pro" --ip 100.64.0.22 --location home
./fleet_db.py --add --device-id PARTNER    --model "Onn 4K Pro" --ip 100.64.0.31 --location partner
./fleet_db.py --add --device-id OFFICE     --model "Onn 4K Pro" --ip 100.64.0.41 --location office
./fleet_db.py --add --device-id SECOND-HOME --model "RockTek G2" --ip 100.64.0.51 --location second-home
./fleet_db.py --export-devices ../scripts/maintenance/devices.conf
../scripts/maintenance/fleet_health.py
```

## Per-household Jellyfin users
One Jellyfin user per location (`apartment`, `partner`, …) keeps separate
watch history / Continue Watching and lets you set per-site bitrate limits
and parental controls.
