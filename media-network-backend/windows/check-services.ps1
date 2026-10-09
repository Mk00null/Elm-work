<#
.SYNOPSIS  Vidar server status check (read-only). Exit code = number of failures.
#>
$Root = Split-Path $PSScriptRoot -Parent
$script:fail = 0
function Row($name, $state, $detail) {
  $color = @{ OK = "Green"; WARN = "Yellow"; FAIL = "Red" }[$state]
  if ($state -eq "FAIL") { $script:fail++ }
  Write-Host ("  {0,-26}" -f $name) -NoNewline
  Write-Host ("{0,-5}" -f $state) -ForegroundColor $color -NoNewline
  Write-Host " $detail"
}

Write-Host "== Windows services" -ForegroundColor Cyan
foreach ($s in @(@("JellyfinServer","Jellyfin"), @("Tailscale","Tailscale"), @("cloudflared","Cloudflare tunnel"))) {
  $svc = Get-Service -Name $s[0] -ErrorAction SilentlyContinue
  if (-not $svc) { Row $s[1] "WARN" "not installed" }
  elseif ($svc.Status -eq "Running") { Row $s[1] "OK" "running" }
  else { Row $s[1] "FAIL" $svc.Status }
}

Write-Host "== Containers" -ForegroundColor Cyan
docker info *> $null
if ($LASTEXITCODE -ne 0) { Row "Docker" "FAIL" "daemon not reachable" }
else {
  foreach ($c in "hbbs","hbbr","uptime-kuma","jellyseerr","bazarr","tdarr","homeassistant","vidar-dashboard","navidrome","audiobookshelf","immich-server") {
    $st = docker inspect -f "{{.State.Status}}" $c 2>$null
    if (-not $st) { Row $c "WARN" "not created" } elseif ($st -eq "running") { Row $c "OK" "running" } else { Row $c "FAIL" $st }
  }
}

Write-Host "== Ports" -ForegroundColor Cyan
foreach ($p in @(@(8096,"Jellyfin"),@(21116,"RustDesk ID"),@(21117,"RustDesk relay"),@(3001,"Uptime Kuma"),@(5055,"Jellyseerr"),@(8123,"Home Assistant"),@(8080,"Vidar dashboard"),@(11434,"Ollama"),@(4533,"Navidrome"),@(13378,"Audiobookshelf"),@(2283,"Immich"))) {
  $open = Test-NetConnection -ComputerName 127.0.0.1 -Port $p[0] -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($open) { Row "$($p[0]) $($p[1])" "OK" "listening" } else { Row "$($p[0]) $($p[1])" "FAIL" "closed" }
}

Write-Host "== Probes" -ForegroundColor Cyan
try { $r = Invoke-WebRequest http://localhost:8096/health -UseBasicParsing -TimeoutSec 5; Row "Jellyfin /health" "OK" $r.Content }
catch { Row "Jellyfin /health" "FAIL" $_.Exception.Message }
$ts = (& tailscale ip -4 2>$null)
if ($ts) { Row "Tailscale IP" "OK" $ts } else { Row "Tailscale IP" "WARN" "not signed in" }
$disk = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -gt 0 } | ForEach-Object {
  $pct = [math]::Round($_.Used / ($_.Used + $_.Free) * 100); "$($_.Name): $pct%" }
Row "Disk use" "OK" ($disk -join "  ")

Write-Host ""
if ($script:fail -eq 0) { Write-Host "All checks passed." -ForegroundColor Green } else { Write-Host "$script:fail check(s) failed." -ForegroundColor Red }
exit $script:fail
