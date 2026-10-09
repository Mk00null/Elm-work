# Vidar — home media network

Private media network for 7 Android TV boxes across 5 locations, run from one
home server (HP OmniDesk, Windows 11).

| Folder | What |
|---|---|
| `windows/` | **Start here on the server**: `install-server.ps1`, `check-services.ps1`, `setup-tunnels.ps1` |
| `docker-compose.yml` | RustDesk (always) + `--profile apps`: Uptime Kuma, Jellyseerr, Bazarr, Tdarr, Home Assistant, dashboard; `--profile media`: Immich, Navidrome, Audiobookshelf; `--profile ai`: Ollama (Linux) |
| `scripts/provision/provision-tv.py` + `apps.json` | One command to set up a new TV box (core, free TV, extras) |
| `scripts/jellyfin/setup-jellyfin.py` | Live TV (antenna + Pluto/Samsung/Plex), Intro Skipper, Playback Reporting, Box Sets, trickplay |
| `scripts/maintenance/` | Tue/Fri cache trim + reboot, 15-min health checks |
| `scripts/network/` | NextDNS profile + device config |
| `scripts/backup/` | Nightly config backup (+ optional encrypted cloud copy) |
| `inventory/fleet_db.py` | Device database (location, IP, RustDesk ID…) |
| `dashboard/` | Vidar Dashboard web panel (port 8080) |
| `bot/` | Vidar Assistant Telegram bot (Ollama) |
| `vidar-tv/` | Vidar TV Android app (Jet Stream fork, Jellyfin-backed) |
| `site/` | Project site with a live TV UI demo |
| `VIDAR_PLAN.md`, `MULTI_SITE.md`, `PROVISIONING_RUNBOOK.md`, `WONT_ADD.md` | Plan, multi-site guide, workbench steps, out-of-scope list |

## Bring-up order
1. Server: `windows\install-server.ps1` → set up Jellyfin → `setup-tunnels.ps1 -Domain <yours>` → `check-services.ps1`
2. Vidar TV: set `vidar-tv/jetstream/src/main/res/values/vidar_config.xml` (server Tailscale IP + location user), build (Android Studio or the CI artifact), copy APK to `scripts/provision/apks/`
3. Each TV: enable network debugging → install Tailscale → `provision-tv.py --ip … --device-id … --model … --location …`
4. Phone: create a Telegram bot with @BotFather, put token + your user ID in `.env`, the installer's task starts it

## Tests
`python -m unittest discover -s tests` · CI (`.github/workflows/vidar.yml`) also builds the APK.
