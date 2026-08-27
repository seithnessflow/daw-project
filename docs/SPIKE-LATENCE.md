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

## Session 2 (2026-08-27 soir) — exclusif + pipeline jam : FAITE

### WASAPI EXCLUSIF : mesure decisive (ZenGo, readback confirme)

| Demande | Periode obtenue | Latence device | Sous charge 28 threads |
|---|---|---|---|
| 512 | 512 EXCLUSIVE (s32 natif) | 32 ms | — |
| 256 | 256 EXCLUSIVE | **16 ms** | **0 underrun / 30 s** |
| 128 | 128 EXCLUSIVE | **8 ms** | (128 < 256 : tous blocs partiels -> exige le fix A6) |

**`--exclusive` livre : la sortie locale passe de 32 a 16 ms
IMMEDIATEMENT (periode 256 = le bloc interne, depth 1, aucun code du
graphe touche).** 8 ms atteignables apres A6.

### Deux gains systeme livres en mesurant

1. **timeBeginPeriod(1)** : la resolution timer Windows par defaut est
   15,625 ms — le tick « 1 ms » de la boucle de controle dormait
   15,6 ms (mesure : rafales de 3 blocs/15,6 ms quel que soit le
   sleep). Apres : espacement median **10,1 ms** = la cadence du
   callback (le pump colle enfin au producteur).
2. **Pre-buffer d'amorcage du worklet** (PRIME 4 blocs ≈ 21 ms,
   re-amorcage apres famine) : les underruns broadcaster passent de
   **238-950/10 s a ZERO** — le flux vers les pairs etait HACHE a la
   source depuis S8, plus maintenant.

### Le tableau pipeline jam (UNE machine, loopback, stack 512 partage)

| Etage | Mesure |
|---|---|
| Sortie device moteur | 32 ms (512 partage) / 16 ms (256 EXCLUSIF) |
| Ring -> WS (pump, apres timeBeginPeriod) | ~5 ms moyen (espacement 10,1 ms) |
| FIFO worklet broadcaster (amorce) | ~27 ms (queued 5 stable) |
| Opus framing (defaut Chromium) | ~20 ms |
| NetEq listener (jitterBufferDelay/emitted) | **21-32 ms selon les runs (adaptatif)** |
| Playout complet listener (totalPlayoutDelay/samples) | **~42 ms** (inclut NetEq) |
| Reseau loopback | ~0 (RTT 1 ms) |
| **TOTAL logiciel moteur->oreille pair** | **~75 ms hors reseau** |

## VERDICT (la question du spike : la forme du jeu distant)

1. **Le jeu DIRECT sur moteur distant via le pipeline jam est EXCLU** —
   ~75 ms de plancher logiciel avant le moindre reseau (NetEq/Opus/
   framing incompressibles sous ~40-50 ms sans refonte glissante).
   Meme en LAN.
2. **La forme JOUABLE du test Massive** : clavier (portable) -> MIDI
   sur le LAN (~2 ms) -> la TOUR rend en 16 ms (exclusif 256) -> les
   T8V dans la piece. **~18-20 ms percus = jouable**, a condition que
   L'AUDIO SORTE OU LE RENDU SE FAIT. Le retour reseau vers le casque
   du portable = monitoring differe (~75-100 ms), pas du jeu.
3. **WAN** : ecoute/jam a ~80-120 ms (modele S8 actuel, propre depuis
   le pre-buffer) ; le jam quantise reste la seule voie "musicale"
   synchrone WAN — a cadrer apres la migration tempo (le quantum
   musical existera alors).
4. Reliquat (session 3 courte, quand le portable est allume) : mesure
   LAN 2 machines pour confirmer le terme reseau (~1-5 ms attendu,
   ne change pas le verdict) + re-mesurer NetEq sur flux amorce en
   longue duree.

## Session 2 — plan initial (réalisé ci-dessus)

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
