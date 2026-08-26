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
import { ProjectDef, TrackDef, ClipDef, ProcessorDef, NoteDef, SceneDef } from './schema';
import { UndoJournal, type InverseOp } from './undo';
import { seedBytes } from './seed';

/**
 * A4-3: every placeholder is the SAME seed document (vendored bytes,
 * identical on the server) - offline edits made before first server
 * contact share the server root and MERGE instead of being wiped.
 * load() gives this doc a fresh random actor for subsequent changes.
 */
function seedDoc(): Automerge.Doc<ProjectDef> {
  return Automerge.load<ProjectDef>(seedBytes());
}

/** Automerge proxies -> plain JS (deep), for captured snapshots. */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class Project {
  private doc: Automerge.Doc<ProjectDef>;
  // F5+ fix (2026-08-26) : FILE de modifications en attente, plus un scalaire.
  // L'ancien lastChange unique PERDAIT toute mutation non envoyee des que la
  // suivante arrivait (deux mutateurs + un seul sendLastChange = 1er change
  // jamais sur le fil - vu en pilotage : slots de session fantomes). Chaque
  // mutateur pousse ; getLastChange() draine UN change (les appelants
  // bouclent, ou avalent volontairement - criterion3-push.spec).
  private pendingChanges: Uint8Array[] = [];
  private journal = new UndoJournal();

  constructor() {
    this.doc = seedDoc();
  }

  /**
   * Load a document from Automerge binary bytes.
   */
  load(data: Uint8Array): void {
    try {
      this.doc = Automerge.load<ProjectDef>(data);
    } catch (e) {
      console.error('Failed to load Automerge document:', e);
      this.doc = seedDoc();  // fallback: the shared seed, never a fresh root
    }
    // V1.3: the journal referenced a document that no longer exists
    this.journal.clear();
    this.pendingChanges.length = 0;  // changes d'un doc qui n'existe plus
  }

  /**
   * A4-3 refinement: true while the local document is EXACTLY the
   * untouched seed (single head = the seed's). A pristine placeholder
   * has nothing to merge or push - first contact must ADOPT the server
   * document wholesale, or an OLD-ROOT project gets the seed pushed
   * into it and a root LWW conflict can shadow its real tracks
   * (observed live on duo: clips eclipsed by the seed's empty lists).
   */
  isPristineSeed(): boolean {
    const heads = Automerge.getHeads(this.doc);
    const seedHeads = Automerge.getHeads(seedDoc());
    return heads.length === 1 && heads[0] === seedHeads[0];
  }

  /**
   * Merge a full remote document (Automerge binary) into the local one.
   *
   * Used on EVERY server document (first contact included, A4-3: the
   * shared seed makes the roots common): the local document is NEVER
   * replaced, so edits made while offline survive and get reconciled.
   *
   * A4-2 annex: 'error' (bad bytes) is DISTINCT from 'same' (nothing
   * new) - the caller must resync on 'error', not shrug.
   */
  mergeRemote(data: Uint8Array): 'new' | 'same' | 'error' {
    try {
      const before = Automerge.getHeads(this.doc).join(',');
      const remote = Automerge.load<ProjectDef>(data);
      this.doc = Automerge.merge(this.doc, remote);
      const after = Automerge.getHeads(this.doc).join(',');
      return before !== after ? 'new' : 'same';
    } catch (e) {
      console.error('Failed to merge remote document:', e);
      return 'error';
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
      // A4-2, the MAIN case: Automerge buffers a change whose deps are
      // missing WITHOUT throwing (exactly what a lagged/skipped
      // broadcast produces). Silent buffering = silent divergence -
      // surface it so the caller resyncs. DELTA, not absolute:
      // documents scarred by the pre-guard server era carry historical
      // missing deps forever; only a change that ADDS one is the case.
      const missingBefore = Automerge.getMissingDeps(this.doc, []).length;
      const [newDoc] = Automerge.applyChanges(this.doc, [change]);
      this.doc = newDoc;
      if (Automerge.getMissingDeps(this.doc, []).length > missingBefore) {
        console.warn('Change buffered with missing dependencies');
        return false;
      }
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
        case 'setTrackPan': this.setTrackPan(op.trackId, op.pan); break;
        case 'renameTrack': this.renameTrack(op.trackId, op.name); break;
        case 'renameClip': this.renameClip(op.trackId, op.clipId, op.name); break;
        case 'setMasterGain': this.setMasterGain(op.gain); break;
        case 'setProcessorBypass':
          this.setProcessorBypass(op.trackId, op.processorId, op.bypass); break;
        case 'setProcessorParam':
          this.setProcessorParam(op.trackId, op.processorId, op.key, op.value); break;
        case 'removeProcessorParam':
          this.removeProcessorParam(op.trackId, op.processorId, op.key); break;
        case 'setClipStart': this.setClipStart(op.trackId, op.clipId, op.startSample); break;
        case 'setClipBounds': this.setClipBounds(op.trackId, op.clipId, op.bounds); break;
        case 'setClipFades':
          this.setClipFades(op.trackId, op.clipId, op.fadeInSamples, op.fadeOutSamples); break;
        case 'addClip': this.addClip(op.trackId, op.clip); break;
        case 'deleteClip': this.deleteClip(op.trackId, op.clipId); break;
        case 'addTrack': this.addTrack(op.track); break;
        case 'deleteTrack': this.deleteTrack(op.trackId); break;
        case 'addProcessor': this.addProcessor(op.trackId, op.proc, op.index); break;
        case 'removeProcessor': this.removeProcessor(op.trackId, op.processorId); break;
        case 'toggleNote': this.toggleNote(op.trackId, op.clipId, op.note); break;
        case 'renameScene': this.renameScene(op.sceneId, op.name); break;
        case 'deleteScene': this.deleteScene(op.sceneId); break;
        case 'restoreScene': this.restoreScene(op.scene, op.index, op.clips); break;
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
    this.capturePending();
  }

  /**
   * F2 : set track pan (-1 gauche .. 0 centre .. +1 droite). Meme moule que
   * setTrackGain : capture inverse pour l'undo, clamp, change Automerge. Le
   * moteur lit `pan` du doc et applique une puissance egale en sortie de piste.
   */
  setTrackPan(trackId: string, pan: number): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track) return;  // target gone (maybe remotely): silent no-op
    this.journal.capture({ type: 'setTrackPan', trackId, pan: track.pan ?? 0 });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t) t.pan = Math.max(-1, Math.min(1, pan));
    });
    this.capturePending();
  }

  /**
   * Renomme une piste (clic droit 2026-08-26). Nom vide apres trim = no-op
   * (TrackDef.name est requis) ; borne a 64 chars.
   */
  renameTrack(trackId: string, name: string): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    const next = name.trim().slice(0, 64);
    if (!track || !next || next === track.name) return;
    this.journal.capture({ type: 'renameTrack', trackId, name: track.name });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t) t.name = next;
    });
    this.capturePending();
  }

  /**
   * Renomme un clip (champ additif ClipDef.name). Nom vide = RETIRE le champ
   * (l'affichage retombe sur le nom derive) - c'est aussi l'inverse d'un
   * premier nommage, capture en name:''.
   */
  renameClip(trackId: string, clipId: string, name: string): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const next = name.trim().slice(0, 64);
    if (next === (clip.name ?? '')) return;
    this.journal.capture({ type: 'renameClip', trackId, clipId, name: clip.name ?? '' });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (!c) return;
      if (next) c.name = next;
      else delete c.name;
    });
    this.capturePending();
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
    this.capturePending();
  }

  /** Empile le dernier change local dans la file d'envoi. */
  private capturePending(): void {
    const c = Automerge.getLastLocalChange(this.doc);
    if (c) this.pendingChanges.push(c);
  }

  /**
   * Draine UN change en attente (FIFO). Les envoyeurs bouclent jusqu'a null
   * (sendLastChange) - un appel isole qui avale reste possible (test A3-4).
   */
  getLastChange(): Uint8Array | null {
    return this.pendingChanges.shift() ?? null;
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
    this.capturePending();
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
    this.capturePending();
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
    this.capturePending();
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
    this.capturePending();
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
    this.capturePending();
  }

  /**
   * V1.6: set a clip's explicit fades (samples; 0 = engine's implicit
   * 4 ms anti-click). Both fields written together - a fade gesture
   * never tears across peers.
   */
  setClipFades(trackId: string, clipId: string,
    fadeInSamples: number, fadeOutSamples: number): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    this.journal.capture({
      type: 'setClipFades', trackId, clipId,
      fadeInSamples: clip.fadeInSamples ?? 0,
      fadeOutSamples: clip.fadeOutSamples ?? 0,
    });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (!c) return;
      const half = Math.floor(c.lengthSamples / 2);
      c.fadeInSamples = Math.max(0, Math.min(half, Math.round(fadeInSamples)));
      c.fadeOutSamples = Math.max(0, Math.min(half, Math.round(fadeOutSamples)));
    });
    this.capturePending();
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
    this.capturePending();
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
    this.capturePending();
  }

  /**
   * v8 MIDI : cree un clip MIDI (pas d'asset, notes editables au piano-roll)
   * et rend son id. Un clip a assetHash vide + notes = clip MIDI ; l'instrument
   * en tete de chaine de la piste le joue.
   */
  addMidiClip(trackId: string, startSample: number, lengthSamples: number): string {
    const id = 'clip-' + Math.random().toString(36).slice(2, 10);
    const clip: ClipDef = {
      id, assetHash: '', startSample, lengthSamples, offsetSamples: 0, notes: [],
    };
    this.addClip(trackId, clip);
    return id;
  }

  /** T7 Session : ajoute une scene (une LIGNE du clip-launcher) et rend son
   *  id. F5+ : undo-journalisee (inverse = deleteScene). */
  addScene(name: string): string {
    const id = 'scene-' + Math.random().toString(36).slice(2, 8);
    this.journal.capture({ type: 'deleteScene', sceneId: id });
    this.doc = Automerge.change(this.doc, (d) => {
      if (!d.scenes) d.scenes = [];
      (d.scenes as unknown[]).push({ id, name });
    });
    this.capturePending();
    return id;
  }

  /** F5+ : renomme une scene (meme moule que renameTrack). */
  renameScene(sceneId: string, name: string): void {
    const scene = (this.doc.scenes ?? []).find((s) => s.id === sceneId);
    const next = name.trim().slice(0, 64);
    if (!scene || !next || next === scene.name) return;
    this.journal.capture({ type: 'renameScene', sceneId, name: scene.name });
    this.doc = Automerge.change(this.doc, (d) => {
      const s = (d.scenes ?? []).find((x) => x.id === sceneId);
      if (s) s.name = next;
    });
    this.capturePending();
  }

  /**
   * F5+ : supprime une scene ET ses slots sur toutes les pistes (un slot
   * orphelin serait invisible et injouable). Inverse = restoreScene, qui
   * remet la scene et chaque clip a sa piste.
   */
  deleteScene(sceneId: string): void {
    const scene = (this.doc.scenes ?? []).find((s) => s.id === sceneId);
    if (!scene) return;
    const clips: Array<{ trackId: string; clip: ClipDef }> = [];
    for (const t of this.doc.tracks) {
      for (const c of t.clips) {
        if (c.sceneId === sceneId) clips.push({ trackId: t.id, clip: plain(c) as ClipDef });
      }
    }
    const index = (this.doc.scenes ?? []).findIndex((s) => s.id === sceneId);
    this.journal.capture({
      type: 'restoreScene', scene: plain(scene) as SceneDef, index, clips });
    this.doc = Automerge.change(this.doc, (d) => {
      for (const t of d.tracks) {
        for (let i = t.clips.length - 1; i >= 0; --i) {
          if (t.clips[i].sceneId === sceneId) t.clips.splice(i, 1);
        }
      }
      if (d.scenes) {
        const i = d.scenes.findIndex((s) => s.id === sceneId);
        if (i >= 0) d.scenes.splice(i, 1);
      }
    });
    this.capturePending();
  }

  /** F5+ : inverse de deleteScene - restaure la scene A SA PLACE et ses slots. */
  restoreScene(scene: SceneDef, index: number,
    clips: Array<{ trackId: string; clip: ClipDef }>): void {
    if ((this.doc.scenes ?? []).some((s) => s.id === scene.id)) return;
    this.journal.capture({ type: 'deleteScene', sceneId: scene.id });
    this.doc = Automerge.change(this.doc, (d) => {
      if (!d.scenes) d.scenes = [];
      const at = index >= 0 && index <= d.scenes.length ? index : d.scenes.length;
      (d.scenes as unknown[]).splice(at, 0, { ...scene });
      for (const { trackId, clip } of clips) {
        const t = d.tracks.find((x) => x.id === trackId);
        if (t && !t.clips.some((c) => c.id === clip.id)) t.clips.push({ ...clip });
      }
    });
    this.capturePending();
  }

  /**
   * F5+ : duplique une scene (slots et notes compris, nouveaux ids). UN seul
   * geste d'undo (groupe). Rend l'id de la copie.
   */
  duplicateScene(sceneId: string): string | null {
    const scene = (this.doc.scenes ?? []).find((s) => s.id === sceneId);
    if (!scene) return null;
    this.beginUndoGroup();
    const newId = this.addScene(`${scene.name} (copie)`);
    for (const t of this.doc.tracks) {
      const slot = t.clips.find((c) => c.sceneId === sceneId);
      if (slot) {
        this.addClip(t.id, {
          ...(plain(slot) as ClipDef),
          id: 'clip-' + Math.random().toString(36).slice(2, 10),
          sceneId: newId,
        });
      }
    }
    this.endUndoGroup();
    return newId;
  }

  /** T7 Session : cree un SLOT (clip MIDI de session) sur une piste dans une
   *  scene. Porte sceneId -> le moteur l'ignore en timeline. */
  addSessionClip(trackId: string, sceneId: string): string {
    const id = 'clip-' + Math.random().toString(36).slice(2, 10);
    const clip: ClipDef = {
      id, assetHash: '', startSample: 0, lengthSamples: 96000, offsetSamples: 0,
      notes: [], sceneId,
    };
    this.addClip(trackId, clip);
    return id;
  }

  /**
   * v8 MIDI : bascule une note (ajoute si absente au meme pitch+debut, sinon
   * retire) - le geste du piano-roll. F7 : undo-journalise (le toggle est son
   * propre inverse - re-toggler la meme note annule le geste).
   */
  toggleNote(trackId: string, clipId: string, note: NoteDef): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    this.journal.capture({ type: 'toggleNote', trackId, clipId, note: { ...note } });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (!c) return;
      if (!c.notes) c.notes = [];
      const i = c.notes.findIndex(
        (n) => n.pitch === note.pitch && n.startSample === note.startSample);
      if (i >= 0) c.notes.splice(i, 1);
      else c.notes.push(note);
    });
    this.capturePending();
  }

  /**
   * Add a track and generate a change.
   */
  addTrack(track: TrackDef): void {
    this.journal.capture({ type: 'deleteTrack', trackId: track.id });
    this.doc = Automerge.change(this.doc, (d) => {
      d.tracks.push(track);
    });
    this.capturePending();
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
    this.capturePending();
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
    this.capturePending();
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
    this.capturePending();
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
