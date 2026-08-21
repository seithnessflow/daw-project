# AUDIT.md

*Audit lecture seule — 2026-08-21. Toutes les affirmations ci-dessous sont adossees a une commande executee pendant l'audit ; ce qui n'a pas pu etre verifie est marque « non verifie ».*

---

## 1. Problemes par gravite

### BLOQUANT

#### B1. Le moteur crashe (use-after-free) apres le premier patch — c'est le bug du jalon

- **Fichier :** `engine/src/main.cpp` (fonction `doPlayWithServer`, lignes 623-649 et 673-678). Pas `server_client.cpp`.
- **Ce qui ne va pas :** deux fautes de duree de vie sur l'`AudioGraph` :
  1. Dans le callback de changement (l. 641-646), `current_graph = std::move(new_graph)` **detruit l'ancien graphe avant** l'appel `device.setActiveGraph(current_graph.get())` de la ligne suivante. Pendant cette fenetre, le thread audio traite un graphe libere (le contrat de `setActiveGraph` dit explicitement « Previous graph (caller must manage its lifetime) », `audio_device.h:154` — personne ne le fait).
  2. Plus grave : `ws_server.start(ws_config, &device, current_graph.get())` (l. 675) capture un **pointeur brut vers le graphe initial, jamais mis a jour**. Apres le premier rebuild, `broadcastTelemetry()` appelle `graph_->getMeters()` a 30 Hz sur de la memoire liberee (`websocket_server.cpp:252-282`).
- **Consequence concrete :** access violation `0xC0000005` ~30 ms apres le premier changement de gain. Le processus meurt en silence (aucun message, la sortie s'arrete apres « Change callback returned »). Les patches suivants n'arrivent jamais parce qu'il n'y a plus de processus pour les recevoir. C'est exactement le symptome observe (« un seul Graph updated »). Reproduit pendant l'audit — voir section 4.
- **Ce qu'il faudrait faire :** appeler `setActiveGraph(new)` d'abord, recuperer l'ancien pointeur en retour, et differer sa destruction jusqu'a ce que le thread audio ne puisse plus l'utiliser (ex. garder l'avant-dernier graphe vivant, ou passer par la file de commandes avec accuse). Donner a `WebSocketServer` un moyen d'etre notifie du nouveau graphe (ou lui faire lire le meme `std::atomic<AudioGraph*>` que le callback audio).

#### B2. L'authentification par token du moteur est factice

- **Fichier :** `engine/src/websocket/websocket_server.cpp:154-185`.
- **Ce qui ne va pas :** toute premiere trame binaire est acceptee. Un token **invalide** produit le meme resultat qu'un token valide (log « Auto-accepting local connection », puis `connections_.insert`). Un message qui n'est pas un message d'auth est accepte aussi. `validateConnection()` (l. 343) n'est jamais appelee — code mort. Le timeout d'auth a ete retire (commentaire l. 142). `allowed_origins_` est vide par defaut donc la validation d'Origin ne s'applique pas.
- **Consequence concrete :** n'importe quelle page web ouverte dans le navigateur peut se connecter a `ws://127.0.0.1:47821`, piloter le transport et le solo/mute, et lire la telemetrie. Toute l'infrastructure token (generation 256 bits, fichier `%TEMP%\daw-engine-token`, envoi en premier message cote web) est du theatre : le controle final accepte tout. La spec du projet (token dans le premier message, validation d'Origin, fermeture en cas d'echec ou de silence) n'est pas implementee.
- **Ce qu'il faudrait faire :** rejeter (close 4003) toute connexion dont le premier message n'est pas `[0x00][token valide]`, remettre un timeout d'auth, configurer `allowed_origins` par defaut (`http://localhost:5173`), et supprimer `validateConnection` ou l'appeler vraiment.

### SERIEUX

#### S1. Tout le travail recent est non commite ; git est invisible du PATH natif

