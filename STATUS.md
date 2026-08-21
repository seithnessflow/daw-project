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
| Engine C++ (MSVC) | ✅ | ✅ | `daw_engine_test.exe` 8/8 |
| Engine C++ (GCC/CI) | ✅ | ✅ | GitHub Actions, hash verifie |
| Server Rust | ✅ | ✅ | Ecoute sur 127.0.0.1:3000 |
| Web TypeScript | ✅ | ⏳ | Automerge reel, test critere 3 requis |

**Note:** Developpement 100% natif Windows (MSVC). GCC uniquement en CI.

## Criteres d'acceptation

| # | Critere | Statut | Detail |
|---|---------|--------|--------|
| 1 | Rendu deterministe | ✅ VALIDE | Hash `f40af882097b704a` identique GCC/MSVC |
| 2 | Test CLI sans navigateur | ✅ VALIDE | `./daw_engine_test` 8/8 |
| 3 | Convergence 2 onglets | ⏳ PRET | Web migre vers Automerge reel, test requis |
| 4 | LNA HTTPS→WS local | ⛔ NON TESTE | Test manuel Chrome jamais documente |
| 5 | 10 min WASAPI sans underrun | ⚠️ PARTIEL | 0 underruns mais **sans charge CPU** |

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

# Terminal 2: Tunnel cloudflared (depuis WSL)
~/.local/bin/cloudflared tunnel --url http://localhost:8080

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

1. **Web incompatible avec moteur (hors critere 3)**
   - `engine_client.ts` envoie JSON, moteur attend Protobuf
   - Pas de gestion du token d'authentification
   - Port code en dur: 9000, moteur utilise 47821
   - **Note:** N'affecte pas critere 3 (server sync seulement)
