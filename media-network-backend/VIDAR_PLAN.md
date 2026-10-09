# Vidar — Master Build Plan (personal, 7 TVs / 5 locations)

Server: HP OmniDesk M02-0310 (Ryzen 5 8500G, Radeon 740M, Windows 11 Home)
Clients: 7 × Onn 4K Pro / RockTek G2 — apartment, home, partner, office, second home
Scope: legal sources only (own library, free FAST channels, services you subscribe to).
Out of scope: Thunder IPTV, Torrentio/TorBox, Sonarr/Radarr-style torrent automation.

Legend: ✅ done · 🔨 to build · 🛒 to buy · 👤 you do it

---

## Phase 0 — Hardware & accounts (week 0)
| # | Item | Owner | Notes |
|---|---|---|---|
| 0.1 | 16 GB DDR5 (match type: SO-DIMM vs DIMM; prefer 2 matched sticks) | 🛒 | Check Task Manager → Memory → "Slots used" first |
| 0.2 | Media storage: 4–8 TB external HDD or internal 2nd drive | 🛒 | Keep 512 GB SSD for Windows + apps |
| 0.3 | 1 test Onn 4K Pro | 🛒 | Verify Network vs Wireless debugging before buying 6 more |
| 0.4 | Domain on Cloudflare (~$10/yr) | 👤 | For `jelly.<domain>.com` |
| 0.5 | Accounts: Tailscale, NextDNS, Cloudflare, Trakt, Telegram (or Discord) | 👤 | All free tiers suffice |
| 0.6 | Measure home upload speed | 👤 | Drives every bitrate setting below |

**Exit:** server upgraded, drive attached, one test box in hand.

## Phase 1 — Windows server foundation (week 1)
| # | Deliverable | Status |
|---|---|---|
| 1.1 | `windows/install-server.ps1` — winget installs Docker Desktop (WSL2), Jellyfin (native, AMD AMF), Tailscale, cloudflared, RustDesk server, Python, ADB platform-tools | 🔨 |
| 1.2 | Server hardening: sleep off, power-on-after-outage note, update active hours, static DHCP lease, firewall rules (Tailscale-only for ADB/RustDesk) | 🔨 |
| 1.3 | `docker-compose.yml` (RustDesk hbbs/hbbr) | ✅ (Jellyfin moves native on Windows) |
| 1.4 | `windows/check-services.ps1` — status dashboard in terminal | 🔨 |
| 1.5 | `windows/setup-tunnels.ps1` — Cloudflare tunnel for Jellyfin web | 🔨 |
| 1.6 | Jellyfin: libraries on media drive, HW transcoding (AMF), one user per location, remote bitrate cap from 0.6 | 🔨 guide + 👤 |

**Exit:** `check-services.ps1` all green; Jellyfin plays on LAN and at `jelly.<domain>.com`.

## Phase 2 — Network mesh & DNS (week 1–2)
| # | Deliverable | Status |
|---|---|---|
| 2.1 | Tailscale on server + every TV; ACLs so only the server can reach TVs' ADB | ✅ guide · 🔨 ACL file |
| 2.2 | RustDesk clients point at server's Tailscale IP | ✅ guide |
| 2.3 | NextDNS profile push + Android Private DNS via ADB | ✅ `configure-nextdns.sh` · 🔨 `.ps1` port |

**Exit:** server reaches all 7 boxes by `100.x` IP from any location.

## Phase 3 — TV provisioning automation (week 2)
| # | Deliverable | Status |
|---|---|---|
| 3.1 | `fleet_db.py` inventory with locations | ✅ |
| 3.2 | `provision-tv.py` — one command per box: installs APKs (RustDesk, Jellyfin, Tailscale, TiviMate, Stremio), sets Private DNS, disables ads/screensaver bloat, registers in DB | 🔨 |
| 3.3 | Content preset: Jellyfin server URL, Stremio legal add-ons (Cinemeta, Jellyfin, Trakt), TiviMate free FAST playlists (Pluto, Samsung TV Plus, Plex) + XMLTV | 🔨 |
| 3.4 | `PROVISIONING_RUNBOOK.md` | ✅ (update for 3.2) |
| 3.5 | Maintenance: adapt to debugging mode found in 0.3 (reboot vs no-reboot variant) | 🔨 |
| 3.6 | Windows Task Scheduler for Tue/Fri 04:00 + 15-min health checks | ✅ draft · 🔨 finalize |

| 3.7 | **Projectivy Launcher** (fallback home screen until Vidar TV app ships) pushed by `provision-tv.py`: ad-free Vidar home screen (Jellyfin · Stremio · TiviMate · Live), set as default launcher, Vidar wallpaper | 🔨 |
| 3.8 | **Bilingual ES/EN**: per-location TV system language, Jellyfin profile language + Spanish audio/subtitle preference | 🔨 |

**Exit:** a new box goes from unboxed to ready in ~15 min with one command.

## Phase 4 — Vidar Dashboard UI (week 3)
Custom web app served by the server (Tailscale-only + optional Cloudflare Access login).
| View | Content |
|---|---|
| Fleet map | 5 location cards → TVs: online/offline, uptime, last maintenance, RustDesk "Connect" button |
| Server | CPU, RAM, disk, Jellyfin active streams, transcodes, upload usage |
| Actions | Run health check, restart a TV (confirm), run maintenance now, add device |
| Library | Recently added, storage per library, Jellyseerr requests |
| Logs | Health history graphs from `fleet_health.log` |

Stack: FastAPI (Python, reuses fleet_db + health code) + single-page HTML/JS, dark Vidar theme, phone-friendly. 🔨

Also: 🔨 Jellyfin custom CSS "Vidar" theme + per-location profiles; 🔨 Jellyseerr (Docker) for family requests.

