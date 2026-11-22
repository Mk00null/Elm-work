# VPN on the Vidar TVs

**Constraint:** Android runs one VPN at a time. Tailscale is a VPN, and Vidar
needs it (Jellyfin, RustDesk, maintenance, the dashboard all use it). Turning
on Bitdefender VPN on a TV would switch Tailscale off and cut the box from the server.

**Bitdefender VPN can't be chained in either:** it's built on Hotspot Shield's
own protocol and doesn't hand out WireGuard/OpenVPN configs, so it can't run
inside Tailscale, on a router, or in a container. Keep it on your phones and laptops.

## Recommended: Tailscale + Mullvad exit nodes (all traffic encrypted, one app)
Every TV sends its internet traffic through Mullvad's no-log VPN servers while
Tailscale keeps the private link to your server. One app, nothing to switch.

1. Tailscale admin → Settings → **Mullvad VPN** add-on (≈ $5/month per 5 devices; 7 TVs = 2 slots).
2. Admin → Machines: tag the TVs `tag:vidar-tv`; the policy in `tailscale/policy.hujson`
   grants them Mullvad (`nodeAttrs`) and internet access.
3. On each TV: Tailscale app → **Exit node** → pick a nearby Mullvad city → enable
   **Allow LAN access** (keeps casting and the antenna tuner working).
4. Check from the server: `provision-tv.py --check-vpn --ip <tv>` prints the box's public IP.

Your server traffic (Jellyfin, RustDesk) stays direct over Tailscale and is not slowed down.

## Alternatives
| Option | Pros | Cons |
|---|---|---|
| **Home server as exit node** (`tailscale up --advertise-exit-node` on the OmniDesk) | Free; boxes at other locations appear to be at your home | Your home upload carries all their traffic |
| **VPN on each location's router** (WireGuard: Mullvad / Proton / IVPN) | Covers every device there | Router must support WireGuard; set up per location |
| **Proton VPN or Mullvad app instead of Tailscale on one box** | Simple | That box loses Vidar (no server link) |

## Expect
- Some services (Netflix, sports apps, Pluto/Tubi regional content) block or limit VPN IPs.
  Choose a city in your own country; if one app complains, pick another Mullvad city.
- Antenna (HDHomeRun) and Jellyfin aren't affected.
