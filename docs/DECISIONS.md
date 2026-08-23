# Architecture Decisions

Ce document trace chaque décision technique non triviale, sa justification, et les alternatives écartées.

*Registre UNIQUE depuis 2026-08-23 (fusion AUDIT-4) : l'ancien
`DECISIONS.md` racine (decisions produit + resultats de tests) vit
desormais ici, dans la section « Decisions produit et resultats de
tests » en fin de fichier. Un seul proprietaire par information.*

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

> **Note 2026-08-23 (correctif AUDIT-4).** Cet ADR mentait : le code n'a
> jamais utilise websocketpp. La bibliotheque REELLE, dans le moteur
> entier (serveur WS + client vers le serveur de sync), est
> **ixwebsocket** — retenue en pratique pour son API simple, son support
> Windows natif (`ix::initNetSystem()` = WSAStartup) et l'absence de
> dependance Asio/Boost. Le texte d'origine est conserve ci-dessous
> comme decision historique jamais appliquee.

**Statut:** Remplace par ixwebsocket (constat 2026-08-23)
**Date:** 2026-08-20

### Contexte

Le moteur C++ expose un WebSocket sur 127.0.0.1 pour le navigateur.

### Décision (jamais appliquée)

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

## ADR-015: WSL Audio Limitations — OBSOLETE (elagage 2026-08-22)

**Cet ADR ne decrit plus le projet : le developpement est 100% natif
Windows (MSVC), les arbres WSL ont ete supprimes (audit 1, S2). Conserve
pour l'historique uniquement.**

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

## ADR-018: Fixed Block Size Processing

*(Renumerote 2026-08-22 : ce chapitre portait « ADR-016 », en collision
avec le fichier ADR-016-automerge-version-alignment.md. Le contenu est
inchange et plus vrai que jamais : le bloc 256 est devenu un contrat
inter-processus — kRingBlockSize == kHostBlockSize, asserte des deux
cotes du ring.)*

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

---

# Decisions produit et resultats de tests

*(Fusionne le 2026-08-23 depuis l'ancien `DECISIONS.md` racine. Les
sections encore vraies sont reprises telles quelles ; les procedures et
listes d'etapes perimees de 2026-08-20 — port 9000, WSL, « prochaines
etapes » toutes soldees — ne sont pas reprises, git les garde.)*

## Licence du projet - 2026-08-22

**GPL-3.0-or-later.** Raisons : emboitement direct avec le SDK VST3
(branche GPLv3, zero analyse de compatibilite), ecosysteme audio libre
majoritairement GPL (Ardour, Audacity... - echanges de code triviaux dans
les deux sens), lisibilite instantanee pour les contributeurs.
Structure : copyright integralement a l'auteur ; CLA a mettre en place au
PREMIER contributeur externe (c'est le CLA qui garde les options ouvertes,
pas la licence) ; si des morceaux du serveur sont publies separement un
jour, leur licence prevue est AGPLv3 ; l'accord proprietaire Steinberg
sera signe en parallele comme option d'avenir, pas comme prerequis.
Mise en oeuvre : LICENSE (texte canonique GPLv3), en-tete SPDX
`GPL-3.0-or-later` sur les 57 sources suivies (generes exclus), section
Licence du README.

## Diagnostic compaction (2.2) - 2026-08-22

**Seuils fixes AVANT mesure** (modele: drag = 30 changes/s, 20% du temps
actif -> 21 600 changes/h ; 4 pistes):
- A gerable: a 1h, taille < 5 Mo ET chargement moteur < 1 s ET web < 1 s
- B sous condition: moteur 1-5 s OU 5-50 Mo a 1h, ET coalescing ramene 10h sous A
- C intenable: au-dela -> samod urgent

**Mesures** (drags simules Automerge JS 2.2.9 ; moteur = daw_engine --info
release, demarrage du process compris):

| changes | taille .am | load web | load moteur |
|---------|-----------|----------|-------------|
| 1 000   | 1 013 o   | 17 ms    | 30 ms       |
| 50 000  | 2 616 o   | 244 ms   | 141 ms      |

