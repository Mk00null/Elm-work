# Run in an elevated PowerShell. READ-ONLY except for copying into the evidence folder. Deletes nothing.
$ev = 'C:\sonos-evidence'
New-Item -ItemType Directory -Force -Path $ev, "$ev\files" | Out-Null
Start-Transcript -Path "$ev\collect-transcript.txt" -Append | Out-Null

# 1. Network
"== netstat 1400/5005 ==" | Tee-Object "$ev\netstat.txt"
netstat -ano | findstr ":1400 :5005" | Tee-Object "$ev\netstat.txt" -Append
netstat -ano > "$ev\netstat-full.txt"
$pids = Get-NetTCPConnection -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 1400,5005 -or $_.RemotePort -in 1400,5005 } |
  Select-Object -ExpandProperty OwningProcess -Unique
$pids | ForEach-Object {
  Get-CimInstance Win32_Process -Filter "ProcessId=$_" |
    Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate
} | Tee-Object "$ev\processes-on-ports.txt" | Format-List

# 2. node-sonos-http-api install + logs
$roots = 'C:\','D:\' | Where-Object { Test-Path $_ }
$hits = foreach ($r in $roots) {
  Get-ChildItem $r -Directory -Recurse -Force -ErrorAction SilentlyContinue -Include 'node-sonos-http-api*','sonos-http-api*'
}
# also any package.json that names the project
$pkgs = foreach ($r in $roots) {
  Get-ChildItem $r -Recurse -Force -Filter package.json -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
    Where-Object { Select-String -Path $_.FullName -Pattern 'sonos' -Quiet }
}
$dirs = @($hits.FullName) + @($pkgs | ForEach-Object { $_.DirectoryName }) | Sort-Object -Unique
$dirs | Tee-Object "$ev\sonos-install-dirs.txt"
$i = 0
foreach ($d in $dirs) { $i++; robocopy $d "$ev\files\install$i" /E /COPY:DAT /R:1 /W:1 /XD node_modules | Out-Null }
Get-ChildItem $roots -Recurse -Force -Include *.log -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match 'sonos|node' } |
  ForEach-Object { Copy-Item $_.FullName "$ev\files\log_$($_.Name)_$($_.LastWriteTimeUtc.Ticks)" }

# 3. Persistence
schtasks /query /fo CSV /v > "$ev\schtasks.csv"
Get-ScheduledTask | ForEach-Object { try { Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath } catch {} } > "$ev\schtasks-all.xml"
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup","$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp" -Force -ErrorAction SilentlyContinue |
  Select FullName,LastWriteTime | Out-File "$ev\startup-folders.txt"
reg export HKCU\Software\Microsoft\Windows\CurrentVersion\Run "$ev\HKCU-Run.reg" /y
reg export HKLM\Software\Microsoft\Windows\CurrentVersion\Run "$ev\HKLM-Run.reg" /y
reg export HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run "$ev\HKLM-Run-wow64.reg" /y
Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'node|nssm|pm2|sonos' } |
  Select Name,State,StartMode,PathName | Out-File "$ev\services.txt"

# 4. Scripts mentioning Sonos-related strings
$pat = '1400|5005|RINCON|SetMute|SetVolume|pauseall|sonos'
$users = 'C:\Users','C:\ProgramData','C:\Scripts','C:\Tools','D:\' | Where-Object { Test-Path $_ }
$found = foreach ($u in $users) {
  Get-ChildItem $u -Recurse -Force -Include *.ps1,*.bat,*.cmd,*.py,*.js,*.vbs,*.json -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\AppData\\Local\\(Google|Microsoft|Temp)\\' } |
    Where-Object { Select-String -Path $_.FullName -Pattern $pat -Quiet }
}
$found | Select FullName,LastWriteTime | Tee-Object "$ev\script-matches.txt"
foreach ($f in $found) { $dest = "$ev\files\scripts" + ($f.FullName -replace '[:\\]','_'); Copy-Item $f.FullName $dest -ErrorAction SilentlyContinue }

# 5. Spotify
"== Spotify ==" | Out-File "$ev\spotify.txt"
Get-Process | Where-Object Name -match 'spotify' | Select Id,Name,Path,StartTime | Out-File "$ev\spotify.txt" -Append
Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*,HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue |
  Where-Object DisplayName -match 'spotify' | Select DisplayName,DisplayVersion,InstallLocation | Out-File "$ev\spotify.txt" -Append
Get-AppxPackage *Spotify* | Select Name,Version | Out-File "$ev\spotify.txt" -Append
Test-Path "$env:APPDATA\Spotify" | Out-File "$ev\spotify.txt" -Append
# Signed-in indicator: presence of a user prefs entry (does not copy credentials)
Select-String -Path "$env:APPDATA\Spotify\prefs" -Pattern 'autologin|username' -ErrorAction SilentlyContinue | Out-File "$ev\spotify.txt" -Append
Get-ScheduledTask | Where-Object { $_.Actions.Execute -match 'spotify' -or $_.TaskName -match 'spotify' } | Out-File "$ev\spotify.txt" -Append

Stop-Transcript | Out-Null
Get-FileHash -Algorithm SHA256 -Path (Get-ChildItem $ev -Recurse -File).FullName | Export-Csv "$ev\SHA256-manifest.csv" -NoTypeInformation
"Done. Review $ev before running 2-contain.ps1"
