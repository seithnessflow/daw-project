# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-26 au soir (rack en bas + chantiers paralleles).
VOLATILE : etat dans STATUS.md, file dans TODO.md, recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

Grosse journee, 7 pushes, tout verifie :

1. **Renommage partout** (piste/clip/scene, clic droit -> inline, undo).
2. **Session F5+** : stop-all, stop filtre par scene, launch QUANTISE
   (ancre/quantum, promotion au sample), verite moteur des slots (badge
   queued). + FIX file de changes (getLastChange scalaire perdait des
   mutations multi-gestes).
3. **BOX** : fenetres de plugin TOPMOST devant Chrome, croix (X)
   resynchronisee, --editors retire (a la demande), bouton visible.
4. **RACK EN BAS facon Ableton** : panneau device pleine largeur sous
   l'etabli, splitter hauteur, piano-roll large. (.panel-device)
5. **D3 drag & drop** : instruments/effets/samples du navigateur se
   GLISSENT sur les pistes / le vide (nouvelle piste) / les lanes.
6. **A1 automation** : couche DOCUMENT complete (schema additif,
   mutateurs journalises, automationValueAt pur). Moteur ignorant (A2).
7. Les points 5 et 6 = premiers CHANTIERS PAR AGENTS PARALLELES
   (partition stricte de fichiers, integration en serie) - ca marche,
   tsc 0 du premier coup des deux cotes.

## Point de synchro (A LIRE EN PREMIER)

CI VERTE sur 3eea6be, 4f059ec, 7126c65. **Le push 169850d (rack en bas +
D3 + A1, 3 commits) etait EN SENTINELLE a la cloture — verifier son
verdict AVANT de coder** (gh run list). Local : suite e2e complete
**53/53**, tsc 0, gtests moteur 42/42, cargo 9/9.

## RESTE / prochaine tranche (a arbitrer avec l'utilisateur)

- **Automation A2** (moteur : evaluation par sous-bloc, hash deterministe,
  gtest exactitude vs automationValueAt) puis A3 (UI lane).
- **DND D1** (reordonner les pistes - champ order fractionnaire, piege
  CRDT documente dans DND-DESIGN.md), D2 (devices), D4 (clips/slots).
- **P2P E4** (MIDI laptop -> Massive tour, 2-3 sessions) : toujours a
  arbitrer, necessite les deux machines.
- Au fil de l'eau : renommer depuis la tranche mixer ; verite des
  fenetres BOX en telemetrie (apres la croix, l'UI croit « ouvert »
  jusqu'au clic suivant) ; le PORTABLE doit pull+rebuild (ring/proto
  session ont bouge : SessionState, quantize).

## A surveiller (pieges connus)

- **Aucun fichier temp/log de test dans `web/`** (vite -> EBUSY).
- **Zombies plugin_host au rebuild** : Stop-Process -Force ; si un
  survit (HasExited=True mais liste), wmic call terminate.
- La suite e2e exige serveur NON-secure + 47821 libre ; la stack
  utilisateur tourne en SECURE (token epingle) -> basculer puis
  RESTAURER (rode 3x aujourd'hui).
- Fenetres BOX = TOPMOST au-dessus de TOUT (choix v1) - si ca gene en
  multi-apps, affiner.
- Quantum session = loop_len de l'ancre (pas de tempo au schema).

## Relancer

`start-daw.cmd` OU `scripts\daw.ps1 -Secure` -> URL stable a bookmarker :
`http://localhost:5173/#stoken=<token de ~/.daw-server-token>` (menu des
projets ; studio dedans). Rebuild moteur : `engine\rebuild_msvc.bat`
(zombies d'abord). Tests : `daw_engine_test.exe` (42/42) ; e2e : `cd web ;
npm run test:e2e` (53 tests). La manip 5 min : GLISSER un instrument du
navigateur sur une piste (le rack EN BAS montre le device), BOX ->
fenetre devant, vue Session -> lancer 2 slots avec Q (file pointillee,
promotion), stop all.
