# AUDIT-4.md

*Audit lecture seule — 2026-08-23, post-jalon 2.4 et post-corrections
critere 3 (A3-4/A3-5). Methode : trois passes paralleles (moteur C++,
serveur/sync/document, web UI + scripts + coherence documentaire), puis
critique de fond des .md eux-memes (demande expresse de la session).
Seul fichier cree : ce rapport (+ consignation TODO/STATUS, meme session,
sur decision explicite). Numerotation unifiee A4-x.*

*Verdict d'ensemble : le socle 2.4 tient ce qu'il annonce sur ses chemins
prouves (SHA-256 correct aux vecteurs FIPS, protobuf coherent, A3-4/A3-5
reellement implementes, contrat de selection migre, token par port fait).
Mais trois choses ne font pas sens : (1) la garantie fondatrice du
critere 3 a un trou structurel que les gardes recentes ne voient pas —
Automerge, des deux cotes, bufferise les changes a dependances manquantes
SANS erreur ; (2) le ring plugin a un defaut de SORTIE cousin des defauts
d'entree connus (slot perime rejoue sous surcharge, ni dry ni compte) ;
(3) le systeme documentaire a la maladie que le regime interdit au code :
des jumeaux sans proprietaire, qui divergent deja.*

---

## Sortie 1 — PREALABLES (la suite s'appuie directement dessus)

### A4-1. Le serveur avale les changes a dependances manquantes, puis les broadcast quand meme

- **Fichiers :** `server/src/document/file_store.rs:77-96`,
  `server/src/api/websocket.rs:184-207`.
- **Mecanisme :** `apply_change` recharge le doc et fait
  `load_incremental(change)` : en automerge-rs, un change dont les deps
  manquent est mis en file interne SANS erreur ; `save()` ne serialise
  pas cette file ; le doc est reecrit sans le change, `apply_change`
  retourne Ok, et websocket.rs, croyant « persiste », BROADCAST. Perte
  durable cote serveur + persist-avant-broadcast contourne de
  l'interieur. Declencheurs reels : persist anterieur echoue (`continue`
  l.191), save du doc par defaut echoue (A4-1c), Lagged=skip anterieur,
  scenario A4-3.
- **Remede :** apres `load_incremental`, verifier `get_missing_deps()`
  vide (ou heads avancees), sinon refus bruyant / fermeture.
- Annexe A4-1c : `websocket.rs:116-118` — echec du save du doc par
  defaut = log puis on continue avec un doc jamais persiste ; fermer la
  connexion a la place.

### A4-2. Le client ne voit pas ses dependances manquantes : la garde A3-5 ne couvre pas le cas principal

- **Fichiers :** `web/src/document/project.ts:70-79`,
  `web/src/app/wiring.ts:105-112`.
- **Mecanisme :** `Automerge.applyChanges` avec deps manquantes
  N'EXCEPTE PAS (bufferisation silencieuse) : `applyChange` retourne
  true, aucun resync. Or c'est exactement ce que produit le cap
  broadcast 256 / Lagged=skip. La couverture revendiquee (« le resync
  client couvre les trous de broadcast ») est illusoire : un skip =
  divergence silencieuse de l'onglet jusqu'a une reconnexion fortuite.
  Le retour false ne couvre que les bytes corrompus.
- **Remede :** apres apply, `Automerge.getMissingDeps(doc)` non vide ->
  `requestResync()`. Annexe : `mergeRemote` (project.ts:50-61) confond
  « echec » (catch -> false) et « rien de neuf » — distinguer, et
  resync sur erreur.

### A4-3. Tout ce qui est edite AVANT le premier document serveur est perdu, localement ET cote serveur

- **Fichiers :** `web/src/app/wiring.ts:59-64`,
  `web/src/document/project.ts:16-40`.
