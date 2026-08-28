# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28, nuit) : L'ENTREE MIDI LIVE EST LA — IL MANQUE LE PORT

**A LIRE EN PREMIER — le point de synchro :** un verdict CI est en vol
sur le push « Vague 3 session B » (`git log -1`) : premier passage sous
GCC du STUB MIDI-in (Linux ne compile pas `midi_input_winmm.cpp`), de
`midi_in_cli.cpp` et de la spec `midi-in` (qui doit SKIP en CI). `gh run
list --limit 3`. AUCUN travail ne s'ouvre avant ce verdict.

**Point de synchro UTILISATEUR :** le port loopMIDI « MagicPotion »
n'existe pas encore sur la tour (`daw_engine --list-midi-devices` ne
liste que les deux ports Stream Deck). Le creer (icone loopMIDI -> nom
`MagicPotion` -> +), puis : stack (`start-daw.cmd` ou serveur+vite) et
`cd web ; npx playwright test tests/e2e/midi-in.spec.ts` = la preuve
pilotee du port en vrai (aujourd'hui la spec SKIP proprement).

## Ce qui a ete fait (2026-08-28, dans l'ordre)

- Rangement documentaire (4ee5ff6) ; ring v10 (2ef82eb) ; contrat de
  periode clos + ring v11 (027781c) ; Vague 3 session A (30b0493, CI
  verte) ; **Vague 3 session B** : port WinMM, CLI, `midi_send`, spec.
  gtests 59/59, hash intact, CLI smoke verifie (liste, refus en clair).
  Plan : `.claude/plans/mellow-orbiting-aurora.md`. Details : JOURNAL.

## Comment relancer

- Stack : `start-daw.cmd` ou `scripts\daw.ps1 -Secure` ; arret
  `stop-daw.cmd`. Rien ne tourne a la cloture.
- MIDI live a la main : `engine\build-msvc\daw_engine.exe --server
  ws://localhost:3000 --project studio --play --start-stopped
  --vst3-dir "C:\Program Files\Common Files\VST3" --midi-in <nom du port>`
  (+ `--exclusive --buffer-size 256` pour 16 ms). Cible = la premiere
  piste avec un instrument, ou `--midi-track <id>`. Les logs disent
  `midi-in: opened`, `midi-in: -> track`, puis `midi-in stats:` toutes
  les 5 s (queue-lat = file ; pipeline~ = profondeur + periode).
- `daw.ps1` n'ouvre pas encore de port MIDI (TODO §1.1 c).

## Quoi surveiller

1. Le verdict CI ci-dessus.
2. Sans `--midi-in`, ZERO changement de comportement attendu.
3. Au premier vrai clavier : `dropped=` doit rester 0 (file de 512) ;
   `unrouted=` > 0 veut dire piste cible muette/absente.

## La suite (ORDRE GRAVE, TODO.md §1)

1. Maillon 1, reste : port « MagicPotion » -> spec verte ; manip audible
   sur Dexed en exclusif 256 ; `daw.ps1 -MidiIn`. Puis Vague 3 suite :
   Web MIDI, preuve CC64/pitch-bend sur un vrai synthe, notes en map a
   ids stables, velocite editable, piano-roll musical, ProcessContext.
2. Reliquat spike LAN ; 3. T4 Link Etage 2 ; 4. perf au regime de
   preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

## Decisions ouvertes

TODO.md §2 (exclusif dans daw.ps1, overlap au drag, mute document, ASIO,
placement + lieux d'ecoute, politique latence heterogene, auth, macOS,
veille samod, kit de demarrage).
