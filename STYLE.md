# STYLE.md — la memoire de gout de Magic Potion

*Cree a l'ouverture de la phase 3 (2026-08-22). Regle : tout verdict de
gout generalisable rendu en co-presence entre ici, date. Ce fichier fait
foi ensuite — on ne re-litige pas ce qui est tranche ; l'agent applique
d'office. Statut PROPOSE = defaut choisi par l'agent, en attente du
verdict humain.*

## Garde-fou grave (du brief, non negociable)

Le bonbon est SENSORIEL, jamais notificationnel. Pas de popups, pas de
badges, pas de confettis, pas de sons d'interface. La recompense est
dans la matiere qui repond, pas dans un systeme qui felicite.

## Durees (PROPOSE — a trancher en co-presence phase 3)

- Transitions d'etat (boutons, chips) : 80 ms
- Reponse des clips (filtre/pulse) : 60 ms
- Pop de valeur (gain change) : 160 ms ease-out
- Atterrissage d'un clip pose : 220 ms ease-out
- Tamisage solo (couche de vie) : 180 ms
- Tenue de crete des VU : 1 s ; chute balistique : ~300 ms pleine echelle
  (VALIDE de fait par la phase 2 — les meters mentaient sans elle)

## Couleur (acquis des sessions precedentes)

- La couleur est reservee a L'ETAT et au CONTENU ; le chrome reste gris.
- Etats : mute orange, solo bleu, bypass ambre (rond allume = actif),
  record rouge (reserve), clip > -1 dBFS rouge.
- Saturation de base des pistes : 45 % (mode C la module par l'activite :
  8 %..50 %).

## Verdicts co-presence (a remplir)

*(vide — la phase 3 les engrangera : A/B/C gardes ou non, durees
ajustees, toute phrase de gout generalisable.)*
