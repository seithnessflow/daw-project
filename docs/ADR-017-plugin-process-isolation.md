# ADR-017 : Isolation des plugins par processus

**Statut :** accepte (2026-08-22). Formalise la decision d'origine, jamais
ecrite (AUDIT-2 R3 : la frontiere n'existait dans aucune interface).
**Cadre :** cette decision fixe OU vivent les nodes, donc ce que
« transferer l'etat au swap » (R2) et « coalescer les rebuilds » (R1)
veulent dire. Elle se lit AVANT d'ouvrir ces deux chantiers.

## Decision

1. **Les plugins vivent hors du processus moteur.** Pour la tranche fine
   2.4 : un processus hote enfant PAR instance de plugin (semantique de
   crash la plus simple : un plugin qui meurt ne tue ni le moteur ni les
   autres plugins). Regrouper N instances par processus est une
   optimisation ulterieure, pas un choix d'architecture.

2. **Le graphe moteur ne contient que des PROXYS.** Un nud de chain de
   type plugin est un ProcessorNode proxy : il detient un HANDLE
   (processus enfant + id d'instance), jamais l'etat du plugin. L'etat ne
   traverse pas la frontiere de processus — il ne se std::move pas.

3. **Les instances survivent aux rebuilds du graphe.** Le registre des
   instances (cle : id du nud dans le document) appartient au thread de
   controle, pas au graphe. Un swap de graphe re-attache des proxys aux
   instances existantes ; il n'instancie ni ne detruit rien tant que la
   composition de la chain n'a pas change dans le document.
   - Consequence R2 : « transferer l'etat au swap » = transferer des
     handles. Cout : une copie de pointeur/id, pas un etat de plugin.
   - Consequence R1 : le coalescing des rebuilds n'a PAS a proteger les
     plugins des re-instanciations — le registre le garantit deja. Il ne
     reste qu'a sortir la construction du graphe du thread reseau.

## Chemin audio (thread sacre)

- Echange par MEMOIRE PARTAGEE par instance : bloc d'entree + snapshot de
  parametres -> bloc de sortie, taille fixe INTERNAL_BLOCK_SIZE.
- Attente BORNEE cote callback : spin avec echeance (fraction de la
  periode de bloc). Echeance manquee => bypass (l'entree passe telle
  quelle) + compteur d'underrun plugin. Jamais d'attente non bornee,
  jamais de primitive noyau dans le callback (un WaitForSingleObject est
  un syscall : interdit par la regle du thread sacre).
- Latence : ProcessorNode gagne getLatencySamples() (les proxys la
  declarent ; la compensation globale (PDC) attendra qu'il existe plus
  d'une latence non nulle, mais l'interface arrive avec 2.4).

## Chemin de controle

- Instanciation, destruction, parametres : canal de controle vers
  l'enfant (pipe local, messages protobuf — meme outillage que le reste),
  thread de controle uniquement.
- Mort de l'enfant : detectee par le thread de controle (handle de
  processus). Le proxy passe en bypass, l'etat moteur le signale. Le
  moteur survit — c'est le but de cette decision.

## Document

- La chain du document reference un plugin par identifiant stable
  (class-id VST3) + valeurs de parametres. L'etat binaire du plugin
  (chunks) viendra plus tard et suivra le modele des assets (reference,
  jamais le blob dans le document). Toute evolution de SCHEMA.md passe
  par la discipline « format du document » (verification complete).

## Hors perimetre de la tranche fine

Fenetrage/GUI, N instances par processus, sandboxing au-dela de
l'isolation de crash, bridging 32 bits, chunks d'etat dans le document.

## Consequence de verification

La frontiere etant du ressort du thread sacre ET du format du document,
les deux disciplines s'appliquent : tests de non-regression obligatoires,
et le proxy est soumis aux static_assert lock-free de audio_callback.h
comme tout autre node.
