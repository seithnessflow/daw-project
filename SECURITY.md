# SECURITY.md — audit et etat

*Audit defensif 2026-08-22 (lecture des 3 etages : serveur Rust, moteur
C++, web TS). Modele de menace : mono-utilisateur local AUJOURD'HUI, mais
le produit est COLLABORATIF (pairs distants = futur declare). Les
corrections faites ce jour sont marquees [FAIT] ; le reste est priorise
et suivi dans TODO.md.*

## CORRIGE (verifie par AUDIT-4, 2026-08-23)

- **C1 — Path traversal dans `project_id`** : `..\..\evil` en URL
  ouvrait une ecriture/lecture de `.am` hors de ./projects (le backslash
  Windows n'est pas decode par la couche URL). Validation
  `^[A-Za-z0-9_-]{1,64}$` au handler WS (`api/websocket.rs`,
  `valid_project_id`) ET refus dans le store (`file_store.rs::project_path`
  renvoie Result) — defense en profondeur.
- **C2 (moitie locale) — drive-by website bloque** : garde d'Origin
  local-first sur ws ET assets (`api/origin.rs` : autorise localhost/
  127.0.0.1/[::1] toute origine, refuse toute origine navigateur
  cross-machine ; absente = client natif exempt, comme le moteur).
  `allow_origin(Any)` retire du CORS (liste 5173). Tests unitaires
  origin + e2e.
- **H1 — Token moteur** : 32 octets d'un CSPRNG OS (BCryptGenRandom sur
  Windows, /dev/urandom ailleurs) au lieu de mt19937_64 ; comparaison
  constant-time (`constantTimeEquals`). Token reste 64 hex.
- **H2 (moitie cap)** : cap de frame WS 8 Mo pose.
- **M2** : garde de longueur en `size_t` (`websocket_server.cpp`) —
  plus de wrap 32-bit.
- **M3** : parseur WAV borne chaque champ AVANT lecture/alloc
  (`plugin_host_main.cpp::readWav16Stereo`) — plus d'OOB ni d'alloc 2 Go.
- **M5** : document hostile — `document/sanitize.ts` (clampSamples borne
  les spans ; cssId/CSS.escape sur les 6 selecteurs interpolant un id)
  applique dans track/life/gestures/render.

## RESTE, par priorite (suivi TODO « SECURITE »)

- **C2 (moitie distante) — RE-CADRE LIVE, PAS FUTUR (AUDIT-5 F1,
  2026-08-25)** : le serveur n'a AUCUNE auth. La procedure deux-machines
  documentee (`cloudflared tunnel --url http://localhost:3000`,
  docs/deux-machines.md) publie ce serveur loopback sur une URL HTTPS
  PUBLIQUE a CHAQUE smoke : quiconque a l'URL lit tout le projet, ecrit
  des changes que le moteur applique sans validation, R/W le store, et
  REJOINT le jam (ecoute du master, cf. F2 : relais signal verbatim,
  identite `from` auto-declaree). Ce n'est donc ni « au 1er pair » ni
  reserve a `DAW_SERVER_BIND=0.0.0.0` — c'est vrai a chaque tunnel ouvert.
  Mitigation minimale (~5 lignes Rust) : token partage en header verifie
  AVANT l'upgrade WS et sur `/assets`, OU Cloudflare Access. L'auth
  complete se concoit avec le critere 3 (identites/invitations). D'ici
  la : traiter l'URL du tunnel comme un mot de passe, ne JAMAIS laisser
  un tunnel ouvert hors test. Detail complet + F2..F11 : docs/AUDIT-5.md.
- **H2 (reste)** : sortir le parse Automerge de dessous store_lock (ou
  le borner davantage).
- **H3 — RE-CADRE (AUDIT-5, mesure 2026-08-25)** : sur Windows les
  permissions par defaut de `%TEMP%` sont DEJA owner-only (System +
  Administrators + l'utilisateur ; mesure ACL) — un autre utilisateur
  local NON-admin ne peut ni lire le token ni ouvrir le `.shm`. Donc
  H3 = **Low sur Windows** (reste : `CREATE_NEW`/`O_EXCL` contre un
  meme-utilisateur qui pre-cree le chemin — pas une frontiere) et
  **High sur POSIX/CI** (`/tmp` world-writable, token mode 0644 : le
  vrai risque, branche `#else` de writeTokenFile). Le tmp partage du PUT
  assets (A4-15.1) se regle du meme geste (nom unique).
- **M1 — la garde ne tient PLUS (AUDIT-5)** : l'arg class_uid non quote
  etait « garde par la table --vst3-module », mais depuis 2.5-decouverte
  la map est AUSSI peuplee par le scan `--vst3-dir` (uid pris dans les
  metadonnees du plugin) — le uid n'est plus CLI-controle. Valider
  `^[0-9A-Fa-f]{32}$` a la frontiere (lie F5/F9).
- **M4 — A MOITIE FAIT (AUDIT-5)** : le token passe par le FRAGMENT
  (#token, scrub immediat via replaceState, jamais au reseau) — bon
  chemin. RESTE : la branche legacy `?token=` (query) subsiste et n'est
  PAS scrubee (reste en historique/Referer) — la supprimer. Ce n'est
  plus « un design a decider », c'est un retrait.
- **B3 dr_libs epingle FAIT 2026-08-25** (commit 2681ea8) : le parseur
  dr_wav de chaque asset pair etait sur `GIT_TAG master` ; epingle sur
  un SHA. (AUDIT-5 F3/B3.)
- **L1** : overflow signe `start_sample+length_samples`
  (`clip_player.cpp`).
- **L2** : PUT assets bufferise 512 Mo en RAM — streamer/limiter.
- **Apports AUDIT-4 (2026-08-23, details AUDIT-4.md)** : A4-15.2 fsync
  manquant avant rename (durabilite) ; A4-15.3 noms reserves Windows
  acceptes comme project_id (CON, NUL...) ; A4-15.4 bras IPv6 mort dans
  origin.rs (fail-closed, sans danger, mais [::1] legitime bloque et
  zero test IPv6).

## Acquis a garder (l'audit les a valides)

- Store d'assets : hex + SHA-256 verifies, refus au mismatch ; le moteur
  re-verifie les corps tires. Le document porte des UID, jamais des
  chemins (bloque la RCE par chemin de plugin). Le web rend toutes les
  chaines du document via textContent (pas de XSS).
