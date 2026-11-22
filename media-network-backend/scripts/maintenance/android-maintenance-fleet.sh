#!/usr/bin/env bash
# =============================================================================
# android-maintenance-fleet.sh — cache purge + reboot for Android TV boxes
# (Onn 4K Pro, RockTek G2) over ADB network debugging.
#
# Per device:
#   1. adb connect
#   2. force-stop Stremio / TiviMate (frees RAM, flushes in-memory buffers)
#   3. pm trim-caches  -> system purges app *cache* dirs only. App data,
#      databases, playlists and login tokens are untouched (never `pm clear`).
#   4. trim memory, drop logcat buffer, clear /data/local/tmp leftovers
#   5. adb reboot
#
# Note: Android without root cannot clear one app's cache in isolation;
# trim-caches clears caches for all apps, which is the safe equivalent.
#
# Usage: ./android-maintenance-fleet.sh [--dry-run] [devices.conf]
# =============================================================================
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DRY=0; [[ "${1:-}" == --dry-run ]] && { DRY=1; shift; }
CONF="${1:-$DIR/devices.conf}"
LOG="${LOG_FILE:-$DIR/maintenance.log}"
PACKAGES=(org.stremio.stremio ar.tvplayer.tv)
TIMEOUT=20

log() { printf '%s [%s] %s\n' "$(date -Is)" "$1" "${*:2}" | tee -a "$LOG"; }
command -v adb >/dev/null || { log ERROR "adb not found (apt install android-tools-adb)"; exit 1; }
[[ -f $CONF ]] || { log ERROR "device list $CONF missing"; exit 1; }

run() {  # run SERIAL cmd... ; honours dry-run and timeout
  local s=$1; shift
  if (( DRY )); then log DRY "$s: adb $*"; return 0; fi
  timeout "$TIMEOUT" adb -s "$s" "$@" 2>&1
}

maintain() {
  local target=$1 label=$2
  [[ $target == *:* ]] || target="$target:5555"
  log INFO "== $label ($target) =="
  if (( ! DRY )); then
    timeout "$TIMEOUT" adb connect "$target" | grep -qE 'connected' \
      || { log ERROR "$label: connect failed"; return 1; }
    [[ $(run "$target" get-state) == device* ]] \
      || { log ERROR "$label: unauthorized/offline — accept ADB prompt on TV"; return 1; }
  fi
  for p in "${PACKAGES[@]}"; do
    if (( DRY )) || run "$target" shell pm path "$p" | grep -q package:; then
      run "$target" shell am force-stop "$p" && log INFO "$label: stopped $p"
    else
      log WARN "$label: $p not installed"
    fi
  done
  run "$target" shell pm trim-caches 999G      && log INFO "$label: app caches trimmed (data preserved)"
  run "$target" shell am kill-all               >/dev/null
  run "$target" shell 'rm -rf /data/local/tmp/*' >/dev/null
  run "$target" logcat -c                       >/dev/null
  run "$target" reboot                          && log INFO "$label: reboot issued"
  (( DRY )) || adb disconnect "$target" >/dev/null 2>&1
}

ok=0; failed=0
while read -r target label _; do
  [[ -z ${target:-} || $target == \#* ]] && continue
  if maintain "$target" "${label:-$target}"; then ok=$((ok+1)); else failed=$((failed+1)); fi
done < "$CONF"
log INFO "Run complete: $ok succeeded, $failed failed"
exit $(( failed > 0 ))
