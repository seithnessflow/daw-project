# TODO

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
