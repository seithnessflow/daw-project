# AMELIORATIONS.md — le registre des ameliorations « worth »

*Regle (demandee 2026-08-22) : des que l'agent voit une amelioration qui
vaut le coup, il met a jour le projet ET la consigne ici, datee, avec ce
qui l'a declenchee. Une amelioration non consignee s'evapore ; une
consignee devient un acquis.*

---

## 2026-08-22 — `rms_dbfs_seconds` : l'oreille possede la vue structurelle

**Declencheur :** la premiere piece composee par l'agent (236 clips poses
au geste) semblait morte (« intro a −93 dB ») alors que le WAV etait
plein de musique. Coupable : le resume fait A LA MAIN moyennait des
DECIBELS — les fenetres a −120 entre les coups de batterie ecrasent la
moyenne. L'energie se moyenne en LINEAIRE, jamais en dB.

**Amelioration :** `ear-analyze` expose `rms_dbfs_seconds` (agregation
lineaire des fenetres 100 ms par seconde). Plus personne ne re-agrege a
la main ; la structure d'un morceau se lit dans le verdict JSON.

## 2026-08-22 — (journee fondatrice, rappel des acquis par la boucle)

Consignes retrospectives des ameliorations nees de l'auto-usage du jour,
deja poussees avec leurs commits :

- **Heartbeat ServerClient** (ping 15 s) : le moteur ne peut plus jouer
  un document gele sur une connexion zombie. Declencheur : sonde meters
  (14 pistes en telemetrie vs 19 au document).
- **clearMeters au chemin silence** : plus de peaks fantomes apres stop.
  Declencheur : la balistique des VU refusait de retomber (25 %).
- **Kit a −6 dB de marge** : le premier beat d'un utilisateur ne clippe
  plus. Declencheur : l'oreille sur le premier beat construit (0 dBFS).
- **Detecteur de clicks calibre musique** (densite + attaque) : les
  percussions et les hats ne sont plus des « 1796 clicks ».
- **Poignees de bord sous le bandeau, plafonnees 30 %** : un clip de
  12 px reste attrapable. Declencheur : usage libre (kick avale).
- **Token par port** : les moteurs de spec n'ecrasent plus le token du
  moteur interactif. Declencheur : pastille Engine morte deux fois en
  une heure.
