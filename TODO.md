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
- [x] 2.3 FAIT 2026-08-22 (nuit post-jalon, en deux verdicts) :
      a. SHA-256 reel (util/sha256 autonome, vecteurs FIPS, streaming) —
         assetHash est enfin ce que SCHEMA.md pretendait ; le hash est une
         CLE DE NOM (<hash>.wav), les documents historiques FNV restent
         valides comme noms. 21/21.
      b. Le cote HTTP du triangle : store adresse par contenu sur le
         serveur (GET/PUT /assets/:hash, le PUT VERIFIE sha256(corps) ==
         cle — et cette verification a debusque des sa premiere execution
         un JUMEAU FNV oublie dans create_test_doc, soude depuis) ; le
         moteur, au miss local en mode serveur, tire l'asset du store
         (verifie, ecrit atomiquement, echecs memorises par session).
         Tests : asset_store (Rust, refuse le mensonge), asset-fetch
         (E2E : asset present SEULEMENT sur le serveur -> le moteur le
         recupere et construit le graphe). E2E 12/12.
      Le socle de « l'etat des plugins d'abord » (2.5) est pose : les
      blobs hashes hors CRDT ont leur canal.
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
- [x] 2.4d FAIT 2026-08-22 (verdict CI du push de cloture = point
      transmis) — LE BYPASS S'ENTEND, version E2E du jalon historique :
      un toggle clique DANS LE NAVIGATEUR change le son, prouve par
      echantillons, a travers AGain dans son processus (spec 'bypass
      toggle...' : seed par le contrat serveur, clic reel, re-lecture par
      le meme contrat, rendus wet/dry compares ; 10/10 E2E).
      1. getLatencySamples() = CALCUL (depth vivante x 256) sur
         ProcessorNode/ProxyNode ; AudioGraph::getLatencySamples (pire
         piste) ; la telemetrie cesse de mentir (buffer + graphe, R3).
      2. bypass = ETAT DU NOEUD dans le document (SCHEMA.md), un seul
         chemin vivant lu par les DEUX constructeurs : live = dry aligne
         dans le temps (latence conservee, pipeline chaud, pas un
         incident) ; offline = identite, zero enfant spawne. Roundtrip
         test 19, preuve au rendu test 20 (identite exacte au bit pres).
      3. Web : bouton bypass par noeud de chain (aria-pressed = etat du
         DOC, le clic demande l'inverse et l'affichage ne se pose qu'au
         retour du document) ; schema TS aligne sur la liste de paires
         (jumeau) ; structure DOM = pistes ET noeuds de chain.
      Hors perimetre reporte (dettes datees) : PDC inter-pistes
      (declencheur : premiere piste mixant sec et plugin), bypass sans
      clic en live (crossfade), fenetrage/GUI, etat plugin persiste,
      decouverte de plugins.

- [x] 2.4 Hote VST3 — LE CAP EST TENU 2026-08-22 : UN plugin de gain VST3
      (AGain) s'instancie dans un processus isole, traite de l'audio, et
      son bypass s'entend depuis un onglet — un plugin, un parametre, une
      preuve par echantillons, sur les deux OS. Ce qui reste de la
      tranche (fenetrage, etat, decouverte, plugins du commerce) se
      RE-CADRE en session dediee, conformement au cadrage.

