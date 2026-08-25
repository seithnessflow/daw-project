# SPDX-License-Identifier: GPL-3.0-or-later
# Met a jour le HostName ssh du portable avec l'URL cloudflared du jour.
# Le tunnel quick-cloudflared est EPHEMERE : son URL change a chaque
# lancement. Ce script evite de reediter ~/.ssh/config a la main.
#
# Usage :
#   .\scripts\portable-url.ps1 https://xxx-yyy-zzz.trycloudflare.com
#   .\scripts\portable-url.ps1 xxx-yyy-zzz.trycloudflare.com   (schema optionnel)
#
# Puis : ssh portable "hostname"   (doit repondre TX15 / flow)

param([Parameter(Mandatory=$true)][string]$Url)

# Accepte l'URL avec ou sans https:// et nettoie un / final.
$host_ = $Url -replace '^https?://','' -replace '/+$',''
if ($host_ -notmatch '\.trycloudflare\.com$') {
    Write-Error "URL inattendue : '$Url' (attendu ...trycloudflare.com)"; exit 1
}

$cfg = Join-Path $HOME '.ssh\config'
if (-not (Test-Path $cfg)) { Write-Error "Pas de $cfg"; exit 1 }

$lines = Get-Content $cfg
$out = $lines -replace '^(\s*HostName\s+).*trycloudflare\.com\s*$', "`${1}$host_"
# UTF-8 SANS BOM : Set-Content -Encoding utf8 en PS 5.1 ajoute un BOM qui
# casse le parse d'OpenSSH ("Bad configuration option: \357\273\277host").
[System.IO.File]::WriteAllLines($cfg, $out, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "HostName -> $host_"
Write-Host "Test : ssh portable `"hostname`""
