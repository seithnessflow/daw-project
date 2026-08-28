# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28) : RANGEMENT DOCUMENTAIRE FAIT, RING v10 EN ATTENTE

**Point de synchro — LEVE :** les deux verdicts CI attendus a la cloture du
27 (e512538 T5 hash musical sous GCC, 99190f4 A6) sont **VERTS**
(runs 33098055746 et 33098555758, `gh run list`). Aucun verdict en vol :
le rangement ci-dessous est markdown-only (la CI ignore `**.md`).

**Travail NON COMMITE dans l'arbre (a traiter en premier) :** le ring
v10 — `shared_audio_ring.h` (kRingSlots 4 -> 8, estampilles par slot
A4-5, invariant input-dechire grave), `proxy_node.cpp`, `plugin_bridge.cpp`,
`plugin_host_main.cpp`, `main.cpp` (clamp de profondeur bruyant),
`cli_integration_test.cpp` (gtest ajoute) + `traces/box-3-open.png`.
7 fichiers, ~175 lignes, NON verifie. Layout de struct partagee change
=> **CLEAN build obligatoire** (`ninja clean`), gtests, spec proxy, puis
commit. C'est l'item 2 de l'ordre grave, entame le 27 au soir.
Le binaire `daw_engine.exe` de build-msvc est ANTERIEUR a ce diff
(son `--help` ne connait pas `--exclusive`/`--buffer-size` alors que
main.cpp les a) : ne pas lui faire confiance avant rebuild.

## Ce qui a ete fait (session du 2026-08-28 : rangement)

La doc se contredisait (trois « ordres graves » coexistants, criteres
recopies avec des chiffres differents, README portant la loi ABROGEE,
STATUS redevenu un journal, TODO de 88 Ko a 80 % de [x], deux ADR-015,
audits eparpilles racine/docs). Fait, sans toucher au code :

- **Un proprietaire par information, applique** (CLAUDE.md §3, la carte
  des documents). CLAUDE.md = regles vivantes seulement (21 -> ~14 Ko,
  sans historique) ; STATUS.md = etat court ; TODO.md = UNE file
  (ordre grave / decisions ouvertes / dettes datees / backlog, 88 -> ~15 Ko,
  zero item fait) ; SECURITY.md re-trie ; README.md verite (loi ADR-019,
  capacites, CLI, structure).
- `docs/audits/AUDIT-1..6.md` (les six rapports, lecture seule) ;
  `docs/archive/` (docs morts + copies integrales des anciens CLAUDE/
  STATUS/TODO du 27) ; `docs/README.md` = index avec statut par doc ;
  chaque doc de conception porte une ligne `Statut :` en tete.
- docs/DECISIONS.md : index des ADR (collision ADR-015 nommee), ADR-008
  clos (LNA valide), ADR-014 amende par ADR-019, ADR-006 note import ;
  ADR-019 §6 amende (gel -> garde-fou anti-clone). docs/SCHEMA.md
  aligne sur schema.ts (pan, kind, notes, scenes, stems/etat, name).
- Supprime : `start_engine.ps1` (3e chemin de demarrage a l'abandon,
  A4-16.4). `AMELIORATIONS.md` archive (aucune entree depuis le 22 —
  JOURNAL est le registre de fait).

## Comment relancer

- Stack : `start-daw.cmd` (double-clic) ou `scripts\daw.ps1 -Secure`.
  Arret : `stop-daw.cmd`. Avant tout rebuild moteur : tuer les
  `plugin_host.exe` zombies.
- Offre OUVERTE (non tranchee) : passer `daw.ps1` en
  `--exclusive --buffer-size 256` (16 ms, 0 underrun sous charge).

## Quoi surveiller

1. Le ring v10 non commite (ci-dessus) : ne pas empiler dessus sans
   l'avoir verifie ou range (stash) explicitement.
2. `callback-shape` dans les logs moteur : `partials>0` = contrat de
   periode viole, la piste B (accumulateur) remonte (TODO dettes A6).
3. Le premier passage GCC du hash musical est passe (vert) — toute
   divergence future = regression du noyau tempo, jamais du bruit.

## La suite (ORDRE GRAVE, TODO.md §1)

1. Reliquat spike : mesure LAN 2 machines (portable TX15).
2. Contrat de periode, fin : ring v10 (verifier + commit), refus de
   demarrer hors contrat, puis la file d'ordres generique (A3-1).
3. T4 Link Etage 2 : session dediee a proposer.
4. Vague 3 MIDI + entree live (test Massive en demo de fin).
5. Performance au regime de preuve (suite Lot P).
6. Ratifications AUDIT-5 F / AUDIT-6 refontes.

## Decisions ouvertes

Liste complete et a jour : TODO.md §2 (exclusif dans daw.ps1, overlap
au drag, mute document, ASIO, placement + lieux d'ecoute, politique
latence heterogene, auth, macOS, veille samod, kit de demarrage).
