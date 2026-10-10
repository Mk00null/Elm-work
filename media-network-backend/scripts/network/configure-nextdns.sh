#!/usr/bin/env bash
# =============================================================================
# configure-nextdns.sh — NextDNS profile + endpoint configuration.
#
# Subcommands:
#   api-push     Push blocklists/privacy settings to a NextDNS profile (API)
#   system       Configure this Linux host (systemd-resolved, DoT + fallbacks)
#   profiles     Generate endpoint configs (Android Private DNS, Apple
#                .mobileconfig, DoH/DoT URLs) into ./out/
#
# Env:  NEXTDNS_PROFILE_ID (required)  NEXTDNS_API_KEY (api-push only;
#       NEXTDNS_KIDS=1 adds parental controls — use a second profile for kids TVs;
#       from https://my.nextdns.io/account)
# Example:  NEXTDNS_PROFILE_ID=abc123 NEXTDNS_API_KEY=xxx ./configure-nextdns.sh api-push
#
# Note: DNS filtering blocks trackers/telemetry and defeats DNS-based ISP
# blocking/hijacking. It cannot bypass bandwidth throttling (that needs a VPN).
# =============================================================================
set -euo pipefail

PROFILE="${NEXTDNS_PROFILE_ID:?set NEXTDNS_PROFILE_ID}"
API="https://api.nextdns.io/profiles/$PROFILE"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/out"
LOG="${LOG_FILE:-/tmp/configure-nextdns.log}"

log()  { printf '%s [%s] %s\n' "$(date -Is)" "$1" "${*:2}" | tee -a "$LOG" >&2; }
die()  { log ERROR "$*"; exit 1; }
confirm() { read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy]$ ]]; }

# Blocklist IDs as defined by NextDNS
BLOCKLISTS=(oisd steven-black)
# Native tracking protection (device telemetry)
NATIVE=(android apple windows samsung xiaomi alexa roku sonos)

api() {  # api METHOD PATH [JSON]
  local method=$1 path=$2 body=${3:-}
  local code
  code=$(curl -sS -o /tmp/nextdns.resp -w '%{http_code}' -X "$method" \
    -H "X-Api-Key: ${NEXTDNS_API_KEY:?set NEXTDNS_API_KEY}" \
    -H 'Content-Type: application/json' ${body:+-d "$body"} "$API$path") \
    || die "network error calling $path"
  [[ $code =~ ^2 ]] || die "$method $path -> HTTP $code: $(cat /tmp/nextdns.resp)"
}

cmd_api_push() {
  log INFO "Pushing settings to profile $PROFILE"
  for b in "${BLOCKLISTS[@]}"; do api POST /privacy/blocklists "{\"id\":\"$b\"}" && log INFO "blocklist +$b"; done
  for n in "${NATIVE[@]}";     do api POST /privacy/natives    "{\"id\":\"$n\"}" && log INFO "native tracker block +$n"; done
  api PATCH /privacy  '{"disguisedTrackers":true,"allowAffiliate":false}'
  api PATCH /security '{"threatIntelligenceFeeds":true,"cryptojacking":true,"dnsRebinding":true,"typosquatting":true,"dga":true,"nrd":false}'
  # Google TV / Android ad + telemetry endpoints
  for d in ads.google.com googleads.g.doubleclick.net pagead2.googlesyndication.com \
           app-measurement.com firebase-settings.crashlytics.com tvrecommendations-pa.googleapis.com; do
    api POST /denylist "{\"id\":\"$d\",\"active\":true}" && log INFO "deny $d"
  done
  if [[ "${NEXTDNS_KIDS:-0}" == 1 ]]; then   # use a separate profile ID for the kids TV
    api PATCH /parentalControl '{"safeSearch":true,"youtubeRestrictedMode":true,"blockBypass":true}'
    for c in porn gambling dating piracy social-networks; do
      api POST /parentalControl/categories "{\"id\":\"$c\",\"active\":true}" && log INFO "kids block $c"
    done
  fi
  api PATCH /settings '{"logs":{"enabled":true,"retention":604800},"performance":{"ecs":true,"cacheBoost":true}}'
  log INFO "Profile updated."
}

