# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28, nuit) : VAGUE 3 SESSION A LIVREE, SESSION B A OUVRIR

**A LIRE EN PREMIER — le point de synchro :** un verdict CI est en vol
sur le push « Vague 3 session A » (`git log -1`) : premier passage sous
GCC de `midi/midi_parse.h`, `midi/live_midi.h`, du routage graphe et du
gate du callback (aucun WinMM dedans — rien de Windows-only). `gh run
list --limit 3`. AUCUN travail ne s'ouvre avant ce verdict.

## Ce qui a ete fait (2026-08-28, dans l'ordre)

- Matin : rangement documentaire (4ee5ff6). Ring v10 (2ef82eb, CI verte).
- Soir : contrat de periode CLOS + ring v11 FIFO MIDI generique
  (027781c, CI verte).
- Nuit : **Vague 3 session A** — un bug latent corrige d'abord (timeline
  rejouee quand le graphe tourne transport arrete, etape 0, test qui
  echouait avant), puis le rail complet file SPSC -> callback ->
  instrument (voir JOURNAL). 59/59, specs moteur reel 25/25, hash intact.
  Plan ratifie : `.claude/plans/mellow-orbiting-aurora.md`.

## Comment relancer

- Stack : `start-daw.cmd` ou `scripts\daw.ps1 -Secure` ; arret
  `stop-daw.cmd`. Rien ne tourne a la cloture.
- Regle vivante : periode non multiple de 256 = refus de demarrer
  (exclusif 128, partage 374) ; `daw.ps1` (512) n'est pas concerne.
- Offre OUVERTE : `daw.ps1` en `--exclusive --buffer-size 256`.

## Quoi surveiller

1. Le verdict CI ci-dessus.
2. Aucun changement de comportement attendu SANS `--midi-in` (la file
   n'est pas cablee : `midi_in == nullptr`, chemin silence identique).
   Si un bourdon/mitraillette disparait en mode session avec des clips
   sur une piste non lancee, c'est l'etape 0 qui l'a corrige (le dire).

## La suite (ORDRE GRAVE, TODO.md §1)

1. **Vague 3 session B** (plan, etapes 5-7) : port WinMM
   (`midi_input_winmm.cpp` + stub Linux, `winmm` dans CMake WIN32),
   CLI `--list-midi-devices` / `--midi-in <nom>` / `--midi-track <id>`
   (`cli/midi_in_cli.*`, regle SPLITTER), contrats de log `midi-in:
   opened "<name>" -> track "<id>"` et `midi-in stats: events=N
   dropped=D unrouted=U queue-lat last=X.X ms max=Y.Y ms pipeline~Z.Z ms`,
   outil `engine/tools/midi_send.cpp`, spec `midi-in.spec.ts` (skip si
   port absent ; instrument mda DX10 ; `--mute` : le backend null appelle
   le callback), manip audible : `--exclusive --buffer-size 256 --midi-in
   <clavier>` sur un projet Dexed. PREALABLE UTILISATEUR : port loopMIDI
   « MagicPotion » (loopMIDI tourne deja, ports Stream Deck intouches).
2. Reliquat spike LAN (portable) ; 3. T4 Link Etage 2 ; 4. perf au
   regime de preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

## Decisions ouvertes

TODO.md §2 (exclusif dans daw.ps1, overlap au drag, mute document, ASIO,
placement + lieux d'ecoute, politique latence heterogene, auth, macOS,
veille samod, kit de demarrage).
