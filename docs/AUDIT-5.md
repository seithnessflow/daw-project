# AUDIT-5 — Harmonisation & santé transversale

*Session d'audit dédiée, lecture seule, 2026-08-25. HEAD = f5a8a51.
Méthode : six lectures parallèles (moteur C++, serveur Rust, web TS,
contrats inter-étages, sécurité, perf/stabilité/pérennité) + une revue
externe relayée. Ce fichier est le RAPPORT ; l'arbitrage par la grille
est proposé, pas exécuté. Aucune ligne de code n'a été modifiée.*

## Le titre de l'audit

**L'invariant produit est marqué VERT alors qu'il n'est prouvé que sur
le plugin le plus trivial (AGain : latence nulle, état minuscule,
déterministe, sans GUI).** C'est exactement l'avertissement de la revue
externe déjà consigné (« quatre endroits où le premier vrai plugin
cassera »). Trois de ces quatre endroits sont maintenant localisés dans
le code (clé de stem, livraison moteur, arbitrage d'écrivain). Cette
trouvaille change la lecture de tout le reste : la preuve n'est pas
fausse, elle est incomplète, et les mécanismes qui la porteraient sur un
vrai plugin ont des défauts de correctness, pas de la dette.

Le socle est solide LÀ OÙ le contrat est verrouillé par la compilation
(thread audio sacré : zéro alloc/verrou/syscall, static_asserts réels ;
ring binaire = 19 asserts d'offset sur deux TU ; fix crash 0xe06d7363
propre ; auth WS CSPRNG + temps constant ; graine commune vérifiée
byte-identique). Il est fragile PARTOUT où le contrat vit dans un
commentaire.

---

## Famille A — Le son est FAUX (correctness, priorité absolue)

| # | Trouvaille | Sév | Preuve |
|---|---|---|---|
| A1 | int/f64 à moitié traité : `schemaVersion`/`sampleRate` lus par `AMitemToUint` STRICT, mais le seed les stocke en `int` → tout doc produit lu au fallback 48 kHz en silence ; garde migration v2 morte côté moteur | **1** | `automerge_document.cpp:302,313` ; seed `int` vérifié ; helper `itemToDouble:22-35` existe, non appliqué. Classe ouverte aussi sur `startSample`/`lengthSamples`/`offsetSamples`/fades. Seul test = tautologique (`cli_integration_test.cpp:166`) |
| A2 | Clé de stem : `ostringstream` défaut (6 chiffres signif.) sur un `float` déjà tronqué → deux valeurs de knob différentes = MÊME clé → stem périmé déclaré frais → pair sans plugin entend le mauvais rendu, BADGE VERT | **1** | `stem_render.cpp:56,68-69` ; test fraîcheur `main.cpp:1349` ; lecture `graph_common.cpp:62-89` |
| A3 | Pas d'arbitrage d'écrivain : deux machines avec le même plugin (installs différant d'1 octet → `moduleVersionTag` ≠) republient un WAV multi-Mo en boucle, frein = debounce 1 s | **1** | `main.cpp:1342-1344,1349,1526-1537` ; `SCHEMA.md:7-13` NIE que ce soit shippé |
| A4 | Le moteur est le SEUL étage sans garantie de livraison — et le SEUL auteur de `stemHash`/`stateHash`. `sendChange` silencieux si déconnecté ; `setDocumentCallback` = REPLACE (l'inverse de la doctrine merge). Serveur refuse un change → log+continue, pas de NACK → stem « settled » jamais republié | **1** | moteur `server_client.cpp:137-144` ; `main.cpp:1114,1322,1376` ; serveur `websocket.rs:186-189` |
| A5 | PDC LIVE inexistant : latence déclarée partout (ring v7, télémétrie) mais AUCUN code n'aligne les pistes dans `AudioGraph::process`. Drive (16 samples) + piste sèche = désalignés en live | **1** | moteur `audio_graph.cpp` (aucun retard appliqué) ; seule compensation réelle = stems (`graph_common.cpp:73-81`) |
| A6 | Période device ≠ multiple de 256 → ~47 % de l'audio bypasse le plugin, silencieux, UI dit « plugin late ». Cas WASAPI shared mode (480 fr) | **1** | `audio_device.cpp:156` (pas de validation) ; `audio_callback.cpp:124-128` ; `proxy_node.cpp:13-21` ; depth sous-provisionnée `main.cpp:892` |
| A7 | Aucune conversion de sample rate NULLE PART. WAV 44,1 kHz joue à 48 kHz = +8,8 % pitch + dérive. Chaque import 44,1k d'un vrai user est faux | **1** | `clip_player.cpp:37,148-167` (`sample_rate` servi seulement à `isValid()`) ; `graph_common.cpp:22` (doc rate ≠ device rate, jamais comparés) |
| A8 | Playhead web câblée sur 48000 en dur (jamais assignée) ; le sample rate moteur ne traverse pas le fil → dérive 8,8 % sur device 44,1k | 2 | `engine_client.ts:37` ; `jam_audio.ts:30` ; proto `messages.proto:41-44` |

A2+A3+A4 touchent directement le cœur du différenciateur (la tranche stems). A6+A7 sont « faux dès le premier user ».

---

## Famille B — Sécurité

| # | Trouvaille | Sév | Preuve |
|---|---|---|---|
| B1 | **CRITIQUE, LIVE à chaque tunnel** : serveur Rust SANS auth ; `cloudflared tunnel --url http://localhost:3000` (procédure deux-machines) le publie sur Internet. Lecture projet complet, écriture de changes appliqués par le moteur sans validation, R/W du store, JOIN jam = écoute du master. SECURITY.md le classe « futur » — FAUX, c'est live | **Crit** | `main.rs:52-64` ; `origin.rs:36` (Origin absent → true) ; `docs/deux-machines.md:75` |
| B2 | Relais signal verbatim + identité `from` auto-déclarée : JOIN vide forgé → diffuseur répond avec flux master + IP réelles via ICE ; `bye`/`ta:`/`sf:` forgés = DoS jam / contrôle transport d'un pair / badge fraîcheur ment par commission | Haute | `websocket.rs:213-232` ; `jam.ts:166-217` ; `transport_sync.ts:91-127` |
| B3 | `dr_libs` épinglé sur `master` (branche mouvante) = parseur de chaque WAV qu'un pair dépose + feed le hash de rendu déterministe. Seul dep non épinglé. **Fix 5 min : SHA `b55a0d9a`** | Haute | `engine/CMakeLists.txt:35-37` |
| B4 | `?server=` non validé + outbox non scopé au serveur = un lien exfiltre les changes en file | Moy | `context.ts:21-30` ; `server_client.ts:226-228` |
| B5 | Moteur colle `assetHash`/`stateHash`/`node_id` du document dans des chemins fichier sans validation hex → traversal read ; write si serveur hostile (`stem-<node_id>.tmp.wav`) | Moy | `graph_common.cpp:32,65` ; `main.cpp:489,592` ; `stem_render.cpp:131` |
| B6 | `/api/engine-token` protégé SEULEMENT par accident d'ordonnancement Vite → un bump de version rend le token moteur lisible par tout site visité | Moy | `vite.config.ts:19-35` |
| B7 | Divers : `AssetCache` sans éviction (OOM) ; `setState` de plugins tiers nourri par bytes d'un pair (crash-DoS persistant) ; cache de scan non échappé = redirection uid→DLL persistante | Moy | `clip_player.cpp:171` ; `main.cpp:488-508` ; `plugin_scan.cpp:81-96` |
| — | Reprises : H3 fichiers = **déjà owner-only mesuré sur Windows** (déclasser Low Windows / garder High POSIX-CI mode 0644) ; M4 token URL à moitié fait (fragment scrubé, `?token=` legacy subsiste) | — | ACL `%TEMP%` mesurée ; `wiring.ts:150-171` |

---

## Famille C — Stabilité (les gels)

| # | Trouvaille | Sév | Preuve |
|---|---|---|---|
| C1 | **Boucle de contrôle bloque 10-120 s (A4-7) et a EMPIRÉ** : rendu de stem offline complet SYNCHRONE dans la boucle (~56 000 IPC/5 min). Pendant : tap jam vide (auditeurs = silence), télémétrie figée, Ctrl+C ignoré, mort d'enfant non détectée. Déclencheur : tout jam où une chaîne devient périmée | **1** | `main.cpp:1337,1350` ; fetch `:553-574` (timeout 130 s) ; spawn `plugin_bridge.h:48` |
| C2 | Aucun watchdog sur le socket moteur côté navigateur (le serveur en a un) → pendant un gel C1, `readyState` OPEN, Play actif, badge ment. Se composent | 2 | `engine_client.ts` (pas de `lastActivity`) vs `server_client.ts:152-170` |
| C3 | `AssetCache` jamais évincé : ~1,3 Go RSS jamais rendus sur session d'audition (cas « tester 456 kicks ») | 2 | `clip_player.h:194` ; `clear()` jamais appelé |
| C4 | Budget restart plugin = 3 vies sans backoff/reset ; jam retry ICE 5 s à l'infini sans TURN ni abandon ; ancres transport sans âge max (laptop qui dort → `seek(3600*48000)`) | 2 | `main.cpp:426-452` ; `jam.ts:84-88` ; `transport_sync.ts:162-168` |

---

## Famille D — Perf à l'échelle (niveau 2-3, déclencheurs)

Rebuild en coalescing sans période de calme (le web debounce, le moteur
non, `main.cpp:1163-1256`) ; ~1000 `querySelector` par render distant +
full rebuild timeline à chaque geste (`render.ts:85-191`) ; life-layer
marche tous les clips par frame en lecture (`life.ts:140-170`) ; relais
signal O(N³)/tick (le `to` non honoré serveur, `websocket.rs:219-228`) ;
serveur load-parse-save-write du doc ENTIER par change, sous verrou
global, sans `spawn_blocking` (`file_store.rs:77-116`) ; doc grossit
~60 ops/s de drag sans compaction → seuil 100k atteignable en ~30 min
(`gestures.ts:67-73`). **Le callback audio lui-même reste propre.**
Travail par piste inconditionnel sans early-out silence (~6 ms/10,67 ms
à 1246 pistes, `audio_graph.cpp:99-123`).

---

## Famille E — Pérennité (WATCH, pas migration)

- **automerge-c** : VIVANT (commit d'il y a 8 jours), aligné (0.11.0/0.3.0),
  MAIS non publié et `.gitignore`d, fetch par SHA GitHub. Risque =
  empaquetage, pas santé. Containment excellente (1 seul TU :
  `automerge_document.cpp`). **Insurance : vendorer le sous-arbre, un
  après-midi.** Déclencheurs : fetch SHA échoue / sous-arbre disparaît /
  fix derrière un bump C-API incompatible.
- **dr_libs** sur `master` (= B3, urgent).
- **CI** : nightly Rust non épinglé + Node 20 EOL (avril 2026). Lockfiles
  JS/Rust présents et utilisés (`npm ci`). Insurance : pin nightly daté,
  Node 22 LTS.
- **VST3 SDK / miniaudio / ixwebsocket / protobuf** : containment bonne
  (SDK seulement dans `plugin_host.exe` ; seam `AudioDevice` 239 L pour
  un futur WASAPI direct). Règle à protéger : rien de VST3-shaped dans
  `engine/src/graph|audio`.
- **Le vrai actif de pérennité = les 25 specs e2e.** Seul trou : AUCUNE
  ne mesure temps/taille/durée → tous les déclencheurs ci-dessous sont
  aujourd'hui non instrumentés.

---

## Famille F — Cohérence / dette (la vocation d'AUDIT-5)

- **`SCHEMA.md`, « source de vérité » déclarée, MENT** : 5 champs
  stem/état + `name` absents du contrat (§1.3) ; 5 types builtin + clés
  de params en jumeaux manuels non documentés (§1.4) ; « les stems
  n'existent pas dans le code » alors que tout a shippé.
- **Commentaires faux vérifiés** : `origin.rs:1-3` « mirrors the engine »
  = algorithme OPPOSÉ + fail-open vs fail-closed (§3.6) ;
  `server_client.ts:322` pointe `main.ts` au lieu de `wiring.ts` ; ~10
  « for future use » sur du code vivant depuis V1.1 ; test params
  documente un seqlock retiré depuis v5.
- **Jumeaux** (règle de couplage) : `GraphBuilder` mort ET divergent
  (ignore fades/master/vst3/stems) ; `contentSeconds` ×2 ; bloc starter
  ×2 ; `NATIVE_PARAM_SPECS` ×2 ; framing 4-octets ×4 (strictness
  asymétrique) ; `256` en dur ×4 ; chemin token re-dérivé ×13 (dont 2
  lisant un nom que le moteur n'écrit plus) ; `ear.mjs` résout les assets
  différemment du moteur — et c'est la PORTE DE SÉCURITÉ AUDIO.
- **SPLITTER violé** : `cli_integration_test.cpp` 3205, `main.cpp` 1594,
  `automerge_document.cpp` 1118 (`readDocument` ~330 L / 7 niveaux — là
  où int/f64 a vécu invisible), `plugin_host_main.cpp` 1056,
  `wiring.ts` 802, `ui/track.ts` 823.
- Code mort avéré : `schema.cpp` moteur entier (110 L), `migrateDocument`/
  `createEmptyDocument` web, 2 méthodes token `EngineClient`, aucun
  teardown des clients WS ; 937 fichiers `server/projects/` sans GC.

---

## ARBITRAGE PROPOSÉ (par la grille des refontes — à ratifier)

Intègre la revue externe relayée (2026-08-25). L'ordre grave n'est PAS
réordonné ici ; ceci propose comment y insérer les trouvailles.

### Quick wins (< 1 h chacun, sans réordonner, avant tout le reste)
1. **B3** : épingler `dr_libs` sur un SHA. Une ligne.
2. **B5** : un helper `isHex64()`/`isUid()` à la frontière document
   (`schema.cpp`/`automerge_document.cpp`) avant toute construction de
   chemin — ferme B5 + M1 + L1 d'un coup. **Reproduire par un test
   d'abord** (un `node_id` `../` refusé).
3. **B1 (re-cadrage doc)** : corriger SECURITY.md « C2-remote = LIVE, pas
   futur » ; mitigation minimale proposée = token partagé en header
   vérifié serveur (5 lignes Rust) OU Cloudflare Access — PAS l'auth
   complète (celle-ci se conçoit avec critère 3 identités/invitations).

### Préalables (session bornée avant de continuer les stems)
- **A1** (int/f64 généralisé + le test NON tautologique, écrit côté web).
- **A2** (précision `setprecision(17)`/bits + ordre de liste, pas de map).
- **A4** (outbox moteur + merge au lieu de replace).
Raison : ces trois falsifient la preuve de l'invariant, tranche en cours.

### Refontes planifiées (sessions dédiées, test de non-régression)
- **A6 + A7 + A8** (période ≠ 256 + resampling + sample rate sur le fil).
  Argument « utilisable à terme » : REMONTER avant la vague MIDI. Si le
  resampling complet déborde une session, version honnête intermédiaire :
  refuser l'import 44,1k avec message clair, ou convertir à l'import.
- **A3** (arbitrage d'écrivain) : se conçoit AVEC la session PLACEMENT /
  SCHEMA v2 déjà à l'ordre. D'ici là, gate la publication de stem sur un
  propriétaire déclaré (même un flag CLI) sinon boucle d'upload à 2
  machines.
- **C1** (sortir render/fetch/spawn de la boucle de contrôle) : SESSION
  DÉDIÉE TÔT — se déclenche dans le scénario cible (jam), se compose avec
  C2, rend le produit RESSENTI comme cassé.
- **A5** (PDC live) : peut attendre, mais PAS au-delà de la vague MIDI
  (instrument à latence + piste sèche = désalignement audible en jeu).

### Dette datée à déclencheur (absorbée par AUDIT-5 « harmonisation »)
Toute la famille F + le reste de D/E. Ne PAS disperser en sessions
séparées (diluerait « une tâche par session »).

### Requalifications d'état proposées (ratification utilisateur)
- **STATUS critère 6** : « VERT sur plugin trivial, JAUNE sur plugin réel
  (état/latence/drag de knob) ».
- **Gate avant de re-déclarer VERT** : un plugin de test ADVERSARIAL
  (latence ≠ 0, gros état, params coïncidant à 6 chiffres) permanent dans
  `invariant-proof` — transformer l'avertissement externe en test.

### Méthode (rappel, vaut pour chaque session ci-dessus)
Cet audit sort d'agents Claude Code : sur ~40 trouvailles, 1-2 peuvent
être inexactes. **Première étape de chaque session = reproduire par un
test qui échoue** avant toute correction. Chaque reproduction devient le
test de régression qui manquait.

---

## Déclencheurs mesurables à instrumenter (aucun n'existe)

| Watch | Instrument | Seuil |
|---|---|---|
| A1/doc growth | timer `Automerge::load(ma-piece.am)` en CI + taille `.am` | load > 200 ms / `.am` > 1 Mo |
| C1 gel boucle | wall time de chaque itération, max reporté | itération > 100 ms |
| A/D pistes | render-hash à 500 pistes, chronométré | > 50 % du budget bloc |
| D web frame | `performance.measure` autour de `renderTracks` (203 clips) | > 16 ms |
| C3 mémoire | `AssetCache::size()` en télémétrie | > 500 Mo |
| A6 période | `if (period % 256)` warning `audio_device.cpp:156` | tout non-multiple |

## Questions ouvertes (goût/concept — arbitrage utilisateur)

1. Auth serveur : jusqu'où maintenant (token header) vs au premier pair
   public (identités complètes) ?
2. AUDIT-5 absorbe-t-il toute la famille F, ou une partie mérite-t-elle
   son propre passage ?

---

## AVANCEMENT 2026-08-25 (session code, test-first, gtests 36/36)

FAITS, chacun reproduit par un test qui echoue AVANT le fix :
- **B3** dr_libs epingle sur b55a0d9a (SHA du build vert), GIT_SHALLOW
  retire (`engine/CMakeLists.txt`). Compile confirme.
- **A1** helper `itemToUint` tolerant int/uint pour schemaVersion +
  sampleRate (`automerge_document.cpp`). Garde
  `testWebAuthoredIntFields` (vrais bytes Automerge-JS, sampleRate INT
  96000, masterGain 0.5 en controle positif). Couplage verifie : les
  champs int (startSample/fades/stateVersion/stemLatency) sont int des
  deux cotes, lus par AMitemToInt, coherents.
- **A2** cle de stem : `setprecision(max_digits10)` + bump stem-v1 ->
  stem-v2 (`stem_render.cpp`). Garde `testStemKeyPrecision` (deux floats
  distincts a ~1 ULP != meme cle). Effet : chaque stem existant se
  recalcule UNE fois. Reste note dans le code : troncature f64->float et
  ordre map (A1/1.1) attendent le refactor params-liste.
- **A6** warning bruyant si periode device % 256 != 0 (`audio_device.cpp`,
  via INTERNAL_BLOCK_SIZE) : le « ~47% bypass silencieux » devient visible.
  Additif (periode 512 des tests = multiple, pas de bruit). Le vrai fix
  (chunks partiels + depth depuis la vraie periode) reste dedie.
- **A7/B2** warning bruyant si asset.sample_rate != graph rate
  (`graph_common.cpp makeClipPlayer`) : le « pitch faux + derive
  silencieux » devient visible. Additif (fixtures 48k). Le vrai fix
  (resample a l'import ou refus) reste dedie.
- **B1 (doc)** SECURITY.md re-cadre : C2-distante = LIVE pas futur (F1),
  H3 = Low Windows / High POSIX (mesure), M1 garde caduque, M4 a moitie
  fait (retirer `?token=`), B3 marque fait.
- **A8/3.3** le sample rate du moteur traverse enfin le fil : champ
  additif `sample_rate=3` dans TransportPosition (proto, messages.ts
  regenere), rempli par le moteur (`device_->getSampleRate()`), lu par
  le web (`engine_client` remplace le 48000 en dur quand le moteur en
  envoie un ; 0/absent = fallback conserve, retrocompatible). Fin de la
  derive 8.8% de la playhead sur un device 44.1k. Contrat inter-etages
  verifie : moteur compile, tsc web 0, e2e local fader-to-engine +
  transport-loop 6 passed.
- **1.1** params moteur `std::map` -> `std::vector<pair>` ordonne
  (`schema.h` + setParam/getParam ; les nœuds passent par getParam, la
  lecture du doc append en ordre, l'ecriture et computeStemKey iterent en
  ordre). CLOT la dette d'ORDRE de A2 (la cle de stem serialise en ordre
  document, plus lexico), aligne le moteur sur SCHEMA.md + le web (deja en
  liste). Garde `testProcessorParamOrder` (zzz/aaa/mmm survit au roundtrip,
  une map aurait trie). Non-regression : gtests 39/39, e2e local
  fader-to-engine + devices 6 passed. Note : change encore les cle de stem
  (absorbe par le recalcul one-shot de stem-v2).
- **B5** validation des chemins : helper `isPathComponentSafe`
  (`util/path_safety.h` : bloque separateurs `/ \`, `..`, control chars ;
  DELIBEREMENT permissif sinon pour ne casser ni les sha256 ni les
  placeholders de test). Applique aux 4 frontieres ou une chaine du
  DOCUMENT devient un chemin fichier : asset_hash (read, graph_common),
  stem_hash (read, resolveStemSubstitution), node_id (WRITE tmp,
  stem_render), fetch hash (WRITE + URL, main.cpp fetchAssetFromServer).
  Ferme le path traversal (lecture ET ecriture) + l'injection CRLF d'URL.
  Garde `testPathComponentSafety`. gtests 40/40. Reste (dette) : valider
  aussi state_hash au read local (main.cpp:490) — couvert par le fetch.
- **F1 (serveur) FAIT** : auth par token partage OPT-IN (env
  `DAW_SERVER_TOKEN`). Choix elegant = reutiliser le modele eprouve du
  moteur (premier message `auth:<token>` sur le WS, jamais dans l'URL/les
  logs ; `Authorization: Bearer` sur /assets ; comparaison temps constant
  `constant_time_eq`). RETROCOMPATIBLE : sans env var (dev), aucune auth,
  comportement inchange. Ferme F1/C2-distante quand le serveur est expose
  par un tunnel : on definit le token, l'URL partagee porte le secret.
  Tests Rust auth_token 2/2 + les 3 tests d'integration existants verts.
  F1 CLIENTS FAITS (meme jour) : moteur (token = env var) et web (token =
  fragment #stoken, centralise dans context.ts SERVER_TOKEN/assetAuthHeaders)
  envoient `auth:<token>` en premier message WS + `Authorization: Bearer`
  sur /assets. Verifie : smoke moteur AVEC token = « Document loaded »,
  SANS = Disconnected en boucle (refuse) ; e2e retrocompat fader+devices+
  asset-fetch 7 passed (sans token = dev inchange) ; tsc web 0. RESTE
  (activation, non bloquant) : le script tunnel genere le token et le pose
  dans DAW_SERVER_TOKEN + l'URL #stoken (doc deux-machines.md).

**A4 — 1a+1b FAITES 2026-08-25 (merge non destructif + push reconnexion).**
Reste 2 (outbox persistant). Regression CI corrigee en cours de route
(contrat de log e2e « Document loaded » casse par un renommage, restaure).
Confirme par le code :
- `server_client.cpp:53` : `received_initial_` remis a false a CHAQUE
  Open -> toute reconnexion retraite le doc serveur comme initial.
- `main.cpp:1114` : `loadFromBytes` = REPLACE -> un change local non
  pousse (ex. stemHash produit hors ligne) est ECRASE a la reconnexion.
- `server_client.cpp:138` : `sendChange` return silencieux si
  deconnecte -> aucune file, le change est perdu.
- `main.cpp:1066` : `doc` n'est PAS create()'d au demarrage
  (isLoaded()==false) -> il ADOPTE la racine serveur au premier
  loadFromBytes, donc aux reconnexions son doc a la MEME racine que le
  serveur : un merge est SANS conflit de racine (le moteur n'a pas de
  graine, mais il n'en a pas besoin s'il adopte celle du serveur).
Decoupage propose :
  1a. [FAIT] `mergeFromBytes` (AMmerge du doc entrant charge comme src) +
      callback `if (!doc.isLoaded()) loadFromBytes else mergeFromBytes`.
      Garde `testDocMergePreservesLocal` (replace PERD le stem local /
      merge le preserve + integre le change serveur). Smoke silencieux
      serveur+moteur reel : « Document adopted: 2 tracks » (chemin
      premiere-connexion non regresse). gtests 37/37. Merge SANS push =
      deja strictement mieux que replace (le local n'est plus PERDU),
      sans regression (branche premiere-connexion bit-identique).
  1b. push a la reconnexion : `getMissingChangesFrom(remote)` puis
      sendChange de chaque manquant (jumeau du web wiring.ts:105). Sans
      1b, le change survit mais n'est jamais PARTAGE (le settle
      `key==stem_key` l'empeche de se re-pousser). -> PARTAGE. 1a+1b =
      l'unite fonctionnelle minimale.
  2.  outbox persistant + detection de refus (NACK serveur) = survie au
      crash moteur, moins critique (un moteur qui crashe re-render).
Non-regression EXIGEE (format doc) : fader-to-engine, stem-freshness,
asset-fetch, + critere 3 (meme si le moteur ne participe pas a la
convergence web<->web, on le prouve).
