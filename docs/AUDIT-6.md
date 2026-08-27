# AUDIT-6 — Parité conceptuelle : le projet face à Ableton Live / Cubase

*Session d'audit dédiée, lecture seule, 2026-08-27. HEAD = a587c13.
Demande utilisateur : « comparer à ce qui se fait en DAW (Ableton,
Cubase) et dire ce qui manque ou est mal pensé ». Méthode : trois
lectures parallèles exhaustives (UI web ~11,6k lignes TS ; moteur
13,8k lignes C++ / 62 fichiers ; schéma + serveur Rust + ADRs), croisées
avec ABLETON-INTEGRALE.md, SCHEMA-V2-DESIGN.md, LINK-DESIGN.md et
AUDIT-5. Ce fichier est le RAPPORT ; l'arbitrage par la grille est
proposé, pas exécuté. Aucune ligne de code modifiée. La roadmap de
parité Ableton reste GELÉE (ADR-019) — rien ici n'entre dans la file
sans ratification.*

## Comment lire ce rapport

AUDIT-5 jugeait la santé du code ; AUDIT-6 juge la **forme du produit**
contre le canon des DAW. Chaque trouvaille porte une étiquette
d'honnêteté :

- **[DESIGNÉ]** — absent du code mais déjà conçu dans vos docs (pas une
  découverte ; l'audit confirme et pèse).
- **[REFUSÉ]** — absent par refus écrit et argumenté (l'audit vérifie
  que le refus tient).
- **[SOUS-PESÉ]** — nommé quelque part chez vous, mais dont le poids
  réel (ce qu'il bloque en cascade) n'est écrit nulle part.
- **[NOUVEAU]** — jamais nommé dans vos docs. C'est la valeur ajoutée
  de cet audit.

Grille habituelle : 1 casse / 2 ergonomie / 3 concept (proposer) /
4 goût (ne pas trancher).

## Le titre de l'audit

**Le projet est aujourd'hui un moteur de LECTURE collaboratif, pas
encore un DAW : rien n'y entre (aucun enregistrement audio, aucune
entrée MIDI vive) et rien n'en sort (aucun export depuis l'UI) — et le
temps musical n'existe dans aucun des trois étages.** Ces trois trous ne
sont pas trois features manquantes parmi quarante : ce sont les trois
définitions d'un DAW (capturer, organiser en musique, livrer). Le
reste de l'écart avec Ableton/Cubase — sends, warp, comping, presets —
est du volume ; ces trois-là sont de la nature.

La bonne nouvelle, vérifiée pièce par pièce : **presque tout l'écart
est déjà nommé et souvent déjà conçu dans vos propres docs** (tempo =
« LA migration », sends/groupes/sidechain = designs CRDT acquis,
comping = take lanes, refus écrits argumentés). L'audit a trouvé peu
d'angles morts — mais les quelques [NOUVEAU] touchent précisément les
deux prochains chantiers candidats (Vague 3 MIDI et P2P E4 Massive),
d'où l'utilité de les lire avant de trancher le gros chantier.

---

## 1. Le temps musical n'existe pas — et la liste de ce qu'il bloque

**[DESIGNÉ]** (tempo = « LA migration », vague 2 ; design LWW/Link
acquis dans ABLETON-INTEGRALE §4) — mais **[SOUS-PESÉ]** : nulle part
n'est écrite la liste de ce qui est bloqué en cascade. La voici,
vérifiée dans le code :

| Bloqué par l'absence de tempo | Preuve |
|---|---|
| Grille d'édition : snap en SECONDES (0.0625–0.5 s selon zoom), règle en `MM:SS` — aucun DAW ne place un kick « à 1,25 s » | `web/src/app/navigation.ts:55-61`, `ui/transport.ts:9-18` |
| Piano-roll : 16 pas fixes = division du clip, pas des croches ; `pr-beat` marque 1 pas sur 4 sans rapport avec un temps | `ui/piano_roll.ts:15,53` |
| Quantum de Session : « longueur du premier slot lancé », pas « 1 mesure » — l'ancre à 1,7 s impose sa grille à tous | `engine/graph/audio_graph.cpp:456-464` |
| Métronome / count-in : impossibles (rien à cliquer) | néant moteur, confirmé |
| **Plugins tempo-sync : AUCUN `ProcessContext` n'est passé aux VST3** — delays synchronisés, arpégiateurs, LFO des synthés tournent sur leur défaut interne | `plugin_host_main.cpp:1022-1034` (voir §6) |
| Quantize de notes, groove/swing, tempo automation | néant |
| Le champ delay « en ms en attendant le tempo » | `graph/delay_node.h:6-8` (dette datée dans le code) |

