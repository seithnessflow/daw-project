*Statut : ARCHIVE — copie integrale de STATUS.md AVANT le rangement du 2026-08-28 (conservee lisible ; git a l'historique).*

# STATUS.md

*L'ETAT courant du projet : criteres, composants, procedures vivantes.
Le recit date vit dans JOURNAL.md (append-only). Derniere mise a jour :
2026-08-27 (LOT T SOLDE T1+T2+T3+T5 + LOT A6 : schema v2 additif,
noyau miroir entier tempo.ts==tempo.h, resolveMusicalTime moteur,
surface web complete (geometry.ts, tempo topbar, clips MIDI musicaux,
piano-roll en ticks, bascule de domaine), DEUX ancres de determinisme
(absolu 56729beb61993cd7 INCHANGE + musical c1233ae9d6ab9e83, jumeaux
gtest/ci.yml), contrat de periode MESURE (piste A : multiples de 256
= callbacks fixes, 0 partiel, surveille par WARNING) ; e2e 99/99,
gtests 51/51, tsc 0, rituel du compositeur a 100 BPM vert ; T4 Link
Etage 2 = seul reliquat du lot T, differe ; JOURNAL suites 13-17).*

## L'INVARIANT PRODUIT (ADR-019)

**Un pair qui n'a pas le plugin installe entend le resultat du plugin.**
Etat : **VERT** (smoke S7 deux machines, 2026-08-23) — le portable, sans
aucun module VST3, a rendu l'octet-pour-octet de la tour a travers le
store et l'a JOUE dans ses haut-parleurs. Details : critere 6.
RE-PROUVE 2026-08-25 SUR VRAIS PLUGINS DU COMMERCE (Valhalla + RoughRider,
pas AGain) : portable TX15 sans ces modules -> rendu inv-proof byte-exact
a la tour (179F804E..., deux rendus frais compares), ligne de verite
« playing STEM 926ff7a0 for an unresolved plugin ». Reserves (JOURNAL
2026-08-25) : rendu OFFLINE via ear (pas le chemin reseau vivant, deja
S7), blobs poses par scp, invariant de LECTURE (le stem fut produit par
la tour), badges fraicheur de la-bas non observes en live.
SYNC TRANSPORT LINK (L1a+L1b+L1c, 2026-08-24) : **VERT DEUX
MACHINES** — PLAY sur la tour, le portable demarre sur l'ancre
(calage 10,7 ms = 1 buffer) et joue la piece entiere audible, ecart
de lecture <= 16 ms (5 sondes/6, critere < 50 ms tenu). Ecouter un
jam suspend la lecture locale (arbitrage utilisateur applique).
BUG OUVERT : crash 0xe06d7363 des moteurs (fermeture de lien WS,
les DEUX machines) — session dediee, build en RelWithDebInfo.
STREAMING JAM (S8, 2026-08-24) : **VALIDE A L'OREILLE DE
L'UTILISATEUR** — « c'est bon les deux marchent » : la tour joue duo
dans ses enceintes, le portable joue le meme duo recu en P2P (~40 ms,
deux NAT, STUN seul), sonde RMS 0.025/peak 0.09 sur le flux recu au
meme instant. LA TRANCHE DIFFERENCIATEUR EST CLOSE : stems (critere 6
vert) + streaming (oreille). Reste hors-tranche : badge fraicheur
(arbitrage), vrais plugins tiers, TURN (NAT stricts), sync transport
Link (cadrage au programme).

## Architecture

Triangle Browser ↔ Engine ↔ Server :
- **Browser ↔ Engine** : WebSocket direct sur 127.0.0.1 pour transport/telemetry (temps reel)
- **Browser ↔ Server** : WebSocket pour sync document Automerge (tolerance latence)
- **Engine ↔ Server** : HTTP pour gros transferts assets (hors bande)

**La loi (reecrite ADR-019) : aucun audio n'est TRAITE cote serveur ;
l'audio inter-pairs voyage en P2P ; le serveur ne fait que du signaling
(et eventuellement du relais TURN).** L'ancienne formulation « rien de
temps reel ne traverse le serveur distant » est abrogee (elle
interdisait le produit).

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
| Engine C++ (MSVC) | ✅ | ✅ | `daw_engine_test.exe` **41/41** (noyau natif complet : Utility/EQ3/Comp/Drive/Delay, preuves exactes ; + test scheduler de boucle Session) ; crash 0xe06d7363 SOLDE (envoi hors verrou) ; handler auto-symbolisant (dbghelp+WHAT) ; --start-stopped, --editors, --vst3-dir (scan+cache). **Finition UI F1/F2/F5 (2026-08-25)** : ring **v9** (editor_open moteur->enfant = fenetre GUI de plugin A LA DEMANDE, loge dans le padding de shutdown -> offsets inchanges) ; **pan de piste** post-chain, loi lineaire centre-neutre (pan 0 == inchange, hash preserve) ; **LAUNCH SESSION** = horloge de session LIBRE (le callback traite le graphe meme transport a l'arret si un slot est lance ; position d'arrangement gelee), emitSessionLoop (rebase+wrap+all-notes-off, teste). **AUDIT-5 (test-first, master vert)** : A1 int/f64 (itemToUint), A2 precision cle de stem (stem-v2), A4 merge + push a la reconnexion, A6/A7 warnings periode & sample-rate, A8 sample_rate sur le fil, 1.1 params map->liste ordonnee, B5 validation des chemins (path traversal) |
| Engine C++ (GCC/CI) | ✅ | ✅ | CI verte depuis run #48 (2026-08-22), hash + plugin_host inclus |
| Server Rust | ✅ | ✅ | Ecoute sur 127.0.0.1:3000, cargo test 9/9. **AUDIT-5 F1** : auth par token partage OPT-IN (env DAW_SERVER_TOKEN) — WS premier message `auth:<token>` + `Authorization: Bearer` sur /assets, comparaison temps constant ; retrocompatible (sans env var = dev inchange) ; ferme C2-distante quand le serveur est expose par un tunnel |
| Web TypeScript | ✅ | ✅ | Automerge reel, suite e2e 36/36 (specs moteur-reel : port 47821 LIBRE requis) ; sync transport L1a/b/c VERT DEUX MACHINES ; catalogue PluginCatalog (91 classes) + picker ; badge fraicheur 3 etats ; ear --vst3 + positions des clics, self-test 7/7. **REFONTE UI « etabli Magic Potion » (T1-T8) + FINITION F1-F7 (2026-08-25)** : etabli 3 colonnes (navigateur / arrangement / rack) avec splitters redimensionnables (largeurs localStorage) ; commutateur de paradigmes Arrangement/Session/Mixage (presentation LOCALE par onglet) ; console Mixage reelle (VU par piste + master, faders, pan, M/S) ; vue Session clip-launcher FONCTIONNELLE (launch live des slots, etat « en lecture ») ; navigateur Instruments/Effets/Samples (source unique des samples) ; rack en knobs rotatifs, bouton BOX (GUI plugin a la demande) ; undo des notes ; reduced-motion/focus |

**Note:** Developpement 100% natif Windows (MSVC). GCC uniquement en CI.

**Session F5+ (2026-08-26, moteur+web)** : launch QUANTISE (l'ancre - 1er
slot parti quand rien ne joue - part immediatement et pose epoque + quantum
= son loop_len ; les suivants attendent la frontiere, promotion par le
thread audio au sample exact) ; STOP filtre par scene (avant : stop d'une
scene tuait les slots des AUTRES scenes - defaut corrige) ; STOP ALL ;
SessionState dans la telemetrie 30 Hz = VERITE des slots a l'UI (badge
queued pointille, etat optimiste reconcilie). Gestion scenes : renommer
(inline), dupliquer (slots+notes), supprimer (avec slots), undo complet.
gtest testSessionQuantizedLaunch - moteur 42/42. Prouve bout-en-bout au
pilotage (moteur reel --mute : ancre -> queued -> promotion -> stop all,
traces/f5plus-*.png).

