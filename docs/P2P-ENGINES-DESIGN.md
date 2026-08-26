# P2P-ENGINES-DESIGN.md — moteurs pair-a-pair (proposition, a arbitrer)

*Ecrit le 2026-08-26 (tranche 4 de la reprise). PROPOSITION d'architecture —
rien n'est construit (regle : proposer, pas construire a l'aveugle).
Cadre : ADR-019 (aucun audio traite cote serveur ; serveur = signaling).*

## L'etat CIBLE en une phrase

Chaque participant a SON moteur local qui heberge SES plugins ; le document
converge de pair a pair ; stems, assets et audio voyagent directement entre
pairs ; le serveur ne fait plus qu'introduire les pairs (signaling + TURN de
secours) — zero octet de musique chez lui en regime etabli.

## Ce qu'on a DEJA (les fondations posees)

| Brique | Etat | Reutilisable pour |
|--------|------|-------------------|
| Sync Automerge via serveur (WS) | vert | le meme protocole sur DataChannel |
| Store HTTP assets/stems (contenu-adresse) | vert | replication p2p par hash |
| Jam audio P2P (WebRTC, STUN seul, ~40 ms deux NAT) | vert (S8) | le transport WebRTC entier |
| Canal signal: (relais texte leger) | vert | signaling d'introduction |
| Horloge de session L1 (NTP-style, paires) | vert | rien a changer (deja p2p dans l'esprit) |
| Invariant stems (pair sans plugin entend) | vert | inchange — c'est le MOAT |

Constat : le jam S8 prouve deja le chemin WebRTC complet (offre/reponse via
le relais, ICE, deux NAT). L'architecture cible = generaliser ce chemin du
seul AUDIO vers DOC + BLOBS.

## Les 4 etapes (incrementales, chacune utile seule)

### E4 (a faire EN PREMIER — valeur immediate) : MIDI pair -> moteur distant
Le portable JOUE Massive heberge sur la tour. Chemin : clavier (Web MIDI API
sur le portable) -> canal jam-ctl existant (DataChannel, deja < 40 ms) ->
moteur tour -> ring v9 -> plugin. C'est le « test Massive » de la vague 3 et
la demo produit la plus parlante (deux mains, deux machines, un instrument).
- Nouveau : message midi: sur jam-ctl, injection dans ProxyNode (le chemin
  emitMidi EXISTE), monitoring local du retour audio par le jam S8 (existe).
- Critere : accord plaque au portable, son de la tour dans le casque du
  portable, latence bout-en-bout mesuree < 60 ms (40 reseau + buffers).
- Estimation : 2-3 sessions.

### E1 : le DOCUMENT en pair-a-pair
Le protocole de sync Automerge actuel (merge + push anti-entropie, heartbeat)
passe sur un DataChannel WebRTC par paire de pairs ; le serveur reste
l'annuaire (qui est dans la session) et le fallback (pair injoignable).
- Automerge est concu pour ca (merge commutatif — pas de maitre).
- Persistance : CHAQUE pair persiste son doc (le web le fait deja via le
  serveur ; le moteur sait deja charger/sauver). Le « serveur » domestique
  devient un PAIR d'archivage comme les autres.
- Estimation : 3-4 sessions (transport + anti-entropie par paire + tests).

### E2 : STORE en pair-a-pair
Les blobs sont contenu-adresses (deja) : annonce des hashes sur signal:,
fetch HTTP direct pair->pair quand un port est joignable, sinon relai par
morceaux sur DataChannel. Le store serveur devient un cache de secours.
- Estimation : 2-3 sessions.

### E3 : retrait du serveur du chemin de donnees
Presence/annuaire/TURN seulement. Mesurable : zero octet de doc/blob via le
serveur pendant une session a deux pairs joignables.

## Decisions a trancher (l'utilisateur arbitre)

1. **Ordre** : E4 d'abord (demo differenciateur, courte) puis E1 ? Ou E1
   d'abord (fondation) ? Ma recommandation : **E4 d'abord** — courte, valeur
   visible, et elle muscle le canal p2p que E1/E2 reutilisent.
2. **TURN** : les NAT stricts restent sans solution (STUN seul aujourd'hui).
   Heberger un coturn sur le serveur domestique = 1 session d'ops. Quand ?
3. **Securite** : le token partage suffit pour le cercle prive actuel.
   Des cles par pair (obligatoires quand le serveur ne voit plus les octets)
   = chantier a part, a dater.
4. **Multi-pairs (>2)** : v1 = maillage complet (chaque paire un canal) —
   correct jusqu'a ~4 pairs. Au-dela, relais selectif (hors cadre).

## Ce qui ne change JAMAIS (invariants gardes)

- L'hebergement out-of-process des plugins par le moteur local (le moat).
- L'invariant produit : un pair sans le plugin entend le resultat (stems).
- Le determinisme du rendu (hash).
- Aucun audio TRAITE cote serveur (ADR-019).
