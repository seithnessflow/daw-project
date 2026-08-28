# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28, soir) : CONTRAT DE PERIODE CLOS, LE RAIL MIDI EST POSE

**A LIRE EN PREMIER — le point de synchro : LEVE.** Le ring v11
(027781c) est VERT en CI (run 33171167476 : build-linux + e2e, 7 min) —
refus de periode, `host/proxy_depth.h`, FIFO MIDI generique et
acquisition du controleur a la ceremonie passent sous GCC. Aucun verdict
en vol.

## Ce qui a ete fait (2026-08-28)

- **Matin — rangement documentaire** (4ee5ff6) : un proprietaire par
  information, CLAUDE.md §3.
- **Ring v10** (2ef82eb, CI verte) : estampilles par slot (A4-5).
- **Soir — contrat de periode CLOS + ring v11** : refus de demarrer hors
  contrat (periode non multiple de 256, depth > 6), FIFO MIDI generique
  note/CC/pitch-bend, CC/PB -> parametres via IMidiMapping cote enfant,
  un controleur d'edition par instance. gtests 55/55, specs moteur reel
  10/10, hash absolu inchange. Details : JOURNAL.
- Ordre grave re-arbitre par l'utilisateur (« go ») : Vague 3 entree
  MIDI live EN TETE, devant T4 Link Etage 2.

## Comment relancer

- Stack : `start-daw.cmd` ou `scripts\daw.ps1 -Secure` ; arret
  `stop-daw.cmd`. Rien ne tourne a la cloture.
- `rebuild_msvc.bat` construit desormais aussi `create_test_doc`.
- ATTENTION nouvelle regle vivante : `--exclusive --buffer-size 128` et
  toute periode partagee non multiple de 256 (ZenGo : demander 256 ou
  128 en partage -> 374) sont REFUSES au demarrage avec la sortie dans
  le message. `daw.ps1` (512 partage) n'est pas concerne.
- Offre OUVERTE : `daw.ps1` en `--exclusive --buffer-size 256`.

## Quoi surveiller

1. Le verdict CI ci-dessus.
2. Au premier lancement audible apres pull : la ligne `audio-negotiation:`
   puis soit « Built graph », soit le REFUS — dans ce cas, demander 512
   ou `--exclusive --buffer-size 256`.
3. Ligne `plugin_host: midi-mapping N controller assignment(s)` dans les
   logs enfant : N > 0 sur un vrai synthe = le chemin CC64 existe ;
   « declares none » sur AGain est normal.

## La suite (ORDRE GRAVE, TODO.md §1)

1. **Vague 3, premier maillon** : MIDI-in moteur (clavier USB sur la
   tour, WinMM) -> file SPSC MIDI-in -> thread audio -> `ProxyNode::
   emitMidi` de l'instrument de tete de chaine de la piste ARMEE -> note
   entendue en exclusif 256, latence mesuree. A cadrer en 3 lignes a
   l'ouverture ; la contrainte a resoudre d'abord : UN producteur par
   ring (le MIDI-in ne doit jamais ecrire le ring depuis un autre thread
   que le callback).
2. Reliquat spike LAN (portable) ; 3. T4 Link Etage 2 ; 4. perf au
   regime de preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

## Decisions ouvertes

TODO.md §2 (exclusif dans daw.ps1, overlap au drag, mute document, ASIO,
placement + lieux d'ecoute, politique latence heterogene, auth, macOS,
veille samod, kit de demarrage).
