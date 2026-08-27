# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-27 nuit (cloture de la journee AUDIT-6 : rapport +
5 livraisons). Les proprietaires restent STATUS.md (etat), TODO.md
(file), JOURNAL.md (recit date).*

## L'ETAT EN UNE PHRASE

La journee « faut que ca devienne un DAW » : AUDIT-6 (parite vs
Ableton/Cubase, a RATIFIER) + CINQ livraisons verifiees — export
mixdown UI, pre-ecoute des samples, gardes d'onglet (version+projet),
BOUCLE UTILISATEUR (drag sur la regle), SCISSION de clip (clic droit /
Ctrl+E) — suite e2e 79/79, gtests 45/45, tsc 0, CI verte sur les deux
premiers pushes.

## NOUVEAU (nuit du 27, apres la reecriture ci-dessous) : LE MOTEUR
## SUIT L'ONGLET

Fini le moteur fige sur --project du boot : le bandeau de desaccord
offre « Jouer <projet> ici » (le moteur bascule, proto SwitchProject,
jamais d'auto-switch) — prouve sur la VRAIE stack (essai-claude joue,
puis moteur rendu a studio). + Le transport REFUSE le desaccord ;
snap de pose = grille du zoom ; + clip MIDI revele le piano-roll ;
composition-utilisateur complete (essai-claude : beat kit + basse
Dexed, export traces/essai-claude-mixdown.wav, ear verte). Moisson
restante au TODO 7 (pose avalee sur position occupee, kit de
demarrage). Verdict CI a verifier : af0bd8e (+ 95be372 compo).

## POINT DE SYNCHRO (A LIRE EN PREMIER)

**Verdict CI attendu sur 5776e24 (pistes typees + fixes des 2 rouges)**.
Les runs b813998 et 5bc6319 furent ROUGES, causes comprises et FIXEES
dans 5776e24 : (1) le commit boucle referencait splitClip livre au
commit suivant — un lot pousse doit compiler SEUL (lecon de decoupage,
JOURNAL) ; (2) tab-guards partageait un dossier entre deux seeds
(base.am illisible au 2e passage en CI) — spec hermetique desormais.
Deja verts : export+pre-ecoute (33070584737), gardes (33072113838).
Piege : un push docs-seuls ne produit AUCUN run (paths-ignore).

## CE QUE LA JOURNEE A LIVRE (2026-08-27, dans l'ordre)

1. **docs/AUDIT-6.md** — l'inventaire de ce qui manque face aux DAW
   usuels (~35 constats etiquetes DESIGNE/REFUSE/SOUS-PESE/NOUVEAU,
   arbitrage propose, quick wins). A RATIFIER ; l'utilisateur a dit
   « bosse la-dessus » — les livraisons ci-dessous en sortent.
2. **EXPORT MIXDOWN UI** (4789a2a) : bouton WAV↓ -> rendu offline sur
   thread OUVRIER moteur -> store -> telechargement. Refus visible.
3. **PRE-ECOUTE SAMPLES** (cd49674) : ▶ par chip, WebAudio, -3 dB.
4. **GARDES D'ONGLET** (bf2c8bb) : version du site (reload auto si la
   stack a ete relancee sous l'onglet) + projet (badge topbar, bandeau
   rouge si le moteur joue un AUTRE projet, export refuse). Resout
   l'incident « rien dans l'arrangement et pourtant l'export sonne ».
5. **BOUCLE UTILISATEUR** (b813998) : drag sur la bande cycle = poser
   la region (dblclick efface, Alt sans snap) ; moteur : fin de
   contenu SEPAREE des braces (boucle off ne coupe jamais), region
   par le command ring, survit aux rebuilds. CLEAN BUILD fait (layout
   AudioCommandMessage). Gtest etendu (wrap multi-tours 550->262).
6. **SCISSION** (5bc6319) : clic droit « Scinder ici » (entree absente
   si impossible) + Ctrl+E au marqueur ; groupe d'undo = UN Ctrl+Z
   recolle ; fades repartis ; refus MIDI (assetHash vide).
7. **PISTES TYPEES audio/MIDI** (5776e24) : le bouton + du COIN (menu
   Piste audio / Piste MIDI, « + add track » = meme menu), TrackDef.kind
   additif (legacy = mixte, rien ne casse), badges sur les tetes,
   gardes de gestes a refus VISIBLE (sample sur MIDI = flash rouge ;
   clip MIDI / instrument sur audio = absent/flash) ; instrument sur le
   vide => piste MIDI, effet => piste audio. Suite **80/80**.

## LA DECISION OUVERTE (inchangee)

LE GROS CHANTIER (E4 Massive / Effets 4.2-4.3 / Vague 3 MIDI) — lire
les PREALABLES d'AUDIT-6 avant de choisir (MIDI-in inexistant, CC64,
notes en liste vs map-a-ids, tempo, latence figee). Quick wins
restants (TODO 7) : GR meter du comp (avec 4.2), dr_flac/dr_mp3 a
l'import. AUDIT-5 et AUDIT-6 a ratifier formellement.

## A SURVEILLER (pieges payes du jour — ne pas re-payer)

- preventDefault au pointerdown SUPPRIME le dblclick derive — un drag
  ne demarre qu'au SEUIL de mouvement, jamais d'effet au down.
- MIDI = assetHash VIDE (jamais notes.length : un clip MIDI frais a
  notes vides). La regle vaut pour toute garde future.
- Une spec qui stocke son etat dans window meurt au premier reload
  incident — lire l'horloge DOM #position cote Node (idiome pose dans
  loop-region.spec).
- Un clic force a position FIXE peut sortir du clip aux petits zooms
  (le menu de PISTE s'ouvre a la place) — viser le centre par defaut.
- Messages de commit : JAMAIS de guillemets doubles dans le here-string
  PowerShell (git recoit un pathspec) ; -replace + Set-Content mojibake
  l'UTF-8 (guillemets francais) — Edit fichier, pas -replace.
- Le wrap de boucle est sample-exact A CHAQUE tour : 512 frames peuvent
  faire DEUX tours d'une petite region (l'arithmetique du gtest (d)).
- Toujours : jamais de log/temp dans web/ ; clean build si layout de
  struct moteur change ; e2e = serveur NON-secure + 47821 libre puis
  RESTAURER la stack secure ; zombies plugin_host avant rebuild.

## RELANCER / VERIFIER

- Stack : `start-daw.cmd` ; arret `stop-daw.cmd`. Tests :
  `daw_engine_test.exe` (45/45), `npm run test:e2e` (79), tsc 0.
- **La manip 5 minutes** : onglet studio ->
  1) TIRER sur la bande fine au-dessus de la regle : l'etrier cuivre
  se pose et PLAY boucle dessus ; double-clic dessus : la lecture
  continue au-dela. 2) Clic droit sur un clip -> « Scinder ici » ;
  Ctrl+Z recolle. 3) WAV↓ telecharge le mixdown ; ▶ d'un chip
  pre-ecoute ; le badge cuivre dit le projet de l'onglet.
  4) Le **+** du coin haut-gauche -> Piste audio / Piste MIDI (badges
  sur les tetes) ; armer un sample et cliquer le couloir d'une piste
  MIDI -> refus FLASH rouge ; le poser sur la piste audio -> il se pose.
