# ABLETON-INTEGRALE.md — le manuel Live 12 entier, mappe sur Magic Potion

*Lecture integrale 2026-08-22 (6 passes paralleles sur le manuel officiel :
Session/lancement/grooves ; Arrangement/ClipView/warp/recording/comping ;
mix/routing/automation/enveloppes ; devices/racks/M4L/references ;
fichiers/export/undo/freeze ; sync/Link/MIDI-map/tempo/audio-IO).
Chaque affirmation est sourcee au chapitre dans les rapports de session.
Ce document garde LA SYNTHESE : ce qu'on a, ce qui est proche, ce qui
touche le schema, ce qui touche le moteur, ce qu'on refuse et pourquoi.*

## 1. Ce que le manuel CONFIRME chez nous (deja-la)

- Clip = reference + recette (start/length/offset, non destructif) — le
  modele exact de Live. Warp OFF = notre modele secondes, mot pour mot.
- Chaine lineaire par piste, flux clip -> chaine -> mixer ; snap grille +
  bords ; Z/X ; Follow avec pause-sur-edition ; locators ~ nos marqueurs.
- Notre store adresse par contenu SUPPRIME toute leur classe de maladies
  fichiers : missing media, collect-and-save, .asd orphelins, Packs.
- Push = un client riche de plus sur le meme etat — notre modele
  multi-clients. Start Stop Sync opt-in ~ nos commandes transport WS.
- Leur crash-handling (blacklist) rime avec notre cold-restart — mais eux
  desactivent, nous relançons : nous sommes plus ambitieux, garder les 2.

## 2. Les gains PROCHES (petits lots, champs existants ou additifs)

