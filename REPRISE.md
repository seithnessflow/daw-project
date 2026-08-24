# REPRISE.md — point de reprise au demarrage

*Ecrit le 2026-08-24 (soir). Fichier VOLATILE : reecrit en fin de
session ; il ne possede rien — etat dans STATUS.md, file dans TODO.md,
recit dans JOURNAL.md.*

## Ou on en est (30 secondes)

**LE CHANTIER LINK EST VERT DE BOUT EN BOUT, DEUX MACHINES.**
- L1b+L1c livres et prouves EN REEL : PLAY sur la tour -> le portable
  demarre sur l'ancre (calage 10,7 ms = 1 buffer pile) et joue la
  piece entiere dans ses haut-parleurs ; ecart de lecture <= 16 ms
  (5 sondes/6, critere < 50 ms tenu). Ecoute jam = lecture locale
  suspendue (ton arbitrage, applique et annonce au badge).
- Les organes sensoriels ont grandi : ear (positions des clics, regle
  d'echelle locale — le rouge duo etait un faux positif de l'outil,
  duo est VERT), ta:3/ta:4 (etat d'un pair a distance), badge clk
  honnete (incertitude rtt/2), --start-stopped (plus jamais de son
  non commande).
- Commits pousses jusqu'a 35cc8ea + le lot de cloture (CI a verifier
  au demarrage si la sentinelle n'a pas conclu — dernier lot = docs +
  vcvars portable + RelWithDebInfo).

## LE BUG OUVERT — priorite de la prochaine session moteur

**Crash 0xe06d7363** (exception C++ non rattrapee, thread worker,
gachette apparente : fermeture d'un lien WebSocket) — a frappe LES
DEUX moteurs le 2026-08-24. Distinct du fantome 0xc0000409. Le
handler dernier-mots marche (crash-10156.log tour, crash-13300.log
portable). Le build est passe en RelWithDebInfo : les PROCHAINS
crashs seront symbolisables. Plan : repro (fermer le lien serveur ou
un client WS), symboliser, corriger. Le rejoin muet de la sonde
tardive du portable (manche 1) se creuse dans la meme session.

## Relancer

- `scripts\daw.ps1` (audible, --start-stopped desormais : silencieux
  jusqu'a PLAY) ; `-Stop` pour tout couper.
- Deux-machines : docs/deux-machines.md (+ §3bis frictions payees).
  Tunnel = geste humain : `! powershell -File scripts/tunnel-daw.ps1`
  (tour) ; cote portable, meme geste sur ssh://localhost:22.
- La stack du smoke tourne peut-etre encore (serveur, vite, moteurs
  47821/47822, tunnel pid 14140, relais+moteur+vite sur TX15).

## La suite (ordre)

1. **Session crash 0xe06d7363** (repro + symboles + fix, bornee).
2. **Effets natifs, 3 sessions arbitrees** (brief utilisateur au
   TODO) : Utility+chassis -> EQ+comp -> Drive(PDC)+Delay. Litterature
   DSP : VCV Rack (GPL). Manuel Live = comportement seulement.
3. Vague 3 en ligne de mire : LE TEST ULTIME grave au TODO (MIDI
   dessine sur le laptop -> Massive VST3 sur la tour -> entendu des
   deux cotes).

## Directives gravees aujourd'hui

- Manuel Live 12 = LA BIBLE produit, a consulter sans cesse
  (CLAUDE.md + memoire). Jamais pour le DSP.
- Organes sensoriels : ameliorer sans permission, self-test deux
  directions (memoire).
