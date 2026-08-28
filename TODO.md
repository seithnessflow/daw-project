# TODO — la file (une seule)

*Regles (CLAUDE.md §6) : l'ORDRE GRAVE ne bouge pas sans l'utilisateur ;
une demande hors ordre se NOMME avant d'etre executee. Ce fichier ne
contient que de l'OUVERT : un item fait est raconte dans JOURNAL.md puis
SUPPRIME d'ici. Historique integral des files precedentes (avec tous les
[x] et leurs recits) : docs/archive/TODO-integral-2026-08-27.md.
Reference des trouvailles : docs/audits/ (A3-x = AUDIT-3, A4-x = AUDIT-4,
A/B/C/D/E/F = AUDIT-5, §n = AUDIT-6).*

## 0. Point de synchro

- Verdict CI du push ring v10 (voir REPRISE.md) — a lever avant de coder.

## 1. ORDRE GRAVE (re-arbitre par l'utilisateur 2026-08-28 : « go » —
## la Vague 3 entree live passe DEVANT T4 Link Etage 2)

1. **Contrat de periode — reste** (A3-2 + A3-3) : le ring v10
   (kRingSlots=8, estampilles par slot A4-5, invariant input-dechire,
   clamp bruyant) est LIVRE 2026-08-28. Reste : refus de DEMARRER hors
   contrat (periode non multiple de 256 apres negociation, ou depth >
   kRingSlots-2) au lieu du WARNING + clamp ; puis la **file d'ordres
   GENERIQUE** (A3-1 : evenements `{type, id, value}` — param
   aujourd'hui, note/CC demain) pour que l'entree MIDI live s'y branche
   sans re-bump de layout. Menage au passage : `rebuild_msvc.bat` ne
   construit pas `create_test_doc` (les specs en dependent — un clean
   build les fait tomber, vu 2026-08-28).
2. **VAGUE 3 — MIDI + instruments AVEC l'entree LIVE dedans** (sequence
   ratifiee 2026-08-27, docs/REVUE-EXTERNE-2026-08-27.md ; passee devant
   T4 le 2026-08-28 : le spike a montre que la grille inter-machines sert
   un usage qui n'existe pas encore, l'entree live fait le DAW).
   PREMIER MAILLON, le plus bete et le plus prouvable : **MIDI-in moteur
   (clavier USB sur la tour) -> file d'ordres -> instrument de tete de
   chaine -> note entendue, latence mesuree en exclusif 256 (< 20 ms
   vise)**. Pas de Web MIDI, pas de CC64, pas de piano-roll d'abord.
   Ensuite : Web MIDI ; CC64/pitch-bend/canal dans le ring (§5) ; notes
   en MAP a ids stables (ecart SCHEMA-V2 §4 vs la LISTE implementee —
   champ additif) ; velocite/longueur/deplacement des notes editables
   (§5) ; piano-roll musical ; ProcessContext rempli pour les VST3
   (tempo/position/play-state, §6). Le **test Massive** (clavier du
   portable -> synthe sur la tour) tombe EN DEMONSTRATION de fin de
   vague, dans la forme tranchee par le spike : MIDI LAN -> rendu tour
   en exclusif 256 -> enceintes de la piece ; le retour vers le portable
   est du monitoring differe, pas du jeu.
3. **Reliquat spike latence** : mesure LAN 2 machines (tour <-> portable
   TX15), dix minutes quand le portable est allume ; confirme le terme
   reseau (~1-5 ms attendu, ne change pas le verdict de
   docs/SPIKE-LATENCE.md). Ne bloque rien — se glisse ou il peut.
4. **T4 — Link Etage 2** (grille au quantum musical, rejoin aligne) :
   session dediee A PROPOSER (cadrage docs/LINK-DESIGN.md §3, le tempo
   existe desormais). Recule derriere la Vague 3.
5. **La performance au regime de preuve (suite du Lot P)** : compteur
   de churn des stems + fraicheur moyenne en edition simulee ; latence
   aller-retour en telemetrie permanente ; les declencheurs mesurables
   d'AUDIT-5 (load doc, gel de boucle, frame web, memoire cache).
