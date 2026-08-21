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

## MODE ÉCONOME — régime permanent

Tu fonctionnes en régime économe. Principe : tu restes intelligent dans le diagnostic,
mais tu deviens minimaliste dans tout le reste. Ce mode assume un sacrifice explicite :
les grosses tâches ne sont plus de ton ressort. Tu les découpes ou tu les refuses.

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

### Interdits de taille (le sacrifice assumé)

- Aucune tâche > ~30 min de travail estimé. Si on te la demande : découpe-la en
  sous-tâches de session, propose l'ordre, et fais UNIQUEMENT la première.
- Aucune implémentation multi-fichiers d'un coup. Un fichier central par session ;
  les fichiers satellites uniquement si la compilation l'exige.
- Aucun audit global, aucune revue de projet, aucun « scan pour comprendre ».
  Ces tâches se font sur demande explicite, dans une session dédiée, annoncée chère.
- Aucune réécriture. Tu édites l'existant. Si une réécriture semble nécessaire,
  tu la proposes en 3 lignes et tu t'arrêtes.

### Régime de lecture

- Au démarrage : STATUS.md seul. Pas CLAUDE.md en entier, pas l'arborescence.
- Tu n'ouvres un fichier que si la tâche courante l'exige, et tu lis la section
  utile (view avec plage de lignes), pas le fichier entier.
- Tu ne relis JAMAIS un fichier déjà lu dans la session. Ta mémoire de session fait foi.
- Interdiction des recherches larges (grep sur tout le repo) sauf si la tâche est
  littéralement « trouver où X ». Une recherche ciblée par hypothèse, maximum.

### Régime de réflexion

- Réfléchis à fond UNE fois, au début : hypothèse, plan en 3 lignes, critère de succès.
  Ensuite exécute sans re-délibérer à chaque étape.
- Pas de raisonnement exploratoire à rallonge en cours d'exécution. Si le plan
  s'effondre, tu t'arrêtes et tu rapportes — tu ne repars pas en exploration.
- Une hypothèse à la fois. Tu n'instrumentes pas trois pistes en parallèle.

### Régime d'exécution

- Builds incrémentaux uniquement. Un rebuild complet exige une justification d'une ligne.
- Une compilation par hypothèse. « Compiler pour voir » est interdit.
- Tests ciblés (--gtest_filter, playwright <fichier>, cargo test <nom>).
  La suite complète : une fois, en toute fin de session, jamais en cours.
- Réutilise la stack lancée. Tu ne relances pas serveur/moteur/web si déjà vivants.
- 3 échecs sur le même problème → STOP. État, hypothèses restantes, et tu attends.
- Toute commande estimée > 60 s part en arrière-plan immédiatement (ctrl+b / &) ;
  tu continues autre chose ou tu rends la main, tu ne bloques jamais le tour dessus.
  Une seule vérification du résultat, pas de sondage.
- cargo/cmake : compile UNE fois en arrière-plan après tes modifications, puis
  lance les tests sur le binaire compilé. Jamais de build implicite caché dans
  une commande de test au premier plan.
- Une commande = une action. Pas de chaînes kill+cd+test+filtre : quand ça
  échoue, on ne sait pas quoi relancer.

### Régime de sortie

- Sorties de commandes : les lignes utiles seulement (~20 max). Jamais de dump.
- Diffs, jamais de fichiers recollés. Aucun code déjà affiché n'est réaffiché.
- Pas de tableaux intermédiaires, pas de résumés d'étape. UN résumé final, ≤ 10 lignes.
- Pas de préambules (« Je vais maintenant... ») ni de post-ambles explicatifs.
  Tu agis, puis tu rapportes le résultat.

### Escalade (la soupape)

Certaines choses justifient de sortir du mode économe. Tu ne le fais jamais toi-même :
tu écris « ESCALADE PROPOSÉE : <raison en 1 ligne> » et tu t'arrêtes. Cas légitimes :
- bug dont le diagnostic exige une lecture large (type use-after-free transverse)
- incohérence entre STATUS.md et la réalité constatée
- correction qui toucherait le thread audio, l'auth, ou le format du document
Sur ces trois derniers domaines (thread audio, auth, format), le mode économe ne
réduit JAMAIS la vérification : tests de non-régression obligatoires, quel que soit le coût.

### Fin de session

STATUS.md (3 lignes max de delta), commit, push, résumé ≤ 10 lignes.
Vérifier qu'aucune tâche d'arrière-plan ne survit à la session (processus
lancés, jobs, suites de tests) — une tâche survivante peut corrompre un
store ou fausser la session suivante.
Ce qui n'a pas été fait est listé en une ligne chacun, sans excuse ni développement.
