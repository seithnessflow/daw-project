# UI-CONVENTIONS.md — ce que les grands DAW ont deja arbitre

*Statut (2026-08-28) : REFERENCE (recherche 2026-08-22). Les « decisions
adoptees » de la fin ont ete appliquees par la refonte « etabli Magic
Potion » (2026-08-25) puis le rack en bas (2026-08-26) ; le seek vit sur
la regle, le clic couloir selectionne. Les mecaniques profondes 1-5 sont
en place sauf l'etat CONTROLLER (seul le Component est serialise) et le
scan `moduleinfo.json` (on passe par l'enfant) — TODO.*

*Recherche 2026-08-22 (5 agents : Ableton Live 11/12, Cubase 13/14,
Logic Pro 10.7/11, suites stock, mecanique profonde du hosting).
Rapports complets dans l'historique de session ; ici : ce qui converge,
ce qui diverge, et ce qu'on adopte. Sources = docs officielles
(ableton.com/manual, steinberg.help, support.apple.com).*

## Convergences (les trois DAW sont d'accord — on ne re-litige pas)

1. **Le clip herite de la couleur de sa piste** ; nom dans un bandeau en
   haut du clip ; waveform dessinee DANS le clip en teinte plus sombre
   de la couleur du fond. Selection = eclaircissement, pas re-coloration.
2. **Le seek vit sur la REGLE, jamais sur la zone des clips** (scrub area
   Ableton sous la regle ; Cubase : partie basse de la regle ; Logic :
   moitie basse, la moitie haute etant le cycle/loop). La zone clips =
   selection/edition. NOTRE seek-au-clic-sur-couloir (lot 3) contredit
   les trois — a corriger.
3. **La couleur est reservee a L'ETAT, jamais decorative** : chrome gris
   neutre, contenu (clips) sature, etats en couleurs codees. Divergence
   de code entre DAW (Ableton : solo bleu / activator jaune ; Logic :
   solo jaune / mute bleu) — l'important est LA DISCIPLINE, pas le code.
4. **La chaine d'effets ne vit PAS dans l'en-tete de piste** : Ableton =
   Device View (bande basse, chaine de LA piste selectionnee, gauche ->
   droite) ; Cubase = Inspector/Channel tab/Lower Zone ; Logic =
   Inspector (paire de strips). Une seule chaine visible a la fois.
5. **Meter contre le fader**, segmente vert/jaune/rouge (>0 dB), peak
   numerique cliquable-resettable. Track header : meter discret ou
   astuce Logic (numero de piste <-> meter pendant la lecture).
6. **Controles d'en-tete par degradation gracieuse** : plus la piste est
   haute, plus de controles apparaissent (Cubase/Logic). Une piste
   compacte garde nom + M/S en dernier.
7. **Bypass par slot** : petit bouton latch sur le bord du slot (Cubase :
   jaune = bypasse ; Logic : power icon au survol, option-clic ;
   Ableton : rond on/off en haut a gauche du device).

## Ce que les suites stock enseignent (pour notre chaine)

- Rendu INLINE de la chaine (Ableton) : panneaux a hauteur fixe, barre
  de titre (on/off, nom, presets), corps = vue generique.
- Vue generique universelle = sliders horizontaux etiquetes + champ
  numerique, plafonnee (~64 params Ableton) et curable (pinner ses
  favoris). C'est NOTRE UI plugin tant qu'il n'y a pas de fenetrage.
- Le socle stock (~10 effets) : EQ, comp, gate, delay, reverb, satur,
  limiteur, multiband, utility/gain, analyseur. PREMIER a livrer :
  un Utility/Gain natif (analogue AGain : gain, phase L/R, width/mono,
  balance) — il valide le pipeline param/etat entier.
- Micro-visualisation sur le slot ferme (vignette EQ Logic, meters strip
  Cubase) : l'etat visible sans ouvrir l'editeur.

## Mecanique profonde (intrants 2.5, avec sources SDK/dev-portal)

1. Etat = DEUX blobs (`IComponent::getState` = verite DSP ;
   `IEditController::getState` = extras UI) ; restauration ordonnee :
   processor d'abord, puis `setComponentState` au controller. Format
   `.vstpreset` : header "VST3" + CID 32 chars + chunks Comp/Cont/Info.
   Capture a la demande (save), jamais en continu.
2. TOUT se cle par le class ID 128 bits, jamais le chemin ; cid->path =
   cache de scan reconstructible (deja notre regle, confirmee).
3. Scan : `moduleinfo.json` (SDK 3.7.5+, enumeration sans charger le
   binaire) d'abord, processus enfant en fallback, blacklist persistee
   (Plug-in Sentinel). Jamais un binaire inconnu dans le processus moteur.
4. Flush : `process()` avec numSamples==0 pour livrer les changements de
   params transport arrete / editeur ferme — sans lui, l'etat restaure
   derive.
5. `restartComponent(kLatencyChanged)` = evenement de rebuild de graphe :
   relire `getLatencySamples()` HORS process(), recalculer le PDC vers le
   pire chemin. Inserts serie pre-fader -> fader/pan -> meter (consensus ;
   post-fader = extension Cubase, pas le socle).
6. Isolation : notre hors-processus-par-defaut est en AVANCE sur
   Live/Cubase/Logic (in-process) ; seul Bitwig offre "Each Plugin".
   Couts documentes : latence de buffering + jitter IPC — exactement nos
   A3-2/A3-3.

## Decisions adoptees pour la vraie UI (proposition 2026-08-22)

- En-tetes de piste A GAUCHE (Cubase/Logic ; Ableton est l'exception).
- Couleur de piste derivee du hash de l'id (12 teintes) tant que le
  schema n'a pas de champ couleur (ajout de champ = session schema
  dediee, zone sensible).
- Regle scindee : bas = seek ; haut = reserve au futur loop. Le clic
  couloir devient selection, plus jamais seek.
- Device View en bande basse pour la piste selectionnee ; chaine
  gauche->droite ; slot = toggle rond bypass + nom + vue generique
  sliders (AGain param 0 en premier slider reel).
- M/S dans l'en-tete (le moteur les a deja en atomiques —
  handleSetMonitor), meter segmente contre le mini-fader.
- Chrome gris neutre, etats : mute orange / solo bleu / bypass ambre /
  record rouge (reserve) / clip>0dB rouge.