- **Fichiers :** 12 fichiers modifies + `engine/src/network/`, `web/src/proto/`, `scripts/`, `web/tests/e2e/fader-to-engine.spec.ts`, `web/tests/e2e/diag.spec.ts`, `start_engine.ps1` non suivis (sortie de `git status` en section 2).
- **Ce qui ne va pas :** le dernier commit (`92c245d` « Step 4 ») decrit une architecture **contraire** a la cible (SetTrackGain direct navigateur→moteur, token en query param d'URL). Le code corrige — gain via Automerge, token en premier message, proto genere — n'existe que dans l'arbre de travail. Par ailleurs `where.exe git` ne trouve rien : seul `C:\Users\mb668\AppData\Local\Git\cmd\git.exe` existe (connu de CMake seulement). Un shell natif ne peut ni commiter ni verifier l'etat.
- **Consequence concrete :** un crash disque ou un `git checkout` malheureux perd la correction d'architecture entiere ; l'historique ment sur l'etat du projet ; la CI ne teste pas le code reel (les tests fader-to-engine n'y sont pas).
- **Ce qu'il faudrait faire :** mettre git dans le PATH utilisateur, puis commiter l'etat courant en 2-3 commits coherents (retrait du chemin direct SetTrackGain ; client serveur du moteur ; tests E2E du jalon).

#### S2. Trois arbres de build WSL residuels, et le build MSVC **depend** de l'un d'eux

- **Fichiers :** `build/` (racine), `engine/build/` — tous deux generes sous WSL (`CMAKE_C_COMPILER:FILEPATH=/usr/bin/cc`, `CMAKE_CACHEFILE_DIR:INTERNAL=/mnt/c/Users/mb668/daw-project/build`). WSL Ubuntu est toujours installe (`wsl.exe --status` repond).
- **Ce qui ne va pas :** `engine/CMakeLists.txt` pointe sur `${CMAKE_SOURCE_DIR}/../build/_deps/automerge-src` pour les headers et la lib automerge-c. L'arbre de build « Linux » a la racine est donc a la fois un dechet WSL **et** une dependance du build Windows officiel. S'ajoutent : `Makefile` racine (syntaxe GNU, `find`, `nproc` — inutilisable nativement), et la procedure du critere 4 dans `STATUS.md:160` qui prescrit cloudflared « depuis WSL ».
- **Consequence concrete :** exactement le risque signale (arbres qui divergent, binaires du mauvais OS) ; un `rm -rf build/` de nettoyage legitime casse le build MSVC de facon incomprehensible.
- **Ce qu'il faudrait faire :** deplacer le checkout automerge-c hors des arbres de build (ex. `third_party/automerge`), supprimer `build/`, `engine/build/`, le `Makefile`, et purger STATUS.md de la mention WSL.

#### S3. Les deux tests E2E du jalon echouent, et un troisieme passe a tort

- **Fichiers :** `web/tests/e2e/fader-to-engine.spec.ts`.
- **Ce qui ne va pas :** execution reelle pendant l'audit : `multiple gain changes are all applied` et `gain affects peak meters` **echouent** (« Engine received 0/3 updates », « Graph updated 0 times ») — coherent avec le crash B1. Mais `gain change propagates from browser to engine` **passe sans moteur en marche** : il cherche « Graph updated » dans `%TEMP%\daw-engine.log` en absolu (l. 114, `waitForEngineLog`), et le log perime d'une session precedente contient une occurrence. Le test ne demarre pas le moteur et ne compte pas en delta.
- **Consequence concrete :** le test principal du jalon est un faux positif structurel ; il restera vert meme moteur eteint ou crashe.
- **Ce qu'il faudrait faire :** faire demarrer/arreter le moteur par le test (ou par `scripts/start-stack.ps1`), tronquer le log au debut du test, et compter en delta comme le font les deux autres tests.

#### S4. Data race sur solo/mute entre thread WebSocket et thread audio

