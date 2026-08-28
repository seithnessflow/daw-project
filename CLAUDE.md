# CLAUDE.md — regime de travail (regles vivantes seulement)

Ce fichier ne contient que des REGLES EN VIGUEUR, au present. Ni
historique, ni etat, ni file : l'etat vit dans STATUS.md, la file dans
TODO.md, le recit et les « pourquoi » dans JOURNAL.md et
docs/DECISIONS.md. Version integrale precedente (avec historique) :
docs/archive/CLAUDE-integral-2026-08-27.md.

## 1. Environnement

- **Plateforme** : Windows 10/11 natif uniquement. Pas de WSL.
- **Toolchain** : MSVC seule en local. GCC/Clang uniquement en CI
  GitHub Actions (`.github/workflows/ci.yml` = recette de build de
  reference, pins automerge-c et SDK VST3 compris).
- **Machine** : Ryzen 9 3950X (16C/32T), 32 Go, NVMe. Le cout est en
  TOKENS, jamais en machine : entre deux strategies, brule du CPU
  plutot que des tokens. `ninja` sans limite de `-j` ; tout coexiste
  en RAM (serveur + moteur + vite + build).
- **Audio** : tour = 2x Adam T8V + casque via Antelope Zen Go (driver
  ZenGo SC). Portable TX15 = enceintes faibles. Une difference de son
  entre les deux machines est materielle, pas un bug de rendu.

## 2. Architecture (rappel — le detail est dans docs/)

```
Browser (TypeScript)          Server (Rust)           Engine (C++)
      ├── WS (Automerge sync) ──┤                       │
      ├── WS 127.0.0.1 (protobuf : transport/telemetrie/commandes) ──┤
      └──────────────────────────┼── HTTP (store d'assets SHA-256) ──┘
```

- **Loi (ADR-019)** : aucun audio n'est TRAITE cote serveur ; l'audio
  inter-pairs voyage en P2P ; le serveur ne fait que du signaling
  (+ TURN eventuel) et sert le store.
- **L'invariant produit (ADR-019)** : un pair qui n'a pas le plugin
  installe entend le resultat du plugin (stems rendus au store).
- **Le document est la verite, le graphe une projection** (ADR-002/004).
  Toute position temporelle = int64 (samples OU ticks v2), jamais un
  float (ADR-003, SCHEMA.md invariant 1).
