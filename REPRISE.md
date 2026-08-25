# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-25 (fin de seance UI : refonte T1-T8 + finition F1-F7).
VOLATILE : etat dans STATUS.md, file dans TODO.md, recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

**L'INTERFACE EST FINIE.** Grosse seance UI en deux temps :

1. REFONTE TOTALE « l'etabli Magic Potion » (T1-T8, 8 commits, deja livree
   avant cette reprise) : etabli 3 colonnes (navigateur / arrangement /
   rack), command bar cuivre, commutateur de paradigmes
   Arrangement / Session / Mixage (presentation LOCALE par onglet).

2. FINITION F1-F7 (chantier « finir l'interface », plan approuve), TOUT
   livre et verifie en PILOTANT le vrai navigateur/moteur :
   - **F3** VU master du mixer (bug) + LED cuivre ; **F4** knobs rotatifs
     du rack ; **F6** onglet Samples du navigateur (source unique) ;
     **F7** splitters de colonnes (localStorage) + undo des notes +
     reduced-motion/focus. [tout web]
   - **F1** bouton BOX = fenetre GUI de plugin **A LA DEMANDE** (ring v9,
     editor_open moteur->enfant). REGLE le cas Massive X : ouvrir la GUI,
     choisir un preset. Verifie sur Dexed.
   - **F2** pan de piste (post-chain, loi lineaire centre-neutre : pan 0
     inchange -> hash/loudness preserves). Verifie au rendu offline.
   - **F5** launch LIVE des slots Session = **HORLOGE DE SESSION LIBRE**
     (choix utilisateur « la plus elegante ») : les slots jouent en boucle
     PAR-DESSUS un arrangement ARRETE. Verifie bout en bout (Dexed sonne
     transport a l'arret, stop -> silence exact, 0 note bloquee). 41/41
     gtests (dont le nouveau test du scheduler emitSessionLoop).

3. Lanceurs double-cliquables **start-daw.cmd** / **stop-daw.cmd** (demande
   utilisateur) : delegue a daw.ps1 -Secure, ouvre le site sur studio.

## Point de synchro (A LIRE EN PREMIER)

Dernier commit **19d8ac0** (lanceurs). Serie de la seance :
2ffdacc F3, 89692bd F4, bb10cf1 F6, e08ca25 F1, ecea0a0 F2, 4bdcabb F7,
2650ac4 F5, 19d8ac0 lanceurs. Ce depot n'a PAS de remote / pas de CI
observee cette seance (travail local, tout committe). Le moteur a ete
rebuild plusieurs fois (ring v8->v9, pan, session) ; binaires a jour dans
engine\build-msvc. gtests **41/41** au dernier run.

## RESTE / a surveiller

- **SIGNALEMENT (niveau 2, pas notre code)** : le doc `studio` se
  REINITIALISE par moments — pendant les tests F5, des ajouts web
  (session clips) DISPARAISSAIENT entre deux runs. Sent une persistance
  serveur fragile (le serveur ne persiste pas / re-lit le .am du disque ?).
  A regarder en session dediee ; sans rapport avec la refonte UI.
- **Detail non fait (assume)** : la restructure en onglets Rack/Piano-roll
  de la colonne droite (F7) — laissee, l'empilement actuel fonctionne.
- **Zombies plugin_host** : au rebuild moteur, `taskkill` echoue sur eux ;
  `Get-Process plugin_host | Stop-Process -Force` (ou wmic call terminate)
  marche. LNK1168 sur plugin_host.exe = un zombie tient le fichier.
- **Reprise du CAP produit** : l'UI etant finie, le prochain grand chantier
  reste l'axe differenciateur / P2P (cf TODO.md ORDRE GRAVE + le grand
  chantier P2P engines note en memoire). Rien d'ouvert a mi-course.

## Relancer

`start-daw.cmd` (double-clic) OU `scripts\daw.ps1 -Secure`. Bookmark
stable : `http://localhost:5173/?project=studio#stoken=<token epingle
~/.daw-server-token>`. Rebuild moteur : `engine\rebuild_msvc.bat` (tuer
les plugin_host zombies d'abord). Tests : `engine\build-msvc\daw_engine_test.exe`.
