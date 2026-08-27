// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Project document schema types.
 *
 * Mirrors docs/SCHEMA.md
 */

import { effectiveMap, type TempoPoint } from './tempo';

/**
 * v2 (migration TEMPO T1, ADDITIVE-DUAL ratifie 2026-08-27) : le
 * document gagne un domaine MUSICAL (ticks, PPQ 960) A COTE du domaine
 * absolu (samples). L'existant garde ses samples exacts (warp-off a la
 * Live) ; le nouveau devient musical. Un champ *Tick PRESENT = objet
 * musical ; il est alors EXCLUSIF du champ samples correspondant (garde
 * sanitize). Le bump v2 est LAZY (ensureV2 au premier ecrit musical) -
 * createEmptyDocument RESTE v1 (invariant du seed vendore, byte-
 * identique sur les 3 etages).
 */
export const SCHEMA_VERSION = 2;

/** Signature rythmique POSITIONNEE (liste d'evenements, non
 *  automatable). Absent = 4/4 partout. */
export interface TimeSignatureEvent {
  tick: number;  // position musicale de l'evenement
  num: number;   // 1..32
  den: number;   // 1|2|4|8|16|32
}

/** v8 MIDI : une note du clip. Positions RELATIVES au debut du clip.
 *  v2 : les notes d'un clip MUSICAL utilisent startTick/lengthTick (le
 *  domaine du clip parent gouverne — jamais un mix des deux). */
export interface NoteDef {
  pitch: number;         // 0..127
  velocity: number;      // 0..127
  /** Relatif au debut du clip (domaine absolu). T3 : OPTIONNEL - une
   *  note MUSICALE porte startTick/lengthTick a la place (exclusivite
   *  de domaine) ; lire via geometry.noteStartSamples, jamais en direct. */
  startSample?: number;
  lengthSamples?: number;
  /** v2 : position musicale relative au debut du clip (PPQ 960). */
  startTick?: number;
  lengthTick?: number;
}

export interface ClipDef {
  id: string;
  /** Nom d'affichage (additif 2026-08-26, renommable au clic droit). Absent :
   *  les consommateurs derivent un nom de l'id via clipDisplayName(). */
  name?: string;
  assetHash: string;
  /** T3 : OPTIONNEL - un clip MUSICAL porte startTick a la place
   *  (exclusivite de domaine, garde sanitize). TOUT consommateur de
   *  geometrie passe par geometry.clipStartSamples, jamais en direct. */
  startSample?: number;
  /** Toujours present sur un clip audio (le contenu ne s'etire pas) ;
   *  un clip MIDI musical peut porter lengthTick a la place. */
  lengthSamples?: number;
  offsetSamples: number;
  /** V1.6: explicit fades, ADDITIVE (absent = 0). 0 = engine default,
   *  an implicit 4 ms anti-click ramp. */
  fadeInSamples?: number;
  fadeOutSamples?: number;
  /** v8 MIDI : notes du clip (absent/vide = clip audio classique). */
  notes?: NoteDef[];
  /** T7 Session : si present, ce clip est un SLOT du clip-launcher (scene
   *  sceneId), pas un clip de la timeline. Le moteur l'ignore en timeline. */
  sceneId?: string;
  /** v2 : PRESENCE = clip MUSICAL (position en ticks, resolue en samples
   *  par le noyau tempo). EXCLUSIF de startSample (garde sanitize —
   *  startSample deviendra optionnel dans le type en T3, quand
   *  clipStartSamples() sera LE point de branche geometrie).
   *  Un clip AUDIO musical : position en ticks, CONTENU en samples
   *  (deplace par le tempo, jamais etire). */
  startTick?: number;
  /** v2 : duree musicale (clips MIDI musicaux). Un clip audio musical
   *  garde lengthSamples (le contenu ne s'etire pas). */
  lengthTick?: number;
}

/** One parameter as a {key, value} pair - a LIST across every consumer
 *  (docs/SCHEMA.md): key is a name for builtin nodes ("gain"), a VST3
 *  param id as a decimal string ("0") for vst3 nodes. */
export interface ProcessorParam {
  key: string;
  value: number;
}

export interface ProcessorDef {
  id: string;
  type: string;
  /** vst3 only: 32-hex VST3 class id. The document NEVER carries module
   *  paths - uid -> module resolution is host-side. */
  uid?: string;
  /** Display name (additive, tab-authored at add time - Ableton's title
   *  bar). The engine ignores it; absent on old devices (UI falls back). */
  name?: string;
  /** 2.4d: bypass is DOCUMENT state, driven from the tab. */
  bypass: boolean;
  params: ProcessorParam[];
  /** 2.5-etat (additive, ENGINE-authored): content-addressed reference
   *  to the plugin's opaque state blob in the store. The tab never
   *  writes these - only the machine hosting the plugin can. */
  stateHash?: string;
  stateVersion?: number;
  /** S7 stems (additive, ENGINE-authored): the node's rendered truth.
   *  A peer without the plugin plays stemHash; stemKey is the
   *  input-cache freshness key (stale = UI state, never a block). */
  stemHash?: string;
  stemKey?: string;
  stemLatencySamples?: number;
}

