# CRITERE 5 SOUS CHARGE, en une commande (ne du spike latence 2026-08-27).
# Matrice d'underruns : buffers demandes 512/256/128, VRAI WASAPI, doc
# test_10min (la procedure critere 5), charge CPU 28 threads pendant la
# fenetre de mesure. La ligne `audio-negotiation:` du moteur donne la
# periode/le mode reellement obtenus. Astuce studio : -DeviceName
# "ZenGo SC USB Audio Driver Playback 3/4" = le vrai driver, inaudible
# (paire non cablee). Sortie : spike-results.json dans -OutDir.
param(
  [string]$DeviceName = "",
  [string]$OutDir = "$env:TEMP\daw-perf",
  [int]$Seconds = 30,
  [switch]$Exclusive   # WASAPI exclusif (le readback share= fait foi)
)

$root = Split-Path -Parent $PSScriptRoot
$eng = "$root\engine\build-msvc\daw_engine.exe"
$doc = "$root\engine\test-assets\test_10min.am"
$assets = "$root\engine\test-assets"
$out = $OutDir
New-Item -ItemType Directory -Force $out | Out-Null

function Start-Burner {
  $procs = @()
  for ($i = 0; $i -lt 28; $i++) {
    $procs += Start-Process powershell -ArgumentList '-NoProfile','-Command','while($true){[math]::Sqrt(12345.678)}' -WindowStyle Hidden -PassThru
  }
  return $procs
}

$results = @()
foreach ($buf in 512, 256, 128) {
  $log = "$out\spike-$buf.log"
  Remove-Item $log -Force -ErrorAction SilentlyContinue
  $args = @('--doc', $doc, '--assets', $assets, '--play', '--keepalive',
            '--ws-port', '47831', '--buffer-size', "$buf")
  if ($DeviceName -ne "") { $args += @('--device', ('"' + $DeviceName + '"')) }
  if ($Exclusive) { $args += @('--exclusive') }
  $p = Start-Process -FilePath $eng -ArgumentList $args `
        -RedirectStandardOutput $log -RedirectStandardError "$out\spike-$buf-err.log" `
        -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 6   # warmup sans charge
  $burners = Start-Burner
  Start-Sleep -Seconds $Seconds  # LA fenetre de mesure sous charge
  $burners | Stop-Process -Force -Confirm:$false
  Start-Sleep -Seconds 2
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  $nego = (Select-String -Path "$out\spike-$buf-err.log" -Pattern 'audio-negotiation' | Select-Object -Last 1).Line
  $under = (Select-String -Path $log -Pattern 'Underruns: (\d+)' -AllMatches |
            ForEach-Object { $_.Matches } | ForEach-Object { [int]$_.Groups[1].Value } |
            Measure-Object -Maximum).Maximum
  $results += [pscustomobject]@{ buf = $buf; nego = $nego; underruns = $under }
  "buf=$buf underruns=$under"
  "  $nego"
}
$results | ConvertTo-Json | Out-File -Encoding utf8 "$out\spike-results.json"
"FIN de la matrice"
