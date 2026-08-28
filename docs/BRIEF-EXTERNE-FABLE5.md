# MAGIC POTION — brief pour analyse externe

*Statut (2026-08-28) : REFERENCE datee — instantane du 2026-08-27 MIDI
(avant la migration tempo du soir : « le temps musical n'existe pas » y
est donc PERIME, comme les compteurs de tests). Reste la meilleure vue
d'ensemble du produit en une lecture ; l'etat courant est dans STATUS.md.*

*Rédigé le 2026-08-27 pour une session Fable 5 externe, sans accès au
dépôt. Tout état annoncé ici est VÉRIFIÉ (suites de tests, CI, sondes
pilotées) à la date d'écriture. Auteur du brief : la session Claude qui
développe le projet avec son propriétaire.*

---

## 1. Le produit en une page

**Magic Potion** est un DAW (station audio numérique) collaboratif :
l'interface vit dans le navigateur, l'audio temps réel dans un moteur
natif local, et plusieurs personnes éditent LE MÊME projet en temps
réel depuis des machines différentes, chacune avec son propre moteur.

**L'invariant produit, le différenciateur (ADR-019) :** *un pair qui
n'a PAS un plugin installé entend quand même le résultat de ce
plugin.* Mécanisme : la machine qui possède le plugin rend des « stems »
(WAV du nœud + son amont, clé de cache = hash de toutes les entrées)
publiés dans un store adressé par contenu ; le pair sans plugin joue le
stem à la place du nœud irrésolu, avec badge de fraîcheur 3 états
(frais / périmé / inconnu — il ne ment jamais par omission). Prouvé
octet-pour-octet entre deux machines/réseaux réels, y compris sur de
vrais plugins du commerce (Valhalla, RoughRider).

Deuxième pilier : **jam en P2P** — l'audio inter-pairs voyage en
WebRTC direct (STUN, deux NAT traversés en vrai), le serveur ne fait
que du signaling. Loi écrite : **aucun audio n'est traité côté
serveur.**

Positionnement : ni un clone d'Ableton ni un DAW cloud qui rend sur
serveur — un DAW *local-first* multi-moteurs synchronisé par CRDT, qui
vise à terme des « paradigmes commutables » (offrir les solutions des
grands DAW comme options par utilisateur, UI moddable).

## 2. La stack technique

```
Browser (TypeScript)          Server (Rust)            Engine (C++17, MSVC)
  UI, document CRDT   <—WS—>  sync Automerge    <—HTTP—>  assets (store)
  (Automerge 2.2.9)           (crate 0.11.0)
        |                                                      ^
        +———————————— WS local (protobuf) ————————————————————+
                      transport, télémétrie 30 Hz, commandes
```

- **Web** : TypeScript sans framework, Vite, modules par responsabilité
  (règle « splitter au maximum »), CSS par zones. Document Automerge =
  source de vérité ; chaque geste local = un change CRDT poussé au
  serveur ; undo = journal d'opérations INVERSES rejouées comme
  nouveaux changes (collab-safe : on ne rembobine jamais les heads,
  le travail des pairs survit toujours).
- **Server** (Rust, axum) : volontairement bête — persiste le doc
  (fichier .am par projet, écriture atomique), refuse les changes à
  dépendances manquantes, relaie un canal de signaling éphémère
  (préfixe `signal:`, jamais parsé), sert le store d'assets adressé
  SHA-256 (vérifié au PUT). Auth opt-in par token partagé (Bearer +
  premier message WS, comparaison temps constant).
