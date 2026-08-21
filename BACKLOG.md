# BACKLOG

Idees hors cap. Le cap : la demo qui n'existe nulle part ailleurs —
un vrai plugin natif pilote depuis un onglet (tranche 2 = hote VST3).
Rien de cette liste n'apparait dans les propositions de tranche.

- **Moteur WASM** : ecarte — c'est la direction Soundtrap/BandLab, l'inverse
  du differenciateur. Peut-etre un jour comme mode invite lecture/commentaire.
- **Sortir automerge-c du moteur (sidecar Rust)** : decision d'architecture,
  pas une optimisation. Pas sans dossier complet ; le maillon vient de passer
  tous ses tests.
- **Presence ephemere** (curseurs, qui tient quel fader, transport partage) :
  tranche 3+, canal hors CRDT (meme logique que solo/mute).
- **IA comme acteur Automerge** (actorId propre, mode suggestion) : tranche 3+.
- **Undo par utilisateur** : probleme dur du CRDT musical, a scoper tot mais
  pas maintenant.
- **Identites** (actorId <-> compte) : prerequis presence/IA, tranche 3+.
- **Discord** : integrer (Rich Presence, webhook), jamais construire. Tranche 3+.
