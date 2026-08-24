<#
.SYNOPSIS
    Session 3 - LA PREUVE DE L'INVARIANT sur de vrais plugins (quatuor).

.DESCRIPTION
    Quatre rendus offline du projet donne :
      1a/1b AVEC les vrais modules  -> determinisme du rendu reel ;
      2     SANS aucun module      -> le pair-simule joue les STEMS
                                      (ligne de verite exigee) ;
      3     chemin BIDON           -> echec BRUYANT exige (R5).
    Verdict VERT ssi hash(1a)==hash(1b)==hash(2), la ligne
    « playing STEM » est presente en 2, et 3 echoue.
    La cle de stem reste une CLE DE CACHE (ADR-019) : le determinisme
    n'est PAS exige par design - ce script le MESURE ; l'egalite 2==1
    est l'invariant (le pair joue la verite publiee), pas une promesse
    de re-rendu bit-exact.

.EXAMPLE
    scripts\invariant-proof.ps1 -Project inv-proof `
      -Modules @('565354734D617376616C68616C6C6173=C:\Program Files\Common Files\VST3\ValhallaSupermassive.vst3',
                 'ABCDEF019182FAEB4175446152523330=C:\Program Files\Common Files\VST3\RoughRider3.vst3')
#>
param(
    [string]$Project = "inv-proof",
    [string[]]$Modules = @(
        '565354734D617376616C68616C6C6173=C:\Program Files\Common Files\VST3\ValhallaSupermassive.vst3',
        'ABCDEF019182FAEB4175446152523330=C:\Program Files\Common Files\VST3\RoughRider3.vst3')
)

# PS 5.1 : JAMAIS Stop ici - le stderr natif de npm/node (bavardage
# normal de l'ear) deviendrait une exception via la redirection 2>&1
$ErrorActionPreference = "Continue"
$web = Join-Path (Split-Path -Parent $PSScriptRoot) "web"
Push-Location $web

function EarRun([string]$Out, [string[]]$Mods) {
    # $args est RESERVE dans une fonction PowerShell - jamais l'ecraser
    $npmArgs = @('run', 'ear', '--', '--project', $Project, '--out', $Out)
    foreach ($m in $Mods) { $npmArgs += '--vst3'; $npmArgs += $m }
    return (& npm @npmArgs 2>&1 | Out-String)
}

$fail = @()
$o1 = EarRun 'proof-avec1' $Modules
$o2 = EarRun 'proof-avec2' $Modules
$o3 = EarRun 'proof-stems' @()
if ($o1 -notmatch 'EAR: green') { $fail += "1a AVEC pas vert" }
if ($o2 -notmatch 'EAR: green') { $fail += "1b AVEC pas vert" }
if ($o3 -notmatch 'EAR: green') { $fail += "2 SANS pas vert" }
if ($o3 -notmatch 'playing STEM') { $fail += "2 SANS : la ligne de verite 'playing STEM' manque" }

$bogus = @("$($Modules[0].Split('=')[0])=C:\bidon\nexiste.vst3") + ($Modules | Select-Object -Skip 1)
$o4 = EarRun 'proof-bidon' $bogus
if ($o4 -match 'EAR: green') { $fail += "3 BIDON est passe VERT (faux vert interdit)" }

$h1 = (Get-FileHash ear\proof-avec1.wav).Hash
$h2 = (Get-FileHash ear\proof-avec2.wav).Hash
$h3 = (Get-FileHash ear\proof-stems.wav).Hash
if ($h1 -ne $h2) { $fail += "rendu reel NON deterministe ici (info, voir doc) : $($h1.Substring(0,12)) vs $($h2.Substring(0,12))" }
if ($h3 -ne $h1) { $fail += "LE PAIR N'ENTEND PAS LA VERITE PUBLIEE : stems $($h3.Substring(0,12)) vs reel $($h1.Substring(0,12))" }

Pop-Location
Write-Host ""
if ($fail.Count -eq 0) {
    Write-Host "INVARIANT PROUVE ($Project) : reel deterministe, pair-sans-plugin = memes octets ($($h1.Substring(0,16))), bidon refuse." -ForegroundColor Green
    exit 0
}
Write-Host "PREUVE ROUGE ($Project) :" -ForegroundColor Red
foreach ($f in $fail) { Write-Host "  - $f" -ForegroundColor Red }
exit 1