- **Mecanisme :** serveur indisponible au demarrage -> l'utilisateur
  edite le placeholder (`Automerge.from`, acteur local, change racine c0
  jamais envoye) ; l'outbox accumule c1..cn (deps -> c0). Au premier
  contact : `load(data)` REMPLACE le doc local (editions effacees), puis
  le flush envoie c1..cn que le serveur jette par A4-1 (dep c0
  manquante). Perte totale, silencieuse des deux cotes. Un simple merge
  ne suffit pas (listes `tracks` creees par deux acteurs = l'une
  disparait).
- **Remede :** seed deterministe du doc racine (commun a tous) ou
  edition bloquee avant le premier doc. Test de garde : demarrage
  serveur eteint, editer, demarrer le serveur, rien ne se perd.

### A4-4. Aucune detection de pair mort cote web : la lecon du socket zombie n'a ete appliquee qu'au moteur

- **Fichiers :** `engine/src/network/server_client.cpp:93` (le moteur a
  son ping 15 s) ; `server/src/api/websocket.rs` (aucun Ping serveur ->
  clients) ; JS ne peut pas emettre de ping WS.
- **Mecanisme :** socket a moitie ouverte (veille, coupure) -> l'onglet
  reste « connected » indefiniment, `sendChange` ecrit dans un buffer
  mort (readyState OPEN), pas d'outbox, pas de reconnexion, donc ni push
  A3-4 ni pull.
- **Remede :** ping periodique serveur->clients + timeout d'inactivite
  (le navigateur repond au ping automatiquement), ou heartbeat
  applicatif.

### A4-5. Ring plugin : un bloc saute par l'enfant fait REJOUER un slot perime au lieu du bypass dry

- **Fichiers :** `engine/src/host/proxy_node.cpp:60`,
  `engine/src/host/plugin_host_main.cpp:495-498`.
- **Mecanisme :** enfant en retard > kRingSlots-2 -> il saute les blocs
  anciens et publie `output_seq` pour les suivants. Cote moteur, le test
  `output_seq >= want` est GLOBAL, pas par slot : si l'enfant a saute le
  bloc `want` mais traite `want+1`, le moteur lit `out[want % 4]` — dont
  le contenu date du cycle precedent (bloc want-4). Un bloc wet vieux de
  4 blocs est rejoue, ni dry, ni compte dans blocks_missed — exactement
  la situation que le compteur devait couvrir. Le commentaire
  proxy_node.cpp:68 (« DRY bypass of the same block N-1 ») ne decrit
  plus le code.
- **Remede :** seq par slot de sortie (atomic), comparer
  `out_slot_seq[wslot] == want`. MEME SESSION que le contrat de periode
  (A3-1 + A3-2/A3-3) : meme segment, meme bump de layout. Y graver
  aussi l'invariant « input dechire sous surcharge » (A3-8.5, toujours
  en prose nulle part).

### A4-6. Registre sans eviction : un noeud vst3 supprime du document laisse un enfant zombie a 100 % d'un coeur

