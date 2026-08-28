# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28, nuit) : L'ENTREE MIDI LIVE EST PROUVEE EN VRAI

**A LIRE EN PREMIER — le point de synchro CI : LEVE.** Le push « preuve
MIDI en vrai » (1020871) est VERT en CI (run 33178191452). Aucun verdict
en vol.

**Alerte a lire :** le test audible sur essai-claude (Dexed, patch
restaure, vel 70, exclusif 256) a crete a **+19 dBFS** sur les T8V —
deux notes de 0,5 s, ecretees par le DAC. Aucun limiteur de sortie
n'existe. Regle gravee CLAUDE.md §8 : instrument live = mesurer en
`--mute` d'abord, ecouter gain plafonne. Dette TODO §3 (limiteur).

## Ce qui a ete fait (2026-08-28, dans l'ordre)

- Rangement documentaire (4ee5ff6) ; ring v10 (2ef82eb) ; contrat de
  periode clos + ring v11 (027781c) ; Vague 3 session A (30b0493) et B
  (de50ac5) — toutes vertes en CI.
- **Preuve en vrai** : port loopMIDI « MagicPotion » cree par le
  registre (loopMIDI redemarre, ports Stream Deck conserves) ; spec
  `midi-in.spec.ts` = matrice **DX10 / Dexed / Surge XT verte** :
  CC64 + pitch-bend + note par `midi_send`, crete > 0 transport arrete,
  `midi-in stats` forwarded=4, `plugin_host: midi-mapping N` (DX10 32,
  JUCE 2080) = le chemin CC via IMidiMapping est prouve. Latence de
  file 0,3-17 ms ; pipeline 21,3 ms (512 partage) / **10,7 ms (exclusif
  256)**. Details et pieges : JOURNAL.

## Comment relancer

- Stack : `start-daw.cmd` ou `scripts\daw.ps1 -Secure` ; arret
  `stop-daw.cmd`. Rien ne tourne a la cloture.
- MIDI live : `engine\build-msvc\daw_engine.exe --server
  ws://localhost:3000 --project <id> --play --start-stopped --mute
  --vst3-dir "C:\Program Files\Common Files\VST3" --midi-in <port>` puis
  `engine\build-msvc\midi_send.exe --port MagicPotion --note 60`
  (ou un vrai clavier : `--midi-in <son nom>`, `--list-midi-devices`).
  AUDIBLE : retirer `--mute` SEULEMENT apres avoir lu la crete muette,
  gain de piste plafonne.
- `daw.ps1` n'ouvre pas encore de port MIDI (TODO §1.1 b).

## Quoi surveiller

1. Le verdict CI ci-dessus.
2. TRANSITOIRE DX10 (TODO §3) : note muette ~1,5 s apres l'ajout d'un
   instrument sur un projet frais — repro = la spec avec 1,5 s au lieu
   de 4. Si un utilisateur « joue et n'entend rien » juste apres avoir
   pose un instrument, c'est ca.
3. Sans `--midi-in`, ZERO changement de comportement attendu.

## La suite (ORDRE GRAVE, TODO.md §1)

1. Maillon 1, reste : manip a l'oreille de l'utilisateur avec son
   clavier (muet d'abord) ; `daw.ps1 -MidiIn` ; transitoire DX10 ;
   limiteur de sortie (prealable a « jouer live »). Puis Vague 3
   suite : Web MIDI, notes en map a ids stables, velocite editable,
   piano-roll musical, ProcessContext.
2. Reliquat spike LAN ; 3. T4 Link Etage 2 ; 4. perf au regime de
   preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

## Decisions ouvertes

TODO.md §2 (exclusif dans daw.ps1, overlap au drag, mute document, ASIO,
placement + lieux d'ecoute, politique latence heterogene, auth, macOS,
veille samod, kit de demarrage).
