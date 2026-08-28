# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28, nuit) : LE MINILAB JOUE, LE PLUGIN SE PILOTE, LE GEL DE 2 s EST TROUVE

**A LIRE EN PREMIER — le point de synchro :** un verdict CI est en vol
sur le dernier push de la session (« gestes du piano-roll », `git log
-1`) ; `gh run list --limit 3`. L'avant-dernier push de code (8c53698,
notes a ids stables) est VERT (run 33188483347).

- **Le piano-roll en modele de selection** (retour utilisateur « je peux
  pas deplacer ni selectionner » : la v1 effacait la note au clic) :
  clic = selectionner, lasso depuis une case vide, glisser = deplacer le
  lot (temps + hauteur), bord droit = longueur, Alt+glisser ou molette =
  velocite (intensite de la case), Suppr = effacer, Echap, Ctrl+A ; un
  geste = un undo ; adresse occupee refusee et montree ; le rack ne se
  reconstruit pas pendant un geste et garde son scroll (ouvert centre
  sur C4). Spec `piano-roll-gestures.spec.ts` (glisser lent compris).
- **Demande utilisateur a suivre** : la meme selection multiple + lasso
  + Ctrl+D sur les CLIPS de l'arrangement (« comme dans Ableton »).
- **Notes a ids stables** : `NoteDef.id` additif, `updateNote(track,
  clip, id, patch)` undoable — le socle de la velocite editable et du
  deplacement des notes ; spec 2 onglets en concurrence verte.
- **ProcessContext prouve cote plugin** : trace enfant tempo 120 ->
  93,5 et playing 0 -> 1 (bornee, 12 lignes).

- **ProcessContext (ring v12)** : les plugins recoivent position du
  bloc, tempo entier du document, play/stop, 4/4 (AUDIT-6 §6 solde) ;
  gtests 61/61, hashes intacts, specs 14/14. Non prouve a l'oreille :
  un LFO tempo-sync qui suit 90 vs 120 BPM (Surge XT) — a faire.

## Ce qui a ete fait (2026-08-28, dans l'ordre)

- Rangement documentaire ; ring v10 ; contrat de periode + ring v11 ;
  Vague 3 A + B ; preuve MIDI en vrai (matrice DX10/Dexed/Surge XT) ;
  MMCSS (le gresillement) ; `--params` + `daw.ps1 -MidiIn` ; tous
  verts en CI jusqu'a b63beea.
- **Le plugin se pilote sans sa fenetre** : CC64 sustain prouve ; Output
  de Dexed pousse par le document pendant le jeu, sans trou.
- **LE GEL DE 2 s** : le « transitoire » (note muette apres un rebuild)
  etait un artefact — la boucle de controle gelait 2068 ms a chaque
  PUT/GET d'asset (`localhost` -> `::1` d'abord dans ixwebsocket,
  serveur en 127.0.0.1) et la telemetrie ne voyait plus la note qui
  jouait. Fix `util/net_loopback.h` (PUT/GET assets + WS du moteur),
  gtest ; instruments gardes : `control-loop stall: N ms` (le
  declencheur C1 d'AUDIT-5), `state-capture timing`, note-on/skip/torn
  cote child. gtests **60/60**, hash intact, specs assets/sync/proxy/
  midi **15/15**, DX10 a 1,5 s vert.
- Rectificatif du soir : l'alerte +19 dBFS etait un artefact de parsing.

## Comment relancer (jouer au MiniLab)

`scripts\daw.ps1 -MidiIn "Minilab3 MIDI"` (stack complete, partage
512, Twitch intact) puis onglet `?project=minilab` (piste MIDI + Dexed a
0,25) — ou un moteur a la main (voir JOURNAL). Manipuler le plugin :
`engine\build-msvc\plugin_host.exe --params "<module.vst3>" --uid <uid>`
pour la liste, puis `__dawProject.setProcessorParam(track, proc, '<id>',
v)` (ou le rack). Rien ne tourne a la cloture.

## Quoi surveiller

1. Le verdict CI ci-dessus (regle : un verdict par session, sur le
   dernier push — CLAUDE.md §5).
2. `control-loop stall:` dans les logs moteur : tout gel > 50 ms est
   desormais ecrit (attendu : ~90 ms par PUT local, plus par tunnel).
3. `plugin_host: serve thread MMCSS Pro Audio (critical)` dans le log
   child ; a re-mesurer : exclusif 256 + MMCSS (16 ms sans gresiller ?).

## La suite (ORDRE GRAVE, TODO.md §1)

1. Vague 3, suite : piano-roll musical (nom des notes, zoom, plus d'une
   mesure, selection multiple), preuve a l'oreille d'un LFO tempo-sync (Surge XT, 90 vs 120 BPM),
   limiteur de sortie (point produit avant « jouer live »), C1 (HTTP
   hors de la boucle de controle, moule export_job), re-mesure
   exclusif 256 + MMCSS, Web MIDI, timeSignature du doc ->
   ProcessContext.
2. Reliquat spike LAN ; 3. T4 Link Etage 2 ; 4. perf au regime de
   preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

## Decisions ouvertes

TODO.md §2 (overlap au drag, mute document, ASIO, placement + lieux
d'ecoute, politique latence heterogene, auth, macOS, veille samod, kit
de demarrage). Tranchees ce soir : exclusif jamais par defaut ; CI une
fois par session.
