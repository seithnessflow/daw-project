# STATUS.md — l'ETAT courant

*Un seul proprietaire par information : ce fichier possede l'etat
(invariant, criteres, composants, perf, commandes). Le recit date vit
dans JOURNAL.md, la file dans TODO.md, les hashes/mesures/decisions dans
docs/DECISIONS.md. Derniere mise a jour : 2026-08-28 (Vague 3 sessions A+B :
entree MIDI live complete — port WinMM `--midi-in` -> file SPSC ->
callback -> instrument de la piste cible, monitoring a l'arret, bug latent
« timeline rejouee transport arrete » corrige, outil midi_send, spec
midi-in ; gtests 59/59, 14 specs moteur reel 25/25 ; port loopMIDI
« MagicPotion » cree, matrice DX10/Dexed/Surge XT verte en vrai). Version
narrative precedente : docs/archive/STATUS-integral-2026-08-27.md.*

## L'INVARIANT PRODUIT (ADR-019)

**Un pair qui n'a pas le plugin installe entend le resultat du plugin.**

Etat : **VERT** — prouve deux machines / deux reseaux / a travers le store
(smoke S7, 2026-08-23, AGain) et RE-PROUVE sur vrais plugins du commerce
(Valhalla + RoughRider, 2026-08-25 : rendu byte-exact sur le portable sans
ces modules, ligne « playing STEM ... for an unresolved plugin »).
Reserves (n'empechent pas le vert, tracees TODO) : la jambe vrais-plugins
fut un rendu OFFLINE via ear avec blobs poses par scp (le chemin reseau
vivant n'est prouve qu'avec AGain) ; badges de fraicheur distants non
observes en live ; arbitrage d'ecrivain a deux machines ayant le meme
plugin absent (AUDIT-5 A3).

Les deux autres piliers distribues :
- **Streaming jam P2P (S8)** : VALIDE a l'oreille de l'utilisateur
  (2026-08-24, deux NAT, STUN seul). Flux broadcaster propre depuis le
  pre-buffer d'amorcage (2026-08-27, 0 underrun worklet).
- **Sync transport Link Etage 1 (L1a/b/c)** : VERT deux machines
  (2026-08-24, ecart <= 16 ms, critere < 50 ms). Ecouter un jam suspend
  la lecture locale. Etage 2 (grille au quantum) = T4, differe.

## Criteres d'acceptation

| # | Critere | Statut | Ou est la preuve |
|---|---|---|---|
| 1 | Rendu deterministe | ✅ | DEUX ancres : absolu `56729beb61993cd7` (inchange par toute la migration tempo) + musical `c1233ae9d6ab9e83` (T5), assertes dans `daw_engine_test` ET `ci.yml` (jumeaux), MSVC + GCC. Historique : docs/DECISIONS.md |
| 2 | Test CLI sans navigateur | ✅ | `daw_engine_test.exe` 61/61 (2026-08-28) |
| 3 | Convergence — redefini ADR-019 : DEUX machines, deux reseaux, un projet | ⚠️ PARTIEL | Sous-ensemble 2 onglets : ✅ reserve levee 2026-08-23 (trio deps-manquantes A4-1/2/3 solde, heartbeat, graine commune, gardes Rust 2 + sync-resilience.spec). Deux machines : convergence doc OBSERVEE au smoke 1bis (2026-08-23, les deux sens, niveau document) + S7 + L1b tenus. Le deroule E2E formel du critere redefini (item TODO) n'a pas eu lieu comme tel |
| 4 | Acces moteur local depuis une origine HTTPS publique (Chrome LNA) | ✅ | SCEAU 2026-08-23 sur le vrai Chrome 151/Windows 11 (invite apparue et autorisee, fetch ET WS soumis au LNA, `permissions.query` lisible, AUTH OK + telemetrie). Inconnus dates et details de campagne : docs/DECISIONS.md « Critere 4 » |
| 5 | WASAPI sans underrun | ⚠️ PARTIEL | 10 min sans charge (2026-08-20, ZenGo 48k/512) ✅ ; SOUS CHARGE 28 threads : 0 underrun sur 30 s en partage 512 ET en exclusif 256 (Lot P, `scripts/perf-underruns.ps1`, 2026-08-27). Les 10 min sous charge ne sont pas refaites — procedure ci-dessous |
| 6 | L'invariant (ci-dessus) | ✅ | S7 + vrais plugins ; gtest `testStemInvariant` en CI avec contre-controles (sans stem = refus bruyant, stem corrompu = jamais un faux vert) |

## Etat des composants (cloture 2026-08-27)

| Composant | Build | Tests | Ce qu'il sait faire |
|---|---|---|---|
| Engine C++ (MSVC local, GCC CI) | ✅ | gtests **61/61** (2 hashes ancres) ; CI verte jusqu'a 9332f14 (selection multiple des clips), aucun verdict en vol | Audio : WASAPI partage (512 = stack quotidienne) ou exclusif (`--exclusive --buffer-size 256` = 16 ms, prend le device), blocs internes 256, contrat de periode CLOS (periode non multiple de 256 ou depth > 6 = refus de demarrer). Hote VST3 hors processus, ring v12 : 8 slots, estampilles par slot (perime/dechire = dry + compte), FIFO MIDI generique (note/CC/pitch-bend), CC/PB -> parametres via IMidiMapping, ProcessContext (position, tempo entier, play/stop, 4/4), un controleur par instance, enfant en MMCSS Pro Audio, cold-restart, GUI a la demande, scan `--vst3-dir`, `--params`. Entree MIDI live : `--midi-in` (WinMM) -> file SPSC -> callback -> instrument de la piste cible (auto ou `--midi-track`), monitoring transport arrete, `midi-in stats` ; prouve sur DX10/Dexed/Surge XT et au MiniLab 3. 5 natifs (utility/eq3/comp/drive/delay), stems + etat au store, PDC ecrivain, rendu offline deterministe + `--probe`, export sur thread ouvrier, Session (launch quantise), automation gain/pan/master (miroir exact du TS), noyau tempo entier, bascule de projet, crash handler, `control-loop stall:` loggue tout gel > 50 ms. Dettes : limiteur de sortie absent, HTTP encore sur le thread de controle (C1) |
| Server Rust | ✅ | cargo **9/9** | Persistance `.am` atomique par projet, refus bruyant des deps manquantes, heartbeat 15 s, relais `signal:` verbatim, store SHA-256 verifie au PUT, auth OPT-IN par token partage (`DAW_SERVER_TOKEN`, premier message WS + Bearer, temps constant), Origin local-first |
| Web TypeScript | ✅ tsc 0 | e2e **99/99** (49 specs, moteur reel spawne sur les chemins critiques) | Etabli 3 colonnes + rack en bas (splitters persistes), paradigmes Arrangement/Session/Mixage, pistes typees audio/MIDI, clips (move/trim/split/fades/rename/duplicate/drag entre pistes ; selection multiple Shift+clic / lasso, deplacer le lot, Ctrl+D en bloc, Suppr du lot), boucle utilisateur, undo par inverses, automation dessinee, piano-roll (ticks, notes a ids stables, selection a la souris + lasso, deplacer le lot / longueur / velocite, Suppr, un geste = un undo), tempo topbar + badge ♪ musical/absolu, navigateur instruments/effets/samples (catalogue 91 classes, drag & drop, pre-ecoute), import universel (mp3/flac/ogg -> WAV au taux du projet), export mixdown, gardes d'onglet (version, projet), jam P2P + badge, SYNC transport + horloge de session, VU avec ballistique |

## Performance (Lot P, 2026-08-27)

| Mesure | Valeur | Outil / garde |
|---|---|---|
| Graphe 500 pistes, bloc 256 | **735 us = 13,8 % du budget** (5333 us) | gtest `testGraphLoadBudget` (CI) |
| Underruns sous charge 28 threads, partage 512 | **0** / 30 s | `scripts/perf-underruns.ps1` |
| Underruns sous charge, exclusif 256 (16 ms) | **0** / 30 s | idem `-Exclusive` |
| Latence device : partage / plancher partage / exclusif 256 / 128 | 32 / 23,4 / **16** / 8 ms | ligne `audio-negotiation:` (readback) |
| Pipeline jam (une machine, hors reseau) | **~75 ms** (pump ~5 + FIFO ~27 + Opus ~20 + NetEq 21-32) | `scripts/measure-jam.mjs` |
| Underruns worklet broadcaster | **0** (238-950/10 s avant le pre-buffer) | `jamAudio.workletStats()` |

Verdict latence (docs/SPIKE-LATENCE.md) : jeu direct sur moteur distant
EXCLU (~75 ms logiciels) ; test Massive jouable en MIDI LAN -> rendu
tour 16 ms -> enceintes de la piece (~18-20 ms) ; WAN = ecoute/jam.

## Commandes utiles

```powershell
# Stack complete (token epingle ~/.daw-server-token, projet studio)
start-daw.cmd / stop-daw.cmd            # double-clic
scripts\daw.ps1 [-Secure] [-Mute] [-Stop]

# Moteur seul
cd engine\build-msvc
..\rebuild_msvc.bat ; .\daw_engine_test.exe
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821
.\daw_engine.exe --help                 # reference CLI complete

# Serveur : cd server ; cargo run        # 127.0.0.1:3000
# Web     : cd web ; npm run dev         # http://localhost:5173
```

**Token moteur** : un fichier PAR PORT `%TEMP%\daw-engine-token-<port>`
(JSON `{token, port, address}`), livre a la page par le fragment
`#token=` (daw.ps1) ou l'endpoint local `/api/engine-token` (vite).
**Token serveur** (mode -Secure) : env `DAW_SERVER_TOKEN` + fragment
`#stoken=` dans l'URL. Deux machines : docs/deux-machines.md.

## Procedures vivantes

**Critere 3 (convergence, 2 onglets)** : stack lancee, ouvrir
`http://localhost:5173/?project=studio` dans deux onglets ; bouger un
gain dans l'un, l'autre suit ; l'inverse aussi. Garde automatique :
`criterion3-*.spec.ts`, `sync-resilience.spec.ts`.

**Critere 5 (WASAPI sous charge)** : `scripts\perf-underruns.ps1`
[`-Exclusive`] (30 s, 28 threads). Version 10 min a la main :
`daw_engine.exe --doc ..\test-assets\test_10min.am --play` puis
`ninja clean && ninja -j32` dans un second terminal ; noter les
underruns au bilan de sortie.

**Critere 4 (LNA)** : page servie par un tunnel (`scripts\tunnel-daw.ps1`
ou `cloudflared tunnel --url http://localhost:5173`), moteur avec
`--allow-origin <https://origine>` ; l'invite Chrome doit apparaitre et,
autorisee, la pastille Engine passe au vert. Resultats acquis :
docs/DECISIONS.md.
