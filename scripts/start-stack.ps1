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

.PARAMETER Component
    "all"    - The whole stack (default)
    "server" - The sync server only. Works with -Stop and start, and stops
               any running daw-server even if this script did not start it.
               Used by the criterion-3 offline E2E test to stop/restart the
               server mid-test.

.EXAMPLE
    .\start-stack.ps1
    .\start-stack.ps1 -Mode file -Document fixtures/two-tracks.am
    .\start-stack.ps1 -Stop
    .\start-stack.ps1 -Stop -Component server
    .\start-stack.ps1 -Component server
#>
param(
    [ValidateSet("server", "file")]
    [string]$Mode = "server",

    [string]$Document = "fixtures\two-tracks.am",

    [ValidateSet("all", "server")]
    [string]$Component = "all",

    [switch]$Stop,

    [switch]$Wait
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
# GetTempPath works on Windows PowerShell 5.1 and on pwsh/Linux (CI)
$tempDir = [System.IO.Path]::GetTempPath()
$pidFile = Join-Path $tempDir "daw-stack-pids.json"
$isWindowsHost = ($env:OS -eq "Windows_NT")

function Write-Status($msg) {
    Write-Host "[DAW] $msg" -ForegroundColor Cyan
}

function Stop-Stack {
    if (Test-Path $pidFile) {
        $pids = Get-Content $pidFile | ConvertFrom-Json

        foreach ($name in @("web", "engine", "server")) {
            # NOT $pid: that is a read-only automatic variable in PowerShell
            $procId = $pids.$name
            if ($procId) {
                try {
                    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                    if ($proc) {
                        Write-Status "Stopping $name (PID $procId)"
                        Stop-Process -Id $procId -Force
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

function Get-ServerBinary {
    # Newest built daw-server binary (debug or release), or $null
    $candidates = @(
        (Join-Path $projectRoot "server/target/debug/daw-server.exe"),
        (Join-Path $projectRoot "server/target/release/daw-server.exe"),
        (Join-Path $projectRoot "server/target/debug/daw-server"),
        (Join-Path $projectRoot "server/target/release/daw-server")
    ) | Where-Object { Test-Path $_ }
    if (-not $candidates) { return $null }
    return ($candidates | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1)
}

function Remove-ServerPid {
    if (-not (Test-Path $pidFile)) { return }
    try {
        $pids = Get-Content $pidFile | ConvertFrom-Json
        $kept = @{}
        foreach ($prop in $pids.PSObject.Properties) {
            if ($prop.Name -ne "server") { $kept[$prop.Name] = $prop.Value }
        }
        $kept | ConvertTo-Json | Set-Content $pidFile
    } catch {}
}

function Stop-Server {
    # Stops ANY running daw-server (by process name), including one this
    # script did not start (dev server, CI-started server)
    $procs = Get-Process -Name "daw-server" -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($p in $procs) {
            Write-Status "Stopping server (PID $($p.Id))"
            Stop-Process -Id $p.Id -Force
        }
    } else {
        Write-Host "No running server found" -ForegroundColor Yellow
    }
    Remove-ServerPid
}

function Start-Server {
    Write-Status "Starting server..."

    $emptyStdin = Join-Path $tempDir "daw-empty-stdin"
    if (-not (Test-Path $emptyStdin)) {
        New-Item -ItemType File -Path $emptyStdin | Out-Null
    }
    # WorkingDirectory is ALWAYS server/: the file store is relative to the
    # CWD (./projects), so a stop/restart cycle must reuse the same one.
    $serverDir = Join-Path $projectRoot "server"

    $startArgs = @{
        PassThru               = $true
        WorkingDirectory       = $serverDir
        RedirectStandardOutput = (Join-Path $tempDir "daw-server.log")
        RedirectStandardError  = (Join-Path $tempDir "daw-server-err.log")
        # Detach stdin: without this the server inherits the caller's stdin
        # pipe and keeps wrapper processes (Node spawnSync, outer powershell)
        # blocked long after this script exits. Start-Process validates the
        # path, so the NUL device is not accepted: use an empty file.
        RedirectStandardInput  = $emptyStdin
    }
    if ($isWindowsHost) { $startArgs.WindowStyle = "Hidden" }

    $bin = Get-ServerBinary
    if ($bin) {
        $proc = Start-Process -FilePath $bin @startArgs
    } else {
        $proc = Start-Process -FilePath "cargo" -ArgumentList "run" @startArgs
    }

    # Record the PID (merge into the existing pid file if any)
    $pids = @{}
    if (Test-Path $pidFile) {
        try {
            $existing = Get-Content $pidFile | ConvertFrom-Json
            foreach ($prop in $existing.PSObject.Properties) { $pids[$prop.Name] = $prop.Value }
        } catch {}
    }
    $pids.server = $proc.Id
    $pids | ConvertTo-Json | Set-Content $pidFile

    # Condition-based readiness: wait until port 3000 accepts connections
    $deadline = (Get-Date).AddSeconds(20)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $client.Connect("127.0.0.1", 3000)
            $client.Close()
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $ready) {
        Write-Error "Server did not accept connections on 127.0.0.1:3000 within 20s"
    }
    Write-Status "Server ready on 127.0.0.1:3000 (PID $($proc.Id))"
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
    if ($Component -eq "server") {
        Stop-Server
    } else {
        Stop-Stack
    }
} else {
    if ($Component -eq "server") {
        Start-Server
    } else {
        Start-Stack
    }
}