cmd_system() {
  [[ $EUID -eq 0 ]] || die "system mode requires root"
  systemctl is-active --quiet systemd-resolved || die "systemd-resolved not running"
  local conf=/etc/systemd/resolved.conf.d/nextdns.conf
  confirm "Write $conf and restart systemd-resolved?" || die "Aborted"
  mkdir -p "$(dirname "$conf")"
  [[ -f $conf ]] && cp "$conf" "$conf.bak.$(date +%s)"
  cat > "$conf" <<CONF
# Managed by configure-nextdns.sh
[Resolve]
# NextDNS over TLS (anycast IPs; SNI carries the profile ID)
DNS=45.90.28.0#${PROFILE}.dns.nextdns.io
DNS=2a07:a8c0::#${PROFILE}.dns.nextdns.io
DNS=45.90.30.0#${PROFILE}.dns.nextdns.io
DNS=2a07:a8c1::#${PROFILE}.dns.nextdns.io
# Encrypted fallbacks (used only if NextDNS unreachable — unfiltered)
FallbackDNS=1.1.1.1#cloudflare-dns.com 8.8.8.8#dns.google
DNSOverTLS=yes
DNSSEC=allow-downgrade
Domains=~.
CONF
  systemctl restart systemd-resolved
  resolvectl query -t A test.nextdns.io >/dev/null && log INFO "Resolution OK" || die "Resolution test failed; revert $conf"
  curl -fsS https://test.nextdns.io | tee -a "$LOG"
}

cmd_profiles() {
  mkdir -p "$OUT_DIR"
  cat > "$OUT_DIR/endpoints.txt" <<TXT
NextDNS profile: $PROFILE
Android TV "Private DNS" hostname (Onn 4K Pro / RockTek G2):
  ${PROFILE}.dns.nextdns.io
  adb shell settings put global private_dns_mode hostname
  adb shell settings put global private_dns_specifier ${PROFILE}.dns.nextdns.io
DoH:  https://dns.nextdns.io/${PROFILE}
DoT:  ${PROFILE}.dns.nextdns.io
Fallback DoH: https://cloudflare-dns.com/dns-query , https://dns.google/dns-query
Fallback DoT: 1.1.1.1 (cloudflare-dns.com) , 8.8.8.8 (dns.google)
TXT
  local uuid1 uuid2; uuid1=$(cat /proc/sys/kernel/random/uuid); uuid2=$(cat /proc/sys/kernel/random/uuid)
  cat > "$OUT_DIR/nextdns.mobileconfig" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadContent</key><array><dict>
    <key>DNSSettings</key><dict>
      <key>DNSProtocol</key><string>HTTPS</string>
      <key>ServerURL</key><string>https://apple.dns.nextdns.io/${PROFILE}</string>
    </dict>
    <key>PayloadIdentifier</key><string>io.nextdns.${PROFILE}.dns</string>
    <key>PayloadType</key><string>com.apple.dnsSettings.managed</string>
    <key>PayloadUUID</key><string>${uuid1}</string>
    <key>PayloadVersion</key><integer>1</integer>
  </dict></array>
  <key>PayloadDisplayName</key><string>NextDNS (${PROFILE})</string>
  <key>PayloadIdentifier</key><string>io.nextdns.${PROFILE}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid2}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict></plist>
XML
  log INFO "Wrote $OUT_DIR/endpoints.txt and nextdns.mobileconfig"
}

case "${1:-}" in
  api-push) cmd_api_push ;;
  system)   cmd_system ;;
  profiles) cmd_profiles ;;
  *) sed -n '3,15p' "$0"; exit 2 ;;
esac