**Ce que font les références** : Live et Cubase n'ont pas « une feature
tempo » — tout leur modèle de position est en beats (PPQ), les
secondes étant la projection. Votre ADR-003 (sample-based) a fait le
choix inverse, cohérent avec le hash déterministe, et SCHEMA-V2 sait
déjà que la migration re-exprime les positions.

**Proposition (grille 3)** : la migration tempo est déjà « vague 2 » ;
l'audit ajoute un argument d'ORDRE : la Vague 3 (MIDI + instruments) a
un rendement divisé sans temps musical (un piano-roll sans croches, un
quantum non musical, des synthés dont les LFO ignorent le tempo). Si le
gros chantier choisi est la Vague 3, caser la migration tempo AVANT ou
DEDANS, pas après.

---

## 2. Rien n'entre : ni enregistrement, ni MIDI vif, ni formats

C'est le trou le plus large mesuré contre les deux références, et le
seul quasi entièrement absent de vos designs.

- **Aucune capture audio, à aucun étage** [DESIGNÉ en partie — take
  lanes/comping conçus dans ABLETON-INTEGRALE §4, mais le CHEMIN
  d'entrée n'est conçu nulle part] : le device miniaudio est ouvert
  playback-only (`audio_device.cpp:129`), le paramètre `input` du
  callback est commenté (`audio_callback.cpp:38`), le protocole n'a
  aucun message record (`messages.proto`), l'UI n'a pas de bouton REC,
  `getUserMedia` : zéro occurrence. Le seul « enregistrement » du
  système est le tap réseau du jam — il ne s'écrit nulle part.
- **Aucune entrée MIDI vive** **[NOUVEAU — et bloquant pour E4]** :
  `requestMIDIAccess` : zéro occurrence web ; aucun MIDI-in moteur
  (WinMM/RtMidi : néant). **Le test Massive (P2P E4, « clavier du
  portable -> Massive sur la tour ») suppose un clavier : aucun étage
  ne sait aujourd'hui lire un clavier MIDI.** À chiffrer dans le
  cadrage E4, pas à découvrir en séance.
- **Import : WAV seul, et silencieusement fragile** [NOUVEAU] :
  dr_flac/dr_mp3 sont déjà téléchargés par le build mais jamais inclus
  (`clip_player.cpp:2`) ; un fichier >2 canaux joue en SILENCE
  (`clip_player.cpp:157-166`) ; le 44,1 kHz joue faux (AUDIT-5 A7,
  warning posé). Live/Cubase importent wav/aiff/flac/mp3 et
  convertissent à l'import. Quick win réel : inclure dr_flac/dr_mp3 =
  décoder à l'import vers le store (le store reste du WAV canonique).
- **Aucun import/export MIDI (.mid)** [NOUVEAU] : zéro occurrence.
  C'est l'interop minimale d'un DAW (échanger avec un autre outil).

**Proposition** : traiter « l'entrée » comme une TRANCHE nommée (comme
stems ou streaming), pas comme des features éparses : chemin capture
moteur (duplex miniaudio) + Web MIDI → moteur + décodage à l'import.
Le design comping existant (take lanes CRDT) est l'aval déjà prêt de
cette tranche.

---

## 3. Rien ne sort : l'export n'existe pas côté utilisateur

