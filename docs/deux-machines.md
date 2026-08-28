# Deux machines — remonter le montage

*Statut (2026-08-28) : VIVANT (runbook). §5 = la procedure securisee
(daw.ps1 -Secure + tunnel + #stoken). Reserve honnete inchangee : le
chemin LIVE guest avec un vrai plugin n'a pas ete rejoue bout-en-bout.*

*Session outillage 2026-08-23. Fixe = mb668 (192.168.1.10, Ethernet) ;
portable = TX15, utilisateur `flow`, sur partage de connexion telephone
(10.102.x — NAT, injoignable en entrant). Tout ce qui traverse passe
par des tunnels cloudflared ephemeres : AUCUNE ouverture de box, aucune
regle firewall.*

## 1. Controle du portable depuis le fixe (SSH a travers les deux NAT)

### Cote portable (une fois — deja fait sur TX15)

1. OpenSSH Server : `Add-WindowsCapability -Online -Name
   OpenSSH.Server~~~~0.0.1.0` (PEUT PRENDRE 45+ min — laisser finir,
   ne jamais tuer TrustedInstaller). Service laisse en Manual
   (arbitrage : demarre a la demande, ne survit pas au reboot).
2. Cle du fixe (auth par cle SEULE — l'URL du tunnel est publique) :
   - `Add-Content C:\ProgramData\ssh\administrators_authorized_keys
     '<cle publique ssh-ed25519 du fixe, ~/.ssh/daw_liaison.pub>'`
   - `icacls C:\ProgramData\ssh\administrators_authorized_keys
     /inheritance:r /grant "*S-1-5-32-544:F" /grant "*S-1-5-18:F"`
     (SIDs, pas de noms : survit aux Windows localises)
   - `sshd_config` : `PasswordAuthentication no`, verifier par
     `sshd -T` ; ne pas toucher au bloc `Match Group administrators`.
3. A chaque session :
   - `Start-Service sshd`
   - `& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel
     --url ssh://localhost:22`
   - relever l'URL `https://xxx.trycloudflare.com` affichee (EPHEMERE :
     change a chaque relance).
   - CONSTAT 2026-08-24 : le LANCEMENT du tunnel est un GESTE HUMAIN —
     le classifieur de l'auto mode le refuse aux deux Claude (exposer
     un port sur une URL publique), des deux cotes. Les diagnostics,
     eux, sont delegables (sshd, cles, journal). Cote tour, brancher
     l'URL du jour : `scripts\liaison.ps1 -Url <url>` (patch du
     ~/.ssh/config + test).
   - Le sous-reseau du hotspot CHANGE (10.102.x releve 2026-08-23,
     172.27.107.x le 2026-08-24) : aucune IP portable en dur, jamais.

### Cote fixe

- Cle dediee : `~/.ssh/daw_liaison` (ed25519, sans phrase).
- `~/.ssh/config` :
  ```
  Host portable
    HostName <URL-du-jour>.trycloudflare.com
    User flow
    IdentityFile ~/.ssh/daw_liaison
    ProxyCommand "C:\Program Files (x86)\cloudflared\cloudflared.exe" access ssh --hostname %h
    StrictHostKeyChecking accept-new
  ```
  (mettre a jour HostName a chaque nouvelle URL ; un ssh direct sans
  ProxyCommand ECHOUE — le quick tunnel encapsule SSH dans du HTTPS).
- Test : `ssh portable "whoami & hostname"` -> `tx15\flow` / `TX15`.
- RTT a froid ~3,5 s (spawn cloudflared+handshake), ~0,9 s a chaud.

## 2. Horloges

- Mesure SANS admin, chaque machine contre LE MEME serveur NTP :
  `w32tm /stripchart /computer:time.windows.com /samples:3 /dataonly`
  (sur le portable : via `ssh portable "w32tm /stripchart ..."`).
- Ce qui compte pour correler les logs : l'ECART RELATIF entre les deux
  mesures, pas l'offset absolu. Mesure du 2026-08-23 : fixe +440,0 ms,
  portable +443,1 ms -> ecart reel ~3 ms (+-5 ms de gigue hotspot).
- Resync absolu (admin requis, optionnel) : `Start-Service w32time ;
  w32tm /config /syncfromflags:manual
  /manualpeerlist:"time.windows.com" /update ; w32tm /resync`.

## 3. La pile DAW a deux machines (topologie du smoke 1bis)

