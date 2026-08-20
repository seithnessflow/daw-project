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

export interface ProcessorDef {
  id: string;
  type: string;
  params: Record<string, number>;
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