- **Plugins VST3 hors processus** (ADR-017) : un enfant `plugin_host.exe`
  par instance, ring memoire partagee = contrat binaire (layout
  versionne, asserts d'offsets).
- **Versions Automerge (ADR-016)** : montee de version sur les 3 etages
  SIMULTANEMENT, jamais un seul. Table des versions : le fichier ADR.
- **Garde-fou anti-clone (ratifie 2026-08-27)** : la parite Ableton n'est
  pas un but. Toute surface nouvelle NOMME sa contribution au
  differenciateur (collab / stems / P2P) ou reste en file. Le gel
  litteral d'ADR-019 §6 est amende (ordre grave item par item).

## 3. La carte des documents — UN proprietaire par information

| Fichier | Possede | Ne contient JAMAIS |
|---|---|---|
| `REPRISE.md` | le digest 30 s de la derniere session : ou on en est, point de synchro, quoi surveiller, la suite. VOLATILE, reecrit a chaque cloture | une information dont il serait le seul proprietaire |
| `STATUS.md` | l'ETAT courant : invariant, criteres, composants, perf, commandes | du recit date, des items de file |
| `TODO.md` | la FILE : ordre grave, decisions ouvertes, dettes datees, backlog | des items faits (ils vont au JOURNAL et sont SUPPRIMES) |
| `JOURNAL.md` | le recit date, append-only | des regles |
| `docs/DECISIONS.md` | les ADR et les decisions produit + resultats de tests (hashes, mesures) | de l'etat courant |
| `docs/SCHEMA.md` | le contrat du document (source de verite des 3 etages) | — |
| `SECURITY.md` | l'etat securite : corrige / reste | — |
| `STYLE.md` | la memoire de gout de l'UI | — |
| `docs/README.md` | l'index des docs avec leur statut | — |
| `docs/audits/` | les rapports d'audit (lecture seule, dates) — leurs reliquats ouverts sont TRACES DANS TODO | — |
| `docs/archive/` | les documents morts, conserves lisibles | — |

Regles :
- Un document qui cite un etat renvoie a son proprietaire au lieu de
  le copier (« voir STATUS », jamais un chiffre recopie).
- Le fait va au JOURNAL ; l'item de TODO qui est fait est SUPPRIME de
  TODO (pas coche-et-garde). TODO ne grossit pas.
- Chaque doc de docs/ porte en tete une ligne `Statut :` (vivant /
  livre / proposition / reference / archive) — c'est elle qu'un lecteur
  neuf croit.
- Une regle nouvelle s'ecrit ICI au present, sans son histoire ; le
  pourquoi va dans DECISIONS ou JOURNAL.

## 4. Rituel d'ouverture (a CHAQUE demarrage, dans l'ordre, sans scanner)

1. Lire `REPRISE.md` -> `STATUS.md` -> le bloc ORDRE GRAVE de `TODO.md`.
   Rien d'autre.
2. Honorer le point de synchro : verdict CI / build / test annonce en
   attente = le lever AVANT de coder (`gh run list --limit 3`). En cours
   de session, la CI ne se consulte qu'au dernier push (§5).
3. Verifier qu'aucune tache d'arriere-plan de la veille ne survit
   (moteur / serveur / vite / `plugin_host` orphelins).
4. Plan en 3 lignes max (hypothese, actions, critere de succes), puis
   agir. Execution cadree (causes connues, plan ecrit) : le dire en
   premiere ligne.
5. Relancer la stack seulement pour voir/entendre : `start-daw.cmd`
   ou `scripts\daw.ps1 -Secure` ; arret `stop-daw.cmd`.

## 5. Rituel de cloture

1. Aucune tache d'arriere-plan ne survit a la session : verifier, tuer.
2. STATUS.md : delta 3 lignes max. TODO.md : items faits SUPPRIMES,
   nouveaux items a leur place. JOURNAL.md : le recit.
3. Commit, push.
4. REECRIRE REPRISE.md (digest 30 s).
5. Le verdict CI se lit UNE fois par session, sur le DERNIER push (pas
   apres chaque commit — arbitrage utilisateur 2026-08-28 : « la CI peut
   etre verifiee moins souvent »). Les pushes intermediaires ne
   s'attendent pas. Ce qui reste absolu : aucune session ne se clot sans
   connaitre le verdict du dernier push, OU sans le transmettre a la
   session suivante comme PREMIER point de synchro (lecon des 47 runs
   rouges jamais regardes). Une CI rouge en cours de session = on
   s'arrete et on regarde.

## 6. Regime de livraison (prime sur tout)

1. Chaque session se termine par une manip que l'utilisateur peut VOIR
   ou ENTENDRE en 5 min avec une consigne d'une ligne — pas un rapport,
   pas une CI verte. Session qui ne peut pas : le dire A L'OUVERTURE et
   proposer un decoupage.
2. Boucle de bug bornee a DEUX sessions. Au-dela : stop, une phrase
   sans jargon, trois options chiffrees (contourner / reparer / abandonner).
3. **ORDRE GRAVE** : la file (TODO.md) ne se reordonne pas sans
   l'utilisateur ; une demande HORS ORDRE se NOMME (« ceci passe devant
   X — je le fais ? ») avant execution. Une addition de la taille d'une
   feature se PROPOSE avant d'etre livree, meme brillante.
4. Sur un travail deja cadre (ordre grave, arbitrage ratifie) :
   executer de bout en bout sans demander de confirmer commit/push/
   suite ; rendre compte APRES.

## 7. Perimetre, escalade, critique

- Une tache par session. Tache > ~30 min estimees -> decoupe, propose
  l'ordre, fais UNIQUEMENT la premiere partie.
- Aucun refactor spontane EN COURS de session : une ligne de
  signalement. Les refontes passent par la grille ci-dessous.
- **ESCALADE PROPOSEE : <raison>** puis stop, pour toute decision
  d'architecture, dependance immature, ou incoherence STATUS/reel.
  Nuance : une decision d'ENTREE contredite par une MESURE se revise en
  session si le perimetre ne bouge pas ET que la revision est ecrite
  partout (TODO, STATUS, ADR concerne). Changer de MECANISME (ring, IPC,
  CRDT) reste une escalade.
- Thread audio, auth, format du document, sync : jamais d'economie de
  verification ; tests de non-regression obligatoires ; relire
  l'invariant en tete du fichier avant de toucher.
- Nouvelles technos : bienvenues, surtout en outillage/test ; noter le
  pourquoi en une ligne. Remplacer un PILIER (langage moteur, CRDT) se
  signale avant, pas interdit.
