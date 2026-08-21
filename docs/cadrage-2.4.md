# Cadrage 2.4 — l'hote VST3, tranche fine

Objectif inchange (TODO.md) : UN plugin de gain VST3 connu s'instancie dans
un processus isole, traite de l'audio, et son bypass s'entend. Un plugin,
un parametre, une preuve. Cadre technique : ADR-017 (proxys, registre,
memoire partagee, spin borne, crash = bypass).

## Choix d'outillage : SDK VST3 directement, sans JUCE

- **JUCE ecarte** : c'est un framework entier (AGPLv3 ou licence
  commerciale) pour ce dont on n'utiliserait que le chargeur de plugins ;
  son modele d'hote in-process se marie mal avec notre isolation par
  processus, et il imposerait sa boucle d'evenements. Meme logique que le
  refus du moteur WASM : on ne prend pas la solution generale.
- **SDK VST3 Steinberg en direct** : la partie hosting du SDK
  (`public.sdk/source/vst/hosting/` : chargement de module, factory,
  PlugProvider) suffit pour la tranche fine. C++, CMake, builds Linux OK
  pour la CI. Vendore comme automerge : `third_party/vst3sdk`, cle sur un
  tag, JAMAIS commite dans le depot.
- Solution de repli si le SDK bloque (licence ou integration) : escalade —
  option a documenter alors : CLAP (API C, licence MIT, plugins de gain
  d'exemple maintenus). Ce n'est PAS la cible (le cap est VST3, c'est lui
  le differenciateur) ; c'est l'option de l'escalade, pas un detour a
  prendre en douce.

## Licence — DECISION UTILISATEUR AVANT LA PREMIERE LIGNE

Le SDK VST3 est en double licence : **GPLv3** OU **accord proprietaire
Steinberg** (gratuit, signature requise aupres de Steinberg).
Contrainte concrete : le depot GitHub est PUBLIC, donc distribue.
- Route GPLv3 : le projet doit porter la GPLv3 (il n'a aujourd'hui AUCUN
  fichier LICENSE — a trancher de toute facon).
- Route accord Steinberg : code du projet libre d'etre ce qu'il veut,
  signature prealable.
Le SDK lui-meme reste hors depot (third_party, gitignore) dans les deux cas.
Dossier a trancher en une reponse : quelle route, et quelle licence pour le
depot. Rien ne se code avant.

## Plugin de test : AGain (exemple officiel du SDK)

Le SDK contient `again`, LE plugin de gain canonique — deterministe,
compilable en CI, aucun binaire tiers a telecharger. C'est lui la cible de
la tranche fine ; les plugins du commerce viendront apres.

## Decoupage en sessions (une preuve chacune)

- **2.4a — le module se charge.** `daw_plugin_host.exe` (processus enfant,
  squelette) : prend un chemin `.vst3`, charge le module, enumere la
  factory (noms + class-ids), sort. Preuve : AGain liste en console.
  + CMake third_party/vst3sdk + build d'AGain. Moteur intouche.
- **2.4b — le plugin traite de l'audio, hors ligne.** Dans l'enfant seul :
  instancier AGain, ProcessSetup (48 kHz, blocs 256, f32), passer un WAV,
  regler le parametre gain. Preuve : comparaison d'echantillons
  (le muscle existant : sortie = entree x gain, bypass = identite).
- **2.4c — le pont.** Memoire partagee + canal de controle (ADR-017),
  ProxyNode dans la chain du moteur, registre branche. C'est ICI que le
  `chain` du document se met enfin a etre lu (M3) et que
  getLatencySamples() entre dans ProcessorNode. Preuve : test de rafale
  toujours vert avec un proxy dans la chain (le registre empeche les
  re-instanciations), crash simule de l'enfant = bypass + moteur vivant.
- **2.4d — le bypass s'entend.** Parametre du plugin dans le document
  (schema : discipline format), pilote depuis l'onglet, rendu WAV compare
  bypass on/off. Preuve : le jalon de la tranche 2, version E2E.

## Le monde exterieur (calibrage)

Les DLL tierces crashent, allouent, ouvrent des fenetres, chargent
n'importe quoi. Regles de survie : tranche fine (une seule inconnue a la
fois), escalade sans bricolage, 3 echecs = STOP, et l'isolation de
processus est precisement la pour que chaque casse externe soit visible
une a la fois. Fenetrage/GUI : hors perimetre jusqu'a 2.4d inclus.
