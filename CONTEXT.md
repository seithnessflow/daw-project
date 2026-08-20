# Contexte pour reprise de session

*Derniere mise a jour: 2026-08-20*

## Le projet en une phrase

DAW hybride: navigateur (UI) ↔ serveur Rust (sync CRDT) ↔ moteur C++ (audio temps reel).

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

## Etat actuel (commit 4adbdd7)

### Ce qui marche

| Critere | Statut |
|---------|--------|
| 1. Rendu deterministe | ✅ hash `f40af882097b704a` |
| 2. Tests CLI | ✅ 8/8 |
| 3. Convergence 2 onglets | ⏳ Code pret, test navigateur requis |
| 4. LNA Chrome | ⛔ Non teste |
| 5. WASAPI 10min | ⚠️ OK sans charge CPU |

### Versions Automerge (ADR-016)

| Etage | Package | Version |
|-------|---------|---------|
| Engine | automerge-c | 0.3.0 (monorepo 47908d6c) |
| Server | automerge (crate) | =0.11.0 |
| Web | @automerge/automerge | 2.2.9 |

**Regle critique:** Montee de version sur les 3 etages simultanement, jamais un seul.

## Fichiers cles

| Fichier | Role |
|---------|------|
| `STATUS.md` | Etat des criteres, procedures de test |
| `docs/SCHEMA.md` | Schema du document projet (v1) |
| `docs/ADR-016-*.md` | Decision versions Automerge |
| `docs/DECISIONS.md` | Historique decisions |
| `engine/src/main.cpp` | Point d'entree moteur |
| `server/src/main.rs` | Point d'entree serveur |
| `web/src/main.ts` | Point d'entree web |
| `web/src/document/project.ts` | Wrapper Automerge (recemment reecrit) |

## Commandes de demarrage rapide

```bash
# Moteur (WSL)
cd engine && cmake -B build && cmake --build build && ./build/daw_engine_test

# Serveur
cd server && cargo run  # → 127.0.0.1:3000

# Web
cd web && npm run dev   # → localhost:5173
```

## Problemes connus

1. **Web ↔ Engine incompatible** (hors scope critere 3)
   - `engine_client.ts` envoie JSON, moteur attend Protobuf
   - Port code en dur 9000, moteur utilise 47821
   - Pas de gestion token

2. **Critere 5 incomplet**
   - Test WASAPI OK mais sans charge CPU
   - Procedure dans STATUS.md section "Test 2"

## Prochaines etapes probables

1. **Tester critere 3** — ouvrir 2 onglets, modifier gain, observer convergence
2. **Tester critere 5** — relancer avec `ninja -j8` en parallele
3. **Corriger web/engine** — migrer engine_client.ts vers Protobuf + token

## Conventions du projet

- Pas d'accents dans le code/commits (clavier QWERTY)
- Commits avec emoji robot + Co-Authored-By Claude
- ADR pour decisions architecturales
- Criteres d'acceptation explicites avant implementation

## Git

```
d2c5015 Initial commit
d64eb72 Fix: Server Rust compile
3b6e0ae Audit: Web incompatible (JSON vs Automerge)
4adbdd7 Alignement Automerge: web migre vers CRDT reel  ← HEAD
```

## Pour reprendre

1. Lire `STATUS.md` pour l'etat des criteres
2. Lire ce fichier pour le contexte
3. `git log --oneline -5` pour voir les derniers commits
4. Demander a l'utilisateur ce qu'il veut faire ensuite
