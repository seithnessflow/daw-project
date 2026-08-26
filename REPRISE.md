# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-26 (fin de seance : rename + Session F5+ + 2 designs).
VOLATILE : etat dans STATUS.md, file dans TODO.md, recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

Arbitrage utilisateur du jour : « les 4 dans l'ordre ». Bilan :

1. **Renommage PARTOUT** : piste / clip / scene au clic droit -> input
   INLINE (Entree commit, Echap annule), undo complet. Les clips ont un
   nom humain (ClipDef.name additif ; un clip MIDI affiche « MIDI »,
   plus jamais d'id brut).
2. **Session F5+** : STOP ALL, stop filtre par scene (le stop d'une scene
   ne tue plus les autres), **launch QUANTISE** (l'ancre pose
   epoque+quantum ; les suivants en file, promotion au sample exact par le
   thread audio), badge « queued » pointille, **verite moteur des slots**
   (SessionState en telemetrie 30 Hz - fini l'etat optimiste seul).
   Gestion scenes : renommer / dupliquer / supprimer, undo qui restaure
   TOUT a sa place. Prouve au pilotage sur moteur reel (traces/f5plus-*).
3. **Automation** : design ecrit, RIEN construit -> docs/AUTOMATION-DESIGN.md
   (decoupage A1-A5 propose). **A ARBITRER.**
4. **P2P engines** : proposition ecrite, RIEN construit ->
   docs/P2P-ENGINES-DESIGN.md (recommandation : E4 MIDI laptop->tour
   d'abord, 2-3 sessions). **A ARBITRER** (4 decisions listees dedans).

**FIX IMPORTANT du jour** (moisson du pilotage) : getLastChange etait
SCALAIRE -> deux mutations avant un envoi = la 1re perdue pour les pairs.
Desormais une FILE drainee par sendLastChange. Classe de bug fermee.

## Point de synchro (A LIRE EN PREMIER)

**CI VERTE sur 3eea6be** (run 32976484517, success). Local : moteur MSVC
**42/42**, cargo test 9/9, **suite e2e complete 49/49**. Le commit BOX
(fenetres de plugin) part APRES cette reecriture — son verdict CI est LE
premier point de synchro de la prochaine session s'il n'est pas note ici.

## Ajout fin de seance : BOX repare + demande drag & drop

Retour utilisateur en direct : « BOX n'ouvre pas le plugin ». Diagnostic
pilote : les fenetres s'OUVRAIENT... derriere Chrome, et --editors (daw.ps1)
ouvrait TOUT au spawn en desaccord avec l'etat du bouton. Corrige :
fenetre TOPMOST tant qu'elle est ouverte (modele Ableton ; l'aller-retour
TOPMOST->NOTOPMOST ne garantissait PAS le dessus -> re-retour utilisateur,
choix v1 a revisiter si le « devant TOUT » gene), la
croix (X) redescend l'etat du ring (reouverture au 1er clic), --editors
retire de daw.ps1 (a la demande = la norme), etat BOX memorise hors DOM
(il survivait pas aux re-rendus + reset a la deconnexion moteur).
Verifie bout-en-bout sur studio (Portal : open -> devant, X -> propre,
reopen -> 1er clic). L'utilisateur veut aussi le DRAG & DROP generalise ->
**docs/DND-DESIGN.md (D1 pistes / D2 devices / D3 navigateur->piste /
D4 clips+slots), A ARBITRER** — attention au piege CRDT (delete+insert
casse l'identite ; pistes = champ order fractionnaire).

## RESTE / prochaine tranche (a arbitrer avec l'utilisateur)

- **Arbitrer les TROIS designs** (automation A1-A5 ; P2P : E4 MIDI
  d'abord ? ; drag & drop D1-D4, recommandation D3 d'abord).
- Ordre grave existant : badges fraicheur deux-machines (geste laptop en
  attente), vague 3 MIDI+instruments (test Massive), AUDIT-5 item 6.
- Au fil de l'eau signale : renommer depuis la tranche mixer ; menage des
  scripts orphelins web/t*.mjs, fp.mjs (non commites, inertes).

## A surveiller (pieges connus)

- **Aucun fichier temp/log de test dans `web/`** (vite surveille -> EBUSY).
  Scratchpad uniquement. (Re-verifie a mes depens ce matin.)
- **Zombies plugin_host/daw_engine au rebuild** :
  `Get-Process plugin_host | Stop-Process -Force` (taskkill echoue).
- sync-resilience.spec spawne SON serveur (port 39917) et le spec
  « offline » compte les pistes via `.track[data-track-id]` (modif de test
  signalee du 2026-08-26 - le selecteur nu attrapait les VU du mixer).
- Le quantum de session = loop_len de l'ANCRE (pas de tempo au schema
  encore) ; stop non quantise (immediat) - choix note, a revisiter avec
  la vague tempo.

## Relancer

`start-daw.cmd` (double-clic) OU `scripts\daw.ps1 -Secure` -> MENU a l'URL
stable `http://localhost:5173/#stoken=<token epingle ~/.daw-server-token>`.
Rebuild moteur : `engine\rebuild_msvc.bat` (tuer les zombies d'abord).
Tests moteur : `engine\build-msvc\daw_engine_test.exe` (42/42). Suite e2e :
`cd web ; npm run test:e2e` (serveur NON-secure + 47821 libre requis).
La manip 5 min : vue Session -> lancer un slot (ancre), lancer un 2e
(pointilles = en file, part au quantum), Q pour commuter, stop all,
clic droit sur une scene (renommer / dupliquer / supprimer).
