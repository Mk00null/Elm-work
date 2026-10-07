# Run ONLY after reviewing 1-collect.ps1 output. Stops and DISABLES; deletes nothing.
# Usage: .\2-contain.ps1 -Pid 1234 -TaskNames 'Name1','Name2' -ServiceNames 'svc'
param(
  [int[]]$Pid,
  [string[]]$TaskNames = @(),
  [string[]]$ServiceNames = @()
)
$ev = 'C:\sonos-evidence'
Start-Transcript -Path "$ev\contain-transcript.txt" -Append | Out-Null

foreach ($p in $Pid) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$p" | Select ProcessId,Name,CommandLine | Out-File "$ev\stopped.txt" -Append
  Stop-Process -Id $p -Force
}
foreach ($t in $TaskNames)    { Disable-ScheduledTask -TaskName $t | Out-File "$ev\disabled.txt" -Append }
foreach ($s in $ServiceNames) { Stop-Service $s -Force; Set-Service $s -StartupType Disabled; "service $s disabled" | Out-File "$ev\disabled.txt" -Append }

# Run-key / Startup entries: rename-free approach -> move disabled marker via StartupApproved (reversible)
# Do these by hand after reviewing HKCU-Run.reg / HKLM-Run.reg / startup-folders.txt:
#   Task Manager > Startup apps > Disable   (writes HKCU/HKLM ...\Explorer\StartupApproved\Run)

netstat -ano | findstr ":5005" | Out-File "$ev\post-containment-netstat.txt"
Stop-Transcript | Out-Null
"Verify :5005 no longer listening: see post-containment-netstat.txt"
