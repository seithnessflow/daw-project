# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-29) : LE FUSIBLE EST POSE — les T8V ont un filet

**A LIRE EN PREMIER — le point de synchro CI : voir le bloc « Quoi
surveiller » ci-dessous (verdict du dernier push de la session du
2026-08-29, lu une fois a la cloture ; s'il manque, `gh run list
--limit 3` AVANT de coder).**

- **Limiteur de sortie** (decision + preuves : docs/DECISIONS.md
  2026-08-29) : brick-wall stereo lie, zero latence, sur la sortie
  LIVE du moteur seulement — jamais dans les stems ni l'export (les
  deux hashes d'ancre sont intacts). Plafond -0,3 dBFS par defaut,
  `--limiter-ceiling <dBFS>`, `--no-limiter` = mesure A/B seulement.
  Log : `output-limiter: ON ceiling=-0.3 dBFS release=80 ms`. Badge
  `LIM` sur la tranche master (ambre + reduction en dB quand il
  retient, barre rouge si desactive), sonde `window.__dawLimiter`.
- Pourquoi pas un device : un device vit dans le document -> stems +
  export + supprimable par un collaborateur. Un fusible se pose sur la
  prise.
- Trouve en route : le gain du limiteur vit en DOUBLE (en float le
  relachement stagne a 0,999886 et l'identite ne revient jamais) ;
  l'incremental a produit un moteur aux gtests verts et a la
  telemetrie folle apres le changement de layout de
  `AudioCallbackContext` — `ninja -t clean` a tout remis d'aplomb
  (regle §10, encore une fois vraie).
- gtests **62/62**, spec `limiter.spec.ts` + 5 voisines vertes, tsc 0,
  suite e2e complete **106/106** (3,8 min).

## Comment le voir / l'entendre (5 min)

`start-daw.cmd`, onglet `?project=studio`, pousser le master a +6 dB et
une piste a +6 dB, lecture : le badge **LIM** a droite du master
s'allume en ambre avec la reduction (« LIM -2.4 »), la crete ne
depasse jamais -0,3 dBFS au DAC. Au MiniLab : `scripts\daw.ps1 -MidiIn
"Minilab3 MIDI"`, un patch chaud sur Dexed ne peut plus ecreter.
Rien ne tourne a la cloture.

## Quoi surveiller

1. Le verdict CI du dernier push (regle : un verdict par session).
2. Le VU master lit la crete AVANT le fusible (dette TODO §3) : le
   badge dit ce qui est retenu, le VU ce que le mix produit.
3. `control-loop stall:` dans les logs moteur (inchange).

## La suite (ORDRE GRAVE, TODO.md §1)

1. Vague 3, suite : piano-roll musical (nom des notes, zoom, plus d'une
   mesure), preuve a l'oreille d'un LFO tempo-sync (Surge XT, 90 vs
   120 BPM), C1 (HTTP hors de la boucle de controle, moule
   export_job), re-mesure exclusif 256 + MMCSS, Web MIDI,
   timeSignature du doc -> ProcessContext.
2. Reliquat spike LAN ; 3. T4 Link Etage 2 ; 4. perf au regime de
   preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

Proposition de la session du 2026-08-29 (a arbitrer, pas en file) :
apres le fusible, les deux items « cheap et sur le differenciateur » —
A4-11 (ids `Date.now()` -> UUID, collision inter-onglets) et A4-8
(`validateDocument` jamais appele) — puis C1 avec l'eclatement de
`main.cpp` (2077 lignes, `doPlayWithServer` ~730).

## Decisions ouvertes

TODO.md §2 (overlap au drag, mute document, ASIO, placement + lieux
d'ecoute, politique latence heterogene, auth, macOS, veille samod, kit
de demarrage).
