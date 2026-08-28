# SECURITY.md — etat securite (corrige / reste)

*Proprietaire de l'etat securite. Modele de menace : mono-utilisateur
local au quotidien, mais le produit est COLLABORATIF et le serveur est
EXPOSE par un tunnel public a chaque smoke deux machines — donc « distant »
= LIVE, pas futur. Audit d'origine 2026-08-22 ; apports AUDIT-4
(2026-08-23) et AUDIT-5 (2026-08-25), rapports dans docs/audits/.
Trie a jour au 2026-08-28.*

## Regle d'exploitation (tant que l'auth n'est qu'un token partage)

Un tunnel `cloudflared` ne s'ouvre qu'avec `scripts\daw.ps1 -Secure`
(token serveur genere, `DAW_SERVER_TOKEN`) : l'URL partagee porte le
secret, on la traite comme un mot de passe, et **jamais un tunnel ouvert
hors test**. Procedure : docs/deux-machines.md §5.

## CORRIGE

- **C1 path traversal `project_id`** : validation `^[A-Za-z0-9_-]{1,64}$`
  au handler WS ET refus dans le store (defense en profondeur).
- **C2 locale (drive-by)** : garde d'Origin local-first sur ws et assets
  (`api/origin.rs`), CORS restreint a 5173. Tests unitaires + e2e.
- **C2 distante (serveur sans auth derriere un tunnel) — F1 AUDIT-5,
  FAIT 2026-08-25** : auth OPT-IN par token partage (env
  `DAW_SERVER_TOKEN`) — premier message WS `auth:<token>` +
  `Authorization: Bearer` sur `/assets`, comparaison temps constant ;
  clients moteur (env) et web (fragment `#stoken`, jamais au reseau)
  faits ; `daw.ps1 -Secure` active tout. Sans env var : dev inchange.
  Tests Rust `auth_token` 2/2.
- **H1 token moteur** : 32 octets CSPRNG (BCryptGenRandom / urandom),
  comparaison constant-time.
- **H2 (cap)** : cap de frame WS 8 Mo.
- **M2** : garde de longueur en `size_t` (`websocket_server.cpp`).
- **M3** : parseur WAV borne champ par champ (`plugin_host_main.cpp`).
- **M5** : document hostile — `document/sanitize.ts` (clamp des spans,
  `CSS.escape` sur les selecteurs interpolant un id).
- **B3** : `dr_libs` epingle sur un SHA (`b55a0d9a`), GIT_SHALLOW retire.
- **B5** : `util/path_safety.h` `isPathComponentSafe` aux 4 frontieres ou
  une chaine du document devient un chemin (asset_hash, stem_hash,
  node_id en ecriture, fetch hash + URL) — ferme le traversal lecture/
  ecriture et l'injection CRLF. Garde `testPathComponentSafety`.
- **M1** (uid non quote) : couvert par la meme validation de frontiere.
- **A1/A2 (integrite du son, AUDIT-5)** : int/f64 tolerant, cle de stem
  a pleine precision (stem-v2) — pas de la securite stricto sensu, mais
  un stem faux declare frais est une atteinte a la verite de lecture.

## RESTE, par priorite (suivi TODO.md)

- **B2 — relais `signal:` verbatim, identite `from` auto-declaree** :
  un JOIN forge fait repondre le diffuseur (flux master + IP reelles via
  ICE) ; `bye`/`ta:`/`sf:` forges = DoS jam / controle du transport d'un
  pair / badge fraicheur menteur. Mitige par F1 (il faut le token pour
  parler au relais) ; reste ouvert entre pairs authentifies. Se concoit
  avec les identites (critere 3 redefini).
- **M4 — token en query `?token=`** : le fragment `#token` est scrube
  (bon chemin) ; la branche legacy query subsiste dans `wiring.ts` et
  n'est PAS scrubee (historique/Referer). C'est un RETRAIT a faire, pas
  un design.
- **H3 fichiers TEMP** : Low sur Windows (ACL `%TEMP%` owner-only
  mesuree) ; **High sur POSIX/CI** (`/tmp` world-writable, token mode
  0644, branche `#else` de `writeTokenFile`). Reste : `CREATE_NEW`/
  `O_EXCL` + tmp unique pour le PUT assets (A4-15.1).
- **H2 (reste)** : sortir le parse Automerge de dessous `store_lock` (ou
  le borner davantage).
- **B4** : `?server=` non valide + outbox non scopee au serveur = un lien
  peut exfiltrer les changes en file.
- **B6** : `/api/engine-token` protege seulement par l'ordonnancement des
  middlewares vite — un bump de version pourrait rendre le token lisible
  par tout site visite. Vaut aussi pour `/api/projects` (AUDIT-6 §10).
- **B7** : `AssetCache` sans eviction (OOM) ; `setState` de plugins tiers
  nourri par les octets d'un pair (crash-DoS persistant) ; cache de
  scan non echappe (redirection uid -> DLL persistante).
- **L1** : overflow signe `start_sample + length_samples` (`clip_player`).
- **L2** : PUT assets bufferise jusqu'a 512 Mo en RAM — streamer/limiter.
- **A4-15** : fsync manquant avant rename (durabilite) ; noms reserves
  Windows acceptes comme `project_id` (CON, NUL...) ; bras IPv6 `[::1]`
  mort dans `origin.rs` (fail-closed, mais zero test IPv6).
- Le moteur ne loggue pas les connexions WS acceptees.

## Acquis a garder (valides par les audits)

Store d'assets : hex + SHA-256 verifies, refus au mismatch, le moteur
re-verifie les corps tires. Le document porte des UID, jamais des
chemins (bloque la RCE par chemin de plugin). Le web rend les chaines du
document via `textContent` (pas de XSS). Thread audio sans syscall ni
allocation (static_asserts). Token moteur par port, livre par fragment.
