# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-25 (session AUDIT-5). VOLATILE : etat dans STATUS.md,
file dans TODO.md, recit dans JOURNAL.md, audit dans docs/AUDIT-5.md.*

## Ou on en est (30 secondes)

Session d'AUDIT-5 + premiers correctifs, en deux temps :

1. LA JAMBE DEUX MACHINES (ordre grave item 3) EST VERTE sur de VRAIS
   plugins (Valhalla + RoughRider) : le portable, sans ces modules, rend
   inv-proof byte-exact a la tour (179F804E...). Reserves consignees
   (offline/scp/lecture, badges live de la-bas non observes) — JOURNAL
   2026-08-25.

2. AUDIT TRANSVERSAL (6 lectures paralleles + revue externe) ->
   docs/AUDIT-5.md, ~40 trouvailles, arbitrage par la grille. Titre :
   l'invariant produit etait VERT sur AGain seulement ; 3 des « 4
   endroits ou le premier vrai plugin casse » localises et CORRIGES.

3. CORRECTIFS LIVRES, test-first (rouge avant fix), MASTER VERT :
   - B3 dr_libs epingle (fin de master mouvant).
   - A1 int/f64 : schemaVersion/sampleRate d'un doc web (INT) etaient lus
     0/48000 en silence -> helper itemToUint.
   - A2 cle de stem : 6 chiffres significatifs faisaient collisionner deux
     valeurs de knob -> badge « frais » menteur -> setprecision + stem-v2.
   - A4 merge non destructif (1a) + push a la reconnexion (1b) : le moteur
     ne perd plus / partage enfin les champs qu'il est SEUL a ecrire.
   - A6/A7 warnings bruyants (periode != 256 ; asset sample_rate mismatch).
   - A8 sample_rate du moteur sur le fil (fin de la playhead 48000 en dur).
   - B1 SECURITY.md re-cadre (C2-distante LIVE, H3 Windows Low...).
   - 1.1 params moteur map->liste ordonnee (clot l'ordre de la cle de
     stem laisse par A2 ; aligne moteur/web/SCHEMA.md).
   - B5 validation des chemins issus du document (path traversal +
     injection URL) : helper isPathComponentSafe aux 4 frontieres.
   - F retrait de GraphBuilder mort (jumeau divergent).
   - F1 AUTH SERVEUR (la trouvaille secu critique) : token partage
     OPT-IN (DAW_SERVER_TOKEN), WS premier message + Bearer /assets,
     retrocompatible ; serveur+moteur+web faits, smoke + e2e verts.
     Ferme C2-distante (le tunnel exposait le serveur sans auth).
   gtests 40/40, cargo 9/9, e2e verifies en local (items inter-etages).

## Point de synchro (A LIRE EN PREMIER)

Dernier push 67579a0 (F1 clients). CI VERTE confirmee jusqu'a 7f9a1fd
(B5, GraphBuilder, F1 serveur inclus, tous success). Le run de 67579a0
(F1 clients) tournait a la cloture : VERDICT A CONFIRMER au demarrage
(verifie en local : e2e retrocompat 7 passed, smoke moteur token OK).
Piege paye : A4-1a (17f21a8) a d'abord ete ROUGE en CI — un renommage
de log moteur (« Document loaded ») a casse un contrat e2e (countInFile) ;
corrige en 0e2089b. LECON : verifier les APPELANTS d'un log avant de le
renommer (les logs moteur sont un contrat e2e).

## RESTE (ordre grave + arbitrage AUDIT-5)

Ordre grave : 3-fin badges fraicheur de la-bas (BLOQUE sur geste laptop) ;
5 VAGUE 3 MIDI+instruments (test Massive) ; 6 AUDIT-5 (EN COURS).
Arbitrage AUDIT-5, gros restants (chacun = session dediee) :
- A4-2 outbox persistant (sync sensible) ;
- A5 PDC LIVE inexistant — pas au-dela de la vague MIDI ;
- A3 arbitrage d'ecrivain stem (avec PLACEMENT/SCHEMA v2) ;
- 1.1 refactor params map->liste (debloque A2-ordre + 1.3...) ;
- F1 auth serveur (LIVE a chaque tunnel — mitigation token header) ;
- B5 validation hex des chemins (ATTENTION : verifier les formats de
  hash des fixtures avant d'imposer isHex) ;
- Famille F cohesion (SCHEMA.md menteur, SPLITTER, jumeaux).

## A surveiller

- Verdict CI de 7533a36 (A8) — premier point de synchro.
- Crash-*.log = moisson permanente (handler auto-symbolisant).
- Warnings A6/A7 dans les logs moteur = signal d'un asset/device mal
  configure (avant, c'etait faux en silence).
