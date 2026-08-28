*Statut (2026-08-28) : ARCHIVE — rapport d'audit 2, lecture seule, date. Ses reliquats ouverts sont traces dans TODO.md (dettes datees) ; les items soldes dans JOURNAL.md. Index : docs/README.md.*

# AUDIT-2.md

*Audit lecture seule — 2026-08-21. Question directrice : qu'est-ce qui va ceder
quand le VST3 (TODO 2.4) va s'appuyer dessus ? Toutes les affirmations sont
adossees a une commande executee pendant l'audit ; ce qui n'a pas pu etre
verifie est marque « non verifie ». Seul fichier cree : ce rapport.*

*Contexte d'execution : arbre de travail git PROPRE (`git status --short` vide,
HEAD `07a219c`). Stack dev au moment de l'audit : seul vite (port 5173) ecoute ;
le serveur Rust (3000) et le moteur ne tournaient pas (`netstat -ano`). Rien
n'a ete arrete ni relance.*

---

## 1. Risques pour le chantier VST3, par gravite

### BLOQUANT — cede pendant 2.4 si rien n'est fait

#### R1. Chaque change = rebuild integral du graphe, sur le thread reseau, sans coalescing

- **Fichiers :** `engine/src/main.cpp` (`setChangeCallback` l.657-684, `buildGraph`
  l.301-355), `engine/src/network/server_client.cpp` (l.47-81 : les callbacks
  s'executent sur le thread de reception ixwebsocket).
- **Mecanisme de defaillance :** un tick de fader = un change Automerge (le web
  emet sur l'evenement `input`, `web/src/ui/track.ts:39` — un drag en produit
  des dizaines par seconde). Chaque change reconstruit TOUTES les pistes, tous
  les ClipPlayers, et demain re-instancierait chaque plugin (chargement DLL,
  allocations, 100-500 ms au lieu de ~500 us). Trois aggravants structurels :
  1. Le rebuild s'execute dans le callback ixwebsocket : pendant un build de
     500 ms, la lecture socket est bloquee, les changes suivants s'empilent.
     Aucun coalescing « dernier etat gagne » : 3 patches pendant un build = 3
     builds de plus en file ; un drag de 5 s = ~150 rebuilds a traiter un par
     un. Le moteur prend un retard non borne sur le document.
  2. Chaque graphe retire (`retired_graphs`, main.cpp:582-594) detiendrait ses
     instances de plugins jusqu'au drain (boucle principale, l.721-729) :
     pics memoire et rafales de destructions de plugins.
  3. L'infrastructure de mise a jour in-place EXISTE et n'est jamais utilisee :
     `AudioTrack::gain` est atomique mais `gain.store` n'est appele qu'a la
     construction (grep : main.cpp:314, audio_graph.cpp:221 uniquement) ;
     `ProcessorNode::setParameter` n'a aucun appelant. Tout passe par le
     rebuild.
- **Cout avant :** ajouter un chemin differentiel (changement de param = store
  atomique in-place ; rebuild seulement sur changement structurel) + coalescing
  vers l'etat courant du doc sur un thread de build dedie. Quelques jours,
  testable des maintenant avec le gain seul, jalon fader->son comme filet.
- **Cout pendant :** refactor du coeur du moteur sous pression, avec des
  plugins deja branches dessus et le premier bug audible (reverb qui coupe a
  chaque tick de fader, cf. R2) comme symptome d'entree.

#### R2. Aucun transfert d'etat entre graphes : un plugin serait reinitialise a chaque change

- **Fichier :** `engine/src/main.cpp:360-373` (`copyMonitorState`).
- **Mecanisme de defaillance :** le seul etat transfere lors d'un swap est
  solo/mute. Etat interne des processeurs (delay lines, tails, etat VST3) :
  rien. Combine a R1, chaque tick de fader detruirait et recreerait chaque
  plugin — audible immediatement, et `setState`/`getState` VST3 n'est pas
  gratuit. Le mecanisme actuel a ete concu pour des nodes sans etat
  (GainNode) et ca ne se voit pas tant que c'est vrai.
- **Cout avant :** se decide dans le meme geste que R1 (la bonne reponse est
  probablement la reutilisation d'instance par id de processeur, pas la copie
  d'etat). **Cout pendant :** redesign du swap au moment ou le premier plugin
  a etat entre, c'est-a-dire au premier jour utile du chantier.

#### R3. La frontiere de processus n'existe dans aucune interface, et la decision n'est ecrite nulle part

- **Fichiers :** `engine/src/graph/processor_node.h`,
  `engine/src/websocket/websocket_server.cpp:301`,
  `engine/src/render/offline_render.cpp`.
- **Mecanisme de defaillance :** TODO 2.4 exige « un processus isole », mais :
  - Aucun ADR ne documente cette decision (grep `processus|isolation` sur
    `docs/` : seule occurrence = `audit-2-prompt.md` lui-meme).
  - `ProcessorNode::process` est synchrone, `noexcept`, thread audio, latence
    supposee nulle : l'interface n'a pas de `getLatency()`, et aucune
    compensation de latence (PDC) n'existe nulle part. La telemetrie declare
    `latency_samples = taille de buffer` et rien d'autre
    (`websocket_server.cpp:301`).
  - `prepare()` et `setParameter(string, float)` sont synchrones ; aucun canal
    pour un blob d'etat.
  - Aucune infra IPC dans le moteur : grep
    `CreateProcess|CreateFileMapping|MapViewOfFile|shared_memory|pipe` sur
    `engine/src` = 0 resultat.
  - Le rendu offline (critere 1, hash de determinisme, CI) execute le meme
    graphe in-process : une piste a plugin isole par processus casse ou
    complique tout le harnais de determinisme (`fader-to-engine.spec.ts`
    compare des WAV echantillon par echantillon).
- **Cout avant :** un ADR d'une session qui fixe le contrat : transport audio
  process-a-process (memoire partagee, double buffer), controle par RPC,
  latence declaree et compensee, comportement a la mort du process plugin,
  sort du rendu offline. Chaque hypothese levee maintenant = une ligne.
  **Cout pendant :** chaque hypothese intra-processus decouverte en plein
  chantier = un refactor d'interface sous pression — exactement le scenario
  que la question directrice veut eviter.

### SERIEUX

#### R4. Le swap de graphe n'est PAS lock-free : le thread audio prend un spinlock a chaque callback

- **Fichiers :** `engine/src/audio/audio_callback.cpp:44-45`,
  `engine/src/audio/audio_device.h:196`, contrat : `docs/DECISIONS.md` ADR-010.
- **Preuve executee :** programme compile avec le meme MSVC/C++20 que le
  projet :
  ```
  atomic<shared_ptr>::is_always_lock_free = 0
  slot.is_lock_free() = 0
  atomic<float>::is_always_lock_free = 1
  ```
- **Mecanisme de defaillance :** `active_graph_` est un
  `std::atomic<std::shared_ptr<AudioGraph>>` ; sur MSVC son `load()` passe par
  un verrou interne de la STL. Le callback audio le prend a CHAQUE callback ;
  si le thread de controle est preempte au milieu d'un `exchange`
  (`setActiveGraph`) en le tenant, le thread audio attend → underrun. La
  probabilite est faible aujourd'hui (swaps rares) et montera exactement avec
  ce que le VST3 apporte : swaps frequents (R1) + charge CPU d'instanciation.
  ADR-010 promet « exchange et load sont lock-free » — c'etait vrai du design
  a `GraphState*` nu, c'est faux du code actuel. Le `static_assert` du projet
  (audio_graph.cpp:10) ne verifie que `atomic<float>`.
- **Cout avant :** revenir a l'esprit d'ADR-010 : `std::atomic<AudioGraph*>`
  nu + retirement par generation (le compteur de callbacks suffit comme
  barriere d'epoque), 1-2 jours, testable. **Cout pendant :** underruns
  sporadiques sous charge, le pire symptome a diagnostiquer au milieu d'un
  chantier plugins.

#### R5. `chain` : declare au schema, jamais ecrit, jamais lu, jamais teste — et 3 constructeurs de graphe a brancher

- **Fichiers :** `engine/src/document/automerge_document.cpp:419` (TODO,
  `readDocument` renvoie toujours `chain` vide), `web/src/main.ts:145`
  (`chain: []`), `server/src/api/websocket.rs:34,42` (listes vides),
  `engine/src/document/schema.h:26-30`, `docs/SCHEMA.md`.
- **Mecanisme de defaillance :** M3 de l'audit 1, jamais solde. Etat complet :
  - Personne ne CREE de processeur : ni web ni serveur (greps cites), le
    `builtin.gain` de SCHEMA.md n'a jamais existe dans un document reel. Le
    chemin `chain` de `buildGraph` est du code mort jamais exerce bout-en-bout.
  - Type de noeud inconnu : silencieusement ignore (`buildGraph` main.cpp:339-349
    et `OfflineRenderer::buildGraph` offline_render.cpp:204-212 ne gerent que
    `GainNode::TYPE`, sans warning). Un document contenant un plugin inconnu
    jouera un son DIFFERENT sans aucun signal — pour un DAW collaboratif ou
    tous les pairs doivent entendre pareil, c'est un piege.
  - `params` est `map<string, float>` (schema.h:29, SCHEMA.md « All values are
    floats ») : insuffisant pour du VST3 — il faut au minimum une identite de
    plugin (string/UID) et un blob d'etat. Donc schema v2 + migration — or
    `migrateDocument`/`validateDocument` ne sont APPELES NULLE PART (grep :
    definitions seules). La machinerie de migration promise par SCHEMA.md
    (« Migration code exists from v1 ») est du code mort.
  - La construction du graphe existe en 3 exemplaires : `buildGraph`
    (main.cpp:301), `OfflineRenderer::buildGraph` (offline_render.cpp:156) et
    `GraphBuilder::build` (audio_graph.cpp:210, mort — deja M1 de l'audit 1).
    Brancher les plugins = le faire 2 fois et supprimer le 3e.
- **Cout avant :** la tranche fine qui deverrouille 2.4 : lire `chain`
  (automerge_document.cpp:419), faire ecrire un `builtin.gain` par le web, un
  test E2E qui entend la difference ; decider schema v2 (identite + etat) et
  appeler enfin validate/migrate ; unifier les constructeurs. **Cout
  pendant :** faire evoluer le schema avec des documents reels en circulation
  et un moteur qui droppe en silence.

#### R6. solo/mute : data race a trois threads, jamais soldee (S4 audit 1)

- **Fichiers :** `engine/src/graph/audio_graph.h:38-39` (`bool solo; bool
  mute;` nus), ecrits par `handleSetMonitor` (thread WS,
  `websocket_server.cpp:267-271`), lus par `AudioGraph::process` (thread
  audio, audio_graph.cpp:49-72) ET par `copyMonitorState` (thread reseau,
  main.cpp:360-373).
- **Mecanisme de defaillance :** UB au sens du standard, et une fenetre de
  perte fonctionnelle : un SetMonitor qui arrive entre `copyMonitorState` et
  le swap ecrit dans le graphe sortant et disparait. Fenetre courte
  aujourd'hui ; elle s'elargit avec tout ce que R1 ralentit. Toujours liste
  « court terme » dans TODO.md, toujours pas fait.
- **Cout avant :** `std::atomic<bool>` relaxed, une heure + tests. **Cout
  pendant :** identique mais invisible dans le bruit du chantier.

#### R7. Lecture non protegee de `current_graph` dans la boucle principale

- **Fichier :** `engine/src/main.cpp:710` : `if (!ws_server.isRunning() &&
  current_graph)` lit le `shared_ptr` HORS `graph_mutex` pendant que le thread
  reseau l'assigne sous mutex (l.589 via `swapActiveGraph`). Lecture/ecriture
  concurrentes d'un `shared_ptr` non atomique = UB. Fenetre etroite (avant le
  demarrage du ws_server) mais reelle, et ce genre de « ca a toujours marche »
  est exactement ce qui lache quand les timings changent (R1). Correction : 15
  minutes (tester `device.getActiveGraphSlot()->load()` a la place).

### MINEUR

#### R8. `assetHash` = FNV-1a, pas SHA-256 (M4 audit 1, jamais solde) — et TODO 2.3 le met sur le chemin critique

- `clip_player.cpp:12-39` (« Simple SHA-256 would require a library »),
  `clip_player.h:29` pretend « SHA-256 of original file », SCHEMA.md l'exige.
  TODO 2.3 (SHA-256 + HTTP assets) est place AVANT 2.4 et « le rendu des
  pistes a plugins en dependra ». Attention au detail concret : le moteur
  resout les assets par nom de fichier `<assetHash>.wav` (main.cpp:329) —
  changer de hash renomme tous les assets et fixtures, y compris ceux que
  `fader-to-engine.spec.ts` copie (l.187-188).

#### R9. Le sync moteur<->serveur est positionnel et sans resynchronisation

- `server_client.cpp:100-119` : « premier message = document complet, ensuite
  = changes », aucun type de message ; un `applyChange` qui echoue laisse le
  moteur diverger en silence (pas de demande de resync). Code condamne par la
  regle de TODO 2.1 (« on n'y ajoute que ce qui corrige un defaut prouve ») —
  mais c'est le canal par lequel TOUS les params de plugins vont transiter
  pendant 2.4. A garder en tete : la veille samod (2.1bis) se re-evalue au
  debut de la tranche, c'est maintenant.

#### R10. `rebuild_msvc.bat` ne construit toujours pas les tests (M8 audit 1)

- Contenu constate : `ninja daw_engine` seul, alors que CLAUDE.md enchaine
  rebuild puis `daw_engine_test.exe` — on peut executer un test perime sans
  le savoir.

#### R11. Hygiene documentaire

- `engine.log`, `engine.err`, `server.log`, `server.err`, `wasapi-test.txt`
  toujours a la racine (M5 partiel ; les .log/.err sont gitignores,
  `wasapi-test.txt` est suivi).
- Deux `DECISIONS.md` (racine et `docs/`), et une collision de numero : le
  chapitre « ADR-016: Fixed Block Size Processing » de `docs/DECISIONS.md`
  vs le fichier `ADR-016-automerge-version-alignment.md`. Deux « ADR-016 »
  differents.
- `docs/DECISIONS.md` contient toujours ADR-015 « WSL Audio Limitations »
  (dette reconnue dans TODO moyen terme).

---

## 2. Ce qui est prouve, commandes a l'appui

Toutes les commandes en PowerShell natif Windows, git portable en lecture seule.

| Preuve | Commande | Resultat utile |
|---|---|---|
| Arbre git propre | `git status --short` | vide ; HEAD `07a219c` |
| Build moteur a jour | `vcvars64 && ninja daw_engine daw_engine_test` | `ninja: no work to do.` |
| Tests moteur | `.\daw_engine_test.exe` | **Passed: 9, Failed: 0** (pas 8) |
| Critere 1 (MSVC) | idem | `Render determinism... OK (hash: 89f1a1105dc09e92)` |
| Auth WS reellement corrigee (B2 audit 1) | idem, test « WebSocket auth » | `Invalid token from origin` → rejet ; `Closing unauthenticated connection (timeout)` ; `Rejected connection (disallowed origin: http://evil.example)` |
| Tests serveur | `cargo test` (ports 3907/3908, sans toucher 3000) | `simultaneous_first_writes_both_survive ... ok` ; `change_seen_by_peer_survives_brutal_kill ... ok` — exit 0 |
| Build web | `npm run build` | `tsc && vite build` exit 0, bundle 88.93 kB + 2 wasm |
| atomic<shared_ptr> non lock-free | `cl /std:c++20 atomic_check.cpp && check.exe` | `slot.is_lock_free() = 0` |
| Stack au moment de l'audit | `netstat -ano \| findstr "3000 5173 47821"` | seul `[::1]:5173 LISTENING` (vite) ; serveur 3000 et moteur absents |
| S2 (arbres WSL) solde | `Test-Path build`, `engine\build`, `Makefile` | `False` x3 ; `third_party\automerge` = `True` ; CMakeLists pointe `third_party/automerge` |
| `chain` jamais produit | greps `chain\|builtin.gain` sur `server/src`, `web/src` | serveur : 2 `put_object(..., "chain", List)` vides ; web : `chain: []` |
| validate/migrate jamais appeles | grep `validateDocument\|migrateDocument` sur `engine/src` | definitions seules (schema.h/cpp), zero appelant |
| Mise a jour in-place jamais utilisee | grep `setGain\|setParameter\|gain\.store` sur `engine/src` | `gain.store` : construction seulement ; `setParameter` : zero appelant externe |
| Aucune infra IPC | grep `CreateProcess\|CreateFileMapping\|MapViewOfFile\|shared_memory\|pipe` sur `engine/src` | 0 fichier |
| Aucun ADR isolation processus | grep `processus\|isolation` sur `docs/` | seule occurrence : `audit-2-prompt.md` |
| Fader = 1 change par event `input` | grep `addEventListener` sur `web/src` | `track.ts:39 faderInput.addEventListener('input', ...)` |
| FNV toujours en place | grep `FNV\|hash` sur `clip_player.cpp` | `FNV-1a offset basis`, `computeSimpleHash` |
| S3 (test faux positif) solde | lecture `fader-to-engine.spec.ts` | spawn du moteur par le test, log frais par run, comptage en delta, echec si `exitCode` non nul — les 3 defauts de l'audit 1 corriges (par lecture de code ; execution Playwright non faite, voir ci-dessous) |
| Discipline E2E | grep `waitForTimeout\|test.skip\|toBeCloseTo` sur `web/tests` | 1 `waitForTimeout` (diag.spec.ts), 0 `test.skip`, 9 `toBeCloseTo` (tous sur des gains relus via le DOM — defendable, mais CLAUDE.md exige une justification explicite qui n'est ecrite nulle part) |
| Store serveur dependant du CWD (M6) | `Test-Path web\projects`, `server\projects` | les DEUX existent (`web\projects\default.am` du 21/08) ; `FileStore::new("./projects")` inchange (main.rs:30) ; les deux chemins sont maintenant gitignores |

**Non verifie pendant cet audit :**

- **Criteres 3 (E2E Playwright), 4 (LNA), 5 sous charge** : non executes.
  Les specs criterion3 mutent le projet `default` de la stack de dev et
  `criterion3-offline` arrete/relance REELLEMENT le serveur via
  `start-stack.ps1` — consigne de non-perturbation ⇒ non verifie ici
  (valides par STATUS.md en date des 2026-08-21/22, hors de cet audit).
- **Hash GCC en CI** (`89f1a1105dc09e92` cote Linux) : necessite GitHub
  Actions, toujours liste « a verifier » dans TODO. Non verifie.
- **Comportement reel sous rebuild lent** (R1/R2) : raisonne sur code, pas
  mesure — aucun node a 500 ms n'existe encore pour le mesurer. C'est
  precisement pourquoi c'est le moment de corriger l'architecture.

---

## 3. Ecarts docs / reel

1. **CLAUDE.md, tableau des criteres :** critere 1 = « Hash `f40af882097b704a` »
   — c'est le hash de SILENCE invalide depuis le 2026-08-21 (DECISIONS.md le
   dit lui-meme) ; critere 2 = « 8/8 » (reel : 9/9) ; critere 3 = « En attente
   de test » (reel : VALIDE le 2026-08-21). Le document d'instructions permanent
   contredit DECISIONS.md et STATUS.md.
2. **STATUS.md « Problemes ouverts » (M2 audit 1, jamais purge) :** affirme
   encore « engine_client.ts envoie JSON », « pas de gestion du token »,
   « port 9000 en dur » — les trois sont faux (protobuf genere, token en
   premier message binaire, port 47821 : `engine_client.ts:24,47,86-91`).
3. **STATUS.md incoherent avec lui-meme :** tableau des composants : Web
   « ⏳ test critere 3 requis » ; tableau des criteres, 40 lignes plus bas :
   critere 3 « ✅ VALIDE ».
4. **STATUS.md / CLAUDE.md « 8/8 »** : le compte reel est 9 (test « WebSocket
   auth » ajoute, jamais repercute).
5. **TODO.md court terme :** « Serveur : persister AVANT de diffuser » encore
   liste comme a faire, alors que 2.1 le marque FAIT 2026-08-21, STATUS.md le
   confirme, et le test `persist_before_broadcast` passe (execute ici).
6. **ADR-010 vs code :** « exchange et load sont lock-free » — faux depuis le
   passage a `atomic<shared_ptr>` (preuve section 2). La justification de
   l'ADR ne decrit plus le mecanisme reel.
7. **SCHEMA.md vs code :** « assetHash : SHA-256 hex digest » (reel : FNV-1a,
   R8) ; « chain : Required » et type `builtin.gain` documente (reel : jamais
   produit ni lu, R5) ; « Migration code exists from v1 » (reel : jamais
   appele).
8. **Decision d'isolation par processus** (fondatrice pour 2.4) : presente
   dans TODO 2.4 et le prompt d'audit, absente de tout ADR (R3).
9. **AUDIT.md (audit 1), etat des dettes au 2026-08-21 :** soldees depuis :
   B1 (use-after-free : shared_ptr + retirement + slot atomique, teste par
   `fader-to-engine.spec.ts`), B2 (auth : prouve par test), S1 (arbre
   commite, git utilisable), S2 (arbres WSL supprimes, `third_party/`),
   S3 (spec re-ecrite), S5 (hash asserte DANS `daw_engine_test`, qui fait
   echouer la CI). Toujours ouvertes : S4 (solo/mute, R6), M2 (R11/ecart 2),
   M3 (chain, R5), M4 (FNV, R8), M5 partiel, M6 partiel (store CWD), M8 (R10).

---

## 4. Les trois choses a faire avant d'ouvrir 2.4

1. **Casser le reflexe « un change = un rebuild »** : mise a jour in-place des
   parametres via les atomics deja en place, rebuild reserve aux changements
   structurels, coalescing vers le dernier etat sur un thread de build dedie —
   prouve avec le gain seul pendant que le jalon fader->son sert encore de
   filet (R1/R2).
2. **Brancher `chain` bout-en-bout avec `builtin.gain`** (le web l'ecrit, le
   moteur le lit en automerge_document.cpp:419, un test E2E entend la
   difference) et fixer au meme moment le schema v2 des processeurs :
   identite de plugin, blob d'etat, comportement declare sur type inconnu,
   et `validateDocument`/`migrateDocument` enfin appeles (R5).
3. **Ecrire l'ADR de la frontiere de processus** (transport audio, RPC de
   controle, latence declaree et compensee, mort du process plugin, sort du
   rendu offline) et, dans la foulee, tenir la promesse lock-free d'ADR-010
   en remplacant `atomic<shared_ptr>` sur le chemin du callback audio (R3/R4).

*Et en passant, dix minutes de mise a jour documentaire (CLAUDE.md criteres,
STATUS.md « Problemes ouverts », TODO.md ligne persist-avant-broadcast) pour
que le prochain regard neuf ne re-derive pas tout ceci.*

---

## Addendum — modifications externes apparues PENDANT l'audit

L'arbre etait propre au debut de l'audit (`git status --short` vide, HEAD
`07a219c`). En fin d'audit, `git status` montre 4 fichiers modifies par un
acteur externe (session parallele) : `TODO.md` (+9), `server/src/document/
file_store.rs` (+14/-3, ecriture atomique temp+rename), `web/src/main.ts` et
`web/src/ui/track.ts` (mise a jour du gain in-place dans le DOM au lieu du
rebuild innerHTML). Cet audit n'a modifie AUCUN de ces fichiers ; ses constats
portent sur l'etat HEAD et restent tous valides apres lecture du diff. Deux
points du diff meritent mention :

- Le nouveau bloc TODO « Candidats grille (arbitrage a l'audit 2) » converge
  independamment avec R3/R5 (« ProcessorNode trop mince pour un hote VST3 :
  latence, bypass, etat, bus ; params string->float insuffisants »).
- Il souleve un point que cet audit n'avait pas isole et que je contresigne
  apres verification : le transport a DEUX chemins d'ecriture concurrents —
  la file de commandes (`handleTransportCommand` → ring buffer → thread
  audio, websocket_server.cpp:236-257) ET des appels directs
  `device.getTransport().play()/stop()` depuis le thread de controle
  (main.cpp:491,651,763). Un seul proprietaire a choisir avant que le
  transport ne pilote des plugins (etats play/stop VST3).

La ligne perimee de TODO.md (« persister AVANT de diffuser », ecart n°5) est
toujours presente dans la version modifiee.
