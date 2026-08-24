# TODO

## ORDRE GRAVE (recadrage utilisateur 2026-08-25 — ne bouge pas sans lui ;
## une demande hors ordre se NOMME avant d'etre executee, regle CLAUDE.md)

1. [x] CRASH 0xe06d7363 — SOLDE 2026-08-25 EN UNE SESSION : repro au
   premier harnais (churn de fermetures WS, scripts/crash-churn.cjs),
   log auto-symbolise (handler + dbghelp + WHAT extrait) = cause en
   une lecture : sendToAll/pumpTap envoyaient SOUS connections_mutex_,
   l'echec d'envoi vers un client parti declenche la callback Close
   synchrone sur le meme thread -> re-lock -> system_error(resource
   deadlock would occur) non rattrape. Fix : copie sous verrou, envoi
   HORS verrou (shared_ptr ix tenus) + ceinture try/catch a la
   frontiere. Contre-epreuve 60/60, moteur vivant, ceinture jamais
   sollicitee. RESTE : gtest dedie quand la cible relinke (session 2) ;
   le PORTABLE doit pull+rebuild pour recevoir le fix.
2. [x] daw_engine_test RELINKE EN LOCAL — SOLDE 2026-08-25 : cause =
   mode bundle du SDK (dossier <name>.vst3 cree la ou le linker ecrit
   le fichier -> LNK1104 permanent des que la config change) ;
   SMTG_CREATE_BUNDLE_FOR_WINDOWS=OFF EPINGLE dans
   engine/cmake/vst3sdk.cmake (portable/CI/checkout frais compris),
   fixtures en fichiers plats VST3\again.vst3, references reconciliees
   (daw.ps1, ear.mjs, docs ; gtests deja config-agnostiques via
   $<TARGET_FILE> + bundleRootOf). GTESTS 29/29 EN LOCAL retablis.
   Menage cosmetique restant : dossiers *.stale / *.bundle-old /
   Release historiques dans build-msvc (suppression bloquee par le
   classifieur ; inertes).
3. [~] L'INVARIANT RE-PROUVE SUR UN VRAI PLUGIN — MOITIE LOCALE FAITE
   2026-08-25 : projet de preuve dedie inv-proof (clip kit + Valhalla
   + RoughRider poses PAR LE PICKER du catalogue), stems publies par
   le moteur (6e30b424 nœud Valhalla, 926ff7a0 = chaine complete),
   QUATUOR codifie scripts/invariant-proof.ps1 (exit 0/1) : rendu
   reel x2 BIT-DETERMINISTE (26AF5CAF...), pair-sans-plugin joue
   « playing STEM 926ff7a0 » et produit LES MEMES OCTETS, chemin
   bidon = echec bruyant (jamais un faux vert). La cle reste une CLE
   DE CACHE (le determinisme est MESURE ici, pas promis). Moisson :
   l'ear ne stageait pas les blobs stems/etat (corrige — le
   pair-simule ne pouvait pas jouer) ; ear --verbose + lignes de
   verite de chemin rejouees.
   PDC ECRIVAIN FAIT (meme jour) : ring v7 (plugin_latency_samples,
   ecrit par l'enfant apres sa ceremonie = IAudioProcessor::
   getLatencySamples, logue sur stderr), bridge.pluginLatencySamples(),
   le stem declare LA SOMME des latences internes de sa chaine
   (renderer.totalPluginLatencySamples) — le lecteur gteste avance
   d'autant. AGain/Valhalla/RoughRider declarent 0 (verifie) ; sonde
   soothe2 non concluante (init/licence pend — a re-tenter avec un
   lookahead franc).
   BADGE FRAICHEUR (b) FAIT (meme jour) : le producteur diffuse sf:1
   toutes les 2 s sur le canal ephemere (ServerClient::sendSignal
   moteur — texte, jamais le document) pour chaque noeud qu'il
   resout ; badge STEM a 3 etats (frais / perime ambre / « fraicheur
   inconnue » gris a 7 s sans signal — il ne ment jamais par
   omission). Garde stem-freshness.spec (moteur reel) : frais ->
   entree changee -> NOUVEAU stem frais -> moteur tue -> inconnue
   < 12 s. Moissons de la garde : JUMEAU attrape (le badge cree
   in-place a l'arrivee du stem n'avait pas le procId), chemins
   --vst3-module RELATIFS resolus contre l'EXE (plus jamais le cwd),
   mapping logue verbatim au demarrage (organe).
   RESTE (3 suite) : DEUX MACHINES (portable : pull + rebuild [fix
   crash + ring v7 !] puis scripts/invariant-proof.ps1 jambe SANS
   chez lui + badges fraicheur observes de la-bas). Piege : mon
   interpretation « OK » = oui a (b) — a infirmer si faux.
4. EFFETS NATIFS (3 sessions arbitrees, VCV Rack litterature).
5. VAGUE 3 (MIDI + instruments -> le test ultime Massive).
6. AUDIT-5 « HARMONISATION » (souhait utilisateur 2026-08-25
   « il faut harmoniser tout le code je pense », NOMME hors ordre et
   range ici) : session d'audit dediee, regard neuf, LECTURE SEULE ->
   rapport -> arbitrage par la grille (jamais une passe de coherence
   en direct). Candidats connus d'avance : conventions fr/en des
   commentaires, jumeaux de sondes scratchpad vs scripts/, menage
   build-msvc (dossiers stale), table KNOWN_VST3_NAMES vs catalogue.

## LE PROGRAMME (arbitrage utilisateur 2026-08-23, plan approuve —
## AMENDE le gel d'ADR-019 : l'entrelacement est ratifie)

