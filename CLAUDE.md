# CLAUDE.md

Instructions pour Claude Code.

## Environnement de developpement

**Plateforme:** Windows 10/11 natif uniquement. Pas de WSL.

**Toolchain:** MSVC seule. GCC/Clang uniquement en CI GitHub Actions.

## Architecture

```
Browser (TypeScript)          Server (Rust)           Engine (C++)
      │                            │                       │
      ├── WebSocket ───────────────┤                       │
      │   (Automerge sync)         │                       │
      │                            │                       │
      ├── WebSocket ───────────────────────────────────────┤
      │   (transport/telemetry)                            │
      │                                                    │
      └────────────────────────────┼── HTTP ───────────────┘
                                   (assets)
```

Rien de temps reel ne traverse le serveur distant.

## Structure

```
daw-project/
  engine/           C++ (MSVC), audio temps reel
  server/           Rust, sync Automerge
  web/              TypeScript, UI navigateur
  fixtures/         Assets de test
  docs/             ADRs et specifications
```

## Fichiers cles

| Fichier | Role |
|---------|------|
| `STATUS.md` | Etat des criteres, procedures de test |
| `docs/SCHEMA.md` | Schema du document projet (v1) |
| `engine/src/main.cpp` | Point d'entree moteur |
| `server/src/main.rs` | Point d'entree serveur |
| `web/src/main.ts` | Point d'entree web |
| `web/src/document/project.ts` | Wrapper Automerge |

## Commandes de build

### Engine (PowerShell avec VS Build Tools)

```powershell
cd engine\build-msvc
..\rebuild_msvc.bat
.\daw_engine_test.exe
```

Ou depuis Developer PowerShell:

```powershell
cd engine\build-msvc
ninja daw_engine daw_engine_test
```

### Server

```powershell
cd server
cargo run
```

### Web

```powershell
cd web
npm install
npm run dev
```

## Criteres d'acceptation

| # | Critere | Statut |
|---|---------|--------|
| 1 | Rendu deterministe | Hash `f40af882097b704a` |
| 2 | Tests CLI | 8/8 |
| 3 | Convergence 2 onglets | En attente de test |
| 4 | LNA Chrome | Non teste |
| 5 | WASAPI 10min sans underrun | Partiel (sans charge CPU) |

## Versions Automerge (ADR-016)

- Engine: automerge-c 0.3.0
- Server: automerge crate 0.11.0
- Web: @automerge/automerge 2.2.9

**Regle:** Montee de version sur les 3 etages simultanement.

## CI

GitHub Actions (`ci.yml`) build Linux/GCC et verifie:
- Compilation engine/server/web
- Tests unitaires engine
- Hash de rendu deterministe

## Conventions

- Pas d'accents dans code/commits (clavier QWERTY)
- Commits: emoji robot + Co-Authored-By Claude
- ADR pour decisions architecturales