- **Engine** (C++, Windows natif MSVC ; GCC seulement en CI Linux) :
  miniaudio/WASAPI, callback audio SACRÉ (zéro alloc/verrou/syscall,
  static_asserts), blocs internes fixes de 256 frames, graphe = pistes
  linéaires (clips → chaîne d'effets → gain → pan) sommées vers un
  master. Transport en atomics lock-free. Télémétrie 30 Hz (position,
  crêtes par piste ET par device, état des slots Session).
- **Hosting VST3 — le savoir-faire central** : chaque plugin vit dans
  un PROCESSUS ENFANT (`plugin_host.exe`) relié par un ring mémoire
  partagée binaire (layout v9, 19 asserts d'offsets) : crash du plugin
  = cold-restart budgété, jamais la mort du moteur. Fenêtres GUI
  natives à la demande (TOPMOST). Pipeline async en live (jamais l'audio
  n'attend un plugin) ; échange synchrone bit-exact en rendu offline.
  MIDI note-on/off sample-accurate vers l'instrument de tête de chaîne.
- **Rendu déterministe** : le même document rend les MÊMES octets
  (hash de référence en CI sur deux OS ; pré-roll de 8192 frames pour
  canoniser l'état des plugins). Outillage : `ear` (porte de sécurité
  audio : rendu offline + verdict crête/clip/discontinuités AVANT toute
  écoute humaine) et `--probe` (peak/RMS/hash ENTRE chaque maillon —
  dit QUEL étage a changé l'audio).
- **Protocole navigateur↔moteur** : protobuf length-prefixed sur WS
  127.0.0.1, token par fichier %TEMP% (zero-paste), origins filtrés.
  Deux fichiers .proto JUMEAUX (web + engine) maintenus identiques.

## 3. Les lois d'architecture (à connaître pour analyser)

1. **ADR-019** : aucun audio traité serveur ; P2P entre pairs ; le
   serveur = signaling + store. L'invariant stems prime sur tout ; la
   roadmap « parité Ableton » est GELÉE tant que ses jalons ne sont pas
   verts (ils le sont presque tous désormais).
2. **ADR-003 — temps en samples** : TOUTE position du document est un
   int64 en samples. Pas de secondes flottantes, pas de beats. La
   migration tempo (re-exprimer les positions en musical) est « LA
   migration » planifiée, design déjà écrit (LWW-register façon
   Ableton Link, time signatures = liste d'événements).
3. **Le document est la vérité, le graphe une projection** : le moteur
   reconstruit son graphe à chaque version du doc (builder sur le
   thread de contrôle, dernier état gagne, swap atomique, retrait des
   graphes retirés protégé par génération).
4. **Blobs hors CRDT** : gros contenus (WAV, états de plugins, stems)
   vivent au store par hash ; le document ne porte que des références.
5. **Écrivain unique par information** : le navigateur possède le
   document, SAUF stemHash/stateHash (seul le moteur qui héberge le
   plugin peut les produire). Reconnexion = MERGE (jamais replace) +
   push des changes manquants.
6. **Tout aléa entre dans le document avec sa seed** (le rendu
   reproductible ne doit jamais mentir).
7. **Refus écrits** : macros/racks (indirection non arbitrable par
   CRDT), Max-for-Live-like (fichiers externes mutables), état de
   performance Session dans le document (éphémère par utilisateur,
   vivra en presence).

## 4. L'avancement — état vérifié (2026-08-27)

**Critères historiques :** rendu déterministe ✅ (hash 2 OS) ; CLI sans
navigateur ✅ ; convergence 2 onglets ✅ (2 machines : sous-parties
prouvées, le critère complet redéfini reste à re-dérouler) ; accès
moteur local depuis HTTPS public (Chrome LNA) ✅ prouvé sur vrai
Chrome ; 10 min WASAPI sans underrun ⚠️ (validé sans charge CPU) ;
invariant stems ✅ deux machines, vrais plugins.

**Capacités utilisateur livrées (tout testé e2e, la plupart pilotées
en vrai navigateur) :** arrangement (move/trim/split de clips, fades à
poignées, duplication, renommage partout, drag entre pistes, réordre
pistes/devices, undo par geste), **boucle utilisateur** (drag sur la
règle), marqueur d'insertion, zoom/minimap/follow ; **pistes typées
audio/MIDI** (bouton + du coin, badges, gardes de gestes à refus
visible) ; piano-roll grille 16 pas (v1) joué par de VRAIS synthés
VST3 (Dexed prouvé) ; vue Session (scènes, launch QUANTISÉ avec vérité
moteur des slots) ; console Mixage (faders, pan, M/S local, VU avec
ballistique) ; automation gain/pan/master dessinée à la souris et
évaluée par le moteur (miroir C++/TS prouvé au bit) ; navigateur de
contenu (catalogue VST3 scanné : 91 classes réelles, drag & drop
complet, pré-écoute des samples) ; **import universel** (drop
mp3/flac/ogg → décodage navigateur AU TAUX DU PROJET → WAV canonique
au store) ; **export mixdown** en un clic (rendu offline moteur →
téléchargement) ; **le moteur suit l'onglet** (bascule de projet à la
demande — fini le moteur verrouillé sur un projet) ; gardes d'onglet
(version du site → reload auto ; désaccord de projet → bandeau + refus
de PLAY/export) ; effets natifs : Utility, EQ3, compresseur, drive
(oversamplé), delay (gain/pan par preuves exactes) ; 5 natifs + VST3
mélangés librement.

**Qualité** : 83 specs e2e Playwright (moteur réel spawné pour les
chemins critiques), 45 gtests moteur (beaucoup d'exactitude au bit),
9 tests Rust, CI GitHub Actions 2 jobs (build Linux + e2e), verte.
Discipline écrite : un test ne se modifie jamais pour passer ; toute
modification de test est signalée avec justification.

**Méthode singulière (à connaître pour comprendre l'historique)** :
« vérification pilotée de bout en bout » — la session de dev pilote de
VRAIS navigateurs/machines (Playwright + extension Chrome + ssh) et ne
demande jamais à l'humain de tester ce qu'elle peut voir ; « rituel du
compositeur » — composer un morceau par l'UI seule à chaque session
qui touche le socle (c'est ce rituel qui a révélé les vrais défauts de
conception, invisibles des 83 specs) ; audits périodiques en lecture
seule avec arbitrage par grille (1 casse / 2 ergonomie : corriger ;
3 concept : proposer ; 4 goût : ne pas trancher).

## 5. Choix assumés (et leurs contreparties)

- **Automerge partout** (web/server/engine en 3 bindings alignés) :
  merge sans conflit, offline-first ; contrepartie : croissance du doc
  sans compaction (seuil surveillé), automerge-c non publié (vendoring
  prévu en assurance).
- **Pan linéaire unity-au-centre** (pas equal-power) pour préserver le
  hash déterministe ; documenté, dette datée.
- **Import transcodé en WAV PCM 16 bits** (les sources compressées
  sont déjà lossy ; un FLAC 24 bits perd 8 bits — dette datée).
- **Solo/mute éphémères par client** (jamais dans le doc) : parfait
  pour le solo d'écoute collaboratif ; QUESTION OUVERTE pour le mute
  (dans tous les DAW c'est une décision de mix persistée).
- **Chevauchement de clips = somme** (pas de remplacement à la Live) :
  assumé pour l'instant, la pose « en couche » s'y adosse ; le
  comportement au DRAG reste une question ouverte.
- **Session : quantum = longueur du premier slot lancé** (pas de
  mesure musicale — il n'y a pas de tempo) : honnête en attendant la
  migration tempo.
- **Un seul type de piste historique** (les pistes typées sont
  additives ; les anciennes restent « mixtes »)  — zéro migration.

## 6. Les manques connus (auto-audit récent, hiérarchisés)

Un audit comparatif complet face à Ableton/Cubase existe (AUDIT-6,
~35 constats étiquetés). L'essentiel :

1. **Le temps musical n'existe pas** (pas de BPM, mesures, grille
   musicale, métronome, quantize, groove). C'est LA migration à venir ;
   elle bloque en cascade : plugins tempo-sync (aucun ProcessContext
   n'est passé aux VST3), quantum musical de Session, piano-roll en
   croches.
2. **Rien n'entre en live** : aucun enregistrement audio (device
   ouvert playback-only), AUCUNE entrée MIDI vive (ni Web MIDI ni
   MIDI-in moteur), pas de CC/pitch-bend/sustain dans le ring (un
   clavier jouerait sans pédale). Prérequis nommés du « test Massive »
   (jouer un synthé distant en P2P).
3. **Mixage** : pas de sends/retours/groupes/sidechain (designs CRDT
   déjà écrits, non implémentés) ; le master n'a pas de chaîne de
   devices (aucun limiteur possible) ; meters crête-seule.
4. **Édition d'échelle** : sélection mono-objet, pas de
   copier/coller/multi-sélection/sélection de temps (le split existe).
5. **I/O** : buffer figé 512, pas d'ASIO ni WASAPI exclusif, latence
   non réglable ; période device non multiple de 256 = plugins
   bypassés (averti bruyamment, pas encore résolu).
6. **Piano-roll v1** : 16 pas fixes, C3–C5, vélocité non éditable.
7. **Données** : pas de sauvegardes tournantes des .am (l'historique
   Automerge est là mais inexploité), gestion de projets = middleware
   de dev, pas d'identités/permissions (auth = un token partagé).
8. Dettes de correctness connues et bornées (AUDIT-5) : pas de
   resampling moteur (44.1k joue faux — averti, contourné à l'import),
   PDC live non appliquée, arbitrage d'écrivain stems à 2 machines.

## 7. Ce qui est en projet (la file, dans l'ordre du propriétaire)

1. **Candidats « gros chantier » (décision imminente)** :
   - **P2P E4 « test Massive »** : clavier du portable → synthé sur la
     tour via P2P (2 machines). Prérequis découverts : MIDI-in
     inexistant, CC64, latence réglable.
   - **Vague 3 MIDI + instruments** (l'axe produit) — recommandation
     interne : caser la migration TEMPO avant/dedans.
   - **Effets natifs 4.2/4.3** : EQ3+comp (fait), restent presets de
     réglages, GR meter, Drive/Delay affinés.
2. **Direction long terme** : moteurs P2P entre participants (le
   serveur signaling seul), paradigmes commutables par utilisateur,
   UI entièrement moddable (superset data model + panneaux modulaires).
3. **À ratifier** : AUDIT-5 (harmonisation code, ~40 trouvailles,
   quick wins soldés) et AUDIT-6 (parité conceptuelle, arbitrage
   proposé).
4. Quick wins restants : GR meter du compresseur, matière sonore des
   projets vierges (le kit démo est derrière ?lab=1 — décision
   produit), tranche « édition d'échelle » (multi-sélection +
   clipboard + sélection de temps).

## 8. Questions où une analyse externe a le plus de valeur

1. **La migration tempo** : schéma proposé (tempo LWW + time_signature
   en liste d'événements + positions re-exprimées beats↔samples par
   intégrale de la map, moteur beats→frames par bloc de 256). Angles :
   stratégie de migration des documents v1, coexistence clips
   « seconds » (warp off) / clips musicaux, impact sur le hash
   déterministe et les clés de stems.
2. **Sends/groupes/sidechain en CRDT** : le design (returnTracks +
   sends[{returnId, level, pre}] ; groupes par parentId ; sidechain =
   routage à 3 prises) tient-il face aux éditions concurrentes ?
3. **Overlap somme vs remplacement** au drag/pose — et ses
   conséquences sur le comping futur (take lanes = vues sur
   enregistrement continu).
4. **Mute : document ou éphémère ?** (solo local acquis).
5. **Identités/permissions** : quand et comment passer du token
   partagé aux invitations par projet sans casser le local-first.
6. **PDC live** (compensation de latence entre pistes) dans un graphe
   à pipeline async par plugin : stratégie de retard par piste.
7. **L'architecture multi-moteurs P2P** (chaque participant rend
   localement, le serveur signale) : cohérence transport/stems à
   grande échelle, arbitrage d'écrivain des stems quand N machines ont
   le même plugin.
8. **Périodes device non multiples de 256** : chunks partiels vs
   double-buffer interne — quel remède préserve le pipeline plugin ?

## 9. Repères de lecture (si la session obtient l'accès au dépôt)

- `CLAUDE.md` (régime de travail), `STATUS.md` (état), `TODO.md`
  (file + ordre grave), `JOURNAL.md` (chronique datée complète).
- `docs/ADR-019-differenciateur-distribue.md` (la loi),
  `docs/SCHEMA.md` + `docs/SCHEMA-V2-DESIGN.md` (document),
  `docs/audits/AUDIT-5.md` (santé du code), `docs/audits/AUDIT-6.md` (parité DAW),
  `docs/ABLETON-INTEGRALE.md` (le manuel Live 12 mappé sur le projet,
  designs CRDT des grandes couches absentes),
  `docs/P2P-ENGINES-DESIGN.md`, `docs/LINK-DESIGN.md` (sync/tempo).
- Moteur : `engine/src/audio/audio_callback.cpp` (le thread sacré),
  `engine/src/host/shared_audio_ring.h` (le contrat binaire),
  `engine/src/render/` (déterminisme, stems, export).

*Fin du brief. Toute affirmation d'état est adossée à un test ou une
sonde datée du 2026-08-27 (suite e2e 83/83, gtests 45/45, CI verte).*