**[SOUS-PESÉ]** (l'export/stems est designé dans ABLETON-INTEGRALE §4,
mais nulle part il n'est écrit que l'utilisateur n'a AUCUNE sortie
aujourd'hui) :

- Le moteur sait rendre (`--render`, WAV 16/24/32f, pré-roll
  déterministe, preuve par étage — c'est même au-dessus du standard).
  **Mais aucun chemin UI n'y mène** : zéro `Blob`, zéro
  `createObjectURL`, zéro bouton export dans `index.html`. Un
  utilisateur qui a fini un morceau ne peut PAS produire le fichier à
  envoyer — `ma-piece.wav` à la racine a été produit à la main en CLI.
- Pas d'export de stems utilisateur (les stems du code servent
  l'invariant pair-sans-plugin, pas la livraison), pas de
  normalize/dither (designé), pas de métadonnées WAV.
- **Proposition (grille 2, petite session)** : un bouton « Exporter le
  mixdown » = message WS → moteur `--render` → fichier servi par le
  store → téléchargement. Tout existe déjà sauf le fil. C'est LA manip
  5 minutes par excellence, et l'écart produit/effort le plus favorable
  de tout ce rapport avec les fades (déjà faits).

---

## 4. Édition d'arrangement : sous le seuil des deux références

Le socle géométrique est bon (move/trim bi-dimensionnel, fades à
poignées, undo par geste, minimap — au niveau). Ce qui manque est le
PASSAGE À L'ÉCHELLE du geste :

| Manque | Étiquette | Réf. Live/Cubase | Notes |
|---|---|---|---|
| **Sélection multiple** (rubber-band, Shift-clic) — la sélection est UN clip + UNE piste (`context.ts:70-71`) | **[NOUVEAU]** | fondement des deux | bloque tout geste de masse : déplacer un refrain, supprimer une section |
| **Couper/copier/coller** — zéro code clipboard ; Ctrl+D est le seul geste de copie | **[NOUVEAU]** | Ctrl+C/V universel | |
| **Split/scission** d'un clip au curseur — aucun mutateur | **[NOUVEAU]** | Ctrl+E (Live), ciseaux (Cubase) | trivial sur votre modèle réf+recette (deux clips, offsets ajustés) |
| Sélection de TEMPS distincte des clips | [DESIGNÉ] (§2.5 ABLETON-INTEGRALE) | débloque split-sur-sélection, consolidate, insert/delete time | |
| **Boucle utilisateur** : le cycle est TOUJOURS `[0, fin du contenu]` (`main.cpp:1033`) ; la bande `.ruler-cycle` est inerte (commentée « future ») ; le protocole n'a pas de loop start/end | **[SOUS-PESÉ]** (bande réservée = intention, jamais chiffrée) | la boucle de travail est LE geste de production des deux DAW | quick win moteur : 2 champs proto + 2 atomics déjà existants |
| **Chevauchement de clips = SOMME** (`audio_graph.cpp:199-211`) : déposer un clip sur un autre = les deux jouent | **[NOUVEAU, grille 3]** | Live/Cubase : le dessus remplace (+ crossfade) | surprenant à l'usage et contraire à « une action montre tous ses effets » ; à trancher : somme assumée (comportement tracker) ou remplacement |
| Marqueurs/locators nommés dans le document | [NOUVEAU, petit] | les deux | votre marqueur unique est éphémère par onglet |
| Nudge clavier, hauteur de piste par piste, ripple/insert time, consolidate | [DESIGNÉ pour nudge, le reste non nommé] | | dette datée acceptable |

**Proposition** : une tranche « ÉDITION D'ÉCHELLE » (multi-sélection +
clipboard + split + boucle utilisateur) vaut plus que n'importe quelle
feature nouvelle : elle multiplie tout ce qui existe déjà. C'est
l'équivalent UI de ce que fut la tranche gestes D1-D4.

---

## 5. MIDI / piano-roll : une matrice de pas, pas encore un éditeur

L'aval moteur est sérieux (scheduling sample-accurate, seam de boucle
propre, all-notes-off). L'amont édition ne l'est pas encore :

- **Vélocité inéditable** [NOUVEAU] : `velocity: 100` codé en dur
  (`piano_roll.ts:59`), aucun geste ne peut la changer — le champ du
  schéma est mort à l'UI. Pas de longueur de note éditable (toujours
  1/16 du clip), pas de déplacement (toggle on/off seulement), plage
  figée C3–C5, un seul clip MIDI éditable par piste (le premier).
- **Le document contredit son propre design** [NOUVEAU, grille 1
  différée] : SCHEMA-V2 §4 exige des notes en MAP à ids stables
  (« une liste Automerge divergerait sur les insertions
  concurrentes ») ; l'implémentation est une LISTE sans id
  (`schema.ts:32`), et `toggleNote` matche sur (pitch, startSample).
  Deux pairs qui posent des notes en concurrence = le bug de
  convergence que votre design avait déjà écarté. À corriger AVANT que
  la Vague 3 ne s'y adosse (champ additif possible : garder la liste,
  ajouter les ids).
- **Pas de CC/pitch-bend/sustain de bout en bout** [SOUS-PESÉ — « MIDI
  couche entière » est nommé reporté, mais pas le détail qui fâche] :
  le ring ne transporte que note-on/off (`shared_audio_ring.h:141`),
  canal 0 en dur, note-off velocity 0. **Concrètement : la pédale de
  sustain (CC64) ne peut pas exister — le test Massive au clavier se
  jouera sans pédale ni molette.** À mettre dans le cadrage E4/Vague 3.
