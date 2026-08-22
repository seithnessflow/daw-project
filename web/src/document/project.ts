// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Project document wrapper using Automerge CRDT.
 *
 * Uses @automerge/automerge 2.x with WASM backend.
 * The WASM is bundled in the "fullfat" entrypoint and loads automatically.
 */

import * as Automerge from '@automerge/automerge';
import { ProjectDef, TrackDef, SCHEMA_VERSION } from './schema';

export class Project {
  private doc: Automerge.Doc<ProjectDef>;
  private lastChange: Uint8Array | null = null;

  constructor() {
    // Create empty document with schema
    this.doc = Automerge.from<ProjectDef>({
      schemaVersion: SCHEMA_VERSION,
      sampleRate: 48000,
      tracks: [],
    });
  }

  /**
   * Load a document from Automerge binary bytes.
   */
  load(data: Uint8Array): void {
    try {
      this.doc = Automerge.load<ProjectDef>(data);
    } catch (e) {
      console.error('Failed to load Automerge document:', e);
      // Fallback to empty document
      this.doc = Automerge.from<ProjectDef>({
        schemaVersion: SCHEMA_VERSION,
        sampleRate: 48000,
        tracks: [],
      });
    }
  }

  /**
   * Merge a full remote document (Automerge binary) into the local one.
   *
   * Used on reconnection: the local document is NEVER replaced, so edits
   * made while offline survive and get reconciled by the CRDT.
   *
   * @returns true if the merge brought anything new (heads changed)
   */
  mergeRemote(data: Uint8Array): boolean {
    try {
      const before = Automerge.getHeads(this.doc).join(',');
      const remote = Automerge.load<ProjectDef>(data);
      this.doc = Automerge.merge(this.doc, remote);
      const after = Automerge.getHeads(this.doc).join(',');
      return before !== after;
    } catch (e) {
      console.error('Failed to merge remote document:', e);
      return false;
    }
  }

  /**
   * Apply an incremental change from another peer.
   */
  applyChange(change: Uint8Array): void {
    try {
      const [newDoc] = Automerge.applyChanges(this.doc, [change]);
      this.doc = newDoc;
    } catch (e) {
      console.error('Failed to apply change:', e);
    }
  }

  /**
   * Get the current document state.
   */
  getDocument(): ProjectDef {
    return this.doc;
  }

  /**
   * Serialize the document to Automerge binary format.
   */
  toBytes(): Uint8Array {
    return Automerge.save(this.doc);
  }

  /**
   * Set track gain and generate a change.
   */
  setTrackGain(trackId: string, gain: number): void {
    this.doc = Automerge.change(this.doc, (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      if (track) {
        track.gain = Math.max(0, Math.min(2, gain));
      }
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Get the last change for sending to the server.
   */
  getLastChange(): Uint8Array | null {
    const change = this.lastChange;
    this.lastChange = null;
    return change;
  }

  /**
   * Toggle a chain node's bypass (2.4d) and generate a change.
   */
  setProcessorBypass(trackId: string, processorId: string, bypass: boolean): void {
    this.doc = Automerge.change(this.doc, (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      const proc = track?.chain.find((p) => p.id === processorId);
      if (proc) {
        proc.bypass = bypass;
      }
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Set one processor parameter ({key,value} pair list, SCHEMA.md) and
   * generate a change. The engine re-sends document params on rebuild,
   * so this IS the plugin-param path (same road as the fader).
   */
  setProcessorParam(trackId: string, processorId: string, key: string, value: number): void {
    this.doc = Automerge.change(this.doc, (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      const proc = track?.chain.find((p) => p.id === processorId);
      if (!proc) return;
      const param = proc.params.find((p) => p.key === key);
      if (param) {
        param.value = value;
      } else {
        proc.params.push({ key, value });
      }
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Move a clip on the timeline (drag writes an EXISTING field - no
   * schema question) and generate a change.
   */
  setClipStart(trackId: string, clipId: string, startSample: number): void {
    this.doc = Automerge.change(this.doc, (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (clip) clip.startSample = Math.max(0, Math.round(startSample));
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Resize a clip (edge drag, potion C2) - writes the three EXISTING
   * fields together so a trim never tears across peers.
   */
  setClipBounds(trackId: string, clipId: string,
    bounds: { startSample: number; lengthSamples: number; offsetSamples: number }): void {
    this.doc = Automerge.change(this.doc, (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (!clip) return;
      clip.startSample = Math.max(0, Math.round(bounds.startSample));
      clip.lengthSamples = Math.max(1024, Math.round(bounds.lengthSamples));
      clip.offsetSamples = Math.max(0, Math.round(bounds.offsetSamples));
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Add a clip to a track (the sample kit's placement path) and
   * generate a change.
   */
  addClip(trackId: string, clip: { id: string; assetHash: string;
    startSample: number; lengthSamples: number; offsetSamples: number }): void {
    this.doc = Automerge.change(this.doc, (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      if (track) track.clips.push(clip);
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Add a track and generate a change.
   */
  addTrack(track: TrackDef): void {
    this.doc = Automerge.change(this.doc, (d) => {
      d.tracks.push(track);
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Get current document heads (for sync protocol).
   */
  getHeads(): Automerge.Heads {
    return Automerge.getHeads(this.doc);
  }

  /**
   * Clone the document (for testing/comparison).
   */
  clone(): Automerge.Doc<ProjectDef> {
    return Automerge.clone(this.doc);
  }

  /**
   * Merge with another document.
   */
  merge(other: Automerge.Doc<ProjectDef>): void {
    this.doc = Automerge.merge(this.doc, other);
  }
}