- **Fichiers :** `engine/src/graph/plugin_registry.h` (aucun remove),
  `engine/src/main.cpp` (buildGraph n'evince jamais),
  `engine/src/host/plugin_host_main.cpp:473-487`.
- **Mecanisme :** suppression du noeud -> rebuild sans ProxyNode, mais
  le handle et son enfant restent au registre pour toujours. L'enfant
  yield-spin en attendant un `input_seq` qui n'avancera plus jamais :
  100 % d'un coeur, indefiniment. `pollPluginChildren` le ressuscite en
  plus (3 fois) s'il meurt. 2.5 (« tes plugins ») multipliera les
  instances : a regler avant.
- **Remede :** apres chaque rebuild, stop() + eviction des handles dont
  le node_id n'est plus dans le snapshot.

### A4-7. Appels bloquants (10-120 s) dans la boucle de controle

- **Fichiers :** `engine/src/main.cpp:511-515` (fetch d'asset,
  connectTimeout 10 s / transferTimeout 120 s, DANS buildGraph, dans le
  tick de 10 ms) ; `plugin_bridge.cpp:213` + ensureVst3Child
  (waitChildReady 10 s au spawn ET au restart).
- **Mecanisme :** pendant un GET d'asset ou une ceremonie VST3, la
  boucle principale est gelee : plus de telemetrie (le navigateur voit
  l'engine mort), plus de poll des enfants, plus de drain des graphes
  retires, et `g_running` n'est pas relu -> Ctrl+C inoperant jusqu'a
  2 minutes. Aucun commentaire n'assume ce gel.
- **Remede :** deporter fetch + spawn/restart sur un thread de service,
  resultat depose au tick suivant.

## Sortie 2 — REFONTES PLANIFIEES (avant de s'y adosser)

### A4-8. La validation du document est inoperante, moteur ET web

- **Fichiers :** `engine/src/document/automerge_document.cpp:266-516`
  (unique `return true`, chaque champ absent/mal type remplace par un
  defaut silencieux) ; `engine/src/document/schema.cpp:8,30`
  (`migrateDocument`/`validateDocument` : ZERO appelant) ;
  `web/src/document/schema.ts:55-77` (idem cote web : jamais appeles,
  schemaVersion jamais verifie, le throw promis pour v>1 n'existe qu'en
  theorie).
- **Mecanisme :** un document schema v2 ou corrompu se charge sans un
  mot et joue un projet vide ou faux. Le format du document est une zone
  « jamais d'economie de verification » du regime : c'est la
  contradiction la plus directe avec les propres regles du projet.
- **Remede :** brancher migrate+validate dans loadFromBytes/applyChange
  (moteur) et au chargement (web), echec = refus bruyant.

### A4-9. Les deplacements de clips distants ne se redessinent JAMAIS dans l'autre onglet

- **Fichiers :** `web/src/app/render.ts:38-53` (`sameStructure` compare
  ids de pistes, NOMBRE de clips, nombre de devices — jamais la
  geometrie) ; `web/tests/e2e/clip-drag.spec.ts:25-31`.
- **Mecanisme :** un setClipStart/setClipBounds recu du serveur passe
  par le chemin « meme structure » qui ne met a jour que gains + device
  view : le document de l'onglet B converge, son DOM non (le clip reste
  a l'ancienne position jusqu'a un rebuild force). Le spec ne l'attrape
  pas : il ne lit que `getDocument()`, jamais la position DOM de B —
  son titre promet plus qu'il ne verifie. Contredit la raison n.1 ecrite
  de la metaphore timeline (« la convergence de clips entre onglets
  devient VISIBLE, donc testable »).
- **Remede :** geometrie des clips dans sameStructure (ou update
  in-place), et spec ancre sur le DOM de B. A prendre dans la boucle
  refonte UI en cours.

### A4-10. Le lissage de gain ne lisse rien sur le chemin reel : chaque fader = saut instantane

- **Fichiers :** `engine/src/graph/gain_node.cpp:10-15,30-37` ;
  `engine/src/main.cpp:592-594` ; grep : setGain/setParameter jamais
  appeles hors definition.
- **Mecanisme :** le one-pole anti-click n'agit que sur un noeud vivant
  — or le chemin reel (fader -> change doc -> rebuild) recree un
  GainNode dont `smoothed_gain_` demarre DIRECTEMENT a la nouvelle
  valeur ; le swap fait sauter le gain d'un echantillon a l'autre. Le
  click que le mecanisme devait empecher existe ; le mecanisme est du
  code mort de fait. Bonus : `smoothed_gain_` initialise avec la valeur
  NON clampee.
- **Remede :** transferer smoothed_gain_ de l'ancien noeud au nouveau au
  rebuild (meme moule que copyMonitorState), clamper l'init.

### A4-11. Ids fondes sur Date.now() : collisions inter-onglets, contrat UUID viole

- **Fichiers :** `web/src/app/wiring.ts:266,328,421`
  (`clip-<nom>-<Date.now()>`, `track-<Date.now()>`) ; SCHEMA.md exige
  « UUID v4, immuable » ; le serveur seed aussi « track-1 »
  (`websocket.rs:40`).
- **Mecanisme :** deux onglets qui posent dans la meme milliseconde =
  meme id ; delete/gestures/render ciblent par id -> suppression ou
  deplacement du MAUVAIS clip apres merge CRDT.
- **Remede :** `crypto.randomUUID()` ; c'est un contrat, verifier les
  trois etages consommateurs dans la meme session.

A3-6 (transport multi-producteur SPSC) et A3-7 (file_store quadratique)
restent ou l'arbitrage AUDIT-3 les a mis, verifies toujours ouverts.

## Sortie 3 — DETTES DATEES (declencheur mesurable, ou une ligne + test)

### A4-12. Rendu 32 bits : une crete clippee positive s'ecrit INT_MIN (claquement plein negatif)

- **Fichier :** `engine/src/render/offline_render.cpp:357`.
- `static_cast<int32_t>(sample * 2147483647.0f)` : la constante float
  s'arrondit a 2^31 ; pour sample==1.0 (clamp juste au-dessus), produit
  hors plage -> MSVC x64 rend 0x80000000 = INT_MIN. 16/24 bits sains.
- **Remede :** double + llround clampe (ou 2147483583.0f) + test au
  signal clippe 32 bits.

### A4-13. Chemin d'erreur d'initialize() : double ma_context_uninit (UB)

- **Fichier :** `engine/src/audio/audio_device.cpp:148-151,171-182`.
- Echec de ma_device_init -> uninit du contexte + state Error ; le
  destructeur repasse par shutdown() qui re-uninit device jamais
  initialise et contexte deja detruit. Candidat NON PROUVE pour la
  famille « exit 9 silencieux ». Remede : tracer ce qui a reellement
  ete initialise.

### A4-14. Menu moteur

1. `std::stoul`/`std::stoll` non proteges : `--ws-port abc` ->
   std::terminate (`main.cpp:159,165,173,195` ;
   `plugin_host_main.cpp:592,616`). Wrapper parseUint.
2. Sample rate / canaux des assets jamais confrontes au moteur : un
   44.1 kHz joue transpose ~9 % en silence, live COMME rendu (hash
   deterministe d'un rendu faux) ; >2 canaux = clip silencieux
   (`clip_player.cpp:28-62,131-149`). Refuser ou signaler.
3. Port WS pris -> retry infini a 100 Hz avec regeneration de token +
   reecriture fichier + spam stderr (`main.cpp:1033-1037`) ; le mode
   fichier, lui, tente UNE fois. Unifier.
4. `sendToAll` fait du TCP sous `connections_mutex_` (un client lent
   bloque auth/close des autres) ; en-tete websocket_server.h:9-10
   pretend « Handles Chrome LNA preflight » : aucun code HTTP n'existe
   (eclaire le critere 4 jamais teste).
5. Garde frame_count>65536 qui memset quand meme le buffer absurde
   (`audio_callback.cpp:43-48`) ; buffer_underruns uint64 tronque en
   uint32 (`audio_callback.cpp:172`).

### A4-15. Menu serveur/sync

1. PUT assets : tmp partage `<hash>.tmp` sans verrou — deux uploads
   concurrents peuvent renamer un fichier garble (`assets.rs:80-89`).
   Tmp unique (uuid) — reglerait la moitie O_EXCL de H3 pour les assets.
2. Rename sans fsync (`file_store.rs:45-49` + assets.rs meme moule) :
   coupure secteur peut publier un .am vide/tronque. sync_all avant
   rename.
3. Ids projets : noms reserves Windows acceptes (CON, NUL, COM1 ->
   `./projects/CON.am` touche le peripherique) (`websocket.rs:61-65`).
4. origin.rs:26-29 : le bras `[::1]` de l'allowlist est mort (le split
   coupe dans les brackets) — fail-closed donc sans danger, mais une
   page servie sur [::1] est bloquee et aucun test IPv6 n'existe.
5. Adoption d'outbox orphelines : deux fenetres de perte etroites
   (`server_client.ts:195-226`) — cle d'un onglet VIVANT adoptable
   entre getItem et removeItem ; suppression des cles meme si
   persistOutbox a echoue (quota avale). Heartbeat localStorage +
   suppression apres persist reussi.
6. Mineurs : disconnect() ne colle pas (reconnexion repart apres close
   volontaire, server_client.ts:116-127 et engine_client.ts:121-128) ;
   sampleRate fige 48000 dans engine_client.ts:37 ; outbox de projets
   jamais revisites s'accumulent sans expiration ; CORS (5173 seul)
   plus etroit qu'origin_allowed (benin, surprenant).

### A4-16. Scripts PowerShell

1. `start-stack.ps1:184-243` : Start-Stack est un JUMEAU POURRI de
   Start-Server — pas de poll de readiness (sleeps aveugles), $env:TEMP
   au lieu de GetTempPath(), et surtout `Start-Process "npm"` nu : le
   geste documente CASSE dans daw.ps1:77-78, jamais reporte ici. Regle
   jumeaux violee. Faire appeler Start-Server + copier le lancement
   cmd /c.
2. `daw.ps1 -Stop` tue le cmd.exe mais pas son arbre : vite survit,
   port 5173 occupe au run suivant — contredit « aucune tache ne survit
   a la session ». taskkill /T.
3. `start-stack.ps1:34` : defaut `fixtures\two-tracks.am` inexistant
   (le generateur produit two-tracks.JSON) — le mode file demarre sur
   une erreur.
4. `start_engine.ps1` racine : troisieme chemin de demarrage a
   l'abandon (chemins absolus en dur, logs a la racine, ni --assets ni
   token). Supprimer ou reduire a un alias.