/**
 * A1 automation (AUTOMATION-DESIGN.md section 1) : une ENVELOPPE =
 * une courbe temps -> valeur attachee a un parametre. v est NORMALISE
 * 0..1 partout (mappe par le consommateur - les unites ne se gravent
 * pas dans le document), t en SAMPLES timeline (int, >= 0 - invariant
 * SCHEMA.md 1). Points = liste Automerge d'objets {t,v} TRIEE par t a
 * l'ecriture : deux pairs qui editent des points differents mergent
 * naturellement. Interpolation lineaire v1 (un champ shape additif
 * par point viendra plus tard sans invalider le format).
 */
export interface AutomationLaneDef {
  id: string;
  target: {
    /** Absent = parametre de PISTE (gain/pan) - ou de MASTER quand la
     *  lane vit sur ProjectDef.automation. */
    processorId?: string;
    /** 'gain' | 'pan' | cle native ('drive') | id VST3 decimal ('0'). */
    param: string;
  };
  points: { t: number; v: number }[];
  /** Bypass de la lane (l'etat manuel reprend quand false). */
  enabled: boolean;
  /** v2 : 'ticks' = les t des points sont des TICKS (lane musicale,
   *  resolue par le noyau tempo). Absent = samples (legacy). */
  timeBase?: 'ticks';
}

/** Type de piste (2026-08-27, demande utilisateur « il faut des tracks
 *  midi et des tracks audio »). ADDITIF : absent = piste LEGACY mixte
 *  (tous les projets existants) - elle accepte tout, rien ne casse.
 *  Le moteur IGNORE ce champ (il sait deja jouer les deux par clip) :
 *  le kind est un contrat d'EDITION, applique par les gardes de gestes
 *  (pas de sample sur une piste MIDI, pas de clip MIDI ni d'instrument
 *  sur une piste audio). */
export type TrackKind = 'audio' | 'midi';

export interface TrackDef {
  id: string;
  name: string;
  gain: number;
  /** Type de piste - ADDITIF, absent = legacy mixte (voir TrackKind). */
  kind?: TrackKind;
  /** F2 : pan -1 (gauche) .. 0 (centre) .. +1 (droite). ADDITIF - absent sur
   *  les anciens projets (le moteur retombe sur 0 centre). */
  pan?: number;
  /** D1 (DND-DESIGN.md) : ordre d'AFFICHAGE, fractionnaire. ADDITIF - absent
   *  sur les vieux docs (les consommateurs retombent sur l'index de liste).
   *  La LISTE Automerge garde l'ordre de CREATION et ne bouge JAMAIS :
   *  reordonner = ecrire ce champ (LWW par champ), jamais delete+insert -
   *  l'identite de l'objet survit et les edits concurrents d'un pair
   *  (gain, pan...) ne sont pas perdus pendant un deplacement. */
  order?: number;
  clips: ClipDef[];
  chain: ProcessorDef[];
  /** A1 : lanes d'automation de la piste. ADDITIF - absent = rien.
   *  Le moteur les ignore jusqu'a la tranche A2. */
  automation?: AutomationLaneDef[];
}

/** T7 (Session) : une scene = une LIGNE du clip-launcher (un groupe de
 *  clips lancables ensemble). Les clips de session portent sceneId. */
export interface SceneDef {
  id: string;
  name: string;
}

export interface ProjectDef {
  schemaVersion: number;
  sampleRate: number;
  /** V1.2: root master gain, linear 0..2. ADDITIVE - absent on old
   *  documents means 1.0 (every consumer defaults it). */
  masterGain?: number;
  tracks: TrackDef[];
  /** T7 : scenes du clip-launcher (absent = pas de vue Session). */
  scenes?: SceneDef[];
  /** A1 : lanes d'automation du MASTER (target sans processorId = les
   *  parametres racine, ex 'gain' -> masterGain). ADDITIF - absent = rien. */
  automation?: AutomationLaneDef[];
  /** v2 : tempo du projet en milli-BPM entier (120000 = 120 BPM), LWW,
   *  bornes 20000..999000. Absent = 120000. */
  tempoMilliBpm?: number;
  /** v2 : signatures rythmiques positionnees (absent = 4/4 partout). */
  timeSignature?: TimeSignatureEvent[];
  /** v2 : carte de tempo piecewise-constant, TRIEE par tick (absent =
   *  le registre tempoMilliBpm seul). */
  tempoMap?: TempoPoint[];
  [key: string]: unknown;  // Index signature for Automerge compatibility
}

