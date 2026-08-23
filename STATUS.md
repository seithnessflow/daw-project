# STATUS.md

*L'ETAT courant du projet : criteres, composants, procedures vivantes.
Le recit date vit dans JOURNAL.md (append-only). Derniere mise a jour :
2026-08-23 (recadrage differenciateur, ADR-019).*

## L'INVARIANT PRODUIT (ADR-019)

**Un pair qui n'a pas le plugin installe entend le resultat du plugin.**
Etat : NON IMPLEMENTE — zero ligne. Chemin : placement dans le document
+ stems rendus via le store d'assets (verite de lecture) + streaming
P2P (canal ephemere du jam). C'est le cap ; tout le reste le sert.

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
| Engine C++ (MSVC) | ✅ | ✅ | `daw_engine_test.exe` 21/21 |
| Engine C++ (GCC/CI) | ✅ | ✅ | CI verte depuis run #48 (2026-08-22), hash + plugin_host inclus |
| Server Rust | ✅ | ✅ | Ecoute sur 127.0.0.1:3000 |
| Web TypeScript | ✅ | ✅ | Automerge reel, suite e2e 15/15 |

**Note:** Developpement 100% natif Windows (MSVC). GCC uniquement en CI.

## Criteres d'acceptation

| # | Critere | Statut | Detail |
|---|---------|--------|--------|
| 1 | Rendu deterministe | ✅ VALIDE | Hash `89f1a1105dc09e92` (fixture reel 2 pistes, MSVC verifie; GCC via CI). Ancien hash `f40af882097b704a` = silence, invalide (voir docs/DECISIONS.md, 2026-08-21) |
| 2 | Test CLI sans navigateur | ✅ VALIDE | `./daw_engine_test` 21/21 |
| 3 | Convergence DEUX MACHINES, deux reseaux, un projet (redefini ADR-019) | ⛔ JAMAIS TESTE | La version 2-onglets (sous-ensemble) : ⚠️ valide avec reserve (AUDIT-4 : trio deps-manquantes A4-1/2/3, remede session TODO ordre 2 — c'est la fondation que deux machines exigeront). Historique : JOURNAL.md |
| 4 | LNA HTTPS→WS local | ⚠️ ETABLI SUR CHROME 151/WINDOWS — sceau final : un geste utilisateur en attente | ETABLI (campagne 2026-08-23, oracle temporel automatise sur le VRAI Chrome 151, profils vierges) : (1) invite Chrome apparue et autorisee -> WS connecte (test des mains du matin) ; (2) fetch ET WebSocket sont TOUS DEUX soumis au LNA et savent declencher la demande (etat prompt -> les deux pendent en attente de decision ; AUCUN echec immediat : le pire cas « subit sans pouvoir demander » est ECARTE) ; (3) ZERO GESTE : une connexion lancee au chargement de page declenche l'invite — l'onboarding « connexion au chargement » est viable ; (4) permissions.query('local-network-access' et 'local-network') expose l'etat (prompt/granted lus en reel) -> l'UI n'a jamais a deviner ; feature-detection obligatoire (Firefox/Safari sans API) ; (5) auth prouvee de bout en bout quand permis (AUTH OK + telemetrie ; token perime -> close 4001, signature distincte de 1006). Mecanisme : carve-out loopback (le tunnel ne sert que la page ; l'URL WS est 127.0.0.1). INCONNUS DATES 2026-08-23 (documentation, pas bloquants) : texte exact de l'invite, semantique dismissal (Echap) et refus explicite (clic Bloquer), duree de memorisation, Firefox/Safari, --allow-origin en prod (design 1pre), audio/telemetrie soutenus a travers ce chemin. Canari fetch mode cors NON CONCLUSIF sur ce moteur (400 sans CORS = « Failed to fetch » meme reseau ouvert) — garder ecrit. Le moteur ne loggue pas les connexions acceptees (a corriger) |
| 5 | 10 min WASAPI sans underrun | ⚠️ PARTIEL | 0 underruns (2026-08-20, ZenGo SC 48kHz/512) mais **sans charge CPU** — procedure ci-dessous |
| 6 | L'INVARIANT : un pair sans le plugin entend le resultat du plugin (ADR-019) | ⛔ NON IMPLEMENTE | Placement + stems rendus + streaming jam (TRANCHE 3). Preuve attendue : par echantillons, a travers le store |

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
