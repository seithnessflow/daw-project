# TODO

## Tranche 2 — HOTE VST3 (le cap)

La demo que ni Soundtrap ni BandLab ne peuvent copier : un plugin natif
pilote depuis un onglet. Sous-etapes de soutien, dans l'ordre :

- [ ] 2.1 Migration serveur+web vers automerge-repo, a comportement
      identique. Critere de succes UNIQUE : les 9 tests existants verts,
      offline compris. (Session bornee suivante)
- [ ] 2.2 Compaction du document — diagnostic d'abord : mesurer la
      croissance reelle pendant un drag de fader (dizaines de changes/s),
      puis proposer snapshot/prune. Implementation ensuite.
- [ ] 2.3 SHA-256 des assets + cote moteur<->serveur du triangle (HTTP) —
      le rendu des pistes a plugins en dependra.
- [ ] 2.4 Hote VST3 : chargement d'un plugin, parametres dans le document,
      audio dans le graphe. (A scoper apres 2.1)

## Court terme (sessions economes)

- [ ] Verifier le hash GCC en CI (`89f1a1105dc09e92`) — regarder GitHub Actions
- [ ] Critere 5 sous charge CPU (procedure dans STATUS.md, temps machine)
- [ ] Critere 4 LNA Chrome (manuel, `--allow-origin` pret)
- [ ] Persistance de l'outbox (localStorage) — `web/src/network/server_client.ts`
- [ ] Serveur : persister AVANT de diffuser (`server/src/api/websocket.rs`) — corrige la course, permet d'alleger l'anti-entropie cliente
- [ ] `solo`/`mute` en `std::atomic<bool>` — domaine thread audio, tests non-regression obligatoires

## Moyen terme

- [ ] Moteur : lire `chain` (processeurs) du document — TODO `automerge_document.cpp:419`
- [ ] `assetHash` FNV → SHA-256 — domaine format document, verif complete
- [ ] Nettoyer `docs/DECISIONS.md` (contenu WSL obsolete)

## Stack (a evaluer, pas urgent)

- [ ] Evaluer `automerge-repo` cote serveur/web : sync + persistance + resync
      fournis, remplacerait le broadcast maison et l'anti-entropie cliente
- [ ] Risque automerge-c (epingle monorepo `47908d6c`, peu maintenu) :
      si blocage, envisager un sidecar Rust pour le CRDT du moteur