- [ ] ARBITRAGE AUDIT-3 (2026-08-22, rapport AUDIT-3.md — lecture complete
      post-jalon, consigne le jour meme). Ordre DECIDE, avant 2.5 :
      1. [ ] LE TEST DES MAINS — REPORTE 2026-08-22 (decision utilisateur :
         produit trop embryonnaire, la boucle d'amelioration passe devant).
         Nouveau declencheur : la refonte UI livre une timeline utilisable ;
         les mains deviennent le GATE DE SORTIE de la refonte. La mission
         buffer ZenGo (256/1024/tordu, runbook item 8) et les notes-intrant
         de 2.5 restent attachees au test, seule sa date bouge. Les items
         2-4 ci-dessous ne sont PLUS bloques par lui.
      2. [ ] A3-1 FILE PARAM (prealable direct de 2.5-etat) : le canal
         param du ring n'a qu'un slot — deux setParam s'ecrasent, un
         plugin a n params perd n-1 params a chaque rebuild. File SPSC
         de paires {id, value} dans le segment, moule CommandRingBuffer.
         Session courte, test : 2 params envoyes coup sur coup, les 2
         appliques.
      3. [ ] A3-2+A3-3 CONTRAT DE PERIODE (une session) : depth clampee
         en silence a 2 (TODO promettait « buffer 1024 -> 4 blocs » —
         phrase fausse, famille des 47 runs) + bloc partiel (periode non
         multiple de 256) = bypass permanent. Remede : kRingSlots=8,
         clamp BRUYANT ou refus de demarrer, verification de periode a
         l'initialisation. La regle sort de la prose, entre dans le code.
         REPRODUCTEUR TROUVE (usage libre 2026-08-22) : le backend null
         (--mute) livre ses callbacks en rafales irregulieres -> le live
         sert massivement du DRY enfant vivant (meter sine 22,5 % =
         pre-AGain au lieu de 11,25 % wet, aucun restart) — famine du
         ring mesurable SANS device reel, CI-able pour cette session.
         + trou de telemetrie : le bilan de sortie n'imprime blocks_missed
         que pour le debug-proxy, jamais les instances document
         (main.cpp:865 et :1107).
      4. [ ] A3-4+A3-5 CRITERE 3 VRAI (une session, PROMU par arbitrage —
         touche la promesse fondatrice) : flushOutbox perd des changes si
         le socket meurt pendant le flush ET la nouveaute locale n'est
         jamais re-poussee apres merge (la reconciliation offline n'a que
         son chemin outbox-vivante). Remede : push symetrique
         Automerge.getChanges(remote, local) apres merge + requestResync
         sur echec d'applyChange. Test de garde : serveur tue PENDANT un
         flush.
      Puis 2.5 s'ouvre, sur les notes des mains, socle assaini.
      A3-6 (transport multi-producteur SPSC) attend la session transport
      (candidat grille existant, meme chantier). A3-7 (rewrite complet
      par change cote serveur, quadratique) et A3-8 (menu hygiene) restent
      dates dans AUDIT-3.md avec leurs declencheurs.

- [ ] INTRANTS 2.5 CONSIGNES (recherche mecanique profonde 2026-08-22,
      sources SDK dans docs/UI-CONVENTIONS.md) : les 5 mecaniques a
      respecter pour que etat+decouverte soient credibles — (1) deux
      blobs Comp/Cont, restauration processor-first ; (2) cle = class ID,
      jamais le chemin ; (3) scan moduleinfo.json + enfant fallback +
      blacklist persistee ; (4) flush numSamples==0 ; (5) kLatencyChanged
      = rebuild + PDC. Premier device natif a livrer : Utility/Gain
      (valide le pipeline param/etat au-dela d'AGain).

- [ ] 2.5 RE-CADRAGE POST-2.4 (session dediee, lecture + arbitrage).
      Trois conseils en entree (recus a la cloture de 2.4, a peser) :
      1. L'ETAT DES PLUGINS D'ABORD — le chainon entre AGain (un param en
         clair) et tout plugin reel (blobs opaques Ko-Mo). Decision a
         moitie ecrite depuis la tranche 1 (gros blobs HORS du CRDT, hash
         dans le document) mais jamais implementee ; sans etat persiste,
         un vrai plugin oublie tout au reload. Marche la plus proche du
         muscle existant (setState/getState VST3 + le canal 2.3 assets).
      2. LA DECOUVERTE ENSUITE — scanner les plugins installes, resoudre
         UID -> chemin PAR MACHINE (le document ne porte que des UID,
         deja acquis). Petit, controle pur ; fait passer de « AGain en
         dur » a « tes plugins ». Le registre par UID de c-2 l'a prepare.
      3. LE FENETRAGE EN DERNIER, avec mefiance — le plus visible, le
         moins prouvable (aucun test par echantillons ne verifie une
         fenetre), tentation d'options maximale (native/capturee/dockee =
         bifurcations). La verrue assumee du cadrage d'origine — fenetres
         OS flottantes — reste le bon premier choix : elle marche, elle
         est laide, elle n'hypotheque rien.
      Filtre pour chaque arbitrage : « nouveau module derriere un contrat
      existant, ou option qui dedouble un chemin ? » (regle module/switch,
      recue et verifiee sur le bypass de 2.4d).
      PREALABLE OBLIGATOIRE (ordre corrige a la cloture de 2.4) : LE TEST
      DES MAINS de l'utilisateur AVANT la session de re-cadrage — pas
      apres, pas en parallele. Ses notes brutes sont un INTRANT de
      l'arbitrage : ce que les mains trouvent (lenteur au toggle, bizarrerie
      a la relance, detail d'affichage) decide de l'ordre mieux que tout
      backlog. Mode d'emploi : docs/test-des-mains-2.4.md (stack + seed +
      la checklist de l'utilisateur impatient). La session 2.5 OUVRE sur
      ces notes.

- [ ] REFONTE UI (EN COURS, boucle outillage) : metaphore RATIFIEE
      2026-08-22 — timeline d'abord (docs/refonte-ui-preparation.md,
      section 1, intrant mains explicitement differe par decision
      utilisateur). Fait ce jour : contrat de selection (data-role/
      data-state + ARIA), jumeaux helpers/diag fusionnes, zero pixel
      change, suite e2e complete comme preuve. Reste : structure
      timeline (clips rendus, pistes vides compactes, tete de lecture),
      par petits lots dans la boucle snap/grille. GATE DE SORTIE : le
      test des mains. Les niveaux 1 constates a l'audit outillage (wrap dB,
      congestion Track 1) se dissolvent dans la refonte, pas de rapiecage.

