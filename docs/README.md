# docs/ — index et statut de chaque document

*Un proprietaire par information (CLAUDE.md §3). Chaque document porte
sa ligne `Statut :` en tete ; ce tableau est l'index. Mis a jour
2026-08-28.*

Statuts : **VIVANT** (tenu a jour, fait foi) — **REFERENCE** (acquis
stable, consulte ponctuellement) — **LIVRE** (design implemente ; garde
comme trace de conception, ne decrit plus forcement le code au detail) —
**PROPOSITION** (rien construit, arbitrage attendu) — **ARCHIVE** (mort,
conserve lisible).

## Contrats et decisions (VIVANT)

| Fichier | Role |
|---|---|
| `DECISIONS.md` | Registre UNIQUE : ADR-001..018 inline (index en tete) + decisions produit + resultats de tests (hashes de reference, mesures, campagne LNA) |
| `SCHEMA.md` | Contrat du document projet (v2 additive-dual), source de verite des 3 etages |
| `ADR-015-windows-native-build.md` | Windows natif MSVC (la procedure de build detaillee y est historique — voir CLAUDE.md §13) |
| `ADR-016-automerge-version-alignment.md` | Versions Automerge alignees sur 3 etages, montee simultanee |
| `ADR-017-plugin-process-isolation.md` | Un processus enfant par instance VST3, proxys, registre survivant aux rebuilds |
| `ADR-019-differenciateur-distribue.md` | LA loi : aucun audio traite serveur, P2P, stems, invariant produit, criteres 3/6 |
| `deux-machines.md` | Runbook tour <-> portable (ssh via tunnel, stack a deux machines, tester son plugin en securise) |
| `SPIKE-LATENCE.md` | Mesures du budget latence (sessions 1-2 faites, reliquat LAN) et verdict sur la forme du jeu distant |

## References (REFERENCE)

| Fichier | Role |
|---|---|
| `ABLETON-INTEGRALE.md` | Le manuel Live 12 mappe sur le projet : deja-la, gains proches, designs CRDT acquis (automation, tempo, sends, undo, freeze, comping), refus ecrits |
| `UI-CONVENTIONS.md` | Ce que Live/Cubase/Logic ont deja arbitre (UI + mecanique profonde du hosting VST3) |
| `BRIEF-EXTERNE-FABLE5.md` | Instantane produit/stack/etat au 2026-08-27 ecrit pour une analyse externe — la meilleure vue d'ensemble en une lecture (les chiffres y sont dates) |
| `REVUE-EXTERNE-2026-08-27.md` | Les 5 critiques externes, la reponse, l'arbitrage RATIFIE (spike -> tempo -> Vague 3 live + perf au regime de preuve + garde-fou anti-clone) |
| `cadrage-2.4.md` | Choix d'outillage VST3 toujours en vigueur (SDK direct sans JUCE, pin v3.8.1_build_84, route GPLv3) ; le decoupage 2.4a-d est livre |

## Designs (LIVRE / PROPOSITION)

| Fichier | Statut | Note |
|---|---|---|
| `SCHEMA-V2-DESIGN.md` | LIVRE en partie | §2 etat de plugin et §3 stems LIVRES (2026-08-23) ; §4 clips MIDI livres en LISTE (ecart avec la MAP a ids, TODO ordre grave 4) ; le PLACEMENT (§ intrants, ADR-019 §2) n'a jamais ete concu — decision ouverte |
| `LINK-DESIGN.md` | LIVRE (Etage 1) | L1a/b/c verts deux machines ; Etage 2 (grille au quantum) = T4 differe ; §7 politique latence heterogene = decision ouverte |
| `STREAMING-DESIGN.md` | LIVRE | S8a/b/c livres (2026-08-24), valide a l'oreille ; TURN = dette datee |
| `AUTOMATION-DESIGN.md` | LIVRE (A1-A3) | Document, moteur gain/pan/master, UI lane livres ; A4 (params VST3 + cle de stem) et A5 (courbes) restent |
| `DND-DESIGN.md` | LIVRE | D1-D4 livres (2026-08-26/27) |
| `P2P-ENGINES-DESIGN.md` | PROPOSITION | E4 recadre par le spike latence (le jeu direct distant est exclu ; la forme = MIDI LAN + rendu tour) ; E1-E3 a arbitrer |

## Audits (`audits/`, lecture seule, dates)

| Fichier | Date | Ce qu'il en reste |
|---|---|---|
| `AUDIT-1.md` | 2026-08-21 | Tout solde (use-after-free, auth factice, WSL, CI hash). Historique |
| `AUDIT-2.md` | 2026-08-21 | Prealables 2.4 soldes (R1-R5) ; R9 (sync positionnel) et 2.1bis veille restent dans TODO |
| `AUDIT-3.md` | 2026-08-22 | A3-1 (file param generique), A3-2/A3-3 (contrat de periode, EN COURS ring v10), A3-6 (transport), A3-7/A3-8 (dettes) dans TODO |
| `AUDIT-4.md` | 2026-08-23 | A4-1/2/3/4/6 soldes ; A4-5 en cours (ring v10) ; A4-7 (C1), A4-8..A4-19 dettes dans TODO ; la critique des .md (A4-20) a produit la scission STATUS/JOURNAL et, le 2026-08-28, la carte des documents |
| `AUDIT-5.md` | 2026-08-25 | Quick wins et prealables A1/A2/A4-1/B3/B5/F1 soldes (section AVANCEMENT du rapport) ; A3/A5/A6/A7, C1-C4, B2/B4/B6/B7, famille F dans TODO |
| `AUDIT-6.md` | 2026-08-27 | Quick wins livres (export, pre-ecoute, boucle, scission, import universel, pistes typees, moteur suit l'onglet) ; refontes et concepts a ratifier dans TODO §1.6 et §2 |

## Archive (`archive/`)

`audit-2-prompt.md` (prompt one-shot), `test-des-mains-2.4.md` (runbook
supplante par daw.ps1 + rituel du compositeur), `refonte-ui-preparation.md`
(refonte livree), `AMELIORATIONS.md` (registre sans entree depuis le
2026-08-22, JOURNAL a pris le relais), et les copies integrales de
`CLAUDE.md` / `STATUS.md` / `TODO.md` d'avant le rangement du 2026-08-28.