- **Fichiers :** `engine/src/graph/audio_graph.h:38-39` (`bool solo; bool mute;`), ecrits par `handleSetMonitor` (`websocket_server.cpp:242-250`, thread ixwebsocket), lus par `AudioGraph::process` (`audio_graph.cpp:49-72`, thread audio).
- **Ce qui ne va pas :** ecriture/lecture concurrentes de `bool` non atomiques = data race, donc comportement indefini au sens du standard — dans un projet dont la regle affichee est « communication par atomics uniquement ». (`gain` est correctement atomique ; solo/mute non.)
- **Consequence concrete :** en pratique MSVC x64 rendra ca « presque toujours » correct, mais c'est indefendable dans le code cense etre exemplaire sur le thread audio, et TSan/analyse le signalera.
- **Ce qu'il faudrait faire :** `std::atomic<bool>` avec `memory_order_relaxed`, comme `gain`.

#### S5. La CI ne fait qu'avertir si le hash de rendu change

- **Fichier :** `.github/workflows/ci.yml:79-82`.
- **Ce qui ne va pas :** si `HASH1 != EXPECTED_HASH`, la CI imprime « WARNING » et **continue** (exit 0). Seul le non-determinisme entre deux rendus successifs fait echouer le job.
- **Consequence concrete :** une regression du rendu (hash different de `f40af882097b704a`) passe la CI au vert. Le critere 1 n'est donc pas protege par la CI, contrairement a ce que suggere STATUS.md (« GitHub Actions, hash verifie »).
- **Ce qu'il faudrait faire :** `exit 1` sur divergence avec le hash de reference (avec procedure documentee de mise a jour volontaire du hash).

### MINEUR

#### M1. Code mort et doublons

