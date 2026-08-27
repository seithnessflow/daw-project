# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-27 (cloture session AUDIT-6). Digest operationnel ;
les proprietaires restent STATUS.md (etat), TODO.md (file), JOURNAL.md
(recit date).*

## L'ETAT EN UNE PHRASE

Le DAW est JOUABLE (etat du 27/08 au matin inchange : e2e 70/70,
moteur 45/45, CI verte) et il est desormais AUDITE EN PARITE :
docs/AUDIT-6.md compare le code a Ableton/Cubase (~35 constats, a
RATIFIER) — aucune ligne de code n'a bouge cette session.

## POINT DE SYNCHRO (A LIRE EN PREMIER)

**Verdict CI du push AUDIT-6 (docs seuls : AUDIT-6.md, TODO, JOURNAL,
REPRISE)** : verifie ou a verifier via `gh run list` — attendu VERT
(aucun code touche). Les pushes precedents du 26-27 sont tous verts
(seul 92dd535 fut rouge, corrige en 385facf).

## CE QUE LA SESSION A LIVRE (2026-08-27, audit lecture seule)

**docs/AUDIT-6.md — parite conceptuelle vs Ableton/Cubase.** Methode
AUDIT-5 (3 lectures paralleles exhaustives UI/moteur/schema+serveur,
croisees avec ABLETON-INTEGRALE / SCHEMA-V2 / LINK-DESIGN). Chaque
constat etiquete : [DESIGNE] (deja concu chez nous) / [REFUSE] (refus
ecrit qui tient) / [SOUS-PESE] (nomme mais poids en cascade jamais
ecrit) / [NOUVEAU] (jamais nomme — la valeur ajoutee).

Le titre : moteur de LECTURE collaboratif, pas encore un DAW —
1) rien n'ENTRE (aucun enregistrement audio a aucun etage, aucune
entree MIDI vive nulle part, import WAV seul) ; 2) rien ne SORT
(aucun export UI — le moteur sait rendre, aucun fil n'y mene) ;
3) le TEMPS MUSICAL n'existe pas (connu, « LA migration » — l'audit
ajoute la liste de ce qu'il bloque, dont ProcessContext jamais passe
aux VST3).

Les [NOUVEAU] qui pesent sur LE GROS CHANTIER a choisir :
- E4 Massive suppose un clavier : AUCUN etage ne lit le MIDI vif, et
  le ring ne porte que note-on/off (pas de CC64 = pas de pedale).
- Vague 3 : les notes sont une LISTE sans id, contre le design
  map-a-ids de SCHEMA-V2 §4 (divergence CRDT que notre propre design
  ecartait) ; velocite ineditable (100 en dur) ; latence figee
  (buffer 512 en dur, pas d'ASIO/exclusif, pas de reglage).
- Mix : master sans chaine (aucun limiteur possible), mute ephemere
  non partage (concept a trancher), comp sans GR meter,
  chevauchement de clips = SOMME (concept a trancher).
- Donnees : /api/projects = middleware VITE (pas le serveur — en prod
  pas de menu projets) ; aucune sauvegarde de secours des .am.
Quick wins proposes : export mixdown UI, boucle utilisateur (la bande
ruler-cycle attend), pre-ecoute samples, GR meter, dr_flac/dr_mp3.

## LA DECISION OUVERTE (inchangee + enrichie)

« Fini les chantiers entames, on commencera un gros chantier. »
Candidats : P2P E4 Massive (2 machines) / Effets natifs 4.2-4.3 /
Vague 3 MIDI / AUDIT-5 a ratifier — ET DESORMAIS : AUDIT-6 a ratifier
(ses PREALABLES chiffrent les candidats : lire l'arbitrage propose en
fin de docs/AUDIT-6.md AVANT de choisir). La roadmap parite reste
GELEE ; rien de l'audit n'entre en file sans ratification.

## A SURVEILLER (pieges payes — inchanges du 27/08)

- Layout d'une struct moteur partagee change => CLEAN BUILD (ninja
  clean) ; symptome : crash 0xC0000005 avec gtests verts.
- Zombies plugin_host avant rebuild (Stop-Process -Force ; wmic pour
  le recalcitrant). Aucun fichier temp/log de test dans web/ (EBUSY).
- Suite e2e = serveur NON-secure + port 47821 libre ; la stack
  utilisateur est SECURE — basculer puis RESTAURER.
- endUndoGroup ne compte pas les imbrications. Quantum de session =
  loop_len de l'ANCRE. Le seed s'affiche AVANT la sync serveur (toute
  sonde attend tracks.length).
- 4 fichiers de sonde non suivis a la racine web/ (fp.mjs, t3.mjs,
  t3.png, t7.mjs) + traces/box-3-open.png modifie : menage a faire a
  la prochaine session de code (pas commite avec l'audit).

## RELANCER / VERIFIER

- Stack : `start-daw.cmd` ou `scripts\daw.ps1 -Secure` ; arret
  `stop-daw.cmd`. Moteur : `engine\rebuild_msvc.bat` (zombies
  d'abord) ; tests `daw_engine_test.exe` (45/45). Web : `cd web ;
  npm run test:e2e` (70). Oreille : `npm run ear -- --project studio
  --probe` (jamais d'ecoute avant porte verte).
- **La manip 5 minutes de CETTE session** : ouvrir docs/AUDIT-6.md,
  lire « Le titre de l'audit » puis « ARBITRAGE PROPOSE » (2 pages) —
  c'est le resume decisionnel ; le reste du rapport se lit par
  section au moment de ratifier.
