# JOURNAL — chronique datee du projet

*Append-only. STATUS.md ne garde que l'ETAT courant ; chaque session y
laisse un delta court et consigne ici le recit date. (Scission decidee a
l'arbitrage AUDIT-4, 2026-08-23 — les blocs ci-dessous viennent de
STATUS.md, inchanges.)*

---

**2026-08-22 (CI-verite):** premier run CI vert de l'histoire du projet —
https://github.com/seithnessflow/daw-project/actions/runs/32531658552 —
moteur + SDK VST3 + determinisme valides sur un second OS jamais utilise
pour developper. STATUS ne contient plus de phrase que le reel contredit.
(Run #48, a91d57b : 14 tests moteur sous Linux dont hash + plugin_host/
AGain, E2E complet. Avant lui : 47 runs rouges jamais regardes — lecon
inscrite au regime.)

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

**Detail critere 3 (historique des validations et dettes soldees) :**
- Valide (Playwright, epoque) : sync online, bidirectionnelle, ajout de
  piste.
- 2026-08-21, dette soldee : `criterion3-offline.spec.ts` (arret/relance
  REELS du serveur, onglets vivants pendant la coupure, edits distincts +
  conflit) VERT, `test.fail()` retire. Corrections : outbox (file des
  changements emis hors ligne, envoyes dans l'ordre a la reconnexion) ;
  fusion a la reconnexion via `Automerge.merge()` (premier message de
  chaque connexion = document complet, drapeau par connexion).
- A3-4/A3-5 soldes 2026-08-22 : push symetrique getMissingChanges ->
  sendChange a chaque reconnexion, flushOutbox non-destructif,
  requestResync sur echec d'applyChange. Garde : criterion3-push.spec
  (flush avale reproduit, serveur redemarre, le change revient). 15/15.
- Dettes distinctes soldees : outbox persistee (miroir localStorage par
  onglet + adoption des files orphelines, spec outbox-persistence,
  2026-08-22) ; persist-avant-broadcast (websocket.rs, test kill brutal,
  2026-08-21) ; course a la creation du doc par defaut (store_lock, test
  concurrent_first_writes, 2026-08-22).

**Problemes resolus (fondation, 2026-08-20/21) :**
1. Depot git initialise, premier commit `d2c5015`.
2. Fichiers temporaires supprimes, .gitignore en place.
3. WebSocket Windows : `ix::initNetSystem()` + port 47821 (9000 occupe
   par wslrelay ; SO_REUSEADDR patche).
4. Incompatibilite Web/Server : Web migre vers Automerge reel (ADR-016).
5. Web incompatible moteur : `engine_client.ts` en Protobuf, token en
   premier message binaire, port 47821.

**2026-08-23 (AUDIT-4, lecture seule) :** quatrieme audit — 3 passes
paralleles (moteur, serveur/sync, web/scripts) + critique de fond des
.md. Moisson : trio deps-manquantes qui vide la garantie du critere 3
(reserve ROUVERTE), slot perime rejoue par le ring sous surcharge,
enfants VST3 zombies sans eviction, et jumeaux documentaires qui
divergent (20/20 vs 21 tests reels, deux registres DECISIONS, ADR-005
mensonger). Ordre 1-6 consigne dans TODO (arbitrage utilisateur).

**2026-08-23 (session 1 — documents qui disent vrai) :** corrections
factuelles de A4-20 (21/21, token par port dans les procedures, port
9000 purge, README verite, ADR-005 corrige, en-tete websocket_server.h,
dettes soldees cochees) ET les 4 fusions structurelles arbitrees : ce
JOURNAL est ne (STATUS scinde etat/journal), DECISIONS racine fusionne
dans docs/DECISIONS.md, BACKLOG fusionne dans TODO, CLAUDE.md renvoie a
STATUS au lieu de dupliquer les criteres. Verdict CI : VERT (run
32635910751, seul un commentaire .h touchait le code).

**2026-08-23 (LE RECADRAGE — ADR-019, le differenciateur distribue) :**
un regard neuf (session Fable externe, rapport de passation) a constate
que l'idee CENTRALE du produit — un pair sans le plugin entend le
resultat du plugin — etait a zero ligne : critere 3 = deux onglets (pas
deux machines), uid resolu par machine sans reponse pour le pair
demuni, loi « rien de temps reel ne traverse le serveur » qui
interdisait le produit, LNA (hypothese porteuse) jamais teste, roadmap
= parite Ableton. Arbitrages utilisateur consignes (ADR-019) : loi
reecrite (aucun audio TRAITE cote serveur ; P2P + signaling), placement
dans le document (SCHEMA v2 annonce), STEMS RENDUS via le store
(verite de lecture, reutilise determinisme + PUT verifiant) ET
STREAMING P2P (canal ephemere du jam) tous deux de premiere classe —
deux fonctions, pas un chemin dedouble ; monitoring d'instrument a
latence de jeu via VST distant = REFUSE (RTT). Critere 3 redefini
(deux machines, deux reseaux, un projet), critere 6 = l'invariant.
Parite Ableton GELEE. TRANCHE 3 ouverte en tete de TODO ; LNA passe
premier ; ordre AUDIT-4 item 2 requalifie fondation du multi-machine ;
2.5-etat requalifie prerequis de la cle de stem.

**2026-08-23 (LNA — l'hypothese porteuse testee LE JOUR MEME, elle
tient) :** page de test servie via tunnel trycloudflare (cloudflared
installe, page sur node:8080), moteur --mute en lecture avec
--allow-origin sur l'origine du tunnel. Resultat des mains : l'invite
de permission Chrome APPARAIT, et une fois autorisee le WebSocket se
CONNECTE depuis l'origine HTTPS publique au moteur local (onopen =
handshake accepte, Origin passe). Le canari fetch est non conclusif
chez nous : le moteur repond 400 sans en-tetes CORS, le navigateur
affiche « Failed to fetch » meme quand le reseau passe — defaut de la
page de test consigne. Reste 30 s de mains : refus/memoire/annulation.
Observation : le moteur ne loggue pas les connexions acceptees.