Ordre grave : VAGUE 1 (habitabilite, 6 sessions : V1.1 boucle+arret,
V1.2 master, V1.3 undo/redo, V1.4 session C visible, V1.5 session D
devices+eviction A4-5, V1.6 fades) -> ENTRELACS DIFFERENCIATEUR
(critere-3-vrai A4-1/2/3, placement+clips-MIDI co-designes, 2.5-etat,
STEMS S7, streaming) -> SYNC TRANSPORT INTER-MACHINES [AJOUT
2026-08-24, constat utilisateur « les deux sites sont pas
synchronises » : chaque moteur a SON transport, le doc converge mais
la POSITION non — la reponse produit = ABLETON LINK (notes
docs/ABLETON-*). CADRAGE FAIT 2026-08-24 : docs/LINK-DESIGN.md —
personne n'est maitre, horloge de session NTP-style sur jam-ctl,
transport = ANCRE {pos, temps de session} LWW via relais signal:,
3 sessions L1a horloge / L1b ancres / L1c polissage ; la grille au
quantum attend la vague 2 tempo ; arbitrage jam-vs-sync propose
(ecoute jam = lecture locale suspendue, grille 3 a trancher).
L1a FAIT 2026-08-24 (nuit) : SessionClock NTP-style sur le relais
signal: (clk:1 broadcast / clk:2 dirige, mediane des echantillons a
bas RTT, fenetre 16, peers oublies a 30 s), addSignalListener
multiplexe (le jam garde onSignal), badge « clk ±N ms (P) » +
__dawClock.snapshot(). Garde clock.spec : symetrie A/B + VERITE
timeOrigin (lecon : performance.now() a une EPOQUE PAR ONGLET — il
n'existe pas de temps de session absolu, seulement des traductions
par paire, le modele Link exact ; la premiere assertion « meme
machine = offset 0 » etait fausse, 580 ms d'ecart de chargement
mesures par l'estimateur juste). PROUVE DEUX MACHINES la meme nuit
(sondes croisees tour/portable, hotspot+tunnel) : symetrie A/B a
5-9 ms pres sur des chemins a RTT 60-90 ms, estimation stable ±3 ms
entre lectures ; DERIVE REELLE mesuree ~200 ppm entre les deux
machines (~12 ms/min) — la fenetre glissante de 16 x 2 s la suit
naturellement, contrainte notee pour les ancres L1b (toujours
traduire avec l'offset COURANT, jamais un offset fige) ; relais
oblige, le RTT portable<->portable double (2 traversees de tunnel),
topologie attendue.
L1b FAIT 2026-08-24 (jour) : TRANSPORT ANCRE — bouton SYNC opt-in
(etat de performance, ?sync=1 pour le pilotage), ancre
{playing, posSec, t} LWW sur le relais signal: (ta:1), reception =
traduction avec l'offset COURANT de L1a (jamais fige, regle derive)
puis seek+play du moteur LOCAL a « la ou l'ancre dit qu'on DOIT
etre » (posSec + ecoule — un message en retard ne decale rien) ;
ancre en attente tant que l'estimation d'horloge du pair n'existe
pas (retry borne, jamais d'offset devine — 580 ms d'epoque entre
onglets). Emission aux gestes play/stop uniquement (pas de
re-broadcast : le rejoin tardif = L1c). Bouton SYNC flashe quand une
ancre distante pilote le transport (regle « chaque effet annonce »).
?engine=<port> pointe un onglet sur un autre moteur local (deux
moteurs, deux onglets, une machine = la manip sync sans 2e
ordinateur). Garde transport-sync.spec (moteur reel : opt-in
respecte — recu-mais-ignore compte —, PLAY/STOP voyagent, VERITE de
traduction contre timeOrigin avec ecart d'epoque construit > 1 s).
Sonde pilote sur l'environnement reel deux-moteurs : ecart de
position minimal 0 ms (telemetrie 30 Hz), verdict < 50 ms VERT.
L1c FAIT 2026-08-24 (meme jour, arbitrage utilisateur « oui, ecouter
le jam suspend la lecture locale ») : REJOIN — armer SYNC diffuse une
requete ta:2, chaque pair arme dont le moteur JOUE repond par une
ancre FRAICHE dirigee re-ancree sur sa position moteur vivante
(jamais un offset stocke vieilli par la derive) ; les pairs arretes
se taisent (le rejoin adopte une performance en cours, il n'arbitre
pas les parkings). SUSPENSION JAM (LINK-DESIGN 4 tranche) : entrer
en ecoute = moteur stoppe une fois, PLAY gate + annonce au badge
(« lecture locale suspendue »), ancres recues comptees (suppressed)
jamais appliquees, jamais de reponse au rejoin (transport non
authoritatif) ; reprise = geste manuel. Badge clk : affiche
l'INCERTITUDE (borne NTP rtt/2), plus l'offset brut qui melangeait
les epoques par onglet (70 s affiches = correct mais alarmant,
critique soldee). Moteur : --start-stopped (device up, transport
gare jusqu'a une commande PLAY — l'entorse « 48 s au lancement »
soldee, daw.ps1 l'utilise). EAR : le rouge duo etait un FAUX POSITIF
de l'analyseur (bruit d'attaque de charley : pocket HF 2 ms avec 2
echantillons a 0.501 juste au-dessus du seuil) — regle d'echelle
locale ajoutee (clic ssi saut > 6x la mediane |dx| sur ±1,5 ms),
la branche periodique applique la densite AUX CANDIDATS, et l'ear
dit desormais OU sont ses clics (discontinuity_positions_s + raison
du verdict) ; self-test etendu (test 7, DEUX directions : rafale
dense verte, spike isole rouge avec position). duo VERT, ma-piece
VERT, self-test 7/7. Garde e2e : transport-sync.spec test 2 (rejoin
sans nouveau geste + suspension observee). TEST REEL DEUX MACHINES TENU 2026-08-24 (tour + portable TX15,
hotspot 172.27.107.x + tunnel, relais) : le portable a demarre SUR
L'ANCRE de la tour et joue la piece ENTIERE dans ses haut-parleurs —
calage de depart 10,7 ms = UN buffer (512 fr) pile ; ecart de
lecture mesure par sondes rejoin pendant toute la piece : 5 lectures
sur 6 <= 16 ms (outlier 91 ms = bruit de mesure, reponses etalees
par le reseau + telemetrie 33 ms). CRITERE < 50 ms : VERT, au
chiffre et a l'oreille. MOISSON DU SMOKE : (1) CRASH 0xe06d7363
(exception C++ non rattrapee, thread worker, gachette apparente =
fermeture d'un lien WS) sur LES DEUX machines le meme jour —
distinct du fantome 0xc0000409 ; le handler dernier-mots marche
(crash-*.log les 2 cotes) ; build passe en RelWithDebInfo pour
symboliser ; SESSION DEDIEE A OUVRIR (repro : fermer le lien
serveur/WS ; symboliser crash-10156.log tour). (2) Le rejoin ta:2 de
la sonde tardive du portable n'a pas repondu en manche 1 — a creuser
avec la session crash. (3) Frictions consignees deux-machines.md
3bis (vcvars, ws-relay chemin, playwright channel chrome).
RESTE Link : etage 2 grille au quantum (attend vague 2 tempo)] ->
VAGUE 2 TEMPO (cadrage puis migration) ->
VAGUE 3 MIDI+instruments (Surge XT) -> VAGUE 4 studio (automation,
sends/groupes, enregistrement+comping, warp APRES recherche de
determinisme). Hors programme : Session View, macros, M4L, alea sans
seed, VST2, mobile. Details : plan approuve du 2026-08-23 (designs
challenges : wrap sample-accurate par sous-bloc, master dans
AudioGraph::process, undo par descripteurs types + groupes).

## REFONTE PROGRESSIVE DU SITE (directive utilisateur 2026-08-23 :
## « le site devrait etre refait completement au fur et a mesure »)

En PARALLELE du programme : chaque session livre une tranche VISIBLE
de refonte UI, directement observable dans l'onglet ouvert (HMR).
Regles inchangees (boucle snap/grille, invariants Playwright verrouilles
avant refonte, trace visuelle par tranche). Ordre des tranches :
1. [x] FONDATION VISUELLE — FAIT 2026-08-23 (5bc6114) : rampe de
       profondeur chaude (surfaces = couches, --surface-4), texte
       contenu clair vs chrome sombre, accent POTION violet (titre,
       focus, selection) a cote de l'ambre d'etat, boutons en relief,
       vignette de scene. CSS pur, specs geometrie re-vertes.
2. [x] TOPBAR + TRANSPORT — FAIT 2026-08-23 (12c52f3) : barre reelle
       (surface encadree), cluster transport encastre, horloge
       phosphore lueur+lunette, statuts en pilules avec halo connecte.
3. [x] ZONE PISTES — FAIT 2026-08-23 (9c61786) : heads en couches
       (selection teintee potion), faders gorge+curseur eclaire,
       vumetres a lunette, clips decolles du couloir, halo de
       selection potion A INTENSITE EGALE (loi session B intacte),
       seek hover potion.
4. [x] PANNEAU DEVICES — FAIT 2026-08-23 (055261f) : cartes en
       couches, barres de titre eclairees, bypass = LAMPE (ambre
       allumee avec halo / enfoncee eteinte).
5. [x] PALETTE/KIT + OVERLAYS — FAIT 2026-08-23 (3632e59) : chips en
       relief, arme = munitions vertes luisantes, aide en panneau
       flottant sur fond floute.
6. [x] MICRO-INTERACTIONS — FAIT 2026-08-23 : transitions de LUMIERE
       seulement (jamais la geometrie — les drags ecrivent left/width
       en direct), hover de clip, halos M/S presses, menu + device
       anime 90 ms. REGLE GRAVEE : ni transition sur les vumetres
       (la balistique appartient a la couche life), ni sur la
       geometrie des clips.
       LA REFONTE 6/6 EST PASSEE UNE PREMIERE FOIS — les tranches
       restent OUVERTES aux passes suivantes (le « au fur et a
       mesure » de la directive : chaque session peut re-passer une
       tranche avec un cran d'ambition de plus).

## TRANCHE 3 — LE DIFFERENCIATEUR (ADR-019, recadrage 2026-08-23)

L'invariant : un pair sans le plugin entend le resultat du plugin.
Constat du recadrage : zero ligne, zero concept dans le depot — tout ce
qui suit le construit. Arbitrage utilisateur : stems ET streaming, tous
deux de premiere classe dans la tranche (stems = verite de lecture,
streaming = canal ephemere du jam ; deux fonctions, pas un chemin
dedouble). Ordre :

0. [x] TEST LNA CHROME — FAIT 2026-08-23, le jour meme du recadrage :
       L'HYPOTHESE PORTEUSE TIENT. Invite Chrome apparue, autorisee ->
       WS connecte depuis une page HTTPS publique (trycloudflare) au
       moteur local (--allow-origin requis, prevu pour ca). Canari
       fetch non conclusif (400 sans CORS = « Failed to fetch » meme
       quand le reseau passe — defaut de la page de test). RESTE
       (session courte, 30 s de mains) : comportement au refus,
       memorisation, annulation ; + logguer les connexions acceptees
       cote moteur (le log etait muet pendant la preuve).
1. [x] CRITERE 3 VRAIMENT VRAI — FAIT 2026-08-23 (ouverture de
       l'entrelacs, meme soir que la cloture vague 1). A4-1 refus
       bruyant serveur (get_missing_deps apres load_incremental,
       jamais broadcast sans persist reel), A4-2 getMissingDeps cote
       JS -> applyChange false -> resync, A4-3 GRAINE COMMUNE VENDORED
       (make-seed.mjs, octets identiques web/serveur, premier contact
       = merge+push, plus de load destructeur, demarrage sans serveur
       editable), A4-1c fermeture sur echec de save initial, A4-4
       heartbeat 'hb' 15 s + watchdog 45 s onglet. Gardes : cargo test
       7/7, sync-resilience.spec (3 invariants dont serveur-demarre-
       apres). Reserve critere 3 (2 onglets) levee dans STATUS.
       LIMITE ECRITE : un VIEUX projet (racine pre-graine) ne merge
       pas des editions faites hors-ligne avant premier contact (deux
       racines etrangeres) — s'applique aux projets nes apres.
       DECOUVERTE de la garde : les vieux docs (default.am) portent
       des deps manquantes PERMANENTES (cicatrices ere A4-1) -> le
       refus se mesure en DELTA (un change qui en AJOUTE), jamais en
       absolu (boucle de resync infinie sinon) ; auto-guerison au
       premier contact (la graine poussee une fois, adoptee).
0pre. [~] ARBITRAGE POST-SEANCE-MUSIQUE (2026-08-23, compte-rendu de la
       premiere seance utilisateur complete — 203 clips, AGain, rendu
       48 s). ORDRE RE-ARBITRE 2026-08-23 (2e passe utilisateur) :
       A -> B -> 1pre -> 1bis, PUIS C et D. Raison ecrite : ni C ni D
       ne rapprochent deux machines l'une de l'autre, et le smoke
       apprendra des choses qui touchent au modele — a connaitre AVANT
       de coder duplicate.
       A. [x] EAR-VERITE — FAIT 2026-08-23 : l'oreille avait dit VERT sur
          48 s de silence total. Deux corrections : ear resout les
          assets depuis le STORE du serveur (aujourd'hui il ne lit que
          engine/test-assets -> tout projet fait d'assets droppes rend
          muet) ; et silence integral = ROUGE PAR PRINCIPE (garde-fou
          au self-test CI). Un outil de preuve qui valide du vide
          invalide retroactivement ses verdicts. FAIT : staging par
          hash depuis server/assets (fallback test-assets, manquant =
          refus bruyant) + self-test 6 (silence rouge, piece eparse
          verte). Preuve : ma-piece muet-vert -> son-vert, copies de
          contournement retirees avant preuve. CI verte (run
          32641506712, commit adbd7a0).
       B. [x] SUPPRESSION DE CLIP + ETAT DE SELECTION — FAIT
          2026-08-23. Cause trouvee : un clic SANS mouvement sur une
          poignee de bord ne selectionnait RIEN (branche absente dans
          beginClipResize) — et un clip minuscule (hat 0,07 s = 1,4 px)
          est ENTIEREMENT couvert par ses poignees : selection
          impossible, Suppr inerte, silencieux. Correctifs : clic sur
          poignee = selection (symetrique du bandeau) ; deselection au
          clic-couloir re-rend (le visuel ne ment plus, A4-18 solde) ;
          halo de selection lisible a toute largeur (2 px l'etait pas).
          Garde : clip-selection.spec (5 invariants : selection bandeau,
          selection poignee, deselection visible, Delete agit DOM+doc,
          Delete sans selection = no-op heads stables). Suite 16/16.
          Trace visuelle livree (halo prouve sur un clip de 2 px).
       C. [ ] RENDRE VISIBLE (perimetre FINAL arbitre 2026-08-23,
          3e passe — session UNIQUE et BORNEE, APRES 1pre et 1bis,
          pas avant). Constat acte : le DAW est plus capable qu'on ne
          le croyait (16 capacites cachees, JOURNAL), rien n'en est
          visible. Contenu, dans l'ordre de valeur :
          1. DESSINER LA GRILLE DE SNAP, y compris son raffinement au
             zoom — une regle invisible et variable est pire que pas
             de regle.
          2. RENDRE VISIBLES LES TROIS EFFETS du clic de couloir
             (selection piste + marqueur d'insertion + pause Follow) —
             pas de la decouvrabilite : un effet de bord non annonce,
             la cause du « logiciel qui agit tout seul ».
          3. LEGENDER les quatre glyphes nus (⇥, A, B, C) + une aide
             raccourcis (?) listant les huit touches.
          TOUT LE RESTE de l'inventaire ATTEND. Pas de refonte d'UI,
          pas de lecture Ableton : les capacites existent, il s'agit
          de les montrer.
       D. [x] AJOUTER/RETIRER UN DEVICE DEPUIS L'UI — FAIT 2026-08-23
          (V1.5). Bouton `+ device` (builtin.gain | vst3 par uid valide
          ^[0-9A-Fa-f]{32}$, AGain pre-rempli), retrait ARME en deux
          clics (clavier-safe, pas de dialog bloquant), les deux
          journalises undo (l'inverse d'un retrait re-insere le
          ProcessorDef COMPLET a son index — l'ordre d'une chaine est
          un sens). ET l'eviction A4-5 moteur : au rebuild, les enfants
          dont le node_id a quitte le document sont stop()+evinces —
          DIFFEREE jusqu'a vidage de la file des graphes retires (un
          ProxyNode retire lit encore le ring : evincer avant la
          barriere generationnelle = use-after-free), telemetrie
          re-cablee (pointeurs bruts vers le handle detruit).
          Gardes : devices.spec (5 invariants dont convergence 2
          onglets et undo-restaure-l'ordre), gtest testRegistryEviction
          (2 evinces, survivant a la MEME adresse, idempotent).
          Bug attrape par la spec : display:flex ecrasait [hidden] —
          le menu invisible-cense interceptait tous les clics.
       Le reste de la liste ATTEND (renommage, tempo — la grille, le
       master meter et les FADES sont FAITS : V1.4, V1.2, V1.6).
       FADES DEGELES ET LIVRES 2026-08-23 (V1.6) : implicite 4 ms
       inconditionnel (equivalence silence-rampe = identite), champs
       fadeIn/fadeOutSamples additifs, poignees UI journalisees undo,
       NOUVEAU HASH DE REFERENCE 56729beb61993cd7 (DECISIONS.md).
       VAGUE 1 COMPLETE : V1.1 boucle/arret, V1.2 master, V1.3 undo,
       V1.4 visibilite, V1.5 devices+eviction, V1.6 fades. Prochain
       cap grave : ENTRELACS (critere-3-vrai A4-1/2/3 + heartbeat
       FAIT, puis design placement SCHEMA v2 avec clips MIDI
       co-designes — DOSSIER ECRIT docs/SCHEMA-V2-DESIGN.md, statut
       PROPOSITION a ratifier : cle de stem cache-d'entrees, stem par
       DERNIER noeud vst3 de la chaine (raffinement par-noeud = dette),
       PDC declaree (stemLatencySamples), etat plugin stateHash +
       stateVersion LWW hors CRDT, notes MIDI en map a ids stables ;
       tout ADDITIF, migrate() reste vierge jusqu'au tempo).
1pre. [x] MECANISME DE LIVRAISON DU TOKEN — FAIT 2026-08-23 (etage
       dev, suffisant pour 1bis ou chaque machine porte sa stack) :
       resolution FRAGMENT (#token, lancements moteur/daw.ps1) ->
       query (legacy) -> endpoint local /api/engine-token (vite
       middleware lit %TEMP%, la page ne peut pas ; pas de CORS =
       illisible cross-origine, LNA par-dessus). REGLE 4001 CABLEE :
       token refuse -> re-fetch + UNE retentative silencieuse (marche
       apres un RESTART moteur reel, sans recharger l'onglet). Garde :
       token-zero-paste.spec (2 invariants : pastille verte sans aucun
       token dans l'URL ; recovery 4001 apres kill+restart moteur).
       RESTE (production, quand le site sera distant — date, pas
       bloquant pour 1bis) : le moteur sert le token lui-meme
       (Origin-gate) OU lancement-fragment seul ; consigne ADR-019.
       (item d'origine : a trancher AVANT 1bis —
       decouvert par le 4001 accidentel du harnais LNA 2026-08-23) :
       une page servie d'un domaine distant ne peut pas lire
       %TEMP%\daw-engine-token-<port>. Option de tete (reviewer
       2026-08-23) : le moteur ouvre le navigateur avec le token en
       FRAGMENT d'URL (#token=..., JAMAIS en query : la query part
       dans les logs du tunnel, l'historique et le Referer — le
       fragment ne quitte jamais le navigateur). Alternatives a peser :
       endpoint local servi par le moteur apres permission LNA ;
       handler de protocole. Bloque « j'allume mon
       ordi, je vais sur mon site » ; sur deux machines le probleme est
       double. + REGLE gravee : close 4001 (token perime, ex. moteur
       redemarre) -> l'onglet re-recupere le token et retente UNE fois,
       sans rien demander a l'humain (signature distincte de 1006,
       prouvee). + Onboarding non destructif : permissions.query
       ('local-network-access'/'local-network', Chrome 151) lisible ->
       etape guidee AVANT toute tentative, jamais d'invite surprise ;
       feature-detection OBLIGATOIRE (les deux noms + le chemin
       TypeError : Firefox/Safari sans API = heuristique de secours).
1bis. [x] SMOKE DEUX MACHINES — TENU 2026-08-23, LES DEUX SENS :
       fixe (192.168.1.x) et portable TX15 (hotspot telephone 10.102.x),
       UN serveur (fixe, loopback + tunnel cloudflared), relais ws->wss
       cote portable. ALLER : WAV depose cote fixe (16:07:26 UTC) ->
       clip+asset recus par le MOTEUR du portable (asset 698e95 ecrit
       sur son disque). RETOUR : asset+clip emis du portable
       (16:32:23 UTC, PUT 201 a travers le tunnel) -> mon moteur a
       fetch b890b1 et rebuild (log v=4). Trace : traces/smoke/.
       Reserves honnetes : geste retour = niveau document (pas un drag
       UI) ; verification portable par SSH (processus+fichier disque),
       ecran portable vu par son agent local. Frictions moissonnees :
       moteur sans --assets ecrit les assets fetches dans le CWD
       (build-msvc pollue, les 2 cotes) ; script retour crashe sur le
       broadcast (load d'un change comme doc — outil jetable) ; la
       lecture ne s'arrete jamais (57 min au compteur). (item d'origine :
       ne pas re-commettre l'erreur qu'on vient de corriger — valider
       l'hypothese qui porte tout AVANT de construire dessus) : deux
       ordinateurs, deux reseaux, un projet, un WAV depose, convergence
       observee. Pas le critere complet, pas les VST, pas les stems —
       une heure. Fait tomber les surprises identite/NAT/decouverte du
       serveur pendant que 2-3-4 sont encore modifiables, et verifie
       que le trio deps-manquantes est vraiment regle.
2. [ ] DESIGN DU PLACEMENT (session dediee, SCHEMA v2) : chaque noeud
       declare quel pair l'heberge, negocie par capacite ; reprise
       quand le pair hebergeur part. AVANT toute nouvelle ligne de
       timeline. Le design seul — l'implementation suit les fondations.
       SE CONCOIT AVEC LES LIEUX D'ECOUTE (entree ci-dessous) — meme
       sujet, deux faces.

2bis. [ ] LIEUX D'ECOUTE (consignation utilisateur 2026-08-25 — a
       TRANCHER pendant la session SCHEMA v2, pas avant, pas de code).
       L'IDEE : dans un projet partage, chaque participant a sa propre
       position d'ecoute, deplacable d'un clic — SEUL (flux strictement
       local : pre-ecoute de samples, essais de chaines ; l'edition
       converge normalement, c'est l'ECOUTE qui est isolee), COMMUN
       (N rendus locaux du meme document — pas un flux partage, ils
       sonnent pareil parce que le document est le meme), CHEZ UN PAIR
       (j'ecoute ce qu'entend Paul, solos/mutes/pre-ecoutes compris).
       La capacite existe PAR CONSTRUCTION (un moteur par machine) :
       a REVELER, pas a construire. Besoin quotidien : tester 456
       kicks sans que personne ne les entende, puis faire ecouter
       l'elu.
       CE QUE CA UNIFIE (trois cas speciaux -> un mecanisme) :
       le solo/mute d'ecoute local (deja arbitre hors document — ce
       modele rendu explicite et manipulable) ; la pre-ecoute (= mode
       seul + source temporaire) ; le stream de stems (= le mecanisme
       de « rejoindre quelqu'un », pas un canal separe).
       CONTRAINTES NON NEGOCIABLES :
       (a) RIEN dans le document — position, mode, solos locaux,
           selection de pre-ecoute = etat de performance, canal
           ephemere (comme la telemetrie) ; la regle existante
           s'applique telle quelle, ne pas la violer par commodite ;
       (b) le MODE est visible aux autres (partir dans son coin sans
           le dire = « on me parle et je n'entends rien ») ; son
           CONTENU est prive — presence, pas surveillance ;
       (c) aller ecouter un pair SE DEMANDE ou au minimum SE SIGNALE
           (ca consomme sa bande passante et expose ce qu'il
           bricole) — consentement explicite ou notification, jamais
           silencieux ;
       (d) le retour au commun ne casse RIEN : ni la position de
           lecture, ni le transport (le geste le plus frequent).
       TROIS QUESTIONS A TRANCHER AVEC LE PLACEMENT (SCHEMA v2) :
       1. le mode seul implique-t-il un rendu local des chaines
          distantes ? (ecouter seul une piste dont le plugin est chez
          Paul = entendre son stem — l'isolement depend quand meme de
          lui ; coherent mais A ECRIRE, et le badge de fraicheur vaut
          aussi dans ce mode) ;
       2. ecouter un pair = recevoir son stem diffuse — MEME transport
          que la pre-ecoute partagee, meme question du decoupage en
          tranches hashees (on n'adresse pas par contenu ce qui
          n'existe pas encore) : UN SEUL mecanisme pour les deux ;
       3. niveau de presence : liste des lieux occupes, indicateur par
          participant, ou juste un etat sur soi — a dimensionner,
          PAS a zero.
       REFUS ECRITS : pas de mise en oeuvre maintenant (consignation) ;
       JAMAIS de mode persistant cache (on ne decouvre pas apres 20
       minutes qu'on diffusait encore) ; pas de nouveau canal reseau —
       canal ephemere existant + store, ou ca attend.
       INTRANTS GRAVES (amendement ADR-019) : cle de stem = cle de
       cache d'ENTREES (version/build plugin + samplerate DANS la cle,
       jamais d'assertion de re-rendu bit-exact d'un plugin tiers) ;
       stem perime = etat d'UI ; un stem survit a son producteur
       (invariant) ; PDC cuite ou declaree ; B controle les params
       exposes via CRDT, la GUI et le binaire ne traversent JAMAIS.
3. [ ] 2.5-ETAT REQUALIFIE PREREQUIS : l'etat persiste des plugins
       (blobs Comp/Cont, canal assets) entre dans la CLE de stem
       (hash = entree + uid + etat + plage) — il precede le jalon
       stems. (Decouverte et fenetrage restent derriere.)
4. [ ] JALON STEMS PARTAGES : A rend la sortie de sa chaine VST, la
       pousse au store (PUT verifiant existant), B la tire et la joue.
       Preuve de l'invariant PAR ECHANTILLONS a travers le store.
       Re-rendu sur changement de hash (bouton tourne -> stem re-rendu
       -> B re-tire).
5. [ ] CANAL STREAMING JAM (meme tranche, apres le premier jalon
       stems) : P2P WebRTC/UDP, signaling par le serveur, jamais dans
       le document (meme logique que la telemetrie). PERIMETRE REFUSE
       (ADR-019) : monitoring d'instrument a latence de jeu via un VST
       distant — physiquement injouable, ne pas re-litiger.
6. [ ] CRITERE 3 NOUVELLE DEFINITION : deux machines, deux reseaux, un
       projet — E2E reel (le serveur gagne au passage son avenir
       explicite : identites, projets heberges, invitations, signaling
       — etat provisoire assume, plus une loi de design).

7. [ ] L'INSTRUMENT JOUABLE (avis reviewer consigne 2026-08-23 —
       APRES 1bis, jamais avant : ne rapproche pas l'invariant).
       REFERENCES D'IMPLEMENTATION EFFETS NATIFS (utilisateur
       2026-08-24) : le code de VCV RACK (GPL-3, licence compatible —
       reutilisable) comme litterature DSP (dsp/ : biquads, resamplers
       pour l'oversampling du drive) ; le manuel Live = bible de
       COMPORTEMENT seulement, jamais de DSP (brief effets natifs).
       Decoupage arbitre en 3 sessions : 1 Utility+chassis natif,
       2 EQ 3 bandes + compresseur, 3 Drive (oversampling, 1er client
       PDC) + Delay. A ouvrir apres la session crash 0xe06d7363.
       LE TEST ULTIME (vision utilisateur 2026-08-24, scenario
       d'acceptation de la vague 3) : « dessiner du midi sur le laptop
       et que ca trigger un Massive de NI sur mon pc, et qu'on entende
       tous les deux ». Decompose : clips MIDI dans le doc (SCHEMA v2)
       + placement (le noeud Massive vit sur la tour) + rendu tour +
       jam vers le laptop (suspension L1c evite le flanger) + sync
       transport (fait). Note compat : Massive CLASSIQUE = VST2
       (refus grave) mais NI l'a porte VST3 (1.6+, programme 2022-23,
       comme FM8/Absynth) — la demo passe par le binaire VST3, verifier
       la version installee sur la tour le moment venu.
       Le raccourci qui decoule d'ADR-002 : jouer des notes en direct =
       PERFORMANCE, pas document — note-on/note-off sur le canal WS
       moteur existant (meme sang que bypass/solo/transport), zero
       CRDT, zero clip MIDI. Demo « j'ouvre le site, je clique, un
       synthe natif sonne ». Prerequis deja dans la tranche : D
       (bouton device), 2.5-etat, decouverte ; manque propre a lui :
       config de bus INSTRUMENT (l'hote ne sait faire que des effets),
       et les events note dans le ring (couvert si la file A3-1 est
       GENERIQUE — voir note ordre 3). REFUS ECRIT : VST2 (Massive
       classique) — hote VST3 exclusif, SDK VST2 plus distribue ;
       banc d'essai : synthe VST3 libre (Surge XT, GPL comme nous ;
       Dexed). La GUI du plugin = fenetre native a cote du navigateur,
       choix de design a trancher a ce moment-la.
       LES CLIPS MIDI DANS LE DOCUMENT (notes persistantes, editables,
       convergentes) = l'autre moitie, un VRAI morceau de schema : se
       pense AVEC la session placement (SCHEMA v2, item 2 ci-dessus),
       pas apres — sinon on dessine deux fois.

Les ordres AUDIT-4 items 3-4 (ring, cycle de vie enfants) restent des
fondations de l'hote que les stems rendront ; items 5-6 inchanges.

## ROADMAP POST-MANUEL ABLETON — **GELEE (ADR-019)** : les items 3 a 8
## ci-dessous ne demarrent pas tant que placement + stems + critere 3
## deux-machines ne sont pas verts. Raison ecrite : la parite d'abord =
## un DAW mono-utilisateur mediocre et un distribue impossible a
## retro-installer. (2026-08-22 — lecture integrale, synthese dans
## docs/ABLETON-INTEGRALE.md ; les designs CRDT y sont acquis)

Ordre grave (la confiance avant le sucre, arbitrage confirme) :

0. [~] SECURITE (S1+S2 FAIT: Origin local-first, cap WS, token CSPRNG+constant-time, garde size_t, WAV borne, clamp+cssES cote web ; RESTE H3 fichiers+O_EXCL, M4 token-URL, parse hors-verrou) (SECURITY.md)
       C1 path traversal [FAIT] ; puis C2 (auth serveur + CORS strict),
       H1 (CSPRNG token moteur + compare constant-time), H2 (cap taille WS
       + parse borne hors verrou), H3 (fichiers owner-only + O_EXCL),
       M2/M3/M5 (garde 32-bit, parseur WAV borne, clamp doc cote web).
1. [x] CONFIANCE — critere 3 vrai FAIT (push anti-entropie, 282b030).
       Reste : file param multi-slots (A3-1) puis contrat de periode
       (A3-2/A3-3).
2. [ ] 2.5 ETAT+DECOUVERTE, enrichi par le manuel : blobs Comp/Cont par
       instance DANS le document (regle de verite : blobs gagnent,
       param-list = projection UI) ; scan moduleinfo.json + blacklist au
       2e crash par class-uid ; exposedParams par instance (Configure
       Mode) ; champ deactivated distinct de bypass (0-CPU vs dry a
       latence constante) ; Utility natif (perimetre fini consigne).
3. [ ] LES GAINS PROCHES (sessions courtes, ordre de valeur) :
       a. fades/crossfades 4 ms anti-clic (fadeIn/Out/curve sur clip +
          rampe moteur) — solde la dette crossfade de 2.4d ;
       b. slide-du-contenu (offsetSamples, pur geste) + selection de
          temps + split/consolidate ;
       c. clip.gainDb + clip.pitchCents ; track.pan constant-power ;
       d. nudge, count-in.
4. [ ] AUTOMATION (la grande couche) : lanes en point-maps a ids stables
       (design complet dans ABLETON-INTEGRALE §4), override ephemere par
       utilisateur, moteur breakpoints -> IParameterChanges. Les
       enveloppes de clip (abs/mod) suivent, pipeline prevu des le debut.
5. [ ] SENDS/RETOURS + GROUPES (+ sidechain=resampling : routage a 3
       prises, un champ input:{sourceTrackId, tap}).
6. [ ] TEMPO — LA migration (double timestamp secondes<->beats, tempo
       LWW-register facon Link, signature = evenements) : ouvre metronome,
       grilles metriques, grooves. Session de cadrage dediee AVANT.
7. [ ] LES DEPASSEMENTS (ou notre architecture bat l'original) :
       undo per-acteur persistant navigable (historique Automerge) ;
       freeze = cache de rendu prouvable par hash ; export/stems
       (2 passes queues, part-des-retours).
8. [ ] FUTURS NOMMES : enregistrement + take-lanes-vues (comping CRDT),
       vue de jam collaborative (Session repensee sur etat de presence,
       jamais dans Automerge), Follow Actions avec seed.
REFUS ECRITS : macros/racks (indirection non arbitrable par CRDT), M4L
(fichiers externes mutables), alea sans seed, etat de performance dans le
document. Voir ABLETON-INTEGRALE §5.

## Tranche 2 — HOTE VST3 (le cap)

La demo que ni Soundtrap ni BandLab ne peuvent copier : un plugin natif
pilote depuis un onglet. Sous-etapes de soutien, dans l'ordre :

- [x] 2.1 ESCALADE 2026-08-21 : support Rust d'automerge-repo immature
      (automerge-repo-rs = non compatible reseau avec le JS ; samod =
      compatible mais "experimental, don't use anywhere serious").
      Options rapportees : A relais Node officiel (mais 2 syncs cohabitants,
      re-scoper le critere), B durcir le sync maison Rust (persister avant
      de diffuser) et revisiter quand samod murit, C geler et passer a 2.2.
      Recommandation session : B. DECISION : B, FAIT 2026-08-21 —
      persist-avant-broadcast corrige dans websocket.rs, test kill brutal
      (`cargo test --test persist_before_broadcast`) 5/5.
      Regle du sync maison : code condamne a terme — on n'y ajoute que ce
      qui corrige un defaut prouve par un test, jamais de la structure.
- [ ] 2.1bis VEILLE : reevaluer automerge-repo/samod. Critere de sortie
      d'experimental : le README de samod retire son avertissement
      ("don't use anywhere serious"), release taguee, et au moins un
      projet reel l'utilise en production. Verifier a chaque debut de
      tranche, pas avant.
- [x] 2.1ter FAIT 2026-08-22 : mutations du store serialisees (store_lock
      dans AppState — creation du doc par defaut + apply_change), test
      `concurrent_first_writes` rouge prouve puis vert. Les tests spawnes
      tuent desormais leur serveur meme sur panic (ServerGuard/Drop).
      Le sync maison n'a plus de defaut connu.
      - La migration inclut la SUPPRESSION de l'ancien code de sync
        (protocole artisanal, anti-entropie, file offline maison si
        automerge-repo la remplace). Deux chemins de sync cohabitants =
        echec de la session.
      - Avant d'ecrire quoi que ce soit : verifier l'etat reel du support
        automerge-repo cote Rust. S'il est immature, ESCALADE PROPOSEE
        avec les options (ex: relais sync Node, Rust garde stockage +
        assets) - ne pas bricoler un pont.
      - Le moteur C++ ne migre PAS (il parle au serveur). Le jalon
        fader->moteur doit rester vert SANS modification cote moteur ;
        si ca casse, c'est le serveur qui s'adapte.
- [x] 2.2 FAIT 2026-08-22 — VERDICT A (voir docs/DECISIONS.md): taille quasi
      constante (compression colonnaire), seul le temps de chargement croit
      (~2,4-4,9 us/change). Le VST3 demarre sans prealable. Dettes datees:
      compaction (declencheur: > ~100k changes / load web > 500 ms),
      coalescing des drags (optionnel, session web courte).
- [x] 2.3 FAIT 2026-08-22 (nuit post-jalon, en deux verdicts) :
      a. SHA-256 reel (util/sha256 autonome, vecteurs FIPS, streaming) —
         assetHash est enfin ce que SCHEMA.md pretendait ; le hash est une
         CLE DE NOM (<hash>.wav), les documents historiques FNV restent
         valides comme noms. 21/21.
      b. Le cote HTTP du triangle : store adresse par contenu sur le
         serveur (GET/PUT /assets/:hash, le PUT VERIFIE sha256(corps) ==
         cle — et cette verification a debusque des sa premiere execution
         un JUMEAU FNV oublie dans create_test_doc, soude depuis) ; le
         moteur, au miss local en mode serveur, tire l'asset du store
         (verifie, ecrit atomiquement, echecs memorises par session).
         Tests : asset_store (Rust, refuse le mensonge), asset-fetch
         (E2E : asset present SEULEMENT sur le serveur -> le moteur le
         recupere et construit le graphe). E2E 12/12.
      Le socle de « l'etat des plugins d'abord » (2.5) est pose : les
      blobs hashes hors CRDT ont leur canal.
- [x] 2.3bis AUDIT A FROID — FAIT 2026-08-21 (rapport AUDIT-2.md ;
      case restee ouverte par oubli, cochee a la session 1 post-AUDIT-4).
      Question directrice : qu'est-ce qui va ceder quand le VST3 va
      s'appuyer dessus ? Reponses arbitrees dans PREALABLES 2.4.
- [ ] PREALABLES 2.4 (arbitrage audit 2, 2026-08-22) — quatre sessions
      bornees, dans cet ordre, puis l'hote. Seuls prealables recevables :
      ce sur quoi le plugin de gain isole s'appuie directement.
      1. [x] R4+S4 FAIT 2026-08-22 : pointeur brut atomique + retention
         par generation (ADR-010 annote) ; solo/mute atomic<bool> ;
         static_assert compile + test runtime is_lock_free (10/10) ;
         repro use-after-free verte. atomic<shared_ptr>.is_lock_free()=0
         prouve sur MSVC, banni du callback.
      2. [x] ADR R3 FAIT 2026-08-22 : ADR-017 — un processus enfant par
         instance, proxys dans le graphe, registre d'instances survivant
         aux rebuilds (=> R2 devient un transfert de handles), spin borne
         + bypass cote callback, crash enfant = bypass + signalement.
      3. [x] R1+R2 FAIT 2026-08-22 : constructeur dans la boucle
         principale (thread reseau = apply + version seulement), snapshot
         ProjectDef sous verrou / build hors verrou, dernier etat gagne.
         Registre d'instances ADR-017 en structure. Test de rafale : 51
         changes non espaces + --debug-rebuild-delay-ms 100 -> rebuilds
         tres < 51, version finale construite (v=changes+1), 0 underrun.
         Jalon renforce, pas affaibli (ancien test intact et vert).
      4. Elagage docs (session courte) : les 7 ecarts docs/reel de
         AUDIT-2.md — le chantier demarre sur des documents qui disent vrai.
- [x] 2.4a FAIT 2026-08-22 : SDK vendore (v3.8.1_build_84, recursif,
      gitignore), protocole moteur<->hote en protobuf des le premier
      message (host_messages.proto), plugin_host --enumerate liste AGain
      (uid 84E8DE5F92554F5396FAE4133C935A18) ; module corrompu/absent =
      erreur propre exit 1, jamais de crash (tests 11-12, 12/12).
- [x] 2.4b FAIT 2026-08-22 : AGain instancie (ceremonie complete, chaque
      refus = erreur propre), gain via IParameterChanges (le canal de
      2.4c), bloc 256 contractuel (blocks==frames/256 asserte), preuve
      par echantillons EXACTE (identite a 1.0, moitie a 0.5). 14/14.
      CI : les deux jobs vendorent le SDK epingle + deps VSTGUI Linux —
      plus de code hote hors du filet (verif du run CI post-push).
- [x] 2.4c-1 FAIT 2026-08-22 (verdict CI du push de cloture = point de
      synchronisation transmis) : pont transparent PROUVE au bit pres
      (test 15 : 3 passes continues du fixture 2.4b a travers un enfant
      --serve persistant = rendu hors ligne exact) ; ProxyNode +
      --debug-proxy-again + pipeline callback sans attente (test 16 :
      fill silencieux, bypass sec compte, wet a profondeur, rafales de 2) ;
      rafale E2E verte A TRAVERS le proxy (enfant spawne une seule fois,
      0 underrun) ; smoke reel 10 s WASAPI : 0 underrun, 4 blocs manques
      (amorcage du device, borne, documente).
      REVISION EN COURS DE ROUTE (premiere preuve vivante : 534/1875 blocs
      sec) : la profondeur du pipeline est passee de 1 a 2 blocs — le
      driver livre buffer/256 blocs DOS A DOS par callback, une trame
      d'avance perd la course. kLayoutVersion=2 (4 slots), profondeur =
      politique du noeud (buffer/256), l'enfant traite le backlog DANS
      L'ORDRE (le saut au plus recent affamait le consommateur).
      => 2.4d : getLatencySamples() retournera UN CALCUL, jamais une
      constante — latence = depth x 256, depuis la profondeur VIVANTE du
      noeud (buffer 512 -> 2 blocs -> 512 ech. ; buffer 1024 -> 4 blocs ->
      1024 ech.). Le canal param n'est PAS un seqlock (note gravee dans le
      contrat) : a durcir avant que c-2 n'y fasse passer plusieurs params.
      Detail d'origine :
      memoire partagee (ring audio + changements de parametres), cadence
      callback<->enfant, ProxyNode instancie EN DUR (--debug-proxy-again,
      pas encore le chain). DECISION PRISE EN ENTREE : pipeline a une
      trame — le callback depose le bloc N et recupere le N-1 deja pret ;
      l'enfant a 5,3 ms pleines pour 256 echantillons ; cout = 1 bloc de
      latence, declare dans getLatencySamples() en 2.4d. Depassement
      malgre tout = bypass du bloc + compteur d'incidents dans
      EngineState, JAMAIS d'attente non bornee.
      Preuve : le WAV de reference 2.4b rejoue EN CONTINU a travers le
      pont, echantillons identiques au rendu hors ligne — le pont est
      transparent, prouve au bit pres.
      PREMIER GESTE A LA REPRISE : relire shared_audio_ring.h A FROID
      avant d'ecrire proxy/--serve — le contrat a ete ecrit dans l'elan
      du cadrage et jamais confronte a du code ; une fois les deux cotes
      ecrits, chaque retouche du layout se paie double.
      TROIS PIEGES CONNUS D'AVANCE :
      1. Pas d'atomiques inter-processus gratuits : les std::atomic du
         ring DOIVENT etre dans le segment et lock-free — etendre le
         static_assert is_always_lock_free aux types inter-processus.
         AUCUN mutex STL dans le segment (UB deguise) ; SPSC a indices
         atomiques, meme moule que les peaks.
      2. Le layout du segment = contrat binaire entre deux executables :
         header commun aux deux cibles avec static_assert(sizeof) +
         offsetof sur chaque champ — le SCHEMA.md du monde binaire.
      3. La mort de l'enfant se detecte au thread de CONTROLE (handle de
         processus, timeout zero), jamais dans le callback — lui ne
         connait que « bloc pret ou pas » (absent = bypass comptabilise).
         Cette separation posee en c-1 rend c-2 presque deja ecrit.
- [x] 2.4c-2 FAIT 2026-08-22 (verdict CI du push de cloture = point
      transmis), dans l'ordre impose :
      1. SEQLOCK du canal param en premier geste (odd/even, layout v3,
         double-check lecteur borne) — le trio ne peut plus apparier un id
         frais avec une valeur perimee. Test 17 : changements successifs
         appliques chacun au bloc suivant.
      2. LE KILL (test 18) : enfant tue en plein vol -> bloc deja servi
         conserve, bloc non servi = bypass SEC EXACT (aucun artefact) +
         compteur ; mort vue au CONTROLE (poll 30 Hz), relance a froid sur
         le MEME segment (budget 3, signale EngineState :
         plugin_child_alive/restarts) ; le dernier param SURVIT au crash
         dans le ring. + Garde parent decouverte en session : un moteur
         tue net laissait l'enfant orphelin en spin (constate, exe
         verrouille) -> --parent <pid>, l'enfant sort seul (prouve test 18
         et par l'E2E kill reel : plus d'orphelin).
      3. LE CHAIN (M3 solde) : lu ET ecrit (roundtrip test 19), params en
         LISTE de paires {key,value} (SCHEMA.md), uid sur le noeud, chemin
         JAMAIS dans le document (--vst3-module uid=path cote hote).
         ProxyNode construit depuis le document (live, registre par
         node_id) ; rendu offline via SyncProxyNode (chemin sync, latence
         zero, echec de pont = rendu en ECHEC). Test 20 : le son vient du
         document, echantillons exactement halves a travers le processus ;
         uid non resolu = echec bruyant (R5 solde offline, signale live).
      20/20 moteur, E2E 4/4 (rafale a travers le proxy).
      Reste connu : telemetry = 1 instance (dette datee multi-plugin) ;
      --debug-proxy-again conserve comme chemin de test.
- [x] 2.4d FAIT 2026-08-22 (verdict CI du push de cloture = point
      transmis) — LE BYPASS S'ENTEND, version E2E du jalon historique :
      un toggle clique DANS LE NAVIGATEUR change le son, prouve par
      echantillons, a travers AGain dans son processus (spec 'bypass
      toggle...' : seed par le contrat serveur, clic reel, re-lecture par
      le meme contrat, rendus wet/dry compares ; 10/10 E2E).
      1. getLatencySamples() = CALCUL (depth vivante x 256) sur
         ProcessorNode/ProxyNode ; AudioGraph::getLatencySamples (pire
         piste) ; la telemetrie cesse de mentir (buffer + graphe, R3).
      2. bypass = ETAT DU NOEUD dans le document (SCHEMA.md), un seul
         chemin vivant lu par les DEUX constructeurs : live = dry aligne
         dans le temps (latence conservee, pipeline chaud, pas un
         incident) ; offline = identite, zero enfant spawne. Roundtrip
         test 19, preuve au rendu test 20 (identite exacte au bit pres).
      3. Web : bouton bypass par noeud de chain (aria-pressed = etat du
         DOC, le clic demande l'inverse et l'affichage ne se pose qu'au
         retour du document) ; schema TS aligne sur la liste de paires
         (jumeau) ; structure DOM = pistes ET noeuds de chain.
      Hors perimetre reporte (dettes datees) : PDC inter-pistes
      (declencheur : premiere piste mixant sec et plugin), bypass sans
      clic en live (crossfade), fenetrage/GUI, etat plugin persiste,
      decouverte de plugins.

- [x] 2.4 Hote VST3 — LE CAP EST TENU 2026-08-22 : UN plugin de gain VST3
      (AGain) s'instancie dans un processus isole, traite de l'audio, et
      son bypass s'entend depuis un onglet — un plugin, un parametre, une
      preuve par echantillons, sur les deux OS. Ce qui reste de la
      tranche (fenetrage, etat, decouverte, plugins du commerce) se
      RE-CADRE en session dediee, conformement au cadrage.

- [ ] ARBITRAGE AUDIT-3 (2026-08-22, rapport AUDIT-3.md — lecture complete
      post-jalon, consigne le jour meme). Ordre DECIDE, avant 2.5 :
      1. [ ] LE TEST DES MAINS — REPORTE 2026-08-22 (decision utilisateur :
         produit trop embryonnaire, la boucle d'amelioration passe devant).
         Nouveau declencheur : la refonte UI livre une timeline utilisable ;
         les mains deviennent le GATE DE SORTIE de la refonte. La mission
         buffer ZenGo (256/1024/tordu, runbook item 8) et les notes-intrant
         de 2.5 restent attachees au test, seule sa date bouge. Les items
         2-4 ci-dessous ne sont PLUS bloques par lui.
      2. [ ] A3-1 FILE PARAM (prealable direct de 2.5-etat) : le canal
         param du ring n'a qu'un slot — deux setParam s'ecrasent, un
         plugin a n params perd n-1 params a chaque rebuild. File SPSC
         de paires {id, value} dans le segment, moule CommandRingBuffer.
         Session courte, test : 2 params envoyes coup sur coup, les 2
         appliques. DECISION D'ENTREE (2026-08-23, instrument jouable
         en vue) : la file est GENERIQUE — evenements {type, id, value}
         (type: param aujourd'hui, note-on/off demain) — pour que les
         notes de l'instrument s'y branchent sans re-bump de layout.
      3. [ ] A3-2+A3-3 CONTRAT DE PERIODE (une session) : depth clampee
         en silence a 2 (TODO promettait « buffer 1024 -> 4 blocs » —
         phrase fausse, famille des 47 runs) + bloc partiel (periode non
         multiple de 256) = bypass permanent. Remede : kRingSlots=8,
         clamp BRUYANT ou refus de demarrer, verification de periode a
         l'initialisation. La regle sort de la prose, entre dans le code.
         ELARGIE PAR AUDIT-4 (2026-08-23) : la meme session absorbe
         A4-5 (seq PAR SLOT de sortie — un bloc saute par l'enfant fait
         rejouer un slot perime, ni dry ni compte) et grave l'invariant
         input-dechire dans shared_audio_ring.h. Meme segment, meme
         bump de layout, une seule session.
         REPRODUCTEUR TROUVE (usage libre 2026-08-22) : le backend null
         (--mute) livre ses callbacks en rafales irregulieres -> le live
         sert massivement du DRY enfant vivant (meter sine 22,5 % =
         pre-AGain au lieu de 11,25 % wet, aucun restart) — famine du
         ring mesurable SANS device reel, CI-able pour cette session.
         + trou de telemetrie : le bilan de sortie n'imprime blocks_missed
         que pour le debug-proxy, jamais les instances document
         (main.cpp:865 et :1107).
      4. [x] A3-4+A3-5 CRITERE 3 VRAI — FAIT 2026-08-22 : push symetrique
         getMissingChanges(remote) -> sendChange a chaque reconnexion
         (en ordre causal), flushOutbox non-destructif (ceinture),
         requestResync sur echec d'applyChange, commentaire anti-entropie
         menteur corrige (A3-8.1 solde). Garde : criterion3-push.spec —
         le flush avale est REPRODUIT exactement (change consomme jamais
         envoye), serveur redemarre, le push le ramene (vert du premier
         coup). Suite 15/15. STATUS : critere 3 reserve LEVEE.
      Puis 2.5 s'ouvre, sur les notes des mains, socle assaini.
      A3-6 (transport multi-producteur SPSC) attend la session transport
      (candidat grille existant, meme chantier). A3-7 (rewrite complet
      par change cote serveur, quadratique) et A3-8 (menu hygiene) restent
      dates dans AUDIT-3.md avec leurs declencheurs.

- [ ] ARBITRAGE AUDIT-4 (2026-08-23, rapport AUDIT-4.md — quatrieme
      audit lecture seule : 3 passes paralleles moteur/serveur/web +
      critique de fond des .md). Ordre DECIDE (utilisateur, meme jour) :
      1. [x] PASSE « DOCUMENTS QUI DISENT VRAI » — FAIT 2026-08-23 :
         21/21 partout, token par port dans les procedures (STATUS +
         test-des-mains repare), port 9000 purge, dettes soldees cochees
         (token global, 2.3bis), README verite (Quick Start reel via
         daw.ps1/CI, structure, CLI ref complete), ADR-005 corrige
         (ixwebsocket), en-tete websocket_server.h (LNA fantome retire).
         Les 4 FUSIONS structurelles ARBITREES OUI et appliquees :
         STATUS scinde (JOURNAL.md cree, STATUS = etat court),
         DECISIONS racine fusionne dans docs/DECISIONS.md (registre
         unique), BACKLOG fusionne ici (liste unique), CLAUDE.md renvoie
         a STATUS au lieu de dupliquer criteres et liste de specs.
      2. [ ] « CRITERE 3 VRAIMENT VRAI, ROUND 2 » (A4-1+A4-2+A4-3,
         + A4-4/A4-1c) : Automerge bufferise les changes a deps
         manquantes SANS erreur des deux cotes — le serveur jette et
         broadcast quand meme, le client ne resync jamais sur le cas
         principal, et tout ce qui est edite avant le premier contact
         serveur est perdu. + heartbeat serveur->clients (socket zombie
         cote onglet). Tests de garde : scenario Lagged reproduit,
         demarrage serveur eteint. STATUS : reserve critere 3 ROUVERTE
         en attendant.
      3. [ ] SESSION RING ELARGIE = l'item A3-2+A3-3 ci-dessus, qui
         absorbe A4-5 (voir la note ELARGIE PAR AUDIT-4 dans l'item).
      4. [ ] CYCLE DE VIE ENFANTS + BOUCLE DE CONTROLE (A4-6 eviction
         du registre — enfant zombie 100 % CPU au retrait d'un noeud ;
         A4-7 fetch d'asset et spawn/restart deportes hors de la boucle
         de controle — gels 10-120 s, Ctrl+C inoperant). Avant 2.5.
      5. [ ] CONVERGENCE VISIBLE DES CLIPS (A4-9) dans la boucle
         refonte UI : sameStructure ignore la geometrie -> les
         deplacements distants ne se redessinent jamais dans l'autre
         onglet ; spec clip-drag a ancrer sur le DOM de l'onglet B.
      6. [ ] DETTES DATEES AUDIT-4 : A4-8 (validation document
         inoperante — zone format, refonte planifiee), A4-10 (lissage
         gain mort de fait), A4-11 (ids Date.now vs UUID), A4-12
         (32 bits INT_MIN), A4-13..A4-19 (menus moteur/serveur/scripts/
         code mort/hygiene web/discipline de test) — declencheurs dans
         AUDIT-4.md.

## ORDRE POST-S7 (revue externe consignee 2026-08-23, execution en
## cours) : 1. push+CI S7 [fait 92abe0d] ; 2. CONTRE-CONTROLES du
## test (sans-stem = refus bruyant assert, stem corrompu = jamais un
## faux vert assert ; cle desaccordee JOUE par design arbitre) ;
## 3. version du plugin dans la cle (= sha256 du BINAIRE du module,
## bundles marches tries) + purge default.am [fait, backup
## .junk-1246tracks.bak] ; 4. SMOKE S7 DEUX MACHINES (le vert du
## critere 6, premiere session portable) ; 5. PDC lecteur [FAIT :
## le stem joue AVANCE de la latence declaree (offset=latence),
## gtest sub[i]==ref[i+L] exact] + badge fraicheur [ARBITRAGE REQUIS
## avant code : un pair SANS le module ne peut pas recalculer la cle
## (le tag de version = sha256 d'un binaire qu'il n'a pas). Options :
## (a) cle REDUITE cote client — jumeau TS de computeStemKey,
## contrat 2 cles ; (b) le producteur publie un booleen stemFresh —
## simple, faux si producteur hors-ligne ; (c) timestamps —
## approximatif. PROPOSITION : (b) + mention « fraicheur inconnue »
## quand le producteur est absent] ;
## 6. streaming jam — RATIFIE par delegation utilisateur (« propre et
## performant ») : WebRTC navigateur (docs/STREAMING-DESIGN.md).
## S8a FAIT 2026-08-24 : TapRing lock-free (drop-newest, etage
## d'accumulation anti-trous), pumpTap chaque tour, AudioTap/TapControl
## au protocole, ?tap=1 + badge continuite, garde tap.spec (~375
## blocs/2s contigus, zero drop). S8b FAIT 2026-08-24 : relais
## signaling texte (serveur verbatim), JamChannel (1 diffuseur/projet,
## JOIN des auditeurs, STUN seul), latence ping mesuree au badge,
## file de signaling anti-CONNECTING + reassert (le bug de la
## premiere spec). S8c FAIT 2026-08-24 : tap -> worklet tap-player
## (FIFO 50 blocs drop-oldest) -> MediaStreamDestination -> addTrack ;
## auditeur joue (autoplay gere, badge « clic pour le son ») ; garde =
## track distant live/false (les frames RTP arrivent) avec le vrai
## moteur. LA TRANCHE S8 EST COMPLETE EN LOCAL. RESTE : le test REEL
## deux machines (le portable ECOUTE la tour — manip utilisateur a
## l'oreille), TURN (dette datee), mesure CPU worklet (dette).
## (c'est LUI qu'on coupe s'il deborde.)
## Rappel de la revue : la preuve est calibree sur le plugin le plus
## gentil du monde — latence nulle, etat minuscule, deterministe,
## sans GUI : quatre endroits ou le premier vrai plugin cassera.
## Chaque contact avec le reel vaut dix sessions de construction.

- [x] STEMS S7 — LE JALON PROUVE 2026-08-23, le meme soir :
      testStemInvariant = machine B SANS AUCUN module rend le document
      OCTET POUR OCTET comme la machine A qui a AGain (stem float32
      IEEE au store, cle de cache d'entrees, substitution partagee
      live/offline dans graph_common, publication AUTO par le moteur
      au meme debounce que l'etat, badge STEM violet UI). Moteur
      28/28. RESTE pour le critere 6 ✅ : le smoke S7 DEUX MACHINES
      (portable, store serveur reel) — premiere session portable.
      DETTES DATEES : version du plugin dans la cle (vide) ; badge de
      FRAICHEUR (cle perimee -> orange) ; geste « figer » manuel.

- [x] 2.5-ETAT FAIT 2026-08-23 (sessions A+B le meme soir).
      A : l'etat traverse la frontiere de process — ring v4
      (state_request/ready_seq), blob par fichier `<segment>.state`
      (format partage state_file.h), restauration ceremonie
      processor-first, bridge setPendingState/saveState, garde
      testPluginStateRoundtrip (0.25x exact depuis l'etat seul).
      B : l'etat entre au DOCUMENT — stateHash/stateVersion additifs
      (moteur-authore via setProcessorState + getLastLocalChange ->
      sendChange), capture debouncee 1 s post-rebuild, blob au store
      (putAssetToServer, PUT verifie), restauration au spawn par la
      route des assets, badge UI (panneau devices, in-place). Prouve
      sur duo reel : badge 480376c6 v1 converge. Moteur 27/27.
      DETTES DATEES : etat distant mis a jour EN VIE de child (pas de
      restart auto — les params couvrent le cas courant) ; capture
      synchrone dans la boucle de controle (famille A4-7) ; extension
      .wav cosmetique sur les blobs du store.
      INCIDENT CONSIGNE (JOURNAL) : la graine poussee sur un VIEUX
      projet a eclipse les tracks de duo (LWW) -> fix isPristineSeed
      (placeholder vierge = load, jamais merge+push) + reparation
      duo (re-election, backup) ; ma-piece auditee INTACTE.

- [ ] INTRANTS 2.5 CONSIGNES — complement manuel Live 12 (lecture
      2026-08-24, demande utilisateur) : conventions CONFIRMEES par le
      manuel (auto-disable au 2e crash, etat par instance dans le set,
      PDC par defaut, fenetre native separee auto-open) + un seuil
      chiffre a retenir : <= 64 params -> tout afficher, au-dela ->
      panneau vide + Configure mode. Windows = VST2+VST3 chez Live ;
      nous VST3-only (Massive demo : binaire VST3 1.6+).
      (recherche mecanique profonde 2026-08-22,
      sources SDK dans docs/UI-CONVENTIONS.md) : les 5 mecaniques a
      respecter pour que etat+decouverte soient credibles — (1) deux
      blobs Comp/Cont, restauration processor-first ; (2) cle = class ID,
      jamais le chemin ; (3) scan moduleinfo.json + enfant fallback +
      blacklist persistee ; (4) flush numSamples==0 ; (5) kLatencyChanged
      = rebuild + PDC. Premier device natif a livrer : Utility/Gain
      (valide le pipeline param/etat au-dela d'AGain).

- [ ] 2.5 RE-CADRAGE POST-2.4 (session dediee, lecture + arbitrage).
      Trois conseils en entree (recus a la cloture de 2.4, a peser) :
      1. L'ETAT DES PLUGINS D'ABORD — le chainon entre AGain (un param en
         clair) et tout plugin reel (blobs opaques Ko-Mo). Decision a
         moitie ecrite depuis la tranche 1 (gros blobs HORS du CRDT, hash
         dans le document) mais jamais implementee ; sans etat persiste,
         un vrai plugin oublie tout au reload. Marche la plus proche du
         muscle existant (setState/getState VST3 + le canal 2.3 assets).
      2. LA DECOUVERTE — FAITE 2026-08-24 (soiree, demande utilisateur) :
         --vst3-dir scanne (enumeration par l'enfant crash-isole,
         timeout 15 s), cache TSV par (chemin, taille, mtime), echec de
         scan memorise ; resolution uid->module auto (flags explicites
         gagnent) ; protocole PluginCatalog a l'auth ; menu + device =
         picker (91 classes/72 effets sur la tour, instruments filtres
         jusqu'au bus vague 3). RESTE de la mecanique 3 : moduleinfo.json
         (on passe toujours par l'enfant, plus lent au premier scan) et
         la blacklist au 2e crash d'INSTANTIATION (le registre compte
         deja les restarts).
      3. LE FENETRAGE EN DERNIER, avec mefiance — le plus visible, le
         moins prouvable (aucun test par echantillons ne verifie une
         fenetre), tentation d'options maximale (native/capturee/dockee =
         bifurcations). La verrue assumee du cadrage d'origine — fenetres
         OS flottantes — reste le bon premier choix : elle marche, elle
         est laide, elle n'hypotheque rien.
      Filtre pour chaque arbitrage : « nouveau module derriere un contrat
      existant, ou option qui dedouble un chemin ? » (regle module/switch,
      recue et verifiee sur le bypass de 2.4d).
      PREALABLE OBLIGATOIRE (ordre corrige a la cloture de 2.4) : LE TEST
      DES MAINS de l'utilisateur AVANT la session de re-cadrage — pas
      apres, pas en parallele. Ses notes brutes sont un INTRANT de
      l'arbitrage : ce que les mains trouvent (lenteur au toggle, bizarrerie
      a la relance, detail d'affichage) decide de l'ordre mieux que tout
      backlog. Mode d'emploi : docs/test-des-mains-2.4.md (stack + seed +
      la checklist de l'utilisateur impatient). La session 2.5 OUVRE sur
      ces notes.

- [ ] REFONTE UI (EN COURS, boucle outillage) : metaphore RATIFIEE
      2026-08-22 — timeline d'abord (docs/refonte-ui-preparation.md,
      section 1, intrant mains explicitement differe par decision
      utilisateur). Fait ce jour : contrat de selection (data-role/
      data-state + ARIA), jumeaux helpers/diag fusionnes, zero pixel
      change, suite e2e complete comme preuve. Reste : structure
      timeline (clips rendus, pistes vides compactes, tete de lecture),
      par petits lots dans la boucle snap/grille. GATE DE SORTIE : le
      test des mains. Les niveaux 1 constates a l'audit outillage (wrap dB,
      congestion Track 1) se dissolvent dans la refonte, pas de rapiecage.

- [x] Dette token global — FAIT 2026-08-22 (fichier par port
      daw-engine-token-<port> cote moteur, websocket_server.cpp:488,
      lecture assortie daw.ps1/ui-drive/ui-snap ; consigne dans
      AMELIORATIONS « Token par port », case restee ouverte par oubli,
      cochee a la session 1 post-AUDIT-4).

- [ ] ORGANE --capture (approuve 2026-08-22, session MOTEUR bornee, cadree
      a part) : le backend null gagne --capture <wav> pour que l'oreille
      ecoute le CHEMIN LIVE (ring, famine, dry/wet) et plus seulement le
      rendu offline. Discipline du pont obligatoire : ring de capture
      SPSC au contrat (static_assert lock-free + offsetof), le callback
      ne fait que deposer, l'ecriture fichier vit hors thread sacre,
      depassement = drop compte jamais d'attente. Test au signal connu.

- [ ] Backlog Magic Potion (chantier auto-ecoute, 2026-08-22) : renommage
      d'infrastructure (depot, binaires daw_*, packages) = churn differe ;
      formats compresses au drop (mp3/flac -> decode + PUT wav) ; analyse
      spectrale ; masquage inter-pistes ; suggestions IA (acteur Automerge).

- [ ] Backlog hors cap (fusion BACKLOG.md, 2026-08-23 — une seule liste
      d'idees desormais ; l'ancien preambule cadrait sur le cap VST3,
      tenu depuis le 2026-08-22) :
      - Moteur WASM : ecarte — direction Soundtrap/BandLab, l'inverse du
        differenciateur. Peut-etre un jour comme mode invite
        lecture/commentaire.
      - Sortir automerge-c du moteur (sidecar Rust) : decision
        d'architecture, pas une optimisation. Pas sans dossier complet.
      - Presence ephemere (curseurs, qui tient quel fader, transport
        partage) : tranche 3+, canal hors CRDT (meme logique que
        solo/mute).
      - IA comme acteur Automerge (actorId propre, mode suggestion) :
        tranche 3+ (recouvre l'entree du Backlog Magic Potion ci-dessus).
      - Undo par utilisateur : probleme dur du CRDT musical, a scoper tot
        mais pas maintenant (voir aussi roadmap item 7, les depassements).
      - Identites (actorId <-> compte) : prerequis presence/IA, tranche 3+.
      - Discord : integrer (Rich Presence, webhook), jamais construire.
        Tranche 3+.
      - VCV Rack en natif (note 2026-08-23, sans l'ouvrir) : open
        source, installable par tous -> terrain d'essai ideal pour le
        partage de chaine. APRES l'invariant, pas avant ; pour tester
        le differenciateur, un VST3 gratuit quelconque suffit.

- [ ] COHERENCE (audit 2026-08-22) — split-rule et jumeaux restants :
      a. [x] buildGraph : noyau partage (makeClipPlayer/makeGainNode dans
         graph/graph_common) FAIT 2026-08-22 ; instanciation plugins
         volontairement divergente (live/offline). Hash inchange 89f1a1.
      b. splitter main.cpp (1155), automerge_document.cpp (829),
         plugin_host_main.cpp (663), websocket_server.cpp (481),
         app/wiring.ts (432), ui-drive.mjs, track.ts (regle module) ;
      c. dette morte a exciser avec la session transport-owner :
         AudioCommand::UpdateGraph/SetGain + graph_ptr, TransportState
         loop_* atomics, CLI --solo/--mute-track (jumeau de SetMonitor),
         AutomergeDocument::generate/receiveSyncMessage (stubs) ;
      d. SCHEMA.md : engine schema.h utilise std::map pour params alors
         que SCHEMA dit LISTE {key,value} (ordre perdu) — aligner sur
         vector<pair> ou adoucir le doc ;
      e. npm scripts manquants (drive/signals/kit/seed), gitignore
         web/playwright-report/, messages.ts marque GENERE dans CLAUDE.md.
      FAIT ce jour : proto/engine.proto (jumeau divergent) supprime ;
      updateMeter + parseTime (exports morts) supprimes ; README verite
      (.am, SHA-256, make test, licence, triangle, VST3).
- [~] Moteur : morts silencieuses en run AUDIBLE (WASAPI). Historique :
      exit 9 observe deux fois ; puis NUIT DU 2026-08-24 : 3 crashes
      IDENTIQUES au journal Windows — 0xc0000409 (fail-fast) dans
      ucrtbase.dll, MEME offset 0xa527e, ~2 h de vie, uniquement en
      audible (le duo --mute n'a jamais crashe), zero trace dans nos
      logs (le fail-fast CRT court-circuite stderr). INSTRUMENTATION
      POSEE 2026-08-24 : util/crash_handler (terminate + SIGABRT +
      invalid-parameter + SEH -> crash-<pid>.log, raison + pile brute
      module+offset), installe en premiere ligne de main(). Prochaine
      occurrence = un log a lire au lieu d'un fantome.

## Court terme (sessions economes)

- [x] HYGIENE CI FAIT 2026-08-22 (S1, commits 74c61d1 + 5cc9089) :
      1. `paths-ignore: ['**.md']` sur push et pull_request, piege
         branches-protegees documente en commentaire yaml + message de
         commit. Preuve : push docs-only sans aucun run (constate a la
         cloture de S1).
      2. Cache du build tree SDK : `third_party/vst3sdk` + `engine/build`
         dans UNE archive (mtimes coherents pour ninja), cle = pin
         v3.8.1_build_84 + hash de `engine/cmake/vst3sdk.cmake` — bloc SDK
         EXTRAIT du CMakeLists expres : les editions engine (chaque session
         du chantier) n'evincent plus le cache. Runs froids reels : 11,6 et
         12 min (#50/#51) — pas 30-45. A CHAUD : 4,4 min (run #52, vert) —
         critere < ~5 min ATTEINT, cache automerge-c non necessaire.

- [x] Verifier le hash GCC en CI — FAIT via le premier run vert (le hash est
      asserte DANS daw_engine_test, qui passe sous Linux depuis run #48)
- [ ] Critere 5 sous charge CPU (procedure dans STATUS.md, temps machine)
- [ ] Critere 4 LNA Chrome (manuel, `--allow-origin` pret)
- [x] Persistance de l'outbox — FAIT 2026-08-22 : miroir localStorage par
      onglet + ADOPTION des files orphelines a la connexion (onglet ferme
      pendant la coupure -> rejoue par le suivant ; doublon CRDT = no-op,
      chaque course penche vers le doublon jamais la perte). Spec
      `outbox-persistence` : edit hors ligne dans un onglet FERME, serveur
      relance, nouvel onglet -> l'edit arrive, cles orphelines consommees.
      E2E 11/11.
- [x] Serveur : persister AVANT de diffuser — FAIT (voir 2.1 option B)
- [x] `solo`/`mute` en `std::atomic<bool>` — FAIT 2026-08-22 (R4+S4, teste)

## Candidats grille (constats de lecture 2026-08-22, arbitrage a l'audit 2)

- [ ] Transport a deux chemins d'ecriture : file de commandes (ring buffer)
      ET appels directs `getTransport().play()` depuis main.cpp. Un seul
      proprietaire a choisir. + Atomiques de loop "for future use" morts.
      + AUDIT-3 (A3-6) : le ring de commandes est SPSC mais les callbacks
      ixwebsocket poussent depuis UN THREAD PAR CONNEXION — deux onglets
      = deux producteurs concurrents, contrat viole. Meme session : un
      proprietaire, un producteur. + UpdateGraph/SetGain/graph_ptr morts
      dans AudioCommandMessage.
- [ ] ProcessorNode trop mince pour un hote VST3 (latence, bypass, etat,
      bus ; params string->float insuffisants ; contrat in-place non ecrit).
      A traiter DANS le chantier 2.4, pas avant.

## Moyen terme

- [x] Moteur : lire `chain` du document — FAIT 2026-08-22 (2.4c-2, M3 solde)
- [x] `assetHash` FNV → SHA-256 — FAIT 2026-08-22 (2.3a, vecteurs FIPS,
      jumeau create_test_doc soude en 2.3b)
- [x] Nettoyer `docs/DECISIONS.md` — FAIT 2026-08-22 (ADR-015 WSL marque
      obsolete, collision ADR-016 resolue par renumerotation en ADR-018)

## Stack (a evaluer, pas urgent)

- [ ] Evaluer `automerge-repo` cote serveur/web : sync + persistance + resync
      fournis, remplacerait le broadcast maison et l'anti-entropie cliente
- [ ] Risque automerge-c (epingle monorepo `47908d6c`, peu maintenu) :
      si blocage, envisager un sidecar Rust pour le CRDT du moteur
