# Things you asked for that Vidar won't include

Each item has the closest legal alternative that *is* in the build.

| # | You wanted | Why it's out | What Vidar does instead |
|---|---|---|---|
| 1 | **Thunder IPTV reseller panel** and line provisioning | Resells pay channels without a license from the rights holders | Live sports via services you subscribe to (YouTube TV, DAZN, F1 TV Pro, NBA League Pass, Peacock, ViX) + free FAST channels (Pluto, Samsung TV Plus, Plex) in the Live tab |
| 2 | **PPV boxing / UFC channel bouquets** from that panel | Same: unlicensed pay-per-view | Buy events through DAZN / ESPN+ / the official PPV app on the box |
| 3 | **Torrentio + TorBox** in Stremio, with quality filters and API key | Streams pirated movies and shows | Your own Jellyfin library inside Vidar TV and Stremio (Jellyfin add-on), legal add-ons, Trakt sync |
| 4 | **Sonarr / Radarr** style torrent automation | Automates downloading copyrighted media | Jellyseerr for requests, Tdarr + Bazarr for files you own |
| 5 | **IPTV expiration / TorBox tracking** as a fleet feature | Only meaningful for items 1 and 3 | The columns still exist in `fleet_db.py` but nothing automates them |
| 6 | **Reselling the service** (tiers, $45/mo, $400/yr) | Selling unlicensed streams | Private network for you and family, free |
| 7 | **Hidden payment memos** ("PC Repair", banned words) | Concealing income/what's sold | — |
| 8 | **"Stealth" to hide streaming from ISPs / rights holders** | Evasion of enforcement | Privacy is in: Tailscale, Cloudflare Access, NextDNS, no open ports |
| 9 | **Gundam Vidar artwork committed or published** | Sunrise/Bandai design and fan artists' work | Swappable logo slot (file or link); your flat logo lives only on your copies (`site/build.py`, `vidar_logo.png`) |
| 10 | **Bitdefender (commercial) VPN on the TVs** | Not a rules issue: Android allows one VPN, it would knock Tailscale off | Tailscale exit node; keep Bitdefender on phones/laptops |

Everything else from the plan is built or scheduled — see `VIDAR_PLAN.md`.
