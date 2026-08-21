# Architecture Decisions

Ce document trace chaque décision technique non triviale, sa justification, et les alternatives écartées.

## ADR-001: Audio Thread Constraints

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le callback audio est appelé par le driver à intervalles stricts (typiquement toutes les 5-10ms). Tout dépassement produit des clics audibles.

### Décision

Le thread audio est **sacré**. Interdictions absolues dans le callback :
- Allocation mémoire (`new`, `malloc`, `std::vector::push_back`)
- Mutex, sémaphores, toute synchronisation bloquante
- Appels système (`read`, `write`, `open`)
- Logging
- Exceptions

Communication avec le reste du programme uniquement par ring buffers SPSC lock-free.

### Alternatives écartées

- **Mutex avec try_lock** : risque de contention sous charge, imprévisible
- **Lock-free MPSC** : plus complexe, un seul producteur suffit ici

---

## ADR-002: Document Ownership

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Trois étages manipulent potentiellement le même état. Sans règle claire, les conflits et les bugs de synchronisation sont inévitables.

### Décision

- Le **document projet** appartient au navigateur, synchronisé par le serveur via Automerge CRDT.
- L'**état temps réel** (position de lecture, graphe vivant, buffers) appartient exclusivement au moteur, jamais écrit dans le document.
- Le **solo et mute de monitoring** sont personnels à chaque client, ne quittent jamais la machine.

### Conséquences

Le moteur reçoit des patches Automerge et projette son graphe audio. Il ne modifie jamais le document.

---

## ADR-003: Sample-Based Timing

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Les positions temporelles peuvent être exprimées en secondes (flottants) ou en échantillons (entiers).

### Décision

**Toute position temporelle est un `int64` en échantillons.** Jamais de secondes en flottant, nulle part.

### Justification

- Les flottants accumulent des erreurs d'arrondi sur de longues durées
- La conversion samples → secondes perd de l'information (non-inversible)
- Les DAW professionnels utilisent tous des samples en interne

### Alternatives écartées

- **Flottants double précision** : l'erreur reste, même si plus petite
- **Fractions rationnelles** : complexité excessive pour le gain marginal

---

## ADR-004: Graph as Projection

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le graphe audio doit refléter le document. Deux approches : mutation incrémentale ou reconstruction.

### Décision

Le graphe audio est une **projection** du document. À chaque patch Automerge :
1. Un nouveau graphe est construit sur le thread de contrôle
2. Les buffers audio existants sont réutilisés si possible
3. Un swap atomique remplace le graphe actif

### Justification

- Pas de logique de diff complexe
- Impossible d'avoir un état incohérent
- Le swap atomique est constant en temps

### Alternatives écartées

- **Mutation incrémentale** : bugs subtils quand le document change de structure

---

## ADR-005: WebSocket Library

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le moteur C++ expose un WebSocket sur 127.0.0.1 pour le navigateur.

### Décision

Utiliser **websocketpp** (basé sur Asio).

### Justification

- Maturité (10+ ans)
- Documentation complète
- Compatible header-only ou linkage statique
- Supporte WSS si nécessaire plus tard

### Alternatives écartées

- **uWebSockets** : plus rapide mais moins documenté, API moins stable
- **libwebsockets** : API C complexe
- **Boost.Beast** : tire tout Boost

---

## ADR-006: WAV Loading

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le moteur doit charger des fichiers audio. Pour la tranche 1, uniquement WAV.

### Décision

Utiliser **dr_wav** (header-only, partie de la famille dr_libs).

### Justification

- Même philosophie que miniaudio
- Aucune dépendance
- Supporte tous les formats WAV courants (8/16/24/32 bit, float, mono/stéréo)

### Note

Les autres formats (MP3, FLAC, OGG) arriveront en tranche 2 via dr_mp3, dr_flac, stb_vorbis.

---

## ADR-007: Protobuf for Engine Protocol

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le protocole entre navigateur et moteur doit être binaire et typé.

### Décision

