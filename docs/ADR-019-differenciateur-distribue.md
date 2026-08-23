# ADR-019: Le differenciateur distribue — placement, stems rendus, streaming jam

**Statut:** Accepte (arbitrage utilisateur 2026-08-23, sur recadrage
externe — un regard neuf a constate que l'idee centrale du produit
n'existait dans aucun document ni aucune ligne de code)
**Date:** 2026-08-23

## Contexte — la derive constatee

Le projet a construit un excellent DAW mono-machine (moteur natif, hote
VST3 isole, CRDT, rendu deterministe) mais l'IDEE CENTRALE — la
collaboration multi-machine ou un pair profite des plugins natifs d'un
autre — etait a zero ligne :

- Le critere 3 disait « convergence 2 onglets » : deux onglets ne sont
  pas deux utilisateurs (ni reseau, ni horloges, ni identite, ni
  permissions).
- « Un plugin = un class-uid, resolu localement par machine » ne
  repondait pas a la question fondatrice : que se passe-t-il chez B qui
  N'A PAS le plugin ? (Reponse implicite du code : bypass/silence.
  Reponse exigee par le produit : B entend l'audio produit chez A.)
- La loi « rien de temps reel ne traverse le serveur distant », telle
  qu'ecrite, interdisait le produit lui-meme.
- LNA Chrome (l'hypothese porteuse : un site distant peut parler au
  moteur local) etait le critere 4, jamais teste.

## L'invariant produit (grave, testable)

**Un pair qui n'a pas le plugin installe entend le resultat du plugin.**

## Decisions

### 1. La loi reecrite

Ancienne formulation (supprimee partout) : « rien de temps reel ne
traverse le serveur distant ».
Nouvelle loi : **aucun audio n'est TRAITE cote serveur ; l'audio
inter-pairs voyage en P2P ; le serveur ne fait que du signaling (et
eventuellement du relais TURN)**. L'intention d'origine (pas de moteur
audio dans le cloud) est conservee ; l'interdiction accidentelle du
produit est levee.

### 2. Le placement entre dans le document (SCHEMA v2, a concevoir)

Chaque noeud de traitement du graphe declare QUEL PAIR l'heberge,
negocie par capacite (qui a le plugin installe). C'est la modification
structurante : petite maintenant, enorme retro-installee. Le design
detaille (champ placement, negociation, reprise quand le pair hebergeur
part) est la premiere session du chantier — AVANT toute nouvelle ligne
de timeline.

### 3. DEUX canaux de premiere classe, qui ne dedoublent aucun chemin

Arbitrage utilisateur : « les deux en parallele » — stems ET streaming
sont tous deux dans la tranche, aucun n'est une « optimisation
ulterieure ». La regle module/switch est respectee parce qu'ils ne
servent pas la meme fonction :

- **STEMS RENDUS = la verite de LECTURE** (persistante, prouvable).
  La sortie de la chaine VST de A est identifiable par
  `hash(audio d'entree + class-uid + etat des params + plage)`. A rend
  le stem, le pousse au store d'assets (canal 2.3 existant, PUT
  verifiant) ; B le tire comme n'importe quel WAV. Quand A tourne un
  bouton, le hash change, A re-rend, B re-tire. Zero nouveau protocole :
  le determinisme prouve et le store adresse par contenu ETAIENT deja
  les pieces maitresses de ce mecanisme. C'est le chemin qui prouve
  l'invariant par echantillons — il se construit en premier DANS la
  tranche (les sessions sont sequentielles de toute facon).
- **STREAMING P2P = le canal EPHEMERE du jam** (WebRTC/UDP, signaling
  par le serveur). Comme la telemetrie : jamais dans le document, jamais
  une source de verite. Il se construit dans la MEME tranche, apres le
  premier jalon stems, pas « un jour ».

### 4. Perimetre refuse (ecrit pour ne pas y revenir)

Le MONITORING D'INSTRUMENT a latence de jeu via un VST distant (B joue
une note traitee chez A) est physiquement injouable (RTT + buffers =
60-150 ms) : HORS PERIMETRE. Le streaming sert le jam et l'ecoute
partagee, pas la latence de jeu. Si le besoin apparait : instrument
local de substitution pendant le jeu, jamais un aller-retour reseau
dans la boucle de monitoring.

### 5. Le critere 3 redefini, le critere 6 cree

- Critere 3 : **deux machines, deux reseaux, un projet** (la version
  2-onglets devient un sous-ensemble, utile mais non suffisant).
- Critere 6 (l'invariant) : un pair sans le plugin entend le resultat
  du plugin, prouve par echantillons a travers le store.

### 6. LNA passe premier, la parite Ableton est gelee

- Le test LNA Chrome est le PREMIER geste du nouvel ordre : si
  l'hypothese « site distant -> moteur local » tombe, l'architecture
  entiere est a revoir — on le sait avant de construire dessus.
- La roadmap de parite Ableton (fades, automation, sends, tempo,
  depassements, futurs nommes) est GELEE jusqu'a ce que placement +
  stems + critere 3 deux-machines soient verts. Raison : la faire avant
  le distribue produit un DAW mono-utilisateur mediocre et rend le
  distribue impossible a retro-installer.

### Ce qui n'est PAS jete

Les fondations de l'ordre AUDIT-4 restent (requalifiees, pas gelees) :
le trio deps-manquantes (ordre 2) est EXACTEMENT le bug que deux
machines sur deux reseaux declencheront en premier ; le ring (ordre 3)
et le cycle de vie des enfants (ordre 4) portent l'hote que les stems
rendront. 2.5-etat (etat des plugins persiste) devient un PREREQUIS
direct du hash de stem (l'etat des params entre dans la cle).

## Consequences

- SCHEMA.md annonce la v2 (placement + references de stems) — design en
  session dediee.
- STATUS.md porte l'invariant en tete et les criteres redefinis.
- TODO.md ouvre sur la TRANCHE 3 — LE DIFFERENCIATEUR et porte le gel.
- Le serveur « volontairement bete » reste bete pour l'audio, mais
  gagne un avenir explicite : identites/projets/invitations/signaling
  (etat provisoire, plus une loi de design).