La TAILLE est un non-probleme: la compression colonnaire d'Automerge rend
les re-ecritures de la meme cle quasi gratuites (~0,03 octet/change).
L'axe reel est le TEMPS de chargement, lineaire en nombre de changes:
~4,9 us/change (web), ~2,4 us/change (moteur).

**Projections** (lineaires, linearite verifiee sur 1k-50k):
- 1 h: ~1,7 Ko ; moteur ~75 ms ; web ~110 ms
- 10 h: ~8 Ko ; moteur ~540 ms ; web ~1,1 s
- Le mur reel: ~100 h cumulees d'un projet au long cours (moteur ~5 s,
  web ~11 s) - l'historique ne se compacte jamais.

**VERDICT: A - croissance gerable pour la tranche 2.**

Recommandation (3 lignes):
1. Le chantier VST3 demarre sans prealable de compaction.
2. Compaction = dette datee, declencheur: quand un projet reel depasse
   ~100 000 changes (mesurable: taille > 5 Ko ou load web > 500 ms).
3. Coalescing des drags cote client (1 change a la relache, /50): assurance
   bon marche, optionnelle, a prendre lors d'une future session web courte.

## Critere 1: nouveau hash de reference - 2026-08-21

**L'ancien hash `f40af882097b704a` etait un hash de SILENCE. Ne plus s'y referer.**

Le fixture de `testRenderDeterminism` etait un document sans clip: le rendu
etait 1 seconde de silence, et l'egalite GCC/MSVC ne prouvait rien du chemin
audio. (Ce meme fixture silencieux a masque pendant des semaines un bug du
renderer hors-ligne qui rendait du silence pour tout document reel - corrige
le 2026-08-21, commit `4cb1491`.)

Nouveau fixture (genere par le test, deterministe inter-compilateurs car sans
`sin()` de libm): deux pistes a gains differents (0.8 / 0.3), onde carree
stereo + dent-de-scie mono, clips chevauchants, un offset non nul. Le test
verifie que le rendu n'est PAS silencieux (peaks > 0.05) puis compare au
hash de reference.

```
Hash de reference: 89f1a1105dc09e92
```

- MSVC (Windows natif): `89f1a1105dc09e92` (verifie 2026-08-21)
- GCC (CI Linux): confirme depuis le premier run CI vert (#48, 2026-08-22)

Toute deviation fait echouer `daw_engine_test` (CI comprise). Mise a jour du
hash uniquement pour un changement de rendu delibere et documente ici.

### 2026-08-23 — nouveau hash de reference `56729beb61993cd7` (V1.6 fades)

Changement de rendu DELIBERE : le fade implicite anti-clic de 4 ms
(sample_rate/250 echantillons, rampe lineaire) s'applique desormais a
chaque bord de clip dont le champ fadeIn/fadeOutSamples vaut 0 (clampe
a la moitie du clip). L'option du plan « implicite seulement quand le
bord coupe du signal non-nul » est EQUIVALENTE echantillon-pres a
l'inconditionnel (ramper du silence = identite) — implemente
inconditionnel, sans branche dependante du contenu. Consequence : le
fixture du critere 1 (bords non-nuls) rend differemment, d'ou le
nouveau hash. Rampes en float pur (divisions et multiplications, pas
de candidat FMA) — determinisme inter-compilateurs preserve, verifie
par le meme test. Ancien hash : `89f1a1105dc09e92` (2026-08-21).

## Resultats historiques 2026-08-20 (resume)

- **Critere 5 sans charge :** ZenGo SC, 48 kHz, 512 frames, 599,5 s/600,
  0 underrun, charge CPU ABSENTE — le critere reste PARTIEL tant que le
  test sous charge (procedure vivante dans STATUS.md, `ninja -j32`)
  n'est pas fait.
- **IXWebSocket sur Windows :** `ix::initNetSystem()` manquant
  (WSAStartup), SO_REUSEADDR patche, port 9000 occupe par wslrelay ->
  port 47821 adopte partout.
- **addTrack ne copiait pas les clips :** corrige, garde par
  `testDocumentClipsRoundTrip`.
- L'ancien « hash identique GCC/MSVC f40af882 » de ce jour-la etait un
  hash de silence (voir ci-dessus).
