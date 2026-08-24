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
    [switch]$Mute
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
$engineArgs = "--server ws://localhost:3000 --project $PROJECT --play --start-stopped$muteArg " +
              "--assets ..\test-assets --vst3-module $AGAIN_UID=VST3\Release\again.vst3"
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
$url = "http://localhost:5173/?project=$PROJECT&starter=1#token=$token"

# ---- Open the browser (unless muted verification run) ----
if (-not $Mute) { Start-Process $url }

Write-Host ""
Write-Status "Ready. $url"
Write-Host "  Ecran de depart : charge un demo, ou pars vierge."
Write-Host "  Joue : Espace. Pose : glisse un WAV sur un couloir."
Write-Host "  Arret : scripts\daw.ps1 -Stop"
if ($Mute) { Write-Host "  (mute: no audio, no browser opened - verification mode)" -ForegroundColor Yellow }
