# TODO

## Tranche 2 — HOTE VST3 (le cap)

La demo que ni Soundtrap ni BandLab ne peuvent copier : un plugin natif
pilote depuis un onglet. Sous-etapes de soutien, dans l'ordre :

- [ ] 2.1 ESCALADE 2026-08-21 : support Rust d'automerge-repo immature
      (automerge-repo-rs = non compatible reseau avec le JS ; samod =
      compatible mais "experimental, don't use anywhere serious").
      Options rapportees : A relais Node officiel (mais 2 syncs cohabitants,
      re-scoper le critere), B durcir le sync maison Rust (persister avant
      de diffuser) et revisiter quand samod murit, C geler et passer a 2.2.
      Recommandation session : B. DECISION : B, FAIT 2026-08-21 —
      persist-avant-broadcast corrige dans websocket.rs, test kill brutal
      (`cargo test --test persist_before_broadcast`) 5/5.
      Regle du sync maison : code condamne a terme — on n'y ajoute que ce
      qui corrige un defaut prouve par un test, jamais de la structure.
- [ ] 2.1bis VEILLE : reevaluer automerge-repo/samod. Critere de sortie
      d'experimental : le README de samod retire son avertissement
      ("don't use anywhere serious"), release taguee, et au moins un
      projet reel l'utilise en production. Verifier a chaque debut de
      tranche, pas avant.
- [x] 2.1ter FAIT 2026-08-22 : mutations du store serialisees (store_lock
      dans AppState — creation du doc par defaut + apply_change), test
      `concurrent_first_writes` rouge prouve puis vert. Les tests spawnes
      tuent desormais leur serveur meme sur panic (ServerGuard/Drop).
      Le sync maison n'a plus de defaut connu.
      - La migration inclut la SUPPRESSION de l'ancien code de sync
        (protocole artisanal, anti-entropie, file offline maison si
        automerge-repo la remplace). Deux chemins de sync cohabitants =
        echec de la session.
      - Avant d'ecrire quoi que ce soit : verifier l'etat reel du support
        automerge-repo cote Rust. S'il est immature, ESCALADE PROPOSEE
        avec les options (ex: relais sync Node, Rust garde stockage +
        assets) - ne pas bricoler un pont.
      - Le moteur C++ ne migre PAS (il parle au serveur). Le jalon
        fader->moteur doit rester vert SANS modification cote moteur ;
        si ca casse, c'est le serveur qui s'adapte.
- [x] 2.2 FAIT 2026-08-22 — VERDICT A (voir DECISIONS.md): taille quasi
      constante (compression colonnaire), seul le temps de chargement croit
      (~2,4-4,9 us/change). Le VST3 demarre sans prealable. Dettes datees:
      compaction (declencheur: > ~100k changes / load web > 500 ms),
      coalescing des drags (optionnel, session web courte).
- [ ] 2.3 SHA-256 des assets + cote moteur<->serveur du triangle (HTTP) —
      le rendu des pistes a plugins en dependra.
- [ ] 2.3bis AUDIT A FROID avant d'ouvrir 2.4 — session neuve, lecture
      seule, prompt pret : `docs/audit-2-prompt.md`. Question directrice :
      qu'est-ce qui va ceder quand le VST3 va s'appuyer dessus ?
      (cycle de vie du graphe sous rebuild lourd, chain ignore,
      frontieres de processus + dettes audit 1 : solo/mute, assetHash)
- [ ] 2.4 Hote VST3 — premier objectif, tranche la plus fine qui traverse
      tout : UN plugin de gain VST3 connu s'instancie dans un processus
      isole, traite de l'audio, et son bypass s'entend. Un plugin, un
      parametre, une preuve. Fenetrage, etat, decouverte des plugins :
      apres. (Regle dure : c'est le prochain morceau qui se CONSTRUIT,
      dettes non vides ou pas.)

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
