*Statut : ARCHIVE (2026-08-28) — prompt one-shot de l'audit 2 (2026-08-21), conserve pour la forme de la commande.*

# Prompt d'audit 2 — a coller dans une session neuve (Fable/Opus, sans historique)

---

# Audit du projet — lecture seule, regard vers l'avant

## Question directrice

Le systeme marche : criteres 1-3 valides, jalon fader->son vert, sync sans
defaut connu. Le prochain chantier est le plus lourd du projet : l'hote VST3
(TODO.md 2.4). Ta question n'est pas « qu'est-ce qui est casse ? » mais :
**« qu'est-ce qui va ceder quand le VST3 va s'appuyer dessus ? »**

Meme cadre que l'audit 1 : tu ne modifies AUCUN fichier ; tu ne rapportes que
ce que tu as verifie par une commande executee (commande + sortie a l'appui) ;
le non-verifiable s'ecrit « non verifie ». Commence par CLAUDE.md, STATUS.md,
TODO.md, DECISIONS.md, AUDIT.md (l'audit 1).

## Les trois zones sous projecteur

1. **Cycle de vie du graphe sous reconstruction frequente**
   (`engine/src/main.cpp`, `audio_device.*`). Le shared_ptr + file de
   retirement a ete concu pour des patches de gain (swap rare et rapide).
   Un plugin qui s'instancie = swap avec chargement de DLL, allocations
   lourdes, etat a transferer. Le mecanisme tient-il quand la construction
   du nouveau graphe prend 500 ms au lieu de 500 us et que trois patches
   arrivent pendant ce temps ? (Empilement de rebuilds, retirement qui
   s'allonge, copyMonitorState sur graphe en construction...)

2. **Le `chain` ignore** (M3 de l'audit 1, jamais solde,
   `automerge_document.cpp` TODO l.419). C'est la que les plugins vivront.
   Que coute son branchement : schema des processeurs (SCHEMA.md vs code),
   ordre d'application, comportement sur type de noeud inconnu, params
   float-only suffisants pour du VST3 ?

3. **Frontieres de processus.** L'isolation par processus des plugins est
   la decision d'origine, jamais implementee. Reste-t-il des hypotheses
   intra-processus cachees : etat du graphe suppose en memoire partagee,
   latence supposee nulle dans la telemetrie/les meters, transport,
   buffers ? Une hypothese cachee trouvee maintenant = une ligne de
   rapport ; au milieu du chantier = un refactor sous pression.

## Le classique

- Ecarts STATUS.md / TODO.md / DECISIONS.md vs realite constatee.
- Dettes de l'audit 1 jamais soldees : solo/mute non atomiques (S4),
  assetHash FNV au lieu de SHA-256 (M4), et verifier s'il en reste.
- Tout ce qu'un regard neuf voit qu'on ne voit plus.

## Le rapport

Un fichier `AUDIT-2.md` : (1) risques pour le chantier VST3 par gravite,
avec fichier, mecanisme de defaillance, et cout de correction avant vs
pendant le chantier ; (2) ce qui est prouve, commandes a l'appui ;
(3) ecarts docs/reel ; (4) les trois choses a faire avant d'ouvrir 2.4,
une phrase chacune. Dur et exact plutot qu'encourageant.