**Renommage (2026-08-26, web)** : ClipDef.name additif (SCHEMA.md),
renameTrack/renameClip/renameScene undo-journalises, clic droit ->
Renommer (input inline), clipDisplayName = source unique du nom affiche
(un clip MIDI n'affiche plus son id brut). Ctrl+D copiait 5 champs et
perdait notes/fades - copie integrale desormais.

**FIX SYNC (2026-08-26, important)** : Project.getLastChange etait un
SCALAIRE - deux mutations avant un envoi = la 1re perdue pour les pairs
(vu au pilotage : slots fantomes). Desormais une FILE (pendingChanges),
sendLastChange draine tout. Meme classe de bug fermee pour tous les gestes
multi-mutations (dupliquer une scene, etc.).

**Soir du 2026-08-26 (3 chantiers, 2 par agents paralleles)** :
- **RACK EN BAS** (demande utilisateur) : panneau device pleine largeur
  sous l'etabli (frere de .workspace), splitter horizontal (hauteur
  persistee), onglets Rack/Piano-roll conserves, piano-roll pleine
  largeur. .col-rack -> .panel-device (modif ui-rework.spec signalee).
- **D3 DRAG & DROP** : instruments/effets/samples du navigateur se
  glissent sur les pistes (device ajoute + piste selectionnee), sur le
  vide (nouvelle piste + device), samples poses a la position du drop.
  Feedback dragover. dnd-browser.spec.