6. **Ratifications en attente** (arbitrages proposes, rien n'entre en
   file sans l'utilisateur) : AUDIT-5 famille F « harmonisation »
   (session dediee : jumeaux, SPLITTER, code mort, commentaires faux) ;
   AUDIT-6 refontes planifiees — tranche EDITION D'ECHELLE
   (multi-selection + clipboard + selection de temps), tranche ENTREE
   (capture audio + comping), chaine MASTER + mute document,
   ProcessContext + etat controller.

## 2. Decisions ouvertes (l'utilisateur tranche ; pas de code avant)

- `daw.ps1` en `--exclusive --buffer-size 256` (16 ms mesures, 0 underrun
  sous charge) : une ligne, attend le GO.
- Chevauchement de clips au DRAG : somme (modele moteur actuel, pose en
  couche) ou remplacement a la Live (§4).
- Mute : dans le document (decision de mix) ou ephemere par client
  comme le solo (§7).
- ASIO : mesurer d'abord — l'exclusif suffit a 16 ms ; 8 ms exige le fix
  des chunks partiels (A6). Decision SDK/licence seulement si la mesure
  l'impose (§9).
- Placement (ADR-019 §2, SCHEMA v2) : le design n'a jamais ete fait —
  les stems marchent SANS (substitution par uid non resolu). Se concoit
  AVEC les lieux d'ecoute (ci-dessous) et l'arbitrage d'ecrivain (A3).
- LIEUX D'ECOUTE (consignation 2026-08-25) : seul / commun / chez un
  pair ; rien dans le document ; mode visible, contenu prive ; aller
  chez un pair se demande ; le retour ne casse rien. Trois questions a
  trancher avec le placement — brief integral : archive TODO, entree 2bis.
- Politique latence/synchro heterogene (docs/LINK-DESIGN.md §7) : aligner
  sur le plus lent / compensation locale / skew tolere borne — par mode
  et par lieu d'ecoute. Prealable technique : PDC live (A5).
- Auth : jusqu'ou le token partage suffit ; identites/invitations par
  projet a concevoir avec le critere 3 redefini (sans casser le
  local-first).
- Ligne strategique plateforme (macOS un jour ?) : une page, pas un
  chantier (revue externe 5a).
- Veille sync (2.1bis) : re-evaluer automerge-repo/samod a chaque debut
  de tranche (critere : avertissement « don't use anywhere serious »
  retire, release taguee, un projet reel en prod).
- Decouvrabilite d'un projet vierge : exposer le kit de demarrage hors
  `?lab=1` ? (decision produit).

## 3. Dettes datees (declencheur mesurable, source entre parentheses)

### Correctness du son (AUDIT-5 A — priorite absolue quand le declencheur sonne)
- **A3 arbitrage d'ecrivain des stems** : deux machines ayant le meme
  plugin (tags de version differents) republient un WAV en boucle.
  Gate a un proprietaire declare avant tout smoke a deux moteurs avec le
  meme plugin ; solution avec le placement.
- **A4-2 outbox moteur persistant + NACK serveur** (1a/1b faits : merge +
  push a la reconnexion) : survie au crash moteur.
- **A5 PDC live** : aucun alignement inter-pistes en live (la latence est
  declaree partout, appliquee seulement aux stems). Avant la Vague 3
  instrument (instrument a latence + piste seche).
- **A6 chunks partiels** : le contrat de periode est mesure/surveille ;
  le vrai fix (accumulateur amont, piste B) attend un declencheur :
  buffer 128 exclusif ou une periode non multiple de 256 observee.
  Dette liee : le wrap de BOUCLE cree un chunk partiel par tour (queue
  <= 255 frames en dry via plugins) — declencheur : plugin + region +
  oreille.
- **A7 resampling moteur** : contourne a l'import (transcodage
  navigateur au taux du projet, WARNING moteur sinon). Declencheur : un
  asset 44,1k pose hors du chemin web.
- Troncature f64 -> float dans la cle de stem (note dans stem_render).
- Conversion « Rendre musical » de masse des notes d'un clip MIDI
  absolu ; scission des clips musicaux (couture demi-tick).
- FLAC 24 bits perd 8 bits a l'import (16 bits assume).

