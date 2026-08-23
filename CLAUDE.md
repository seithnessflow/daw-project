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

**Loi (ADR-019, reecrite 2026-08-23) : aucun audio n'est TRAITE cote
serveur ; l'audio inter-pairs voyage en P2P ; le serveur ne fait que du
signaling (+ TURN eventuel).** L'ancienne phrase « rien de temps reel ne
traverse le serveur distant » est abrogee.

**L'INVARIANT PRODUIT : un pair qui n'a pas le plugin installe entend le
resultat du plugin.** (ADR-019 ; etat et chemin dans STATUS.md.) La
roadmap de parite Ableton est GELEE tant que placement + stems +
critere 3 deux-machines ne sont pas verts.

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
| `STATUS.md` | ETAT courant : criteres, composants, procedures vivantes |
| `JOURNAL.md` | Chronique datee append-only (les recits de session) |
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

Un seul proprietaire : le tableau vit dans STATUS.md (regle AUDIT-4,
un proprietaire par information — ce fichier ne le duplique plus).

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

La liste des specs vit dans `web/tests/e2e/` (15 fichiers au dernier
compte) — ce fichier ne la duplique plus.

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
- SPLITTER AU MAXIMUM (regle 2026-08-22) : toujours preferer plusieurs
  petits fichiers a un gros — CSS en modules par zone (HMR par fichier,
  jamais de <style> dans index.html), logique en modules par
  responsabilite. Un fichier qui grossit se remanie sans hesiter ; le
  harnais de contrats est la pour ca.

## Outillage UI/audio — les yeux et l'oreille (chantier UI)

Boucle permanente : modifier (petit lot, hot-reload) -> `npm run snap` ->
grille (1 casse / 2 ergonomie : corriger seul ; 3 concept : proposer et
attendre ; 4 gout : ne jamais trancher) -> chemin audio touche ? ->
`npm run ear` -> toutes les ~10 iterations ou niveau 3-4 : full.png +
3 lignes, attendre. Invariants Playwright verrouilles AVANT toute refonte.

Securite auditive, non negociable : mes runs moteur = `--mute` ; jamais de
lecture audible de ma propre initiative ; avant toute ecoute utilisateur et
apres toute modif du chemin audio : `ear` d'abord (crete > -1 dBFS, clip,
discontinuite = rouge, on corrige AVANT). Toute mesure affichee (VU, etc.)
recoit un test au signal connu (ton 2.4b, valeur assertee exactement).
Ecoute selective : `npm run ear -- --solo <piste> --bypass/--no-bypass`.

Les deux gestes de la boucle complete (consignes 2026-08-22) :
- USAGE LIBRE obligatoire par session UI : dix minutes de manipulation
  exploratoire (pas les gestes scriptes — chercher ce qui cloche en
  utilisateur impatient, grille en tete). Les scripts attrapent les
  regressions ; l'usage libre attrape les decouvertes (precedent : la
  tete de lecture fugueuse).
- LOT MUR = ONGLET OUVERT : quand un lot merite un verdict humain,
  OUVRE l'onglet toi-meme (`start chrome <url>`), etat charge, et
  annonce en <= 3 lignes ce qui a change et quoi essayer. Ne jamais
  demander a l'utilisateur de lancer quoi que ce soit.

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
- Aucun refactor ni amélioration spontanés EN COURS DE SESSION — une ligne de
  signalement suffit. Les refontes passent par le circuit critique ci-dessous.
- Escalade au lieu de bricoler : « ESCALADE PROPOSÉE : <raison> » puis stop, pour
  toute décision d'architecture, dépendance immature, ou incohérence STATUS.md/réel.
- Nuance (gravée après la révision de profondeur du pipeline, 2026-08-22) :
  une décision d'ENTRÉE contredite par une MESURE peut être révisée en session
  si le périmètre ne bouge pas ET que la révision est documentée partout
  (TODO, STATUS, contrat/ADR concerné). Tout changement de MÉCANISME
  (abandonner le ring, changer d'IPC…) reste une escalade, mesure ou pas.
- Thread audio, auth, format du document : jamais d'économie de vérification.
  Tests de non-régression obligatoires, quel que soit le coût.

### Critique et refonte — le compromis

La critique est illimitée ; l'action reste bornée. On ne construit pas
par-dessus un morceau identifié comme mal conçu.

- Critique sans plafond : tout défaut de conception constaté se signale,
  technos et dépendances comprises. Le scan complet du projet est légitime,
  mais en session d'audit dédiée (regard neuf, lecture seule, rapport).
- Chaque trouvaille passe la grille, jamais l'inverse :
  1. Le chantier en cours s'appuie dessus → PRÉALABLE, session bornée avant.
  2. Mal conçu, même isolé → REFONTE PLANIFIÉE : session(s) bornée(s) dédiée(s),
     avec test de non-régression, AVANT que quoi que ce soit ne s'y adosse.
  3. Défaut cosmétique ou spéculatif → dette datée avec déclencheur mesurable.
- Remplacement de techno : jamais en direct. Dossier en 5 lignes d'abord
  (défaut prouvé, remplaçant, coût de migration, risque, critère de succès),
  décision explicite, puis sessions bornées. Précédent : samod (escaladé,
  décision B, veille avec critère de sortie).
- Le cap (VST3) reprend dès que les items 1 et 2 issus du dernier audit sont
  soldés — il peut être retardé par la qualité, jamais dilué par elle.
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

### Modification = vérifier le rayon de couplage

Corriger à la volée ce que la modification touche, pour ne pas y revenir
en session N+2. Coût assumé : quelques vérifications de plus par session
contre des allers-retours en moins.

- Avant le commit, vérifie les trois couplages du code modifié :
  1. APPELANTS — qui consomme ce que je viens de changer (une recherche ciblée) ;
  2. JUMEAUX — le même comportement implémenté ailleurs (protos dupliqués,
     helpers de test copiés : c'est là que naissent les régressions à
     retardement) — si un jumeau existe, corrige les deux OU signale-le en
     candidat refonte (grille, sortie 2). Precedent buildGraph : le noyau
     partage (geometrie de clip + gain, les champs qui nourrissent le hash)
     vit dans graph/graph_common.h ; l'instanciation des plugins reste
     VOLONTAIREMENT divergente (live async ProxyNode vs offline sync
     SyncProxyNode) — deux modeles d'execution, pas un jumeau ;
  3. CONTRAT — schéma, protocole, constante partagée entre étages : si le
     contrat bouge, chaque étage consommateur se vérifie dans la MÊME session.
- Zones sensibles (thread audio, auth, format, sync) : relis l'invariant écrit
  en tête du fichier avant de toucher, pas le fichier entier.
- Le commit n'est posé qu'une fois le point modifié ET ses consommateurs
  directs couverts par un test qui tourne.

### Sorties
- Sorties de commandes : les lignes utiles (~20 max), jamais le dump.
- Diffs, jamais de fichiers recollés. Aucun code déjà affiché n'est réaffiché.
- Pas de préambules ni de tableaux d'étape. UN résumé final, ≤ 10 lignes,
  avec le non-fait en une ligne par item, sans excuse.

### Fin de session
- Aucune tâche d'arrière-plan ne survit à la session. Vérifie et tue.
- STATUS.md (delta 3 lignes max), commit, push.
- AUCUNE session ne se clôt sur un push dont la sentinelle CI n'a pas rendu
  verdict, OU dont le verdict attendu n'est pas explicitement transmis à la
  session suivante comme PREMIER point de synchronisation. Le rituel exige
  le verdict, pas la surveillance. (Leçon : 47 runs rouges jamais regardés.)
