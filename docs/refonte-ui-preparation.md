# Preparation de la session refonte UI

*Prepare le 2026-08-22, pendant la sentinelle du push outillage (#61).
La refonte N'A PAS commence : ce document est l'intrant de sa premiere
session. Captures de reference : `web/snap/full-1536.png` (l'audit par la
grille est dans STATUS/session outillage).*

---

## 1. Proposition niveau 3 — la metaphore (decision a ratifier APRES les mains)

*Ordre corrige 2026-08-22 (conseil recu et consigne) : la ratification
vient APRES le test des mains, jamais avant — les quinze minutes de
manipulation sont un intrant de CETTE decision aussi ; le seul capteur
de niveau 3-4 du projet n'a pas touche le produit depuis la page a deux
boutons. L'utilisateur sentira dans ses mains si ce produit est une
console ou une timeline.*

**Constat (capture full-1536.png)** : l'ecran est une liste de lignes
fader ; le document contient des clips (id, assetHash, start, length) que
l'UI ne dessine NULLE PART. La position (17:53.600) court sans timeline.
L'ecran ne montre ni le temps, ni le contenu, ni qui a mis quoi ou.

**Les deux metaphores candidates :**

- **A. Console d'abord** (strips verticaux) : le mix comme objet central.
  Ce qu'elle paie : le contenu reste invisible ; or il n'y a aujourd'hui
  presque rien a mixer (gain + un plugin) et deja des clips a montrer.
- **B. Timeline d'abord** (lignes horizontales = pistes, clips poses sur
  une regle de temps, tete de lecture vivante) : le contenu comme objet
  central, les controles de piste (gain, chain, meter) en en-tete de
  ligne, compacts.

**Decision proposee : B, timeline d'abord.** Trois raisons, dans l'ordre :
1. Le produit est COLLABORATIF : « qui a mis quoi, ou » est l'information
   que deux personnes se montrent (avis utilisateur convergent, recu a la
   session outillage). La convergence de clips entre onglets devient
   VISIBLE, donc testable par capture.
2. Le document a deja les donnees (clips, start/length, sample_rate) —
   la timeline REND ce qui existe ; la console mettrait en scene ce qui
   n'existe pas encore (sends, bus, inserts multiples).
3. La tete de lecture donne enfin un sens au position readout, et la
   mission critere 5/latence (2.4d) a un endroit ou s'afficher.

La console viendra comme SECONDE vue quand il y aura quelque chose a
mixer (declencheur : >1 plugin par piste ou >8 pistes reelles). Pas de
bifurcation d'options en attendant (regle module/switch).

**Croquis cible (annotation de la capture) :**

```
+--------------------------------------------------------------+
| DAW        [pastilles] [Play][Stop]  position 00:12.3 / 00:30 |
+--------------+-----------------------------------------------+
| Track 1      | ..[clip 662f17e]................              |
| [gain][meter]|            ^ tete de lecture                  |
| [vst3][byp]  |                                               |
+--------------+-----------------------------------------------+
| Track 2      | (vide - rang compact, ~1/3 de la hauteur      |
| [gain][meter]|  d'une piste avec contenu)                    |
+--------------+-----------------------------------------------+
| + Add Track  |  regle de temps (secondes)                    |
+--------------------------------------------------------------+
```

Corollaire niveau 2 regle par la structure : une piste vide se rend
COMPACTE (le mur des 37 s'ecrase de lui-meme) ; le wrap du label dB et la
congestion Track 1 se dissolvent dans l'en-tete redessine (arbitrage
recu : pas de rapiecage avant).

---

## 2. Invariants existants — ce que le harnais verrouille deja

| Spec | Invariant verrouille |
|------|----------------------|
| `fader-to-engine.spec.ts` | fader -> document -> moteur (gain entendu) ; bypass clique -> echantillons changes (jalon 2.4d) |
| `criterion3-convergence.spec.ts` | gain/piste converge entre 2 onglets, bidirectionnel |
| `criterion3-offline.spec.ts` | coupure serveur reelle, edits offline, fusion sans perte |
| `outbox-persistence.spec.ts` | edit hors ligne dans un onglet FERME, rejoue |
| `asset-fetch.spec.ts` | asset present seulement sur le serveur -> le moteur le tire |

Ces invariants sont les BONS (contrat, pas pixels). Le probleme n'est pas
leur contenu, c'est leur ANCRAGE.

## 3. Le danger : les selecteurs sont structurels, pas contractuels

Inventaire (grep session preparation) :

- `input[type="range"]` — helpers.ts:166,178, diag.spec.ts:34,46 : le
  fader est suppose etre un input natif. Un fader redessine (div, drag
  custom, vertical) casse TOUS les helpers d'un coup.
- `.chain-bypass` (classe de style) — fader-to-engine.spec.ts:359.
- `#server-status.connected` — classe d'etat visuel utilisee comme etat
  logique (helpers.ts:155,229, diag.spec.ts:20).
- JUMEAU : helpers.ts et diag.spec.ts dupliquent la meme logique
  querySelector/dispatch (rayon de couplage — corriger les deux ou
  unifier, sinon regression a retardement).

**PREMIER GESTE de la session refonte, AVANT tout pixel : le contrat de
selection.** L'UI expose un contrat stable, ARIA d'abord :

- piste : `[data-track-id="<id>"]` (existe, on le garde)
- fader : `role="slider"` + `aria-valuenow` (l'input range natif l'a
  DEJA implicitement — le contrat est retro-compatible, un fader custom
  devra le fournir)
- bypass : `[data-node-id="<id>"]` + `aria-pressed` (aria-pressed existe
  depuis 2.4d — on y ancre le test au lieu de la classe)
- connexions : `data-state="connected"` sur les pastilles (la classe
  reste pour le style, le test lit l'etat)

Migration : helpers.ts unifie (diag.spec importe les helpers au lieu de
son jumeau), selecteurs remplaces, suite COMPLETE verte AVANT le premier
changement visuel. C'est le harnais qui autorise l'agressivite.

## 4. Plan de la session refonte (bornee, dans l'ordre)

0. PREREQUIS : LE TEST DES MAINS est fait et ses notes lues (intrant du
   point 2 — voir l'ordre corrige en tete de section 1). S'il ne l'est
   pas a l'ouverture, il devient le premier geste de la seance, stack
   relancee au besoin (~30 s).
1. Contrat de selection + unification helpers (section 3) -> suite e2e
   complete verte, AUCUN changement visuel. Commit. (Bonus consigne :
   ce contrat EST de l'accessibilite — DAW navigable au lecteur d'ecran
   par construction, sous-produit d'une decision de testabilite.)
2. Ratification de la metaphore (section 1) sur ce document + la capture
   + LES NOTES DES MAINS.
3. Structure timeline : en-tetes de piste + zone temps + clips rendus
   (donnees deja dans le document), pistes vides compactes. La boucle
   snap/grille tourne a chaque lot ; ear si le chemin audio est touche
   (il ne devrait PAS l'etre — refonte = DOM/CSS/rendu, zero contrat
   moteur).
4. Tete de lecture branchee sur la telemetrie position existante.
5. Verdict : suite e2e complete + snap final + bilan 3 lignes.

Hors perimetre (dettes datees) : drag de clips, zoom timeline, selection
multiple, la vue console.
