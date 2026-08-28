# LINK-DESIGN.md — synchronisation du transport inter-machines (cadrage)

*Statut (2026-08-28) : LIVRE pour l'Etage 1 (L1a horloge, L1b ancres,
L1c rejoin + suspension jam — verts deux machines 2026-08-24, ecart
<= 16 ms). Etage 2 (grille au quantum musical) = T4, DIFFERE en session
dediee (le tempo existe depuis le 2026-08-27). §7 (politique latence
heterogene) = decision ouverte, TODO §2.*

*Session de cadrage 2026-08-24, exigee par TODO avant toute ligne de
code. Declencheur : constat utilisateur pendant le smoke deux machines,
« les deux sites ne sont pas synchronises » — chaque moteur possede son
transport PAR CONSTRUCTION (le document converge, la position ne
converge pas, ADR-002). Reference : le chapitre Link des notes Ableton
(ABLETON-INTEGRALE §4 Tempo), lu integralement le 2026-08-22.*

## 1. Le probleme exact

Deux machines ouvrent le meme projet. Le document est identique a
l'octet (critere 6). Mais PLAY sur la tour ne fait rien au portable :
chaque navigateur ne parle qu'a SON moteur, et chaque moteur a sa
propre position. Resultat vecu : deux lectures independantes du meme
morceau, decalees de n'importe quoi.

Ce que l'utilisateur attend (le standard Ableton Link) : on appuie PLAY
quelque part, tout le monde joue LA MEME CHOSE AU MEME MOMENT, et
personne n'est « le serveur du tempo ».

## 2. Ce que Link enseigne (acquis des notes)

1. **Personne n'est maitre.** Le tempo est un LWW-register : le dernier
   qui touche gagne, tout le monde s'aligne. Pas d'election, pas de
   panne du maitre. Rime directe avec notre CRDT.
2. **La phase est une convention, pas un message.** Les pairs
   s'accordent sur une grille (quantum, ex. 4 temps) ; chacun aligne sa
   lecture sur la grille au lieu d'obeir a un ordre « demarre
   maintenant ». Le « maintenant » n'existe pas sur un reseau.
3. **Start Stop Sync est OPT-IN.** Jouer ensemble et etre relie sont
   deux choses distinctes ; Live les separe, nous aussi.
4. **« Link ecrase l'automation »** = valeur live vs valeur document.
   Nos deux couches (doc / performance) restent distinctes : la
   synchro transport est de la PERFORMANCE, jamais du CRDT (ADR-002
   tient, on ne le viole pas pour ca).

## 3. La transposition en trois etages

### Etage 1 — horloge de session + transport ancre (SANS tempo, faisable maintenant)

Le seul prerequis reel n'est pas le tempo : c'est une HORLOGE COMMUNE.

- **Horloge de session** : estimation d'offset type NTP entre pairs,
  par-dessus un canal deja existant — le ping jam-ctl (DataChannel)
  mesure deja le RTT toutes les 2 s ; il suffit d'y ajouter les
  timestamps aller/retour pour estimer l'offset (filtre : garder les
  echanges au RTT minimal, mediane glissante). Pas de nouveau canal,
  pas de code serveur.
- **Transport = ancre, pas evenement.** L'etat partage n'est pas
  « PLAY ! » mais `{playing, anchor_song_pos, anchor_session_time}` :
  une fonction pure du temps de session. Position courante =
  anchor_song_pos + (now_session - anchor_session_time). Un pair qui
  arrive en retard (ou dont le message a traine 300 ms) calcule ou il
  DOIT etre et s'y cale — pas de derive cumulative, l'erreur est
  bornee par la qualite d'horloge, jamais par la latence des messages.
- **Transport de l'ancre** : l'enveloppe `signal:` existante (relais
  verbatim serveur, deja durci par S8b). Le navigateur qui recoit une
  ancre la traduit pour SON moteur (seek + play locaux) ; le moteur
  reste ignorant du reseau. LWW sur les ancres : la plus recente en
  temps de session gagne (ties : par id de pair).
- **Precision visee, honnete** : quelques millisecondes sur LAN,
  10-30 ms a travers hotspot+box (la ou le jam mesurait ~40 ms de
  transport audio). C'est « jouer ensemble » au sens humain ; la
  precision echantillon inter-machines N'EST PAS l'objectif (meme
  Link ne la promet pas hors LAN).

### Etage 2 — la grille (APRES la vague 2 tempo)

Quand le document aura tempo_bpm + tempo_map (cadrage vague 2 deja
ecrit) : l'ancre devient `{beat, session_time}` au lieu de
`{seconds, session_time}`, et le rejoin s'aligne au prochain multiple
du quantum (4 temps par defaut) au lieu de sauter en plein temps.
C'est la SEULE partie qui depend du tempo — raison pour laquelle
l'etage 1 n'attend pas la vague 2.

### Etage 3 — opt-in et politique

- Bouton « SYNC » dans la barre transport (etat de performance, comme
  loop) : OFF par defaut. ON = j'emets mes ancres et j'obeis aux
  ancres des autres. Exactement le Start Stop Sync de Live.
- Tempo (une fois la vague 2 la) : LWW dans le DOCUMENT (c'est un
  parametre du morceau, pas de la performance) — deja arbitre §4.