- **A1 AUTOMATION (document seul)** : AutomationLaneDef additif
  (piste + master), 6 mutateurs undo-journalises, automationValueAt pur
  (contrat d'exactitude pour le moteur A2). SCHEMA.md documente.
  automation-doc.spec. Le moteur IGNORE ces champs jusqu'a A2.
- **BOX / fenetres de plugin** (apres 2 retours utilisateur) : fenetre
  TOPMOST tant qu'ouverte (devant Chrome garanti), croix (X) resynchronise
  le ring, --editors retire de daw.ps1 (a la demande), etat memorise hors
  DOM.

**Nuit du 2026-08-26 (vague 2 parallele)** :
- **D1 pistes reordonnables** (drag de la tete ; TrackDef.order additif
  fractionnaire, identite CRDT preservee ; orderedTracks source unique).
- **D2 devices reordonnables** (drag horizontal du rack ; moveProcessor,
  compromis CRDT documente ; la piste retrouvee PAR le device).
- **A2 moteur automation** : gain/pan/master evalues par sous-bloc
  (lane enabled > manuel ; mapping gain v*2, pan v*2-1) ; evaluateur
  C++ miroir EXACT du TS ; gtests 44/44 (exactitude au bit) ; e2e
  moteur reel automation-engine.spec (la lane pilote les VU). Les lanes
  de DEVICE (processorId) attendent A4.
- **LECON BUILD** : layout de struct partagee change => CLEAN build
  (ninja clean) - l'incremental a produit un moteur live qui mourait en
  5 s (0xC0000005) avec des gtests verts. Suite e2e **62/62**, tsc 0,
  gtests 44/44, cargo 9/9.

## Performance (Lot P, revue externe ratifiee — premiers chiffres 2026-08-27)

| Mesure | Valeur | Outil / garde |
|---|---|---|
| Graphe 500 pistes, bloc 256 | **735 us = 13,8 % du budget** (5333 us) | gtest `testGraphLoadBudget` (CI, seuil < budget) |
| Underruns sous charge 28 threads (WASAPI partage 512/374) | **0** / 30 s | `scripts/perf-underruns.ps1` |
| Underruns sous charge, EXCLUSIF 256 (16 ms) | **0** / 30 s | idem `-Exclusive` |
| Sortie device : partage / plancher partage / exclusif 256 / 128 | 32 / 23,4 / **16** / 8 ms | ligne `audio-negotiation:` (readback) |
| Pipeline jam (une machine, hors reseau) | **~75 ms** (pump ~5 + FIFO ~27 + Opus ~20 + NetEq 21-32) | `scripts/measure-jam.mjs` |
| Underruns worklet broadcaster | **0** (etait 238-950/10 s avant le pre-buffer) | `jamAudio.workletStats()` |
| Churn stems / verite device | en telemetrie permanente | EngineState champs 8-10 |

Verdict latence (docs/SPIKE-LATENCE.md) : jeu direct sur moteur distant
EXCLU (~75 ms logiciels) ; test Massive jouable en MIDI->rendu
tour 16 ms->enceintes de la piece (~18-20 ms) ; WAN = ecoute.

## Criteres d'acceptation

| # | Critere | Statut | Detail |
|---|---------|--------|--------|
| 1 | Rendu deterministe | ✅ VALIDE | Hash `56729beb61993cd7` (fixture reel 2 pistes, MSVC verifie; GCC via CI ; recalcule 2026-08-23 V1.6 fades implicites — historique et justification dans docs/DECISIONS.md) |
| 2 | Test CLI sans navigateur | ✅ VALIDE | `./daw_engine_test` 29/29 |
| 3 | Convergence DEUX MACHINES, deux reseaux, un projet (redefini ADR-019) | ⛔ JAMAIS TESTE | La version 2-onglets (sous-ensemble) : ✅ RESERVE LEVEE 2026-08-23 — le trio deps-manquantes A4-1/2/3 est solde (serveur refuse bruyamment les deps manquantes + graine commune vendored + merge au premier contact + heartbeat 15 s / watchdog 45 s) avec gardes : 2 tests Rust (refus Lagged, seed nouveau projet) + sync-resilience.spec 3 invariants (deps surfacees, heartbeat recu, edition hors-ligne survivante). Historique : JOURNAL.md |
| 4 | LNA HTTPS→WS local | ✅ VALIDE — formulation exacte : l'acces au moteur local depuis une origine HTTPS publique fonctionne sur Chrome 151/Windows 11 (2026-08-23), sous reserve d'autorisation utilisateur, avec etat lisible par API. SCEAU pose dans le navigateur de l'utilisateur : sonde granted, canari 4 ms, onopen 3 ms, AUTH OK + telemetrie 23 ms (version relevee sur le binaire installe 151.0.7922.170 ; champ UA non transcrit) | ETABLI (campagne 2026-08-23, oracle temporel automatise sur le VRAI Chrome 151, profils vierges) : (1) invite Chrome apparue et autorisee -> WS connecte (test des mains du matin) ; (2) fetch ET WebSocket sont TOUS DEUX soumis au LNA et savent declencher la demande (etat prompt -> les deux pendent en attente de decision ; AUCUN echec immediat : le pire cas « subit sans pouvoir demander » est ECARTE) ; (3) ZERO GESTE : une connexion lancee au chargement de page declenche l'invite — l'onboarding « connexion au chargement » est viable ; (4) permissions.query('local-network-access' et 'local-network') expose l'etat (prompt/granted lus en reel) -> l'UI n'a jamais a deviner ; feature-detection obligatoire (Firefox/Safari sans API) ; (5) auth prouvee de bout en bout quand permis (AUTH OK + telemetrie ; token perime -> close 4001, signature distincte de 1006). Mecanisme : carve-out loopback (le tunnel ne sert que la page ; l'URL WS est 127.0.0.1). INCONNUS DATES 2026-08-23 (documentation, pas bloquants) : texte exact de l'invite, semantique dismissal (Echap) et refus explicite (clic Bloquer), duree de memorisation, Firefox/Safari, --allow-origin en prod (design 1pre), audio/telemetrie soutenus a travers ce chemin. Canari fetch mode cors NON CONCLUSIF sur ce moteur (400 sans CORS = « Failed to fetch » meme reseau ouvert) — garder ecrit. Le moteur ne loggue pas les connexions acceptees (a corriger) |
| 5 | 10 min WASAPI sans underrun | ⚠️ PARTIEL | 0 underruns (2026-08-20, ZenGo SC 48kHz/512) mais **sans charge CPU** — procedure ci-dessous |
| 6 | L'INVARIANT : un pair sans le plugin entend le resultat du plugin (ADR-019) | ✅ VERT — DEUX MACHINES, DEUX RESEAUX, A TRAVERS LE STORE (smoke S7 2026-08-23) | Fixe (Ethernet) avec AGain : rendu de reference sha256 64EC2954CAAA... et stem publie automatiquement au store (3fd099d4, float32). Portable TX15 (hotspot, deux NAT, tunnel+relay) SANS AUCUN module VST3 : doc recu par WS, 5 objets par le STORE HTTP, rendu sha256 64EC2954CAAA... — IDENTIQUE OCTET POUR OCTET. Contre-preuve sur place : stem retire -> « Render failed: Chain incomplete » (jamais un faux vert). Et la preuve AUDIBLE : le portable a JOUE le stem dans ses haut-parleurs (« playing STEM 3fd099d4... for an unresolved plugin », Senary Audio 48 kHz). Gtest local testStemInvariant en CI (contre-controles inclus). RESTE (n'empeche pas le vert, tranche 3 suite) : streaming jam P2P, badge fraicheur (arbitrage TODO), vrais plugins tiers |

## Commandes utiles

### Engine (Windows MSVC - seule toolchain locale)
```powershell
cd engine\build-msvc
..\rebuild_msvc.bat
.\daw_engine_test.exe
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821
```

**Note:** GCC/Linux uniquement en CI (GitHub Actions).

### Stack complete (une commande)
```powershell
scripts\daw.ps1          # serveur + moteur + web + navigateur (token dans l'URL)
scripts\daw.ps1 -Stop
```
Ou, double-cliquables (racine du projet) : **start-daw.cmd** (lance tout +
ouvre le site sur studio, token epingle) / **stop-daw.cmd** (arrete tout).

### Web
```powershell
cd web
npm install
npm run dev    # Dev server sur http://localhost:5173
npm run build  # Build production
```

### Server
```powershell
cd server
cargo run  # Ecoute sur 127.0.0.1:3000
```

### Token moteur
Un fichier PAR PORT : `%TEMP%\daw-engine-token-<port>` (defaut :
`daw-engine-token-47821`), contenu JSON `{token, port, address}`. La page
web le recoit via `?token=<valeur du champ token>` — `scripts\daw.ps1`
fait tout ca automatiquement.

---

## Procedure de test critere 3 (convergence)

```powershell
# Terminal 1: serveur    Terminal 2: web
cd server; cargo run     cd web; npm run dev
```

1. Ouvrir http://localhost:5173 dans deux onglets
2. Onglet 1 : modifier le gain d'une piste — onglet 2 doit suivre
3. Onglet 2 : modifier une autre piste — onglet 1 doit converger

**Resultat attendu:** les deux onglets affichent le meme etat apres
quelques millisecondes.

## Procedure de test critere 5 (WASAPI sous charge)

```powershell
# Terminal 1: lancer la lecture AVANT la charge
cd C:\Users\mb668\daw-project\engine\build-msvc
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821

# Terminal 2: charge CPU (regle machine : -j32, jamais -j8)
cd C:\Users\mb668\daw-project\engine\build-msvc
ninja clean && ninja -j32
```

Observations a noter : underruns pendant la compilation, underruns total
apres 10 min, buffer size negocie. Zero underrun = critere valide.

## Procedure de test critere 4 (LNA Chrome)

```powershell
# Terminal 1: serveur HTTP
cd C:\Users\mb668\daw-project\engine\test-page
python -m http.server 8080

# Terminal 2: tunnel cloudflared (natif Windows: winget install Cloudflare.cloudflared)
cloudflared.exe tunnel --url http://localhost:8080

# Terminal 3: moteur
cd C:\Users\mb668\daw-project\engine\build-msvc
.\daw_engine.exe --doc ..\test-assets\test_10min.am --assets ..\test-assets --play --ws-port 47821
```

1. Copier le champ `token` de `%TEMP%\daw-engine-token-47821` (JSON)
2. Ouvrir l'URL cloudflared dans Chrome >= 142
3. Coller token et port 47821

Observations a noter :

**Fetch (canari LNA):** invite LNA apparait ? texte exact ? comportement
si refuse ? refus memorise apres reload ? comment annuler un refus ?

**WebSocket:** invite LNA ? connexion reussie ? si pas d'invite mais
Fetch bloque → LNA ne couvre pas encore WS.
