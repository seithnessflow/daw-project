# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-28) : RING v10 LIVRE, VAGUE 3 ENTREE LIVE EN TETE

**A LIRE EN PREMIER — le point de synchro :** un verdict CI est en vol
sur le push du ring v10 (commit « ring v10 », voir `git log -1`) : c'est
le premier passage du layout 8 slots + estampilles sous GCC. `gh run
list --limit 3`. Rouge = lire le job build-linux (asserts d'offsets ou
`testStaleSlotDetection`). AUCUN travail ne s'ouvre avant ce verdict.

## Ce qui a ete fait (2026-08-28)

- **Rangement documentaire** (matin) : un proprietaire par information
  (CLAUDE.md §3), STATUS = etat, TODO = une file, docs/audits +
  docs/archive + docs/README.md, ligne `Statut :` partout. Commit
  4ee5ff6, markdown seul.
- **Ring v10** (apres-midi) : kRingSlots 8, estampilles par slot (A4-5),
  invariant input-dechire grave, clamp de profondeur bruyant,
  `--buffer-size` arrondi en clair. Clean build, gtests 52/52, hash
  absolu inchange, specs proxy 8/8. Details : JOURNAL.
- **Arbitrage utilisateur (« go »)** : la Vague 3 avec l'entree MIDI
  live passe DEVANT T4 Link Etage 2 (TODO.md §1 re-ordonne).

## Comment relancer

- Stack : `start-daw.cmd` ou `scripts\daw.ps1 -Secure` ; arret
  `stop-daw.cmd`. Rien ne tourne a la cloture de cette session.
- Binaires de build-msvc FRAIS (clean build du jour) ; `create_test_doc`
  reconstruit a la main (`ninja create_test_doc`) — `rebuild_msvc.bat`
  ne le fait pas (TODO).
- Offre OUVERTE : `daw.ps1` en `--exclusive --buffer-size 256`.

## Quoi surveiller

1. Le verdict CI ci-dessus.
2. `callback-shape` dans les logs moteur : `partials>0` = contrat viole.
3. Au premier smoke avec un vrai plugin sur ring v10 : `blocks_missed`
   doit rester a l'amorcage (le contrat est plus strict qu'avant — un
   slot perime compte desormais).

## La suite (ORDRE GRAVE, TODO.md §1)

1. Contrat de periode, reste : refus de demarrer hors contrat, puis la
   file d'ordres generique `{type, id, value}` (A3-1) — le rail de
   l'entree MIDI.
2. VAGUE 3 entree live, premier maillon : MIDI-in moteur (clavier USB
   sur la tour) -> file d'ordres -> instrument de tete de chaine -> note
   entendue en exclusif 256, latence mesuree (< 20 ms vise). Session
   dediee a cadrer en 3 lignes a l'ouverture.
3. Reliquat spike LAN (portable) ; 4. T4 Link Etage 2 ; 5. perf au
   regime de preuve ; 6. ratifications AUDIT-5 F / AUDIT-6.

## Decisions ouvertes

TODO.md §2 (exclusif dans daw.ps1, overlap au drag, mute document, ASIO,
placement + lieux d'ecoute, politique latence heterogene, auth, macOS,
veille samod, kit de demarrage).
