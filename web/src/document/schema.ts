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
  /** 2.4d: bypass is DOCUMENT state, driven from the tab. */
  bypass: boolean;
  params: ProcessorParam[];
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
