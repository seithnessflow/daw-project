# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-26 (fin de seance : UI finie + menu + clic droit contextuel).
VOLATILE : etat dans STATUS.md, file dans TODO.md, recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

**L'INTERFACE EST FINIE, POLIE, POUSSEE, CI VERTE.** Plusieurs seances UI
condensees :

1. **Refonte T1-T8** « l'etabli Magic Potion » : 3 colonnes (navigateur /
   arrangement / rack), command bar cuivre, commutateur de paradigmes
   Arrangement / Session / Mixage (presentation LOCALE par onglet).
2. **Finition F1-F7** : F1 bouton BOX (GUI plugin a la demande, ring v9 -
   regle le cas Massive X) ; F2 pan de piste (post-chain, loi lineaire
   centre-neutre) ; F3 VU master mixer ; F4 knobs rotatifs ; F5 **launch LIVE
   des slots Session** (horloge de session LIBRE - jam par-dessus un
   arrangement arrete) ; F6 onglet Samples ; F7 splitters + undo notes.
3. **Menu principal** : selecteur de projets a une URL STABLE (racine, sans
   ?project=). Store decrasse (954 -> 18 projets).
4. **Onglets Rack / Piano-roll** (colonne droite) + **CLIC DROIT CONTEXTUEL
   par zone** (clip / piste / device / slot Session / tranche mixer).
5. **Filet de regression e2e** du rework (specs ui-*) - a trouve + fait
   corriger un VRAI bug (bouton editeur casse depuis T5).
6. **Lanceurs** start-daw.cmd / stop-daw.cmd.

## Point de synchro (A LIRE EN PREMIER)

Dernier commit **3c16037**. **TOUT POUSSE sur origin/master** (github
seithnessflow/daw-project), **CI VERTE a chaque push** (build-linux GCC +
test-e2e complet). Rien en attente, rien a confirmer. Le PORTABLE est a jour
jusqu'a eed3e9a (pull + rebuild + gtests 41/41) ; `git pull` le remet a niveau.

## RESTE / prochaine tranche (a arbitrer avec l'utilisateur)

Rien d'ouvert a mi-course. Directions possibles (cf TODO.md « PRIORITES A LA
REPRISE ») :
- **Petit polish UI** : renommer piste/clip (manque une methode schema
  renameTrack - bon candidat pour enrichir le clic droit) ; les clips
  affichent leur id brut (regex de nom a corriger).
- **Session performante** (F5+) : stop-all, launch quantise, gestion scenes.
- **Automation** (grande couche : enveloppes de parametres) - design d'abord.
- **Cap differenciateur / P2P** (placement, MIDI laptop -> Massive sur la
  tour) - ARCHITECTURE : proposer un design, ne pas construire a l'aveugle.

## A surveiller (pieges connus)

- **Aucun fichier temp de test dans `web/`** : vite le surveille, un temp
  ecrit la (ex `.etok.tmp`) crashe le watcher (EBUSY) et desynchronise le web.
  Scratchpad uniquement. (C'etait la cause du faux « bug de persistance ».)
- **Zombies plugin_host** au rebuild moteur : `taskkill` echoue ; utiliser
  `Get-Process plugin_host | Stop-Process -Force`. LNK1168 = un zombie tient
  l'exe.
- Le doc `studio` est foreign-rooted (pre-graine) mais le web l'adopte -
  persistance verifiee solide (disque + reload).

## Relancer

`start-daw.cmd` (double-clic) OU `scripts\daw.ps1 -Secure` -> ouvre le MENU a
l'URL stable `http://localhost:5173/#stoken=<token epingle ~/.daw-server-token>`
(on choisit/cree un projet la). Rebuild moteur : `engine\rebuild_msvc.bat`
(tuer les plugin_host zombies d'abord). Tests moteur :
`engine\build-msvc\daw_engine_test.exe` (41/41). Suite e2e : `cd web ; npm run
test:e2e` (serveur NON-secure + 47821 libre requis).
