// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Project document schema types.
 *
 * Mirrors docs/SCHEMA.md
 */

export const SCHEMA_VERSION = 1;

export interface ClipDef {
  id: string;
  assetHash: string;
  startSample: number;
  lengthSamples: number;
  offsetSamples: number;
  /** V1.6: explicit fades, ADDITIVE (absent = 0). 0 = engine default,
   *  an implicit 4 ms anti-click ramp. */
  fadeInSamples?: number;
  fadeOutSamples?: number;
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

export interface TrackDef {
  id: string;
  name: string;
  gain: number;
  clips: ClipDef[];
  chain: ProcessorDef[];
}

export interface ProjectDef {
  schemaVersion: number;
  sampleRate: number;
  /** V1.2: root master gain, linear 0..2. ADDITIVE - absent on old
   *  documents means 1.0 (every consumer defaults it). */
  masterGain?: number;
  tracks: TrackDef[];
  [key: string]: unknown;  // Index signature for Automerge compatibility
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
