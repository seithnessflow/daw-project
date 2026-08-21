# STATUS.md

*Audit: 2026-08-20*

## Architecture

Triangle Browser ↔ Engine ↔ Server :
- **Browser ↔ Engine** : WebSocket direct sur 127.0.0.1 pour transport/telemetry (temps reel)
- **Browser ↔ Server** : WebSocket pour sync document Automerge (tolerance latence)
- **Engine ↔ Server** : HTTP pour gros transferts assets (hors bande)

Rien de temps reel ne traverse le serveur distant.

## Versions Automerge (ADR-016)

| Etage | Package | Version |
|-------|---------|---------|
| Engine | automerge-c | 0.3.0 (monorepo 47908d6c) |
| Server | automerge (crate) | =0.11.0 |
| Web | @automerge/automerge | 2.2.9 |

**Regle:** Toute montee de version se fait sur les trois etages simultanement.

## Etat des composants

| Composant | Compile | Verifie fonctionnellement | Notes |
|-----------|---------|---------------------------|-------|
| Engine C++ (MSVC) | ✅ | ✅ | `daw_engine_test.exe` 10/10 |
| Engine C++ (GCC/CI) | ✅ | ✅ | GitHub Actions, hash verifie |
| Server Rust | ✅ | ✅ | Ecoute sur 127.0.0.1:3000 |
| Web TypeScript | ✅ | ✅ | Automerge reel, critere 3 valide |

**Note:** Developpement 100% natif Windows (MSVC). GCC uniquement en CI.

**2026-08-22 (R1+R2):** construction du graphe sortie du thread reseau
(boucle principale, snapshot sous verrou, dernier etat gagne, version
loggee) ; registre d'instances plugins (ADR-017) en place ; test de
rafale = la preuve de coalescing dont le chantier VST3 dependra.

**2026-08-22 (R4+S4):** le thread sacre est desormais verifie par le
compilateur (static_assert lock-free sur tous les types partages avec le
callback + test runtime) ; spinlock atomic<shared_ptr> sorti du callback
(retention par generation, ADR-010 annote) ; solo/mute atomiques (S4 solde).

## Criteres d'acceptation

| # | Critere | Statut | Detail |
|---|---------|--------|--------|
| 1 | Rendu deterministe | ✅ VALIDE | Hash `89f1a1105dc09e92` (fixture reel 2 pistes, MSVC verifie; GCC via CI). Ancien hash `f40af882097b704a` = silence, invalide (voir DECISIONS.md 2026-08-21) |
| 2 | Test CLI sans navigateur | ✅ VALIDE | `./daw_engine_test` 10/10 |
| 3 | Convergence 2 onglets | ✅ VALIDE | Online ET offline (Playwright, coupure reelle du serveur). Voir detail pour les dettes residuelles |
| 4 | LNA HTTPS→WS local | ⛔ NON TESTE | Test manuel Chrome jamais documente |
| 5 | 10 min WASAPI sans underrun | ⚠️ PARTIEL | 0 underruns mais **sans charge CPU** |

### Detail critere 3

**Valide (Playwright):**
- Sync online: gain modifie dans onglet 1 apparait dans onglet 2
- Sync bidirectionnelle: modifications simultanees convergent
- Ajout de piste: nouvelle piste apparait dans les deux onglets

**Valide (2026-08-21, dette soldee):**

`criterion3-offline.spec.ts` (arret/relance REELS du serveur via
`start-stack.ps1 -Component server`, onglets vivants pendant la coupure,
edits distincts + conflit sur la meme piste) est VERT, annotation
`test.fail()` retiree. Les deux defauts du client sont corriges:
1. Outbox: `sendChange()` met en file les changements emis hors ligne et
   les envoie dans l'ordre a la reconnexion (plus aucune perte silencieuse).
2. Fusion a la reconnexion: le premier message de chaque connexion est
   traite comme document complet (drapeau par connexion, pas de prefixe de
   protocole necessaire) et FUSIONNE via `Automerge.merge()` - jamais de
   remplacement du document local.

**Dettes residuelles distinctes:**
- L'outbox est en memoire seulement: un onglet ferme pendant la coupure
  perd sa file. Persistance locale (IndexedDB/localStorage) a faire.