1. **Fades/crossfades 4 ms anti-clic** — cite DEUX fois comme meilleur
   ratio valeur/effort du manuel. Schema : fadeInSamples/fadeOutSamples/
   fadeCurve sur le clip (propriete de clip, JAMAIS de l'automation) ;
   moteur : rampe de gain sample-accurate (trivial). Solde la dette
   « crossfade anti-clic » datee depuis 2.4d.
2. **Slide du contenu** (modificateur+drag sur la forme d'onde) : n'edite
   que offsetSamples — champ existant, geste pur-UI.
3. **Gain/pitch par clip** : clip.gainDb, clip.pitchCents (additifs).
4. **Pan par piste** : track.pan, constant-power d'abord (split L/R plus tard).
5. **Selection de temps** distincte de la selection de clips (debloque
   split-sur-selection, consolidate).
6. **Blacklist au 2e crash** par class-uid dans le registry (compteur +
   flag unavailable + reset manuel) — quasi gratuit.
7. **exposedParams par instance de device** (le Configure Mode de Live,
   sauve dans le document) : l'UI generique reste utilisable a 500 params.
8. Nudge (pas fixe sur startSample), count-in, page de calibration audio.

## 3. 2.5 VALIDE et enrichi par le manuel

- Etat plugin : le modele Set-first de Live valide {classUid, compBlob,
  contBlob} PAR INSTANCE DANS LE DOCUMENT ; les presets sont un systeme
  separe optionnel. REGLE DE VERITE a graver : les blobs gagnent au
  chargement, la param-list {key,value} devient une PROJECTION pour
  l'UI et les diffs collaboratifs (jamais de double-apply).
- on/off (retire du graphe, 0 CPU, latence retiree) != bypass (dry-pass a
  latence constante). Live n'a QUE le premier ; nous avons le second.
  Les deux semantiques meritent d'exister : champ deactivated distinct.
- Hot-swap sans interruption = echange atomique dans notre process host
  (le registry ADR-017 est deja la bonne forme).
- Utility natif, perimetre fini : Gain +-35 dB, Mute, phase L/R, Width
  0-400 % (0=mono), Bass Mono + coupure, Balance, DC filter.

## 4. Les grandes couches absentes — designs CRDT acquis

### Automation (LA plus grosse)
- Representation merge-clean : par piste, lanes [{id, target:{nodeUid|
  "mixer", paramId}, points: MAP par pointId -> {t, v, curve?}, enabled}].
  Points en map a ids stables (tri par t a la lecture) : deux
  collaborateurs posent/deplacent sans conflit d'index. curve = courbure
  du segment SORTANT (modele Live). Valeurs normalisees 0..1.
- L'etat d'override (LED eteinte / Re-Enable) est EPHEMERE PAR
  UTILISATEUR, jamais dans le CRDT — la traduction exacte de notre
  solo local. Re-enable = « reprendre la lecture du document ».
- Enveloppes de clip (absolues vs modulation relative, unlinked-as-LFO) :
  meme forme sur le clip + mode abs|mod ; differable, mais le pipeline
  de valeur doit prevoir la couche relative (effective = mod(auto(base))).
- Moteur : interpolation breakpoints -> IParameterChanges sample-accurate.

### Tempo (LA migration)
- Le design Link transpose : tempo = LWW-register (le manuel documente
  le last-writer-wins !), la phase = convention de quantisation, personne
  n'est maitre — rime directe avec le CRDT.
- Schema minimal : tempo_bpm bornes, time_signature = LISTE D'EVENEMENTS
  positionnes (non automatable, dit le manuel), tempo_map breakpoints sur
  piste Main implicite. Toute position devient double : secondes <->
  beat-time par integrale de la map. Moteur : beats->frames par bloc 256.
- Le conflit fecond releve : « Link ecrase l'automation » = valeur live
  vs valeur document — nos deux couches doivent rester distinctes.

### Sends/retours/groupes
- returnTracks[{id,name,gain,chain}] + sends[{returnId, level, pre}]
  (STOCKER pre/post meme si v1 = post seulement) ; groupes = parentId +
  kind:"group" (sans clips, avec chaine), regle Live : le routage enfant
  se re-ecrit sauf routage custom. Feedback return->return = opt-in.
- Sidechain et resampling = LA MEME FEATURE : routage interne a 3 points
  de prise (Pre FX / Post FX / Post Mixer) — un champ input:{sourceTrackId,
  tap} debloque les deux.

### Undo (ou nous DEPASSONS Live)
- Leur modele : lineaire, volatile (« refreshed each time the Set is
  opened »), mono-utilisateur — FAUX deux fois en collaboratif.
- Le notre : historique Automerge deja persistant -> undo SELECTIF
  PAR ACTEUR + timeline navigable (jump + reapply, ce que leur Undo
  History enseigne comme UX) + checkouts historiques (fork a un heads).
  Plancher non-annulable : la sync elle-meme.

### Freeze/Bounce (ou nous DEPASSONS Live)
- Meme-document => meme-hash rend le freeze PROUVABLE : rendu memoise
  d'un sous-arbre keye par le hash de ses entrees, invalidation
  automatique a toute edition sous la cle. Zero fichier de freeze, zero
  hack de queues. Point de coupe valide par Live : post-FX pre-mixer
  (mixer/sends restent vivants).

### Export/stems
- Stems = prise post-fader par piste + regle « Include Return and Main
  Effects » (part des retours attribuee par piste) ; Render-as-Loop =
  DEUX passes (la premiere charge les queues). Normalize/dither/
  downsample = post-traitements explicites. Tout est du moteur existant.

### Enregistrement/comping (futur enregistrement)
- Take lanes = VUES sur un enregistrement continu immuable : segments
  {laneId, offset} dans Automerge — comping nativement sans conflit.
- Punch = bords de la boucle ; quantize d'enregistrement = etape d'undo
  separee ; « Keep Monitoring Latency » : l'alignement est une politique.

## 5. Ce qu'on REFUSE, et pourquoi c'est ecrit

- **Etat de performance Session** (quel clip joue/clignote/est declenche,
  Back-to-Arrangement) : ephemere par-utilisateur, non fusionnable —
  vivra en presence, JAMAIS dans Automerge. La Session View entiere
  attend ce socle (idee future : vue de jam collaborative).
- **Macros/racks** : une macro est une INDIRECTION que le CRDT ne peut
  pas arbitrer (deux users, la macro et sa cible). Si grouping un jour :
  chaines paralleles sans macros.
- **Max for Live** : devices definis par fichiers externes mutables =
  contraire au document auto-contenu.
- **Non-determinisme sans seed** (Chance A/B, Random groove) : tout alea
  entre dans le document AVEC sa seed, sinon le rendu reproductible ment.
- Cue outs, monitoring live-input, MIDI (couche entiere), Track Delay ms :
  reportes avec leur nom Ableton comme reference.

## 6. Les idees couronnees (une ligne chacune)

1. Fades 4 ms declick — le plus grand gain audible au plus petit cout.
2. Automation en point-maps a ids stables + override ephemere par user.
3. Tempo = LWW-register + phase par quantisation (Link -> CRDT, tel quel).
4. Freeze = cache de rendu prouvable par hash (mieux que l'original).
5. Undo per-acteur persistant navigable (mieux que l'original).
6. Blobs = verite, param-list = projection (la regle qui sauve 2.5).
7. Sidechain = resampling = routage a 3 prises (une feature, pas deux).
8. Take lanes = vues sur enregistrement continu (comping sans conflit).
9. Takeover Pick-Up/Value-Scaling comme politique de reprise quand deux
   mains (humaine ou future surface) touchent le meme parametre.
10. Follow Actions avec seed documentee : generatif ET reproductible.
