# Revue externe du 2026-08-27 — consignation et arbitrage propose

*Une session Fable 5 externe a analyse docs/BRIEF-EXTERNE-FABLE5.md.
Ce fichier consigne ses critiques, la reponse point par point de la
session de dev (validee sur le code), et l'arbitrage propose A
RATIFIER. L'ordre grave ne bouge pas sans le proprietaire.*

## Les 5 critiques externes (condensees)

1. **La methode de verification a sculpte le produit** : tout ce qui
   est vert est deterministe/offline/pilotable ; tout ce qui manque
   (enregistrement, MIDI vif, CC) est ce qui se juge au ressenti. Le
   rituel du compositeur compose a la souris — il confirme le biais.
   128 tests verts, aucun ne mesure une milliseconde ressentie.
2. **Preuves de correction, jamais de performance/experience** :
   critere 5 sans charge = quasi non-preuve ; aucun chiffre de CPU
   headroom, latence aller-retour, churn des stems en edition active.
   Risque : un badge de fraicheur honnete mais perime 80 % du temps.
3. **La migration tempo = dette a interets composes** : chaque
   document v1 et chaque feature en samples en augmente le cout ;
   elle invalide d'un coup caches de stems et hashes de reference —
   supportable MAINTENANT, pas dans six mois. Vague 3 sans tempo =
   un etage sur des fondations a remplacer.
4. **Danger strategique : la derive en clone appauvri d'Ableton** —
   toute la grille d'auto-evaluation EST Ableton ; courir la parite
   est perdu d'avance ; creuser ce qu'Ableton ne peut pas faire.
5. **Angles morts** : (a) Windows-only comme contrainte strategique
   non discutee ; (b) la PHYSIQUE de la latence (512 WASAPI partage +
   P2P) : le « test Massive » risque de decouvrir en fin de chantier
   que le jeu distant direct ne ferme pas.

**Sequence proposee par l'externe** : spike budget-latence (2-3 j,
chiffres en main, decide la forme d'E4) -> migration TEMPO seule,
gelee comme les stems -> Vague 3 MIDI AVEC l'entree live dedans (E4
tombe en fruit mur) ; en parallele, ajouter la PERFORMANCE au regime
de preuve (CI de charge, churn de stems, latence en telemetrie).

## Reponse de la session de dev (points valides, nuances factuelles)

- **1 et 2 : ACCEPTE.** Le biais est reel et la formule est juste.
  Nuances d'exactitude : des latences ONT ete mesurees en smokes
  (P2P ~40 ms un sens sur deux NAT ; sync transport <= 16 ms d'ecart ;
  calage 10,7 ms au demarrage L1) — mais jamais en TESTS DE
  REGRESSION, et jamais la chaine jouee de bout en bout. Le critere 5
  sous charge est explicitement note PARTIEL depuis le debut ; la
  critique a raison qu'il est reste partiel trop longtemps.
