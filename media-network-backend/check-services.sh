#!/usr/bin/env bash
# =============================================================================
# check-services.sh — container health, port bindings, HTTP probes, tunnel.
# Read-only. Exit code = number of failed checks.
# =============================================================================
set -uo pipefail

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
FAIL=0
row()  { printf "  %-28s %s\n" "$1" "$2"; }
pass() { row "$1" "${G}● OK${N}   $2"; }
warn() { row "$1" "${Y}● WARN${N} $2"; }
fail() { row "$1" "${R}● FAIL${N} $2"; FAIL=$((FAIL+1)); }

echo "${B}== Containers ==${N}"
if ! docker info >/dev/null 2>&1; then
  fail "docker daemon" "not reachable"
else
  for c in hbbs hbbr jellyfin; do
    state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null) || { fail "$c" "not found"; continue; }
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$c")
    restarts=$(docker inspect -f '{{.RestartCount}}' "$c")
    if [[ $state == running && $health != unhealthy ]]; then
      pass "$c" "state=$state health=$health restarts=$restarts"
    else
      fail "$c" "state=$state health=$health restarts=$restarts"
    fi
  done
fi

echo "${B}== Port bindings ==${N}"
# proto:port:service
for spec in tcp:21115:hbbs tcp:21116:hbbs udp:21116:hbbs tcp:21118:hbbs \
            tcp:21117:hbbr tcp:21119:hbbr tcp:8096:jellyfin udp:7359:jellyfin; do
  IFS=: read -r proto port svc <<<"$spec"
  flag=$([[ $proto == tcp ]] && echo -ltn || echo -lun)
  if ss -H $flag "sport = :$port" 2>/dev/null | grep -q .; then
    pass "$port/$proto ($svc)" "listening"
  else
    fail "$port/$proto ($svc)" "not listening"
  fi
done

echo "${B}== Service probes ==${N}"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8096/health)
[[ $code == 200 ]] && pass "Jellyfin /health" "HTTP $code" || fail "Jellyfin /health" "HTTP ${code:-none}"
if timeout 3 bash -c '</dev/tcp/127.0.0.1/21116' 2>/dev/null; then
  pass "RustDesk hbbs TCP" "accepting connections"
else
  fail "RustDesk hbbs TCP" "connection refused"
fi
key=./data/rustdesk/id_ed25519.pub
[[ -s $key ]] && pass "RustDesk public key" "$(cat "$key")" || warn "RustDesk public key" "not generated yet"

echo "${B}== Cloudflare tunnel ==${N}"
if ! command -v cloudflared >/dev/null; then
  warn "cloudflared" "not installed"
elif systemctl is-active --quiet cloudflared 2>/dev/null; then
  pass "cloudflared service" "active"
else
  fail "cloudflared service" "inactive"
fi

echo
[[ $FAIL -eq 0 ]] && echo "${G}${B}All checks passed.${N}" || echo "${R}${B}$FAIL check(s) failed.${N}"
exit $FAIL
