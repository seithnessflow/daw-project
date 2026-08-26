# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-26 tard (vague parallele 2 : D1+D2+A2).
VOLATILE : etat dans STATUS.md, file dans TODO.md, recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

Journee record, ~10 pushes. Depuis la derniere reecriture :

1. **D1** : les PISTES se reordonnent au drag de la tete (order
   fractionnaire additif - identite CRDT preservee, orderedTracks
   source unique, convergence 2 onglets testee).
2. **D2** : les DEVICES se reordonnent au drag horizontal dans le rack
   (moveProcessor, compromis CRDT documente ; params survivent au move).
3. **A2** : le MOTEUR evalue les enveloppes gain/pan/master (lane
   enabled > manuel), evaluateur C++ miroir exact du TS, PREUVES au bit
   en gtest, et e2e MOTEUR REEL : une lane ecrite par la page pilote
   les VU (automation-engine.spec). Les lanes de device = A4.
4. Tout teste Playwright au maximum (demande utilisateur) :
   **e2e 62/62**, gtests 44/44, tsc 0, cargo 9/9.

## Point de synchro (A LIRE EN PREMIER)

CI VERTE jusqu'a 169850d inclus (+ c3076fd docs). **Le push 93a8c6f
(D1+D2+A2, 3 commits) etait EN SENTINELLE a la cloture — verifier son
verdict AVANT de coder** (gh run list). NB : la CI teste Linux/GCC — le
proto C++ automation y compile pour la premiere fois.

## LECON GRAVEE DU JOUR (build moteur)

**Changer le LAYOUT d'une struct partagee (AudioTrack, AudioGraph...)
=> CLEAN BUILD OBLIGATOIRE** (`ninja clean` puis rebuild) : l'incremental
a produit un moteur live qui mourait en ~5 s (0xC0000005, SANS sortie du
crash handler) avec des gtests VERTS. Symptome = crash inexplicable dont
les chemins sont vides -> soupconner l'ABI avant le code. Et le clean
emporte `create_test_doc.exe` (cible hors build par defaut) : le
reconstruire (`ninja create_test_doc` sous vcvars) sinon 2 specs e2e
sechent.

## RESTE / prochaine tranche (a arbitrer avec l'utilisateur)

- **A3** : l'UI des enveloppes (lane sous la piste, points a la souris) —
  le moteur et le doc sont prets, il ne manque que le dessin.
- **D4** : clips entre pistes + slots Session deplacables.
- **P2P E4** (MIDI laptop -> Massive tour) : toujours en attente, deux
  machines requises.
- Au fil de l'eau : verite BOX en telemetrie ; retry connexion moteur
  initiale ; renommer depuis le mixer.

## A surveiller (pieges connus)

- Layout de struct moteur => clean build (ci-dessus).
- Aucun fichier temp/log de test dans `web/` (vite -> EBUSY).
- Zombies plugin_host : Stop-Process -Force, sinon wmic call terminate.
- Suite e2e = serveur NON-secure + 47821 libre ; la stack utilisateur
  est SECURE -> basculer puis RESTAURER (rode).
- Specs moteur-spawne : purger le token file du port avant spawn +
  attendre « WebSocket server listening » avant d'ouvrir la page.
- Le rack scrolle : scrollIntoViewIfNeeded avant boundingBox en spec.

## Relancer

`start-daw.cmd` OU `scripts\daw.ps1 -Secure` -> URL stable
`http://localhost:5173/#stoken=<token de ~/.daw-server-token>`.
Rebuild moteur : `engine\rebuild_msvc.bat` (zombies d'abord ; layout
change = ninja clean avant). Tests : daw_engine_test 44/44 ; e2e 62.
La manip 5 min : REORDONNER les pistes en tirant leur tete, reordonner
les devices du rack en tirant leur barre de titre, glisser un instrument
du navigateur sur une piste, BOX -> fenetre devant. L'automation
s'entend deja au moteur (gain/pan) mais ne se dessine pas encore (A3).
