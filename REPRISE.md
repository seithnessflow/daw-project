# REPRISE.md — point de reprise au demarrage

*Reecrit le 2026-08-27 (audio repare + preuve par etage + chantiers
entames soldes). VOLATILE : etat STATUS.md, file TODO.md, recit JOURNAL.md.*

## Ou on en est (30 secondes)

**LES CHANTIERS ENTAMES SONT SOLDES.** Depuis la derniere reecriture :

1. **Audio de studio repare** (retour « j'ai pas l'audio comme il faut ») :
   4 faders etaient a gain=0 dans le doc (pistes muettes) -> 0 dB ;
   master a -2 dB (le mix cretait au-dela de -1 dBFS) ; porte ear VERTE.
2. **PREUVE AUDIO PAR ETAGE** (idee utilisateur) : peak/rms/hash entre
   chaque maillon de chaque piste. `npm run ear -- --project studio
   --probe` imprime la table. gtest 45/45, deterministe, exact au bit.
3. **Gestes complets vague 1** : drop d'un plugin SUR le rack (a la
   position), clic droit navigateur, dblclick barre = fenetre plugin.
   + menu « + device » en FIXED (il etait tronque par le panneau bas).
4. **A3 enveloppes** : bouton A par piste, lane sous la piste, courbe
   SVG, dblclick/drag/clic-droit, ON/off - et le moteur (A2) JOUE ce
   qu'on dessine. **DND COMPLET** : D4 clips entre pistes (drag
   bi-dimensionnel, X historique intact) + slots Session deplacables.
5. Ceinture reconnexion moteur (echec initial re-essaie aussi).

Suite e2e **70/70**, moteur **45/45**, cargo 9/9, tsc 0.

## Point de synchro (A LIRE EN PREMIER)

**CI VERTE VERIFIEE sur tout le 27** : 002a4b5 (preuve par etage),
232beb7 (gestes), fca5b6b (A3+D4), edddf27 (docs), 385facf (fix specs
BOX). Seul 92dd535 fut ROUGE (le refus-visible de BOX cassait 2 specs
qui testaient l'envoi sans moteur - modif de test signalee, corrige et
vert dans 385facf). Ajout tardif : BOX refuse VISIBLEMENT (flash rouge +
pastille) quand le moteur est deconnecte - fin des clics dans le vide
(4 retours utilisateur avaient cette meme cause). Ce commit REPRISE
part apres 385facf (meme code, docs seuls) - verdict attendu vert.

## RESTE / prochaine tranche

**L'utilisateur a annonce : « on commencera un gros chantier ».
Candidats prets a arbitrer :**
- **P2P E4** (docs/P2P-ENGINES-DESIGN.md) : MIDI laptop -> Massive tour,
  2-3 sessions, DEUX MACHINES requises - la demo differenciateur.
- **Effets natifs 4.2/4.3** (EQ 3 bandes + compresseur, puis Drive/Delay).
- **Vague 3 MIDI + instruments** (le test Massive complet).
- **AUDIT-5 a ratifier** (rapport docs/AUDIT-5.md, quick wins < 1h).
Tranches minces restantes : A4 (automation des params VST3 + cle de
stem), A5 (courbes/confort) ; preuve par etage DANS l'UI (colonne hash
a cote des VU du rack).

## A surveiller (pieges connus)

- Layout de struct moteur change => CLEAN build (ninja clean) ; le clean
  emporte create_test_doc (le rebuilder : ninja create_test_doc).
- Aucun fichier temp/log de test dans web/ (vite -> EBUSY).
- Zombies plugin_host : Stop-Process -Force, sinon wmic call terminate.
- Suite e2e = serveur NON-secure + 47821 libre ; stack utilisateur
  SECURE -> basculer puis RESTAURER (rode).
- Specs a geste : DESARMER le kit apres la pose ; viser le CENTRE des
  poignees (10 px) ; scrollIntoViewIfNeeded avant boundingBox (le rack
  scrolle) ; specs moteur-spawne : purger le token file + attendre
  « WebSocket server listening ».
- endUndoGroup ne compte pas les imbrications (le end interne clot le
  groupe) - contrainte notee dans moveClipToTrack/slot_reorder.

## Relancer

`start-daw.cmd` OU `scripts\daw.ps1 -Secure` -> URL stable
`http://localhost:5173/#stoken=<token de ~/.daw-server-token>`.
Moteur : rebuild_msvc.bat (zombies d'abord) ; tests 45/45 ; e2e 70.
La manip 5 min : bouton **A** d'une piste -> double-cliquer 3 points
dans la lane -> PLAY : le fondu dessine S'ENTEND. Glisser un clip sur
une AUTRE piste. Glisser un plugin du navigateur DANS le rack. La table
de verite : `npm run ear -- --project studio --probe`.
