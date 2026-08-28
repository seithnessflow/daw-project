# DND-DESIGN.md — drag & drop generalise (proposition, a arbitrer)

*Statut (2026-08-28) : LIVRE — D3 (2026-08-26 soir), D1 + D2 (nuit du
26), D4 clips entre pistes + slots Session (2026-08-27). `TrackDef.order`
fractionnaire documente dans docs/SCHEMA.md ; `moveProcessor` en
remove+insert avec sa fenetre de perte concurrente assumee.*

*Ecrit le 2026-08-26 (demande utilisateur : « pouvoir drag and drop un peu
tous les elements, track, plugins, instruments »). PROPOSITION — decoupage
a arbitrer, rien construit.*

## Ce qui existe deja

Clips : drag horizontal sur leur piste (poignee), resize, fades. Samples :
armement + clic pour poser (pas un vrai drag). Rien d'autre ne se deplace.

## Le point d'architecture qui commande tout (CRDT)

Reordonner par delete+insert dans une liste Automerge DETRUIT l'identite de
l'objet : un pair qui bougeait le gain de la piste pendant qu'on la deplace
perd son edit (l'objet reinsere est un NOUVEL objet). Deux reponses selon
la liste :

- **Pistes** : champ additif `TrackDef.order?: number` (indexation
  fractionnaire : inserer entre a et b = (a+b)/2). L'objet ne bouge JAMAIS
  dans la liste -> identite preservee, LWW par champ, collaboration sure.
  Tous les consommateurs trient par (order, index). Le moteur n'a pas
  besoin de l'ordre des pistes (mix additif) -> changement WEB seul.
- **Devices (chaine)** : l'ordre EST le sens (pipeline) et le moteur lit
  l'ordre du tableau. Le champ order y serait un changement de contrat sur
  3 etages. Propose : v1 = moveProcessor(remove+insert de la MEME def,
  moule exact de l'undo existant), fenetre de perte concurrente assumee et
  documentee (un device se deplace rarement pendant qu'un pair tourne ses
  knobs) ; le champ order viendra si la collaboration s'y cogne.

## Decoupage propose (sessions bornees)

| # | Geste | Contenu | Est. |
|---|-------|---------|------|
| D1 | Reordonner les PISTES | order fractionnaire + drag de la tete (poignee = zone nom, regle du clic simple preservee) + undo + spec 2 onglets | 1 session |
| D2 | Reordonner les DEVICES | drag du panneau dans le rack, moveProcessor + undo + garde hash (l'ordre change le son : rendu attendu different, test explicite) | 1 session |
| D3 | NAVIGATEUR -> piste | drag d'un instrument/effet du navigateur sur une piste (drop = addProcessor) ou sur le vide (= nouvelle piste + instrument, geste Ableton) ; les samples y gagnent le meme vrai drag vers une lane | 1 session |
| D4 | Clips ENTRE pistes + slots Session | drag vertical des clips (changer de piste = delete+add meme id ? NON : meme probleme d'identite -> deplacer = supprimer/recreer ASSUME, un clip n'a pas d'edits concurrents fins hors notes) ; slots Session deplacables entre cellules | 1-2 sessions |

Ordre recommande : D3 (le plus visible, zero probleme CRDT) -> D1 -> D2 -> D4.

## Regles gravees qui s'appliquent

Chaque poignee garde sa branche « clic sans mouvement » (selection) ;
tout drag = un groupe d'undo ; trace visuelle par session.
