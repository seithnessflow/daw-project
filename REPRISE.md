# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-25 (nuit). VOLATILE : etat dans STATUS.md, file dans
TODO.md, recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

Les iterations autonomes ont solde, dans l'ordre grave :
- (1) crash 0xe06d7363, (2) gtests locaux, (3-locale) invariant prouve
  sur vrais plugins (quatuor, PDC, fraicheur), et LES TROIS SESSIONS
  D'EFFETS NATIFS :
  4.1 Utility (exact au bit), 4.2 EQ3+Comp (reponse 3 freqs, 4:1
  numerique), 4.3 Drive (oversampling 4x, alias -80 dB vs -15 naif,
  PREMIER NATIF A LATENCE : getLatencySamples=16, stems declarent
  plugins+natifs) + Delay (echo exact a l'echantillon).
  LE NOYAU NATIF DU BRIEF EST COMPLET (5 devices, unites vraies,
  preuves gtest 34/34, e2e 36/36).
- DEUX BUGS DE FOND en moisson : int/f64 Automerge (un nombre ENTIER
  du web etait lu 0.0 par le moteur - params, masterGain, track.gain)
  et la fixture multi-OS de la CI (+ sentinelle reparee : le watch
  seul, son exit code EST le verdict).
- CI verte jusqu'a 8ebe73d ; b4dc522 (4.3) EN SENTINELLE = premier
  point de synchro si absent.

## La manip (2 min)

Onglet ma-piece -> piste -> + device : CINQ natifs (utility, eq 3
bandes, compresseur, drive, delay) + le catalogue 72 effets. Tout en
unites vraies, tout convergent, tout s'entend.

## RESTE (ordre grave)

3-fin. JAMBE DEUX MACHINES : le portable DOIT pull + rebuild (fix
   crash + ring v7) puis jambe SANS du quatuor chez lui + fraicheur
   observee. BLOQUE sur un geste laptop.
5. Vague 3 (MIDI + instruments -> test ultime Massive).
6. AUDIT-5 harmonisation (consigne).
Reserves 4.x : sonde de latence vst3 reelle (soothe2 pend),
harm-13 documente dans le test drive, pan constant-power de PISTE
(TODO 3c) distinct du pan balance d'Utility.

## A surveiller

- Crash-*.log / <segment>.log = moisson permanente (handler
  auto-symbolisant, PDB en place).
- Piege scripts : backslashes manges par JS (\a) - slashes avant.
- Arbitrages interpretes a infirmer si faux : « OK » = oui au badge
  fraicheur (b).
