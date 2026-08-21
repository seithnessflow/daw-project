<#
.SYNOPSIS
    Start the DAW stack (server, engine, web) for development and testing.

.DESCRIPTION
    Launches all three components in background jobs and provides a way to stop them cleanly.
    Used by Playwright tests and for manual testing.

.PARAMETER Mode
    "server" - Engine connects to sync server (default)
    "file"   - Engine loads from file (standalone mode)

.PARAMETER Document
    Document path for file mode (default: fixtures/two-tracks.am)

.EXAMPLE
    .\start-stack.ps1
    .\start-stack.ps1 -Mode file -Document fixtures/two-tracks.am
    .\start-stack.ps1 -Stop
#>
param(
    [ValidateSet("server", "file")]
    [string]$Mode = "server",

    [string]$Document = "fixtures\two-tracks.am",

    [switch]$Stop,

    [switch]$Wait
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $env:TEMP "daw-stack-pids.json"

function Write-Status($msg) {
    Write-Host "[DAW] $msg" -ForegroundColor Cyan
}

function Stop-Stack {
    if (Test-Path $pidFile) {
        $pids = Get-Content $pidFile | ConvertFrom-Json

        foreach ($name in @("web", "engine", "server")) {
            $pid = $pids.$name
            if ($pid) {
                try {
                    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                    if ($proc) {
                        Write-Status "Stopping $name (PID $pid)"
                        Stop-Process -Id $pid -Force
                    }
                } catch {
                    # Process already gone
                }
            }
        }

        Remove-Item $pidFile -Force
        Write-Status "Stack stopped"
    } else {
        Write-Host "No running stack found" -ForegroundColor Yellow
    }
}

function Start-Stack {
    # Ensure previous stack is stopped
    Stop-Stack 2>$null

    $pids = @{}

    # 1. Start Server (Rust)
    Write-Status "Starting server..."
    $serverDir = Join-Path $projectRoot "server"
    $serverProc = Start-Process -FilePath "cargo" -ArgumentList "run" `
        -WorkingDirectory $serverDir `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $env:TEMP "daw-server.log") `
        -RedirectStandardError (Join-Path $env:TEMP "daw-server-err.log")
    $pids.server = $serverProc.Id
    Write-Status "Server started (PID $($serverProc.Id))"

    # Wait for server to be ready
    Start-Sleep -Seconds 2

    # 2. Start Engine (C++)
    Write-Status "Starting engine..."
    $engineDir = Join-Path $projectRoot "engine\build-msvc"
    $engineExe = Join-Path $engineDir "daw_engine.exe"

    if ($Mode -eq "server") {
        $engineArgs = "--server ws://localhost:3000 --play --ws-port 47821"
    } else {
        $docPath = Join-Path $projectRoot $Document
        $assetsDir = Split-Path $docPath -Parent
        $engineArgs = "--doc `"$docPath`" --assets `"$assetsDir`" --play --ws-port 47821"
    }

    $engineProc = Start-Process -FilePath $engineExe -ArgumentList $engineArgs `
        -WorkingDirectory $engineDir `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $env:TEMP "daw-engine.log") `
        -RedirectStandardError (Join-Path $env:TEMP "daw-engine-err.log")
    $pids.engine = $engineProc.Id
    Write-Status "Engine started (PID $($engineProc.Id))"

    # Wait for engine to initialize
    Start-Sleep -Seconds 1

    # 3. Start Web (Vite)
    Write-Status "Starting web..."
    $webDir = Join-Path $projectRoot "web"
    $webProc = Start-Process -FilePath "npm" -ArgumentList "run", "dev" `
        -WorkingDirectory $webDir `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $env:TEMP "daw-web.log") `
        -RedirectStandardError (Join-Path $env:TEMP "daw-web-err.log")
    $pids.web = $webProc.Id
    Write-Status "Web started (PID $($webProc.Id))"

    # Save PIDs
    $pids | ConvertTo-Json | Set-Content $pidFile

    # Wait for web to be ready
    Start-Sleep -Seconds 3

    Write-Host ""
    Write-Status "Stack running:"
    Write-Host "  Server: http://localhost:3000 (PID $($pids.server))"
    Write-Host "  Engine: ws://localhost:47821 (PID $($pids.engine))"
    Write-Host "  Web:    http://localhost:5173 (PID $($pids.web))"
    Write-Host ""
    Write-Host "Logs in: $env:TEMP\daw-*.log"
    Write-Host "Stop with: .\start-stack.ps1 -Stop"

    if ($Wait) {
        Write-Host ""
        Write-Host "Press Ctrl+C to stop..." -ForegroundColor Yellow
        try {
            while ($true) {
                Start-Sleep -Seconds 1
                # Check if processes are still running
                $alive = $true
                foreach ($name in @("server", "engine", "web")) {
                    $proc = Get-Process -Id $pids.$name -ErrorAction SilentlyContinue
                    if (-not $proc) {
                        Write-Host "$name exited unexpectedly" -ForegroundColor Red
                        $alive = $false
                    }
                }
                if (-not $alive) {
                    break
                }
            }
        } finally {
            Stop-Stack
        }
    }
}

# Main
if ($Stop) {
    Stop-Stack
} else {
    Start-Stack
}
