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
- [ ] 2.1ter Course du store decouverte par le test : deux PREMIERES
      connexions simultanees sur un projet vide peuvent toutes deux creer
      le doc par defaut, et la sauvegarde tardive ECRASE un change deja
      persiste. Session dediee : serialiser la creation (ou verrou par
      projet) + test propre.
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
