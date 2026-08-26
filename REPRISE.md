# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-27 a la demande utilisateur (« consigne tout »).
Digest COMPLET des deux journees 26-27/08. Les proprietaires restent
STATUS.md (etat), TODO.md (file), JOURNAL.md (recit date) — ce fichier
est le resume operationnel qu'on lit au demarrage.*

## L'ETAT EN UNE PHRASE

Le DAW est JOUABLE : pistes/clips/devices/scenes renommables et
deplacables au drag partout, enveloppes d'automation dessinables a la
souris ET jouees par le moteur, fenetres de plugins a la demande devant
Chrome, Session avec launch quantise et verite moteur, preuve audio
mesurable etage par etage — suite e2e 70/70, moteur 45/45, CI verte
sur tout (6 pushes le 27, le seul rouge corrige dans la foulee).

## CE QUI A ETE LIVRE (26-27/08, dans l'ordre)

1. **Renommage partout** : piste / clip / scene au clic droit -> input
   inline (Entree valide, Echap annule), undo complet. Les clips ont un
   nom humain (ClipDef.name additif ; un clip MIDI affiche « MIDI »).
2. **Session F5+** : STOP ALL ; stop filtre par scene ; launch QUANTISE
   (l'ancre pose epoque+quantum = son loop_len, les suivants partent a
   la frontiere, promotion au sample par le thread audio) ; VERITE
   moteur des slots (SessionState en telemetrie 30 Hz, badge « queued »
   pointille) ; scenes renommables/dupliquables/supprimables avec undo.
3. **FIX SYNC MAJEUR** : Project.getLastChange etait un scalaire — deux
   mutations avant un envoi = la premiere PERDUE pour les pairs.
   Desormais une FILE drainee par sendLastChange. Classe fermee.
4. **BOX (fenetres de plugin)** : TOPMOST tant qu'ouvertes (devant
   Chrome garanti, modele Ableton) ; la croix (X) resynchronise l'etat ;
   --editors retire de daw.ps1 (tout est a la demande) ; etat memorise
   hors DOM ; et REFUS VISIBLE : moteur deconnecte = flash rouge +
   pastille engine qui clignote + tooltip (fin des clics dans le vide —
   QUATRE retours utilisateur avaient cette unique cause : un onglet
   non reconnecte apres un redemarrage moteur).
5. **RACK EN BAS facon Ableton** : panneau device pleine largeur sous
   l'etabli (.panel-device, frere de .workspace), splitter horizontal
   (hauteur persistee), onglets Rack/Piano-roll, piano-roll pleine
   largeur. Menu « + device » en position FIXED (il etait tronque par
   le panneau et scrollait le rack hors champ).
6. **DRAG & DROP COMPLET (DND-DESIGN D1-D4)** :
   - D1 pistes reordonnables (drag de la tete ; TrackDef.order
     fractionnaire ADDITIF — l'identite CRDT survit, orderedTracks =
     source unique du tri, convergence 2 onglets testee) ;
   - D2 devices reordonnables (drag horizontal du rack ; moveProcessor
     remove+insert meme def, compromis CRDT documente) ;
   - D3 navigateur -> pistes (instruments/effets sur une piste, sur le
     vide = nouvelle piste, samples poses a la position du drop) ;
   - D4 clips ENTRE pistes (drag bi-dimensionnel : X = chemin
     historique intact, Y vise l'autre lane ; moveClipToTrack delete+
     recreate meme id, tous champs conserves) + slots Session
     deplacables entre cellules.
7. **GESTES ABLETON** : drop d'un plugin DANS le rack a la position
   visee de la chaine ; clic droit sur un item du navigateur (ajouter /
   nouvelle piste) ; double-clic sur la barre d'un device = sa fenetre.
8. **AUTOMATION A1+A2+A3 (complet jusqu'a l'UI)** :
   - A1 document : AutomationLaneDef additif (piste + master), 6
     mutateurs journalises, automationValueAt pur ;
   - A2 moteur : gain/pan/master evalues par sous-bloc (lane enabled >
     manuel ; gain v*2, pan v*2-1), evaluateur C++ MIROIR EXACT du TS,
     preuves au bit en gtest, e2e moteur reel (la lane pilote les VU) ;
   - A3 UI : bouton **A** par piste -> lane sous la piste, courbe SVG
     clampee, double-clic pose, drag deplace, clic droit supprime/
     bypass, ON/off. DESSINER UN FONDU S'ENTEND.
   Restent A4 (params de device VST3 + cle de stem) et A5 (courbes).
9. **AUDIO DE STUDIO REPARE** (« j'ai pas l'audio comme il faut ») :
   cause = 4 faders a gain=0 dans le document (Track 2/snare/bass/
   chord muettes) -> remontes a 0 dB ; le mix cretait alors a
   -0.76 dBFS -> master a -2 dB ; porte ear VERTE (-2.56 dBFS, T8V
   protegees). Garde B5 muette sur les hash vides (clips MIDI).