- `proto/engine.proto` : troisieme schema protobuf (paquet `daw.engine`, messages `LoadDocument`/`ApplyChange` d'un design abandonne). Aucune reference dans le code. A supprimer.
- `engine/src/protocol/messages.proto` et `web/src/proto/messages.proto` : dupliques mais **octet pour octet identiques** (SHA-256 verifie) — acceptable, mais un seul fichier source avec generation des deux cotes serait plus sur.
- `validateConnection()` (`websocket_server.cpp:343`) : jamais appelee.
- `AudioCommand::UpdateGraph` et `SetGain` (`ring_buffer.h:163-164`) : cases vides dans `processCommands`, jamais emis.
- `generateSyncMessage`/`receiveSyncMessage` (`automerge_document.cpp:247-255`) : stubs vides.
- `Makefile` racine : inutilisable sous Windows natif.
- `GraphBuilder::build` (`audio_graph.cpp:210`) : non utilise par `main.cpp` qui a sa propre `buildGraph`.
- `EngineClient.setMonitor` (`engine_client.ts:154`) : « TODO: Implement when needed » — le moteur sait le traiter, le web ne l'envoie jamais.

#### M2. STATUS.md perime sur les « Problemes ouverts »

Les trois affirmations de la section « Problemes ouverts » sont contredites par le code actuel : `engine_client.ts` envoie du Protobuf genere (pas du JSON), gere le token (premier message binaire `[0x00][token]`, pas d'URL), et utilise le port 47821 (pas 9000). Voir section 3.

#### M3. Le moteur ignore `chain` a la lecture du document

- `automerge_document.cpp:419` : « TODO: Read chain (processors) similarly ». `readDocument` renvoie toujours `chain` vide, donc les processeurs `builtin.gain` du schema (SCHEMA.md, serveur les cree) sont silencieusement ignores par le moteur. Deux proprietaires du meme concept de gain (champ `gain` + processeur `builtin.gain`) dont un seul est honore.

#### M4. `assetHash` n'est pas du SHA-256

- `clip_player.cpp:12-41` : FNV-1a 64 bits explicitement marque placeholder. SCHEMA.md declare « SHA-256 hex digest » comme invariant. Le serveur et le web ne verifient rien. Ecart schema/implementation a resorber avant tout transfert d'assets reel.

#### M5. Resultats de test dans des fichiers epars plutot que DECISIONS.md

- `wasapi-test.txt` est **commite** a la racine (sortie brute d'un run WASAPI) ; `engine.log`, `engine.err`, `server.log`, `server.err` trainent a la racine (non suivis, mais utilises comme canal de diagnostic par `start_engine.ps1`). La discipline annoncee (consigner dans DECISIONS.md) n'est pas suivie.

#### M6. Le store serveur depend du repertoire courant

- `server/src/main.rs:30` : `FileStore::new("./projects")`. Le serveur actuellement en marche a ete lance depuis `web/`, d'ou un store dans `web/projects/default.am` (constate), non ignore par git, pendant que `.gitignore` ignore `server/projects/`. Deux emplacements de donnees possibles selon le CWD.

#### M7. Discipline de test E2E non respectee

- 18 `waitForTimeout` dans les specs (masquage de timing au lieu d'attentes conditionnelles), `toBeCloseTo` sur des gains qui sont des valeurs exactes posees par le test, et un `test.skip` (reconciliation offline, `criterion3-convergence.spec.ts:162`) documente dans STATUS.md comme dette mais sans ticket. CLAUDE.md interdit les trois.

#### M8. `rebuild_msvc.bat` ne construit pas les tests

- `engine/rebuild_msvc.bat:4` : `ninja daw_engine` seulement, alors que CLAUDE.md enchaine « rebuild_msvc.bat puis daw_engine_test.exe ». On peut donc executer un `daw_engine_test.exe` perime sans le savoir.

---

## 2. Ce qui est reellement prouve aujourd'hui

Chaque ligne : la commande executee (PowerShell natif, aucun WSL) et le resultat obtenu.

| Preuve | Commande | Resultat |
|---|---|---|
| Toolchain visible | `where.exe claude node npm cargo cmake ninja` | Tous presents (scoop/.cargo). **`git` absent du PATH** |
| Build moteur MSVC | `vcvars64.bat && ninja daw_engine daw_engine_test` (dans `engine\build-msvc`) | Exit 0 |
| Tests moteur | `.\daw_engine_test.exe` | **8/8 OK**, « Render determinism... OK (hash: f40af882097b704a) », exit 0 |
| Hash de reference | idem | **`f40af882097b704a` reproduit** en Release MSVC natif |
| Build serveur | `cargo build` (dans `server/`) | Exit 0 |
| Build web | `npm install; npm run build` (dans `web/`) | Exit 0, bundle produit (2 wasm Automerge + index 87.7 kB) |
| E2E Playwright | `npx playwright test` (serveur et Vite deja en marche) | **6 pass, 2 fail, 1 skip**. Les 2 echecs = tests du jalon fader→moteur |
| Convergence 2 onglets (critere 3 online) | idem | `online sync`, `bidirectional sync`, `new track added` : **pass** |
| Crash du moteur reproduit | `daw_engine.exe --server ws://localhost:3000 --play --mute --ws-port 47822` + script Node envoyant 3 changements de gain Automerge | Le moteur applique le changement 1 (« Graph updated »), puis **le processus meurt (exit 5)** ; changements 2 et 3 jamais recus |
| Nature du crash | `Get-WinEvent` (journal Application, Id 1000) | **3 crashs `daw_engine.exe` le 21/08** (18:46, 18:48, 19:06 = ma repro), exception `0xC0000005`, module fautif `daw_engine.exe`, offset `0x1c653b` identique |
| Arbres WSL | `Select-String build\CMakeCache.txt`, `engine\build\CMakeCache.txt` | `/usr/bin/cc`, `/mnt/c/Users/mb668/daw-project/...` |
| WSL installe | `wsl.exe --status` | Ubuntu, WSL 2 |
| Arbre de travail sale | `git.exe status --short` (git portable) | 12 modifies, 8 entrees non suivies |
| Versions Automerge | `Select-String` sur `Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` + `git -C build\_deps\automerge-src rev-parse HEAD` | serveur `=0.11.0` (lock 0.11.0), web `2.2.9` (lock 2.2.9), automerge-c monorepo **`47908d6c...`** — conformes a ADR-016 |
| Protos dupliques identiques | `Get-FileHash` sur les deux `messages.proto` | SHA-256 identiques |
| Serveur sur 127.0.0.1 | `Select-String server\src\main.rs` + `netstat -ano` | `SocketAddr::from(([127,0,0,1], 3000))`, LISTENING 127.0.0.1:3000 |
| Moteur sur 127.0.0.1 | lecture `main.cpp:460,661` (`bind_address = "127.0.0.1"`) + `netstat` (47821 en SYN_SENT depuis le navigateur, aucun 0.0.0.0) | Jamais 0.0.0.0 |
| Auth factice observable | `engine.log` racine | « WebSocket: Auto-accepting local connection » apres connexion de `http://localhost:5173` |
| Temoin du bug utilisateur | `%TEMP%\daw-engine.log` (modifie 18:48) | 1 seul « Received change (156 bytes) » → « Graph updated » → « Change callback returned », puis fin de fichier |

**Verifie par lecture de code (chemin complet du callback audio) :** `audio_callback.cpp` → `audio_graph.cpp` → `clip_player.cpp`/`gain_node` → `ring_buffer.h` : aucune allocation, aucun mutex, aucun I/O, aucun log, pas d'exception ; SPSC ring buffers corrects (acquire/release) ; `std::atomic<float>` verifie lock-free par `static_assert` ; blocs internes fixes de 256 frames independants de `frame_count` (boucle de sous-blocs, `audio_callback.cpp:61-77`) et garde-fou si `frame_count` depasse le buffer prepare. Toutes les positions temporelles sont des `int64` en echantillons (`transport_state`, `clip_player`, protobuf `int64 position_samples`) ; les seuls flottants temporels sont dans l'affichage CLI (division pour les secondes), hors moteur. Le gain passe par le document Automerge (`web/src/main.ts:152-166` → serveur → `doc.applyChange` moteur) ; le proto actuel n'a **plus** de message SetTrackGain ; solo/mute restent locaux (`SetMonitor` protobuf + etat CLI, jamais dans le document, et `copyMonitorState` les preserve au rebuild) ; position/graphe/buffers ne sont pas dans le document.

---

## 3. Affirme dans STATUS.md mais non verifiable ou contredit

**Contredit par le code ou par l'execution :**

1. « Problemes ouverts : `engine_client.ts` envoie JSON, moteur attend Protobuf / pas de gestion du token / port 9000 en dur » — **faux les trois** : le fichier actuel envoie du Protobuf genere (`protocol.ts` + `proto/messages.ts`, protoc-gen-ts_proto), envoie le token en premier message binaire, et utilise 47821 (`engine_client.ts:46-48,85-92`). La section decrit l'etat d'avant le travail non commite.
2. « Engine C++ (MSVC) verifie fonctionnellement ✅ » — vrai pour les 8 tests CLI, mais le mode `--server` (le jalon en cours) **crashe systematiquement** au premier patch. Le tableau donne une image plus saine que le reel.
3. « GitHub Actions, hash verifie » — la CI n'echoue pas si le hash devie de la reference (S5) ; elle ne verifie que la stabilite entre deux runs.
4. Procedure critere 4 « Tunnel cloudflared (depuis WSL) » — contredit la regle « Pas de WSL » de CLAUDE.md.

**Non verifiable pendant cet audit (et honnetement marque comme tel dans STATUS.md pour 4 et 5) :**

- Critere 3 offline : test `test.skip`, jamais execute — confirme non teste.
- Critere 4 (LNA Chrome) : necessite une invite manuelle — non verifie.
- Critere 5 avec charge CPU : non refait ici — le run sans charge du 2026-08-20 n'est documente que par `wasapi-test.txt`/DECISIONS.md, je n'ai pas reproduit les 10 minutes.
- Determinisme Debug vs Release : **aucun arbre Debug n'existe** (`build-msvc` est Release). Jamais teste nulle part — ni localement ni en CI. Non verifie.
- Hash identique GCC : repose sur la CI et sur l'ancien build WSL ; non reproductible localement en natif (pas de GCC, conforme a ADR-015). Non verifie ici.

---

## 4. Diagnostic du bug en cours

**Symptome rapporte :** le serveur diffuse vers 2 destinataires, le moteur ne journalise qu'un « Graph updated » ; le document initial passe, les patches suivants non. Piste suggeree : `server_client.cpp`.

**Verdict : `server_client.cpp` est innocent. Le moteur ne « rate » pas les patches suivants — il est mort.** Use-after-free sur l'`AudioGraph` remplace, dans `main.cpp`.

**Mecanisme :**

1. `doPlayWithServer` construit le graphe initial et demarre `ws_server` avec un pointeur brut dessus : `ws_server.start(ws_config, &device, current_graph.get())` (`main.cpp:675`). Ce pointeur n'est **jamais** rafraichi.
2. Premier patch : le callback de changement (`main.cpp:623-649`) reconstruit un graphe, puis :
   ```cpp
   current_graph = std::move(new_graph);        // <-- detruit l'ANCIEN graphe ici
   device.setActiveGraph(current_graph.get());  // <-- le thread audio pointait encore dessus jusqu'ici
   ```
   L'ancien graphe est libere alors que (a) le thread audio peut etre en train de le traiter (fenetre courte), et (b) `ws_server.graph_` pointe dessus **en permanence**.
3. La boucle principale appelle `ws_server.broadcastTelemetry()` toutes les ~33 ms, qui fait `graph_->getMeters()` (`websocket_server.cpp:264`) : iteration sur `tracks_` liberes, lecture de `std::string id` liberees → access violation quasi immediate.
4. Le processus meurt sans un mot (rien n'attrape l'AV ; les logs s'arretent juste apres « Change callback returned »). Vu de l'exterieur : « le moteur ne recoit plus les patches ».

**Ce qui l'etaye :**

- Code : le contrat de `setActiveGraph` (« caller must manage its lifetime », `audio_device.h:151-154`) n'est respecte nulle part ; `ws_server` n'a aucun mecanisme de mise a jour de `graph_`.
- Execution : repro controlee pendant l'audit (moteur `--mute --server` + 3 changements de gain envoyes par script) → « Graph updated » une fois, puis exit du processus ; le script, lui, a bien recu les 3 rediffusions du serveur (le serveur diffuse correctement — hors de cause).
- Journal Windows : 3 crashs `daw_engine.exe` le 21/08 avec `0xC0000005` au **meme offset `0x1c653b`** — dont deux (18:46, 18:48) anterieurs a l'audit, correspondant aux essais de l'utilisateur ; `%TEMP%\daw-engine.log` (modifie 18:48) s'arrete exactement apres le premier « Change callback returned ».

**Commandes pour confirmer / affiner :**

```powershell
# Reproduire (serveur en marche) : le moteur meurt ~30 ms apres le 1er patch
cd engine\build-msvc
.\daw_engine.exe --server ws://localhost:3000 --play --mute --ws-port 47822
# puis bouger un fader dans le navigateur, et constater la disparition du processus :
Get-Process daw_engine -ErrorAction SilentlyContinue

# Symboliser le crash (quel deref exact a l'offset 0x1c653b) :
cdb -g -G -o .\daw_engine.exe --server ws://localhost:3000 --play --mute --ws-port 47822
# au crash : kb  (pile) — attendu : AudioGraph::getMeters <- broadcastTelemetry, ou AudioGraph::process
```

Pour departager les deux chemins (telemetrie vs thread audio), commenter temporairement l'appel `broadcastTelemetry()` fait aussi disparaitre le crash immediat si c'est bien lui — mais les deux fautes de duree de vie sont a corriger de toute facon.

---

## 5. Les trois priorites, dans l'ordre

1. **Corriger la duree de vie du graphe dans `doPlayWithServer`** (swap atomique d'abord, destruction differee de l'ancien graphe, et pointeur de graphe partage/rafraichi pour `WebSocketServer`) — c'est le jalon « fader → son » qui est bloque dessus.
2. **Mettre git dans le PATH et commiter l'arbre de travail** (le retrait du chemin direct SetTrackGain, le client serveur du moteur, les tests du jalon) avant que ce travail non versionne ne se perde.
3. **Implementer reellement l'authentification du socket local** (rejet sur token invalide, timeout, Origin par defaut) — aujourd'hui n'importe quelle page web peut piloter le moteur.

Ensuite, dans la foulee : rendre le hash bloquant en CI (S5), supprimer les arbres WSL apres avoir relocalise automerge-c (S2), et reparer le test E2E faux positif (S3).