### A4-17. Code mort nouveau (grep verifie, zero appelant)

`GraphBuilder::build` (`audio_graph.cpp:211-258` — dangereux si
ressuscite : perd les processors non-gain, n'appelle jamais prepare) ;
`ServerClient::sendChange`/`setConnectionCallback`/`reconnect_delay_ms`
(la sync moteur est de fait unidirectionnelle) ;
`RenderConfig::block_size` ; `protocol.Error` et `EngineState.cpu_percent`
jamais emis ; web : `setToken`/`setFromTokenFile`
(engine_client.ts:55-71, commentaire l.6 renvoie encore au token
GLOBAL), devDependency `protobufjs` non referencee, `void contentSeconds`
(wiring.ts:431). S'ajoute au stock connu (UpdateGraph/SetGain/graph_ptr,
loop_* atomics, generate/receiveSyncMessage).

### A4-18. Hygiene web

Deselection de clip sans re-rendu (aria-selected menteur, Delete
inoperant — `wiring.ts:281-292`) ; drags sans `pointercancel`
(`gestures.ts:94-95,191-192`) ; waveform : fetch concurrent du meme hash
-> canvas jamais dessine (`waveform.ts:32,103-117`) ; `ensureStatusEl`
fabrique un element DETACHE (filet qui ne retient rien, `life.ts:47-58`) ;
Map `tracks` de life.ts jamais purgee des pistes supprimees.