Utiliser **Protocol Buffers** avec préfixe de longueur (4 bytes big-endian).

### Justification

- Schéma explicite, versionnable
- Génération de code pour C++, TypeScript
- Compact
- Standard industriel

### Alternatives écartées

- **FlatBuffers** : zero-copy mais API plus complexe
- **MessagePack** : pas de schéma
- **Cap'n Proto** : moins répandu

---

## ADR-008: Chrome Local Network Access

**Statut:** En investigation
**Date:** 2026-08-20

### Contexte

Chrome ≥ 142 implémente Local Network Access (LNA). Une page HTTPS ne peut pas ouvrir de connexion vers `http://127.0.0.1` sans permission.

### Comportement attendu

1. Chrome envoie une requête preflight avec `Access-Control-Request-Private-Network: true`
2. Le serveur doit répondre avec `Access-Control-Allow-Private-Network: true`
3. L'utilisateur peut voir une invite de permission

### Implémentation prévue

Le WebSocket server du moteur répondra au preflight HTTP avec les headers requis.

### À documenter après tests

- Comportement exact observé dans Chrome 142+
- Comportement dans Firefox (pas encore implémenté ?)
- Comportement dans Safari
- Impact sur l'UX

---

## ADR-009: No Database in Slice 1

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

La persistance peut utiliser une base de données ou de simples fichiers.

### Décision

Le serveur persiste en fichiers sur disque, derrière un trait `ProjectStore`.

### Justification

- Complexité minimale pour la tranche 1
- Le trait permet de substituer Postgres plus tard sans toucher au reste
- Les documents Automerge sont déjà des blobs binaires, pas besoin de structure relationnelle

---

## ADR-010: Double-Buffer for Graph Swap

> **Note 2026-08-22 (correctif AUDIT-2 R4).** L'implementation
> intermediaire (atomic<shared_ptr>) n'etait PAS lock-free sur MSVC :
> spinlock STL dans le callback, en contradiction avec cet ADR.
> Mecanisme en place desormais : le callback lit un POINTEUR BRUT atomique
> (lock-free, static_assert dans audio_callback.h) et publie un compteur
> de generation (+1 a l'entree, +1 a la sortie ; impair = dans le
> callback, entree en seq_cst). Le thread de controle ne libere un graphe
> retire que si : generation paire au snapshot du swap (aucun callback en
> vol), OU generation observee > snapshot (le callback en vol est sorti),
> OU device arrete - ET plus aucun lecteur cote controle (use_count==1).
> Jamais sur delai, jamais immediatement : c'est ce qui empeche de
> reintroduire le use-after-free d'origine en corrigeant le spinlock.

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le thread audio lit le graphe. Le thread de contrôle doit pouvoir le mettre à jour sans blocage.

### Décision

Utiliser un double-buffer avec `std::atomic<GraphState*>`.

```cpp
// Thread de contrôle
GraphState* newGraph = buildGraph(document);
GraphState* old = activeGraph.exchange(newGraph);
// old sera recyclé plus tard (pas sur le thread audio)

// Thread audio
GraphState* graph = activeGraph.load();
graph->process(buffer);
```

### Justification

- `exchange` et `load` sont lock-free
- Aucune allocation sur le thread audio
- Le vieux graphe peut être recyclé sur le thread de contrôle

---

## ADR-011: Telemetry Rate

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le moteur envoie position et VU-mètres au navigateur.

### Décision

Télémétrie à **30 Hz** fixe.

### Justification

- Suffisant pour une UI fluide
- Pas de surcharge réseau
- Synchronisé avec un rafraîchissement écran typique (60 Hz / 2)

---

## ADR-012: Automerge-C Integration

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le moteur C++ doit lire et appliquer des patches Automerge.

### Décision

Utiliser `automerge-c`, le binding C officiel. Intégration via CMake FetchContent, compilation de la lib Rust via Cargo.

### Prérequis

Rust toolchain installé sur la machine de build.

### Alternatives écartées

- **Parser JSON des patches** : perd les garanties CRDT
- **Binding maison** : maintenance trop lourde

