# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-24 (soiree, la journee des vrais plugins). VOLATILE :
etat dans STATUS.md, file dans TODO.md, recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

La journee a tout change :
- **Link VERT deux machines** (L1a+b+c) : PLAY tour -> portable cale a
  10,7 ms, ecart <= 16 ms, ecoute jam suspend la lecture (arbitre).
- **LES VRAIS PLUGINS SONT LA** : 18 plugins du commerce mappes
  (Valhalla, RoughRider, Krush, effets NI...), ajoutes par le geste UI
  normal (+ device, noms reels, chaine en serie visible — bible Live).
- **FENETRAGE v1** : chaque enfant vst3 ouvre la GUI native du plugin
  (taille native, fullscreen retire), reglages audibles immediatement
  (performEdit -> bloc suivant ; flush numSamples==0 a l'arret), et
  **ring v6 : les reglages GUI SURVIVENT et VOYAGENT** (gui_edit_seq ->
  capture d'etat -> store -> cle de stem -> le pair sans le plugin
  re-entend TON reglage).
- Preuve chiffree du comp : t1 1.0->1.4, crete 17.7->15.7 % (RoughRider
  tient) ; piste sans chaine -> clip ROUGE.
- Moteur --editors, --start-stopped ; ear --vst3 uid=chemin ; derniers
  mots des enfants dans <segment>.log.
- Commits ... -> 802029d. CI verte jusqu'a f4661d1 (v6) ; verdict
  802029d = premier point de synchro si absent d'ici.

## Relancer

Le banc du jour (moteur + 18 modules + editors) : voir la commande dans
le JOURNAL du 2026-08-24 soir, ou relancer simple : scripts\daw.ps1.
Stack : serveur + vite + moteur 47821 (+ portable : relais + vite +
moteur, docs/deux-machines.md).

## A surveiller

- **Crash 0xe06d7363** (fermeture lien WS, LES DEUX machines) — session
  dediee : repro + symboles (build RelWithDebInfo, PDB en place).
  crash-*.log + <segment>.log = la moisson.
- Cibles bundle SDK en conflit (daw_engine_test ne LINKE PAS en local ;
  build_core.bat contourne ; CI Linux teste, elle) — meme session.
- Reglages GUI pendant une fenetre TRAINEE = blocs dry comptes (design).

## La suite (ordre)

1. Session crash 0xe06d7363 (+ cibles bundle + gtest local repare).
2. 2.5-DECOUVERTE : scan automatique du dossier VST3 (~120 modules
   enumeres a la main aujourd'hui, la table des noms est provisoire).
3. Effets natifs (3 sessions arbitrees, VCV Rack comme litterature).
4. Vague 3 : LE TEST ULTIME (MIDI laptop -> Massive tour -> entendu
   partout). Massive.vst3 ET Massive X.vst3 sont sur la tour.
5. Refus VST2 maintenu (SDK non licenciable) ; orphelins reels :
   Absynth 5, ImpOSCar2, Trash 2 (versions VST3 existent, pas
   installees).

## Directives gravees

- Manuel Live 12 = bible produit (jamais DSP). Memoire + CLAUDE.md.
- Organes sensoriels : ameliorer sans permission, self-test deux sens.
