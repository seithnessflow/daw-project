// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Project document wrapper using Automerge CRDT.
 *
 * Uses @automerge/automerge 2.x with WASM backend.
 * The WASM is bundled in the "fullfat" entrypoint and loads automatically.
 *
 * V1.3: every LOCAL mutator captures its inverse into the undo journal
 * BEFORE applying (see undo.ts). Undo/redo replay inverses as NEW
 * changes - heads never rewind, remote work always survives.
 */

import * as Automerge from '@automerge/automerge';
import { ProjectDef, TrackDef, ClipDef, ProcessorDef, SCHEMA_VERSION } from './schema';
import { UndoJournal, type InverseOp } from './undo';

/** Automerge proxies -> plain JS (deep), for captured snapshots. */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class Project {
  private doc: Automerge.Doc<ProjectDef>;
  private lastChange: Uint8Array | null = null;
  private journal = new UndoJournal();

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
    // V1.3: the journal referenced a document that no longer exists
    this.journal.clear();
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
   *
   * @returns false when the change could not be applied (missing deps,
   * corrupt bytes) - the caller must request a resync, silence here was
   * the A3-5 divergence hole.
   *
   * Remote changes NEVER touch the undo journal (locked by spec).
   */
  applyChange(change: Uint8Array): boolean {
    try {
      const [newDoc] = Automerge.applyChanges(this.doc, [change]);
      this.doc = newDoc;
      return true;
    } catch (e) {
      console.error('Failed to apply change:', e);
      return false;
    }
  }

  /**
   * The changes the REMOTE document lacks (A3-4): local novelty that a
   * dead-socket flush may have swallowed. Sent back on every
   * reconnection merge - the push half of anti-entropy.
   */
  getMissingChanges(remoteBytes: Uint8Array): Uint8Array[] {
    try {
      const remote = Automerge.load<ProjectDef>(remoteBytes);
      return Automerge.getChanges(remote, this.doc);
    } catch (e) {
      console.error('Failed to diff against remote document:', e);
      return [];
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

  // ---- Undo/redo (V1.3) ---------------------------------------------------

  /** One user gesture = one undo entry (drag/fader coalescing). */
  beginUndoGroup(): void { this.journal.beginGroup(); }
  endUndoGroup(): void { this.journal.endGroup(); }

  /**
   * Undo the last local gesture. Applies inverse ops as NEW changes;
   * emit() runs after each applied op so every change reaches the wire.
   * @returns true if something was undone
   */
  undo(emit?: () => void): boolean {
    const ops = this.journal.popUndo();
    if (!ops) return false;
    this.journal.routeReplay('to-redo', () => this.replay(ops, emit));
    return true;
  }

  /** Redo the last undone gesture. */
  redo(emit?: () => void): boolean {
    const ops = this.journal.popRedo();
    if (!ops) return false;
    this.journal.routeReplay('to-undo', () => this.replay(ops, emit));
    return true;
  }

  private replay(ops: InverseOp[], emit?: () => void): void {
    for (const op of ops) {
      switch (op.type) {
        case 'setTrackGain': this.setTrackGain(op.trackId, op.gain); break;
        case 'setMasterGain': this.setMasterGain(op.gain); break;
        case 'setProcessorBypass':
          this.setProcessorBypass(op.trackId, op.processorId, op.bypass); break;
        case 'setProcessorParam':
          this.setProcessorParam(op.trackId, op.processorId, op.key, op.value); break;
        case 'removeProcessorParam':
          this.removeProcessorParam(op.trackId, op.processorId, op.key); break;
        case 'setClipStart': this.setClipStart(op.trackId, op.clipId, op.startSample); break;
        case 'setClipBounds': this.setClipBounds(op.trackId, op.clipId, op.bounds); break;
        case 'addClip': this.addClip(op.trackId, op.clip); break;
        case 'deleteClip': this.deleteClip(op.trackId, op.clipId); break;
        case 'addTrack': this.addTrack(op.track); break;
        case 'deleteTrack': this.deleteTrack(op.trackId); break;
        case 'addProcessor': this.addProcessor(op.trackId, op.proc, op.index); break;
        case 'removeProcessor': this.removeProcessor(op.trackId, op.processorId); break;
      }
      emit?.();
    }
  }

  // ---- Mutators (each captures its inverse BEFORE applying) ---------------

  /**
   * Set track gain and generate a change.
   */
  setTrackGain(trackId: string, gain: number): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track) return;  // target gone (maybe remotely): silent no-op
    this.journal.capture({ type: 'setTrackGain', trackId, gain: track.gain });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t) t.gain = Math.max(0, Math.min(2, gain));
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * V1.2: set the root master gain (linear, clamped 0..2 like tracks).
   */
  setMasterGain(gain: number): void {
    const before = typeof this.doc.masterGain === 'number' ? this.doc.masterGain : 1;
    this.journal.capture({ type: 'setMasterGain', gain: before });
    this.doc = Automerge.change(this.doc, (d) => {
      d.masterGain = Math.max(0, Math.min(2, gain));
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
    const proc = this.doc.tracks.find((t) => t.id === trackId)
      ?.chain.find((p) => p.id === processorId);
    if (!proc) return;
    this.journal.capture({
      type: 'setProcessorBypass', trackId, processorId, bypass: proc.bypass });
    this.doc = Automerge.change(this.doc, (d) => {
      const p = d.tracks.find((t) => t.id === trackId)
        ?.chain.find((x) => x.id === processorId);
      if (p) p.bypass = bypass;
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Set one processor parameter ({key,value} pair list, SCHEMA.md) and
   * generate a change. The engine re-sends document params on rebuild,
   * so this IS the plugin-param path (same road as the fader).
   */
  setProcessorParam(trackId: string, processorId: string, key: string, value: number): void {
    const proc = this.doc.tracks.find((t) => t.id === trackId)
      ?.chain.find((p) => p.id === processorId);
    if (!proc) return;
    const existing = proc.params.find((p) => p.key === key);
    // A NEW key's inverse is a REMOVAL, not a value (ultra-challenged case)
    this.journal.capture(existing
      ? { type: 'setProcessorParam', trackId, processorId, key, value: existing.value }
      : { type: 'removeProcessorParam', trackId, processorId, key });
    this.doc = Automerge.change(this.doc, (d) => {
      const p = d.tracks.find((t) => t.id === trackId)
        ?.chain.find((x) => x.id === processorId);
      if (!p) return;
      const param = p.params.find((x) => x.key === key);
      if (param) {
        param.value = value;
      } else {
        p.params.push({ key, value });
      }
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /** Inverse of a param CREATION (V1.3): splice the {key,value} entry out. */
  removeProcessorParam(trackId: string, processorId: string, key: string): void {
    const proc = this.doc.tracks.find((t) => t.id === trackId)
      ?.chain.find((p) => p.id === processorId);
    const existing = proc?.params.find((p) => p.key === key);
    if (!proc || !existing) return;
    this.journal.capture({
      type: 'setProcessorParam', trackId, processorId, key, value: existing.value });
    this.doc = Automerge.change(this.doc, (d) => {
      const p = d.tracks.find((t) => t.id === trackId)
        ?.chain.find((x) => x.id === processorId);
      if (!p) return;
      const i = p.params.findIndex((x) => x.key === key);
      if (i >= 0) p.params.splice(i, 1);
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Move a clip on the timeline (drag writes an EXISTING field - no
   * schema question) and generate a change.
   */
  setClipStart(trackId: string, clipId: string, startSample: number): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    this.journal.capture({
      type: 'setClipStart', trackId, clipId, startSample: clip.startSample });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (c) c.startSample = Math.max(0, Math.round(startSample));
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Resize a clip (edge drag, potion C2) - writes the three EXISTING
   * fields together so a trim never tears across peers.
   */
  setClipBounds(trackId: string, clipId: string,
    bounds: { startSample: number; lengthSamples: number; offsetSamples: number }): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    this.journal.capture({
      type: 'setClipBounds', trackId, clipId,
      bounds: {
        startSample: clip.startSample,
        lengthSamples: clip.lengthSamples,
        offsetSamples: clip.offsetSamples,
      },
    });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (!c) return;
      c.startSample = Math.max(0, Math.round(bounds.startSample));
      c.lengthSamples = Math.max(1024, Math.round(bounds.lengthSamples));
      c.offsetSamples = Math.max(0, Math.round(bounds.offsetSamples));
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Delete a clip (Delete key on the selection) and generate a change.
   */
  deleteClip(trackId: string, clipId: string): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    // Inverse = re-add with ALL captured fields, same id
    this.journal.capture({ type: 'addClip', trackId, clip: plain(clip) as ClipDef });
    this.doc = Automerge.change(this.doc, (d) => {
      const track = d.tracks.find((t) => t.id === trackId);
      if (!track) return;
      const i = track.clips.findIndex((c) => c.id === clipId);
      if (i >= 0) track.clips.splice(i, 1);
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Add a clip to a track (the sample kit's placement path) and
   * generate a change.
   */
  addClip(trackId: string, clip: ClipDef): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track) return;
    this.journal.capture({ type: 'deleteClip', trackId, clipId: clip.id });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t) t.clips.push(clip);
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Add a track and generate a change.
   */
  addTrack(track: TrackDef): void {
    this.journal.capture({ type: 'deleteTrack', trackId: track.id });
    this.doc = Automerge.change(this.doc, (d) => {
      d.tracks.push(track);
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * Delete a track (V1.3: born as addTrack's inverse; captures the FULL
   * TrackDef - clips and chain included - so its own inverse restores
   * everything).
   */
  deleteTrack(trackId: string): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track) return;
    this.journal.capture({ type: 'addTrack', track: plain(track) as TrackDef });
    this.doc = Automerge.change(this.doc, (d) => {
      const i = d.tracks.findIndex((t) => t.id === trackId);
      if (i >= 0) d.tracks.splice(i, 1);
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * V1.5: add a device to a track's chain. `index` (optional) inserts at
   * a position - undo of a removal puts the device BACK WHERE IT WAS
   * (a chain is a pipeline, order is meaning).
   */
  addProcessor(trackId: string, proc: ProcessorDef, index?: number): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track) return;
    if (track.chain.some((p) => p.id === proc.id)) return;  // id collision: no-op
    this.journal.capture({ type: 'removeProcessor', trackId, processorId: proc.id });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (!t) return;
      if (index !== undefined && index >= 0 && index <= t.chain.length) {
        t.chain.splice(index, 0, proc);
      } else {
        t.chain.push(proc);
      }
    });
    this.lastChange = Automerge.getLastLocalChange(this.doc) ?? null;
  }

  /**
   * V1.5: remove a device from a track's chain. Inverse = re-add the FULL
   * captured ProcessorDef (params included) at its original index.
   */
  removeProcessor(trackId: string, processorId: string): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    const index = track ? track.chain.findIndex((p) => p.id === processorId) : -1;
    if (!track || index < 0) return;
    this.journal.capture({
      type: 'addProcessor', trackId,
      proc: plain(track.chain[index]) as ProcessorDef, index,
    });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (!t) return;
      const i = t.chain.findIndex((p) => p.id === processorId);
      if (i >= 0) t.chain.splice(i, 1);
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