**2026-08-23 (campagne LNA automatisee — l'oracle temporel) :** sur
directive du reviewer, tout l'automatisable a ete automatise (Playwright
sur le VRAI Chrome 151, profils vierges). L'oracle : etat prompt +
tentative qui PEND = invite affichee ; echec immediat = subit sans
pouvoir demander ; succes immediat = non soumis. Verdicts : fetch ET
WebSocket pendent tous deux (soumis au LNA, savent demander — le pire
cas est ecarte) ; ZERO GESTE viable (connexion au chargement declenche
l'invite) ; permissions.query lisible en reel ; AUTH OK de bout en bout
quand permis ; 4001 sur token perime (signature distincte). Prealable
pose en route : --keepalive au moteur (le doc de 600 s tuait la stack
de test en plein run — une passe entiere perdue avant le correctif ;
mode fichier boucle via seek(0), API lock-free existante). Lecons de
methode payees : CDP setPermission = accepte mais no-op (deny non
automatisable) ; les captures d'ecran/entrees OS pendant que
l'utilisateur se sert de la machine capturent SA fenetre — approche
abandonnee, captures supprimees ; la ligne « latences identiques » de
R1 est RETIREE (runs contamines par l'invite en attente). Inconnus
dates (documentation, pas bloquants) : texte de l'invite, semantique
dismissal/refus explicite, memorisation, FF/Safari. Reste UN geste
humain : le sceau vert (AUTH OK) dans le navigateur de l'utilisateur.

**2026-08-23 (seance musique — premiere utilisation complete en
utilisateur) :** un morceau de 48 s (ma-piece.wav, 5 pistes, 203 clips
poses par l'UI, AGain sur la kick regle a 0,72 par le slider UI, bypass
A/B mesure a -2,85 dB exact, rendu vert -2,82 dBFS). Moisson : le
compte-rendu de friction (pas de duplication de clips = gene n.1 et
ABSENTE de la roadmap ; add/remove device inexistant dans l'UI ;
suppression de clip qui echoue en silence ; ear muet sur les assets du
store ET vert sur 48 s de silence ; pas d'export UI ; 20 px/s sans
zoom ; lecture sans fin ; pas de renommage). Arbitrage utilisateur :
ordre A (ear-verite) -> B (suppression/selection) -> C (lecture Ableton
duplicate -> modele) -> D (add/remove device), puis 1pre/1bis. Habitude
gravee : trace visuelle a chaque seance UI. VCV Rack note en piste
future (apres l'invariant).

**2026-08-23 (session A — ear-verite) :** l'oreille resout desormais
les assets depuis le STORE du serveur (staging par hash, test-assets en
secours, asset manquant = REFUS bruyant, plus jamais du silence) ; et
le silence integral est ROUGE PAR PRINCIPE (self-test 6 : silence pur
rouge avec raison nommee, piece eparse reste verte). Preuve : ma-piece
rendait muet-vert, elle rend maintenant son-vert sans aucune copie
manuelle. La lecon du hash-de-silence, soudee cote outillage.

**2026-08-23 (session B — la selection ne ment plus) :** cause du
Suppr-inerte de la seance musique trouvee : un clic sans mouvement sur
une poignee de bord ne selectionnait rien (branche absente), et un clip
minuscule est entierement couvert par ses poignees — selection
impossible en silence. Correctifs : clic-poignee = selection,
deselection re-rendue (A4-18 solde), halo lisible a toute largeur.
Garde clip-selection.spec (5 invariants), suite 16/16, trace visuelle
sur un clip de 2 px. Decouvertes en route : Ctrl+D duplicate et zoom
+/- EXISTENT deja, caches — la fonctionnalite sans affordance ;
consigne comme intrant de la session C.

**2026-08-23 (inventaire de l'invisible — ce que le code sait faire et
que l'interface ne montre pas, 30 min, liste sans corrections) :**
CLAVIER : Delete/Backspace (supprime le clip selectionne) ; Ctrl+D
(duplique sur le pas de grille suivant, selection sur la copie) ;
Espace (play/stop — seul raccourci annonce quelque part, par daw.ps1) ;
+/- (zoom centre) ; W (fit all) ; H (pistes compactes) ; Z (zoom 8 s
autour du marqueur, pile) / X (pop retour, a la Ableton) ; Ctrl+molette
(zoom au curseur). GESTES : Alt pendant drag/resize = snap desactive ;
snap a grille RAFFINEE par le zoom (0,5 -> 0,0625 s selon pps) + snap
aux bords des voisins (8 px) — aucune grille dessinee nulle part ;
trim par la poignee gauche = head-trim (offset preserve) ; double-clic
sur l'overview = fit all ; molette/scroll simple = pause du Follow
(reprise : bouton ⇥, lui-meme un glyphe nu). CLICS : clic couloir non
arme = selection piste + POSE LE MARQUEUR D'INSERTION + pause Follow
(un clic, trois effets, rien ne le dit) ; re-clic sur le chip arme =
desarme. BOUTONS NUS : ⇥ (follow), A/B/C (prototypes touch — trois
lettres sans legende). URL : ?project= (seul moyen de changer/creer un
projet), ?lab=1 (KIT harnais), ?starter=1. Bilan : 16 capacites sans
affordance — la session C devient « rendre decouvrable », plus rien a
concevoir. REGLE GRAVEE dans CLAUDE.md : une cible plus petite que ses
propres poignees est inatteignable (fades/automation/marqueurs :
verifier a chaque poignee).

**2026-08-23 (session 1pre — le token sans copier-coller) :** le geste
fondateur « j'ouvre le site, ca marche » tient au niveau dev :
resolution fragment -> query legacy -> endpoint local /api/engine-token
(le serveur de dev lit %TEMP%, la page ne peut pas ; reponse illisible
cross-origine faute de CORS, LNA par-dessus). La regle 4001 est cablee
et PROUVEE sur un restart moteur reel : token perime -> re-fetch + une
retentative silencieuse, l'onglet reverdit sans rechargement. daw.ps1
passe au fragment (M4 attenue : le token ne voyage plus en query).
Garde : token-zero-paste.spec. Le chemin site-distant (moteur qui sert
son token Origin-gate, ou lancement-fragment seul) reste date dans
TODO/ADR-019 — non bloquant pour 1bis.

**2026-08-23 (preparation 1bis — les deux verrous sautent) :** le
serveur peut ecouter au-dela du loopback (DAW_SERVER_BIND, defaut
loopback conserve, note de securite gravee : bind ouvert = tout le LAN
est client natif exempt, C2-distant devient vivant) ; le web accepte
?server=<hote:port|url> et l'adresse HTTP des assets en derive (jumeau
SERVER_HTTP de waveform.ts tue — une seule source). Garde :
server-param.spec. Suite 18/18. Verdicts CI : 1pre VERT (run
32642816909, build+e2e) ; B couvert par inclusion par ce meme run (son
propre run suspendu sur une anomalie de runner, job e2e >50 min).
Terrain du smoke : le portable de l'utilisateur — phase 1 meme reseau
(IP LAN + regle firewall), phase 2 deux reseaux via partage de
connexion telephone + tunnel cloudflared vers :3000 (wss).

**2026-08-23 (LE SCEAU — critere 4 clos) :** dans le navigateur reel de
l'utilisateur (Chrome 151/Windows 11) : sonde granted, canari no-cors
« NETWORK PATH OPEN » en 4 ms, onopen a 3 ms, AUTH OK + telemetrie
(13 octets) a 23 ms. Formulation gravee au critere : l'acces au moteur
local depuis une origine HTTPS publique fonctionne sur Chrome 151/
Windows 11, sous reserve d'autorisation utilisateur, avec etat lisible
par API. Les inconnus restent dates (texte de l'invite, dismissal,
refus explicite, memorisation, FF/Safari). Cap suivant : 1pre
(mecanisme du token) puis 1bis (smoke deux machines).

**2026-08-23 (retour du pair reviewer sur l'execution, consigne le jour
meme) :** verdict LNA requalifie ⚠️ TIENT SOUS CONDITIONS (le mecanisme
est la carve-out loopback — le tunnel n'a servi que la page, l'URL WS
etait 127.0.0.1 par construction ; --allow-origin = design d'origine
prod a trancher ; handshake prouve, pas l'audio ; Firefox/Safari non
testes). ADR-019 amende : la cle de stem est une CLE DE CACHE D'ENTREES
(version/build du plugin + samplerate dans la cle, jamais d'assertion
de re-rendu bit-exact d'un tiers — les VST ne sont pas deterministes) ;
intrants SCHEMA v2 graves (stem perime = etat d'UI, un stem survit a
son producteur, PDC cuite ou declaree) ; ligne de controle gravee (B
pilote les params exposes via CRDT, GUI et binaire ne traversent
jamais — la ligne juridique) ; vigilance streaming (s'il deborde, on
coupe le streaming, jamais les stems). Ordre corrige : SMOKE DEUX
MACHINES hoiste en 1bis, avant le placement — valider l'hypothese qui
porte tout AVANT de construire dessus. Correction item 2 (fondation
multi-machine) et 2.5-etat-prerequis ACCEPTEES par le reviewer.