### Stabilite (AUDIT-5 C)
- **C1** : rendu de stem, fetch d'asset et spawn/restart d'enfant encore
  SYNCHRONES dans la boucle de controle (l'export en est sorti, thread
  ouvrier). Declencheur : gel > 100 ms mesure (instrument = item 5 de
  l'ordre grave).
- **C2** watchdog du socket moteur cote navigateur (le serveur en a un).
- **C3** `AssetCache` sans eviction (> 500 Mo en session d'audition).
- **C4** budgets sans backoff : restarts plugin (3 vies), retry ICE
  infini sans TURN, ancres de transport sans age max.
- Bilan `blocks_missed` de sortie imprime pour le debug-proxy seul.

### Securite -> SECURITY.md (proprietaire)

### Sync / document
- A3-7 `file_store` : load + save du doc ENTIER par change, sous verrou
  global (quadratique). Declencheur : latence perceptible au drag
  multi-onglets, doc > quelques Mo.
- Compaction : declencheur > ~100 000 changes (`.am` > 5 Ko ou load web
  > 500 ms). Coalescing des drags cote client : optionnel.
- A4-9 : `sameStructure` (render.ts) compare des COMPTES, pas la
  geometrie — un deplacement distant de clip peut ne pas se redessiner.
  A re-verifier au prochain smoke 2 onglets avec drag.
- A4-11 : ids fondes sur `Date.now()` (`makeTrackDef`, clips) vs UUID
  exige par SCHEMA.md — collision inter-onglets possible.
- A4-8 : `validateDocument`/`migrateDocument` jamais appeles au
  chargement (moteur : `schema.cpp` mort ; web : idem) — un document
  corrompu se charge sans un mot.
- Un VIEUX projet (racine pre-graine) ne merge pas des editions faites
  hors-ligne avant premier contact (accepte, date).
- 937+ fichiers `server/projects/` sans GC (artefacts de pilotage).

### Moteur
- A3-6 transport multi-producteur sur un ring SPSC (un thread par
  connexion WS) + deux chemins d'ecriture (`getTransport().play()` en
  direct) : UN proprietaire, UN producteur. Meme session : code mort
  `UpdateGraph`/`SetGain`/`graph_ptr`, `loop_*` atomics, stubs
  `generate/receiveSyncMessage`, `GraphBuilder::build` (divergent).
- A4-12 rendu 32 bits : crete clippee positive -> INT_MIN.
- A4-13 double `ma_context_uninit` sur echec d'`initialize()`.
- A4-14 menu : `std::stoul` non protege (`--ws-port abc` = terminate) ;
  port pris = retry infini a 100 Hz ; garde frame_count > 65536 ;
  underruns uint64 tronques en uint32.
- Hote VST3 vu du plugin (§6) : `ProcessContext` jamais rempli (ordre
  grave 4) ; etat CONTROLLER non serialise (seul `IComponent::getState`
  voyage) ; un seul bus stereo (pas de multi-sorties ni sidechain de
  plugin) ; `outputParameterChanges` jamais lu ; params a offset 0 seul.
- Blacklist au 2e crash d'INSTANTIATION par class-uid ; scan
  `moduleinfo.json` (on passe toujours par l'enfant).
- Etat distant de plugin mis a jour EN VIE d'enfant (pas de restart
  auto) ; capture d'etat synchrone dans la boucle (famille C1).
- `.shm` orphelins dans TEMP apres crash moteur ; extension `.wav`
  cosmetique sur les blobs d'etat.
- Segment ring : commentaire `proxy_node.cpp` « DRY bypass of N-1 » a
  realigner sur le code v10.
- Morts silencieuses 0xc0000409 en run audible (~2 h) : instrumentees
  (crash handler), pas reproduites depuis.

### Web / UI
- GR meter du compresseur (§7) ; VU console sans spec au signal connu
  (regle CLAUDE.md §8 non honoree) ; meters crete seule, echelle
  lineaire.
- Piano-roll v1 : plage C3-C5 figee, un seul clip MIDI editable par
  piste, 16 pas (ordre grave 4).
- Session : slots MIDI seulement, longueur fixe, pas de modes de
  lancement ni de quantisation par slot ; tranche MASTER du mixer sans
  M/S ni pan ; un slot vide dit « 0 notes ».
- Verite des fenetres BOX en telemetrie (apres la croix, l'UI croit
  « ouvert » jusqu'au clic suivant).
- A4-18 hygiene : drags sans `pointercancel`, waveform fetch concurrent,
  Map `tracks` de life.ts jamais purgee.
- Marqueurs/locators nommes dans le document (§4) ; nudge clavier ;
  hauteur de piste ; ripple/insert time ; consolidate.
- Browser : recherche, favoris, navigation du systeme de fichiers (§11).
- Pan : loi lineaire unity-au-centre assumee (hash) ; commentaire
  `schema.h` « puissance egale » faux.

### Coherence du code (AUDIT-5 F — session « harmonisation », item 6)
- Jumeaux : `contentSeconds` x2, bloc starter x2, `NATIVE_PARAM_SPECS`
  x2, framing 4 octets x4, `256` en dur x4, chemin token re-derive x13,
  `ear.mjs` resout les assets autrement que le moteur (porte de securite
  audio !), deux `.proto` maintenus a la main.
- SPLITTER viole : `cli_integration_test.cpp` (>3000 L), `main.cpp`,
  `automerge_document.cpp` (`readDocument` ~330 L), `plugin_host_main.cpp`,
  `wiring.ts`, `ui/track.ts`.
- Code mort : `schema.cpp` moteur, `migrateDocument`/`createEmptyDocument`
  web non appeles, methodes token `EngineClient`, `RenderConfig::block_size`,
  `protocol.Error`, `EngineState.cpu_percent`.
- Commentaires faux verifies : `origin.rs:1-3`, `server_client.ts:322`,
  « for future use » sur du code vivant, test params documentant un
  seqlock retire.
- `?token=` legacy (query) encore lu par wiring.ts (M4, SECURITY.md).

### Donnees / produit
- Sauvegardes tournantes des `.am` (l'historique Automerge est la, rien
  ne l'expose ni ne le protege) (§10).
- `/api/projects` = middleware vite ; `list()/delete()` du store Rust sans
  route ; renommer/dupliquer/supprimer un projet n'existe pas (§10).
- Metadonnees projet (titre, dates, auteur) ; couleur de piste dans le
  schema (aujourd'hui hash de l'id).
- Undo per-acteur persistant navigable (depassement designe, roadmap 7).

### Outillage / ops
- ORGANE `--capture <wav>` sur le backend null (approuve 2026-08-22,
  jamais construit) : l'oreille sur le chemin LIVE.
- Horodatage UTC-ms dans les logs moteur ; le moteur ne loggue pas les
  connexions WS acceptees.
- sshd du portable en Manual (ne survit pas au reboot) ; lancement du
  tunnel = geste humain.
- A4-16 : `start-stack.ps1` jumeau degrade de `daw.ps1` (sleeps aveugles,
  defaut `two-tracks.am` inexistant) ; `-Stop` ne tue pas l'arbre vite.
- Menage `engine/build-msvc` : dossiers `*.stale` / `*.bundle-old` /
  `Release` historiques (inertes).
- CI : nightly Rust non epingle, Node 20 EOL -> Node 22 ; vendorer
  `automerge-c` en assurance (non publie, fetch par SHA) ; TURN
  self-host (NAT stricts).

## 4. Backlog (idees hors ordre, une ligne chacune)

- Tranche EXPORT/STEMS utilisateur : stems par piste post-fader,
  render-as-loop 2 passes, normalize/dither/metadonnees (designe,
  ABLETON-INTEGRALE §4).
- Freeze = cache de rendu prouvable par hash (depassement designe).
- Sends/retours/groupes + sidechain = resampling (routage a 3 prises,
  design CRDT acquis).
- Enregistrement audio + take lanes/comping (design acquis ; le chemin
  d'entree moteur est a concevoir).
- Import/export `.mid`.
- Presets de plugins / natifs ; exposedParams par instance (Configure
  mode, seuil 64 params).
- P2P complet (docs/P2P-ENGINES-DESIGN.md E1 doc, E2 store, E3 retrait
  du serveur) — proposer, ne pas construire.
- Presence ephemere (curseurs, qui tient quel fader), identites
  actorId <-> compte, IA comme acteur Automerge (mode suggestion),
  Discord (integrer, jamais construire).
- Paradigmes commutables par utilisateur ; UI entierement moddable par
  drag-and-drop (les splitters/onglets en sont la fondation).
- VCV Rack en natif comme terrain d'essai du partage de chaine (apres
  l'invariant).
- Follow Actions avec seed ; vue de jam collaborative sur etat de
  presence.
- Renommage d'infrastructure (depot, binaires `daw_*`, packages) :
  churn differe. Analyse spectrale, masquage inter-pistes.
- Interop Link LAN reelle (wire format Ableton) : declencheur = demande
  utilisateur.
- Moteur WASM : ECARTE (direction Soundtrap/BandLab) ; peut-etre un jour
  en mode invite lecture/commentaire.

REFUS ECRITS (ne pas re-litiger) : macros/racks (indirection non
arbitrable par CRDT), Max-for-Live-like (fichiers externes mutables),
alea sans seed, etat de performance Session dans le document, VST2,
monitoring d'instrument a latence de jeu via un VST distant (ADR-019 §4),
maitre de session ou role serveur dans le temps reel. Detail :
docs/ABLETON-INTEGRALE.md §5, docs/ADR-019-differenciateur-distribue.md.