### A4-19. Discipline de test ecornee

`diag.spec.ts:47,54` : `expect(true).toBe(true)` + waitForTimeout — un
test qui ne peut pas echouer sur son assertion, et il MUTE le projet
`default` de la stack de dev (comme criterion3-convergence). 6
`waitForTimeout` non justifies (clip-drag x5, criterion3-push x1) alors
que CLAUDE.md l'interdit sans justification ecrite. Assertion reelle ou
suppression ; projets isoles partout.

## Sortie .md — la critique des documents (demande expresse)

### A4-20. Le defaut structurel : la regle des jumeaux ne s'applique pas aux documents

Chaque information importante a deux ou trois maisons, et elles
divergent deja :

1. **Les criteres** vivent dans CLAUDE.md ET STATUS.md, et divergent :
   « 20/20 » dans CLAUDE.md l.87, STATUS l.28 ET STATUS l.161, alors que
   le code a 21 tests (`cli_integration_test.cpp:1838-1859`) et que le
   recit de STATUS dit 21/21 soixante lignes plus bas. STATUS se
   contredit lui-meme. La liste « tests automatises » de CLAUDE.md date
   du critere 3 d'origine (3 specs) ; la suite en a 15.
2. **Les decisions** vivent dans DECISIONS.md racine ET
   docs/DECISIONS.md. README pointe l'un (ADR-008), STATUS l'autre. La
   racine est un journal fossilise : « Prochaines etapes » du 20-08 dont
   4/5 sont faites, diagnostics port 9000 abandonnes, `ninja -j8` que le
   regime de CLAUDE.md contredit (-j32).
