#!/usr/bin/env bash
# =============================================================================
# setup-tunnels.sh — install cloudflared, create a tunnel, route subdomains,
# and install cloudflared as a systemd service. Interactive; prompts before
# every step that changes the system or your Cloudflare account.
#
# Usage: sudo ./setup-tunnels.sh <domain-without-.com> [tunnel-name]
#   e.g. sudo ./setup-tunnels.sh mysite media-network
# =============================================================================
set -euo pipefail

DOMAIN="${1:?usage: $0 <domain-without-.com> [tunnel-name]}"
TUNNEL_NAME="${2:-media-network}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/cloudflared-config.yml"
CF_DIR=/etc/cloudflared

info()    { printf '\033[1;34m[i]\033[0m %s\n' "$*"; }
ok()      { printf '\033[1;32m[✓]\033[0m %s\n' "$*"; }
die()     { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
confirm() { read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo) — needed for /etc and systemd."
[[ -f "$TEMPLATE" ]] || die "Template not found: $TEMPLATE"

# --- 1. Install cloudflared -------------------------------------------------
if command -v cloudflared >/dev/null; then
  ok "cloudflared present: $(cloudflared --version)"
elif confirm "Install cloudflared from Cloudflare's apt repo?"; then
  command -v apt-get >/dev/null || die "Non-Debian system: install manually from https://pkg.cloudflare.com"
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update && apt-get install -y cloudflared
  ok "Installed $(cloudflared --version)"
else
  die "cloudflared is required."
fi

# --- 2. Authenticate --------------------------------------------------------
if [[ -f /root/.cloudflared/cert.pem ]]; then
  ok "Already authenticated (cert.pem found)."
else
  info "A browser URL will be printed; log in and select the zone ${DOMAIN}.com."
  confirm "Run 'cloudflared tunnel login'?" || die "Aborted."
  cloudflared tunnel login
fi

# --- 3. Create tunnel (idempotent) ------------------------------------------
TUNNEL_ID="$(cloudflared tunnel list -o json | python3 -c \
  "import sys,json;print(next((t['id'] for t in json.load(sys.stdin) if t['name']=='$TUNNEL_NAME'),''))")"
if [[ -n "$TUNNEL_ID" ]]; then
  ok "Tunnel '$TUNNEL_NAME' exists: $TUNNEL_ID"
else
  confirm "Create tunnel '$TUNNEL_NAME'?" || die "Aborted."
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID="$(cloudflared tunnel list -o json | python3 -c \
    "import sys,json;print(next(t['id'] for t in json.load(sys.stdin) if t['name']=='$TUNNEL_NAME'))")"
  ok "Created tunnel $TUNNEL_ID"
fi

# --- 4. Render config -------------------------------------------------------
mkdir -p "$CF_DIR"
cp "/root/.cloudflared/${TUNNEL_ID}.json" "$CF_DIR/" 2>/dev/null || true
chmod 600 "$CF_DIR/${TUNNEL_ID}.json"
sed -e "s/<TUNNEL_ID>/$TUNNEL_ID/g" -e "s/<DOMAIN>/$DOMAIN/g" "$TEMPLATE" > "$CF_DIR/config.yml"
cloudflared tunnel --config "$CF_DIR/config.yml" ingress validate
ok "Config written to $CF_DIR/config.yml"

# --- 5. DNS routes ----------------------------------------------------------
for sub in support jelly; do
  host="$sub.$DOMAIN.com"
  if confirm "Create/overwrite CNAME $host -> tunnel?"; then
    cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$host"
    ok "Routed $host"
  fi
done

# --- 6. systemd service -----------------------------------------------------
if confirm "Install and start cloudflared as a systemd service?"; then
  systemctl is-enabled cloudflared >/dev/null 2>&1 || cloudflared --config "$CF_DIR/config.yml" service install
  systemctl enable --now cloudflared
  systemctl restart cloudflared
  systemctl --no-pager status cloudflared | head -n 5
fi

ok "Done. Jellyfin: https://jelly.$DOMAIN.com"
