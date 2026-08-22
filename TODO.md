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
- [ ] PREALABLES 2.4 (arbitrage audit 2, 2026-08-22) — quatre sessions
      bornees, dans cet ordre, puis l'hote. Seuls prealables recevables :
      ce sur quoi le plugin de gain isole s'appuie directement.
      1. [x] R4+S4 FAIT 2026-08-22 : pointeur brut atomique + retention
         par generation (ADR-010 annote) ; solo/mute atomic<bool> ;
         static_assert compile + test runtime is_lock_free (10/10) ;
         repro use-after-free verte. atomic<shared_ptr>.is_lock_free()=0
         prouve sur MSVC, banni du callback.
      2. [x] ADR R3 FAIT 2026-08-22 : ADR-017 — un processus enfant par
         instance, proxys dans le graphe, registre d'instances survivant
         aux rebuilds (=> R2 devient un transfert de handles), spin borne
         + bypass cote callback, crash enfant = bypass + signalement.
      3. [x] R1+R2 FAIT 2026-08-22 : constructeur dans la boucle
         principale (thread reseau = apply + version seulement), snapshot
         ProjectDef sous verrou / build hors verrou, dernier etat gagne.
         Registre d'instances ADR-017 en structure. Test de rafale : 51
         changes non espaces + --debug-rebuild-delay-ms 100 -> rebuilds
         tres < 51, version finale construite (v=changes+1), 0 underrun.
         Jalon renforce, pas affaibli (ancien test intact et vert).
      4. Elagage docs (session courte) : les 7 ecarts docs/reel de
         AUDIT-2.md — le chantier demarre sur des documents qui disent vrai.
- [x] 2.4a FAIT 2026-08-22 : SDK vendore (v3.8.1_build_84, recursif,
      gitignore), protocole moteur<->hote en protobuf des le premier
      message (host_messages.proto), plugin_host --enumerate liste AGain
      (uid 84E8DE5F92554F5396FAE4133C935A18) ; module corrompu/absent =
      erreur propre exit 1, jamais de crash (tests 11-12, 12/12).
- [x] 2.4b FAIT 2026-08-22 : AGain instancie (ceremonie complete, chaque
      refus = erreur propre), gain via IParameterChanges (le canal de
      2.4c), bloc 256 contractuel (blocks==frames/256 asserte), preuve
      par echantillons EXACTE (identite a 1.0, moitie a 0.5). 14/14.
      CI : les deux jobs vendorent le SDK epingle + deps VSTGUI Linux —
      plus de code hote hors du filet (verif du run CI post-push).
- [x] 2.4c-1 FAIT 2026-08-22 (verdict CI du push de cloture = point de
      synchronisation transmis) : pont transparent PROUVE au bit pres
      (test 15 : 3 passes continues du fixture 2.4b a travers un enfant
      --serve persistant = rendu hors ligne exact) ; ProxyNode +
      --debug-proxy-again + pipeline callback sans attente (test 16 :
      fill silencieux, bypass sec compte, wet a profondeur, rafales de 2) ;
      rafale E2E verte A TRAVERS le proxy (enfant spawne une seule fois,
      0 underrun) ; smoke reel 10 s WASAPI : 0 underrun, 4 blocs manques
      (amorcage du device, borne, documente).
      REVISION EN COURS DE ROUTE (premiere preuve vivante : 534/1875 blocs
      sec) : la profondeur du pipeline est passee de 1 a 2 blocs — le
      driver livre buffer/256 blocs DOS A DOS par callback, une trame
      d'avance perd la course. kLayoutVersion=2 (4 slots), profondeur =
      politique du noeud (buffer/256), l'enfant traite le backlog DANS
      L'ORDRE (le saut au plus recent affamait le consommateur).
      => 2.4d : getLatencySamples() retournera UN CALCUL, jamais une
      constante — latence = depth x 256, depuis la profondeur VIVANTE du
      noeud (buffer 512 -> 2 blocs -> 512 ech. ; buffer 1024 -> 4 blocs ->
      1024 ech.). Le canal param n'est PAS un seqlock (note gravee dans le
      contrat) : a durcir avant que c-2 n'y fasse passer plusieurs params.
      Detail d'origine :
      memoire partagee (ring audio + changements de parametres), cadence
      callback<->enfant, ProxyNode instancie EN DUR (--debug-proxy-again,
      pas encore le chain). DECISION PRISE EN ENTREE : pipeline a une
      trame — le callback depose le bloc N et recupere le N-1 deja pret ;
      l'enfant a 5,3 ms pleines pour 256 echantillons ; cout = 1 bloc de
      latence, declare dans getLatencySamples() en 2.4d. Depassement
      malgre tout = bypass du bloc + compteur d'incidents dans
      EngineState, JAMAIS d'attente non bornee.
      Preuve : le WAV de reference 2.4b rejoue EN CONTINU a travers le
      pont, echantillons identiques au rendu hors ligne — le pont est
      transparent, prouve au bit pres.
      PREMIER GESTE A LA REPRISE : relire shared_audio_ring.h A FROID
      avant d'ecrire proxy/--serve — le contrat a ete ecrit dans l'elan
      du cadrage et jamais confronte a du code ; une fois les deux cotes
      ecrits, chaque retouche du layout se paie double.
      TROIS PIEGES CONNUS D'AVANCE :
      1. Pas d'atomiques inter-processus gratuits : les std::atomic du
         ring DOIVENT etre dans le segment et lock-free — etendre le
         static_assert is_always_lock_free aux types inter-processus.
         AUCUN mutex STL dans le segment (UB deguise) ; SPSC a indices
         atomiques, meme moule que les peaks.
      2. Le layout du segment = contrat binaire entre deux executables :
         header commun aux deux cibles avec static_assert(sizeof) +
         offsetof sur chaque champ — le SCHEMA.md du monde binaire.
      3. La mort de l'enfant se detecte au thread de CONTROLE (handle de
         processus, timeout zero), jamais dans le callback — lui ne
         connait que « bloc pret ou pas » (absent = bypass comptabilise).
         Cette separation posee en c-1 rend c-2 presque deja ecrit.
