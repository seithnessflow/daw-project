# Tunnel cloudflared vers le serveur DAW local (docs/deux-machines.md).
# Lancement = geste humain (verrou classifieur) ; ce script rend le geste
# trivial : ! powershell -File scripts/tunnel-daw.ps1
Start-Process 'C:\Program Files (x86)\cloudflared\cloudflared.exe' `
  -ArgumentList 'tunnel --url http://localhost:3000' `
  -WindowStyle Hidden `
  -RedirectStandardError 'C:\Users\mb668\daw-tunnel-daw.err'
Write-Host 'Tunnel lance en fond - Claude lit l URL dans C:\Users\mb668\daw-tunnel-daw.err'
