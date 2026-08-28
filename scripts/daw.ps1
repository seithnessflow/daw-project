<#
.SYNOPSIS
    Magic Potion - one command to a playable, testable product.

.DESCRIPTION
    Brings up the whole stack (server + engine + web), hands the engine
    token to the browser automatically, and opens the tab on a clean
    project 'studio' - no terminals to juggle, no token to copy. The tab
    lands on a starter screen: load a demo groove, or start empty.

    The engine plays AUDIBLE by default (you want to hear it). Use -Mute
    for automated verification (no sound). -Stop tears everything down.

.EXAMPLE
    scripts\daw.ps1
    scripts\daw.ps1 -Mute        # verification: stack up, no audio
    scripts\daw.ps1 -Stop
#>
param(
    [switch]$Stop,
    [switch]$Mute,
    # AUDIT-5 F1: -Secure generates a shared token, requires it on the server
    # (DAW_SERVER_TOKEN, inherited by server + engine) and puts it in the URL
    # fragment (#stoken, never sent to the network). USE IT before exposing
    # the server by a tunnel - it closes the no-auth hole. Without it (local
    # dev default) there is no auth, behaviour unchanged.
    [switch]$Secure,
    # Vague 3 (2026-08-28) : port MIDI d'entree a ouvrir (sous-chaine du nom,
    # ex. -MidiIn "Minilab3 MIDI" ; liste : daw_engine --list-midi-devices).
    # Le moteur route le clavier vers la premiere piste qui a un instrument
    # (ou -MidiTrack <id>). Partage 512 : jamais l'exclusif par defaut (il
    # prend la carte et coupe le reste - Twitch compris).
    [string]$MidiIn = "",
    [string]$MidiTrack = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$tempDir = [System.IO.Path]::GetTempPath()
$pidFile = Join-Path $tempDir "daw-stack-pids.json"
$tokenFile = Join-Path $tempDir "daw-engine-token-47821"
$startStack = Join-Path $PSScriptRoot "start-stack.ps1"
$PROJECT = "studio"
$AGAIN_UID = "84E8DE5F92554F5396FAE4133C935A18"

function Write-Status($m) { Write-Host "[Magic Potion] $m" -ForegroundColor Magenta }

# ---- Stop: delegate to the proven teardown ----
if ($Stop) {
    & $startStack -Stop
    exit 0
}

# ---- Preconditions ----
$engineExe = Join-Path $projectRoot "engine\build-msvc\daw_engine.exe"
if (-not (Test-Path $engineExe)) {
    Write-Error "Engine not built. Run: cd engine\build-msvc; ..\rebuild_msvc.bat"
}

# Fresh token: the browser must get THIS run's token
Remove-Item $tokenFile -ErrorAction SilentlyContinue
& $startStack -Stop 2>$null | Out-Null   # clean slate

# ---- F1: shared server token, set in THIS shell's env BEFORE the server
# and engine start (both are children, so they inherit DAW_SERVER_TOKEN) ----
$serverToken = $null
if ($Secure) {
    # Token STABLE pour un BOOKMARK PERMANENT : ordre env > fichier persistant
    # > nouveau (ecrit dans le fichier). Le meme token a chaque lancement ->
    # l'URL bookmarkee (#stoken=...) ne casse jamais. Un pre-set env >=16 gagne
    # (pour partager le meme token avec une autre machine).
    $tokenPin = Join-Path $HOME '.daw-server-token'
    if ($env:DAW_SERVER_TOKEN -and $env:DAW_SERVER_TOKEN.Length -ge 16) {
        $serverToken = $env:DAW_SERVER_TOKEN
    } elseif ((Test-Path $tokenPin) -and ((Get-Content $tokenPin -Raw).Trim().Length -ge 16)) {
        $serverToken = (Get-Content $tokenPin -Raw).Trim()
        $env:DAW_SERVER_TOKEN = $serverToken
    } else {
        $tb = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tb)
        $serverToken = -join ($tb | ForEach-Object { $_.ToString('x2') })
        [System.IO.File]::WriteAllText($tokenPin, $serverToken)  # persiste, sans BOM
        $env:DAW_SERVER_TOKEN = $serverToken
    }
    Write-Status "Secure mode: auth ON (token epingle: $tokenPin)."
} else {
    Remove-Item Env:\DAW_SERVER_TOKEN -ErrorAction SilentlyContinue
}

# ---- Server (reuse start-stack's server bring-up: builds/binds/waits) ----
& $startStack -Component server

# ---- Ensure the kit assets are in the store so the demo can sound ----
Write-Status "Ensuring demo assets in the store..."
Push-Location (Join-Path $projectRoot "web")
try { node scripts\make-kit.mjs *> $null } catch { Write-Host "  (kit seed skipped: $_)" -ForegroundColor Yellow }
Pop-Location

