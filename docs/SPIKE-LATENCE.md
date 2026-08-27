# SPIKE BUDGET LATENCE — mesures et verdicts

*Spike ratifie (revue externe 2026-08-27, sequence : spike -> tempo ->
Vague 3 live). Objectif : LE tableau mesure de la chaine
clavier -> moteur local -> P2P -> moteur distant -> oreille, et le
verdict sur la FORME du jeu distant (direct LAN / quantise WAN /
monitoring local). Ce fichier est le livrable ; il se complete au fil
des sessions du spike.*

## Session 1 (2026-08-27) — device local, FAITE

Banc : `scripts/perf-underruns.ps1` (critere 5 sous charge en une
commande) ; VRAI driver du studio (ZenGo SC, paire 3/4 non cablee =
inaudible) ; doc test_10min ; charge = 28 threads CPU pendant 30 s ;
`--buffer-size` (nouveau flag) + ligne `audio-negotiation:` (verite de
la negociation WASAPI).

| Demande | Periode obtenue | Periods | Latence device | Underruns sous charge |
|---|---|---|---|---|
| 512 | 512 | 3 | **32,0 ms** | **0** |
| 256 | **374** (plancher partage) | 3 | **23,4 ms** | **0** |
| 128 | **374** (meme plancher) | 3 | **23,4 ms** | **0** |

Verdicts partiels :
1. **Le moteur tient la charge** : zero underrun a toutes les tailles
   testees, 28 threads de calcul en parallele (Ryzen 3950X).
2. **Le plancher WASAPI PARTAGE est ~23 ms de sortie** — la basse
   latence exige le mode EXCLUSIF ou ASIO (sonde en session 2).
3. **La periode plancher 374 n'est pas multiple de 256** : le bypass
   silencieux des plugins (AUDIT-5 A6 : 31,6 % du callback passe dry,
   MIDI de ces frames PERDU, depth pipeline faux `max(1,374/256)=1`)
   devient un PREREQUIS de la basse latence. Plan d'attaque : piste A
   (demander un multiple de 256 et laisser l'assemblage
   noFixedSizedCallback de miniaudio absorber — a mesurer), sinon
   piste B (accumulateur amont, pattern staging[] de TapRing). Voir le
   plan (Lot A6).

## Session 2 (a faire) — pipeline jam + exclusif + LAN

- CORRECTIF de verite acquis au recon : le « ~40 ms P2P » de S8 etait
  le RTT/2 du DataChannel (ping SCTP), PAS une mesure audio. Le terme
  probablement dominant — le jitter buffer NetEq du listener
  (40-100 ms typiques) — n'a jamais ete mesure.
- Plan de mesure (timestamps T0->T4) : T0 `engine_ns` additif dans
  AudioTap (rempli au pumpTap) ; T1 reception WS (wiring) ; T2 stats
  du worklet (le hook 'stats?' existe, jamais interroge) ; T3
  `pc.getStats()` jitterBufferDelay/totalPlayoutDelay (zero changement
  du chemin audio) ; T4 traduction d'horloges pairwise par
  SessionClock (incertitude = asymetrie rtt/2, affichee).
- Gain gratuit a chiffrer : pumpTap tourne a ~10 ms reels (le sleep de
  la boucle de controle ; les commentaires disent 1 ms — faux) →
  jusqu'a 10 ms de quantisation offerte avant meme le reseau.
- Sonde WASAPI EXCLUSIF : shareMode + READBACK obligatoire (miniaudio
  retombe en partage EN SILENCE) + format/rate natifs.
- Mesure LAN 2 machines (tour <-> portable TX15).

## Le tableau final (se remplit en session 2)

| Etage | Partage 512 | Partage plancher | Exclusif (a mesurer) |
|---|---|---|---|
| Sortie device locale | 32,0 ms | 23,4 ms | ? |
| Ring -> WS (pumpTap) | ? (<= ~10 ms quantisation) | ? | ? |
| Worklet FIFO (broadcaster) | ? | ? | ? |
| Opus + reseau LAN | ? | ? | ? |
| NetEq (listener) | ? | ? | ? |
| Sortie listener | ? | ? | ? |
| **Total clavier->oreille** | ? | ? | ? |

Verdict de forme d'E4 : EN ATTENTE des mesures session 2. Hypothese a
confirmer/infirmer : WAN = jam quantise ou monitoring local (modele S8
actuel) ; LAN direct jouable seulement sous ~25-30 ms totaux.