## 4. Rapport au jam S8 (arbitrage necessaire)

Deux features distinctes qui se marchent dessus si on ne dit rien :

- **Jam** = j'ECOUTE le rendu d'un autre moteur (l'invariant : entendre
  le plugin que je n'ai pas). Flux audio, ~40 ms de retard.
- **Sync** = nos deux moteurs jouent le MEME document en phase.

Si un pair ecoute le jam ET que son moteur local joue en sync, il
entend DEUX fois le morceau a 40 ms d'ecart (flanger garanti).
**Regle proposee** : ecouter un jam correspondant au projet courant
suspend la lecture locale (le flux distant EST la lecture) ; le sync
transport ne concerne que les pairs qui ne sont pas en ecoute jam.
**TRANCHE 2026-08-24 (utilisateur) : OUI** — entrer en ecoute jam
arrete le moteur local, le bouton PLAY est suspendu (annonce au
badge), et les ancres de transport recues sont comptees mais jamais
appliquees tant que l'ecoute dure. La reprise apres l'ecoute est un
geste manuel (pas de re-lecture automatique).

## 5. Ce que ce cadrage REFUSE

- Un maitre de session ou un role serveur dans le temps reel
  (ADR-019 : le serveur relaie des octets, il ne possede pas le temps).
- La precision echantillon inter-machines comme critere (hors LAN,
  c'est un mensonge ; le rendu offline par hash reste notre outil de
  verite bit-exacte).
- Le transport dans le CRDT (ADR-002 ; une ancre est ephemere,
  intransigeance validee par « l'etat de performance Session » refuse
  au §5 des notes).
- Implementer le protocole Link binaire d'Ableton (multicast UDP LAN
  uniquement, incompatible avec notre topologie relais/WAN ; on
  transpose les PRINCIPES, pas le wire format). Interop Link LAN
  reelle = dette datee, declencheur : demande utilisateur.

## 6. Decoupage en sessions (bornees, regime du depot)

1. **L1a horloge** : offset NTP-style dans jam-ctl (+ fallback via
   relais `signal:` quand pas de DataChannel), expose `__dawClock`
   {offset_ms, rtt_ms, confidence} + badge discret. Critere : deux
   machines affichent un offset stable (±5 ms sur 5 min) — verifiable
   en pilote pur.
2. **L1b ancres** : bouton SYNC, emission/reception d'ancres via
   `signal:`, traduction ancre -> seek+play moteur. Critere : PLAY sur
   la tour, le portable demarre au meme endroit (verdict a l'oreille +
   positions telemetrie ecartees < 50 ms).
3. **L1c polissage** : rejoin en cours de lecture, stop synchronise,
   arbitrage jam-vs-sync (§4) applique.

Chaque session livre sa manip visible/audible. L2 attend la vague 2 ;
L3 tempo-LWW arrive avec elle.

## 7. Politique latence/synchro heterogene (intrant utilisateur 2026-08-25)

A TRANCHER a la session PDC/L2, pas de code avant. Constat utilisateur :
il faudra un CHOIX explicite de politique latence+synchro EN FONCTION de
l'heterogeneite des pairs — chacun a sa propre connexion (RTT), sa propre
latence moteur (taille de buffer device) et ses propres latences plugin
(PDC de chaque chaine). On ne peut pas supposer un monde homogene.

Ce que ca croise (deja cartographie) :
- Le PDC LIVE n'existe pas aujourd'hui (AUDIT-5 A5) : la latence est
  declaree partout mais AUCUN alignement inter-pistes en live. C'est le
  prealable TECHNIQUE ; la politique ci-dessous est la decision AU-DESSUS.
- La synchro transport (L1a/b) suit deja le RTT et la derive par paire.
  Mais elle synchronise des POSITIONS de lecture, pas des latences de
  traitement — deux machines calees a la meme position peuvent quand meme
  sortir le son a des instants differents si leurs PDC/buffers different.

Axes du choix (a peser, non tranches) :
1. ALIGNER SUR LE PLUS LENT : chaque pair retarde sa sortie jusqu'au max
   des (latence moteur + PDC + une marge reseau) de tous les pairs.
   Tout le monde synchrone, mais latence commune haute (le pair le plus
   mal loti impose sa latence a tous — injouable pour du jeu live).
2. COMPENSATION LOCALE SEULE : chaque pair compense son propre PDC/buffer,
   le skew inter-machines subsiste (borne par L1a). Simple, jouable en
   local, mais l'ecoute croisee peut flanger.
3. SKEW TOLERE BORNE : on accepte un desalignement inter-machines tant
   qu'il reste sous un seuil (a chiffrer), au-dela on degrade (suspension
   jam facon L1c, deja le modele pour l'ecoute).
Facteur transverse : la POLITIQUE peut dependre du MODE (edition asynchrone
= tolerant ; jam temps reel = strict ; ecoute d'un pair = son PDC a lui).
Lien lieux-d'ecoute (TODO 2bis) : « ecouter chez un pair » = adopter SA
latence, pas la mienne — la politique doit etre exprimable PAR lieu d'ecoute.

REFUS implicite a garder : pas de latence commune imposee en dur (option 1
seule) — elle tue le jeu live, le refus grave d'ADR-019 sur le monitoring
distant a latence de jeu en decoule deja.
