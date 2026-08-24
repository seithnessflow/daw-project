# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-24 au matin, apres la session de nuit. Fichier
VOLATILE : reecrit en fin de session ; il ne possede aucune
information — l'etat de reference vit dans STATUS.md, la file dans
TODO.md, le recit dans JOURNAL.md.*

## Ou on en est (30 secondes de lecture)

Les deux moities du differenciateur sont VERTES et validees en reel :
- **Stems S7** : critere 6 vert — le portable rend et JOUE un plugin
  qu'il n'a pas installe, octets identiques a travers le store.
- **Jam S8** : valide a l'oreille (« c'est bon les deux marchent »),
  la tour diffuse, le portable ecoute en P2P, ~40 ms.

Cette nuit, pendant ton sommeil :
1. **Le crash fantome est instrumente** : le moteur est mort 3 fois en
   runs AUDIBLES (0xc0000409 ucrtbase, meme offset, ~2 h de vie, zero
   trace). Un crash handler ecrit desormais ses derniers mots.
2. **Link est cadre ET commence** : docs/LINK-DESIGN.md (la reponse a
   ton « les deux sites sont pas synchronises »), et L1a est LIVRE —
   l'horloge de session mesure, prouvee entre tour et portable
   (symetrie a 5-9 ms a travers hotspot+tunnel). Badge « clk ±N ms ».
3. **Jam UX** : badge permanent (« jam off » est un etat), bouton JAM
   enfonce = potion, vrai bouton ▶ quand le navigateur bloque le son.

Verdicts : moteur 29/29, e2e 33/33, CI verte (commits 0c67697,
d61ad54, 1b35943). Tout est pousse, le portable est a jour.

## Relancer (tour)

- **Tout-en-un** : `scripts\daw.ps1` (audible, projet studio) ou
  `scripts\daw.ps1 -Mute`. `-Stop` pour tout couper.
- **Le montage duo de la nuit** (si la machine n'a pas redemarre, il
  tourne encore : serveur + vite + moteur duo muet pid 28264) :
  l'onglet est `http://localhost:5173/?project=duo`.
- **Portable** : relais + vite + moteur muet en place (WMI, survivent
  au ssh). Procedures deux-machines : STATUS.md.

## A surveiller

- **Si le moteur meurt** : chercher `crash-*.log` dans
  `engine\build-msvc` — c'est LA moisson attendue. Le fantome ne
  frappe qu'en AUDIBLE (le duo muet n'a jamais crashe) ; une session
  d'ecoute longue est le meilleur appat.
- Le badge « clk ±N ms (P) » dans la barre de statut : l'horloge Link
  mesure en permanence des qu'un pair est la.

## La suite (ordre grave au TODO)

1. **L1b — les ancres de transport** : bouton SYNC, PLAY ici = PLAY
   la-bas (position calee par l'horloge L1a, prete). C'est le morceau
   visible du chantier Link.
2. **L1c** : rejoin en cours de lecture, stop synchronise.
3. Ensuite : badge fraicheur stems, TURN, vrais plugins tiers,
   re-passes refonte.

## Decisions qui t'attendent (rien d'urgent)

- **Jam vs sync** (grille 3, propose dans LINK-DESIGN §4) : ecouter le
  jam d'un projet devrait SUSPENDRE la lecture locale (sinon flanger a
  40 ms). Un oui/non suffit.
- **Badge fraicheur des stems** : option (b) proposee au TODO — le
  producteur publie stemFresh, mention « fraicheur inconnue » s'il est
  absent.