---

## ADR-013: Automerge-C Build Integration

**Statut:** Résolu
**Date:** 2026-08-20

### Contexte

L'intégration de `automerge-c` dans le build CMake du moteur a révélé plusieurs défis.

### Problèmes rencontrés et résolutions

1. **CMake 3.25 requis** (système a 3.22.1)
   - **Solution:** Installation locale de CMake 3.28.3 dans `~/.local/bin/cmake`

2. **Repo automerge-c déplacé**
   - **Solution:** Le repo est maintenant dans le monorepo `github.com/automerge/automerge` à `rust/automerge-c/`

3. **rust-src component manquant**
   - **Solution:** `rustup component add rust-src --toolchain nightly-x86_64-unknown-linux-gnu`

4. **API automerge-c changée**
   - **Solution:** Réécriture complète de `automerge_document.cpp` pour la nouvelle API
   - Points clés:
     - `AMresultItem()` retourne `AMitem*` (pointeur)
     - `AMitemToDoc()`, `AMitemToStr()`, etc. prennent des pointeurs out
     - Les `AMresult*` doivent rester vivants tant que leurs données sont utilisées
     - Le `doc_result_` doit être conservé comme membre de classe

### Configuration finale

```cmake
set(AUTOMERGE_MONOREPO_DIR "${CMAKE_SOURCE_DIR}/../build/_deps/automerge-src")
set(AUTOMERGE_C_DIR "${AUTOMERGE_MONOREPO_DIR}/rust/automerge-c")
set(AUTOMERGE_BUILD_DIR "${AUTOMERGE_C_DIR}/build")
```

### Résultat

- automerge-c compilé et intégré avec succès
- Tests passent (hash de rendu stable)
- Pas de contournement JSON utilisé

---

## ADR-014: Network Topology (Triangle)

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

La communication entre les trois tiers doit être définie clairement pour éviter des latences inacceptables.

### Décision

La topologie est un **triangle**, pas une ligne :

```
        ┌─────────────────────────────────────────┐
        │           SERVEUR DISTANT               │
        │         (Document & Assets)             │
        └───────────────┬─────────────────────────┘
                        │
          Sync doc      │        Gros transferts
          & assets      │        (assets)
                        │
    ┌───────────────────┼───────────────────────────┐
    │                   │                           │
    ▼                   ▼                           │
┌──────────────┐    ┌──────────────────────────┐    │
│  NAVIGATEUR  │◄──►│  MOTEUR C++ (127.0.0.1)  │◄───┘
│              │    │                          │
└──────────────┘    └──────────────────────────┘
        ▲                       ▲
        │                       │
        └───────────────────────┘
         Transport & Télémétrie
              30 Hz direct
```

### Flux de données

| Connexion | Contenu | Fréquence | Transport |
|-----------|---------|-----------|-----------|
| Navigateur ↔ Moteur | Transport (play/stop/seek), Télémétrie (position, VU-mètres) | 30 Hz | WebSocket sur 127.0.0.1 |
| Navigateur ↔ Serveur | Document Automerge (sync), Assets upload | À la demande | HTTPS/WSS |
| Moteur ↔ Serveur | Assets download (gros fichiers) | À la demande | HTTPS direct |

### Justification

- **Rien de temps réel ne traverse le serveur distant.** Un aller-retour cloud ajouterait 50-200ms de latence, inacceptable pour les VU-mètres et la position de lecture.
- Le serveur distant ne voit jamais l'état temps réel (position, solo/mute monitoring).
- Le moteur peut télécharger les assets directement sans surcharger l'onglet navigateur.

### Conséquences

- Le moteur expose un serveur WebSocket sur `127.0.0.1:PORT`
- Le serveur distant et le moteur doivent pouvoir communiquer directement (pas via le navigateur)
- Le navigateur initie les deux connexions (vers serveur et vers moteur local)

---

