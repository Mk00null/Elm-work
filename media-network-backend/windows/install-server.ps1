<#
.SYNOPSIS
  Vidar server installer for Windows 11 (HP OmniDesk).
.DESCRIPTION
  Installs and configures everything the Vidar server needs. Every step that
  changes the system asks first; run with -Yes to accept all.
    1. Apps via winget: Docker Desktop, Jellyfin, Tailscale, cloudflared,
       Android platform-tools (adb), Python 3.12, Ollama, Git
    2. Always-on power settings (no sleep, no hibernate)
    3. Python packages for the dashboard and bot
    4. Starts the Docker services (RustDesk, Uptime Kuma, Jellyseerr, Bazarr,
       Tdarr, Home Assistant, dashboard, bot) — Jellyfin runs natively for
       AMD hardware transcoding
    5. Pulls the Ollama model and registers scheduled tasks
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install-server.ps1
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [string]$Model = "llama3.2:3b"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Log  = Join-Path $PSScriptRoot "install.log"
Start-Transcript -Path $Log -Append | Out-Null

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  [ok] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Ask($q)    { if ($Yes) { return $true }; (Read-Host "$q [y/N]") -match '^[Yy]' }

# --- 0. Preflight -----------------------------------------------------------
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell (Run as administrator)." }
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget missing: install 'App Installer' from the Microsoft Store." }
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
if ($ramGB -lt 15) { Warn "Only $ramGB GB RAM. Works, but upgrade to 16 GB before enabling Ollama." } else { Ok "$ramGB GB RAM" }

# --- 1. Apps ----------------------------------------------------------------
Step "Install apps with winget"
$apps = [ordered]@{
  "Docker.DockerDesktop"   = "Docker Desktop (runs the containers, needs WSL2)"
  "Jellyfin.Server"        = "Jellyfin media server (native, AMD AMF transcoding)"
  "tailscale.tailscale"    = "Tailscale mesh"
  "Cloudflare.cloudflared" = "Cloudflare tunnel"
  "Google.PlatformTools"   = "adb for TV maintenance"
  "Python.Python.3.12"     = "Python for scripts, dashboard and bot"
  "Ollama.Ollama"          = "Local AI models"
  "Git.Git"                = "Git (also provides bash for the .sh scripts)"
}
foreach ($id in $apps.Keys) {
  $installed = winget list --id $id -e 2>$null | Select-String $id
  if ($installed) { Ok "$($apps[$id]) already installed"; continue }
  if (Ask "Install $($apps[$id])?") {
    winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) { Warn "winget returned $LASTEXITCODE for $id" } else { Ok "Installed $id" }
  }
}
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")

# --- 2. Always-on power -----------------------------------------------------
Step "Server power settings"
if (Ask "Disable sleep/hibernate and keep the PC always on?") {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change monitor-timeout-ac 15
  powercfg /hibernate off
  Ok "Sleep disabled. Also set 'Restore on AC power loss: Power On' in the BIOS."
}
if (Ask "Set Windows Update active hours to 08:00-02:00 (no surprise restarts at night)?") {
  $k = "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty $k ActiveHoursStart 8; Set-ItemProperty $k ActiveHoursEnd 2
  Ok "Active hours set"
}

# --- 3. Python deps -----------------------------------------------------------
Step "Python packages"
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
& $py -m pip install --upgrade -r (Join-Path $Root "dashboard\requirements.txt") -r (Join-Path $Root "bot\requirements.txt")
Ok "Dashboard and bot dependencies installed"

# --- 4. Config + Docker services ---------------------------------------------
Step "Configuration"
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $Root ".env.example") $envFile
  Warn "Created .env from template. Edit it now (media path, domain, Telegram token), then press Enter."
  notepad $envFile | Out-Null
  Read-Host "Press Enter when .env is saved"
} else { Ok ".env exists" }

Step "Docker services"
if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
  Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
  Write-Host "  Waiting for Docker to start..."
  for ($i=0; $i -lt 60; $i++) { docker info *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 5 }
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Warn "Docker isn't running yet (first install may need a reboot). Re-run this script after rebooting." }
elseif (Ask "Start Vidar containers now?") {
  Push-Location $Root
  docker compose --profile apps up -d hbbs hbbr uptime-kuma jellyseerr bazarr tdarr homeassistant dashboard
  Pop-Location
  Ok "Containers started"
}

# --- 5. Ollama + scheduled tasks ---------------------------------------------
Step "AI model"
if ((Get-Command ollama -ErrorAction SilentlyContinue) -and (Ask "Download Ollama model $Model (~2-5 GB)?")) {
  ollama pull $Model; Ok "Model $Model ready"
}

Step "Scheduled tasks"
if (Ask "Register maintenance (Tue/Fri 04:00), health checks (15 min), nightly backup (03:00) and the Telegram bot (at logon)?") {
  $bash = "C:\Program Files\Git\bin\bash.exe"
  $set  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $mk = {
    param($name, $exe, $arg, $trigger)
    Register-ScheduledTask -TaskName "Vidar-$name" -Force -RunLevel Highest -Settings $set `
      -Action (New-ScheduledTaskAction -Execute $exe -Argument $arg -WorkingDirectory $Root) -Trigger $trigger | Out-Null
    Ok "Vidar-$name"
  }
  & $mk "Maintenance" $bash "`"$Root\scripts\maintenance\android-maintenance-fleet.sh`"" `
     (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Friday -At 4:00AM)
  $t = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 15)
  & $mk "Health" $py "`"$Root\scripts\maintenance\fleet_health.py`" --quiet" $t
  & $mk "Backup" $py "`"$Root\scripts\backup\vidar_backup.py`"" (New-ScheduledTaskTrigger -Daily -At 3:00AM)
  & $mk "Bot" $py "`"$Root\bot\vidar_bot.py`"" (New-ScheduledTaskTrigger -AtLogOn)
}

Step "Done"
Write-Host @"
Next:
  1. Sign in to Tailscale (tray icon) and note this PC's 100.x address.
  2. Open Jellyfin at http://localhost:8096: create libraries on your media drive,
     Dashboard > Playback > Transcoding > AMD AMF, one user per location.
  3. Run .\setup-tunnels.ps1 for jelly.<domain>.com
  4. Run .\check-services.ps1
Log: $Log
"@
Stop-Transcript | Out-Null
