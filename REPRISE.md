# REPRISE.md — point de reprise au demarrage

## TOUT EN HAUT (2026-08-29, soir) : LE FUSIBLE, L'ASSET TARDIF, LES UUID, LE BANDEAU

**A LIRE EN PREMIER — le point de synchro CI : voir « Quoi surveiller »
(verdict du dernier push, A4-8 ; s'il manque, `gh run list --limit 3`
AVANT de coder). Precedent : 700d92f VERT (run 33262436609).**

Quatre livraisons, chacune avec sa spec sur le vrai moteur :

1. **Le fusible** (docs/DECISIONS.md 2026-08-29) : limiteur brick-wall
   zero latence sur la sortie LIVE du moteur seulement (jamais dans les
   stems ni l'export, hashes d'ancre intacts). Plafond -0,3 dBFS,
   `--limiter-ceiling`, `--no-limiter` (A/B). Badge **LIM** sur le
   master (ambre + dB retenus ; barre rouge si desactive), sonde
   `__dawLimiter`. Spec `limiter.spec.ts` (seme son kit : la CI ne
   lance jamais make-kit).
2. **L'asset qui arrive tard** (prealable sonne par la CI) : le moteur
   retenait un 404 pour la session -> clip muet a vie. Desormais retry
   au rebuild suivant avec backoff 1 s, x2, plafond 30 s ; logs `Asset
   xxxxxxxx: retry in N s (attempt k)` puis `now on server after k
   miss(es) - fetched`. Spec `asset-late.spec.ts`. Reste en dette : le
   refus VISIBLE (badge « asset manquant » sur le clip).
3. **A4-11, les ids** : `document/ids.ts` = UN fabricant, `newId(prefix,
   stem?)` -> `<prefixe>[-stem]-<uuid v4>` ; `clipStem()` pour Ctrl+D.
   23 sites, prefixes intacts. Spec `ids-unique.spec.ts`.
4. **A4-8, le bandeau** (decision utilisateur : « on charge avec un
   bandeau », docs/DECISIONS.md) : `document/validate.ts` + bandeau
   `#doc-banner` (ambre, les fautes en clair) a chaque document recu ;
   moteur : `validateDocument` a chaque rebuild, `WARNING: document
   invalid (loaded anyway)` une fois par message. Regles moteur
   rafraichies (MIDI sans asset, ticks, ids en double). Seeder
   `scripts/seed-invalid.mjs`, spec `doc-banner.spec.ts`, sonde
   `__dawDocValidity`.

Pieges payes : `std::max` / `time_point::max()` sans parentheses = la
macro Windows (3 fois) ; gain du limiteur en DOUBLE (le float stagnait
a 0,999886) ; l'incremental ment apres un changement de layout du
contexte callback (`ninja clean`, regle §10) ; en CI le store n'a JAMAIS
le kit du starter.

gtests **63/63**, tsc 0, suite e2e complete **109/109** (3,8 min).

## Comment le voir / l'entendre (5 min)

`start-daw.cmd`, onglet `?project=studio`, master et une piste a +6 dB,
lecture : le badge **LIM** s'allume en ambre avec la reduction ; rien ne
depasse -0,3 dBFS au DAC. Au MiniLab (`scripts\daw.ps1 -MidiIn "Minilab3
MIDI"`), un patch chaud sur Dexed ne peut plus ecreter les T8V. Rien ne
tourne a la cloture.

## Quoi surveiller

1. Le verdict CI du dernier push (un verdict par session).
2. Famille « reading '0' » (doc serveur sans `tracks` sur connexion
   fraiche, TODO §3) : flaky de charge vue 6x le 2026-08-29 sur des runs
   Linux lents ; le seeder est garde, les specs `fader-to-engine:350` et
   `tab-guards` non. A REPRODUIRE cote serveur avant de corriger.
3. Le VU master lit la crete AVANT le fusible (dette TODO §3).

## La suite (ORDRE GRAVE, TODO.md §1)

1. Vague 3, suite : piano-roll musical (nom des notes, zoom, plus d'une
   mesure), preuve a l'oreille d'un LFO tempo-sync (Surge XT, 90 vs
   120 BPM), C1 (HTTP hors de la boucle de controle, moule
   export_job), re-mesure exclusif 256 + MMCSS, Web MIDI,
   timeSignature du doc -> ProcessContext.
2. Reliquat spike LAN ; 3. T4 Link Etage 2 ; 4. perf au regime de
   preuve ; 5. ratifications AUDIT-5 F / AUDIT-6.

Proposition de la session (a arbitrer, pas en file) : **C1 +
eclatement de `main.cpp`** (2077 lignes, `doPlayWithServer` ~730) :
sortir l'HTTP de la boucle de controle oblige a decouper ; session
dediee, moule `export_job`. A4-8 : reste la REPARATION depuis le
bandeau (clamp du gain, id regenere) - decision produit, avec
l'arbitrage d'ecrivain.

## Decisions ouvertes

TODO.md §2 (overlap au drag, mute document, ASIO, placement + lieux
d'ecoute, politique latence heterogene, auth, macOS, veille samod, kit
de demarrage).