- **La grille** (chaque trouvaille la passe, jamais l'inverse) :
  1 casse / 2 ergonomie : corriger seul ; 3 concept : proposer et
  attendre ; 4 gout : ne jamais trancher. Sorties : (1) le chantier en
  cours s'appuie dessus -> PREALABLE borne ; (2) mal concu meme isole ->
  REFONTE PLANIFIEE avec test de non-regression AVANT qu'on s'y adosse ;
  (3) cosmetique/speculatif -> dette datee avec declencheur mesurable.
- Audits : sessions dediees, lecture seule, regard neuf, rapport dans
  `docs/audits/`, arbitrage par la grille ensuite — jamais une passe de
  coherence en direct pendant un chantier. Un rapport d'agents contient
  1-2 inexactitudes sur 40 : chaque session issue d'un audit commence
  par REPRODUIRE (un test qui echoue) avant de corriger.
- MANUEL LIVE 12 = reference PONCTUELLE (une question precise deja
  posee), jamais une source d'items. DSP : litterature VCV Rack.
  Synthese acquise : docs/ABLETON-INTEGRALE.md.

## 8. Verification : mes yeux et mon oreille, jamais les siens

NE JAMAIS demander a l'utilisateur de tester ce que je peux voir.

- **Pilotage reel** : extension Chrome (claude-in-chrome) sur les VRAIS
  onglets (read_page/a11y d'abord — les pixels mentent en petite
  fenetre) ; Playwright sur des onglets jetables ; sur l'autre machine,
  Playwright par ssh avec `channel:'chrome'` (jamais telecharger de
  navigateur sur le reseau de l'utilisateur).
- **La boucle** : voir l'etat reel (badges, data-state, compteurs
  `window.__daw*`) -> sonde MINIMALE d'un seul maillon -> fix ->
  push/pull (chaque machine sert SON repo) -> re-voir. Toujours
  verifier « qui fait quoi » avant d'accuser le reseau.
- **Pieges** : un onglet pilote en ARRIERE-PLAN est throttle (jamais de
  role temps reel) ; tout process GUI lance via sshd vit en session 0
  (invisible) — fenetre sur le vrai bureau distant = tache planifiee
  interactive ; un onglet que l'utilisateur ne voit pas n'existe pas
  pour lui.
- **« X marche pas » alors que mes pilotes sont verts** : verifier SON
  onglet / SA connexion d'abord (logs moteur : zero trace = probleme de
  connexion), et rendre tout echec VISIBLE dans l'UI.
- **Un silence MESURE par la telemetrie n'est pas un silence** : avant
  d'accuser l'audio, lire `control-loop stall:` dans le log moteur (la
  telemetrie vit sur la boucle de controle ; un gel = meters figes,
  ring deborde). Precedent 2026-08-28 : « note muette » = PUT d'asset
  de 2 s. Instrumenter (cote child : note-on / skip / torn) avant de
  conjecturer.
- **Boucle UI** : petit lot (hot-reload) -> `npm run snap` -> grille ->
  chemin audio touche ? -> `npm run ear` -> toutes les ~10 iterations ou
  niveau 3-4 : full.png + 3 lignes, attendre. Invariants Playwright
  verrouilles AVANT toute refonte.
- **Securite auditive (non negociable)** : mes runs moteur = `--mute` ;
  jamais de lecture audible de ma propre initiative ; avant toute ecoute
  utilisateur et apres toute modif du chemin audio : `ear` d'abord
  (crete > -1 dBFS, clip, discontinuite = rouge, on corrige AVANT).
  Toute mesure affichee (VU...) recoit un test au signal connu.
  Exception accordee : pour tester le son, je peux declencher play et
  bouger plugins/params — en surveillant le gain (mesurer d'abord,
  proteger les T8V). **Instrument LIVE (MIDI-in) : `ear` n'existe pas
  pour lui — MESURER en `--mute` d'abord (crete de la piste dans les
  meters), et n'ecouter qu'avec le gain de la piste plafonne (<= 0,25).**
  Et lire les cretes avec un outil qui comprend la notation scientifique
  des flottants C++ (`awk '{v=$3+0}'`), jamais `sort -n` — une fausse
  alerte a +19 dBFS est nee de la le 2026-08-28.
- **LE RITUEL DU COMPOSITEUR** : chaque session qui touche le socle se
  verifie en COMPOSANT un projet par l'UI seule (menu -> pistes ->
  matiere -> notes -> mix -> ecoute -> export), jamais cote serveur/
  document. Les specs prouvent que rien ne casse ; la composition revele
  ce qui est MAL CONCU. Multiplier les gestes est la methode.
- **USAGE LIBRE** par session UI : dix minutes de manipulation
  exploratoire en utilisateur impatient, grille en tete.
- **LOT MUR = ONGLET OUVERT** : quand un lot merite un verdict humain,
  j'ouvre l'onglet moi-meme (`start chrome <url>`), etat charge, et
  j'annonce en <= 3 lignes ce qui a change et quoi essayer.
- **TRACE VISUELLE** : toute seance UI livre ses captures (screenshot a
  chaque geste significatif ou gif). L'utilisateur juge sur la trace.
- **CRITIQUE PERMANENTE** : chaque passage dans l'interface est une
  occasion de critique ergonomie/fonctionnalites au fil de l'eau, grille
  en tete.

