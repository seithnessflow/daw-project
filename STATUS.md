# STATUS.md

*Audit: 2026-08-20*

## Architecture

Triangle Browser ↔ Engine ↔ Server :
- **Browser ↔ Engine** : WebSocket direct sur 127.0.0.1 pour transport/telemetry (temps reel)
- **Browser ↔ Server** : WebSocket pour sync document Automerge (tolerance latence)
- **Engine ↔ Server** : HTTP pour gros transferts assets (hors bande)

Rien de temps reel ne traverse le serveur distant.

## Ce qui fonctionne (prouve)

| Composant | Commande de verification |
|-----------|--------------------------|
| Engine WSL/GCC build | `cd engine && cmake -B build && make -j4` |
| Engine MSVC build | `engine/build-msvc/daw_engine.exe` existe |
| Rendu deterministe | `./daw_engine_test` → hash `f40af882097b704a` |
| Tests integration CLI | `./daw_engine_test` → 8/8 passes |
| WebSocket server | Ecoute sur port 47821 (apres fix WSAStartup) |
| Web TypeScript build | `cd web && npm run build` → OK |

## Ce qui existe mais ne fonctionne pas

| Composant | Probleme |
|-----------|----------|
| Server Rust | Ne compile pas : `error[E0432]: unresolved import 'crate::AppState'` |
| Rendu audio (test CLI) | Peak L/R = 0 — assets non charges correctement |

## Ce qui n'existe pas

| Manque | Impact |
|--------|--------|
| Depot git | Pas de .git/, pas de .gitignore, pas de versioning |
| Test convergence 2 onglets | Server ne compile pas, critere 3 non testable |
| Test LNA documente | Critere 4 jamais execute dans Chrome |

## Criteres d'acceptation

| # | Critere | Statut | Preuve |
|---|---------|--------|--------|
| 1 | Rendu deterministe | ✅ | `./daw_engine_test` hash `f40af882097b704a` |
| 2 | Test CLI sans navigateur | ✅ | `./daw_engine_test` 8/8 |
| 3 | Convergence 2 onglets | ⛔ | Server ne compile pas |
| 4 | LNA HTTPS→WS local | ⛔ | Test manuel jamais documente |
| 5 | 10 min WASAPI sans underrun | ⚠️ | `wasapi_test.log` 0 underruns, mais sans charge CPU |

## Commandes utiles

### Engine (WSL/GCC)
```bash
cd engine
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4
./build/daw_engine_test
./build/daw_engine --doc fixtures/test.am --play
```

### Engine (Windows MSVC)
```cmd
cd engine\build-msvc
..\rebuild_msvc.bat
.\daw_engine_test.exe
.\daw_engine.exe --doc ..\fixtures\test.am --play --ws-port 47821
```

### Web
```bash
cd web
npm install
npm run build
```

### Server (BROKEN)
```bash
cd server
cargo build  # ECHOUE
```

## Problemes connus non resolus

1. **Server Rust ne compile pas**
   - Cause: `AppState` defini dans main.rs mais pas exporte vers lib.rs
   - Impact: Critere 3 non testable
   - Fix: Ajouter `pub use crate::AppState;` dans lib.rs (non fait, instruction de ne pas reparer)

2. **Assets non charges dans test CLI**
   - Observation: Peak L/R = 0 lors du rendu avec fichier test cree dynamiquement
   - Tests formels passent (fichier test interne avec asset integre)
   - Impact: Incertain

3. **Fichiers temporaires a la racine**
   - `wasapi_test.log` (8.6 MB), `engine-*.txt`, `wasapi-*.txt`, `run_engine.bat`
   - A nettoyer ou archiver

4. **Pas de depot git**
   - Aucun versioning
   - Pas de .gitignore pour exclure build/, target/, node_modules/

5. **ADR-015 obsolete**
   - Mentionne WebSocket issue comme non resolu (corrige depuis)
   - Nombre de tests incorrect (7 → 8)
