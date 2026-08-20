/**
 * Project document wrapper.
 *
 * In a full implementation, this would use Automerge.
 * For slice 1, we use a simple JSON-based approach.
 */

import { ProjectDef, TrackDef, createEmptyDocument, migrateDocument } from './schema';

export class Project {
  private doc: ProjectDef;
  private lastChange: Uint8Array | null = null;

  constructor() {
    this.doc = createEmptyDocument();
  }

  /**
   * Load a document from bytes.
   */
  load(data: Uint8Array): void {
    try {
      const json = new TextDecoder().decode(data);
      const parsed = JSON.parse(json) as ProjectDef;
      this.doc = migrateDocument(parsed);
    } catch (e) {
      console.error('Failed to load document:', e);
      this.doc = createEmptyDocument();
    }
  }

  /**
   * Apply a change to the document.
   */
  applyChange(change: Uint8Array): void {
    // In a real implementation, this would use Automerge.applyChanges
    // For now, treat it as a full document replacement
    this.load(change);
  }

  /**
   * Get the document data.
   */
  getDocument(): ProjectDef {
    return this.doc;
  }

  /**
   * Serialize the document to bytes.
   */
  toBytes(): Uint8Array {
    const json = JSON.stringify(this.doc);
    return new TextEncoder().encode(json);
  }

  /**
   * Set track gain.
   */
  setTrackGain(trackId: string, gain: number): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (track) {
      track.gain = Math.max(0, Math.min(2, gain));
      this.lastChange = this.toBytes();
    }
  }

  /**
   * Get the last change (for sending to server).
   */
  getLastChange(): Uint8Array | null {
    const change = this.lastChange;
    this.lastChange = null;
    return change;
  }

  /**
   * Add a track.
   */
  addTrack(track: TrackDef): void {
    this.doc.tracks.push(track);
    this.lastChange = this.toBytes();
  }
}