- [ ] Dette (trouvee 2026-08-22, vraie-UI lot B) : %TEMP%\daw-engine-token
      est GLOBAL — les moteurs ephemeres des specs ecrasent le token du
      moteur interactif (pastille Engine morte en 4001 pour toute page
      neuve). Remede : fichier par port (daw-engine-token-<port>) cote
      moteur + lecture assortie cote outils. Session courte moteur+web.

- [ ] ORGANE --capture (approuve 2026-08-22, session MOTEUR bornee, cadree
      a part) : le backend null gagne --capture <wav> pour que l'oreille
      ecoute le CHEMIN LIVE (ring, famine, dry/wet) et plus seulement le
      rendu offline. Discipline du pont obligatoire : ring de capture
      SPSC au contrat (static_assert lock-free + offsetof), le callback
      ne fait que deposer, l'ecriture fichier vit hors thread sacre,
      depassement = drop compte jamais d'attente. Test au signal connu.

- [ ] Backlog Magic Potion (chantier auto-ecoute, 2026-08-22) : renommage
      d'infrastructure (depot, binaires daw_*, packages) = churn differe ;
      formats compresses au drop (mp3/flac -> decode + PUT wav) ; analyse
      spectrale ; masquage inter-pistes ; suggestions IA (acteur Automerge).

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

- [x] Verifier le hash GCC en CI — FAIT via le premier run vert (le hash est
      asserte DANS daw_engine_test, qui passe sous Linux depuis run #48)
- [ ] Critere 5 sous charge CPU (procedure dans STATUS.md, temps machine)
- [ ] Critere 4 LNA Chrome (manuel, `--allow-origin` pret)
- [x] Persistance de l'outbox — FAIT 2026-08-22 : miroir localStorage par
      onglet + ADOPTION des files orphelines a la connexion (onglet ferme
      pendant la coupure -> rejoue par le suivant ; doublon CRDT = no-op,
      chaque course penche vers le doublon jamais la perte). Spec
      `outbox-persistence` : edit hors ligne dans un onglet FERME, serveur
      relance, nouvel onglet -> l'edit arrive, cles orphelines consommees.
      E2E 11/11.
- [x] Serveur : persister AVANT de diffuser — FAIT (voir 2.1 option B)
- [x] `solo`/`mute` en `std::atomic<bool>` — FAIT 2026-08-22 (R4+S4, teste)

## Candidats grille (constats de lecture 2026-08-22, arbitrage a l'audit 2)

- [ ] Transport a deux chemins d'ecriture : file de commandes (ring buffer)
      ET appels directs `getTransport().play()` depuis main.cpp. Un seul
      proprietaire a choisir. + Atomiques de loop "for future use" morts.
      + AUDIT-3 (A3-6) : le ring de commandes est SPSC mais les callbacks
      ixwebsocket poussent depuis UN THREAD PAR CONNEXION — deux onglets
      = deux producteurs concurrents, contrat viole. Meme session : un
      proprietaire, un producteur. + UpdateGraph/SetGain/graph_ptr morts
      dans AudioCommandMessage.
- [ ] ProcessorNode trop mince pour un hote VST3 (latence, bypass, etat,
      bus ; params string->float insuffisants ; contrat in-place non ecrit).
      A traiter DANS le chantier 2.4, pas avant.

## Moyen terme

- [x] Moteur : lire `chain` du document — FAIT 2026-08-22 (2.4c-2, M3 solde)
- [x] `assetHash` FNV → SHA-256 — FAIT 2026-08-22 (2.3a, vecteurs FIPS,
      jumeau create_test_doc soude en 2.3b)
- [x] Nettoyer `docs/DECISIONS.md` — FAIT 2026-08-22 (ADR-015 WSL marque
      obsolete, collision ADR-016 resolue par renumerotation en ADR-018)

## Stack (a evaluer, pas urgent)

- [ ] Evaluer `automerge-repo` cote serveur/web : sync + persistance + resync
      fournis, remplacerait le broadcast maison et l'anti-entropie cliente
- [ ] Risque automerge-c (epingle monorepo `47908d6c`, peu maintenu) :
      si blocage, envisager un sidecar Rust pour le CRDT du moteur