- UN SEUL serveur de sync : celui du fixe, en loopback (bind par
  defaut — PAS besoin de DAW_SERVER_BIND ni de firewall : le tunnel
  s'y branche en local) :
  `scripts\start-stack.ps1 -Component server`
  puis `cloudflared tunnel --url http://localhost:3000` -> URL-DAW.
- Fixe : moteur `--server ws://localhost:3000 --project smoke` + vite.
- Portable (le serveur Rust ne doit JAMAIS y tourner — il volerait le
  port du relais ; deux serveurs = deux aquariums sans traversee) :
  1. `node scripts\ws-relay.mjs https://<URL-DAW> 3000` (le moteur est
     compile USE_TLS=OFF : le relais traduit ws->wss, HTTP assets
     compris)
  2. `.\daw_engine.exe --server ws://localhost:3000 --project smoke
     --play --mute`
  3. `cd web && npm run dev` puis
     `http://localhost:5173/?project=smoke&server=ws://localhost:3000`

## 3bis. Frictions payees au smoke L1b (2026-08-24, rapport portable)

- `ws-relay.mjs` vit dans `scripts/` A LA RACINE du repo, pas dans
  `web/scripts/` — la commande est
  `node ..\scripts\ws-relay.mjs <URL> 3000` depuis web/, ou chemin
  absolu.
- `rebuild_msvc.bat` : vcvars64 cherche desormais les DEUX emplacements
  (LOCALAPPDATA tour, Program Files (x86) portable).
- Playwright n'a pas ses navigateurs sur le portable : toujours
  `channel: 'chrome'` la-bas (regle CLAUDE.md, confirmee).
- CRASH 0xe06d7363 (exception C++ non rattrapee, thread worker,
  declencheur apparent : fermeture d'un lien WebSocket) constate sur
  LES DEUX machines le meme jour — distinct du fantome 0xc0000409.
  Les crash-*.log fonctionnent ; il faut des PDB pour symboliser.

## 4. Pieges appris (payes une fois chacun)

- Vite ecoute en IPv6 seul : un test de port IPv4 (Test-NetConnection)
  rend un FAUX NEGATIF — sonder en HTTP sur `localhost`.
- `%TIME%` distant est au format local (virgule decimale fr) : ne pas
  parser ; utiliser stripchart ou un ISO 8601 PowerShell.
- Quick tunnel = HTTP/WS seulement ; le SSH n'y passe que via
  `cloudflared access ssh` (ProxyCommand), jamais en TCP nu.
- Les rapports colles a la main se tronquent : les verdicts critiques
  (n/21, hash) s'ecrivent SEULS SUR UNE LIGNE, en tete.
- Plan B si SSH indisponible : traces par git — chaque machine ecrit
  son journal dans un fichier, pousse/tire ; moins confortable, suffit.

## 5. Tester TON plugin entre 2 PC (l'invariant en vrai, securise F1)

Scenario cible : tu poses un VST3 sur la TOUR ; le PORTABLE, qui ne l'a
pas, l'entend quand meme (via le stem). F1 (AUDIT-5) securise le tunnel.

TOUR (host, a le plugin) :
1. `scripts\daw.ps1 -Secure` : stack avec AUTH. Le TOKEN s'affiche a la fin
   (et dans #stoken de l'URL locale) - note-le.
2. Onglet -> `+ device` -> choisis ton plugin dans le catalogue (le dossier
   VST3 standard est scanne). Le moteur rend son STEM et le publie au
   serveur (badge STEM).
3. `scripts\tunnel-daw.ps1` : expose le serveur (URL publique dans
   daw-tunnel-daw.err). Le serveur EXIGE le token -> plus une porte ouverte.

PORTABLE (guest, SANS le plugin) - pull + rebuild d'abord (fix crash + ring
v7, section plus haut) :
4. Son web pointe vers le serveur tour :
   `http://localhost:5173/?project=studio&server=<tunnel-host>#stoken=<TOKEN>`
   (relais ws->wss local si besoin, section 3). Le #stoken authentifie,
   jamais envoye au reseau.
5. Son moteur tire les stems du serveur tour et les JOUE :
   `set DAW_SERVER_TOKEN=<TOKEN>` puis
   `daw_engine.exe --server wss://<tunnel-host> --project studio --play ...`
   (le moteur lit DAW_SERVER_TOKEN -> auth WS premier message + Bearer
   sur /assets).
6. Le portable, sans ton plugin, entend son effet : l'invariant, en vivant,
   deux machines, securise.

RESERVE HONNETE : le CHEMIN LIVE guest (portable qui JOUE le stem recu par
le reseau) est prouve au smoke S7 (2026-08-23, AGain) ; la version VRAI
plugin + F1 n'a pas encore ete refaite bout-en-bout (la jambe 2026-08-25 =
rendu offline byte-exact). Prochaine fois que le tunnel portable est up :
derouler 4-6 et confirmer a l'oreille.

## Reste ouvert

- Horodatage UTC-milliseconde dans les logs moteur : micro-session
  code dediee (non faite — la session outillage s'interdisait le code
  produit).
- sshd du portable en Manual : ne survit pas au reboot (arbitrage a
  reprendre si le montage devient frequent).
