# TODO

## LE PROGRAMME (arbitrage utilisateur 2026-08-23, plan approuve —
## AMENDE le gel d'ADR-019 : l'entrelacement est ratifie)

Ordre grave : VAGUE 1 (habitabilite, 6 sessions : V1.1 boucle+arret,
V1.2 master, V1.3 undo/redo, V1.4 session C visible, V1.5 session D
devices+eviction A4-5, V1.6 fades) -> ENTRELACS DIFFERENCIATEUR
(critere-3-vrai A4-1/2/3, placement+clips-MIDI co-designes, 2.5-etat,
STEMS S7, streaming) -> VAGUE 2 TEMPO (cadrage puis migration) ->
VAGUE 3 MIDI+instruments (Surge XT) -> VAGUE 4 studio (automation,
sends/groupes, enregistrement+comping, warp APRES recherche de
determinisme). Hors programme : Session View, macros, M4L, alea sans
seed, VST2, mobile. Details : plan approuve du 2026-08-23 (designs
challenges : wrap sample-accurate par sous-bloc, master dans
AudioGraph::process, undo par descripteurs types + groupes).

## TRANCHE 3 — LE DIFFERENCIATEUR (ADR-019, recadrage 2026-08-23)

L'invariant : un pair sans le plugin entend le resultat du plugin.
Constat du recadrage : zero ligne, zero concept dans le depot — tout ce
qui suit le construit. Arbitrage utilisateur : stems ET streaming, tous
deux de premiere classe dans la tranche (stems = verite de lecture,
streaming = canal ephemere du jam ; deux fonctions, pas un chemin
dedouble). Ordre :

0. [x] TEST LNA CHROME — FAIT 2026-08-23, le jour meme du recadrage :
       L'HYPOTHESE PORTEUSE TIENT. Invite Chrome apparue, autorisee ->
       WS connecte depuis une page HTTPS publique (trycloudflare) au
       moteur local (--allow-origin requis, prevu pour ca). Canari
       fetch non conclusif (400 sans CORS = « Failed to fetch » meme
       quand le reseau passe — defaut de la page de test). RESTE
       (session courte, 30 s de mains) : comportement au refus,
       memorisation, annulation ; + logguer les connexions acceptees
       cote moteur (le log etait muet pendant la preuve).
