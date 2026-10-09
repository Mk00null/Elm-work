# Windows alternative: registers a Scheduled Task (Tue/Fri 04:00) that runs the
# fleet script through Git Bash. Run from an elevated PowerShell.
param(
  [string]$ScriptPath = "$PSScriptRoot\android-maintenance-fleet.sh",
  [string]$Bash = "C:\Program Files\Git\bin\bash.exe"
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Bash)) { throw "Git Bash not found at $Bash" }
if (-not (Test-Path $ScriptPath)) { throw "Script not found: $ScriptPath" }
$action  = New-ScheduledTaskAction -Execute $Bash -Argument "`"$ScriptPath`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Friday -At 4:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "AndroidFleetMaintenance" -Action $action -Trigger $trigger `
  -Settings $settings -RunLevel Highest -Force | Out-Null
Write-Host "Registered task 'AndroidFleetMaintenance' (Tue/Fri 04:00)."
