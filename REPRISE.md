# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28, soir) : LE MINILAB JOUE DEXED DANS LES T8V — « OUI ! »

**A LIRE EN PREMIER — le point de synchro CI : LEVE.** Le push « MMCSS +
MiniLab » (2c72685) est VERT en CI (run 33183052605). Aucun verdict en
vol.

## Ce qui a ete fait (2026-08-28, dans l'ordre)

- Rangement documentaire ; ring v10 ; contrat de periode + ring v11 ;
  Vague 3 sessions A et B ; preuve MIDI en vrai (port loopMIDI, matrice
  DX10/Dexed/Surge XT) — tous verts en CI.
- **MiniLab 3 branche et joue a l'oreille** (port « Minilab3 MIDI »).
  Le gresillement entendu = enfant plugin_host en retard a priorite
  normale (~50 % de blocs DRY, mesure par `pluginBlocksMissed`, meme
  sans note) -> thread serve en **MMCSS Pro Audio** : 1356 blocs rates
  -> 0, « oui ! ». Twitch coupe par l'exclusif -> **partage 512 = la
  stack quotidienne, l'exclusif jamais par defaut** (decision).
- Rectificatif : l'alerte « +19 dBFS » etait un artefact de parsing
  (`sort -n` sur `9.2e-19`) ; vraies cretes ~0,1-0,18.
- Non-regression sur l'enfant MMCSS : gtests 59/59, hash intact, specs
  proxy + matrice midi-in 11/11.

## Comment relancer (jouer au MiniLab)

```
engine\build-msvc\daw_engine.exe --server ws://localhost:3000 --project minilab --play --start-stopped --buffer-size 512 --vst3-dir "C:\Program Files\Common Files\VST3" --midi-in "Minilab3 MIDI"
```
(serveur + vite lances a part : `scripts\start-stack.ps1 -Component
server` et `cd web ; npm run dev` — ou `start-daw.cmd` puis un moteur
a la main avec `--midi-in`, tant que `daw.ps1 -MidiIn` n'existe pas).
Projet `minilab` = piste MIDI + Dexed a gain 0,25. Onglet :
`http://localhost:5173/?project=minilab`. Rien ne tourne a la cloture.

## Quoi surveiller

1. Le verdict CI ci-dessus.
2. `plugin_host: serve thread MMCSS Pro Audio (critical)` dans le log
   enfant (`%TEMP%\daw-ring-*.shm.log`) : si « TIME_CRITICAL (MMCSS
   unavailable) » ou « could not raise », la priorite n'a pas pris.
3. Transitoire DX10 (TODO §3) ; exclusif 256 + MMCSS a re-mesurer.

## La suite (ORDRE GRAVE, TODO.md §1)

1. Maillon 1, reste : `daw.ps1 -MidiIn <nom>` ; re-mesure exclusif 256
   + MMCSS ; transitoire DX10 ; limiteur de sortie (point produit).
   Puis Vague 3 suite : Web MIDI, notes en map a ids stables, velocite
   editable, piano-roll musical, ProcessContext.
2. Reliquat spike LAN ; 3. T4 Link Etage 2 ; 4. perf au regime de
   preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

## Decisions ouvertes

TODO.md §2 (overlap au drag, mute document, ASIO, placement + lieux
d'ecoute, politique latence heterogene, auth, macOS, veille samod, kit
de demarrage). Tranchee ce soir : exclusif jamais par defaut.
