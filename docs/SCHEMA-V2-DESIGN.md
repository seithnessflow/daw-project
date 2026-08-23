# SCHEMA v2 — dossier de conception (placement, stems, MIDI)

*Session de design de l'entrelacs (2026-08-23), APRES critere-3-vrai.
Statut : PROPOSITION — rien ici n'est implemente ; l'implementation
suit l'ordre grave (2.5-etat -> stems S7 -> streaming). Les clips MIDI
sont co-designes ICI pour ne pas dessiner deux fois (pont vague 3),
mais leur implementation attend la vague 3.*

## Intrants graves (recadrage ADR-019 + reviewer 2026-08-23)

1. L'INVARIANT : un pair sans le plugin installe entend le resultat du
   plugin. Chemin : placement (le document dit ou est chaque plugin) +
   stems rendus via le store (verite de lecture) + streaming P2P (jam).
2. Cle de stem = CLE DE CACHE D'ENTREES — version/build du plugin et
   samplerate DANS la cle ; jamais d'assertion de re-rendu bit-exact
   d'un tiers (les VST ne sont pas deterministes).
3. Stem perime = ETAT D'UI (jamais un blocage de lecture) ; un stem
   SURVIT a son producteur ; PDC cuite ou declaree.
4. Params pilotes via CRDT ; GUI et binaire de plugin ne traversent
   JAMAIS (la ligne juridique).
5. Gros blobs HORS du CRDT : le document porte des references
   contenu-adressees (le store existant est le mecanisme).

## 1. Ce qui reste v1-compatible (ADDITIF, pas de migration)

Le mecanisme migrate() reste vierge jusqu'a la vague 2 (tempo, qui
re-exprime les positions — la VRAIE migration). Tout ce dossier tient
en champs ADDITIFS sur schemaVersion 1 : un vieux client ignore ce
qu'il ne connait pas, un vieux document a des defauts surs.

## 2. Etat de plugin (prerequis 2.5 — l'implementation suivante)

```jsonc
// ProcessorDef, champs additifs
{
  "id": "...", "type": "vst3", "uid": "...", "bypass": false,
  "params": [ { "key": "0", "value": 0.5 } ],
  // NOUVEAU — etat opaque, hors CRDT, contenu-adresse :
  "stateHash": "sha256-hex",        // blob combine Comp+Cont au store
  "stateVersion": 3                 // compteur LWW (le dernier ecrit gagne)
}
```

- Le blob est UN objet au store (`<hash>.vst3state`) : concatenation
  longueur-prefixee des deux flux VST3 (Component puis Controller),
  restauration processor-first (intrant SDK grave).
- Ecriture : l'hote serialise apres un geste (debounce), pousse au
  store, PUIS ecrit stateHash dans le document. Un pair qui n'a pas le
  plugin ignore le champ (il lira le STEM).
- `stateVersion` existe parce que deux hashes ne s'ordonnent pas :
  merge concurrent -> LWW sur la paire (version, hash), pas de fusion
  d'etats binaires (impossible par nature).

## 3. Stems (le differenciateur, jalon S7)

### La cle (cache d'entrees, jamais une promesse de determinisme)

```
stemKey = sha256(
  "stem-v1" |
  uid | pluginVersion | sampleRate |
  stateHash | sortedParams |
  entree audio du noeud : liste ordonnee des (assetHash, geometrie
  de clip, fades, gain de piste en amont du noeud)
)
```

- `pluginVersion` : la chaine de version du binaire local (moduleinfo
  ou classinfo). Deux machines avec deux builds -> deux cles -> deux
  stems ; c'est VOULU (amendement reviewer : cle de cache, pas
  d'assertion bit-exacte).
- La cle se calcule SANS rendre : elle dit « ce stem correspond-il aux
  entrees actuelles ? ». Perime = la cle stockee ne matche plus la cle
  recalculee -> ETAT D'UI (badge), la lecture continue sur le stem
  perime (il survit a son producteur).

### Le document (additif)

