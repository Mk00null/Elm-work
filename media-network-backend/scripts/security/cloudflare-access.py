#!/usr/bin/env python3
"""cloudflare-access.py — put a login wall and rate limit in front of jelly.<domain>.

  * Cloudflare Access app on jelly.<domain> with an email one-time-code policy
    (only ACCESS_ALLOWED_EMAILS can open it)
  * Rate-limit rule on the zone: blocks an IP that hammers the login (brute force)

Env: CLOUDFLARE_API_TOKEN (Access: Apps and Policies Edit, Zone WAF Edit),
     CLOUDFLARE_ACCOUNT_ID, ACCESS_ALLOWED_EMAILS (comma-separated)
Usage: cloudflare-access.py --domain example.com [--dry-run]
Note: TV apps talk to Jellyfin over Tailscale, so the login wall never blocks them.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"


def cf(method: str, path: str, body=None, dry=False):
    if dry and method != "GET":
        print(f"  [dry] {method} {path}\n        {json.dumps(body)[:300]}")
        return {}
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Cloudflare {method} {path}: HTTP {e.code} {e.read().decode()[:300]}")
    if not data.get("success", True):
        raise SystemExit(f"Cloudflare error: {data.get('errors')}")
    return data.get("result")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--domain", required=True)
    ap.add_argument("--sub", default="jelly")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    for k in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"):
        if not os.environ.get(k) and not a.dry_run:
            print(f"error: set {k}", file=sys.stderr)
            return 1
    emails = [e.strip() for e in os.environ.get("ACCESS_ALLOWED_EMAILS", "").split(",") if e.strip()]
    if not emails:
        print("error: set ACCESS_ALLOWED_EMAILS", file=sys.stderr)
        return 1
    acct, host = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "ACCOUNT"), f"{a.sub}.{a.domain}"

    print(f"Access login wall for {host}")
    apps = [] if a.dry_run else cf("GET", f"/accounts/{acct}/access/apps") or []
    app = next((x for x in apps if x.get("domain") == host), None)
    body = {"name": "Vidar Jellyfin", "domain": host, "type": "self_hosted", "session_duration": "720h",
            "auto_redirect_to_identity": False, "app_launcher_visible": True,
            "policies": [{"name": "Family", "decision": "allow", "precedence": 1,
                          "include": [{"email": {"email": e}} for e in emails]}]}
    if app:
        cf("PUT", f"/accounts/{acct}/access/apps/{app['id']}", body, a.dry_run)
        print("  ✓ updated")
    else:
        cf("POST", f"/accounts/{acct}/access/apps", body, a.dry_run)
        print("  + created (login: email one-time code)")

    print("Rate limit")
    zone = {"id": "ZONE"} if a.dry_run else (cf("GET", f"/zones?name={a.domain}") or [None])[0]
    if not zone:
        print(f"  ! zone {a.domain} not found in this account")
        return 1
    rule = {"description": "Vidar: throttle login hammering", "action": "block",
            "expression": f'(http.host eq "{host}")',
            "ratelimit": {"characteristics": ["ip.src", "cf.colo.id"], "period": 60,
                          "requests_per_period": 120, "mitigation_timeout": 600}}
    cf("PUT", f"/zones/{zone['id']}/rulesets/phases/http_ratelimit/entrypoint", {"rules": [rule]}, a.dry_run)
    print("  + 120 req/min per IP, 10-minute block")
    print("Also turn on: Security → Bots → Bot Fight Mode (free) for the zone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