1. [x] CRITERE 3 VRAIMENT VRAI — FAIT 2026-08-23 (ouverture de
       l'entrelacs, meme soir que la cloture vague 1). A4-1 refus
       bruyant serveur (get_missing_deps apres load_incremental,
       jamais broadcast sans persist reel), A4-2 getMissingDeps cote
       JS -> applyChange false -> resync, A4-3 GRAINE COMMUNE VENDORED
       (make-seed.mjs, octets identiques web/serveur, premier contact
       = merge+push, plus de load destructeur, demarrage sans serveur
       editable), A4-1c fermeture sur echec de save initial, A4-4
       heartbeat 'hb' 15 s + watchdog 45 s onglet. Gardes : cargo test
       7/7, sync-resilience.spec (3 invariants dont serveur-demarre-
       apres). Reserve critere 3 (2 onglets) levee dans STATUS.
       LIMITE ECRITE : un VIEUX projet (racine pre-graine) ne merge
       pas des editions faites hors-ligne avant premier contact (deux
       racines etrangeres) — s'applique aux projets nes apres.
       DECOUVERTE de la garde : les vieux docs (default.am) portent
       des deps manquantes PERMANENTES (cicatrices ere A4-1) -> le
       refus se mesure en DELTA (un change qui en AJOUTE), jamais en
       absolu (boucle de resync infinie sinon) ; auto-guerison au
       premier contact (la graine poussee une fois, adoptee).
0pre. [~] ARBITRAGE POST-SEANCE-MUSIQUE (2026-08-23, compte-rendu de la
       premiere seance utilisateur complete — 203 clips, AGain, rendu
       48 s). ORDRE RE-ARBITRE 2026-08-23 (2e passe utilisateur) :
       A -> B -> 1pre -> 1bis, PUIS C et D. Raison ecrite : ni C ni D
       ne rapprochent deux machines l'une de l'autre, et le smoke
       apprendra des choses qui touchent au modele — a connaitre AVANT
       de coder duplicate.
       A. [x] EAR-VERITE — FAIT 2026-08-23 : l'oreille avait dit VERT sur
          48 s de silence total. Deux corrections : ear resout les
          assets depuis le STORE du serveur (aujourd'hui il ne lit que
          engine/test-assets -> tout projet fait d'assets droppes rend
          muet) ; et silence integral = ROUGE PAR PRINCIPE (garde-fou
          au self-test CI). Un outil de preuve qui valide du vide
          invalide retroactivement ses verdicts. FAIT : staging par
          hash depuis server/assets (fallback test-assets, manquant =
          refus bruyant) + self-test 6 (silence rouge, piece eparse
          verte). Preuve : ma-piece muet-vert -> son-vert, copies de
          contournement retirees avant preuve. CI verte (run
          32641506712, commit adbd7a0).
       B. [x] SUPPRESSION DE CLIP + ETAT DE SELECTION — FAIT
          2026-08-23. Cause trouvee : un clic SANS mouvement sur une
          poignee de bord ne selectionnait RIEN (branche absente dans
          beginClipResize) — et un clip minuscule (hat 0,07 s = 1,4 px)
          est ENTIEREMENT couvert par ses poignees : selection
          impossible, Suppr inerte, silencieux. Correctifs : clic sur
          poignee = selection (symetrique du bandeau) ; deselection au
          clic-couloir re-rend (le visuel ne ment plus, A4-18 solde) ;
          halo de selection lisible a toute largeur (2 px l'etait pas).
          Garde : clip-selection.spec (5 invariants : selection bandeau,
          selection poignee, deselection visible, Delete agit DOM+doc,
          Delete sans selection = no-op heads stables). Suite 16/16.
          Trace visuelle livree (halo prouve sur un clip de 2 px).
       C. [ ] RENDRE VISIBLE (perimetre FINAL arbitre 2026-08-23,
          3e passe — session UNIQUE et BORNEE, APRES 1pre et 1bis,
          pas avant). Constat acte : le DAW est plus capable qu'on ne
          le croyait (16 capacites cachees, JOURNAL), rien n'en est
          visible. Contenu, dans l'ordre de valeur :
          1. DESSINER LA GRILLE DE SNAP, y compris son raffinement au
             zoom — une regle invisible et variable est pire que pas
             de regle.
          2. RENDRE VISIBLES LES TROIS EFFETS du clic de couloir
             (selection piste + marqueur d'insertion + pause Follow) —
             pas de la decouvrabilite : un effet de bord non annonce,
             la cause du « logiciel qui agit tout seul ».
          3. LEGENDER les quatre glyphes nus (⇥, A, B, C) + une aide
             raccourcis (?) listant les huit touches.
          TOUT LE RESTE de l'inventaire ATTEND. Pas de refonte d'UI,
          pas de lecture Ableton : les capacites existent, il s'agit
          de les montrer.
       D. [x] AJOUTER/RETIRER UN DEVICE DEPUIS L'UI — FAIT 2026-08-23
          (V1.5). Bouton `+ device` (builtin.gain | vst3 par uid valide
          ^[0-9A-Fa-f]{32}$, AGain pre-rempli), retrait ARME en deux
          clics (clavier-safe, pas de dialog bloquant), les deux
          journalises undo (l'inverse d'un retrait re-insere le
          ProcessorDef COMPLET a son index — l'ordre d'une chaine est
          un sens). ET l'eviction A4-5 moteur : au rebuild, les enfants
          dont le node_id a quitte le document sont stop()+evinces —
          DIFFEREE jusqu'a vidage de la file des graphes retires (un
          ProxyNode retire lit encore le ring : evincer avant la
          barriere generationnelle = use-after-free), telemetrie
          re-cablee (pointeurs bruts vers le handle detruit).
          Gardes : devices.spec (5 invariants dont convergence 2
          onglets et undo-restaure-l'ordre), gtest testRegistryEviction
          (2 evinces, survivant a la MEME adresse, idempotent).
          Bug attrape par la spec : display:flex ecrasait [hidden] —
          le menu invisible-cense interceptait tous les clics.
       Le reste de la liste ATTEND (renommage, tempo — la grille, le
       master meter et les FADES sont FAITS : V1.4, V1.2, V1.6).
       FADES DEGELES ET LIVRES 2026-08-23 (V1.6) : implicite 4 ms
       inconditionnel (equivalence silence-rampe = identite), champs
       fadeIn/fadeOutSamples additifs, poignees UI journalisees undo,
       NOUVEAU HASH DE REFERENCE 56729beb61993cd7 (DECISIONS.md).
       VAGUE 1 COMPLETE : V1.1 boucle/arret, V1.2 master, V1.3 undo,
       V1.4 visibilite, V1.5 devices+eviction, V1.6 fades. Prochain
       cap grave : ENTRELACS (critere-3-vrai A4-1/2/3 + heartbeat
       FAIT, puis design placement SCHEMA v2 avec clips MIDI
       co-designes — DOSSIER ECRIT docs/SCHEMA-V2-DESIGN.md, statut
       PROPOSITION a ratifier : cle de stem cache-d'entrees, stem par
       DERNIER noeud vst3 de la chaine (raffinement par-noeud = dette),
       PDC declaree (stemLatencySamples), etat plugin stateHash +
       stateVersion LWW hors CRDT, notes MIDI en map a ids stables ;
       tout ADDITIF, migrate() reste vierge jusqu'au tempo).
1pre. [x] MECANISME DE LIVRAISON DU TOKEN — FAIT 2026-08-23 (etage
       dev, suffisant pour 1bis ou chaque machine porte sa stack) :
       resolution FRAGMENT (#token, lancements moteur/daw.ps1) ->
       query (legacy) -> endpoint local /api/engine-token (vite
       middleware lit %TEMP%, la page ne peut pas ; pas de CORS =
       illisible cross-origine, LNA par-dessus). REGLE 4001 CABLEE :
       token refuse -> re-fetch + UNE retentative silencieuse (marche
       apres un RESTART moteur reel, sans recharger l'onglet). Garde :
       token-zero-paste.spec (2 invariants : pastille verte sans aucun
       token dans l'URL ; recovery 4001 apres kill+restart moteur).
       RESTE (production, quand le site sera distant — date, pas
       bloquant pour 1bis) : le moteur sert le token lui-meme
       (Origin-gate) OU lancement-fragment seul ; consigne ADR-019.
       (item d'origine : a trancher AVANT 1bis —
       decouvert par le 4001 accidentel du harnais LNA 2026-08-23) :
       une page servie d'un domaine distant ne peut pas lire
       %TEMP%\daw-engine-token-<port>. Option de tete (reviewer
       2026-08-23) : le moteur ouvre le navigateur avec le token en
       FRAGMENT d'URL (#token=..., JAMAIS en query : la query part
       dans les logs du tunnel, l'historique et le Referer — le
       fragment ne quitte jamais le navigateur). Alternatives a peser :
       endpoint local servi par le moteur apres permission LNA ;
       handler de protocole. Bloque « j'allume mon
       ordi, je vais sur mon site » ; sur deux machines le probleme est
       double. + REGLE gravee : close 4001 (token perime, ex. moteur
       redemarre) -> l'onglet re-recupere le token et retente UNE fois,
       sans rien demander a l'humain (signature distincte de 1006,
       prouvee). + Onboarding non destructif : permissions.query
       ('local-network-access'/'local-network', Chrome 151) lisible ->
       etape guidee AVANT toute tentative, jamais d'invite surprise ;
       feature-detection OBLIGATOIRE (les deux noms + le chemin
       TypeError : Firefox/Safari sans API = heuristique de secours).
1bis. [x] SMOKE DEUX MACHINES — TENU 2026-08-23, LES DEUX SENS :
       fixe (192.168.1.x) et portable TX15 (hotspot telephone 10.102.x),
       UN serveur (fixe, loopback + tunnel cloudflared), relais ws->wss
       cote portable. ALLER : WAV depose cote fixe (16:07:26 UTC) ->
       clip+asset recus par le MOTEUR du portable (asset 698e95 ecrit
       sur son disque). RETOUR : asset+clip emis du portable
       (16:32:23 UTC, PUT 201 a travers le tunnel) -> mon moteur a
       fetch b890b1 et rebuild (log v=4). Trace : traces/smoke/.
       Reserves honnetes : geste retour = niveau document (pas un drag
       UI) ; verification portable par SSH (processus+fichier disque),
       ecran portable vu par son agent local. Frictions moissonnees :
       moteur sans --assets ecrit les assets fetches dans le CWD
       (build-msvc pollue, les 2 cotes) ; script retour crashe sur le
       broadcast (load d'un change comme doc — outil jetable) ; la
       lecture ne s'arrete jamais (57 min au compteur). (item d'origine :
       ne pas re-commettre l'erreur qu'on vient de corriger — valider
       l'hypothese qui porte tout AVANT de construire dessus) : deux
       ordinateurs, deux reseaux, un projet, un WAV depose, convergence
       observee. Pas le critere complet, pas les VST, pas les stems —
       une heure. Fait tomber les surprises identite/NAT/decouverte du
       serveur pendant que 2-3-4 sont encore modifiables, et verifie
       que le trio deps-manquantes est vraiment regle.
2. [ ] DESIGN DU PLACEMENT (session dediee, SCHEMA v2) : chaque noeud
       declare quel pair l'heberge, negocie par capacite ; reprise
       quand le pair hebergeur part. AVANT toute nouvelle ligne de
       timeline. Le design seul — l'implementation suit les fondations.
       INTRANTS GRAVES (amendement ADR-019) : cle de stem = cle de
       cache d'ENTREES (version/build plugin + samplerate DANS la cle,
       jamais d'assertion de re-rendu bit-exact d'un plugin tiers) ;
       stem perime = etat d'UI ; un stem survit a son producteur
       (invariant) ; PDC cuite ou declaree ; B controle les params
       exposes via CRDT, la GUI et le binaire ne traversent JAMAIS.
3. [ ] 2.5-ETAT REQUALIFIE PREREQUIS : l'etat persiste des plugins
       (blobs Comp/Cont, canal assets) entre dans la CLE de stem
       (hash = entree + uid + etat + plage) — il precede le jalon
       stems. (Decouverte et fenetrage restent derriere.)
4. [ ] JALON STEMS PARTAGES : A rend la sortie de sa chaine VST, la
       pousse au store (PUT verifiant existant), B la tire et la joue.
       Preuve de l'invariant PAR ECHANTILLONS a travers le store.
       Re-rendu sur changement de hash (bouton tourne -> stem re-rendu
       -> B re-tire).
5. [ ] CANAL STREAMING JAM (meme tranche, apres le premier jalon
       stems) : P2P WebRTC/UDP, signaling par le serveur, jamais dans
       le document (meme logique que la telemetrie). PERIMETRE REFUSE
       (ADR-019) : monitoring d'instrument a latence de jeu via un VST
       distant — physiquement injouable, ne pas re-litiger.
6. [ ] CRITERE 3 NOUVELLE DEFINITION : deux machines, deux reseaux, un
       projet — E2E reel (le serveur gagne au passage son avenir
       explicite : identites, projets heberges, invitations, signaling
       — etat provisoire assume, plus une loi de design).

7. [ ] L'INSTRUMENT JOUABLE (avis reviewer consigne 2026-08-23 —
       APRES 1bis, jamais avant : ne rapproche pas l'invariant).
       Le raccourci qui decoule d'ADR-002 : jouer des notes en direct =
       PERFORMANCE, pas document — note-on/note-off sur le canal WS
       moteur existant (meme sang que bypass/solo/transport), zero
       CRDT, zero clip MIDI. Demo « j'ouvre le site, je clique, un
       synthe natif sonne ». Prerequis deja dans la tranche : D
       (bouton device), 2.5-etat, decouverte ; manque propre a lui :
       config de bus INSTRUMENT (l'hote ne sait faire que des effets),
       et les events note dans le ring (couvert si la file A3-1 est
       GENERIQUE — voir note ordre 3). REFUS ECRIT : VST2 (Massive
       classique) — hote VST3 exclusif, SDK VST2 plus distribue ;
       banc d'essai : synthe VST3 libre (Surge XT, GPL comme nous ;
       Dexed). La GUI du plugin = fenetre native a cote du navigateur,
       choix de design a trancher a ce moment-la.
       LES CLIPS MIDI DANS LE DOCUMENT (notes persistantes, editables,
       convergentes) = l'autre moitie, un VRAI morceau de schema : se
       pense AVEC la session placement (SCHEMA v2, item 2 ci-dessus),
       pas apres — sinon on dessine deux fois.

Les ordres AUDIT-4 items 3-4 (ring, cycle de vie enfants) restent des
fondations de l'hote que les stems rendront ; items 5-6 inchanges.

## ROADMAP POST-MANUEL ABLETON — **GELEE (ADR-019)** : les items 3 a 8
## ci-dessous ne demarrent pas tant que placement + stems + critere 3
## deux-machines ne sont pas verts. Raison ecrite : la parite d'abord =
## un DAW mono-utilisateur mediocre et un distribue impossible a
## retro-installer. (2026-08-22 — lecture integrale, synthese dans
## docs/ABLETON-INTEGRALE.md ; les designs CRDT y sont acquis)

Ordre grave (la confiance avant le sucre, arbitrage confirme) :

0. [~] SECURITE (S1+S2 FAIT: Origin local-first, cap WS, token CSPRNG+constant-time, garde size_t, WAV borne, clamp+cssES cote web ; RESTE H3 fichiers+O_EXCL, M4 token-URL, parse hors-verrou) (SECURITY.md)
       C1 path traversal [FAIT] ; puis C2 (auth serveur + CORS strict),
       H1 (CSPRNG token moteur + compare constant-time), H2 (cap taille WS
       + parse borne hors verrou), H3 (fichiers owner-only + O_EXCL),
       M2/M3/M5 (garde 32-bit, parseur WAV borne, clamp doc cote web).
1. [x] CONFIANCE — critere 3 vrai FAIT (push anti-entropie, 282b030).
       Reste : file param multi-slots (A3-1) puis contrat de periode
       (A3-2/A3-3).
2. [ ] 2.5 ETAT+DECOUVERTE, enrichi par le manuel : blobs Comp/Cont par
       instance DANS le document (regle de verite : blobs gagnent,
       param-list = projection UI) ; scan moduleinfo.json + blacklist au
       2e crash par class-uid ; exposedParams par instance (Configure
       Mode) ; champ deactivated distinct de bypass (0-CPU vs dry a
       latence constante) ; Utility natif (perimetre fini consigne).
3. [ ] LES GAINS PROCHES (sessions courtes, ordre de valeur) :
       a. fades/crossfades 4 ms anti-clic (fadeIn/Out/curve sur clip +
          rampe moteur) — solde la dette crossfade de 2.4d ;
       b. slide-du-contenu (offsetSamples, pur geste) + selection de
          temps + split/consolidate ;
       c. clip.gainDb + clip.pitchCents ; track.pan constant-power ;
       d. nudge, count-in.
4. [ ] AUTOMATION (la grande couche) : lanes en point-maps a ids stables
       (design complet dans ABLETON-INTEGRALE §4), override ephemere par
       utilisateur, moteur breakpoints -> IParameterChanges. Les
       enveloppes de clip (abs/mod) suivent, pipeline prevu des le debut.
5. [ ] SENDS/RETOURS + GROUPES (+ sidechain=resampling : routage a 3
       prises, un champ input:{sourceTrackId, tap}).
6. [ ] TEMPO — LA migration (double timestamp secondes<->beats, tempo
       LWW-register facon Link, signature = evenements) : ouvre metronome,
       grilles metriques, grooves. Session de cadrage dediee AVANT.
7. [ ] LES DEPASSEMENTS (ou notre architecture bat l'original) :
       undo per-acteur persistant navigable (historique Automerge) ;
       freeze = cache de rendu prouvable par hash ; export/stems
       (2 passes queues, part-des-retours).
8. [ ] FUTURS NOMMES : enregistrement + take-lanes-vues (comping CRDT),
       vue de jam collaborative (Session repensee sur etat de presence,
       jamais dans Automerge), Follow Actions avec seed.
REFUS ECRITS : macros/racks (indirection non arbitrable par CRDT), M4L
(fichiers externes mutables), alea sans seed, etat de performance dans le
document. Voir ABLETON-INTEGRALE §5.

## Tranche 2 — HOTE VST3 (le cap)

La demo que ni Soundtrap ni BandLab ne peuvent copier : un plugin natif
pilote depuis un onglet. Sous-etapes de soutien, dans l'ordre :

- [x] 2.1 ESCALADE 2026-08-21 : support Rust d'automerge-repo immature
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
- [x] 2.2 FAIT 2026-08-22 — VERDICT A (voir docs/DECISIONS.md): taille quasi
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
- [x] 2.3bis AUDIT A FROID — FAIT 2026-08-21 (rapport AUDIT-2.md ;
      case restee ouverte par oubli, cochee a la session 1 post-AUDIT-4).
      Question directrice : qu'est-ce qui va ceder quand le VST3 va
      s'appuyer dessus ? Reponses arbitrees dans PREALABLES 2.4.
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
         appliques. DECISION D'ENTREE (2026-08-23, instrument jouable
         en vue) : la file est GENERIQUE — evenements {type, id, value}
         (type: param aujourd'hui, note-on/off demain) — pour que les
         notes de l'instrument s'y branchent sans re-bump de layout.
      3. [ ] A3-2+A3-3 CONTRAT DE PERIODE (une session) : depth clampee
         en silence a 2 (TODO promettait « buffer 1024 -> 4 blocs » —
         phrase fausse, famille des 47 runs) + bloc partiel (periode non
         multiple de 256) = bypass permanent. Remede : kRingSlots=8,
         clamp BRUYANT ou refus de demarrer, verification de periode a
         l'initialisation. La regle sort de la prose, entre dans le code.
         ELARGIE PAR AUDIT-4 (2026-08-23) : la meme session absorbe
         A4-5 (seq PAR SLOT de sortie — un bloc saute par l'enfant fait
         rejouer un slot perime, ni dry ni compte) et grave l'invariant
         input-dechire dans shared_audio_ring.h. Meme segment, meme
         bump de layout, une seule session.
         REPRODUCTEUR TROUVE (usage libre 2026-08-22) : le backend null
         (--mute) livre ses callbacks en rafales irregulieres -> le live
         sert massivement du DRY enfant vivant (meter sine 22,5 % =
         pre-AGain au lieu de 11,25 % wet, aucun restart) — famine du
         ring mesurable SANS device reel, CI-able pour cette session.
         + trou de telemetrie : le bilan de sortie n'imprime blocks_missed
         que pour le debug-proxy, jamais les instances document
         (main.cpp:865 et :1107).
      4. [x] A3-4+A3-5 CRITERE 3 VRAI — FAIT 2026-08-22 : push symetrique
         getMissingChanges(remote) -> sendChange a chaque reconnexion
         (en ordre causal), flushOutbox non-destructif (ceinture),
         requestResync sur echec d'applyChange, commentaire anti-entropie
         menteur corrige (A3-8.1 solde). Garde : criterion3-push.spec —
         le flush avale est REPRODUIT exactement (change consomme jamais
         envoye), serveur redemarre, le push le ramene (vert du premier
         coup). Suite 15/15. STATUS : critere 3 reserve LEVEE.
      Puis 2.5 s'ouvre, sur les notes des mains, socle assaini.
      A3-6 (transport multi-producteur SPSC) attend la session transport
      (candidat grille existant, meme chantier). A3-7 (rewrite complet
      par change cote serveur, quadratique) et A3-8 (menu hygiene) restent
      dates dans AUDIT-3.md avec leurs declencheurs.

- [ ] ARBITRAGE AUDIT-4 (2026-08-23, rapport AUDIT-4.md — quatrieme
      audit lecture seule : 3 passes paralleles moteur/serveur/web +
      critique de fond des .md). Ordre DECIDE (utilisateur, meme jour) :
      1. [x] PASSE « DOCUMENTS QUI DISENT VRAI » — FAIT 2026-08-23 :
         21/21 partout, token par port dans les procedures (STATUS +
         test-des-mains repare), port 9000 purge, dettes soldees cochees
         (token global, 2.3bis), README verite (Quick Start reel via
         daw.ps1/CI, structure, CLI ref complete), ADR-005 corrige
         (ixwebsocket), en-tete websocket_server.h (LNA fantome retire).
         Les 4 FUSIONS structurelles ARBITREES OUI et appliquees :
         STATUS scinde (JOURNAL.md cree, STATUS = etat court),
         DECISIONS racine fusionne dans docs/DECISIONS.md (registre
         unique), BACKLOG fusionne ici (liste unique), CLAUDE.md renvoie
         a STATUS au lieu de dupliquer criteres et liste de specs.
      2. [ ] « CRITERE 3 VRAIMENT VRAI, ROUND 2 » (A4-1+A4-2+A4-3,
         + A4-4/A4-1c) : Automerge bufferise les changes a deps
         manquantes SANS erreur des deux cotes — le serveur jette et
         broadcast quand meme, le client ne resync jamais sur le cas
         principal, et tout ce qui est edite avant le premier contact
         serveur est perdu. + heartbeat serveur->clients (socket zombie
         cote onglet). Tests de garde : scenario Lagged reproduit,
         demarrage serveur eteint. STATUS : reserve critere 3 ROUVERTE
         en attendant.
      3. [ ] SESSION RING ELARGIE = l'item A3-2+A3-3 ci-dessus, qui
         absorbe A4-5 (voir la note ELARGIE PAR AUDIT-4 dans l'item).
      4. [ ] CYCLE DE VIE ENFANTS + BOUCLE DE CONTROLE (A4-6 eviction
         du registre — enfant zombie 100 % CPU au retrait d'un noeud ;
         A4-7 fetch d'asset et spawn/restart deportes hors de la boucle
         de controle — gels 10-120 s, Ctrl+C inoperant). Avant 2.5.
      5. [ ] CONVERGENCE VISIBLE DES CLIPS (A4-9) dans la boucle
         refonte UI : sameStructure ignore la geometrie -> les
         deplacements distants ne se redessinent jamais dans l'autre
         onglet ; spec clip-drag a ancrer sur le DOM de l'onglet B.
      6. [ ] DETTES DATEES AUDIT-4 : A4-8 (validation document
         inoperante — zone format, refonte planifiee), A4-10 (lissage
         gain mort de fait), A4-11 (ids Date.now vs UUID), A4-12
         (32 bits INT_MIN), A4-13..A4-19 (menus moteur/serveur/scripts/
         code mort/hygiene web/discipline de test) — declencheurs dans
         AUDIT-4.md.

- [~] 2.5-ETAT EN COURS — session A FAITE 2026-08-23 (l'etat traverse
      la frontiere de process) : ring v4 (state_request/ready_seq),
      blob par fichier `<segment>.state` (format partage state_file.h),
      restauration a la ceremonie processor-first, bridge
      setPendingState/saveState, garde testPluginStateRoundtrip (12
      octets AGain, 0.25x exact depuis l'etat seul, bit-stable).
      SESSION B (la suivante) : stateHash/stateVersion dans le
      document (SCHEMA-V2-DESIGN §2), blob pousse au store
      contenu-adresse, capture debounce apres geste, restauration au
      rebuild via setPendingState — et la MANIP : tweaker AGain,
      tuer l'enfant, le reglage survit et converge vers l'autre pair.

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

- [x] Dette token global — FAIT 2026-08-22 (fichier par port
      daw-engine-token-<port> cote moteur, websocket_server.cpp:488,
      lecture assortie daw.ps1/ui-drive/ui-snap ; consigne dans
      AMELIORATIONS « Token par port », case restee ouverte par oubli,
      cochee a la session 1 post-AUDIT-4).

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

- [ ] Backlog hors cap (fusion BACKLOG.md, 2026-08-23 — une seule liste
      d'idees desormais ; l'ancien preambule cadrait sur le cap VST3,
      tenu depuis le 2026-08-22) :
      - Moteur WASM : ecarte — direction Soundtrap/BandLab, l'inverse du
        differenciateur. Peut-etre un jour comme mode invite
        lecture/commentaire.
      - Sortir automerge-c du moteur (sidecar Rust) : decision
        d'architecture, pas une optimisation. Pas sans dossier complet.
      - Presence ephemere (curseurs, qui tient quel fader, transport
        partage) : tranche 3+, canal hors CRDT (meme logique que
        solo/mute).
      - IA comme acteur Automerge (actorId propre, mode suggestion) :
        tranche 3+ (recouvre l'entree du Backlog Magic Potion ci-dessus).
      - Undo par utilisateur : probleme dur du CRDT musical, a scoper tot
        mais pas maintenant (voir aussi roadmap item 7, les depassements).
      - Identites (actorId <-> compte) : prerequis presence/IA, tranche 3+.
      - Discord : integrer (Rich Presence, webhook), jamais construire.
        Tranche 3+.
      - VCV Rack en natif (note 2026-08-23, sans l'ouvrir) : open
        source, installable par tous -> terrain d'essai ideal pour le
        partage de chaine. APRES l'invariant, pas avant ; pour tester
        le differenciateur, un VST3 gratuit quelconque suffit.

- [ ] COHERENCE (audit 2026-08-22) — split-rule et jumeaux restants :
      a. [x] buildGraph : noyau partage (makeClipPlayer/makeGainNode dans
         graph/graph_common) FAIT 2026-08-22 ; instanciation plugins
         volontairement divergente (live/offline). Hash inchange 89f1a1.
      b. splitter main.cpp (1155), automerge_document.cpp (829),
         plugin_host_main.cpp (663), websocket_server.cpp (481),
         app/wiring.ts (432), ui-drive.mjs, track.ts (regle module) ;
      c. dette morte a exciser avec la session transport-owner :
         AudioCommand::UpdateGraph/SetGain + graph_ptr, TransportState
         loop_* atomics, CLI --solo/--mute-track (jumeau de SetMonitor),
         AutomergeDocument::generate/receiveSyncMessage (stubs) ;
      d. SCHEMA.md : engine schema.h utilise std::map pour params alors
         que SCHEMA dit LISTE {key,value} (ordre perdu) — aligner sur
         vector<pair> ou adoucir le doc ;
      e. npm scripts manquants (drive/signals/kit/seed), gitignore
         web/playwright-report/, messages.ts marque GENERE dans CLAUDE.md.
      FAIT ce jour : proto/engine.proto (jumeau divergent) supprime ;
      updateMeter + parseTime (exports morts) supprimes ; README verite
      (.am, SHA-256, make test, licence, triangle, VST3).
- [ ] Moteur : exit 9 silencieux a l'arret observe DEUX fois (backend
      WASAPI, position figee puis mort sans log). Instrumenter la sortie
      du callback/device pour capturer la cause avant de corriger.

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
