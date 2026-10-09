#!/usr/bin/env python3
"""setup-jellyfin.py — one-time Jellyfin setup for Vidar via its REST API.

  * Live TV: HDHomeRun / antenna tuner (auto-discover or --hdhomerun IP)
  * Live TV: free FAST channel lineups (Pluto TV, Samsung TV Plus, Plex) + guides
  * Plugins: Intro Skipper, Playback Reporting, TMDb Box Sets
  * Trickplay (scrub preview thumbnails) on every library

Needs an API key (Jellyfin Dashboard > API Keys) in JELLYFIN_API_KEY or --api-key.
Safe to re-run: existing tuners/guides/plugins are skipped.
Example: setup-jellyfin.py --url http://localhost:8096 --hdhomerun auto --fast us
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# Free, official ad-supported streams, repackaged as M3U/XMLTV by i.mjh.nz
FAST = {
    "Pluto TV": ("https://i.mjh.nz/PlutoTV/{r}.m3u8", "https://i.mjh.nz/PlutoTV/{r}.xml"),
    "Samsung TV Plus": ("https://i.mjh.nz/SamsungTVPlus/{r}.m3u8", "https://i.mjh.nz/SamsungTVPlus/{r}.xml"),
    "Plex": ("https://i.mjh.nz/Plex/{r}.m3u8", "https://i.mjh.nz/Plex/{r}.xml"),
}
PLUGIN_REPOS = [
    {"Name": "Jellyfin Stable", "Url": "https://repo.jellyfin.org/files/plugin/manifest.json", "Enabled": True},
    {"Name": "Intro Skipper", "Url": "https://intro-skipper.org/manifest.json", "Enabled": True},
]
PLUGINS = ["Intro Skipper", "Playback Reporting", "TMDb Box Sets"]


class Jellyfin:
    def __init__(self, url: str, key: str, dry: bool):
        self.url, self.key, self.dry = url.rstrip("/"), key, dry

    def call(self, method: str, path: str, body=None):
        if self.dry and method != "GET":
            print(f"  [dry] {method} {path} {json.dumps(body) if body is not None else ''}")
            return None
        req = urllib.request.Request(self.url + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"X-Emby-Token": self.key, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
        return json.loads(raw) if raw else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", default=os.environ.get("JELLYFIN_URL", "http://localhost:8096").replace("host.docker.internal", "localhost"))
    ap.add_argument("--api-key", default=os.environ.get("JELLYFIN_API_KEY", ""))
    ap.add_argument("--hdhomerun", help="'auto' to discover, or the tuner's IP; omit to skip")
    ap.add_argument("--fast", default="us", help="FAST region code (us, mx, ca, gb…) or 'none'")
    ap.add_argument("--no-plugins", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not a.api_key:
        print("error: set JELLYFIN_API_KEY or pass --api-key", file=sys.stderr)
        return 1
    jf = Jellyfin(a.url, a.api_key, a.dry_run)
    try:
        print("Jellyfin", jf.call("GET", "/System/Info/Public")["Version"], "at", a.url)
    except (urllib.error.URLError, OSError) as e:
        print(f"error: can't reach Jellyfin at {a.url}: {e}", file=sys.stderr)
        return 1

    cfg = jf.call("GET", "/System/Configuration/livetv") or {}
    tuner_urls = {t.get("Url") for t in cfg.get("TunerHosts", [])}
    guide_paths = {g.get("Path") for g in cfg.get("ListingProviders", [])}

    if a.hdhomerun:
        print("Antenna tuner")
        url = a.hdhomerun
        if url == "auto":
            found = jf.call("GET", "/LiveTv/Tuners/Discover?NewDevicesOnly=false") or []
            hd = [d for d in found if d.get("Type") == "hdhomerun"]
            if not hd:
                print("  no HDHomeRun found on the network; pass --hdhomerun <ip>")
            url = hd[0]["Url"] if hd else None
        if url and url not in tuner_urls:
            jf.call("POST", "/LiveTv/TunerHosts", {"Type": "hdhomerun", "Url": url, "ImportFavoritesOnly": False,
                                                   "AllowHWTranscoding": True, "TunerCount": 0})
            print(f"  + HDHomeRun {url}  (add a guide: Dashboard > Live TV > Schedules Direct or XMLTV)")
        elif url:
            print(f"  ✓ HDHomeRun {url}")

    if a.fast != "none":
        print(f"Free FAST channels ({a.fast})")
        for name, (m3u, xml) in FAST.items():
            m3u, xml = m3u.format(r=a.fast), xml.format(r=a.fast)
            if m3u not in tuner_urls:
                jf.call("POST", "/LiveTv/TunerHosts", {"Type": "m3u", "Url": m3u, "FriendlyName": name,
                                                       "ImportFavoritesOnly": False, "AllowHWTranscoding": True})
                print(f"  + {name} channels")
            if xml not in guide_paths:
                jf.call("POST", "/LiveTv/ListingProviders?validateListings=false",
                        {"Type": "xmltv", "Path": xml, "EnableAllTuners": True})
                print(f"  + {name} guide")

    if not a.no_plugins:
        print("Plugins")
        repos = jf.call("GET", "/Repositories") or []
        have = {r["Url"] for r in repos}
        new = repos + [r for r in PLUGIN_REPOS if r["Url"] not in have]
        if len(new) != len(repos):
            jf.call("POST", "/Repositories", new)
        installed = {p["Name"] for p in (jf.call("GET", "/Plugins") or [])}
        for name in PLUGINS:
            if name in installed:
                print(f"  ✓ {name}")
                continue
            try:
                jf.call("POST", "/Packages/Installed/" + urllib.request.quote(name))
                print(f"  + {name} (restart Jellyfin to load)")
            except urllib.error.HTTPError as e:
                print(f"  ! {name}: HTTP {e.code}")

    print("Trickplay")
    for lib in jf.call("GET", "/Library/VirtualFolders") or []:
        opts = lib.get("LibraryOptions") or {}
        if not opts.get("EnableTrickplayImageExtraction"):
            opts.update({"EnableTrickplayImageExtraction": True, "ExtractTrickplayImagesDuringLibraryScan": True})
            jf.call("POST", "/Library/VirtualFolders/LibraryOptions", {"Id": lib["ItemId"], "LibraryOptions": opts})
            print(f"  + {lib['Name']}")
        else:
            print(f"  ✓ {lib['Name']}")
    print("Done. Restart Jellyfin if plugins were added.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
