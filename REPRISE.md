# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-27, soir) : LA MIGRATION TEMPO EST LIVREE

**A LIRE EN PREMIER — le point de synchro :** deux verdicts CI etaient
en vol a la cloture : **e512538** (T5 — le hash MUSICAL passe pour la
PREMIERE fois sous GCC : si rouge, c'est une divergence
cross-compilateur du noyau tempo, lire le log du job build-linux) et
**99190f4** (A6). Les sentinelles locales ont peut-etre rendu verdict
avant la fermeture — sinon : `gh run list --limit 3`. AUCUN travail ne
s'ouvre avant ces deux verdicts.

## Ce qui a ete fait (session du 27 au soir, JOURNAL suites 13-17)

LE LOT T (migration tempo ADDITIVE-DUAL, plan ratifie
`.claude/plans/lazy-crunching-nautilus.md`) est SOLDE en une session,
plus le Lot P et le Lot A6 :

- **Lot P** : perf au regime de preuve (500 pistes = 735 us/bloc en
  gtest CI, compteurs stems + period/shareMode en telemetrie).
- **T1** : schema v2 additif + noyau MIROIR 100 % entier
  `web/src/document/tempo.ts` (BigInt) == `engine/src/graph/tempo.h`
  (int64), vecteurs d'or partages `fixtures/tempo-vectors.json`
  (gtest 41 verifs + spec Node 14/14). Creation RESTE v1 (graine
  vendoree), bump v2 LAZY (ensureV2).
- **T2** : `resolveMusicalTime()` = LE point d'etranglement moteur
  (build live, offline_render, stems, fraicheur — cles sur samples
  RESOLUS), quantum Session musical (1 mesure au registre).
- **T3** : surface web — `geometry.ts` point de branche geometrie,
  champ tempo topbar (milli-BPM entier, undo, LWW), clip MIDI frais
  NAIT musical, piano-roll en ticks, badge ♪ + bascule Rendre
  musical/absolu, grille+regle musicales, `tempo.spec.ts`. RITUEL DU
  COMPOSITEUR a 100 BPM VERT (mesure 2 a 2,400 s pile, ratio tempo
  exact, export x2 stable).
- **T5** : DEUX ancres de determinisme — absolu `56729beb61993cd7`
  INCHANGE par tout le lot (la preuve d'additivite) + musical
  `c1233ae9d6ab9e83` epingle en jumeaux gtest==ci.yml (DECISIONS.md).
- **Lot A6** : contrat de periode MESURE — demander un multiple de
  256 = callbacks FIXES (0 partiel en partage 256/512, exclusif fixe) ;
  piste A suffit, PAS d'accumulateur ; WARNING bruyant si un partiel
  parait ; proxy_depth = ceil clampe (fix du max(1,n/256)).
- **T4 (Link Etage 2) : DIFFERE explicitement** — seul reliquat du
  lot T, session dediee a planifier.

Etat des suites a la cloture : e2e **99/99**, gtests **51/51**
(2 hashes ancres), tsc 0. CI verte jusqu'a 2cc73e6 inclus (T3).

## Comment relancer

- Stack utilisateur : `start-daw.cmd` (double-clic) — RESTAUREE a la
  cloture de cette session (serveur SECURE + moteur studio + web).
- Offre OUVERTE (spike s2, non tranchee par l'utilisateur) : passer
  `daw.ps1` en `--exclusive --buffer-size 256` (16 ms mesures,
  0 underrun sous charge) — une ligne a changer, attend son GO.

## Quoi surveiller

1. Les deux verdicts CI ci-dessus (e512538, 99190f4).
2. Le premier passage GCC du hash musical (e512538) est LE point
   sensible — divergence = probleme de noyau, pas de bruit.
3. `callback-shape` dans les logs moteur : si `partials>0` parait, le
   contrat de periode est viole et la piste B (accumulateur) remonte.

## La suite (ORDRE GRAVE, TODO.md)

1. Reliquat spike : mesure LAN 2 machines (courte, portable TX15).
2. Le GEL du lot T est LEVE : reprendre l'ordre grave du TODO
   (tranche 2 item 3 : contrat de periode — kRingSlots=8, refus
   bruyant, A4-5 ; puis la file d'ordres generique).
3. T4 Link Etage 2 : a proposer comme session dediee.
4. Dettes datees fraiches : wrap de boucle = chunk partiel par tour
   (queue dry via plugins) ; conversion Rendre musical des clips MIDI
   absolus (conversion de masse des notes) ; scission des clips
   musicaux.

## Decisions ouvertes

- `--exclusive --buffer-size 256` dans daw.ps1 (ci-dessus).
- Rampes de tempo, tempoMap UI, signatures UI : HORS perimetre T
  (ecrits, schema seul les porte deja).