## ADR-015: WSL Audio Limitations

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le développement se fait sous WSL2. L'audio sous WSL passe par WSLg (PulseAudio → RDP Sink), ce qui ajoute des buffers et masque le comportement réel du callback audio.

### Problème

- **Pas d'horloge matérielle** : le driver RDP Sink n'impose pas de deadline stricte
- **Buffers supplémentaires** : WSLg ajoute sa propre latence
- **Pas de thread à priorité temps réel** : le scheduler Linux sous WSL n'a pas accès aux priorités Windows

**Conséquence : le critère 5 (10 min sans underrun) ne peut pas être validé sous WSL.**

### Décision

1. **Build et tests fonctionnels** : sous WSL (pratique pour le développement)
2. **Validation audio temps réel** : sous Windows natif avec WASAPI

### Procédure de build Windows natif (WASAPI)

```powershell
# Prérequis
# - Visual Studio 2022 avec "Desktop development with C++"
# - CMake 3.28+ (via VS ou installé séparément)
# - Rust toolchain (rustup)

# 1. Cloner le projet (si pas déjà fait)
cd C:\Users\mb668\daw-project\engine

# 2. Compiler automerge-c
cd ..\build\_deps\automerge-src\rust\automerge-c
cargo build --release

# 3. Configurer CMake
cd C:\Users\mb668\daw-project\engine
cmake -B build-win -G "Visual Studio 17 2022" -A x64

# 4. Compiler
cmake --build build-win --config Release

# 5. Exécuter le test de 10 minutes
.\build-win\Release\daw_engine.exe --doc test.am --play --assets .
# Observer : Audio Device doit afficher "WASAPI" ou le nom du périphérique audio
# Surveiller Underruns pendant 10 minutes
```

### Vérification du backend audio

```
Audio Device: Speakers (Realtek High Definition Audio)  ← WASAPI, bon
Audio Device: RDP Sink                                   ← WSLg, pas bon
Audio Device: NULL Playback Device                       ← Null backend, pas bon
```

### Statut du critère 5

**OUVERT** - En attente de validation sous Windows natif avec WASAPI.

---

## ADR-016: Fixed Block Size Processing

**Statut:** Accepté
**Date:** 2026-08-20

### Contexte

Le callback audio reçoit un `frame_count` variable du driver. La taille peut varier entre les appels et dépasser les buffers pré-alloués.

### Problème avec l'approche précédente

Allouer avec une marge et clamper `frame_count` :
- **Marge arbitraire** : 2x n'est pas garanti suffisant
- **Clamp silencieux** : si le driver demande plus que la limite, on produit moins de frames → glitch audible non détecté

### Décision

Découplage complet avec **bloc interne fixe de 256 frames** :

```cpp
// Le callback reçoit n'importe quelle taille
void audioCallback(void*, void* output, const void*, uint32_t frame_count) {
    float* out = static_cast<float*>(output);
    uint32_t frames_written = 0;

    while (frames_written < frame_count) {
        uint32_t chunk = std::min(INTERNAL_BLOCK_SIZE, frame_count - frames_written);

        // Traitement en sous-blocs de taille fixe
        graph->process(out + frames_written * 2, chunk, position);

        position += chunk;
        frames_written += chunk;
    }
}
```

### Justification

- **Aucune allocation dépendante de frame_count** : buffers alloués pour `INTERNAL_BLOCK_SIZE` uniquement
- **Aucun clamp** : toute taille demandée est satisfaite
- **Conformité VST3** : `setupProcessing` déclare un `maxSamplesPerBlock`, le plugin ne dépasse jamais cette valeur
- **Prédictibilité** : le graphe traite toujours la même taille, optimisations possibles

### Constante

```cpp
constexpr uint32_t INTERNAL_BLOCK_SIZE = 256;  // ~5.3ms @ 48kHz
```

### Migration

- `AudioGraph::prepare()` alloue pour `INTERNAL_BLOCK_SIZE` uniquement
- `AudioGraph::process()` reçoit toujours `<= INTERNAL_BLOCK_SIZE`
- Le callback boucle pour remplir la demande du driver
