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

**2026-08-23 (1bis — LE SMOKE DEUX MACHINES EST TENU, les deux sens) :**
fixe et portable TX15 (hotspot telephone = deux reseaux, NAT reel), un
seul serveur (fixe, loopback, tunnel cloudflared), relais ws->wss cote
portable. ALLER 16:07:26 UTC : premier-passager.wav depose cote fixe ->
document + asset traverses jusque DANS le moteur du portable (fichier
698e95 sur son disque, verifie par SSH). RETOUR 16:32:23 UTC :
retour-du-portable emis du portable -> mon store (PUT 201, 76 844 o),
mon moteur fetch + Graph updated v=4. La palette du fixe affiche les
chips des DEUX machines. C'est la premiere fois que le produit existe
tel que pitche : deux machines, deux reseaux, un projet. Reserves :
geste retour au niveau document ; ecran portable atteste par son agent.
Frictions : moteur sans --assets ecrit les fetches dans le CWD ;
lecture sans fin (57 min au compteur). Le controle SSH inter-NAT
(docs/deux-machines.md) a servi pour toute la verification distante.

**2026-08-23 (moisson ultra — les 7 nits de la premiere ultrareview,
PR #1, soldes en une session) :** budget de refresh 4001 par cycle
PLANIFIE (l'echec d'un fetch ne fige plus la pastille au rouge, et
jamais de boucle serree — invariant mieux que la suggestion de la
revue) ; relais : terminate() du wss si le client avorte pendant le
handshake ; ?server= normalise (slash final strippe, http(s) coerce en
ws(s)) + 2 tests des formes reellement collees ; #token efface de la
barre d'adresse apres lecture (motif OAuth) ; jumeau SERVER_HTTP
vraiment tue (placement importe du proprietaire) ; page de test LNA :
fossile /tmp corrige ; mon waitForTimeout remplace par un detecteur
actif (echantillonnage continu des heads — la suggestion expect.poll
de la revue passait a la premiere lecture, refusee). tsc vert, 19/19
local (spec token exclu : le moteur du duo tient 47821 — verdict
complet par la CI).

**2026-08-23 (V1.1 — la lecture boucle et s'arrete ; le programme
complet est ouvert) :** plan « tout, falaises comprises » approuve
(4 vagues + entrelacs differenciateur, designs challenges par agent).
V1.1 livree : les atomiques loop morts deviennent vivants — wrap
SAMPLE-ACCURATE par sous-bloc dans le callback (jamais un trou d'un
buffer driver), arret en fin de contenu PAR le callback (position
parquee a end exactement), ECRIVAIN UNIQUE de position_ retabli (le
keepalive passe a setLooping, l'auto-stop du thread de controle
supprime, la CLI sort sur is_playing=false) ; garde projet-vide
(end<=start : ni wrap ni stop ni spin). Proto LOOP additif regen DEUX
etages (et proto:gen remplace par un script node multiplateforme — le
fossile POSIX A4-20.5 soldee) ; bouton loop (aria-pressed, re-assere a
chaque reconnexion). Tests : moteur 22/22 (nouveau test callback,
premier du genre : wrap exact 900+512 sur [0,1000) -> 412), e2e 21/21
dont transport-loop.spec (wrap VU dans la telemetrie, gel du compteur
apres loop OFF, moteur reel).

**2026-08-23 (V1.2 — la piste master existe) :** masterGain a la racine
du document (ADDITIF, absent = 1.0, hash de reference sur par
construction — verifie), applique en DERNIER etage de
AudioGraph::process (offline = live par construction, zero jumeau) ;
peaks master calcules la aussi et AJOUTES AU PROTO Meters — le
navigateur n'avait AUCUN chemin master avant (trou trouve par l'agent
Plan). UI : tranche MASTER dans la barre (fader lie au doc, VU stereo,
dB, rouge > -1 dBFS — la regle de l'oreille enfin visible). Moves
manuels d'AudioGraph (les atomiques master tuaient le move par defaut).
Setter d'authoring cote moteur (famille addTrack). Tests : moteur 23/23
(testMasterGainRender : peaks EXACTEMENT halves au niveau flottant,
roundtrip du champ) ; e2e 22/22 (master-gain.spec : convergence 2
onglets, patron critere 3). SCHEMA.md a jour.

**2026-08-23 (V1.3 — Ctrl+Z. Enfin.) :** journal d'inverses TYPES
(web/src/document/undo.ts) : chaque mutateur local capture son inverse
AVANT d'appliquer ; undo = rejeu en NOUVEAUX changes (les heads ne
reculent jamais — le travail distant survit par construction, prouve
par spec 2 onglets). Groupes de geste (begin/endUndoGroup, premiere
capture par cible) : un drag de 60 ecritures = UNE entree, faders piste
ET master inclus (pointerdown/up). Cas limites du challenge tous
implantes : deleteClip inverse = addClip 5 champs meme id ; param
NOUVEAU inverse = splice (removeProcessorParam ne) ; deleteTrack ne
comme inverse d'addTrack (TrackDef complet) ; load() vide les piles ;
routage du rejeu (undo->redo, redo->undo) ; ops distantes = zero
contact avec les piles. BUG l'ultra corrige : KeyZ sans garde de
modificateur — Ctrl+Z zoomait. Piles bornees 100. Tests : e2e 23/23
dont undo-redo.spec (5 invariants : geste=1 entree, restauration
convergente, geste distant intact, redo vide, pas de vol de zoom).

**2026-08-23 (V1.4 — ce que le DAW sait, l'ecran le dit) :** la GRILLE
DE SNAP est dessinee dans les couloirs (deux calques CSS pilotes par
variables : fin = pas de snap, fort = la seconde — se raffine au zoom,
zero cout DOM) ; les trois effets du clic de couloir sont ANNONCES
(marqueur d'insertion qui flashe, piste qui flashe a la selection,
bouton follow qui dit sa pause avec titre explicite — le corollaire
grave « une action a plusieurs effets doit les montrer tous » est
applique a son precedent fondateur) ; panneau d'aide « ? » (touche et
bouton, Echap ferme, 13 raccourcis enfin dits — la moisson de
l'inventaire de l'invisible). BUG trouve par le spec en route : la
garde BUTTON du clavier mangeait l'Echap quand le bouton ? gardait le
focus — panneau infermable au clavier, corrige (l'aide passe avant la
garde). Suite 24/24 (visibility.spec : grille+vars au zoom, panneau,
flashs, follow-paused). Traces : traces/session-v14/.

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