10. **PREUVE AUDIO PAR ETAGE** (idee utilisateur) : peak/rms/hash
    FNV-1a du flux float ENTRE chaque maillon (clips -> gain -> chaque
    plugin -> pan -> master), offline only (zero cout live).
    `npm run ear -- --project studio --probe` imprime la table ; un
    hash qui change DIT quel maillon a change l'audio. gtest 45/45
    (deterministe, -6.02 dB exact au gain, pan neutre au bit).
11. **Methode agents paralleles RODEE** : partition stricte des
    fichiers, agents interdits de stack/commit, integration+
    verification en serie — D1/D2/D3/D4/A1 livres ainsi, tsc 0 a
    chaque fois.

## POINT DE SYNCHRO (A LIRE EN PREMIER)

**CI VERTE VERIFIEE** sur 002a4b5, 232beb7, fca5b6b, edddf27, 385facf,
et d91ae9c attendu vert (docs seuls). Seul 92dd535 fut rouge (le
refus-visible BOX cassait 2 specs qui testaient l'envoi sans moteur —
modif de test signalee, corrigee et verte dans 385facf). Ce commit-ci
(REPRISE) part en dernier — verdict attendu vert, a verifier au
prochain demarrage (gh run list).

## LA DECISION OUVERTE : LE GROS CHANTIER

L'utilisateur a dit « fini les chantiers entames et on commencera un
gros chantier » — les entames sont SOLDES. Candidats prets :
- **P2P E4 — le test Massive** (docs/P2P-ENGINES-DESIGN.md, RECOMMANDE) :
  clavier du portable -> Massive sur la tour en p2p. 2-3 sessions,
  DEUX MACHINES requises (le portable doit d'abord pull + rebuild :
  proto session/automation ont bouge).
- **Effets natifs 4.2/4.3** : EQ 3 bandes + compresseur, puis
  Drive/Delay (aucun prerequis materiel).
- **Vague 3 MIDI + instruments** (l'axe produit complet).
- **AUDIT-5 a ratifier** (docs/AUDIT-5.md, ~40 trouvailles, quick wins).
Tranches minces en marge : A4/A5 automation ; preuve par etage DANS
l'UI (hash a cote des VU du rack) ; verite BOX en telemetrie.

## A SURVEILLER (pieges payes, ne pas re-payer)

- **Layout d'une struct moteur partagee change => CLEAN BUILD**
  (ninja clean) : l'incremental a produit un moteur live mourant en 5 s
  (0xC0000005) avec des gtests verts. Symptome = crash inexplicable aux
  chemins vides -> soupconner l'ABI avant le code. Le clean emporte
  create_test_doc.exe (ninja create_test_doc sous vcvars le remet).
- **Aucun fichier temp/log de test dans web/** (vite -> EBUSY).
- **Zombies plugin_host** : Stop-Process -Force ; le recalcitrant
  (HasExited=True mais liste) tombe via wmic call terminate.
- **Suite e2e** = serveur NON-secure + port 47821 libre ; la stack
  utilisateur est SECURE (token epingle) -> basculer puis RESTAURER.
- **Specs a gestes** : DESARMER le kit apres une pose (sinon le
  mouse.up pose un clip fantome) ; viser le CENTRE des poignees (un
  kick fait ~10 px) ; scrollIntoViewIfNeeded avant boundingBox (le
  rack scrolle) ; specs moteur-spawne : purger le token file du port
  AVANT spawn + attendre « WebSocket server listening » avant la page.
- **endUndoGroup ne compte pas les imbrications** (un end interne clot
  le groupe) — contrainte notee dans moveClipToTrack/slot_reorder.
- Le quantum de session = loop_len de l'ANCRE (pas de tempo au schema).
- Fenetres BOX = TOPMOST au-dessus de TOUT (choix v1, a affiner si le
  multi-apps gene). Apres fermeture par la croix, l'UI croit « ouvert »
  jusqu'au clic suivant (verite en telemetrie = dette notee).
- Le seed s'affiche AVANT la sync serveur : toute sonde qui lit le doc
  doit ATTENDRE (waitForFunction tracks.length attendu), sinon fausses
  conclusions (vu deux fois).

## RELANCER / VERIFIER

- Stack : `start-daw.cmd` OU `scripts\daw.ps1 -Secure` -> URL stable a
  bookmarker : `http://localhost:5173/#stoken=<contenu de
  ~/.daw-server-token>` (menu des projets ; studio dedans).
- Moteur : `engine\rebuild_msvc.bat` (zombies d'abord ; layout change =
  ninja clean avant). Tests moteur : `daw_engine_test.exe` (45/45).
- Web : `cd web ; npm run test:e2e` (70 tests). tsc : `npx tsc --noEmit`.
- L'oreille : `npm run ear -- --project studio --probe` (rendu offline
  + table de preuve par etage ; --solo/--bypass pour isoler ; JAMAIS
  d'ecoute avant porte verte, crete > -1 dBFS = rouge).
- **La manip 5 minutes** : Ctrl+Shift+R sur l'onglet -> bouton **A**
  d'une piste -> double-cliquer 3 points dans la lane -> PLAY : le
  fondu dessine s'entend. Tirer un clip sur une AUTRE piste. Glisser
  un plugin du navigateur DANS le rack. BOX -> la fenetre s'ouvre
  DEVANT (et refuse en rouge si le moteur est deconnecte).