## 9. Execution economes

- Toute commande > 30 s part en arriere-plan IMMEDIATEMENT ; j'enchaine
  sur de l'edition ; recolte UNE fois a un point de synchro. Rien a
  entrelacer -> rendre la main.
- JAMAIS deux executions concurrentes sur la meme stack (ports, stores,
  binaires). Une commande = une action. Une hypothese instrumentee par
  execution ; « lancer pour voir » est interdit.
- Compile UNE fois en arriere-plan apres les modifs, puis lance les
  binaires de test directement. Rebuild complet : justification d'une
  ligne. Tests cibles (`--gtest_filter`, `playwright <fichier>`,
  `cargo test <nom>`) ; la suite complete une fois en fin de session.
- 3 echecs sur le meme probleme -> STOP : etat, hypotheses restantes.
- Sorties : ~20 lignes utiles max, jamais le dump (longues commandes ->
  fichier, lire la fin ou un filtre). Diffs, jamais de fichiers
  recolles. UN resume final <= 10 lignes, le non-fait en une ligne par
  item, sans excuse.

## 10. Modification = verifier le rayon de couplage

Avant le commit, trois couplages du code modifie :
1. APPELANTS — qui consomme ce que j'ai change (une recherche ciblee).
2. JUMEAUX — le meme comportement implemente ailleurs (protos dupliques
   web/engine, helpers copies, `256` en dur, chemin token...) : corriger
   les deux OU signaler en candidat refonte. Exception VOULUE :
   l'instanciation des plugins live (ProxyNode async) vs offline
   (SyncProxyNode) — deux modeles d'execution, pas un jumeau.
3. CONTRAT — schema, protocole, constante partagee entre etages : si le
   contrat bouge, chaque etage consommateur se verifie dans la MEME
   session. Layout d'une struct partagee (ring, AudioCommandMessage)
   change => CLEAN build (`ninja clean`), l'incremental a deja produit
   un moteur qui mourait avec des gtests verts.

Le commit n'est pose qu'une fois le point modifie ET ses consommateurs
directs couverts par un test qui tourne.

## 11. Discipline de test

- Un test ne se modifie jamais pour le faire passer : on corrige le
  code teste. Toute modification d'un test est SIGNALEE avec sa
  justification.
- Interdit : `waitForTimeout` pour masquer une race ; assertion
  affaiblie sans raison ecrite ; `test.skip` sans ticket de dette.
- Playwright `workers=1` (partage du serveur/port). Les specs moteur
  reel exigent le port 47821 LIBRE. Jamais de fichier temporaire de
  test dans `web/` (vite le surveille -> EBUSY en boucle) : scratchpad.
- Scripts de trace/pilotage : projets prefixes `trace-` (masques par le
  menu), jamais un nom nu ; le store est partage entre tests (meme
  contenu = meme hash deja present).
- Pour l'audio : rendu WAV + hash/ear plutot qu'ecoute.

## 12. Conventions

- Pas d'accents dans code/commits (clavier QWERTY). Commits : emoji +
  `Co-Authored-By: Claude`. ADR pour toute decision d'architecture.
- **SPLITTER AU MAXIMUM** : plusieurs petits fichiers plutot qu'un gros
  (CSS en modules par zone, jamais de `<style>` dans index.html ;
  logique en modules par responsabilite). Un fichier qui grossit se
  remanie sans hesiter.
- **Ergonomie gravee** : une cible cliquable plus petite que ses
  poignees est inatteignable — chaque poignee garde une branche « clic
  sans mouvement » (selection). Une action qui produit plusieurs effets
  les montre TOUS (un effet de bord non annonce = « le logiciel agit
  tout seul »). Un refus se rend VISIBLE (flash, entree absente,
  bandeau), jamais silencieux.
- Sonde/etat de test expose sur `window.__daw*` (l'idiome qui rend le
  pilotage possible).
- Avant tout rebuild moteur : tuer les `plugin_host.exe` zombies
  (`Get-Process plugin_host | Stop-Process -Force` ; `taskkill` echoue)
  sinon LNK1168.

## 13. Commandes

```powershell
# Moteur (PowerShell avec VS Build Tools)
cd engine\build-msvc ; ..\rebuild_msvc.bat ; .\daw_engine_test.exe   # tout vert attendu
# Serveur
cd server ; cargo run          # 127.0.0.1:3000 ; cargo test
# Web
cd web ; npm install ; npm run dev ; npm run test:e2e   # specs : web/tests/e2e/
# Stack complete
start-daw.cmd / stop-daw.cmd   # ou scripts\daw.ps1 [-Secure] [-Stop] [-Mute]
```

Tests manuels irreductibles : critere 4 (invite LNA Chrome) et l'ecoute
subjective. Details, procedures et etat : STATUS.md.
