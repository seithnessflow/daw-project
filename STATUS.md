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
| Engine C++ (MSVC) | ✅ | ✅ | `daw_engine_test.exe` 20/20 |
| Engine C++ (GCC/CI) | ✅ | ✅ | PREMIER RUN VERT 2026-08-22 (run #48, a91d57b) : 14 tests moteur sous Linux dont hash + plugin_host/AGain, E2E complet. Avant lui : 47 runs rouges jamais regardes (lecon inscrite au regime) |
| Server Rust | ✅ | ✅ | Ecoute sur 127.0.0.1:3000 |
| Web TypeScript | ✅ | ✅ | Automerge reel, critere 3 valide |

**Note:** Developpement 100% natif Windows (MSVC). GCC uniquement en CI.

**2026-08-22 (CI-verite):** premier run CI vert de l'histoire du projet —
https://github.com/seithnessflow/daw-project/actions/runs/32531658552 —
moteur + SDK VST3 + determinisme valides sur un second OS jamais utilise
pour developper. STATUS ne contient plus de phrase que le reel contredit.

**2026-08-22 (R1+R2):** construction du graphe sortie du thread reseau
(boucle principale, snapshot sous verrou, dernier etat gagne, version
loggee) ; registre d'instances plugins (ADR-017) en place ; test de
rafale = la preuve de coalescing dont le chantier VST3 dependra.

**2026-08-22 (R4+S4):** le thread sacre est desormais verifie par le
compilateur (static_assert lock-free sur tous les types partages avec le
callback + test runtime) ; spinlock atomic<shared_ptr> sorti du callback
(retention par generation, ADR-010 annote) ; solo/mute atomiques (S4 solde).

**2026-08-22 (S1 hygiene CI):** pushes markdown-only ne declenchent plus de
run (piege branches-protegees documente) ; build tree SDK en cache actions,
cle = pin + hash de cmake/vst3sdk.cmake (extrait du CMakeLists pour survivre
aux editions engine). Runs froids reels : ~12 min (#50/#51), verdicts verts.
A chaud : 4,4 min (run #52) — critere atteint.

**2026-08-22 (2.4c-1):** le pont est transparent au bit pres (tests 15-16,
16/16) ; rafale E2E verte a travers le proxy ; smoke WASAPI 10 s : 0
underrun. Profondeur de pipeline revisee 1->2 sur preuve vivante (534/1875
blocs sec en depth 1 : le driver livre 2 blocs dos a dos) — latence 2.4d
= depth x 256, calculee depuis la profondeur vivante du noeud (jamais une
constante). Layout v2, enfant traite le backlog dans l'ordre.

**2026-08-22 (2.4c-2):** seqlock param (layout v3) ; kill en plein vol ->
bypass sec exact + relance a froid sur le meme segment, param survivant
(test 18) ; garde parent (plus d'orphelin apres kill dur du moteur) ; chain
lu/ecrit (M3 solde), ProxyNode depuis le document, rendu offline prouve par
echantillons (test 20), uid non resolu = echec bruyant. 20/20, E2E 4/4.

**2026-08-22 (2.4d — LE JALON):** un toggle bypass clique dans le navigateur
change le son, prouve par echantillons, a travers AGain dans son processus
(E2E 10/10). getLatencySamples = calcul (depth vivante), telemetrie honnete ;
bypass = etat du document, un chemin vivant pour les deux constructeurs.
La tranche 2.4 (hote VST3, tranche fine) est TENUE.

**2026-08-22, verdict final — run #55 (d034102) VERT en 4,3 min :** la
promesse du premier message du chantier est tenue mot pour mot, jusqu'a
« depuis un onglet ». Quatre sessions (hygiene CI, c-1, c-2, 2.4d), cinq
pushes, cinq verdicts verts, zero dette de verdict.

**Nuit du 2026-08-22 (post-jalon, runs #56-58 verts) :** outillage du test
des mains (docs/test-des-mains-2.4.md + seed teste), elagage docs (prealable
4 enfin solde), persistance outbox (dette critere 3, spec 11/11).
PROCHAINE ETAPE, dans l'ordre : 1. LE TEST DES MAINS (runbook pret,
intrant obligatoire) ; 2. session 2.5 re-cadrage, qui OUVRE sur ces notes.
Critere 5 sous charge : au backlog expres (exige du son reel sur le ZenGo).

**Nuit du 2026-08-22, suite — 2.3 solde :** assetHash = SHA-256 reel
(vecteurs FIPS, 21/21) ; store d'assets adresse par contenu sur le serveur
(PUT VERIFIANT — il a debusque un jumeau FNV dans create_test_doc a sa
premiere execution) ; le moteur tire les assets manquants du store en mode
serveur (preuve E2E asset-fetch, 12/12). Le triangle de l'architecture est
FERME sur ses trois cotes. Verdict final de nuit : run #60 VERT (4,6 min).
Bilan de la nuit : runs #56-60, cinq verts, zero dette. Au reveil : le
test des mains (docs/test-des-mains-2.4.md), puis 2.5.

**2026-08-22 (outillage yeux+oreille) :** `npm run snap` (Playwright sur la
stack vivante, 2 viewports, --two-tabs) et `npm run ear` (rendu offline de
l'etat courant + analyseur WAV pur Node, gate -1 dBFS/clip/discontinuite,
ecoute SELECTIVE par chirurgie de snapshot : --solo/--mute/--bypass).
Calibre sur le ton connu (-12,04/-15,05 dBFS assertes), rouge prouve
(clip+saut injectes detectes), contribution AGain mesuree a 6,03 dB
(=0,5 exact). Self-test analyseur en CI ; snap/ear restent hors CI (stack
vivante). Boucle + securite auditive gravees dans CLAUDE.md.

**2026-08-22 (refonte UI, lot 1 — le contrat avant le pixel) :** test des
mains REPORTE (decision utilisateur : produit trop embryonnaire) et requalifie
en GATE DE SORTIE de la refonte ; metaphore RATIFIEE : timeline d'abord.
Contrat de selection pose (data-role/data-state + ARIA, jumeaux helpers/diag
fusionnes, zero pixel change) — suite e2e 12/12 en 1,7 min comme preuve,
snap re-ancre sur le contrat. La refonte peut etre agressive : les tests
tiennent la semantique, les pixels sont libres.

**2026-08-22 (le labo — l'agent utilise le site et ecoute) :** projet 'lab'
seede par make-signals.mjs (5 types de signaux etages, PUT verifiant) ;
ui-drive.mjs = usage scripte du site (6 gestes, tous verts : faders, bypass
via doc, playhead vivant, convergence 2 onglets, add track) ; batterie ear
en solo par piste : la chaine geste UI -> document -> moteur -> enfant VST3
-> rendu est EXACTE au centieme de dB (sine 0,25 x fader 0,9 x AGain 0,5 =
-18,97 predit, -18,98 mesure ; RMS saw/noise/sweep exacts silence compte).
Trouvailles : inter-sample peaks reels (~2 dB) sur fronts raides, lecture
chaude (+5,6 dB) du true peak sur bruit (note calibration) ; playhead qui
fuyait hors couloir (ui-drive) -> clamp pose. Moteur agent = --mute (regle).

**2026-08-22 (Magic Potion, phase 1 — la purge et la vraie matiere) :**
le produit s'appelle Magic Potion (titre/README ; renommage infra = backlog).
Fixtures hors du chemin produit : KIT + labo derriere ?lab=1 (les organes
snap/drive et les specs sont le harnais, ils le portent). Le produit mange
TES fichiers : drop d'un WAV sur un couloir -> hash client (SHA-256) -> PUT
verifiant -> clip pose au point de drop, duree decodee ; palette generique
construite des assets du PROJET (l'armer/cliquer survit sans kit de demo).
Preuve pilote (geste 12, mode produit) : zero chip embarque, hint d'etat
vide, drop -> clip -> asset 200 au store -> chip 'my-note' dans la palette.
Drive 12 gestes verts, suite 13/13.

**2026-08-22 (Magic Potion, phase 2 — tout ce qui sonne se voit) :** la
couche de vie (ui/life.ts) : une boucle rAF, mutations directes, aria-hidden
+ pointer-events:none (spec dedie), budget ~0 a l'arret, ZERO ecriture
document (grep prouve). VU balistiques (montee instantanee, chute 300 ms,
crete tenue 1 s), clips qui pulsent a l'energie du point de lecture (pics
caches x position — croises pour la premiere fois), sante ambiante aux
seuils de l'oreille (piste > -1 dBFS, silence en lecture, plugin late),
solo qui tamise le reste. La boucle d'auto-test a debusque DEUX mensonges
moteur en route : connexion serveur ZOMBIE (serveur redemarre sous le
moteur = document gele a jamais, sans un mot -> heartbeat ping 15 s +
l'auto-reconnect existant) ; peaks fantomes a l'arret (processTrack fige
-> clearMeters au chemin silence du callback, stores relaxed). Moteur
21/21 x2, drive 13 gestes verts, suite 14/14.

**2026-08-22 (AUDIT-3, lecture seule post-jalon) :** troisieme audit, rapport
AUDIT-3.md. Moisson : contrats non verifies aux frontieres (depth clampee en
silence, bloc partiel = bypass permanent, canal param mono-slot) et promesses
de documents en avance sur le code — plus d'erreurs de jeunesse. Ordre decide
(TODO) : mains AVEC variation de buffer -> file param -> contrat de periode ->
critere 3 vrai -> 2.5. Critere 3 passe en « valide avec reserve » (A3-4).

**2026-08-23 (AUDIT-4, lecture seule) :** quatrieme audit — 3 passes
paralleles (moteur, serveur/sync, web/scripts) + critique de fond des
.md. Moisson : trio deps-manquantes qui vide la garantie du critere 3
(reserve ROUVERTE), slot perime rejoue par le ring sous surcharge,
enfants VST3 zombies sans eviction, et jumeaux documentaires qui
divergent (20/20 vs 21 tests reels, deux registres DECISIONS, ADR-005
mensonger). Ordre 1-6 consigne dans TODO (arbitrage utilisateur).

## Criteres d'acceptation

| # | Critere | Statut | Detail |
|---|---------|--------|--------|
| 1 | Rendu deterministe | ✅ VALIDE | Hash `89f1a1105dc09e92` (fixture reel 2 pistes, MSVC verifie; GCC via CI). Ancien hash `f40af882097b704a` = silence, invalide (voir DECISIONS.md 2026-08-21) |
| 2 | Test CLI sans navigateur | ✅ VALIDE | `./daw_engine_test` 20/20 |
| 3 | Convergence 2 onglets | ⚠️ VALIDE AVEC RESERVE (rouverte AUDIT-4, 2026-08-23) | Push anti-entropie et resync en place (A3-4/A3-5), MAIS Automerge bufferise les changes a deps manquantes SANS erreur des deux cotes : le serveur peut jeter et broadcaster quand meme (A4-1), le client ne resync pas sur le cas principal (A4-2), et l'edition avant premier contact serveur se perd (A4-3). Remede + tests de garde : AUDIT-4.md, session TODO ordre 2 |
| 4 | LNA HTTPS→WS local | ⛔ NON TESTE | Test manuel Chrome jamais documente |
| 5 | 10 min WASAPI sans underrun | ⚠️ PARTIEL | 0 underruns mais **sans charge CPU** |

### Detail critere 3

**Valide (Playwright):**
- Sync online: gain modifie dans onglet 1 apparait dans onglet 2
- Sync bidirectionnelle: modifications simultanees convergent
- Ajout de piste: nouvelle piste apparait dans les deux onglets

**Valide (2026-08-21, dette soldee):**

`criterion3-offline.spec.ts` (arret/relance REELS du serveur via
`start-stack.ps1 -Component server`, onglets vivants pendant la coupure,
edits distincts + conflit sur la meme piste) est VERT, annotation
`test.fail()` retiree. Les deux defauts du client sont corriges:
1. Outbox: `sendChange()` met en file les changements emis hors ligne et
   les envoie dans l'ordre a la reconnexion (plus aucune perte silencieuse).
2. Fusion a la reconnexion: le premier message de chaque connexion est
   traite comme document complet (drapeau par connexion, pas de prefixe de
   protocole necessaire) et FUSIONNE via `Automerge.merge()` - jamais de
   remplacement du document local.

**Reserve AUDIT-3 (2026-08-22, A3-4/A3-5) — le trou restant :**
`flushOutbox` retire de la file avant confirmation d'envoi (send() hors
OPEN jette en silence) et, apres `mergeRemote`, la nouveaute LOCALE n'est
jamais poussee vers le serveur (les cycles resync ne font que tirer).
Le spec offline exerce le chemin outbox-vivante, pas socket-mort-pendant-
flush. + un applyChange qui echoue ne declenche aucun resync (divergence
silencieuse, reelle sous rafale : broadcast cap 256, Lagged = skip).
Remede et test de garde consignes : AUDIT-3.md, session TODO ordre 4.

**Dettes residuelles distinctes:**
- ~~L'outbox est en memoire seulement~~ SOLDEE 2026-08-22 : miroir
  localStorage par onglet + adoption des files orphelines a la connexion,
  garde par le spec `outbox-persistence` (edit hors ligne dans un onglet
  FERME, rejoue par le suivant).
- ~~Le serveur diffuse un change AVANT de le persister~~ CORRIGE
  2026-08-21: persist-avant-broadcast dans websocket.rs, garde par
  `cargo test --test persist_before_broadcast` (kill brutal du process a
  l'instant ou un pair voit la diffusion). L'anti-entropie cliente reste
  en place (couvre d'autres pertes de broadcast).
- ~~Course a la creation du doc par defaut~~ CORRIGE 2026-08-22: toutes les
  mutations du store sont serialisees (store_lock), garde par
  `cargo test --test concurrent_first_writes` (2 premieres connexions
  simultanees, chacune ecrit immediatement, aucune perte toleree).

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

# Terminal 2: Tunnel cloudflared (natif Windows: winget install Cloudflare.cloudflared)
cloudflared.exe tunnel --url http://localhost:8080

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

1. ~~**Web incompatible avec moteur (hors critere 3)**~~ CORRIGE : `engine_client.ts`
   utilise Protobuf (pas JSON), gere le token d'authentification (premier message
   binaire), et utilise le port 47821 (pas 9000 en dur). Voir
   `engine_client.ts:24,47,86-91`.