/** v2 : un champ *Tick PRESENT = le clip est MUSICAL. LA definition
 *  (la presence, jamais la valeur — un startTick 0 est musical). */
export function isMusicalClip(
  clip: Pick<ClipDef, 'startTick'>): boolean {
  return typeof clip.startTick === 'number';
}

/** v2 : la carte de tempo effective du document (registre + tempoMap
 *  via le noyau — LA porte unique, jamais lire tempoMap directement). */
export function effectiveTempoMap(
  doc: Pick<ProjectDef, 'tempoMilliBpm' | 'tempoMap'>): TempoPoint[] {
  return effectiveMap(doc.tempoMilliBpm ?? 120000, doc.tempoMap ?? []);
}

/** v2 : bump LAZY — a appeler DANS un change() avant le premier ecrit
 *  musical. Un document jamais touche musicalement reste v1 pour
 *  toujours (le seed vendore reste byte-identique). */
export function ensureV2(doc: ProjectDef): void {
  if (doc.schemaVersion < 2) doc.schemaVersion = 2;
}

/**
 * Nom d'affichage d'un clip - SOURCE UNIQUE (remplace 3 derivations jumelles
 * track.ts/wiring.ts/placement.ts). `name` prime ; sinon on derive de l'id :
 * 'clip-kick-1787...' -> 'kick'. Un id purement aleatoire (addMidiClip /
 * addSessionClip : 'clip-' + 8 base36) n'a aucun sens humain -> 'MIDI' ou
 * 'clip', jamais l'id brut.
 */
export function clipDisplayName(
  clip: Pick<ClipDef, 'id' | 'name' | 'notes'>): string {
  const named = clip.name?.trim();
  if (named) return named;
  const stem = clip.id.replace(/^clip-/, '').replace(/-\d+$/, '');
  if (clip.id === `clip-${stem}` && /^[a-z0-9]{6,12}$/.test(stem)) {
    return clip.notes ? 'MIDI' : 'clip';
  }
  return stem || 'clip';
}

/**
 * FABRIQUE de piste - SOURCE UNIQUE du moule (remplace le jumeau
 * wiring.ts / placement.ts note dans leurs commentaires). kind absent =
 * legacy mixte (le bouton du coin passe toujours un kind).
 */
export function makeTrackDef(name: string, kind?: TrackKind): TrackDef {
  const t: TrackDef = {
    id: `track-${Date.now()}`,
    name,
    gain: 1.0,
    clips: [],
    chain: [],
  };
  if (kind) t.kind = kind;  // Automerge refuse undefined
  return t;
}

/** Gardes d'edition du kind (absent = legacy : tout est permis). */
export function trackAcceptsAudio(t: Pick<TrackDef, 'kind'>): boolean {
  return t.kind !== 'midi';
}
export function trackAcceptsMidi(t: Pick<TrackDef, 'kind'>): boolean {
  return t.kind !== 'audio';
}

/**
 * D1 : les pistes dans l'ordre d'AFFICHAGE - SOURCE UNIQUE du tri.
 * Cle = (order ?? index dans la liste), croissant ; en cas d'egalite,
 * l'ordre de la liste Automerge (= ordre de creation) tranche - tri
 * STABLE et deterministe sur tous les pairs. Une vieille piste sans
 * `order` garde donc sa place historique tant que personne ne la bouge.
 * Tout consommateur qui presente les pistes (arrangement, session,
 * mixer) passe par ici ; doc.tracks reste l'ordre de creation.
 */
export function orderedTracks(doc: ProjectDef): TrackDef[] {
  return doc.tracks
    .map((t, i) => ({ t, key: t.order ?? i, i }))
    .sort((a, b) => (a.key - b.key) || (a.i - b.i))
    .map((x) => x.t);
}

/**
 * Migrate a document to the current schema version.
 */
export function migrateDocument(doc: ProjectDef): ProjectDef {
  // Version 1 is the initial version - no migration needed
  if (doc.schemaVersion === 0) {
    doc.schemaVersion = 1;
  }

  // v2 est PUREMENT ADDITIF (champs musicaux optionnels) : un lecteur
  // v2 lit un v1 tel quel, rien a migrer. Le bump 1 -> 2 est LAZY
  // (ensureV2 au premier ecrit musical), jamais fait ici.
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Unknown schema version: ${doc.schemaVersion}`);
  }

  return doc;
}

/**
 * Create an empty project document.
 *
 * RESTE v1 VOLONTAIREMENT (pas SCHEMA_VERSION) : le seed vendore
 * commun aux 3 etages doit rester byte-identique (invariant A4-3).
 * Le passage a v2 est lazy via ensureV2 au premier ecrit musical.
 */
export function createEmptyDocument(sampleRate = 48000): ProjectDef {
  return {
    schemaVersion: 1,
    sampleRate,
    tracks: [],
  };
}
