*Statut (2026-08-28) : ARCHIVE — rapport d'audit 3, lecture seule, date. Ses reliquats ouverts sont traces dans TODO.md (dettes datees) ; les items soldes dans JOURNAL.md. Index : docs/README.md.*

# AUDIT-3.md

*Audit lecture seule — 2026-08-22, post-jalon 2.4 (HEAD `a511e54`). Question
directrice : qu'est-ce qui va ceder quand 2.5 (etat des plugins, vrais
plugins, autres machines/devices) va s'appuyer sur le socle 2.4 ? Lecture
complete des zones porteuses : ring partage, ProxyNode, callback, bridge,
enfant VST3, device/retirement, serveur Rust, client web, schema. Seul
fichier cree : ce rapport (+ consignation TODO/STATUS/runbook, meme session,
sur decision explicite).*

*Verdict d'ensemble : plus de use-after-free ni d'auth factice — les
trouvailles de cet audit sont des CONTRATS NON VERIFIES AUX FRONTIERES et
des PROMESSES DE DOCUMENTS EN AVANCE SUR LE CODE. Erreurs de croissance,
pas de jeunesse. La lecon appliquee partout ci-dessous : une regle qui vit
en prose meurt ; elle devient un refus bruyant ou une assertion.*

---

## Sortie 1 — PREALABLES (2.5 s'appuie directement dessus)

### A3-1. Le canal param perd des parametres des qu'il y en a deux

- **Fichiers :** `engine/src/host/shared_audio_ring.h:75-77` (UN slot
  `{param_id, param_value}`), `engine/src/main.cpp:620-627` (buildGraph
  renvoie TOUS les params du document en boucle serree a chaque rebuild),
  `engine/src/host/plugin_host_main.cpp:506-527` (l'enfant ne lit que le
  dernier publie, un param max par bloc).
