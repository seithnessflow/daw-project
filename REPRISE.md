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

Dernier commit **60f2c35**. **TOUT EST POUSSE sur origin/master** (github
seithnessflow/daw-project) : T1-T8, F1-F7, lanceurs, docs, menu, filet e2e,
fix bouton editeur. La tour ET le portable sont a jour.
- **CI VERTE** (run 32908752460) : build-linux ✓ (C++ sur GCC) + test-e2e ✓
  (6m27s, suite complete verte apres le fix clip-selection). Rien a confirmer.
- **PORTABLE valide** : pull, moteur rebuild, gtests **41/41** (dont F5).
- **Bug trouve+corrige par le filet** : le bouton BOX (GUI plugin) etait casse
  depuis T5 (event 'editor-toggle' ne remontait plus, device-view en colonne
  separee) -> listener sur `document`.
- Suite e2e locale : 43/45 (les 2 restants = sync-resilience env local +
  clip-selection, ce dernier fixe apres).

## MENU PRINCIPAL (2026-08-26, f60bf11)

Ecran de selection de projets a une URL STABLE (racine, sans ?project=) :
l'utilisateur bookmarke `localhost:5173/#stoken=<token epingle>` et choisit /
cree un projet. Middleware vite /api/projects + ui/menu.ts (masque les
artefacts e2e timestampes). daw.ps1 ouvre desormais cette URL. Store local
decrasse (954 -> 18 projets, backup dans le scratchpad ; server/projects
gitignore).

## RESTE / a surveiller

- **Le « bug persistance studio » d'hier ETAIT UN FAUX BUG** (diagnostique
  2026-08-26) : mes scripts de test ecrivaient `.etok.tmp` DANS `web/` ->
  vite crashait en EBUSY -> web a moitie synchro. La PERSISTANCE EST SOLIDE
  (verifie disque + reload). LECON : aucun temp de test dans `web/`.
  studio.am est foreign-rooted (pre-graine) mais le web l'adopte.
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
