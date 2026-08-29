# TODO — la file (une seule)

*Regles (CLAUDE.md §6) : l'ORDRE GRAVE ne bouge pas sans l'utilisateur ;
une demande hors ordre se NOMME avant d'etre executee. Ce fichier ne
contient que de l'OUVERT : un item fait est raconte dans JOURNAL.md puis
SUPPRIME d'ici. Historique integral des files precedentes (avec tous les
[x] et leurs recits) : docs/archive/TODO-integral-2026-08-27.md.
Reference des trouvailles : docs/audits/ (A3-x = AUDIT-3, A4-x = AUDIT-4,
A/B/C/D/E/F = AUDIT-5, §n = AUDIT-6).*

## 0. Point de synchro

- Aucun verdict CI en vol (le fusible + spec autonome, 25fb9ae vert, run 33261252149, 2026-08-29).

## 1. ORDRE GRAVE (re-arbitre par l'utilisateur 2026-08-28 : « go » —
## la Vague 3 entree live passe DEVANT T4 Link Etage 2)

1. **VAGUE 3 — MIDI + instruments AVEC l'entree LIVE dedans** (sequence
   ratifiee 2026-08-27, docs/REVUE-EXTERNE-2026-08-27.md ; passee devant
   T4 le 2026-08-28 : le spike a montre que la grille inter-machines sert
   un usage qui n'existe pas encore, l'entree live fait le DAW). Le
   contrat de periode est CLOS (2026-08-28 : ring v10 + refus de demarrer
   hors contrat + FIFO MIDI generique v11 note/CC/pitch-bend, CC/PB
   traduits par l'enfant via IMidiMapping) : le rail est pose.
   PREMIER MAILLON (plan `.claude/plans/mellow-orbiting-aurora.md`) :
   **session A LIVREE 2026-08-28** — file SPSC -> callback (drain par
   sous-bloc) -> `AudioGraph::setLiveMidi` -> instrument de la piste
   cible, gate monitoring a l'arret, 4 tests, 59/59, specs 25/25.
   **Session B LIVREE 2026-08-28** : port WinMM + stub Linux, CLI
   `--list-midi-devices` / `--midi-in <nom>` / `--midi-track <id>`,
   contrats de log, outil `midi_send`, spec `midi-in.spec.ts`. PROUVE
   EN VRAI 2026-08-28 (port loopMIDI « MagicPotion » cree par le
   registre) : matrice DX10 / Dexed / Surge XT verte, CC64 + pitch-bend
   traduits via IMidiMapping (2080 assignations sur les JUCE), latence de
   file 0,3-17 ms, pipeline 10,7 ms en exclusif 256. RESTE du maillon 1 :
   (a) FAIT 2026-08-28 — MiniLab 3 a l'oreille de l'utilisateur
   (« c'est style en vrai » ; gresillement = enfant en retard a
   priorite normale, corrige par MMCSS Pro Audio : 1356 blocs rates ->
   0 ; « oui ! ») ; (b) FAIT — `daw.ps1 -MidiIn <nom> [-MidiTrack <id>]`
   (partage 512, jamais exclusif par defaut) ; (b') FAIT —
   `plugin_host --params <module> --uid <uid>` = la liste des parametres
   (la cle pour piloter un plugin par le document sans sa fenetre) ;
   (c) la dette TRANSITOIRE DX10 ci-dessous (§3 moteur).
   Ensuite : Web MIDI ; ~~preuve CC64/pitch-bend sur un vrai synthe~~
   FAIT (Dexed/Surge, IMidiMapping) ; ~~notes a ids stables~~ FAIT
   2026-08-28 (`NoteDef.id` additif + `updateNote(id, patch)` undoable,
   spec de concurrence 2 onglets ; la liste Automerge merge deja les
   insertions, l'id est l'ADRESSE des edits) ; ~~velocite/longueur/
   deplacement des notes editables dans le piano-roll~~ FAIT 2026-08-28
   (modele de SELECTION : clic = selectionner, lasso, glisser = deplacer
   le lot, bord droit = longueur, Alt+glisser / molette = velocite
   visible a l'intensite, Suppr, un geste = un undo, adresse occupee
   refusee et montree ; spec piano-roll-gestures) ; ~~selection
   multiple + lasso + Ctrl+D sur les CLIPS~~ FAIT 2026-08-28 (demande
   utilisateur « comme dans Ableton » : Shift/Ctrl+clic, lasso depuis le
   vide d'une lane = selection de TEMPS visible, glisser = deplacer le
   lot, Ctrl+D = dupliquer la plage silences compris — ou le bloc des
   clips sans plage —, Suppr = le lot, un geste = un undo ; spec
   clips-multiselect) ;
   piano-roll musical (nom des notes, zoom, plus d'une mesure) ;
   ~~ProcessContext~~ FAIT 2026-08-28 (ring v12, trace enfant :
   tempo 120 -> 93,5, playing 0 -> 1 ; reste l'oreille d'un LFO sync). Le **test Massive** (clavier du
   portable -> synthe sur la tour) tombe EN DEMONSTRATION de fin de
   vague, dans la forme tranchee par le spike : MIDI LAN -> rendu tour
   en exclusif 256 -> enceintes de la piece ; le retour vers le portable
   est du monitoring differe, pas du jeu.
2. **Reliquat spike latence** : mesure LAN 2 machines (tour <-> portable
   TX15), dix minutes quand le portable est allume ; confirme le terme
   reseau (~1-5 ms attendu, ne change pas le verdict de
   docs/SPIKE-LATENCE.md). Ne bloque rien — se glisse ou il peut.
3. **T4 — Link Etage 2** (grille au quantum musical, rejoin aligne) :
   session dediee A PROPOSER (cadrage docs/LINK-DESIGN.md §3, le tempo
   existe desormais). Recule derriere la Vague 3.
4. **La performance au regime de preuve (suite du Lot P)** : compteur
   de churn des stems + fraicheur moyenne en edition simulee ; latence
   aller-retour en telemetrie permanente ; les declencheurs mesurables
   d'AUDIT-5 (load doc, gel de boucle, frame web, memoire cache).
5. **Ratifications en attente** (arbitrages proposes, rien n'entre en
   file sans l'utilisateur) : AUDIT-5 famille F « harmonisation »
   (session dediee : jumeaux, SPLITTER, code mort, commentaires faux) ;
   AUDIT-6 refontes planifiees — tranche EDITION D'ECHELLE
   (multi-selection + clipboard + selection de temps), tranche ENTREE
   (capture audio + comping), chaine MASTER + mute document,
   ProcessContext + etat controller.

## 2. Decisions ouvertes (l'utilisateur tranche ; pas de code avant)

- `daw.ps1` en `--exclusive --buffer-size 256` : **NON par defaut**
  (utilisateur 2026-08-28 : « ca doit pas bloquer le lecteur video de
  Twitch » — l'exclusif prend le device). Le partage 512 (32 ms) reste
  la stack quotidienne ; l'exclusif = option explicite pour une session
  de jeu. A mesurer : exclusif 256 + MMCSS enfant (les ~50 % de blocs
  rates a profondeur 1 venaient-ils de la priorite seule ?).
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
- **A6 chunks partiels** : hors contrat = REFUS de demarrer (2026-08-28),
  donc l'exclusif 128 (8 ms) et le plancher partage 374 sont REFUSES
  aujourd'hui. Le vrai fix (accumulateur amont, piste B) attend un
  declencheur : un utilisateur qui veut 8 ms, ou un device sans periode
  multiple de 256 en partage.
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
- **Famille « reading '0' » (CI 2026-08-29, jamais vue avant)** : un doc
  serveur SANS `tracks` recu sur une connexion fraiche, dans 3 specs
  differentes (`seed-again.mjs:99` x3, `fader-to-engine:350` x2,
  `tab-guards` x1) sur deux runs Linux plus lents (4,8 min vs 3,2).
  Le seeder est garde (re-essaie), les specs non. A REPRODUIRE (server
  : que renvoie-t-il en premier message juste apres un change pousse ?)
  avant de corriger. Declencheur : le prochain run CI rouge sur cette
  famille.
- **ASSET ARRIVE TARD = CLIP MUET A VIE** (declencheur SONNE, CI Linux
  2026-08-29 x3) : `fetchAssetFromServer` retient un 404 pour toute la
  session (`failed_this_session`, dette datee de 2.3b) - un asset qui
  apparait au store APRES le premier rebuild n'est jamais rejoue tant
  que le moteur vit ; aucun refus visible dans l'UI. Vu avec le kit du
  starter (jamais seme en CI ; en local `daw.ps1` le seme). Fix : oublier
  l'echec quand le document change OU re-essayer avec backoff, et un
  badge « asset manquant » sur le clip. Grille 1 (casse) - PREALABLE
  avant tout smoke deux machines ou l'asset voyage.
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
- A4-14 menu : `std::stoul` non protege (`--ws-port abc` = terminate) ;
  port pris = retry infini a 100 Hz ; garde frame_count > 65536 ;
  underruns uint64 tronques en uint32.
- Hote VST3 vu du plugin (§6) : ~~`ProcessContext` jamais rempli~~ FAIT
  2026-08-28 (ring v12 : position/tempo/play, signature 4/4 fixe tant
  que le document ne la porte pas dans le ring — dette : timeSignature
  du doc -> ProcessContext ; preuve a l'oreille d'un LFO tempo-sync a
  faire) ; etat CONTROLLER non serialise (seul `IComponent::getState`
  voyage) ; un seul bus stereo (pas de multi-sorties ni sidechain de
  plugin) ; `outputParameterChanges` jamais lu ; params a offset 0 seul.
- Blacklist au 2e crash d'INSTANTIATION par class-uid ; scan
  `moduleinfo.json` (on passe toujours par l'enfant).
- Etat distant de plugin mis a jour EN VIE d'enfant (pas de restart
  auto) ; capture d'etat synchrone dans la boucle (famille C1).
- `.shm` orphelins dans TEMP apres crash moteur ; extension `.wav`
  cosmetique sur les blobs d'etat.
- Segment ring : commentaire `proxy_node.cpp` « DRY bypass of N-1 » a
  realigner sur le code v10 ; en-tete de `shared_audio_ring.h` dit encore
  « kRingSlots=4 covers depth<=2 ».
- CC/pitch-bend non declares par un plugin = ignores (loggues une fois) :
  pas de fallback « parametre devine ». Le chemin IMidiMapping n'est
  prouve par aucun test (AGain ne declare rien) — preuve au premier vrai
  synthe (Vague 3).
- **Profondeur 1 (exclusif 256) a re-mesurer avec MMCSS** : avant la
  priorite, ~50 % de blocs rates meme sans note ; le partage 512 + MMCSS
  donne 0. Si l'exclusif 256 + MMCSS rate encore, la politique de
  profondeur (ceil(period/256)) doit gagner un bloc de marge (+5,3 ms).
- ~~TRANSITOIRE MIDI live~~ FERME 2026-08-28 : c'etait un gel de 2 s de
  la boucle de controle a chaque PUT/GET d'asset (`localhost` -> `::1`
  d'abord dans ixwebsocket, serveur en 127.0.0.1) qui figeait la
  telemetrie — la note jouait, la mesure ne la voyait pas. Fix
  `util/net_loopback.h`. Instruments gardes : `control-loop stall`,
  `state-capture timing`, note-on/skip/torn cote child.
- **C1 (reste)** : HTTP toujours sur le thread de controle (~90 ms par
  PUT local mesure, des secondes a travers un tunnel), fetch d'asset et
  spawn idem. Le stall log le rend VISIBLE ; le fix = thread de service
  (export_job en est le moule).
- Fusible de sortie (livre 2026-08-29, DECISIONS) — reliquats : le VU
  master lit la crete AVANT le fusible (getMasterPeaks) ; plafond
  reglable depuis l'UI (CLI seulement aujourd'hui). Declencheur : un
  utilisateur qui veut voir la crete DAC ou changer le plafond sans
  relancer.
- MIDI live (session A) : placement sample-exact des evenements par
  timestamp (v1 = offset 0, gigue <= un sous-bloc de 5,3 ms) ;
  changement de piste cible a travers un rebuild sans all-notes-off (le
  nouveau graphe ne connait pas l'ancien instrument) ; sysex non livre
  (pas de `midiInPrepareHeader`) ; canal du fil conserve jusqu'au ring
  (a verifier sur un synthe multi-timbral) ; telemetrie EngineState
  `midi_in_*` (champs 11-13) et commande `SetMidiTarget` (tag 16) =
  apres la session B.
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