- Note bloquée au seek/loop : trou documenté dans le code
  (`midi_schedule.h:15-18`) — connu.
- Réf : le piano-roll de Cubase (Key Editor) et celui de Live sont le
  CŒUR de l'édition moderne — notes draggables, vélocité en lane,
  quantize, gammes. Vous n'avez pas à tout faire, mais
  vélocité + longueur + déplacement est le minimum d'un « éditeur ».

---

## 6. Hosting VST3 : le différenciateur mérite un hôte complet

Le moat (out-of-process, ring v9, cold-restart, stems) est réel et
au-dessus du standard. Mais vu DEPUIS LE PLUGIN, l'hôte est spartiate —
et c'est votre terrain différenciant, donc le standard à viser y est
plus haut qu'ailleurs :

| Manque | Étiquette | Effet concret |
|---|---|---|
| **`ProcessContext` jamais rempli** | **[NOUVEAU]** | les plugins ne reçoivent NI tempo NI position NI état play/stop : tout delay sync, arpégiateur, LFO sync tourne faux. Même sans tempo projet, passer play-state + position + un tempo défaut (120) est immédiat ; le vrai remplissage arrive avec la migration tempo |
| **Un seul bus activé, tout en stéréo forcée** (`plugin_host_main.cpp:537-538`, `numOutputs=1`) | [NOUVEAU] | pas d'instruments multi-sorties (drum samplers), pas de bus sidechain de plugin — à concevoir AVEC sends/sidechain (le design §4 existe) |
| **État controller jamais sérialisé** (seul `IComponent::getState` voyage) | [NOUVEAU, grille 2] | les réglages GUI-only de certains plugins se perdent ; la paire Comp+Cont était pourtant dans le design 2.5 (SCHEMA-V2 §2 : « Component puis Controller ») — l'implémentation n'en a gardé que la moitié |
| Pas de presets (programme/`.vstpreset`/factory) | [DESIGNÉ — « système séparé optionnel »] | l'utilisateur repart de zéro sur chaque instance |
| `outputParameterChanges` jamais lu | [NOUVEAU, petit] | l'automation générée par le plugin (son propre LFO, ses knobs animés) est perdue pour le document — à garder en tête pour A4 |
| Params à offset 0 uniquement (pas de rampes sample-accurate) | [NOUVEAU, petit] | à prévoir dans le design A4 (le contrat d'exactitude au bit de l'automation l'exigera) |
| Blocs ≠ 256 passés dry | AUDIT-5 A6 | renvoi |

---

## 7. Console : ce qui empêche de MIXER aujourd'hui

Sends/retours/groupes/sidechain : [DESIGNÉ], design CRDT acquis, rien à
redire — c'est la plus grosse absence de mixage et elle est au TODO §5.
Ce que l'audit AJOUTE :

- **Le master n'a pas de chaîne** [SOUS-PESÉ] : `masterGain` est un
  scalaire ; on ne peut poser NI limiteur NI EQ sur le master — le
  geste de fin de morceau (protéger les T8V comprises) n'existe pas.
  Dans les deux références le master est une piste à inserts. Champ
  additif évident (`masterChain: ProcessorDef[]`), le moteur sait déjà
  traiter une chaîne.
- **Mute éphémère et par-client** [NOUVEAU, grille 3 — à trancher] :
  solo local = exactement le bon choix collaboratif (votre doc le
  grave). Mais MUTE est, dans tous les DAW, une décision de MIX qui se
  sauvegarde avec le projet (le Track Activator de Live est dans le
  Set). Chez vous un mute ne survit ni au reload ni ne se partage :
  deux collaborateurs n'entendent pas le même morceau sans se le dire.
  Proposition : `TrackDef.muted` document + solo restant local (et le
  mute-local d'écoute reste possible via solo).
- **Compresseur sans aiguille de réduction de gain** [NOUVEAU,
  grille 2] : l'enveloppe du détecteur n'est jamais publiée
  (`compressor_node.cpp`) — régler un compresseur sans GR meter, c'est
  régler à l'aveugle ; aucune référence ne l'ose. Le canal télémétrie
  per-device existe déjà (les VU inter-devices) : publier l'enveloppe
  est un petit champ de plus.
- Meters : crête seule, échelle LINÉAIRE en pixels (pas de graduation
  dB), pas de RMS live [NOUVEAU, petit] — Live affiche crête+RMS,
  Cubase propose des échelles. Votre `ear` offline a déjà RMS ; le live
  n'en est qu'à la crête.
- Pan : la loi linéaire unity-au-centre est un choix ASSUMÉ dans le
  code (protection du hash) — mais `schema.h:135-136` dit encore
  « puissance égale » : commentaire faux à corriger (famille F
  d'AUDIT-5). À terme, les références offrent des lois configurables ;
  dette datée, pas un bug.

---

## 8. Session view : le squelette est bon, les muscles Ableton manquent

Launch quantisé avec vérité moteur : la mécanique de fond est SAINE
(queued/promotion au sample, c'est le cœur d'Ableton bien compris).
Autour : slots MIDI seulement (aucun moyen d'y mettre un sample)
[NOUVEAU], longueur fixe 96000 samples, pas de modes de lancement
(trigger/gate/legato), pas de quantisation par slot, follow actions
[DESIGNÉ avec seed — idée couronnée #10], pas d'enregistrement de
session→arrangement. L'état de performance hors document est le bon
choix ([REFUSÉ] vérifié : cohérent). Rien d'urgent ici tant que le
quantum n'est pas musical (§1) — le noter comme dépendance, pas comme
chantier.

---

## 9. I/O machine : un DAW Windows sans ASIO ni réglage de buffer

**[NOUVEAU]** — nulle part nommé dans vos docs :

- Pas d'ASIO (zéro occurrence ; miniaudio le supporte pourtant côté
  API), pas de WASAPI exclusif, **buffer codé en dur à 512**
  (`main.cpp:947,1121` — aucun flag CLI, aucun message). La latence
  aller-simple est donc figée : 512 + profondeur pipeline plugins
  (`depth*256`) + période device, non compensée (AUDIT-5 A5).
- Votre Zen Go a un driver ASIO natif ; Cubase est ASIO-first,
  Live le recommande sur Windows. **Pour « jouer » un instrument
  (Vague 3/E4), la latence de bout en bout devient LE critère
  ressenti** — un clavier à >30 ms est injouable. Aujourd'hui rien ne
  permet même de la RÉGLER.
- Pas de gestion du débranchement de device (retour false, pas de
  fallback), période non-multiple de 256 = plugins bypassés (AUDIT-5
  A6, warning posé).
- **Proposition** : mesurer d'abord (la latence réelle Zen Go
  WASAPI-shared vs ce qu'exigerait le jeu), puis chiffrer
  `--buffer-size` + mode exclusif ; ASIO seulement si la mesure
  l'impose (SDK à licence, décision d'entrée).

---

## 10. Données : pas de filet sous le projet

- **Aucune sauvegarde de secours** [NOUVEAU] : chaque save écrase le
  `.am` en place (rename atomique = bien contre l'écriture partielle,
  rien contre la corruption logique ou la fausse manip). Live garde un
  dossier Backup, Cubase des `.bak` tournants. L'histoire Automerge
  DANS le fichier est votre matière première (mieux que leurs .bak) —
  mais rien ne l'expose ni ne la protège : un fichier remplacé = tout
  perdu. Quick win : copie datée périodique côté serveur (N dernières).
- **La gestion de projets vit dans l'outil de dev** [NOUVEAU] :
  `/api/projects` (lister/créer) est un middleware VITE
  (`vite.config.ts:53`) lisant les fichiers du serveur — même classe
  que B6 d'AUDIT-5. `list()`/`delete()` existent dans le store Rust
  mais AUCUNE route ne les expose. En prod (sans Vite) : pas de menu
  projets. Renommer/dupliquer/supprimer un projet n'existe pas.
- Pas de métadonnées projet (titre, dates, auteur), pas de GC assets
  ni projets (937 fichiers, AUDIT-5) — dette datée.
- Undo : volatile, 100 entrées, local — l'aspiration (undo par acteur
  navigable) est [DESIGNÉ] et dépasse les références ; l'état actuel
  est en dessous (Cubase persiste l'historique d'édition sur demande).

---

## 11. Browser : la bibliothèque ne s'écoute pas et ne se cherche pas

**[NOUVEAU]** : aucune pré-écoute d'un sample avant de le poser (seul
`decodeAudioData` pour dessiner la forme d'onde — le chemin WebAudio
existe donc déjà) ; aucun champ de recherche (Live 12 est
littéralement construit autour de son browser-recherche) ; pas de
favoris/tags ; pas de navigation du système de fichiers (les samples
listés = ceux déjà dans le projet). Pré-écoute = quick win WebAudio
pur (grille 2) ; le reste suit la croissance du contenu.

---

## 12. Où vous DÉPASSEZ les deux références (à protéger)

Pour l'équité de la comparaison, vérifié dans le code : édition
multi-utilisateur CRDT temps réel avec présence (aucun des deux ne
l'a) ; l'invariant stems pair-sans-plugin (personne ne l'a) ; store
adressé contenu (supprime missing-media/collect-and-save) ; VU
par-device dans la chaîne (Live ne l'a pas) ; preuve audio par étage
offline (hash/crête/RMS par maillon — aucun DAW commercial ne sait
dire QUEL maillon a changé l'audio) ; rendu déterministe prouvé par
hash ; bypass à latence constante (Live n'a que le on/off) ; undo
collaboratif par inverses (leur undo casse en collaboration — le vôtre
est déjà juste, avant même la version navigable).

---

## ARBITRAGE PROPOSÉ (à ratifier — rien n'entre dans la file sans vous)

### Quick wins (< 1 session chacun, indépendants de tout)
1. **Export mixdown depuis l'UI** (§3) — le fil manquant vers
   `--render`. La manip 5 min ultime.
2. **Boucle utilisateur** (§4) — loop start/end dans le proto + la
   bande `.ruler-cycle` qui attend déjà.
3. **Pré-écoute des samples** (§11) — WebAudio déjà présent.
4. **GR meter du compresseur** (§7) — un champ télémétrie de plus.
5. **dr_flac/dr_mp3 à l'import** (§2) — décodage vers le store.

### Préalables au choix du GROS CHANTIER (l'apport principal de l'audit)
- **Si Vague 3 / E4 Massive** : (a) entrée MIDI vive (Web MIDI +
  MIDI-in moteur) — aujourd'hui inexistante ; (b) CC64/pitch-bend dans
  le ring (sinon clavier sans pédale) ; (c) notes en ids stables
  (§5, votre propre design) ; (d) latence réglable mesurée (§9) ;
  (e) décision d'ordre sur la migration tempo (§1). Chacun se chiffre
  en cadrage, aucun ne se découvre en séance.
- **Si Effets natifs 4.2/4.3** : GR meter avec le compresseur (même
  session) ; la chaîne master (§7) donnerait au limiteur futur sa
  place naturelle.

### Refontes planifiées (sessions dédiées, comme AUDIT-5)
- **Tranche ÉDITION D'ÉCHELLE** (§4) : multi-sélection + clipboard +
  split + sélection de temps. Multiplie l'existant.
- **Tranche ENTRÉE** (§2) : capture audio + comping (le design take
  lanes attend).
- **Chaîne master + mute document** (§7) : deux champs additifs, gros
  rendement mix.
- **ProcessContext + état controller** (§6) : compléter l'hôte — c'est
  le différenciateur, il doit être irréprochable.

### Concept à trancher (grille 3 — pas de code sans vous)
- Chevauchement de clips : somme ou remplacement ? (§4)
- Mute : document ou éphémère ? (§7)
- ASIO/exclusif : mesurer d'abord, décider ensuite. (§9)

### Goût (grille 4 — notés, pas tranchés)
- Échelles de meters (dB vs linéaire), lois de pan configurables,
  couleurs de piste choisies, métadonnées projet.

### Méthode (rappel AUDIT-5, inchangé)
Rapport issu de lectures d'agents : sur ~35 constats, 1-2 peuvent être
inexacts. Toute session qui en découle commence par REPRODUIRE (un
test qui échoue, ou la manip qui montre le manque) avant de coder.

---

## Ce que ce rapport ne re-liste PAS (déjà possédé ailleurs)

Correctness/sécu/perf du code = AUDIT-5 (A1-A8, B, C, D, E, F).
Designs acquis = ABLETON-INTEGRALE §4 (automation ✔ livrée depuis,
tempo, sends, undo, freeze, export, comping). Refus écrits vérifiés et
TENUS = macros/racks, M4L, aléa sans seed, état de performance dans le
document. Ce rapport possède : les étiquettes [NOUVEAU]/[SOUS-PESÉ] et
l'arbitrage ci-dessus.