```jsonc
// ProcessorDef, champs additifs
{
  "stemHash": "sha256 du WAV rendu au store",   // l'audio, verite de lecture
  "stemKey": "sha256 des entrees (ci-dessus)",  // fraicheur, cote UI
  "stemLatencySamples": 512                      // PDC : declaree avec le stem
}
```

- STEM PAR NOEUD (pas par piste) : un pair sans LE plugin X mais avec
  le plugin Y joue clips -> Y (natif) en consommant le stem de X en
  entree ? NON — trop de topologies. DECISION SIMPLE S7 : le stem
  couvre le noeud ET tout l'amont de sa chaine (post-clips,
  pre-gain-de-piste). Un pair sans le plugin substitue TOUTE la chaine
  de la piste par le stem du DERNIER noeud vst3 injouable. Simple,
  audible, honnete ; le raffinement par-noeud est une dette datee.
- PDC : `stemLatencySamples` = latence declaree par la chaine au moment
  du rendu. Le lecteur du stem compense (avance de lecture), la ou
  l'hote local compense le plugin vivant : les deux pairs entendent le
  meme alignement (« cuite ou declaree » : ici declaree, cuite refusee
  car elle rendrait le stem inutilisable comme entree de re-rendu).
- Producteur : la machine qui A le plugin rend le stem OFFLINE (le
  moteur sait deja : offline_render partage le noyau), le pousse au
  store, ecrit (stemHash, stemKey, stemLatencySamples). Declencheur :
  geste utilisateur « figer » d'abord (S7), automatisation debounce
  ensuite (dette datee — l'inversion d'automatisation arbitree).

### Lecture (le pair sans plugin)

- buildGraph : noeud vst3 dont l'uid ne resout pas localement ->
  si stemHash present : ClipPlayer sur le stem (le store le fetch
  comme tout asset), chaine amont SAUTEE, badge « stem » cote UI.
  Sinon : comportement actuel (noeud saute, signale — R5).

## 4. Clips MIDI (co-design, implementation vague 3)

```jsonc
// ClipDef, champs additifs
{
  "type": "midi",              // absent = "audio" (defaut sur)
  "notes": {                   // MAP a ids stables, jamais une liste
    "n-<ulid>": {
      "pitch": 60,             // MIDI note number
      "velocity": 100,         // 1..127
      "startSample": 0,        // relatif au clip ; re-exprime en beats
      "lengthSamples": 24000   //   par la migration tempo (vague 2)
    }
  }
}
```

- MAP et pas liste : deux pairs qui posent des notes en concurrence
  mergent par union d'ids (le moule automation §4, merge-clean) ; une
  liste Automerge divergerait sur les insertions concurrentes.
- Un clip midi n'a NI assetHash NI offsetSamples ; l'audio d'un clip
  midi = l'instrument du chain (bus event-in/audio-out, vague 3).
  assetHash devient optionnel-si-midi (garde de validation, pas de
  migration).
- Les stems couvrent AUSSI les pistes instrument : memes champs, la
  cle inclut le contenu des notes a la place des assetHash.

## 5. Ordre d'implementation (inchange, grave au TODO)

1. 2.5-ETAT : stateHash/stateVersion + store `.vst3state` (prerequis
   de la cle de stem).
2. STEMS S7 : rendu offline du noeud + champs stem + lecteur stem +
   badge fraicheur. JALON : le portable joue AGain qu'il n'a pas —
   preuve par echantillons a travers le store.
3. STREAMING jam (canal ephemere, coupe si deborde).
4. MIDI : vague 3, sur ce design.

## Questions restees OUVERTES (a trancher a l'implementation)

- Format exact du blob combine Comp/Cont (longueur-prefixe vs deux
  objets au store) — trancher en 2.5 avec le code du host sous les yeux.
- Le stem d'une piste a N vst3 : un seul stem au dernier noeud (choix
  S7) — verifier que le badge UI reste lisible quand seul le premier
  noeud manque.
- Invalidation : recalcul de stemKey a chaque rebuild (cheap, in-memory)
  vs a chaque change (plus fin) — mesurer d'abord.