# ---- Engine: server mode, project studio, AGain mapped, audible unless -Mute ----
Write-Status "Starting engine (project '$PROJECT')..."
$engineDir = Join-Path $projectRoot "engine\build-msvc"
$muteArg = if ($Mute) { " --mute" } else { "" }
# L1c: --start-stopped = le moteur ne SONNE que sur commande (bouton/Espace)
# 2.5-decouverte : le dossier VST3 standard est scanne (cache a cote du
# binaire) - le menu + device propose tous les plugins de la machine
# 2026-08-26 : --editors RETIRE - il ouvrait TOUTES les fenetres de plugin au
# spawn (verrue v1), en desaccord avec le bouton BOX (etat web « ferme »").
# Les fenetres s'ouvrent A LA DEMANDE (BOX / clic droit), ring v9.
$midiArg = if ($MidiIn -ne "") { " --midi-in `"$MidiIn`"" } else { "" }
if ($MidiTrack -ne "") { $midiArg += " --midi-track `"$MidiTrack`"" }
$engineArgs = "--server ws://localhost:3000 --project $PROJECT --play --start-stopped$muteArg$midiArg " +
              "--assets ..\test-assets --vst3-module $AGAIN_UID=VST3\again.vst3 " +
              "--vst3-dir `"C:\Program Files\Common Files\VST3`""
if ($MidiIn -ne "") { Write-Status "MIDI in: '$MidiIn' -> premiere piste avec instrument$(if ($MidiTrack -ne '') { " (ou piste '$MidiTrack')" })" }
$engineProc = Start-Process -FilePath $engineExe -ArgumentList $engineArgs `
    -WorkingDirectory $engineDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $tempDir "daw-engine.log") `
    -RedirectStandardError (Join-Path $tempDir "daw-engine-err.log")

# Merge engine pid into the stack pidFile (so -Stop kills it too)
$pids = @{}
if (Test-Path $pidFile) { try { (Get-Content $pidFile | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $pids[$_.Name] = $_.Value } } catch {} }
$pids.engine = $engineProc.Id
$pids | ConvertTo-Json | Set-Content $pidFile

# ---- Web (vite). cmd /c runs npm.cmd reliably and keeps vite alive
# (a bare Start-Process "npm" on Windows can drop the long-lived child).
Write-Status "Starting web..."
$webProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory (Join-Path $projectRoot "web") -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $tempDir "daw-web.log") `
    -RedirectStandardError (Join-Path $tempDir "daw-web-err.log")
$pids.web = $webProc.Id
$pids | ConvertTo-Json | Set-Content $pidFile

# ---- Wait for the engine token (written after its ws opens) ----
Write-Status "Waiting for engine token..."
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and -not (Test-Path $tokenFile)) { Start-Sleep -Milliseconds 300 }
if (-not (Test-Path $tokenFile)) { Write-Error "Engine token never appeared (see daw-engine-err.log)" }
$token = (Get-Content $tokenFile -Raw | ConvertFrom-Json).token

# ---- Wait for vite. Poll over HTTP on `localhost` (resolves to IPv4 OR
# IPv6): vite binds [::1] only, so a raw IPv4 TcpClient gives a false
# negative even though the browser reaches it fine. ----
$deadline = (Get-Date).AddSeconds(40)
$webReady = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest "http://localhost:5173" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $webReady = $true; break
    } catch { Start-Sleep -Milliseconds 400 }
}
if (-not $webReady) { Write-Error "Web (vite) did not come up on 5173" }

# 1pre: token in the FRAGMENT (never sent to any server, absent from
# logs/history/Referer). The page reads #token first, then falls back to
# the local /api/engine-token endpoint (zero-paste path).
# F1: the server token rides the fragment (#stoken) alongside the engine
# token - neither ever leaves the browser. The web reads #stoken (context.ts).
# Menu principal (2026-08-26) : URL STABLE a la racine (pas de ?project=) ->
# l'ecran de selection des projets. Seul le stoken EPINGLE ride le fragment
# (le token moteur s'auto-recupere via /api/engine-token) : la meme URL a
# chaque lancement, bookmarkable. Ouvrir un projet depuis le menu preserve le
# fragment. (Le moteur reste demarre sur '$PROJECT' pour l'audio.)
$url = "http://localhost:5173/"
if ($serverToken) { $url += "#stoken=$serverToken" }

# ---- Open the browser (unless muted verification run) ----
if (-not $Mute) { Start-Process $url }

Write-Host ""
Write-Status "Ready. $url"
Write-Host "  Ecran de depart : charge un demo, ou pars vierge."
Write-Host "  Joue : Espace. Pose : glisse un WAV sur un couloir."
Write-Host "  Arret : scripts\daw.ps1 -Stop"
if ($serverToken) {
    Write-Host ""
    Write-Status "SECURE (auth ON). Server token (share only via a #fragment):"
    Write-Host "  $serverToken" -ForegroundColor Yellow
    Write-Host "  Deux machines (teste ton plugin, cf docs/deux-machines.md) :"
    Write-Host "   1. pose ton plugin ici (menu + device), il publie son stem ;"
    Write-Host "   2. scripts\tunnel-daw.ps1  -> URL publique du serveur ;"
    Write-Host "   3. sur l'AUTRE PC : ouvre son web avec"
    Write-Host "        ?server=<tunnel-host>#stoken=$serverToken"
    Write-Host "      et lance son moteur avec"
    Write-Host "        DAW_SERVER_TOKEN=$serverToken  --server wss://<tunnel-host>"
    Write-Host "      -> il entend le stem sans avoir le plugin."
}
if ($Mute) { Write-Host "  (mute: no audio, no browser opened - verification mode)" -ForegroundColor Yellow }