3. **Le futur** vit dans trois listes : BACKLOG.md (preambule cadre sur
   un cap... TENU depuis le 22 — document mort-vivant), TODO « FUTURS
   NOMMES », TODO « Backlog Magic Potion ». L'« IA acteur Automerge »
   figure dans deux d'entre elles.
4. **Des ADR mentent** : ADR-005 dit websocketpp « Accepte » — le code
   entier est sous ixwebsocket (grep : 6 fichiers). L'en-tete de
   websocket_server.h pretend « Handles Chrome LNA preflight » : aucun
   code HTTP.
5. **README** (vitrine publique GPL) : Quick Start irreproductible
   (fixtures/two-tracks.am et long-project.am n'existent pas, le
   generateur ecrit du .json), dossier /proto supprime mais liste, CLI
   Reference qui omet tout le mode reel (--server, --project,
   --vst3-module, --mute, --ws-port...). Le script npm proto:gen est en
   cp/mv/rm POSIX sur un projet « Windows natif uniquement ».
6. **Procedures perimees** : STATUS l.321 et test-des-mains-2.4.md l.32
   disent encore « copier %TEMP%\daw-engine-token » — le fichier est
   `daw-engine-token-<port>` et contient du JSON. LE RUNBOOK DES MAINS
   (intrant obligatoire de 2.5) EST CASSE A SA PREMIERE ETAPE. STATUS
   l.281-283 diagnostique encore le port 9000 (abandonne le 20-08).
7. **TODO en retard sur le code** (sens inverse, plus rare) : la dette
   « token global » (TODO l.342-347) est SOLDEE dans le code
   (websocket_server.cpp:488, consignee dans AMELIORATIONS) mais reste
   [ ] ; 2.3bis jamais coche alors que l'audit a eu lieu et 2.4 est
   fait. COHERENCE item e : rien n'a bouge (scripts npm
   drive/signals/kit/seed toujours absents, messages.ts toujours pas
   marque GENERE dans CLAUDE.md).
8. **STATUS.md n'est plus un etat, c'est un journal** : en-tete
   « Audit: 2026-08-20 », puis onze blocs narratifs dates du 22. Sa
   fonction declaree est diluee — c'est exactement ce qui a produit ses
   contradictions internes.
9. **SECURITY.md** : la section « A FAIRE » est majoritairement du
   [FAIT], H3 y figure deux fois. Re-trier fait/reste.
10. refonte-ui-preparation.md renvoie a une capture gitignoree
    (web/snap/full-1536.png) — reference qui n'existe que sur cette
    machine.

**Proposition structurelle (A ARBITRER en session 1, pas decidee ici) :**
un proprietaire par information. CLAUDE.md ne duplique plus les criteres
(il renvoie a STATUS) ; STATUS scinde en ETAT court (criteres,
composants, procedures vivantes) + JOURNAL append-only ; DECISIONS
racine fusionne dans docs/DECISIONS.md (perime marque obsolete, comme
ADR-15) ; BACKLOG fusionne dans TODO ; ADR-005 corrige (ixwebsocket,
vraie raison) ; README passe une session verite.

## Verifie sain (pour eviter les faux proces)

SHA-256 correct (constantes/schedule/padding FIPS 180-4, vecteurs
testes) ; les deux .proto coherents entre eux et avec leurs
consommateurs, framing identique ; A3-4/A3-5 reellement implementes la
ou STATUS le dit (push symetrique wiring.ts:85-91, flush non destructif,
resync sur exception) — mais vides par le trio A4-1/A4-2/A4-3 sur les
scenarios qu'ils visaient ; contrat de selection reellement migre ;
token par port reellement fait (moteur + outils) ; STYLE.md respecte au
ms pres ; tous les docs references existent et disent ce que TODO
pretend ; hash 89f1a1105dc09e92 cite identiquement partout, f40af882
correctement marque obsolete ; rebuild_msvc.bat construit tests + host
(seul create_test_doc manque a la liste ninja).

