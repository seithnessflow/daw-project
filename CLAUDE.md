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
| 1 | Rendu deterministe | Hash `89f1a1105dc09e92` |
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

---

## RÉGIME DE SESSION — économe, fluide, sans temps mort

Objectif : dépenser les tokens en raisonnement et en code, jamais en friction,
en attente ni en remplissage. Ces règles priment sur le confort.

### Machine (Ryzen 9 3950X — 16C/32T, 32 Go RAM, SSD NVMe ~1 To)

- Le coût est en TOKENS, jamais en machine : ce PC encaisse tout. Quand deux
  stratégies existent, choisis celle qui brûle du CPU plutôt que des tokens.
- Toute commande longue (build, suite de tests) : sortie redirigée vers un
  fichier, tu ne lis que les ~20 dernières lignes ou un filtre d'erreurs.
- ninja sans limite de -j (32 threads dispo) ; un rebuild complet moteur
  prend ~2-3 min — interdit non pour le temps, mais pour le bruit de sortie.
- Charge CPU pour le critère 5 : `ninja clean && ninja -j32` est le
  générateur de charge idéal sur cette machine.
- Playwright reste workers=1 (partage du serveur/port), pas une limite CPU.
- 32 Go de RAM : jamais besoin de fermer la stack pour compiler. Tout
  coexiste (serveur + moteur + vite + build parallèle).

### Démarrage
- Lis STATUS.md et l'entrée TODO.md de la tâche. Rien d'autre. Pas de scan du projet.
- Plan en 3 lignes max : hypothèse, actions, critère de succès. Puis agis.
- Si la session est de l'exécution cadrée (causes connues, plan écrit), dis-le en
  première ligne : Sonnet suffit pour cette session.

### Périmètre
- Une tâche par session. Tâche > ~30 min estimées → découpe, propose l'ordre,
  fais UNIQUEMENT la première partie.
- Aucun refactor, nettoyage ou amélioration non demandés — une ligne de signalement
  en fin de session suffit.
- Escalade au lieu de bricoler : « ESCALADE PROPOSÉE : <raison> » puis stop, pour
  toute décision d'architecture, dépendance immature, ou incohérence STATUS.md/réel.
- Thread audio, auth, format du document : jamais d'économie de vérification.
  Tests de non-régression obligatoires, quel que soit le coût.

### Exécution — jamais d'attente à vide
- Toute commande > 30 s part en arrière-plan IMMÉDIATEMENT, et tu enchaînes sur
  du travail d'édition : écrire le test suivant, préparer le diff, STATUS.md.
  Récolte du résultat une seule fois, à un point de synchronisation. Pas de sondage.
- Rien à entrelacer pendant une attente → rends la main : « <tâche> tourne en fond,
  je peux faire X ou Y pendant ce temps — je continue sur quoi ? »
- JAMAIS deux exécutions concurrentes sur la même stack (ports, stores, binaires
  partagés). On entrelace de l'édition pendant une exécution, pas deux exécutions.
- Compile UNE fois en arrière-plan après tes modifications (cargo test --no-run,
  build incrémental cmake), puis lance les binaires de test directement. Pas de
  build implicite caché dans une commande de test au premier plan.
- Rebuild complet interdit sans justification d'une ligne.
- Tests ciblés (--gtest_filter, playwright <fichier>, cargo test <nom>). La suite
  complète : une fois, en fin de session.
- Une commande = une action. Pas de chaînes kill+cd+test+filtre.
- Une hypothèse instrumentée par exécution. « Lancer pour voir » est interdit.
- 3 échecs sur le même problème → STOP : état, hypothèses restantes, attends.

### Sorties
- Sorties de commandes : les lignes utiles (~20 max), jamais le dump.
- Diffs, jamais de fichiers recollés. Aucun code déjà affiché n'est réaffiché.
- Pas de préambules ni de tableaux d'étape. UN résumé final, ≤ 10 lignes,
  avec le non-fait en une ligne par item, sans excuse.

### Fin de session
- Aucune tâche d'arrière-plan ne survit à la session. Vérifie et tue.
- STATUS.md (delta 3 lignes max), commit, push.
