# Streaming jam — dossier de cadrage (S8)

*Statut (2026-08-28) : LIVRE — option A ratifiee et implementee (S8a/b/c,
2026-08-24, validee a l'oreille deux machines / deux NAT, STUN seul) ;
flux broadcaster propre depuis le pre-buffer d'amorcage (2026-08-27).
Mesures reelles du pipeline (~75 ms logiciels hors reseau) :
docs/SPIKE-LATENCE.md. TURN self-host = dette datee (TODO).*

*Session de cadrage 2026-08-24. Statut : PROPOSITION a ratifier —
aucune ligne de code avant l'arbitrage (nouvelle surface techno).
Rappel de la revue : c'est LE morceau qu'on coupe s'il deborde.*

## Le besoin (ADR-019)

Les STEMS couvrent la lecture du DOCUMENT : la verite differee
(latence de publication ~1 s+). Le streaming couvre l'EPHEMERE du jam :
ce que le pair A entend LA TOUT DE SUITE (performance, tweak en cours),
transporte vers le pair B. Loi : aucun audio traite cote serveur ;
P2P ; le serveur ne fait que du signaling (+ TURN eventuel).

## Options pesees

### A. WebRTC navigateur-a-navigateur (PROPOSE)

Le moteur pousse son master local a SON onglet (WS loopback,
127.0.0.1 — PCM float 48 kHz stereo = 384 Ko/s, trivial en local) ;
l'onglet A l'injecte dans WebAudio (AudioWorklet ->
MediaStreamDestination) -> RTCPeerConnection -> Opus -> P2P -> l'onglet
B le joue. Signaling : le serveur Rust relaie les SDP/ICE (nouveaux
messages WS `signal` par projet — pur signaling, la loi est respectee
LITTERALEMENT).

- POUR : ZERO dependance native (WebRTC/Opus/jitter-buffer/NAT
  traversal sont DANS le navigateur) ; le futur canal instrument/MIDI
  live = DataChannel gratuit ; l'onglet est deja notre surface.
- CONTRE, ecrit honnetement : latence bout-en-bout attendue 30-80 ms
  APRES etablissement (Opus + jitter + reseau) — jouable pour
  s'ENTENDRE jammer, PAS pour un duo rythmique serre. La latence sera
  MESUREE ET AFFICHEE, jamais promise. CPU onglet a mesurer
  (AudioWorklet + encode).

### B. WebRTC natif dans le moteur (libwebrtc / libdatachannel+opus)

Latence potentiellement meilleure (pas de detour onglet), MAIS :
libwebrtc = build monstrueux ; libdatachannel = dependance native
nouvelle + NAT + jitter a la main = des semaines. REJETE pour S8
(re-ouvrable si la mesure de A condamne la latence).

### C. Relais audio par le serveur (WS)

REJETE : contraire a ADR-019 (l'audio traverserait le serveur ; TURN
est l'exception encadree, pas le chemin normal).

## Decoupage propose (chaque tranche = manip + garde)

- **S8a — le robinet moteur->onglet** : message WS d'abonnement
  `tap-master`, le moteur pousse ses blocs 256 (5,3 ms) post-master a
  l'onglet LOCAL. Garde : spec continuite (compteur de blocs, zero
  trou a charge nulle). Manip : VU "sortie moteur" dans l'onglet
  alimente par le robinet.
- **S8b — la traversee** : signaling `signal{sdp,ice}` relaye par le
  serveur (par projet, pur texte) ; RTCPeerConnection A->B ; STUN
  publics par defaut, PAS de TURN au v1 (NAT stricts = echec PROPRE
  affiche — dette datee TURN self-host). Garde : e2e deux onglets
  (P2P loopback meme machine). Manip : l'onglet B affiche "jam
  connecte" et la latence mesuree (boucle de timestamp DataChannel).
- **S8c — l'ecoute** : l'onglet B joue le flux (WebAudio), tranche
  "JAM" dans l'UI (VU + latence + mute local). Manip : deux machines,
  deux reseaux — B entend le master live de A ; verdict par oreille +
  latence affichee.
- **S8d (arbitrages ulterieurs)** : TURN self-host ; instrument live
  par DataChannel ; opus bitrate/mono arbitrable.

## Critere de succes S8 (le vert de la tranche streaming)

Deux machines, deux reseaux domestiques : B entend le master live de
A ; latence AFFICHEE (cible indicative < 150 ms, jamais promise) ;
coupure/reprise propres ; ZERO octet audio dans les logs du serveur
(verifiable) ; le smoke S7 reste vert (les deux chemins coexistent).

## Risques, par rang

1. **NAT strict sans TURN** : la connexion echoue — echec PROPRE +
   message, TURN = dette datee chiffree ensuite. (Le foyer de
   l'utilisateur : hotspot telephone = CGNAT probable — le PREMIER
   test reel le dira.)
2. **Latence perçue** : mesuree, affichee, honnete ; si condamnee ->
   re-ouvrir l'option B (dossier, pas en direct).
3. **CPU onglet** (Worklet + Opus encode) : mesurer en S8a/b.
4. **Securite** : le signaling passe par le serveur existant (memes
   origines, meme projet) ; pas de nouveau secret.

## Ce que S8 ne fait PAS

Pas de mixage distant (B ecoute, ne mixe pas) ; pas de retour N-voies
(2 pairs au v1) ; pas d'enregistrement du flux (l'ephemere reste
ephemere — les stems sont la memoire).
