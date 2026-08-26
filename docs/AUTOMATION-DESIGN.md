# AUTOMATION-DESIGN.md — enveloppes de parametres (proposition, a arbitrer)

*Ecrit le 2026-08-26 (tranche 3 de la reprise : « design d'abord »). PROPOSITION —
rien n'est construit. L'arbitrage utilisateur decide du decoupage et du GO.*

## Ce qu'on construit (vision en une phrase)

Une ENVELOPPE = une courbe temps -> valeur attachee a un parametre (gain de
piste, pan, param de device natif ou VST3, master), dessinee dans
l'arrangement, jouee par le moteur, deterministe au rendu, convergente en
collaboration.

## 1. Modele de donnees (schema, ADDITIF — pas de migration)

```
TrackDef.automation?: AutomationLaneDef[]     // additif, absent = rien
ProjectDef.automation?: AutomationLaneDef[]   // lanes du MASTER

AutomationLaneDef {
  id: string
  target: {
    processorId?: string   // absent = parametre de PISTE (gain/pan)
    param: string          // 'gain' | 'pan' | cle native ('drive') | id VST3 decimal ('0')
  }
  points: { t: number; v: number }[]   // t en SAMPLES timeline, v normalise 0..1
  enabled: boolean                     // bypass de la lane (l'etat manuel reprend)
}
```

Decisions :
- **v normalise 0..1** partout, mappe par le consommateur (les specs d'unites
  NATIVE_PARAM_SPECS existent deja cote UI ; VST3 est deja normalise). Evite
  de graver des unites dans le document.
- **Interpolation lineaire v1.** Un champ `shape` additif par point viendra
  plus tard (les courbes n'invalident pas le format).
- **Points = liste Automerge d'objets {t,v}** : deux pairs qui editent des
  points differents mergent naturellement ; le drag d'un point reecrit
  CE point (LWW par champ).
- Pas d'automation de clip/Session en v1 (les enveloppes de clip Ableton
  viendront avec leur propre cadrage).

## 2. Moteur (determinisme d'abord)

- Evaluation PURE f(t) par sous-bloc : valeur de l'enveloppe au debut du
  sous-bloc (256 frames), appliquee comme cible. Les nodes natifs ont deja
  des cibles lissees (UtilityNode & co) : les marches de 256 samples sont
  absorbees — pas de zipper. VST3 : setParam par bloc via le ring (le chemin
  EXISTANT des params, rien de neuf sur le fil).
- **Le hash de rendu reste deterministe** : f(t) ne depend que du document.
  Gtest : rendu avec enveloppe = hash stable sur 2 rendus ; enveloppe plate
  a v = rendu identique au param statique v (preuve d'exactitude).
- **Cle de stem** : les params d'un node font partie des entrees du stem —
  une lane enabled qui CIBLE le node entre dans la cle (sinon un stem
  perime resterait « frais »). C'est le point le plus delicat : la cle
  integre un hash des points de la lane.
- Priorite : lane enabled > etat manuel. Toucher un knob d'un param automate
  ne REECRIT PAS l'enveloppe en v1 (pas de punch/latch — c'est un mode
  d'enregistrement, cadrage ulterieur).

## 3. UI (arrangement)

- Une LANE d'automation repliable SOUS la lane de clips, par piste : selecteur
  de cible (gain / pan / params des devices de la chaine), courbe + points.
- Gestes : double-clic = ajouter un point ; drag = deplacer ; clic simple =
  selectionner ; Delete = supprimer ; clic droit contextuel (supprimer la
  lane, bypass, revenir a plat). REGLE GRAVEE des poignees : chaque point a
  sa branche « clic sans mouvement ».
- Le pan/gain de la tete de piste montre la valeur JOUEE (l'automation
  anime le knob, grise l'input manuel quand une lane enabled le pilote —
  regle « une action montre TOUS ses effets »).

## 4. Undo

Ops journalisees : addLane / deleteLane (capture la lane entiere) /
setLaneEnabled / addPoint / movePoint / deletePoint. Un drag de point = un
groupe (meme moule que les faders).

## 5. Decoupage propose (sessions bornees)

| # | Contenu | Livrable visible |
|---|---------|------------------|
| A1 | Schema + mutateurs + undo + SCHEMA.md + spec e2e doc | 2 onglets convergent sur une enveloppe |
| A2 | Moteur natif : gain/pan/params natifs + gtests hash & exactitude | rendu WAV : fondu automate audible, hash stable |
| A3 | UI lane (points, drag, contextuel) + trace visuelle | dessiner un fondu a la souris, l'entendre |
| A4 | VST3 params + cle de stem etendue + gtest stem | wobble de cutoff sur plugin, stem juste chez le pair |
| A5 | Courbes (shape), copier/coller, densification | confort |

Ordre A1->A2->A3 obligatoire (le document avant le son, le son avant la
souris). A4 peut suivre A2 si le test Massive (vague MIDI) presse.

## Ce qui est explicitement HORS v1

Enregistrement live des mouvements (punch/latch), automation de tempo (le
tempo n'existe pas encore dans le schema), enveloppes de clip Session,
courbes non lineaires, LFO/modulateurs.