- ~~Le serveur diffuse un change AVANT de le persister~~ CORRIGE
  2026-08-21: persist-avant-broadcast dans websocket.rs, garde par
  `cargo test --test persist_before_broadcast` (kill brutal du process a
  l'instant ou un pair voit la diffusion). L'anti-entropie cliente reste
  en place (couvre d'autres pertes de broadcast).
- ~~Course a la creation du doc par defaut~~ CORRIGE 2026-08-22: toutes les
  mutations du store sont serialisees (store_lock), garde par
  `cargo test --test concurrent_first_writes` (2 premieres connexions
  simultanees, chacune ecrit immediatement, aucune perte toleree).

### Detail critere 5

Test effectue 2026-08-20:
- Device: ZenGo SC, 48kHz, 512 frames (~10.7ms)
- Duree: 599.5s / 600s
- Underruns: 0
- **Charge CPU: ABSENTE**

Le critere n'est pas valide tant qu'un test avec charge (recompilation parallele) n'est pas fait.
Voir DECISIONS.md pour procedure.

## Commandes utiles

### Engine (Windows MSVC - seule toolchain locale)
```powershell
cd engine\build-msvc
..\rebuild_msvc.bat
.\daw_engine_test.exe
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821
```

**Note:** GCC/Linux uniquement en CI (GitHub Actions).

### Web
```bash
cd web
npm install
npm run dev    # Dev server sur http://localhost:5173
npm run build  # Build production
```

### Server
```bash
cd server
cargo run  # Ecoute sur 127.0.0.1:3000
```

---

## Procedure de test critere 3 (convergence)

**Prerequis:** Deux terminaux, un navigateur avec deux onglets.

```bash
# Terminal 1: Serveur Rust
cd server
cargo run

# Terminal 2: Web dev server
cd web
npm run dev
```

**Test:**
1. Ouvrir http://localhost:5173 dans deux onglets
2. Dans onglet 1: modifier le gain d'une piste (slider)
3. Observer onglet 2: le gain doit se synchroniser
4. Dans onglet 2: modifier le gain d'une autre piste
5. Observer onglet 1: doit converger

**Resultat attendu:** Les deux onglets affichent le meme etat apres quelques millisecondes.

---

## Procedure de test manuel Windows

A executer par l'utilisateur dans des terminaux PowerShell separes.

### Test 1: Diagnostic port

```powershell
netstat -ano | findstr :9000
netsh int ipv4 show dynamicport tcp
```

Observations a noter:
- [ ] Port 9000 occupe? Par quel PID?
- [ ] Plage dynamique TCP?

### Test 2: Critere 5 avec charge CPU

```powershell
# Terminal 1: Lancer la lecture AVANT la charge
cd C:\Users\mb668\daw-project\engine\build-msvc
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821

# Terminal 2: Charge CPU (recompilation)
cd C:\Users\mb668\daw-project\engine\build-msvc
ninja clean && ninja -j8
```

Observations a noter:
- [ ] Underruns pendant compilation?
- [ ] Underruns total apres 10 min?
- [ ] Buffer size negocie?

### Test 3: Critere 4 (LNA Chrome)

```powershell
# Terminal 1: Serveur HTTP
cd C:\Users\mb668\daw-project\engine\test-page
python -m http.server 8080

# Terminal 2: Tunnel cloudflared (natif Windows: winget install Cloudflare.cloudflared)
cloudflared.exe tunnel --url http://localhost:8080

# Terminal 3: Moteur (deja lance pour critere 5, ou relancer)
cd C:\Users\mb668\daw-project\engine\build-msvc
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821
```

1. Copier token de `%TEMP%\daw-engine-token`
2. Ouvrir URL cloudflared dans Chrome >= 142
3. Coller token et port 47821

Observations a noter:

**Fetch (canari LNA):**
- [ ] Invite LNA apparait?
- [ ] Texte exact de l'invite?
- [ ] Comportement si refuse?
- [ ] Refus memorise apres reload?
- [ ] Comment annuler un refus?

**WebSocket:**
- [ ] Invite LNA apparait?
- [ ] Connexion reussie?
- [ ] Si pas d'invite mais Fetch bloque → LNA ne couvre pas encore WS

---

## Problemes resolus

1. ✅ **Depot git** — Initialise, premier commit `d2c5015`
2. ✅ **Fichiers temporaires** — Supprimes, .gitignore en place
3. ✅ **WebSocket Windows** — `ix::initNetSystem()` + port 47821
4. ✅ **Incompatibilite Web/Server** — Web migre vers Automerge reel (ADR-016)

## Problemes ouverts

1. ~~**Web incompatible avec moteur (hors critere 3)**~~ CORRIGE : `engine_client.ts`
   utilise Protobuf (pas JSON), gere le token d'authentification (premier message
   binaire), et utilise le port 47821 (pas 9000 en dur). Voir
   `engine_client.ts:24,47,86-91`.
