# Clear log and start engine
'' | Out-File 'C:\Users\mb668\daw-project\engine.log' -Force

$proc = Start-Process -FilePath 'C:\Users\mb668\daw-project\engine\build-msvc\daw_engine.exe' `
    -ArgumentList '--server', 'ws://localhost:3000', '--project', 'default', '--play' `
    -RedirectStandardOutput 'C:\Users\mb668\daw-project\engine.log' `
    -RedirectStandardError 'C:\Users\mb668\daw-project\engine.err' `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Engine PID: $($proc.Id)"
Start-Sleep -Seconds 3
Write-Host "HasExited: $($proc.HasExited)"

Write-Host ''
Write-Host '=== ENGINE LOG ==='
Get-Content 'C:\Users\mb668\daw-project\engine.log' -ErrorAction SilentlyContinue