## Etat des defauts connus

| Defaut | Etat |
|---|---|
| A3-1 (un slot param) | TOUJOURS OUVERT (touche AUSSI le rendu offline : determinisme faux en multi-params) |
| A3-2 (depth clampee en silence) | TOUJOURS OUVERT |
| A3-3 (bloc partiel = dry permanent) | TOUJOURS OUVERT |
| A3-4/A3-5 (critere 3) | CORRIGES comme annonces, mais vides par A4-1/A4-2/A4-3 sur leurs scenarios cibles |
| A3-6 (SPSC multi-producteurs + 2 chemins transport) | TOUJOURS OUVERT |
| A3-7 (file_store quadratique) | TOUJOURS OUVERT |
| A3-8.1 (commentaire anti-entropie) | CORRIGE |
| A3-8.2 (legacy sans log) | TOUJOURS OUVERT (le commentaire ment toujours) |
| A3-8.3 (casse du hash PUT) | TOUJOURS OUVERT |
| A3-8.4 (.shm orphelins) | TOUJOURS OUVERT |
| A3-8.5 (input dechire, invariant non ecrit) | TOUJOURS OUVERT — cousin A4-5 cote sortie |
| A3-8.6 (load acquire vs seq_cst) | TOUJOURS OUVERT |
| Code mort connu (UpdateGraph/SetGain, loop_*, stubs sync) | TOUJOURS PRESENT ; --solo/--mute-track DESORMAIS CABLES (plus du code mort) |
| Trou telemetrie blocks_missed | PARTIELLEMENT CORRIGE (diffuse pour UNE instance ; bilan de sortie toujours debug-proxy seulement) |
| exit 9 silencieux | TOUJOURS NON INSTRUMENTE (A4-13 = candidat non prouve, chemins d'erreur) |

---

## Ordre consigne (arbitrage utilisateur, 2026-08-23)

1. **PASSE « DOCUMENTS QUI DISENT VRAI »** — session courte, mecanique :
   corrections factuelles de A4-20 (21/21 x3, token par port x3, port
   9000, TODO token coche, 2.3bis coche, README fixtures//proto/CLI,
   ADR-005, en-tete websocket_server.h, runbook des mains). Les fusions
   structurelles (STATUS scinde, DECISIONS/BACKLOG fusionnes) = a
   arbitrer au sein de cette session, pas acquises.
2. **« CRITERE 3 VRAIMENT VRAI, ROUND 2 »** — A4-1 + A4-2 + A4-3 (+
   A4-4 heartbeat, mergeRemote, A4-1c), avec tests de garde : scenario
   Lagged reproduit, demarrage serveur eteint. STATUS repasse « valide
   avec reserve » en attendant.
3. **SESSION RING ELARGIE** — la session « contrat de periode » deja
   arbitree (A3-1 file param + A3-2/A3-3 refus bruyant) ABSORBE A4-5
   (seq par slot de sortie) et grave l'invariant input-dechire. Meme
   segment, meme bump de layout, une seule session.
4. **CYCLE DE VIE ENFANTS + BOUCLE DE CONTROLE** — A4-6 (eviction) +
   A4-7 (fetch/spawn hors boucle). Avant 2.5.
5. **CONVERGENCE VISIBLE DES CLIPS** — A4-9 dans la boucle refonte UI
   en cours, spec ancre sur le DOM de B.
6. **DETTES DATEES** — A4-8 et A4-10/A4-11 (refontes planifiees a caser
   des qu'un chantier s'y adosse), A4-12..A4-19 avec leurs declencheurs.

A3-6 attend toujours la session transport ; A3-7/A3-8 restent dates.
