<#
.SYNOPSIS  Create the Cloudflare tunnel for jelly.<domain>.com and install it as a Windows service.
.EXAMPLE   .\setup-tunnels.ps1 -Domain mysite.com
#>
param([Parameter(Mandatory)][string]$Domain, [string]$TunnelName = "vidar")
$ErrorActionPreference = "Stop"
function Ask($q) { (Read-Host "$q [y/N]") -match '^[Yy]' }
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared not installed: run install-server.ps1 first." }
$cfDir = Join-Path $env:USERPROFILE ".cloudflared"

if (-not (Test-Path "$cfDir\cert.pem")) {
  Write-Host "A browser window opens: sign in and pick $Domain."
  cloudflared tunnel login
}
$t = (cloudflared tunnel list -o json | ConvertFrom-Json) | Where-Object name -eq $TunnelName
if (-not $t) {
  if (-not (Ask "Create tunnel '$TunnelName'?")) { exit 1 }
  cloudflared tunnel create $TunnelName | Out-Host
  $t = (cloudflared tunnel list -o json | ConvertFrom-Json) | Where-Object name -eq $TunnelName
}
$id = $t.id
$cfg = @"
tunnel: $id
credentials-file: $cfDir\$id.json
ingress:
  - hostname: jelly.$Domain
    service: http://localhost:8096
  - service: http_status:404
"@
Set-Content -Path "$cfDir\config.yml" -Value $cfg -Encoding UTF8
cloudflared tunnel ingress validate
if (Ask "Point jelly.$Domain at the tunnel (creates/overwrites the DNS record)?") {
  cloudflared tunnel route dns --overwrite-dns $TunnelName "jelly.$Domain"
}
if (Ask "Install cloudflared as a Windows service?") {
  cloudflared --config "$cfDir\config.yml" service install
  Start-Service cloudflared
}
Write-Host "Done. Add Cloudflare Access (Zero Trust > Access > Applications) for an email-code login on jelly.$Domain."
Write-Host "RustDesk stays on Tailscale; it can't run through this tunnel."