- [x] 2.4c-2 FAIT 2026-08-22 (verdict CI du push de cloture = point
      transmis), dans l'ordre impose :
      1. SEQLOCK du canal param en premier geste (odd/even, layout v3,
         double-check lecteur borne) — le trio ne peut plus apparier un id
         frais avec une valeur perimee. Test 17 : changements successifs
         appliques chacun au bloc suivant.
      2. LE KILL (test 18) : enfant tue en plein vol -> bloc deja servi
         conserve, bloc non servi = bypass SEC EXACT (aucun artefact) +
         compteur ; mort vue au CONTROLE (poll 30 Hz), relance a froid sur
         le MEME segment (budget 3, signale EngineState :
         plugin_child_alive/restarts) ; le dernier param SURVIT au crash
         dans le ring. + Garde parent decouverte en session : un moteur
         tue net laissait l'enfant orphelin en spin (constate, exe
         verrouille) -> --parent <pid>, l'enfant sort seul (prouve test 18
         et par l'E2E kill reel : plus d'orphelin).
      3. LE CHAIN (M3 solde) : lu ET ecrit (roundtrip test 19), params en
         LISTE de paires {key,value} (SCHEMA.md), uid sur le noeud, chemin
         JAMAIS dans le document (--vst3-module uid=path cote hote).
         ProxyNode construit depuis le document (live, registre par
         node_id) ; rendu offline via SyncProxyNode (chemin sync, latence
         zero, echec de pont = rendu en ECHEC). Test 20 : le son vient du
         document, echantillons exactement halves a travers le processus ;
         uid non resolu = echec bruyant (R5 solde offline, signale live).
      20/20 moteur, E2E 4/4 (rafale a travers le proxy).
      Reste connu : telemetry = 1 instance (dette datee multi-plugin) ;
      --debug-proxy-again conserve comme chemin de test.
- [ ] 2.4 Hote VST3 — premier objectif, tranche la plus fine qui traverse
      tout : UN plugin de gain VST3 connu s'instancie dans un processus
      isole, traite de l'audio, et son bypass s'entend. Un plugin, un
      parametre, une preuve. Fenetrage, etat, decouverte des plugins :
      apres. (Regle dure : c'est le prochain morceau qui se CONSTRUIT,
      dettes non vides ou pas.)

## Court terme (sessions economes)

- [x] HYGIENE CI FAIT 2026-08-22 (S1, commits 74c61d1 + 5cc9089) :
      1. `paths-ignore: ['**.md']` sur push et pull_request, piege
         branches-protegees documente en commentaire yaml + message de
         commit. Preuve : push docs-only sans aucun run (constate a la
         cloture de S1).
      2. Cache du build tree SDK : `third_party/vst3sdk` + `engine/build`
         dans UNE archive (mtimes coherents pour ninja), cle = pin
         v3.8.1_build_84 + hash de `engine/cmake/vst3sdk.cmake` — bloc SDK
         EXTRAIT du CMakeLists expres : les editions engine (chaque session
         du chantier) n'evincent plus le cache. Runs froids reels : 11,6 et
         12 min (#50/#51) — pas 30-45. A CHAUD : 4,4 min (run #52, vert) —
         critere < ~5 min ATTEINT, cache automerge-c non necessaire.

- [ ] Verifier le hash GCC en CI (`89f1a1105dc09e92`) — regarder GitHub Actions
- [ ] Critere 5 sous charge CPU (procedure dans STATUS.md, temps machine)
- [ ] Critere 4 LNA Chrome (manuel, `--allow-origin` pret)
- [ ] Persistance de l'outbox (localStorage) — `web/src/network/server_client.ts`
- [x] Serveur : persister AVANT de diffuser — FAIT (voir 2.1 option B)
- [ ] `solo`/`mute` en `std::atomic<bool>` — domaine thread audio, tests non-regression obligatoires

## Candidats grille (constats de lecture 2026-08-22, arbitrage a l'audit 2)

- [ ] Transport a deux chemins d'ecriture : file de commandes (ring buffer)
      ET appels directs `getTransport().play()` depuis main.cpp. Un seul
      proprietaire a choisir. + Atomiques de loop "for future use" morts.
- [ ] ProcessorNode trop mince pour un hote VST3 (latence, bypass, etat,
      bus ; params string->float insuffisants ; contrat in-place non ecrit).
      A traiter DANS le chantier 2.4, pas avant.

## Moyen terme

- [ ] Moteur : lire `chain` (processeurs) du document — TODO `automerge_document.cpp:419`
- [ ] `assetHash` FNV → SHA-256 — domaine format document, verif complete
- [ ] Nettoyer `docs/DECISIONS.md` (contenu WSL obsolete)

## Stack (a evaluer, pas urgent)

- [ ] Evaluer `automerge-repo` cote serveur/web : sync + persistance + resync
      fournis, remplacerait le broadcast maison et l'anti-entropie cliente
- [ ] Risque automerge-c (epingle monorepo `47908d6c`, peu maintenu) :
      si blocage, envisager un sidecar Rust pour le CRDT du moteur