- **Mecanisme :** deux `setParam` successifs s'ecrasent. Avec AGain
  (1 param), invisible. Avec le premier vrai plugin (n params), chaque
  rebuild n'applique que le DERNIER param de la map et jette les autres.
  Le seqlock de c-2 a durci l'APPARIEMENT (id/valeur), pas la PERTE — la
  note du TODO (« a durcir avant d'y faire passer plusieurs params »)
  n'etait qu'a moitie soldee.
- **Remede :** petite file SPSC de paires {id, value} dans le segment —
  le moule de `CommandRingBuffer` existe deja. Session courte, AVANT
  « l'etat des plugins d'abord ».

### A3-2. La profondeur du pipeline est clampee en silence a 2

- **Fichiers :** `engine/src/main.cpp:754-755` (politique
  `depth = buffer/256`), `engine/src/host/proxy_node.h:57` (clamp
  silencieux a `kRingSlots - 2 = 2`), `engine/src/host/shared_audio_ring.h:49`
  (`kRingSlots = 4`).
- **Mecanisme :** buffer device 1024 → depth demandee 4, servie 2 → la
  course MESUREE le 2026-08-22 (534/1875 blocs secs en depth insuffisante)
  revient telle quelle sur tout device a periode >= 768. Le TODO promet
  noir sur blanc « buffer 1024 → 4 blocs → 1024 ech. » : le layout ne
  tient pas cette promesse, et le clamp ne le dit a personne. Phrase
  fausse dans les documents, meme famille que les 47 runs — attrapee par
  un audit avant qu'un utilisateur ne la vive.
- **Remede :** `kRingSlots = 8` + clamp BRUYANT (ou refus de demarrer si
  depth demandee > supportee). Voir A3-3 : meme session.

### A3-3. Bloc partiel = bypass permanent du plugin

- **Fichiers :** `engine/src/host/proxy_node.cpp:13` (branche « misuse » :
  `frame_count != 256` → dry + compteur), `engine/src/audio/audio_callback.cpp:91-107`
  (decoupe en tranches de 256, le reliquat passe tel quel),
  `engine/src/audio/audio_device.cpp:156` (`actual_buffer_size_` prouve que
  le device negocie ce qu'il veut).
- **Mecanisme :** une periode device non multiple de 256 (480 frames =
  10 ms @ 48 kHz, courant en WASAPI) → le dernier chunk de CHAQUE callback
  fait < 256 → dry compte, a chaque callback, pour toujours. Plugin
  partiellement muet en permanence sur du materiel ordinaire. Rien ne
  verifie ni ne signale ce cas.
- **Cause commune avec A3-2 :** le contrat « 256 frames, depth <= 2 »
  n'est verifie a AUCUNE frontiere. Le device negocie, le code degrade en
  silence. Remede commun : une verification bruyante a l'initialisation
  (periode multiple de 256 ET depth supportee, sinon refus explicite avec
  message), + le test des mains etendu (variation de buffer dans le
  panneau ZenGo — consigne dans `docs/test-des-mains-2.4.md`).

## Sortie 1 (promu par arbitrage) — critere 3 vrai

### A3-4. La garantie « aucune perte silencieuse » du critere 3 a un trou

- **Fichiers :** `web/src/network/server_client.ts:151-154` (`flushOutbox`
  retire de la file AVANT de savoir si l'envoi part ; `WebSocket.send()`
  hors etat OPEN jette en silence, plus le buffer TCP),
  `web/src/main.ts:73-93` (a la reconnexion, `mergeRemote` TIRE le doc
  serveur ; la nouveaute LOCALE n'est JAMAIS poussee — les cycles resync
  ne font que re-tirer).
- **Mecanisme :** socket qui meurt pendant un flush → changes perdus de
  l'outbox, presents dans le doc local, jamais re-emis. La reconciliation
  offline est a moitie inexistante : le spec offline passe parce qu'il
  exerce le chemin outbox-vivante, pas le chemin socket-mort-pendant-flush.
  C'est une phrase fausse de plus (« critere 3 VALIDE » sans reserve) et
  elle touche la promesse fondatrice du produit. ARBITRAGE 2026-08-22 :
  promu en session rangee juste apres le contrat de periode, pas en
  refonte qui attend.
- **Remede :** push symetrique apres merge —
  `Automerge.getChanges(remote, local)` → envoi. Test de garde : tuer le
  serveur PENDANT un flush.

### A3-5. Un applyChange qui echoue diverge en silence

- **Fichiers :** `web/src/document/project.ts:66-73` (catch + log, sans
  `requestResync()`), `server/src/api/websocket.rs:120-124` (canal
  broadcast cap 256, `Lagged` = skip silencieux — les trous sont reels
  sous rafale).
- **Remede :** une ligne — `requestResync()` sur echec d'apply. Meme
  session que A3-4.

## Sortie 2 — REFONTE PLANIFIEE (avant de s'y adosser)

### A3-6. Le transport est multi-producteur sur un ring SPSC

- **Fichiers :** `engine/src/audio/ring_buffer.h:12-13` (contrat : UN seul
  thread pousse), `engine/src/websocket/websocket_server.cpp:244-257`
  (les commandes partent des callbacks ixwebsocket — un thread PAR
  connexion : deux onglets = deux producteurs concurrents).
- **A regler AVEC** le candidat grille deja consigne « transport a deux
  chemins d'ecriture » (main.cpp appelle aussi `getTransport().play()` en
  direct) : UN proprietaire du transport, UN producteur du ring. Au
  passage : `UpdateGraph`/`SetGain`/`graph_ptr` dans `AudioCommandMessage`
  sont morts (`ring_buffer.h:164-177`).

## Sortie 3 — dettes datees (declencheur mesurable)

### A3-7. Serveur : chaque change = load + save complets du doc, sous verrou global

- **Fichier :** `server/src/document/file_store.rs:67-86`.
- O(taille doc) par tick de drag, quadratique sur la vie du document.
- **Declencheur :** latence perceptible au drag multi-onglets, ou doc de
  plusieurs Mo. Argument de plus pour 2.1bis (le sync maison est deja
  condamne a terme — on ne structure pas ce code, regle 2.1).

### A3-8. Menu (hygiene, a solder d'un geste quand on passe a cote)

1. `web/src/network/server_client.ts:233-238` : le commentaire
   anti-entropie pretend encore que le serveur diffuse AVANT de persister
   — faux depuis le fix du 2026-08-21. Docs/reel.
2. `engine/src/main.cpp:521-524` : `fetchAssetFromServer` accepte les cles
   legacy (non-64) sans verification NI le log promis par son propre
   commentaire.
3. `server/src/api/assets.rs:58-59` : PUT compare le hash en lowercase
   mais stocke sous la casse fournie → meme contenu stockable sous deux
   noms sur FS sensible a la casse (CI Linux).
4. `engine/src/host/plugin_bridge.cpp:32-53` : segments `.shm` orphelins
   jamais nettoyes dans TEMP apres un crash moteur.
5. Contrat du ring, a graver dans `shared_audio_ring.h` : sous surcharge
   (enfant bloque > kRingSlots blocs dans `process()`), l'enfant peut lire
   un input DECHIRE (slot reecrit pendant la lecture zero-copy). Inoffensif
   aujourd'hui — la sortie correspondante est jetee par le check
   `output_seq >= want` — mais c'est un invariant implicite, pas ecrit.
6. Durcissement gratuit : le load du pointeur de graphe dans le callback
   (`audio_callback.cpp:71`) est acquire face a un swap seq_cst — un load
   seq_cst fermerait formellement le raisonnement (gratuit sur x86).

---

## Ordre consigne (arbitrage utilisateur, 2026-08-22)

1. **LE TEST DES MAINS** — inchange en preambule, PLUS la mission ajoutee
   par cet audit : varier la taille de buffer dans le panneau ZenGo
   (256, puis 1024 ou une valeur non standard si le driver le permet).
   Trois minutes de plus, et les frontieres accusees par A3-2/A3-3 sont
   exercees avec un diagnostic deja ecrit si ca casse.
2. **A3-1** — file SPSC de params (prealable direct de 2.5-etat).
3. **A3-2 + A3-3** — session « contrat de periode » : refus bruyant,
   kRingSlots=8, verification a l'initialisation.
4. **A3-4 + A3-5** — session « critere 3 vrai » : push anti-entropie +
   resync sur echec d'apply, avec leurs tests de garde.
5. **2.5 re-cadrage** — s'ouvre sur les notes des mains, socle assaini.

A3-6 attend la session transport (candidat grille existant). A3-7/A3-8
restent dates avec leurs declencheurs.