## Phase 4B — Vidar TV app (Jet Stream UI) (weeks 3–5)
The TV-side interface, built on Google's **Jet Stream** sample (Jetpack Compose for TV, Apache-2.0):
https://github.com/android/tv-samples/tree/main/JetStreamCompose · design: goo.gle/jet-stream-figma

| # | Deliverable |
|---|---|
| 4B.1 | Fork JetStreamCompose → `vidar-tv/`, rebrand (name, icon, Vidar colors, Inter font, ES/EN strings) |
| 4B.2 | Replace sample data layer with **Jellyfin Kotlin SDK**: login per location, Home hero carousel = Jellyfin "featured/latest", rows = Continue Watching · Recently Added · genres |
| 4B.3 | Screens mapped: Home · Categories (Jellyfin genres) · Movies · Shows (seasons/episodes) · Favorites (Jellyfin favorites) · Search · Details · Settings |
| 4B.4 | **Live tab**: Jellyfin Live TV with free FAST M3U/XMLTV (Pluto, Samsung TV Plus, Plex) → guide grid in Jet Stream style |
| 4B.5 | Playback: Media3/ExoPlayer (in sample) with Jellyfin direct-play/transcode URLs, resume position sync, subtitles/audio picker (ES default) |
| 4B.6 | Server address via Tailscale IP, auto-discovered; no keys hard-coded |
| 4B.7 | Build signed APK on the server (GitHub Actions or local Gradle); `provision-tv.py` installs it and sets it as the home app (replaces Projectivy as the main UI) |
| 4B.8 | Optional "Apps" row linking out to Stremio, TiviMate and your paid services' apps |

**Exit:** turning on any of the 7 TVs lands in Vidar TV, showing your library in the Jet Stream look.
 (week 3–4)
| # | Deliverable |
|---|---|
| 5.1 | Uptime Kuma (Docker): monitors Jellyfin, tunnel, RustDesk, each TV → phone push alerts |
| 5.2 | Nightly backup: Jellyfin config, `fleet.db`, RustDesk keys, `.env` → media drive + optional cloud (rclone) with 14-day retention |
| 5.3 | Bazarr: auto subtitles (ES/EN) for your own library |
| 5.4 | Tdarr: re-encode own library to HEVC to save space/upload |
| 5.5 | **Cloud backup** (Backblaze B2 via rclone, ~$1/mo, encrypted): Jellyfin config, `fleet.db`, RustDesk keys — not media |
| 5.6 | **Home Assistant** (Docker): Android TV integration for all 7 boxes — power on/off, launch apps, "Movie night" scenes, voice via Google/Alexa, dashboard tile in Vidar UI |
| 5.7 | Restore drill doc: rebuild server from backup in < 1 h |

## Phase 6 — Vidar AI Assistant (week 4–5)
Local LLM via **Ollama** on the server (Llama 3.2 3B for speed, Qwen 2.5 7B for quality; ~5 GB RAM — needs the 16 GB upgrade).

**Design: one bot, many tools** (simpler and sturdier than a multi-agent team at 7 TVs; split later if needed).

| Tool | Does | Safety |
|---|---|---|
| `fleet_status` | runs health check, summarizes | read-only |
| `server_status` | CPU/RAM/disk/streams | read-only |
| `restart_tv(id)` | ADB reboot | asks you to confirm |
| `run_maintenance(id|all)` | cache trim | confirm |
| `diagnose(id)` | reads logs + health history, explains, suggests fix | read-only |
| `library_stats` / `recent_additions` | from Jellyfin API | read-only |

Channels: Telegram bot (recommended — easiest, works on all phones) or Discord.
Scheduled: 🌅 daily 9 AM summary · 🚨 instant alert + AI diagnosis when a TV fails 2 checks in a row.
Guardrails: allowlist of your Telegram user ID only; every write action needs a ✅ tap; all actions logged.

## Phase 7 — Polish & handoff (week 6)
- One-page "how to use your Vidar TV" card per location (printable, **Spanish + English**)
- Bilingual Vidar Dashboard and Telegram bot (replies in the language you write in)
- Remote-friendly: grandma-proof home screen layout on each TV
- `README.md` index of everything; version tag `v1.0`

---

## Timeline
| Week | Phases | Milestone |
|---|---|---|
| 0 | 0 | Hardware ready |
| 1 | 1, 2 | Server live, mesh up |
| 2 | 3 | Test box fully provisioned → buy remaining 6 |
| 3 | 4, 5.1–5.2 | Dashboard + alerts + backups |
| 4 | 5.3–5.5, 6 | AI assistant beta |
| 5–6 | 6, 7 | All 7 TVs deployed, v1.0 |

## Budget (one-time, approx.)
| Item | Cost |
|---|---|
| HP OmniDesk | (owned/bought) |
| 16 GB DDR5 | $35–60 |
| 4–8 TB drive | $90–150 |
| 7 × Onn 4K Pro (or mix with G2s) | ~$420 |
| Domain | ~$10/yr |
| Backblaze B2 backup | ~$1/mo |
| Software | $0 (all free tiers / open source) |

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Onn uses Wireless debugging (port changes on reboot) | No-reboot maintenance variant; RustDesk + Tailscale survive reboots |
| Home upload too low for 6 remote TVs | Per-user bitrate caps, Tdarr HEVC, AMF transcoding |
| 8 GB RAM | Upgrade before Phase 6 |
| Windows updates reboot server | Active hours, auto-start services, Uptime Kuma alerts |
| Power outage | BIOS power-on, services auto-start; optional small UPS ($60) |

## Build order (my next actions when you say go)
1.1 → 1.4 → 1.5 → 3.2/3.3 → 4B → 4 → 5.1/5.2 → 6
