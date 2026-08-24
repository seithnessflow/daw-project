<#
.SYNOPSIS
    Branche l'URL cloudflare du jour sur l'hote ssh `portable` et teste.

.DESCRIPTION
    Le quick tunnel change d'URL a chaque lancement (docs/deux-machines.md).
    Ce script patch le HostName du bloc `Host portable` dans ~/.ssh/config
    puis prouve la liaison par un `ssh portable "whoami & hostname"`.

.EXAMPLE
    scripts\liaison.ps1 -Url https://xxx-yyy.trycloudflare.com
#>
param(
    [Parameter(Mandatory = $true)][string]$Url
)

$hostname = ($Url -replace '^https?://', '') -replace '/.*$', ''
if ($hostname -notmatch '\.trycloudflare\.com$') {
    Write-Error "URL inattendue : $hostname (attendu *.trycloudflare.com)"
}

$config = Join-Path $env:USERPROFILE ".ssh\config"
$lines = Get-Content $config
$inBlock = $false
$out = foreach ($l in $lines) {
    if ($l -match '^\s*Host\s+(.+)$') { $inBlock = ($Matches[1].Trim() -eq 'portable') }
    if ($inBlock -and $l -match '^\s*HostName\s') { "  HostName $hostname" }
    else { $l }
}
Set-Content $config $out -Encoding ascii
Write-Host "HostName -> $hostname" -ForegroundColor Magenta

ssh -o ConnectTimeout=15 portable "whoami & hostname"
if ($LASTEXITCODE -eq 0) { Write-Host "LIAISON OK" -ForegroundColor Green }
else { Write-Error "ssh portable a echoue (tunnel vivant ? URL exacte ?)" }
