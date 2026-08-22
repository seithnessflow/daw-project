# SECURITY.md — audit et etat

*Audit defensif 2026-08-22 (lecture des 3 etages : serveur Rust, moteur
C++, web TS). Modele de menace : mono-utilisateur local AUJOURD'HUI, mais
le produit est COLLABORATIF (pairs distants = futur declare). Les
corrections faites ce jour sont marquees [FAIT] ; le reste est priorise
et suivi dans TODO.md.*

## Corrige ce jour

- **[FAIT] C1 — Path traversal dans `project_id`** : `..\..\evil` en URL
  ouvrait une ecriture/lecture de `.am` hors de ./projects (le backslash
  Windows n'est pas decode par la couche URL). Validation
  `^[A-Za-z0-9_-]{1,64}$` au handler WS (`api/websocket.rs`,
  `valid_project_id`) ET refus dans le store (`file_store.rs::project_path`
  renvoie Result) — defense en profondeur. cargo check vert.

## A FAIRE, par priorite (suivi TODO « SECURITE »)

- **C2 — Aucune auth serveur + CORS grand ouvert** (`server/src/main.rs`
  allow_origin(Any)/allow_private_network(true) ; ws et assets sans auth).
  N'importe quelle page web visitee peut lire/muter/empoisonner tous les
  projets. Fix : secret partage sur ws+assets, allowlist d'Origin stricte,
  retirer allow_private_network. PREREQUIS du 1er pair distant.
- **H1 — Token moteur ~32 bits d'entropie reelle**
  (`websocket_server.cpp` : mt19937_64 seed 32 bits, compare non
  constant-time). Fix : 32 octets d'un CSPRNG OS (BCryptGenRandom) +
  comparaison constant-time.
- **H2 — Blob Automerge non borne = DoS sous verrou global** (frames WS
  sans cap de taille, parse sous store_lock). Fix : cap de taille WS,
  parse borne hors du mutex.
- **H3 — Fichiers credential/segment en permissions par defaut** (token
  JSON, `%TEMP%\daw-ring-*.shm` sans O_EXCL ni ACL owner-only). Fix :
  0600 / ACL restrictive + O_EXCL.
- **M1** arg du class_uid non quote dans la ligne de commande enfant
  (aujourd'hui garde par la table --vst3-module) — valider `^[0-9A-Fa-f]{32}$`.
- **M2** garde de longueur 32-bit (`websocket_server.cpp` : `4+len` en
  uint32 peut wrapper) -> `4 + size_t(len)`.
- **M3** parseur WAV : lecture OOB + resize avant borne
  (`plugin_host_main.cpp`) — borner chaque champ.
- **M4** token moteur dans l'URL de la page (historique/Referer) — lire
  le fichier token same-origin, jamais en query string.
- **M5** document hostile fait planter le web en premier (lengthSamples
  enorme -> noeud DOM geant ; id avec `"` casse les selecteurs) — clamp
  numerique + `CSS.escape`/lookup par attribut. Le plus pertinent des que
  la collaboration s'ouvre.
- **L1** overflow signe `start_sample+length_samples` (`clip_player.cpp`) ;
  **L2** PUT assets bufferise 512 Mo en RAM — streamer/limiter.

## Acquis a garder (l'audit les a valides)

- Store d'assets : hex + SHA-256 verifies, refus au mismatch ; le moteur
  re-verifie les corps tires. Le document porte des UID, jamais des
  chemins (bloque la RCE par chemin de plugin). Le web rend toutes les
  chaines du document via textContent (pas de XSS).