**2026-08-23 (V1.5 — devices depuis l'UI + eviction A4-5) :** le panneau
DEVICES gagne `+ device` (builtin.gain | vst3 par uid 32-hex valide,
AGain pre-rempli — un uid invalide n'atteint JAMAIS le document) et un
retrait ARME en deux clics (clavier-safe ; Ctrl+Z restaure de toute
facon). addProcessor/removeProcessor journalises : l'inverse d'un
retrait re-insere le ProcessorDef complet A SON INDEX (une chaine est
un pipeline, l'ordre est un sens — la spec l'asserte). Cote moteur,
l'eviction A4-5 : au rebuild, les enfants dont le node_id a quitte le
document sont stop()+evinces, mais DIFFERES jusqu'au vidage de la file
des graphes retires (un ProxyNode retire lit encore le ring — evincer
avant la barriere generationnelle serait un use-after-free), et la
telemetrie est re-cablee immediatement (elle tenait des pointeurs bruts
dans le handle detruit ; wirePluginTelemetry sait desormais poser
nullptr). Bug attrape par la spec, pas par mes yeux : display:flex du
menu ecrasait l'attribut [hidden] — le menu « ferme » interceptait
tous les clics du panneau. Moteur 24/24 (testRegistryEviction :
2 evinces, survivant a la meme adresse, idempotent), devices.spec
5 invariants avec convergence 2 onglets. Seance conduite moteur duo
MUET (ordre utilisateur : film en cours).

**2026-08-23 (V1.6 — fades, degel acte, cloture de la vague 1) :**
l'option laissee ouverte au plan est TRANCHEE par equivalence : ramper
du silence etant l'identite, le fade implicite anti-clic « seulement si
le bord coupe du signal » = le fade inconditionnel, echantillon-pres —
implemente inconditionnel (4 ms = sample_rate/250, clampe a la moitie
du clip), zero branche dependante du contenu. Rampes lineaires dans
ClipPlayer::render (chemin PARTAGE live/offline), champs additifs
fadeIn/fadeOutSamples (schema.h + automerge + SCHEMA.md + web).
CONSEQUENCE ASSUMEE : nouveau hash de reference 56729beb61993cd7
(l'ancien 89f1a110 rendait des bords non rampes ; DECISIONS.md porte
la justification, ci.yml et STATUS suivent). UI : ombres diagonales +
poignees de coin draggables, journalisees undo (une poignee = les deux
champs ecrits ensemble, un geste = une entree). TROIS bugs attrapes par
les gardes, pas par mes yeux : (1) un clip de 8 px a ses deux poignees
de fade superposees — le corollaire poignees ENCORE (max-width 45%
chacune, la spec visait 'in' et attrapait 'out') ; (2) le chemin
sameStructure de renderTracks n'actualisait pas les fades distants —
le fade d'un pair n'apparaissait JAMAIS (updateClipFadesUI in-place) ;
(3) les poignees posees en haut du clip RECOUVRAIENT la barre de
titre — drag de clip et selection voles (2 specs de regression
rouges) ; meme loi que les edges de la session B : rien ne couvre le
bandeau (top 13px).
Et une lecon de C++ : getDocument() retourne PAR VALEUR — une
reference chainee sur le temporaire a segfaulte la suite entiere
(0xC0000005 muet, stdout bufferise perdu). Moteur 25/25
(testClipFadesRender : rampes explicites 100/50 exactes, implicite
clampe 150, roundtrip, silence inter-clips).

**2026-08-23 (ENTRELACS ouvre — critere 3 vraiment vrai, round 2) :**
le trio deps-manquantes AUDIT-4 solde d'un bloc, plus le heartbeat.
A4-1 : automerge-rs met en file un change a deps manquantes SANS
erreur et save() ne serialise pas la file — le serveur croyait
persister, jetait, et broadcastait quand meme ; desormais
get_missing_deps() non-vide = refus bruyant, rien n'est broadcast que
le disque ne tient (garde Rust : scenario Lagged reproduit, c2 sans c1
refuse, dans l'ordre ca passe). A4-2 : meme silence cote JS —
applyChanges bufferise sans exception ; applyChange lit
getMissingDeps apres coup et rend false -> resync (garde spec :
c2 seul = false, c1 arrive = tout s'integre). A4-3, le choix de
conception : GRAINE DETERMINISTE PAR COPIE, pas par construction —
make-seed.mjs genere UNE FOIS les octets Automerge (acteur fixe
da5eed..., time 0, les 2 pistes par defaut) ; le serveur les embarque
(include_bytes!), le web charge les memes octets en placeholder ;
zero pari sur le determinisme inter-langages. Premier contact =
MERGE + push (le meme chemin que la reconnexion), load() destructeur
supprime ; un demarrage sans serveur dessine la graine et reste
editable (le placeholder n'etait JAMAIS rendu sans serveur — attrape
par la spec). A4-1c : echec de save du doc initial = fermeture, plus
jamais un doc fantome. A4-4 : heartbeat applicatif serveur->clients
(frame texte 'hb' 15 s, entrelacee au broadcast par select) + watchdog
45 s cote onglet qui force-close le socket zombie vers la mecanique de
reconnexion ; le moteur C++ ignore les frames texte par construction
(msg->binary), les vieux onglets aussi — contrat verifie sur chaque
consommateur. Gardes : cargo test 7/7 (dont refus-Lagged et
seed-nouveau-projet), sync-resilience.spec 3 invariants (dont LE
scenario du remede : serveur eteint, editer, serveur demarre, rien ne
se perd, l'onglet 2 converge). Reserve du critere 3 (2 onglets) LEVEE
dans STATUS ; les deux machines ont enfin leur fondation.
POST-SCRIPTUM qui vaut la session : la garde neuve a EXHUME une
corruption reelle — projects/default.am porte 3 dependances manquantes
PERMANENTES, cicatrices de l'ere A4-1 (les changes avales par le vieux
serveur, references par ceux qui ont suivi). La garde absolue
(missing != 0 = refus) mettait ces vieux docs en boucle de resync
INFINIE des deux cotes (le serveur refusait meme la graine poussee,
l'onglet refusait chaque broadcast). Regle finale gravee : le refus se
mesure en DELTA — un change qui AJOUTE des deps manquantes est le cas
Lagged ; les cicatrices historiques se tolerent. Et l'auto-guerison
marche : au premier contact d'un vieux projet, l'onglet pousse la
graine (une fois), le serveur l'adopte — default.am est desormais
seed-racine, plus un churn. Raffinement au passage : au premier
contact la nouveaute du serveur est ATTENDUE (sinon chaque ouverture
d'onglet payait 3 connexions de verification).

**2026-08-23 (2.5-etat, session A — l'etat traverse la frontiere de
process) :** premiere brique du differenciateur apres le design
SCHEMA-V2. Le ring passe en layout v4 : deux atomics de sequence
(state_request/state_ready) — le BLOB ne traverse jamais le ring, il
voyage par le fichier `<segment>.state` (format partage
[u32 comp][u32 cont], header commun state_file.h, regle des jumeaux —
un contrat entre deux executables vit en UN lieu). Cote enfant :
IBStream memoire minimal ecrit main (le MemoryStream du SDK n'est
compile que par le validator — le tirer aurait evince le cache CI du
SDK), restauration a la CEREMONIE avant le heartbeat (processor-first
par construction : seul IComponent existe), requetes de sauvegarde
servies entre les blocs (un getState rate SUPPRIME le fichier — le
bridge ne lira jamais des octets perimes comme frais). Cote bridge :
setPendingState (poser le blob avant spawn/restart), saveState
(attente bornee, vivacite surveillee). Garde : testPluginStateRoundtrip
— param 0.25 via le ring dans la vie A, blob de 12 octets, vie B SANS
AUCUN param recoit le blob et sort EXACTEMENT 0.25x, et son propre
getState re-rend le blob bit-identique. Moteur 26/26. Session moteur
pure, pas de manip utilisateur — elle arrive en session B (stateHash
dans le document + store). CI V1.5 annulee (runner suspendu des
heures ; verdict subsume par les runs verts 8c1671f et 71c2577,
surensembles du code).

**2026-08-23 (2.5-etat, session B — l'etat entre au document, et
l'incident duo) :** la boucle complete du differenciateur cote etat
VIT, prouvee sur la stack duo reelle : AGain ajoute depuis l'onglet
(+ device) -> param via CRDT -> rebuild moteur -> capture DEBOUNCEE
1 s apres la rafale -> sha256 du blob au store local + PUT au serveur
-> setProcessorState (LE champ que le MOTEUR authore : seule la
machine qui heberge le plugin peut serialiser son etat) -> change
expedie -> badge « 480376c6 v1 » visible dans le panneau devices des
deux cotes. Restauration : ensureVst3Child pose le blob AVANT le
spawn (résolution par la route des assets : local, sinon store) ; un
blob manquant = warning et defauts, jamais un spawn rate. Gardes :
testProcessorStateInDocument (authoring, refus d'ids inconnus, bytes
de change, save/load), moteur 27/27, e2e 29/29.
L'INCIDENT QUI VAUT LA SESSION : en verifiant sur duo, pistes VIDES
et silence — la GRAINE poussee par l'anti-entropie du premier contact
avait cree un conflit LWW sur `tracks` du VIEUX projet, et la liste
vide de la graine avait GAGNE le tirage (les 39 clips du duo eclipses,
pas perdus — CRDT). Racine : le placeholder VIERGE n'a rien a pousser ;
merger pour merger est une erreur. FIX : isPristineSeed() — au premier
contact, un placeholder intact ADOPTE le doc serveur (load), la route
merge+push est reservee aux VRAIES editions hors-ligne. REPARATION :
re-election de la valeur perdante par reecriture de `tracks` (backup
.pre-repair.bak) — duo rejoue ses 39 clips (peaks de retour, muets).
Audit du parc : ma-piece INTACTE (203 clips, zero conflit), beat/beat2
sains, default.am laisse en l'etat (son « perdant » est un monstre de
1246 pistes de tests — la vue graine est plus saine). Les specs
offline/criterion3/devices re-vertes apres le fix.

**2026-08-23 (refonte du site, tranches 1-2 — directive utilisateur
« le site refait completement au fur et a mesure ») :** programme de
refonte grave au TODO (6 tranches, une par session, chaque tranche
VISIBLE dans l'onglet ouvert par HMR). Tranche 1, la fondation :
rampe de profondeur chaude (les surfaces deviennent des COUCHES,
--surface-4), texte contenu eclairci vs chrome assombri, accent
POTION violet (titre en degrade, focus, selection) a cote de l'ambre
d'etat, boutons en vrai relief (hairline + lumiere interne + presse),
vignette de scene, scrollbars raffinees. Tranche 2, la topbar : barre
reelle sur surface encadree, transport en CLUSTER encastre (le cadre
au groupe, pas a chaque touche), horloge phosphore (lueur + lunette),
statuts en pilules a halo. CSS pur les deux fois — zero DOM, les
specs sensibles a la geometrie re-vertes (l'unique rouge etait la
collision de port 47821 documentee, pas la CSS). Traces :
traces/refonte-t1/.

**2026-08-23 (S7 — LE JALON : un pair sans le plugin entend le
plugin) :** l'invariant produit passe de zero ligne (constat du
recadrage) a PROUVE PAR ECHANTILLONS. Producteur : renderTrackStem —
document reduit (clips + chaine jusqu'au noeud INCLUS, gain de piste
et master forces a 1.0, ils restent VIVANTS cote lecteur), rendu
offline en FLOAT32 IEEE (decision : le WAV 32 bits passe du int32 au
float — sans perte pour ce pipeline, la classe INT_MIN d'A4-12 meurt
pour cette profondeur ; float non clampe, le flag clip rapporte),
sha256 -> assets/store, stemKey = cle de cache d'entrees calculable
SANS rendre (uid, etat, params, samplerate, geometrie+hashes+fades
des clips, chaine amont ; version du plugin = dette datee). Lecteur :
resolveStemSubstitution DANS graph_common (le meme code pour les deux
batisseurs — la decision est exactement le genre de jumeau qui
derive) : le DERNIER vst3 non-resoluble et non-bypasse gouverne, le
stem remplace clips+amont (ClipPlayer construit SANS le fade implicite
— une rampe de plus trahirait le rendu), la chaine d'apres reste
vive. Publication AUTOMATIQUE par le moteur (meme debounce que l'etat,
cle fraiche = repos) ; badge STEM violet au panneau devices. Garde :
testStemInvariant — machine A rend la reference AVEC AGain et publie ;
machine B, SANS AUCUN mapping de module, rend le meme document OCTET
POUR OCTET IDENTIQUE, et la cle perime sur un changement de param.
Le rendu offline honore aussi l'etat capture (setPendingState avant
le spawn des bridges offline). Lecon d'outillage : rebuild_msvc.bat
avale l'echec de ninja — un enchainement `; exe` a lance le VIEUX
binaire (27 passes en trompe-l'oeil) ; verifier le log de build avant
de croire un compte de tests.

**2026-08-24 (nuit, suite — L1a : l'horloge de session mesure) :** la
premiere session du cadrage Link, livree dans la foulee du dossier.
SessionClock NTP-style sur le relais signal: existant (clk:1
broadcast, clk:2 dirige ; offset = t2 - (t1 + rtt/2), mediane des
echantillons a bas RTT, fenetre 16, pairs oublies a 30 s de silence) ;
addSignalListener multiplexe le canal (le jam garde son slot onSignal
intact) ; badge discret « clk ±N ms (P) » + sonde __dawClock. LA
LECON PAYEE PAR LA SPEC : performance.now() a une EPOQUE PAR ONGLET
(timeOrigin = chargement de page) — la premiere assertion « meme
machine donc offset nul » a mesure 580 ms, l'ecart de chargement
EXACT, estime juste par un estimateur juste. Il n'existe donc PAS de
temps de session absolu, seulement des traductions par paire — le
modele Link au sens strict, et la contrainte gravee pour les ancres
L1b. Spec reecrite sur les vrais invariants (symetrie A/B + verite
timeOrigin, justification consignee). Deuxieme lecon, sur moi : les 3
specs moteur-reel ont rougi car MON duo squattait 47821 pendant la
suite — la regle « jamais deux executions sur la meme stack » vaut
aussi pour le gardien de nuit ; port libere, 3/3 re-verts, note au
STATUS. Suite 33/33, tsc propre.

**2026-08-24 (nuit — le fantome a un nom, Link a un dossier, le jam a
ses habits) :** trois chantiers bornes pendant le sommeil. (1) LE
CRASH FANTOME INSTRUMENTE : le journal Windows a revele 3 morts
IDENTIQUES du moteur — 0xc0000409 (fail-fast) dans ucrtbase.dll, MEME
offset 0xa527e, ~2 h de vie, UNIQUEMENT en run audible (le duo --mute
n'a jamais crashe), zero trace dans nos logs car le fail-fast CRT
court-circuite stderr. Reponse : util/crash_handler (terminate +
SIGABRT + invalid-parameter + SEH -> crash-<pid>.log A COTE DE L'EXE
— les moteurs WMI ont des CWD imprevisibles —, raison + pile brute
module+offset, reentree gardee, minimum vital : open/write/flush/die),
installe en PREMIERE ligne de main(). La prochaine mort ecrira ses
derniers mots. Reserve honnete : pas de gtest dedie (hooks
process-globaux) — sa validation sera le prochain crash reel.
(2) CADRAGE LINK ECRIT (docs/LINK-DESIGN.md, la session dediee que
TODO exigeait) : personne n'est maitre (LWW, la lecon des notes
Ableton), horloge de session NTP-style sur le ping jam-ctl EXISTANT,
transport = ANCRE {position, temps de session} — fonction pure du
temps, pas un ordre « demarre maintenant » —, relais signal: existant,
etage 1 SANS attendre le tempo (vague 2) ; l'arbitrage jam-vs-sync
(flanger a 40 ms si on cumule ecoute et lecture locale) pose en
proposition grille-3. (3) JAM UX (les trois critiques promises) :
badge « jam off » PERMANENT (un etat, pas une absence), bouton JAM
enfonce = potion qui coule, et l'autoplay bloque recoit un VRAI
bouton ▶ pulsant au badge (plus un « cliquez quelque part »).
Lecon de build : rebuild complet a -j32 = C1060 (tas du compilateur
epuise, 786 cibles dont protobuf) — reprise incrementale a -j8 verte.
Moteur 29/29 avec le handler dans le binaire.

**2026-08-24 (« c'est bon les deux marchent » — LE JAM VALIDE A
L'OREILLE, la tranche differenciateur est close) :** apres la
brochette de la nuit (le tueur silencieux : chaque onglet neuf
re-assertait loop=OFF par defaut et ecrasait le keepalive — le moteur
mourait en fin de morceau et toute la chaine se taisait en aval ;
plus : moteur tour carrement mort une fois, setTap perdant la course
du socket, AudioContext du diffuseur sans flag autoplay, auditeur
abandonne sans retry, onglets ssh invisibles en session 0), la
verification pilotee a tout demonte couche par couche jusqu'au
verdict final : la tour joue duo dans ses enceintes, LE PORTABLE JOUE
LE MEME DUO recu en P2P (~40 ms), et la sonde RMS mesurait
peak 0.09 / rms 0.025 sur le flux recu a la seconde ou l'utilisateur
ecrivait que ca marche. Stems (octets) + streaming (oreille) : les
deux moities du differenciateur vivent en conditions reelles. La
methode pilotee (gravee au CLAUDE.md) a paye a chaque couche — aucun
de ces six bugs n'etait visible d'un test scripte seul.

**2026-08-24 (LE JAM TRAVERSE — deux machines, deux reseaux, 37 ms) :**
la sonde pilotee des deux cotes : tour (Ethernet/box) diffuse, portable
(hotspot telephone) ecoute — connected/connected, track distant
live/UNMUTED (les frames RTP coulent), latence ping mesuree 37 ms cote
portable / 46 ms cote tour. STUN A SUFFI : pas de TURN pour ce couple
de NAT (le risque n1 du dossier tombe pour ce foyer ; TURN reste la
dette datee pour les NAT stricts). LA TRANCHE DIFFERENCIATEUR EST
INTEGRALEMENT VIVANTE EN REEL : stems (critere 6 vert, octets +
oreilles) + streaming (P2P, latence affichee). Le chemin du debug a
paye deux lecons d'outillage durables : (1) le relay MOURAIT EN
SILENCE — un client avortant pendant le handshake du tunnel faisait
jeter handleUpgrade hors de tout catch (guards process-level + skip
sur socket detruit, commit 0549af0) ; (2) SSHD WINDOWS TUE LES
PROCESSUS DE SA SESSION a la deconnexion, Start-Process compris — le
relay renaissait et remourait a chaque session ; remede : spawn par
WMI (Invoke-CimMethod Win32_Process), survit prouve. Et la sonde qui
accusait le reseau etait deux fois coupable avant lui (send sur
CONNECTING sans attendre connected ; fermeture avant le flush).
Reste la MANIP UTILISATEUR a l'oreille : cliquer JAM sur duo cote
tour, ecouter le portable.

**2026-08-24 (S8c — l'audio DANS le tuyau : la tranche streaming est
fonctionnellement complete en local) :** le diffuseur nourrit un
AudioWorklet tap-player (FIFO bornee 50 blocs, en retard = drop du
plus VIEUX pour rester live, underruns comptes) depuis les lots
AudioTap ; sa sortie va dans un MediaStreamAudioDestinationNode dont
le stream monte dans la RTCPeerConnection (Opus et jitter = le
navigateur). L'auditeur joue le stream distant (<audio>, politique
d'autoplay geree : bloque -> « clic pour le son » au badge, un geste
relance). LA PREUVE PAR CONSTRUCTION dans la spec : en WebRTC
Chromium, track.muted ne passe a false QUE quand des frames RTP
arrivent — la garde asserte live/false chez l'auditeur avec le VRAI
moteur tape en amont. Vert du premier coup. La tranche S8 est
complete en LOCAL ; restent le test REEL deux machines (le portable
ECOUTE la tour, latence affichee a l'oreille) et TURN en dette datee.

**2026-08-24 (S8b — la traversee : deux onglets se connectent en
P2P) :** le signaling voyage en TEXTE sur le WS document (prefixe
`signal:`, relais serveur VERBATIM — il ne parse jamais la charge,
ADR-019 tenu a la lettre ; tag interne 0xFF'S' dans le canal
broadcast, impossible a confondre avec la magie automerge). JamChannel
web : UN diffuseur par projet (bouton JAM, aria-pressed), les
auditeurs demandent (JOIN = offre vide), le diffuseur repond en offre
dirigee, ICE en STUN seul (NAT strict = echec PROPRE affiche, TURN =
dette datee). DataChannel jam-ctl : ping/pong -> latence MESUREE et
AFFICHEE au badge (« jam diffuse N pair(s) X ms »). LE BUG QUI A
COUTE LA PREMIERE SPEC : les modes auto (?jam=) tirent au chargement,
AVANT l'open du socket — le JOIN partait dans le vide (sendSignal
silencieux sur CONNECTING, diagnostique par sonde ws.readyState=0).
Fix : file de signaling flushee a l'open + reassert() du JOIN a
chaque (re)connexion. Garde jam.spec : broadcast+listen connectes,
latence >= 0 affichee, bye propre vu par l'auditeur. S8c reste :
l'audio DANS le tuyau (tap -> AudioWorklet -> addTrack -> lecture).

**2026-08-24 (S8a — le robinet du jam : moteur -> onglet) :**
l'arbitrage streaming delegue (« propre et performant ») -> WebRTC
navigateur ratifie (dossier docs/STREAMING-DESIGN.md), et la premiere
tranche LIVREE : le PCM post-master quitte le thread sacre par un
TapRing lock-free SPSC (64 blocs, drop-newest cote audio — l'audio
n'attend JAMAIS ; etage d'accumulation pour les sous-blocs partiels
du wrap : zero trou dans le flux), la boucle de controle le pompe a
CHAQUE tour (pas au rythme telemetrie — la route jam veut les blocs
frais), le WS l'expedie par lots AudioTap {first_seq, blocs, drops}
aux abonnes (TapControl par client, le ring ne chauffe que si
quelqu'un ecoute). Onglet : ?tap=1 s'abonne (re-asserte par connexion
comme le loop), badge « tap Ns continu/N trous » dans la barre de
statut. Garde tap.spec : moteur reel, ~375 blocs en 2 s, sequences
CONTIGUES, zero drop, badge « continu ». Moteur 29/29. Prochain
troncon : S8b, la traversee WebRTC (signaling par le serveur).

**2026-08-24 (LE PREMIER PLUGIN MOINS GENTIL — mda, sans rien
installer) :** la suite mda du SDK vendored (30 vrais effets
multi-classes) etait a un `ninja mda-vst3` de distance. En UNE session,
le reel a paye trois fois, exactement comme la revue le predisait :
(1) LE CANAL PARAM PERDAIT LES RAFALES — par construction : un SLOT
seqlock latest-wins, une lecture par bloc ; une rafale de N params de
rebuild n'en gardait qu'UN. Invisible avec AGain (1 param), certain
avec mda. Ring v5 : le slot devient une FILE SPSC de 64 (writer
control-thread, plein = ecrase le plus ancien ; le child DRAINE tout
dans les IParameterChanges du bloc). Garde : burst de 3 params ==
les memes 3 envoyes lentement, prouve sur l'ETAT mda (240 octets).
(2) LA FILE A CASSE LA PROMESSE DU RESTART — l'ancien slot survivait
au crash PAR ACCIDENT (relu par la nouvelle vie) ; la file est
consommee. Version deliberee : cache latest-par-param cote bridge,
rejoue AVANT le spawn (la file attend dans le ring partage) — zero
fenetre seche, testChildCrashRecovery re-vert.
(3) LES TIERS NE SONT PAS BIT-REPRODUCTIBLES, MEME SPAWN-A-SPAWN :
flake capture par le diagnostic (104 echantillons divergents des le
sample 0 puis convergence totale) -> source lue : mda Overdrive
N'INITIALISE JAMAIS filt1/filt2 (bug du sample Steinberg) — heap
aleatoire, transitoire ~100 samples. La doctrine du premier jour
(cle de cache, JAMAIS de promesse bit-exacte inter-tiers) etait le
bon design ; c'est l'ASSERTION du test qui etait naive. Reecrite
honnetement : le corps est identique passe un transitoire borne, et
le pair sans plugin reproduit LE STEM exactement (la verite de
lecture), pas le transitoire aleatoire du producteur.

**2026-08-23 (SMOKE S7 DEUX MACHINES — LE CRITERE 6 EST VERT) :**
64EC2954CAAA... == 64EC2954CAAA... — le verdict seul sur sa ligne,
comme la regle l'exige. Le montage : fixe (Ethernet) avec AGain, moteur
smoke-s7 mute qui PUBLIE tout seul (etat 480376c6 v1, stem 3fd099d4
float32 6,9 Mo au store) ; rendu de reference sha256 64EC2954. Portable
TX15 (hotspot telephone, deux NAT) : canal SSH d'hier ENCORE VIVANT,
git a 7a84cb2, rebuild moteur (le vcvars du fixe n'existe pas la-bas —
bat ecrit sur place apres une guerre de quoting ssh->cmd->powershell
reglee par -EncodedCommand, la lecon d'outillage de la nuit), relais
ws vers le tunnel (un VIEUX relais d'hier squattait le port 3000 —
tue PAR PID via le port, jamais par nom), doc recu par WS (950
octets), les 5 objets par le STORE HTTP, puis LE RENDU SANS AUCUN
--vst3-module : sha256 64EC2954CAAA... IDENTIQUE. Contre-preuve sur
place : stem cache -> « Render failed: Chain incomplete », jamais un
faux vert. Et la preuve pour les oreilles : moteur portable AUDIBLE
detache (annonce), « playing STEM 3fd099d4... for an unresolved
plugin », kick a 4 s dans les haut-parleurs Senary — le portable joue
un plugin qu'il n'a pas installe. La demo de trente secondes du tout
premier pitch existe. Ce qui reste de la tranche (n'empeche pas le
vert) : streaming jam, badge fraicheur (arbitrage), vrais plugins
tiers — les quatre gentillesses d'AGain restent l'avertissement grave.

**2026-08-23 (revue externe post-S7, executee seance tenante) :** le
verdict — « la premiere fois que ton produit existe » — accompagne
d'UNE question : le test echoue-t-il quand le mecanisme est retire ?
Reponse apportee dans la meme session, par le code : (1) SANS stem
publie, la machine B REFUSE bruyamment (Chain incomplete, asserte —
un vert ici aurait annule toute la preuve) ; (2) stem CORROMPU =
refus bruyant, jamais un faux vert (asserte) ; (3) le skip silencieux
n'existe pas (la garde R5 compte chaque noeud : construit, substitue,
ou echec du rendu). La cle desaccordee JOUE — design arbitre (stem
perime = etat d'UI). Et les deux corrections d'avant-smoke : la
VERSION DU PLUGIN entre dans la cle (sha256 du binaire du module,
bundles marches tries — deux builds = deux cles, le piege
multi-machine nomme par la revue ; asserte), et default.am purge de
ses 1246 pistes de dechets (backup). Moteur 28/28 : « no-stem
refused, byte-identical, corrupted refused, key stales on param and
on build ». Prochain contact avec le reel : le smoke S7 deux machines
(premiere session portable) — chaque contact vaut dix sessions.

**2026-08-23 (refonte, tranches 3-6 — la premiere passe complete) :**
t3 zone pistes (heads en couches, selection teintee potion, faders a
gorge et curseur eclaire, vumetres a lunette, clips decolles du
couloir, halo de selection passe au potion A INTENSITE EGALE — la loi
session B « lisible a toute largeur » intacte) ; t4 devices (cartes en
couches, bypass = LAMPE ambre allumee/enfoncee eteinte) ; t5 kit +
overlays (chips en relief, arme = vert luisant, aide flottante sur
fond floute) ; t6 micro-interactions avec la regle gravee : seule la
LUMIERE transitionne — jamais la geometrie des clips (les drags
ecrivent left/width en direct et la main ne doit jamais attendre), ni
les vumetres (la balistique appartient a la couche life). Les six
tranches sont passees UNE fois ; la directive « au fur et a mesure »
les garde ouvertes aux passes suivantes.

**2026-08-24 (jour, L1b — le transport ancre) :** la suite du chantier
Link, sur l'horloge L1a de la nuit. Le principe applique tel que
cadre : le transport partage n'est PAS un evenement « PLAY ! » mais
une ANCRE {playing, posSec, t} — une fonction pure du temps de
session. Le recepteur traduit le timbre du pair avec l'offset COURANT
(jamais fige : la derive reelle de 200 ppm etait la contrainte notee)
et cale son moteur la ou l'ancre dit qu'on DOIT etre — un message qui
a traine n'introduit aucun decalage, l'erreur est bornee par la
qualite d'horloge. LWW entre ancres (la plus recente en temps local
gagne), SYNC opt-in dans la barre transport (le Start Stop Sync de
Live), et une ancre recue d'un pair dont l'horloge n'est pas encore
estimee ATTEND (deviner offset 0 = faux meme sur une machine, les
580 ms d'epoque entre onglets l'ont prouve en L1a). La garde
transport-sync.spec prouve la traduction contre la VERITE timeOrigin
avec un ecart d'epoque construit de 1,2 s — une erreur de signe y
vaudrait 2,4 s, la tolerance est 200 ms. Sonde pilote sur le banc
reel (deux moteurs locaux, ?engine=47822) : PLAY dans l'onglet du
moteur muet demarre le moteur voisin, ecart de position minimal 0 ms.
Moisson du montage de la manip : l'EAR dit ROUGE sur le projet duo
(2 discontinuites, saut 0.9) — le projet de la chasse au crash est
inapte a l'ecoute, a trier ; ma-piece est VERT et porte la manip.
Reste L1c : rejoin en cours de lecture, arbitrage jam-vs-sync.

**2026-08-24 (apres-midi, L1c + les organes sensoriels) :** trois
chantiers dans la foulee de L1b, sur directive « fais ca » et
l'arbitrage rendu (« oui, ecouter le jam suspend la lecture locale »).
L1c : le rejoin est une REQUETE (ta:2) a laquelle seuls les pairs dont
le moteur JOUE repondent, par une ancre fraiche re-ancree sur leur
position vivante — un offset stocke aurait vieilli de 200 ppm ; les
pairs arretes se taisent, le rejoin adopte une performance, il
n'arbitre pas des parkings. La suspension jam est cablee et ANNONCEE
(badge, PLAY gate, compteur suppressed). Le badge clk cesse d'afficher
l'offset brut (70 s entre onglets d'ages differents — vrai mais
illisible) pour l'incertitude rtt/2. Le moteur gagne --start-stopped
et daw.ps1 l'adopte : plus jamais 48 s de lecture non commandee au
lancement d'un banc. Et le triage du duo ROUGE a retourne le
diagnostic DEUX fois : d'abord « faux positif periodique » (faux —
mes sondes tronquaient), puis, grace au nouvel organe (l'ear dit OU
sont ses clics), le vrai coupable : un pocket de bruit de charley de
2 ms dont deux echantillons depassaient le seuil 0.5 de 0.001 — du
contenu. Regle d'echelle locale (un clic DEPASSE son voisinage de
±1,5 ms de 6x), densite comptee parmi les candidats (le premier jet
masquait un vrai clic derriere les bords du champ — le self-test l'a
attrape, il a fait son travail), self-test etendu aux deux directions.
duo est VERT, l'ear est plus precis, et la directive est gravee en
memoire : les organes sensoriels s'ameliorent sans permission.

**2026-08-24 (fin de journee, LE SMOKE L1b DEUX MACHINES — vert) :**
la journee s'acheve sur la preuve reelle : PLAY presse sur la tour,
le portable TX15 (hotspot, deux NAT, relais) demarre SUR L'ANCRE et
joue la piece entiere dans ses haut-parleurs — calage de depart
10,7 ms, soit UN buffer de 512 frames exactement, le meilleur
possible ; ecart de lecture pendant toute la piece : 5 sondes sur 6
a 16 ms ou moins. Le critere « < 50 ms » du cadrage est tenu au
chiffre et a l'oreille. La route a coute ses lecons : le tunnel ssh
est un GESTE HUMAIN (les classifieurs des deux Claude le refusent,
c'est consigne) ; le sens de la liaison s'est INVERSE en cours de
route (le laptop vient au serveur par le tunnel DAW — plus simple que
ssh) ; un onglet non recharge se detecte a son id de session
inchange ; et les sondes ephemeres strandent leurs ancres (l'ancre
attend l'estimation d'horloge de l'EMETTEUR — s'il ferme avant,
orpheline). L'organe ta:3/ta:4 (etat a distance) est ne de cet
aveuglement. LA MOISSON INATTENDUE : le crash 0xe06d7363 (exception
C++ non rattrapee, thread worker, gachette = fermeture d'un lien WS)
a frappe LES DEUX moteurs le meme jour — le handler dernier-mots a
fait son travail des deux cotes, c'est un bug DISTINCT du fantome
0xc0000409, reproductible en apparence, et le build est passe en
RelWithDebInfo pour le symboliser. Session dediee a ouvrir. Enfin,
deux directives gravees : le manuel Live est LA BIBLE produit
(jamais DSP), et VCV Rack (GPL) est la litterature d'implementation
des effets natifs a venir.

**2026-08-25 (session 1 de l'ordre grave — LE CRASH 0xe06d7363 est
mort) :** la session bornee a tenu en une seule passe, et chaque outil
paye hier a servi. Le handler a d'abord appris a parler (dbghelp au
crash, PDB du RelWithDebInfo, et le what() de l'exception extrait de
l'ExceptionRecord sous garde SEH). Le harnais de churn (60 fermetures
de clients WS : propres, brutales post-auth, brutales en plein flux de
tap) a tue le moteur jetable DU PREMIER COUP — et le log a tout dit :
« WHAT: resource deadlock would occur », broadcastTelemetry ->
sendToAll -> sendBinary vers un client mort -> ixwebsocket bascule
setReadyState(CLOSED) et rappelle la callback Close SYNCHRONEMENT SUR
LE MEME THREAD -> re-lock de connections_mutex_ -> self-lock detecte
par la STL MSVC -> throw jamais rattrape. La fermeture d'un lien
n'etait pas la gachette : c'etait L'ENVOI SUIVANT vers le parti. Fix :
copie des cibles sous verrou, ENVOI HORS VERROU (sendToAll ET pumpTap,
les shared_ptr du serveur ix tiennent l'objet pendant l'envoi) + une
ceinture try/catch a la frontiere de la callback. Contre-epreuve : le
meme harnais, 60/60, moteur vivant, zero crash-log, ceinture jamais
sollicitee. Le harnais entre au depot (scripts/crash-churn.cjs) en
attendant le gtest de la session 2. Le portable devra pull+rebuild
pour recevoir le fix.

**2026-08-25 (session 3, moitie locale — L'INVARIANT PROUVE SUR DE
VRAIS PLUGINS) :** le projet de preuve inv-proof est ne par les gestes
du produit lui-meme (un clip du kit, Valhalla et RoughRider choisis AU
PICKER du catalogue), le moteur a publie ses stems, et le quatuor a
rendu son verdict : le rendu reel est BIT-DETERMINISTE sur cette
chaine (deux passes, memes octets), le pair-sans-plugin dit « playing
STEM 926ff7a0 » et produit EXACTEMENT les memes octets que le
producteur, et le chemin bidon echoue bruyamment — jamais un faux
vert. La cle de stem reste une cle de cache : le determinisme est
MESURE, pas promis. La preuve est un script rejouable
(scripts/invariant-proof.ps1, exit 0/1). Le chemin a paye deux
moissons : l'ear ne stageait NI les stems NI les blobs d'etat (le
pair-simule ne pouvait pas jouer — attrape par le quatuor, corrige),
et une fausse piste instructive : quatre rendus identiques qui
semblaient accuser l'outil accusaient en fait le DOCUMENT (le jam de
la veille avait retire les devices de ma-piece — personne ne mentait).
Enfin, deux ecarts NOMMES avant d'agir, regle du recadrage : « OK,
continue » lu comme oui a l'arbitrage (b) de la fraicheur (a infirmer
si faux), et « harmoniser tout le code » range en AUDIT-5 au TODO
plutot qu'execute en direct. Reste de la session 3 : PDC ecrivain,
badge de fraicheur, et la jambe deux-machines.

**2026-08-25 (session 3, deuxieme lot — PDC ecrivain + le badge qui ne
ment pas) :** le ring passe v7 (l'enfant declare la latence interne du
plugin apres sa ceremonie) et le stem declare desormais LA SOMME des
latences de sa chaine — l'ecrivain rejoint le lecteur gteste. Et
l'arbitrage (b) est cable : le producteur diffuse sf:1 toutes les 2 s
sur le canal ephemere, le badge STEM a trois etats et « fraicheur
inconnue » au silence — il ne ment jamais par omission. La garde
(stem-freshness.spec, moteur reel) a paye trois moissons avant de
passer : un JUMEAU (le badge cree in-place a l'arrivee du stem n'avait
pas le procId — la fraicheur cherchait par '' et repondait inconnue a
vie), les chemins --vst3-module RELATIFS casses des que le cwd n'etait
pas build-msvc (resolus contre l'EXE desormais, mapping logue verbatim
au demarrage), et deux couches d'echappement de backslash dans mes
propres sondes (bash -> JS : \a en JS mange le backslash — slashes
avant partout dans les scripts, definitif). gtests 29/29, suite e2e
36/36. Reste la jambe deux-machines : le portable doit pull + rebuild
(fix crash + ring v7) avant toute nouvelle seance partagee.

**2026-08-25 (soir — session 4.1 ouverte : Utility + le chassis natif,
et la CI qui avait menti) :** l'ordre grave enchaine sur les effets
natifs pendant que la jambe deux-machines attend le portable. Utility
est ne dans le moule du depot : matrice 2x2 calculee HORS callback,
lissage one-pole 5 ms qui demarre SUR la cible (un graphe frais
multiplie par des constantes - l'exactitude au bit est structurelle),
pan en loi de BALANCE a centre unite (le -3 dB du constant-power est
reserve au pan de piste), fabrique native PARTAGEE par les deux
builders + le clone (regle des jumeaux appliquee trois fois, y
compris au formatteur d'unites du panneau). Preuves exactes au gtest :
-6 dB = moitie exacte, phase = negation, pan -1 = R eteint L intact,
mono = (L+R)/2, deux rendus frais = memes octets. Le panneau parle en
UNITES VRAIES (dB, L/R, mono/stereo, inv) - le 0-1 nu reste le repli
vst3. Et une lecon de sentinelle payee : le mail « run failed » de
l'utilisateur a revele que 1c61c6c etait ROUGE en CI (stem-freshness
sur Linux : chemin de fixture Windows code en dur) pendant que mes
watchs disaient vert - le `gh run list` final de mes commandes de
veille MASQUAIT le code de sortie du watch. Fixture resolue
multi-candidats (helpers.resolveAgainModule), sentinelle reparee
(une seule commande, le watch EST le verdict). gtests 30/30,
e2e 36/36.

**2026-08-25 (nuit — session 4.2 : EQ 3 bandes + compresseur, et le
bug int qui mentait a tout le monde) :** les deux musicaux natifs sont
la, dans le moule du chassis : biquads RBJ (litterature, pas manuel)
recalcules hors callback et publies en atomic<double>, etat DF2T en
double ; compresseur feed-forward (detecteur crete stereo-lie,
attaque/release one-pole, gain en dB, makeup), zero latence, unites
vraies au panneau (dB, Hz, Q, ratio, ms). Preuves du brief au gtest :
reponse mesuree a 3 frequences (+-1 dB), 4:1 verifie numeriquement sur
signal CONSTANT (l'enveloppe d'un detecteur crete ondule sous la crete
d'un sinus - le test s'est rendu exact au lieu d'affaiblir sa
tolerance), identite sous le seuil, determinisme octets. 32/32.
LA MOISSON DE LA NUIT : trois rendus au bit identique malgre un
document change ont deroule le fil jusqu'a un bug de fond - Automerge
JS stocke un nombre ENTIER comme int, jamais f64, et le parseur C++ ne
tentait qu'AMitemToF64 : echec SILENCIEUX, parametre lu 0.0. Un
makeup a 12, un seuil a -30, un low a +6 - tous muets ; un fader de
piste pose PILE sur un entier mentait pareil (masterGain et track.gain
corriges du meme coup). itemToDouble (f64 -> int -> uint) partout ou
un flottant du web entre au moteur. Contre-epreuve : meme document,
+9.02 dB de RMS - l'EQ et le comp mordent. e2e 36/36.

**2026-08-25 (nuit, suite — session 4.3 : Drive + Delay, LE NOYAU
NATIF EST COMPLET) :** les cinq effets du brief sont livres. Le delay
est exact a l'echantillon (impulsion -> echos a 4800/9600/14400,
amplitudes mix, mix*fb, mix*fb^2, EXACTES ; ligne preallouee au
prepare, jamais dans le callback). Le drive est le PREMIER NATIF A
LATENCE : oversampling 4x polyphase (FIR 65 taps Blackman calcule au
prepare, -95 dB sur le 3e harmonique), tanh au taux 4x,
getLatencySamples() = 16 - UN CALCUL - et le stem declare desormais
plugins + natifs (totalDeclaredLatencySamples). La chasse a l'alias a
enseigne sa physique : a saturation quasi-carree, l'harmonique 13
(195 kHz) replie PILE en bande passante - aucun oversampling fini n'y
peut rien (le resampler seul mesure a -280 dB l'a prouve) ; le seuil
du brief se mesure a reglage musical : alias -80 dB contre -15,5 au
naif du meme reglage, 65 dB gagnes. gtests 34/34, e2e 36/36. La CI de
4.2 est verte (sentinelle reparee, verifiee).

**2026-08-25 (cloture) :** la seance se ferme sur un depot
meconnaissable par rapport a la veille : Link vert deux machines,
l'invariant prouve sur de vrais plugins du commerce, 91 classes au
catalogue, les fenetres natives qui s'ouvrent et dont les reglages
voyagent, le noyau natif complet (5 devices, 34 gtests), deux bugs de
fond morts (le self-lock WS des deux moteurs, l'int/f64 Automerge qui
lisait 0.0), et des organes qui disent desormais OU et POURQUOI
(crash handler symbolisant, ear a positions, badge de fraicheur,
ta:3, mappings verbatim). CI verte jusqu'a 8ebe73d ; b4dc522 en vol a
la fermeture — VERDICT A LIRE EN PREMIER a la reprise. Stack coupee
proprement (tunnel compris) ; daw.ps1 rallume tout.

**2026-08-25 (jambe deux machines, vrais plugins) :** l'invariant
re-prouve DEUX MACHINES sur de vrais plugins du commerce (Valhalla
Supermassive + RoughRider3), la moitie distante de l'item 3. Tunnel
cloudflared relance cote portable (geste humain), liaison.ps1 branchee
(tx15\flow OK), doc inv-proof.am + les 5 blobs (dont le stem de chaine
complete 926ff7a0) transferes par scp, jambe SANS module lancee par ssh
(`npm run ear --project inv-proof`). Le portable TX15, sans aucun de
ces modules, rend « playing STEM 926ff7a0 for an unresolved plugin »,
EAR green, hash 179F804E... — OCTET POUR OCTET identique a la tour
(deux rendus FRAIS compares, pas un hash perime : premier piege evite,
un vieux 26AF5CAF de session anterieure trainait dans web/ear/). Un
pair sans le plugin produit la verite publiee, sur vrais plugins, deux
machines. RESERVES HONNETES a garder : (1) rendu OFFLINE via ear, pas
le chemin reseau vivant WS+store HTTP (celui-la deja prouve en S7 avec
AGain) ; (2) blobs poses par scp, pas tires du store HTTP par le moteur
du portable ; (3) le stem 926ff7a0 fut produit par la tour en session
ANTERIEURE — le portable le LIT, donc c'est l'invariant de LECTURE qui
est vert deux machines sur vrais plugins, pas la regeneration ; (4)
badges fraicheur « de la-bas » en live non observes (demandent stack
live + l'oreille de l'utilisateur devant le portable — pas de son de ma
propre initiative). Friction utilisateur : sshd etait en Manual ->
passe Automatic via UAC (a noter dans deux-machines.md). Vivants cote
portable a la fin : sshd Running, cloudflared PID 2444 detache.

**2026-08-25 (refonte UI T1-T8 + finition F1-F7 — l'interface finie) :**
grosse seance UI, deux temps. (1) REFONTE TOTALE demandee (« rework l'UI
totalement... un max d'options ») : concept « l'etabli Magic Potion »
(atelier modulaire, graphite chaud + potion + cuivre materiel), livre en
8 commits T1-T8 (command bar, rail navigateur, VU inter-device, vue
Session clip-launcher, console Mixage, commutateur de paradigmes
Arrangement/Session/Mixage — presentation LOCALE par onglet). Contrat
d'id tenu (le JS lit les slots par id, jamais par position -> re-parenter
ne casse rien). (2) FINITION F1-F7 (chantier « finir l'interface », plan
approuve), chaque tranche verifiee EN PILOTANT le vrai navigateur/moteur :
- F3 : bug du VU master de la console (le moteur emet les pics master a
  part de getMeters) + LED cuivre. F4 : knobs rotatifs du rack (le
  `<input range>` reste la source de verite, masque, pilote par le knob).
  F6 : onglet Samples du navigateur = source UNIQUE (barre KIT retiree).
  F7 : splitters de colonnes redimensionnables (largeurs en localStorage),
  undo des notes (dette midi_schedule soldee), reduced-motion/focus.
- F1 : bouton BOX (fenetre GUI de plugin A LA DEMANDE) — le trou etait
  100% moteur. Ring v9 : champ atomic editor_open (moteur->enfant) loge
  dans le padding de shutdown -> offsets INCHANGES, un static_assert.
  L'enfant ouvre/ferme sur la TRANSITION. Verifie sur Dexed (close+reopen
  -> 2e « editor window open », patch restaure). REGLE ENFIN le cas
  Massive X (« je peux pas lancer un massive X ») : ouvrir la GUI, choisir
  un preset.
- F2 : pan de piste. Applique POST-CHAIN (un instrument ignore son entree
  -> paner avant sa chaine ne ferait rien). LOI LINEAIRE centre-neutre
  (pas puissance egale) : impose par la neutralite du centre (pan 0 ==
  inchange -> hash offline + loudness des projets existants preserves) et
  pour eviter la discontinuite -3 dB en frolant le centre. Verifie au
  rendu offline (pan -1 -> L=0.32/R=0).
- F5 : LAUNCH LIVE des slots Session — ESCALADE ARCHITECTURE reconnue
  (le plan la sous-estimait) : le callback ne traitait l'audio que
  transport EN LECTURE. Choix utilisateur = « la solution la plus
  elegante et performante » -> HORLOGE DE SESSION LIBRE : le callback
  avance un compteur a chaque bloc meme a l'arret et traite le graphe si
  un slot est lance ; la position d'arrangement reste GELEE (pas de seek
  hors lecture). Un vrai clip-launcher : on jam PAR-DESSUS un arrangement
  arrete. Scheduler emitSessionLoop (rebase + wrap + all-notes-off a la
  couture, ordre d'offset croissant car l'enfant draine le FIFO sans
  trier) TESTE UNITAIREMENT (nouveau gtest). Verifie bout en bout sur
  Dexed, transport A L'ARRET : le slot lance sonne (peak 0.125), stop ->
  silence exact (0 note bloquee). 41/41 gtests.
Piege paye (mon TEST, pas le code) : les mutateurs de project.ts ne
synchronisent pas seuls — l'UI appelle sendLastChange APRES ; mon script
appelait addSessionClip/toggleNote sans flush -> le moteur ne recevait
rien (buildGraph session_slots=0). Diagnostic par logs [F5] control-thread
(retires apres). Hook __dawFlush ajoute (doctrine window.__daw*).
Demande utilisateur en fin de seance : lanceurs double-cliquables
start-daw.cmd / stop-daw.cmd (delegue a daw.ps1 -Secure, ouvre le site).
SIGNALEMENT (niveau 2, pas mon code) : le doc `studio` se REINITIALISE
par moments (mes ajouts web disparaissaient entre deux runs de test) —
sent une persistance serveur fragile, a regarder en session dediee.
Tout committe (2ffdacc..19d8ac0). Stack coupee proprement.

**2026-08-26 (session away « pendant que je joue » : non-bug persistance,
menu principal) :** chantier autonome pendant que l'utilisateur joue a LoL,
avec sa consigne « teste aussi sur le portable » et « fais un menu principal
avec selection des projets ».
- FAUX BUG PERSISTANCE ELUCIDE : le « reset de studio » (le web montrait 2
  pistes = le seed au lieu des 6 de studio) que j'avais signale hier n'etait
  PAS un defaut produit. Cause : mes scripts de test ecrivaient `.etok.tmp`
  DANS `web/` (surveille par vite) -> le FSWatcher de vite crashait en EBUSY
  en boucle -> le web restait en sync a moitie (seed transitoire). Preuve :
  avec vite stable, le web charge bien les 6 pistes de studio. La persistance
  est SOLIDE (verifie : projet frais, addTrack+flush -> ecrit atomiquement sur
  le disque -> survit au reload ; FileStore fait load->apply_incremental->
  write_atomic + garde deps manquantes). studio.am EST foreign-rooted (racine
  fa64dc, pre-graine, 395 changes, vs seed 1fd680 actor da5eed00) mais le web
  l'adopte quand meme. LECON GRAVEE (CLAUDE.md/TODO) : aucun fichier temp de
  test dans `web/` -> scratchpad uniquement.
- MENU PRINCIPAL (f60bf11) : ecran de selection de projets a une URL STABLE
  (racine, sans ?project=) pour « ouvrir la meme URL a chaque fois ».
  Middleware vite /api/projects (liste server/projects/*.am par recence,
  dev-local), ui/menu.ts (esthetique etabli, ouvrir = naviguer ?project=<id>
  en PRESERVANT le fragment #stoken/#token, masque les artefacts e2e
  timestampes), main.ts branche menu vs app selon ?project=, daw.ps1 ouvre
  l'URL stable. Verifie (liste, ouvrir studio -> 6 pistes fragment preserve,
  creer un projet -> navigation, 0 erreur). Store local decrasse : 954 -> 18
  projets (backup conserve ; 934 artefacts e2e timestampes ; server/projects
  gitignore).
- PORTABLE : joignable (TX15/flow, vieux tunnel cloudflare encore vivant)
  mais a origin/master (60ab807) = 24 commits DERRIERE la tour (sans T1-T8 ni
  F1-F7 ni menu). Le tester exige un push (-> CI non validee post-rework) +
  rebuild distant -> j'ai d'abord lance la suite e2e locale comme garde-fou
  du rework avant tout push (verdict a consigner).

**2026-08-26 (suite : filet e2e du rework, VRAI BUG trouve, push, portable) :**
- FILET DE REGRESSION du rework UI : 9 nouvelles specs Playwright (ui-rework
  paradigmes/splitters, ui-mixer fader/pan, ui-rack knobs/editeur, ui-session
  launch, ui-menu). Ces ~10 commits d'UI n'avaient AUCUNE spec permanente.
- LE FILET A PAYE IMMEDIATEMENT : la spec ui-rack a trouve un VRAI BUG PRODUIT
  - le bouton BOX (ouvrir la GUI d'un plugin) n'appelait plus setEditor.
  Depuis la refonte T5, #device-view-slot vit dans une COLONNE SEPAREE, plus
  un enfant de #tracks -> l'event 'editor-toggle' ne remontait plus au
  listener sur els.tracks. Fix : ecouter sur `document`. (Ma verif F1 le
  ratait car elle appelait setEditor DIRECT, pas le bouton.)
- FAUX PROBLEMES DIAGNOSTIQUES (pas des regressions) : (a) les specs de sync
  echouaient d'abord sur l'auth de mon serveur -Secure -> re-run non-secure ;
  (b) 3 specs faisaient goto('/') attendant l'app sur 'default' -> le MENU a
  change la semantique de `/` -> les specs nomment leur projet ; (c) le rework
  a ajoute data-track-id aux VU du mixer -> le helper getTrackIds comptait les
  pistes en double -> scope a #tracks ; (d) clip-selection : la poignee de
  bord d'un clip minuscule fait 2px, un clic-pixel la rate (flake historique,
  logique de gesture/render INCHANGEE) -> dispatch des events pointer direct.
- PUSH : les regressions du rework soldees, suite locale 43/45 (2 restants =
  env local sync-resilience spawn serveur + le flake clip-selection, fixe
  apres). Pousse sur origin/master (26 commits, 60ab807..eed3e9a puis
  clip-selection 60f2c35).
- CI : build-linux VERT (mes changements C++ compilent sur GCC/Linux). Premier
  test-e2e rouge sur clip-selection (le flake 2px) -> fixe + repousse.
- PORTABLE VALIDE : pull (HEAD eed3e9a), moteur REBUILD (ring v9+pan+session
  compilent+lient sur son MSVC), gtests 41/41 (dont F5 session loop). Friction
  notee : PowerShell du portable a l'execution de scripts DESACTIVEE -> passer
  par cmd (npm.cmd) et pas les shims .ps1.

## 2026-08-26 — Les 4 dans l'ordre : rename, Session F5+, deux designs

Arbitrage utilisateur a la reprise : « les 4 dans l'ordre » (polish UI ->
Session F5+ -> automation design -> P2P design).

- RESTES DE VEILLE au sol : le tree portait des modifs non commitees
  (trim du token serveur + test, var(--mono) x2) que REPRISE annoncait
  poussees. Verifiees (cargo test 9/9), commitees separement.
- RENOMMAGE : ClipDef.name additif ; renameTrack/renameClip/renameScene
  undo-journalises ; clic droit -> Renommer = input INLINE (module
  inline_rename, data-role suspendu pendant l'edition pour ne pas voler la
  poignee de drag) ; clipDisplayName = source unique (3 jumeaux remplaces,
  un clip MIDI affiche « MIDI », plus d'id brut). Fix dans le rayon :
  Ctrl+D dupliquait 5 champs -> notes/fades/name perdus, copie integrale.
- SESSION F5+ : semantique STOP reparee (stop d'une scene tuait les slots
  des AUTRES scenes -> stop filtre par scene ; scene vide = stop
  inconditionnel, les deux vides = STOP ALL). Launch QUANTISE : l'ancre
  (1er slot quand rien ne joue) part immediatement et pose epoque+quantum
  (son loop_len) ; les suivants sont mis EN FILE (queued_slot/queued_start)
  et PROMUS par le thread audio a la frontiere, demarrage au sample exact
  (emission decalee offset+skip). SessionState (proto additif, les 2
  etages) dans la telemetrie 30 Hz : l'UI affiche la VERITE moteur
  (reconciliation de l'etat optimiste, badge queued pointille). Gestion
  scenes : renommer/dupliquer (slots+notes, un geste d'undo)/supprimer
  (avec slots, restauration A SA PLACE). gtest testSessionQuantizedLaunch
  (42/42) + spec ui-session-plus + pilotage moteur reel --mute (ancre ->
  queued -> promotion -> stop all, traces/f5plus-*.png).
- MOISSON DU PILOTAGE (le bug le plus important du jour) : les slots crees
  par le pilote n'atteignaient JAMAIS le serveur. Cause : getLastChange
  SCALAIRE - deux mutations avant un envoi = la premiere perdue pour les
  pairs (le doc local, lui, les avait : bug silencieux). Fix racine :
  FILE pendingChanges, sendLastChange draine tout. starter.ts contournait
  deja (« getLastChange is scalar ») - la classe est fermee.
- FLAKE ATTRAPE : Echap du menu contextuel perdu si presse avant le
  setTimeout(0) d'attache des listeners -> keydown/resize/blur attaches
  IMMEDIATEMENT, seul le clic exterieur reste differe. 4/4 repeats verts.
- MODIF DE TEST SIGNALEE : sync-resilience comptait les pistes via
  [data-track-id] nu - depuis T8 la console Mixage porte cet attribut sur
  VU/pins (10 elements pour 3 pistes). Selecteur precise en
  .track[data-track-id], intention et comptes inchanges. (Latent, pas vu
  en CI : le spec s'y skippe sans binaire serveur debug.)
- DESIGNS A ARBITRER (rien construit) : docs/AUTOMATION-DESIGN.md
  (enveloppes : schema additif normalise 0..1, evaluation pure f(t) =
  hash preserve, cle de stem etendue, decoupage A1-A5) et
  docs/P2P-ENGINES-DESIGN.md (cible : serveur = signaling seul ; briques
  S8/L1/store deja la ; recommandation E4 MIDI laptop->tour d'abord,
  2-3 sessions, puis E1 doc sur DataChannel).

## 2026-08-26 (soir) — BOX devant, rack en bas, premiers chantiers paralleles

Suite directe de la journee, pilotee par 4 retours utilisateur en rafale.

- BOX (2 allers-retours) : « n ouvre pas le plugin » -> diagnostic pilote,
  les fenetres s ouvraient DERRIERE Chrome et --editors (daw.ps1) ouvrait
  tout au spawn en desaccord avec le bouton. Fixes : etat hors DOM +
  reset a la deconnexion moteur, croix (X) ecrit 0 dans le ring
  (reouverture 1er clic), --editors retire, bouton visible « BOX ».
  Puis « doivent s ouvrir devant chrome » : l aller-retour
  TOPMOST->NOTOPMOST ne garantissait rien depuis un process d arriere-plan
  -> TOPMOST permanent tant qu ouverte (modele Ableton), verifie
  WS_EX_TOPMOST pose. Choix v1 note (devant TOUT, a revisiter).
- URL STABLE donnee et ouverte (bookmark) ; onglet perime = cause du
  2e « n ouvre pas » (fixes deja en place, F5 suffisait).
- RACK EN BAS (« mieux en bas a la ableton », plan approuve) : le panneau
  device quitte la colonne droite pour un panneau bas pleine largeur,
  frere de .workspace (topbar/workspace/splitter horizontal/panel-device).
  La chaine de devices etait deja horizontale - le gros du chantier etait
  la genealogie du layout (exploration dediee), splitters generalises aux
  2 axes (meme cle localStorage etendue), rack_tabs re-hote. Piano-roll
  pleine largeur = gain net. Modif ui-rework.spec SIGNALEE (geometrie).
- PREMIERS CHANTIERS PAR AGENTS PARALLELES (« tu peux lancer plusieurs
  chantiers en parallele ») : partition STRICTE des fichiers, agents
  interdits de stack/commit, integration+verification en serie par moi.
  D3 drag&drop navigateur->pistes (payload MIME custom + type marqueur
  sample, coexistence avec le drop de fichiers, un groupe d undo par drag,
  chips Library decorees par contrat sans toucher le module) et
  A1 automation couche document (schema additif piste+master, 6 mutateurs
  au moule, move de point sans traversee = reecriture EN PLACE pour
  garder l identite Automerge, automationValueAt pur = futur contrat
  d exactitude du moteur). Les DEUX livres tsc 0 du premier coup, leurs
  specs 10/10, suite complete 53/53.
- Verdicts CI du jour : 3eea6be, 4f059ec, 7126c65 VERTS ; 169850d (les
  3 chantiers) en sentinelle a la cloture.

## 2026-08-26 (nuit) — D1 + D2 + A2 : la vague parallele continue

« ok continue les chantiers et montre moi le resultat et teste ce que tu
fais avec playwright au maximum ». Deux agents (D1 pistes, D2 devices,
sequences sur les fichiers partages) + A2 moteur par moi, en parallele.

- D1 REORDONNER LES PISTES (agent) : TrackDef.order additif fractionnaire
  (la liste Automerge garde l ordre de creation, l identite survit - LE
  point CRDT du design), orderedTracks source unique (render, session,
  mixer + minimap), drag de la tete au seuil 5 px (clic simple intact),
  reequilibrage sous 1e-9, undo complet. dnd-tracks.spec 4/4 dont
  convergence 2 onglets.
- D2 REORDONNER LES DEVICES (agent) : moveProcessor (remove+insert meme
  def, compromis CRDT assume et documente), drag horizontal dans le rack,
  ligne d insertion verticale. MOISSONS D INTEGRATION : (1) le drag etait
  muet - ctx.selectedTrackId nul quand le rack affiche la 1re piste en
  fallback -> la piste se retrouve PAR le device dans le doc ; (2) flake
  de spec : le rack scrolle, le panneau 0 pouvait etre HORS viewport
  (x=-95) -> scrollIntoViewIfNeeded avant boundingBox. 4/4.
- A2 MOTEUR AUTOMATION (moi) : evaluateur pur miroir du TS (double
  arithmetic), lecture/ecriture automerge-c des lanes, evaluation par
  sous-bloc gain/pan/master (lane enabled > manuel), gtests 44/44 avec
  PREUVES au bit (lane plate == statique, deterministe, disabled ==
  manuel, roundtrip). E2E MOTEUR REEL automation-engine.spec : la lane
  ecrite par la page pilote le NIVEAU mesure aux VU - Playwright au
  maximum comme demande.
- LE CRASH DU SOIR (0xC0000005, moteur live mort en ~5 s, gtests verts) :
  PAS un bug de code - ABI PERIMEE du build incremental apres changement
  de LAYOUT de structs partagees (AudioTrack/AudioGraph). ninja clean +
  rebuild complet = vivant. LECON GRAVEE dans REPRISE : layout change =>
  clean build obligatoire. Au passage : ne pas oublier create_test_doc
  (cible hors build par defaut, emportee par le clean).
- Lecons e2e moteur-spawne : purger le token file d un run precedent
  (la page pechait un token perime -> 4001, retry unique rate) ;
  attendre « WebSocket server listening » avant d ouvrir la page (le
  client web ne re-essaie pas un ERR_CONNECTION_REFUSED initial - dette
  produit signalee).
- Suite e2e complete 62/62 ; tsc 0 ; cargo 9/9.

## 2026-08-27 — Audio repare + preuve par etage + fin des chantiers entames

- AUDIO « pas comme il faut » (retour utilisateur) : traque par MESURE
  (ear), cause = 4 faders a gain=0 dans le document (Track 2/snare/bass/
  chord muettes) + mix cretant a -0.76 dBFS une fois remontes -> gains a
  0 dB, master a -2 dB, porte ear VERTE (-2.56 dBFS). En chemin : garde
  B5 muette sur les hash vides (clips MIDI legitimes).
- PREUVE PAR ETAGE (idee utilisateur, construite dans la foulee) :
  peak/rms/hash FNV-1a du flux float ENTRE chaque maillon (clips -> gain
  -> chaque plugin -> pan -> master), offline only (probe nul en live),
  --probe au render + table ear --probe. gtest 45/45 (deterministe,
  -6.02 dB exact au gain, pan neutre). La table de studio se lit comme
  un recit (Dexed genere du silence, Krush +8 dB de crete...).
- GESTES vague 1 valides/pousses (rack-cible, clic droit navigateur,
  dblclick=fenetre) + CASSE trouvee : le menu + device etait tronque par
  le panneau bas et scrollait le rack hors champ -> menu en fixed.
- A3 ENVELOPPES (moi) : bouton A, lane sous la piste (rangee SOEUR de
  .track - dans la .track flex elle partait hors ecran), courbe SVG
  clampee, dblclick/drag/clic droit, ON/off. Le moteur A2 joue ce qu on
  dessine. automation-ui.spec 2/2.
- D4 CLIPS ENTRE PISTES + SLOTS (agent) : moveClipToTrack (delete+
  recreate meme id, compromis assume), drag bi-dimensionnel (X historique
  intact, Y vise par geometrie), slots deplacables entre cellules.
  Lecons de spec : desarmer le kit (clip fantome au mouse.up), viser le
  CENTRE d une poignee de 10 px. dnd-clips 3/3.
- Ceinture engine_client : scheduleReconnect aussi sur l echec initial.
- SUITE COMPLETE 70/70 ; moteur 45/45 ; tsc 0. LES CHANTIERS ENTAMES
  SONT SOLDES (DND D1-D4 complet, automation A1-A3 ; restent A4/A5
  minces). Prochain arbitrage : LE gros chantier.

**2026-08-27 (AUDIT-6, session d'audit dediee, lecture seule) :**
demande utilisateur : comparer le code a ce qui se fait en DAW
(Ableton/Cubase), dire ce qui manque ou est mal pense. Methode AUDIT-5
reprise : 3 lectures paralleles exhaustives (UI web ~11,6k L, moteur
13,8k L / 62 fichiers, schema+serveur+ADRs), croisees avec
ABLETON-INTEGRALE / SCHEMA-V2 / LINK-DESIGN. Rapport : docs/AUDIT-6.md,
~35 constats etiquetes [DESIGNE]/[REFUSE]/[SOUS-PESE]/[NOUVEAU].
Titre : moteur de LECTURE collaboratif, pas encore un DAW — rien
n'entre (aucun record, aucun MIDI-in a aucun etage), rien ne sort
(aucun export UI), temps musical inexistant. Constat d'honnetete :
presque tout l'ecart etait deja nomme/designe dans nos propres docs ;
les [NOUVEAU] utiles touchent les prerequis des candidats gros-chantier
(E4 : pas d'entree MIDI ni CC64/pedale ; Vague 3 : notes en LISTE
contre le design map-a-ids ; latence figee 512 sans ASIO ; master sans
chaine ; chevauchement de clips = somme ; compresseur sans GR meter ;
velocite ineditable au piano-roll ; /api/projects = middleware Vite,
pas le serveur ; aucune sauvegarde de secours des .am). Zero ligne de
code modifiee ; arbitrage propose a ratifier ; roadmap parite toujours
GELEE. Verdict CI du push docs : a verifier a la reprise.