- **2, churn des stems : ACCEPTE avec une nuance de perimetre.** La
  cascade d'invalidation est PAR PISTE (la cle couvre le noeud + son
  amont DE CHAINE ; il n'y a pas de sends, donc pas de cascade
  inter-pistes aujourd'hui). Mais l'economie du systeme (debounce 1 s,
  rendu synchrone dans la boucle de controle = AUDIT-5 C1, arbitrage
  d'ecrivain absent = A3) n'est chiffree nulle part : le scenario
  « badge perime 80 % du temps en edition active » est plausible et
  non refute. A instrumenter (compteur de churn + temps de fraicheur
  moyen en session simulee).
- **3 : ACCEPTE en entier.** C'etait deja la recommandation interne
  (AUDIT-6 : tempo avant/dans la Vague 3) ; l'externe la durcit avec
  un argument neuf et juste : l'invalidation one-shot des cles de
  stems et du hash de reference CI coute moins cher aujourd'hui que
  dans six mois. La discipline « tout gele tant que pas vert » a deja
  fait ses preuves sur les stems.
- **4 : ACCEPTE comme garde-fou.** Precisions : le gel de parite est
  une loi ecrite (ADR-019) et AUDIT-6 etiquette exactement pour ne
  PAS courir la parite (REFUS ecrits, arbitrage par grille). Mais la
  rafale du 27/08 (Session, mixer, piano-roll, 5 natifs a profondeur
  v1) donne raison au signal : la surface s'etend plus vite que la
  profondeur. Le garde-fou est adopte : chaque nouvelle surface devra
  nommer ce qu'elle apporte au DIFFERENCIATEUR (collab/stems/P2P) ou
  attendre.
- **5a : NUANCE.** Windows-natif est un ADR existant (ADR-015, MSVC
  seul en local, GCC en CI). Ce qui manque est la LIGNE STRATEGIQUE
  (macOS un jour ? le ring et miniaudio sont portables, les fenetres
  TOPMOST et vcvars non). A ecrire en une page, pas un chantier.
- **5b : ACCEPTE, et le calcul preliminaire est fait (ci-dessous).**

## Budget latence — arithmetique preliminaire (mesures deja acquises)

Chaine « clavier -> moteur local -> P2P -> moteur distant -> oreille » :

| Etage | Valeur actuelle | Source |
|---|---|---|
| MIDI-in USB (futur) | ~1-3 ms | ordre de grandeur standard |
| Buffer moteur local (512 @ 48 k) | 10,7 ms | fige dans le code |
| Periode WASAPI partage | ~10 ms | mode partage Windows |
| P2P un sens (2 NAT, STUN, WAN) | ~40 ms | CORRIGE (spike s2) : ce chiffre etait le RTT/2 du DATACHANNEL (ping SCTP, jam.ts), PAS une mesure audio ; le jitter buffer NetEq du listener (40-100 ms typiques) n'a JAMAIS ete mesure — c'est l'objet du spike session 2 |
| P2P un sens (LAN direct) | ~1-5 ms | a mesurer (spike) |
| Buffer + periode moteur distant | ~20 ms | symetrique local |
| **Total WAN** | **~80 ms** | injouable en direct |
| **Total LAN** | **~45 ms** | limite, > seuil ~20-30 ms |
| **Total LAN + buffers 128 (ASIO/exclusif)** | **~15-20 ms** | jouable |

Conclusion preliminaire (a confirmer par le spike instrumente) :
- **WAN : le jam distant direct ne fermera JAMAIS** -> la forme
  honnete est le jam quantise/differe (a la Endlesss) OU le monitoring
  local (on joue son moteur local, le pair recoit le flux — deja le
  modele S8). Le recit produit d'E4 doit le dire AVANT le chantier.
- **LAN (le test Massive tour<->portable) : jouable SI la latence
  I/O descend** -> le chantier buffers reglables / WASAPI exclusif /
  ASIO devient un prerequis chiffre, pas une option.

## ARBITRAGE PROPOSE (a ratifier — remplace le choix « gros chantier »)

1. **SPIKE BUDGET LATENCE** (borne, ~2-3 sessions) : instrumenter la
   chaine reelle (timestamps clavier simule -> rendu local -> P2P LAN
   et WAN -> sortie distante), livrer LE tableau mesure, et trancher
   la forme d'E4 (direct LAN / quantise WAN). Inclut la premiere
   ouverture du chantier latence reglable (flag --buffer-size,
   mesure WASAPI exclusif).
2. **MIGRATION TEMPO, seule, tout le reste gele** (discipline stems) :
   schema LWW + tempo map (design ABLETON-INTEGRALE/LINK acquis),
   migration des positions, clips « seconds » (warp off) tranches DES
   le schema, ProcessContext enfin rempli, re-base one-shot des cles
   de stems et du hash de reference CI (assume et documente).
3. **VAGUE 3 MIDI avec l'entree LIVE dedans** (MIDI-in moteur +
   Web MIDI, CC64/pitch-bend dans le ring, velocite editable,
   piano-roll musical) — le test Massive tombe en fin de tranche
   comme demonstration, plus comme chantier aveugle.
4. **En parallele, la performance entre au regime de preuve** :
   critere 5 SOUS CHARGE en CI (N plugins + rebuilds), compteur de
   churn de stems + fraicheur moyenne en edition simulee, latence
   aller-retour en telemetrie permanente. Les declencheurs mesurables
   d'AUDIT-5 (jamais instrumentes) rejoignent ce lot.
5. **Garde-fou anti-clone (adopte immediatement, sans code)** : toute
   nouvelle surface UI doit nommer sa contribution au differenciateur
   ou rester en file.

Ce qui N'EST PAS retenu de la revue : rien — les cinq critiques sont
acceptees (deux avec nuances factuelles consignees ci-dessus).
