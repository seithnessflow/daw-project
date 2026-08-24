# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-24 (fin de journee, session L1b). Fichier VOLATILE :
reecrit en fin de session ; il ne possede aucune information — l'etat
de reference vit dans STATUS.md, la file dans TODO.md, le recit dans
JOURNAL.md.*

## Ou on en est (30 secondes de lecture)

**L1b EST LIVRE : PLAY ici = PLAY la-bas.** Le bouton SYNC (opt-in,
barre transport) diffuse des ancres {playing, posSec, t} sur le relais
signal:, traduites chez le recepteur avec l'offset COURANT de
l'horloge L1a, qui cale son moteur la ou l'ancre dit qu'on doit etre.
Garde transport-sync.spec (traduction prouvee contre timeOrigin),
suite e2e 34/34, sonde pilote deux-moteurs : ecart 0 ms, verdict
< 50 ms VERT. Commit f9f195f pousse, **CI VERTE** (run 32699124571).

## LA MANIP (5 minutes, elle t'attend)

Deux onglets sont OUVERTS dans Chrome (projet ma-piece, ear VERT) :
deux moteurs locaux — 47821 AUDIBLE, 47822 muet (`?engine=47822`).
**Presse PLAY dans l'onglet 47822 (muet) : le son sort de l'autre
moteur, les deux tetes de lecture courent ensemble, le bouton SYNC
flashe quand l'ancre distante pilote.** STOP suit aussi. Si les
onglets sont fermes :
`http://localhost:5173/?project=ma-piece&sync=1` et
`http://localhost:5173/?project=ma-piece&sync=1&engine=47822`.

## Relancer

- Stack de la manip : serveur (cargo run) + vite + 2 moteurs tournent
  (lances a la main cette session). Tout couper :
  `scripts\start-stack.ps1 -Stop` + `Get-Process daw_engine | Stop-Process`.
- Tout-en-un habituel : `scripts\daw.ps1` (ou -Mute), `-Stop`.

## A surveiller

- Le commit REPRISE qui suit f9f195f est DOC-ONLY : si sa CI n'est pas
  verte au prochain demarrage, c'est un caprice d'infra, pas du code.
- **EAR ROUGE sur le projet duo** : 2 discontinuites (saut 0.9) au
  rendu — le projet de la chasse au crash est INAPTE A L'ECOUTE, a
  trier (contenu abime ou bug de rendu ?). ma-piece est VERT.
- **`--play` joue DES LE LANCEMENT du moteur** : un moteur audible
  lance sur un projet avec contenu joue immediatement (constate : 48 s
  de ma-piece au lancement du banc). Candidat : demarrer arrete
  (--start-stopped) — a arbitrer.
- Le crash fantome (0xc0000409) : chercher `crash-*.log` dans
  engine\build-msvc apres toute session audible longue.
- Badge « clk ±N ms » : entre onglets d'ages differents il affiche des
  DIZAINES DE SECONDES (epoques par onglet — correct mais alarmant) ;
  critique consignee, grille 3.

## La suite (ordre grave au TODO)

1. **L1c — polissage Link** : rejoin en cours de lecture (ancres
   re-diffusees a l'arrivee d'un pair), stop/arret synchronise fin,
   ET l'arbitrage jam-vs-sync (LINK-DESIGN §4) a appliquer.
2. Ensuite : badge fraicheur stems, TURN, vrais plugins tiers.
3. Le test REEL deux machines de L1b (tour + portable, verdict a
   l'oreille) — la sonde locale est verte, le reel reste le juge.

## Decisions qui t'attendent (rien d'urgent)

- **Jam vs sync** (grille 3, LINK-DESIGN §4) : ecouter le jam d'un
  projet devrait SUSPENDRE la lecture locale (sinon flanger a 40 ms).
  Un oui/non suffit — necessaire pour L1c.
- **Badge fraicheur des stems** : option (b) proposee au TODO.
- Ultrareview PR #1 : 1 finding (nit ?server=), DEJA corrige dans
  master (server-param.spec le garde) — commentaire poste sur la PR.
