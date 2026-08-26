// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Project document schema types.
 *
 * Mirrors docs/SCHEMA.md
 */

export const SCHEMA_VERSION = 1;

/** v8 MIDI : une note du clip. Positions RELATIVES au debut du clip. */
export interface NoteDef {
  pitch: number;         // 0..127
  velocity: number;      // 0..127
  startSample: number;   // relatif au debut du clip
  lengthSamples: number;
}

export interface ClipDef {
  id: string;
  /** Nom d'affichage (additif 2026-08-26, renommable au clic droit). Absent :
   *  les consommateurs derivent un nom de l'id via clipDisplayName(). */
  name?: string;
  assetHash: string;
  startSample: number;
  lengthSamples: number;
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
}

export interface TrackDef {
  id: string;
  name: string;
  gain: number;
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
  [key: string]: unknown;  // Index signature for Automerge compatibility
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

  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Unknown schema version: ${doc.schemaVersion}`);
  }

  return doc;
}

/**
 * Create an empty project document.
 */
export function createEmptyDocument(sampleRate = 48000): ProjectDef {
  return {
    schemaVersion: SCHEMA_VERSION,
    sampleRate,
    tracks: [],
  };
}
