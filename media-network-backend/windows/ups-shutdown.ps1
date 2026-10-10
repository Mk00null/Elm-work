<#
.SYNOPSIS  Clean shutdown when a USB UPS runs low. Registered by install-server.ps1 (every 2 min).
.DESCRIPTION
  Windows sees most USB UPSes (APC, CyberPower) as a battery. When on battery and
  charge drops below -Threshold, stop containers and Jellyfin, then shut down.
#>
param([int]$Threshold = 30)
$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $b) { exit 0 }                        # no UPS connected
$onBattery = $b.BatteryStatus -eq 1            # 1 = discharging
$log = Join-Path $PSScriptRoot "ups.log"
if ($onBattery) { Add-Content $log "$(Get-Date -f s) on battery, $($b.EstimatedChargeRemaining)%" }
if ($onBattery -and $b.EstimatedChargeRemaining -le $Threshold) {
  Add-Content $log "$(Get-Date -f s) below $Threshold% — shutting down"
  Push-Location (Split-Path $PSScriptRoot -Parent)
  docker compose --profile apps --profile media stop 2>&1 | Out-Null
  Pop-Location
  Stop-Service JellyfinServer -ErrorAction SilentlyContinue
  Stop-Computer -Force
}
