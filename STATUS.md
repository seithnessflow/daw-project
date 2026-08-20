# STATUS.md

*Audit: 2026-08-20*

## Architecture

Triangle Browser ↔ Engine ↔ Server :
- **Browser ↔ Engine** : WebSocket direct sur 127.0.0.1 pour transport/telemetry (temps reel)
- **Browser ↔ Server** : WebSocket pour sync document Automerge (tolerance latence)
- **Engine ↔ Server** : HTTP pour gros transferts assets (hors bande)

Rien de temps reel ne traverse le serveur distant.

## Etat des composants

| Composant | Compile | Verifie fonctionnellement | Notes |
|-----------|---------|---------------------------|-------|
| Engine C++ (WSL/GCC) | ✅ | ✅ | `./daw_engine_test` 8/8 |
| Engine C++ (MSVC) | ✅ | ✅ | Hash identique GCC |
| Server Rust | ✅ | ❌ | Ecoute sur 127.0.0.1:3000, non teste |
| Web TypeScript | ✅ | ❌ | **INCOMPATIBLE** - voir note |

**Attention critique**: Le web n'utilise PAS Automerge.
- `project.ts` ligne 6: "For slice 1, we use simple JSON-based approach"
- Web envoie du JSON, serveur attend du binaire Automerge
- Ils ne peuvent pas communiquer en l'etat

## Criteres d'acceptation

| # | Critere | Statut | Detail |
|---|---------|--------|--------|
| 1 | Rendu deterministe | ✅ VALIDE | Hash `f40af882097b704a` identique GCC/MSVC |
| 2 | Test CLI sans navigateur | ✅ VALIDE | `./daw_engine_test` 8/8 |
| 3 | Convergence 2 onglets | ⛔ BLOQUE | Web=JSON, Server=Automerge binaire |
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

### Engine (WSL/GCC)
```bash
cd engine
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4
./build/daw_engine_test
./build/daw_engine --doc ../fixtures/test.am --play
```

### Engine (Windows MSVC)
```cmd
cd engine\build-msvc
..\rebuild_msvc.bat
.\daw_engine_test.exe
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821
```

### Web
```bash
cd web
npm install
npm run build  # Compile mais non verifie
```

### Server
```bash
cd server
cargo run  # Ecoute sur 127.0.0.1:3000
```

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
- [ ] Si pas d'invite mais Fetch bloqué → LNA ne couvre pas encore WS

---

## Problemes resolus

1. ✅ **Depot git** — Initialise, premier commit `d2c5015`
2. ✅ **Fichiers temporaires** — Supprimes, .gitignore en place
3. ✅ **WebSocket Windows** — `ix::initNetSystem()` + port 47821

## Problemes ouverts

1. **Critere 3 BLOQUE - incompatibilite Web/Server**
   - Server Rust utilise `automerge` 0.5 (binaire)
   - Web TypeScript utilise JSON pur (jamais migre vers Automerge)
   - `project.ts` lignes 22-29: decode JSON, pas Automerge
   - `file_store.rs` ligne 64: `Automerge::load(&data)` attend binaire
   - **Solution**: Reecrire web avec `@automerge/automerge` reel

2. **Web incompatible avec moteur**
   - `engine_client.ts` envoie JSON, moteur attend Protobuf
   - Pas de gestion du token d'authentification
   - Port code en dur: 9000, moteur utilise 47821
