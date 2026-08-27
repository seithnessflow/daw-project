# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-27 soir (cloture session AUDIT-6 + quick wins).
Digest operationnel ; les proprietaires restent STATUS.md (etat),
TODO.md (file), JOURNAL.md (recit date).*

## L'ETAT EN UNE PHRASE

Le DAW exporte et s'ecoute : un morceau SORT enfin par l'UI (bouton
WAV↓ -> rendu offline moteur -> telechargement) et les samples se
PRE-ECOUTENT au navigateur (▶ par chip) — e2e 74/74, gtests 45/45,
tsc 0 ; et docs/AUDIT-6.md (parite vs Ableton/Cubase, ~35 constats)
attend sa RATIFICATION.

## POINT DE SYNCHRO (A LIRE EN PREMIER)

**Verdict CI attendu sur le push du 2026-08-27 soir** (3 commits :
4789a2a export mixdown, cd49674 pre-ecoute, + docs/cloture) : verifier
`gh run list` — code touche (moteur+web+proto), la CI DOIT tourner.
Piege connu : un push DOCS SEULS ne produit AUCUN run (paths-ignore
'**.md' — c'est ecrit dans ci.yml, pas un rouge).

## CE QUE LA SESSION A LIVRE (2026-08-27)

1. **docs/AUDIT-6.md** — audit de parite conceptuelle vs Ableton/
   Cubase (3 lectures paralleles exhaustives, ~35 constats etiquetes
   [DESIGNE]/[REFUSE]/[SOUS-PESE]/[NOUVEAU], arbitrage propose).
   Titre : rien n'entre (record/MIDI-in absents), rien ne sort
   (export UI absent — corrige le jour meme), temps musical inexistant.
   Consigne en TODO 7. A RATIFIER (l'arbitrage en fin de rapport).
2. **EXPORT MIXDOWN UI** (4789a2a) : bouton WAV↓ en topbar ->
   RenderRequest/RenderState (proto 13/14) -> render/export_job
   (thread OUVRIER, lecon C1 respectee) -> WAV au store local+serveur
   -> download `<projet>-mixdown.wav`. Refus visible modele BOX.
3. **PRE-ECOUTE SAMPLES** (cd49674) : ▶ par chip (ui/preview.ts,
   WebAudio, -3 dB, un seul a la fois, n'arme pas le chip, refus
   visible si store muet).
4. Preuves : e2e **74/74** (dont export-mixdown 2/2 moteur reel avec
   AGain rendu, sample-preview 2/2), gtests 45/45, tsc 0.

## LA DECISION OUVERTE (inchangee)

LE GROS CHANTIER. Candidats : P2P E4 Massive / Effets natifs 4.2-4.3 /
Vague 3 MIDI / AUDIT-5 + AUDIT-6 a ratifier. **Lire les PREALABLES de
l'arbitrage AUDIT-6 avant de choisir** (E4 : aucune entree MIDI nulle
part, pas de CC64/pedale dans le ring ; Vague 3 : notes en LISTE
contre le design map-a-ids, tempo a caser avant/dedans ; latence figee
512 sans ASIO). Quick wins restants en TODO 7 : boucle utilisateur
(CLEAN BUILD obligatoire — AudioCommandMessage change de layout),
GR meter (avec 4.2), dr_flac/dr_mp3 a l'import.

## A SURVEILLER (pieges payes — dont 2 re-payes aujourd'hui)

- **Jamais de log/fichier temp dans web/** (vite -> EBUSY) : re-frole
  aujourd'hui (log vite), retire en secondes. Les logs de fond vont au
  scratchpad de session.
- Rendu offline SANS mapping --vst3-module = refus BRUYANT (voulu) :
  tout spec/outil qui rend doit passer les mappings (modele ear).
- Le store adresse contenu est PARTAGE entre tests : « asset absent »
  se simule par interception 404, jamais par absence reelle.
- Layout d'une struct moteur partagee change => CLEAN BUILD (ninja
  clean) ; crash 0xC0000005 avec gtests verts = soupconner l'ABI.
- Zombies plugin_host avant rebuild ; suite e2e = serveur NON-secure +
  port 47821 libre (stack utilisateur = SECURE, basculer/RESTAURER) ;
  endUndoGroup sans imbrication ; quantum session = loop_len de
  l'ancre ; le seed s'affiche avant la sync (sondes : attendre).
- Fichiers de sonde non suivis a la racine web/ (fp.mjs, t3.mjs,
  t3.png, t7.mjs) + traces/box-3-open.png modifie : PAS a moi, laisses
  tels quels — menage a arbitrer.

## RELANCER / VERIFIER

- Stack : `start-daw.cmd` (ou `scripts\daw.ps1 -Secure`) ; arret
  `stop-daw.cmd`. Moteur : `engine\rebuild_msvc.bat` (zombies
  d'abord). Tests : `daw_engine_test.exe` (45/45) ; `cd web ; npm run
  test:e2e` (74) ; `npx tsc --noEmit`.
- **La manip 5 minutes** : stack lancee -> onglet studio ->
  1) bouton **WAV↓** (topbar, a droite de JAM) : le mixdown se rend et
  se TELECHARGE (studio-mixdown.wav — l'ecouter dans le lecteur) ;
  2) rail gauche onglet **Samples** : le **▶** d'un chip JOUE le
  sample (re-clic = stop), sans l'armer ;
  3) moteur coupe -> le clic WAV↓ FLASHE rouge et dit pourquoi.
