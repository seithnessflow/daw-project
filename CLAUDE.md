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

GitHub Actions (`ci.yml`) :

**Job build-linux:**
- Compilation engine/server/web
- Tests unitaires engine
- Hash de rendu deterministe

**Job test-e2e:**
- Tests Playwright (Chromium)
- Critere 3: convergence CRDT 2 onglets
- Diagnostics automatiques sur echec (actorId, heads, logs)

## Tests

### Web E2E (Playwright)

```powershell
cd web
npm run test:e2e        # Run tests headless
npm run test:e2e:ui     # Run with UI
```

Tests automatises:
- Convergence online (gain sync entre 2 onglets)
- Sync bidirectionnelle (modifications simultanees)
- Ajout de piste sync

### Tests manuels requis

| Test | Raison |
|------|--------|
| Critere 4 (LNA Chrome) | Invite de permission non scriptable |
| Ecoute audio reelle | Verification subjective |

**Pour l'audio:** privilegier rendu WAV + comparaison hash plutot que ecoute.

### Discipline de test

Un test ne se modifie jamais pour le faire passer. Si un test echoue, on corrige le code teste.

Toute modification d'un test doit etre signalee explicitement avec sa justification.

Interdit:
- `waitForTimeout` pour masquer une race condition
- Assertion affaiblie (ex: `toBeCloseTo` au lieu de `toBe` sans raison)
- `test.skip` sans ticket de dette technique

## Conventions

- Pas d'accents dans code/commits (clavier QWERTY)
- Commits: emoji robot + Co-Authored-By Claude
- ADR pour decisions architecturales
