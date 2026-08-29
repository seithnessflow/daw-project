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
import {
  ProjectDef, TrackDef, ClipDef, ProcessorDef, NoteDef, SceneDef,
  AutomationLaneDef, isMusicalClip, ensureV2,
} from './schema';
import { clipStartSamples, sampleToTick } from './geometry';
import { clampMilliBpm } from './tempo';
import { clampTick } from './sanitize';
import { UndoJournal, type InverseOp, type ClipTiming } from './undo';
import { seedBytes } from './seed';
import { newId } from './ids';

/** T3 : la photo des champs temporels PRESENTS d'un clip (le vehicule
 *  de capture/restore dual-domaine - regle des jumeaux, une seule
 *  definition pour tous les mutateurs). */
function timingOf(clip: ClipDef): ClipTiming {
  const t: ClipTiming = {};
  if (typeof clip.startSample === 'number') t.startSample = clip.startSample;
  if (typeof clip.lengthSamples === 'number') t.lengthSamples = clip.lengthSamples;
  if (typeof clip.offsetSamples === 'number') t.offsetSamples = clip.offsetSamples;
  if (typeof clip.startTick === 'number') t.startTick = clip.startTick;
  if (typeof clip.lengthTick === 'number') t.lengthTick = clip.lengthTick;
  return t;
}

const TIMING_FIELDS = ['startSample', 'lengthSamples', 'offsetSamples',
  'startTick', 'lengthTick'] as const;

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

/**
 * A1 automation : les lanes vivent a DEUX endroits (piste ou master,
 * AUTOMATION-DESIGN.md section 1) - un seul jeu de mutateurs avec
 * trackId null = master. Ces deux helpers factorisent l'adressage et
 * marchent aussi bien sur le doc lu que sur le draft d'un change.
 */
function lanesIn(d: ProjectDef, trackId: string | null): AutomationLaneDef[] | undefined {
  return trackId === null
    ? d.automation
    : d.tracks.find((t) => t.id === trackId)?.automation;
}

/** Variante creatrice (draft de change) : cree le tableau additif si
 *  absent ; null si la piste ciblee n'existe plus (no-op silencieux). */
function ensureLanes(d: ProjectDef, trackId: string | null): AutomationLaneDef[] | null {
  if (trackId === null) {
    if (!d.automation) d.automation = [];
    return d.automation;
  }
  const t = d.tracks.find((x) => x.id === trackId);
  if (!t) return null;
  if (!t.automation) t.automation = [];
  return t.automation;
}

/** t en SAMPLES timeline : entier >= 0 (invariant SCHEMA.md 1). */
function clampT(t: number): number {
  return Math.max(0, Math.round(t));
}

/** v NORMALISE 0..1 - le document ne porte jamais d'unite (design A1). */
function clampV(v: number): number {
  return Math.max(0, Math.min(1, v));
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
        case 'setTrackOrder': this.setTrackOrder(op.trackId, op.order); break;
        case 'clearTrackOrder': this.clearTrackOrder(op.trackId); break;
        case 'renameTrack': this.renameTrack(op.trackId, op.name); break;
        case 'renameClip': this.renameClip(op.trackId, op.clipId, op.name); break;
        case 'setMasterGain': this.setMasterGain(op.gain); break;
        case 'setTempo': this.setTempoMilliBpm(op.milliBpm); break;
        case 'setProcessorBypass':
          this.setProcessorBypass(op.trackId, op.processorId, op.bypass); break;
        case 'setProcessorParam':
          this.setProcessorParam(op.trackId, op.processorId, op.key, op.value); break;
        case 'removeProcessorParam':
          this.removeProcessorParam(op.trackId, op.processorId, op.key); break;
        case 'setClipStart': this.setClipStart(op.trackId, op.clipId, op.startSample); break;
        case 'setClipBounds': this.setClipBounds(op.trackId, op.clipId, op.bounds); break;
        case 'setClipTiming': this.setClipTiming(op.trackId, op.clipId, op.timing); break;
        case 'setClipFades':
          this.setClipFades(op.trackId, op.clipId, op.fadeInSamples, op.fadeOutSamples); break;
        case 'addClip': this.addClip(op.trackId, op.clip); break;
        case 'deleteClip': this.deleteClip(op.trackId, op.clipId); break;
        case 'setClipScene':
          this.setClipScene(op.trackId, op.clipId, op.sceneId); break;
        case 'addTrack': this.addTrack(op.track); break;
        case 'deleteTrack': this.deleteTrack(op.trackId); break;
        case 'addProcessor': this.addProcessor(op.trackId, op.proc, op.index); break;
        case 'removeProcessor': this.removeProcessor(op.trackId, op.processorId); break;
        case 'moveProcessor':
          this.moveProcessor(op.trackId, op.processorId, op.toIndex); break;
        case 'toggleNote': this.toggleNote(op.trackId, op.clipId, op.note); break;
        case 'updateNote': this.updateNote(op.trackId, op.clipId, op.noteId, op.patch); break;
        case 'renameScene': this.renameScene(op.sceneId, op.name); break;
        case 'deleteScene': this.deleteScene(op.sceneId); break;
        case 'restoreScene': this.restoreScene(op.scene, op.index, op.clips); break;
        case 'deleteAutomationLane':
          this.deleteAutomationLane(op.trackId, op.laneId); break;
        case 'restoreAutomationLane':
          this.restoreAutomationLane(op.trackId, op.lane, op.index); break;
        case 'setAutomationLaneEnabled':
          this.setAutomationLaneEnabled(op.trackId, op.laneId, op.enabled); break;
        case 'addAutomationPoint':
          this.addAutomationPoint(op.trackId, op.laneId, op.t, op.v); break;
        case 'moveAutomationPoint':
          this.moveAutomationPoint(op.trackId, op.laneId, op.index, op.t, op.v); break;
        case 'deleteAutomationPoint':
          this.deleteAutomationPoint(op.trackId, op.laneId, op.index); break;
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
   * D1 : ecrit l'ordre d'AFFICHAGE fractionnaire d'une piste (voir
   * orderedTracks dans schema.ts - la liste Automerge ne bouge jamais).
   * Inverse : l'ancien order si present ; s'il etait ABSENT, l'inverse
   * doit RETIRER le champ (type dedie clearTrackOrder, meme doctrine que
   * removeProcessorParam pour une creation de param) - sinon l'undo
   * laisserait un order fantome qui fige la piste hors de sa place
   * historique (index de liste).
   */
  setTrackOrder(trackId: string, order: number): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track || !Number.isFinite(order)) return;
    if (track.order === order) return;  // no-op: pas d'entree d'undo
    this.journal.capture(track.order === undefined
      ? { type: 'clearTrackOrder', trackId }
      : { type: 'setTrackOrder', trackId, order: track.order });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t) t.order = order;
    });
    this.capturePending();
  }

  /** D1 : inverse d'un PREMIER setTrackOrder - retire le champ additif
   *  (la piste retombe sur son index de liste, voir orderedTracks). */
  clearTrackOrder(trackId: string): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (!track || track.order === undefined) return;
    this.journal.capture({ type: 'setTrackOrder', trackId, order: track.order });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t && t.order !== undefined) delete t.order;
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

  /**
   * T3 tempo : le registre du projet en milli-BPM entier (LWW par
   * champ, clampe 20000..999000). Premier ecrit musical du document ->
   * bump v2 lazy (ensureV2). Undoable (l'inverse restaure l'ancien
   * registre ; l'absent d'origine equivaut a 120000 explicite).
   */
  setTempoMilliBpm(milliBpm: number): void {
    const prev = typeof this.doc.tempoMilliBpm === 'number'
      ? this.doc.tempoMilliBpm : 120000;
    const next = clampMilliBpm(milliBpm);
    if (next === prev && typeof this.doc.tempoMilliBpm === 'number') return;
    this.journal.capture({ type: 'setTempo', milliBpm: prev });
    this.doc = Automerge.change(this.doc, (d) => {
      ensureV2(d);
      d.tempoMilliBpm = next;
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
    // T3 dual-aware : un clip MUSICAL se deplace en TICKS (pipeline
    // geste px -> sec -> sample -> tick ; tickAtSample ne convertit que
    // la CIBLE du geste, jamais une verite existante).
    if (isMusicalClip(clip)) {
      const timing = timingOf(clip);
      timing.startTick = clampTick(sampleToTick(this.doc, startSample));
      this.setClipTiming(trackId, clipId, timing);
      return;
    }
    this.journal.capture({
      type: 'setClipStart', trackId, clipId,
      startSample: clip.startSample ?? 0 });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (c) c.startSample = Math.max(0, Math.round(startSample));
    });
    this.capturePending();
  }

  /**
   * T3 : LE mutateur de timing dual-domaine. timing = la photo COMPLETE
   * visee (champs presents poses, champs absents RETIRES parmi les
   * cinq) - c'est aussi le vehicule d'undo (setClipTiming inverse).
   * Ecrire un champ tick bump le document en v2 (lazy, ensureV2).
   */
  setClipTiming(trackId: string, clipId: string, timing: ClipTiming): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    this.journal.capture({
      type: 'setClipTiming', trackId, clipId, timing: timingOf(clip) });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (!c) return;
      if (typeof timing.startTick === 'number' ||
          typeof timing.lengthTick === 'number') {
        ensureV2(d);
      }
      const rec = c as unknown as Record<string, number | undefined>;
      for (const k of TIMING_FIELDS) {
        const v = timing[k];
        if (typeof v === 'number') rec[k] = Math.max(0, Math.round(v));
        else if (typeof rec[k] === 'number') delete rec[k];
      }
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
    // T3 dual-aware : trim d'un clip musical -> position en ticks ; la
    // duree suit son domaine (lengthTick si present = MIDI musical,
    // sinon lengthSamples = audio musical, contenu jamais etire).
    if (isMusicalClip(clip)) {
      const timing = timingOf(clip);
      const startTick = clampTick(sampleToTick(this.doc, bounds.startSample));
      if (typeof clip.lengthTick === 'number') {
        const endTick = clampTick(sampleToTick(
          this.doc, bounds.startSample + bounds.lengthSamples));
        timing.lengthTick = Math.max(1, endTick - startTick);
      } else {
        timing.lengthSamples = Math.max(1024, Math.round(bounds.lengthSamples));
      }
      timing.startTick = startTick;
      timing.offsetSamples = Math.max(0, Math.round(bounds.offsetSamples));
      this.setClipTiming(trackId, clipId, timing);
      return;
    }
    this.journal.capture({
      type: 'setClipBounds', trackId, clipId,
      bounds: {
        startSample: clip.startSample ?? 0,
        lengthSamples: clip.lengthSamples ?? 0,
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
      const half = Math.floor((c.lengthSamples ?? 0) / 2);
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
      if (!t) return;
      if (isMusicalClip(clip)) ensureV2(d);  // T3 : bump lazy
      t.clips.push(clip);
    });
    this.capturePending();
  }

  /**
   * SCISSION (AUDIT-6, edition d'echelle) : coupe un clip AUDIO a la
   * position absolue atSample. Non destructif par nature (deux recettes
   * sur le meme asset : le droit demarre a offset+left). Fades : le
   * fade-in reste au gauche, le fade-out passe au droit ; le point de
   * coupe recoit les anti-clics implicites 4 ms du moteur. UN groupe
   * d'undo (trim + fades + addClip) = un seul Ctrl+Z recolle.
   * Refus : clip MIDI (le scheduler couperait des note-offs - dette
   * datee avec le vrai piano-roll), coupe hors clip ou a moins de
   * 1024 samples d'un bord (la longueur minimale d'un clip).
   * @returns l'id du clip droit, ou null si refuse.
   */
  splitClip(trackId: string, clipId: string, atSample: number): string | null {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return null;
    if (!clip.assetHash) return null;  // MIDI (assetHash vide) : refuse
    // T3 : scission d'un clip MUSICAL refusee (dette datee, avec la
    // scission MIDI) - couper au sample entre deux ticks creerait une
    // couture d'un demi-tick a la reconversion. Rendre absolu d'abord.
    if (isMusicalClip(clip)) return null;
    const at = Math.round(atSample);
    const startS = clip.startSample ?? 0;
    const lenS = clip.lengthSamples ?? 0;
    const left = at - startS;
    const right = startS + lenS - at;
    if (left < 1024 || right < 1024) return null;
    const rightId = newId('clip');
    const fadeIn = clip.fadeInSamples ?? 0;
    const fadeOut = clip.fadeOutSamples ?? 0;
    // Automerge refuse undefined : ne poser que les champs presents
    const rightClip: ClipDef = {
      id: rightId,
      assetHash: clip.assetHash,
      startSample: at,
      lengthSamples: right,
      offsetSamples: clip.offsetSamples + left,
    };
    if (clip.name !== undefined) rightClip.name = clip.name;
    if (fadeOut) rightClip.fadeOutSamples = fadeOut;
    this.beginUndoGroup();
    this.setClipBounds(trackId, clipId, {
      startSample: startS,
      lengthSamples: left,
      offsetSamples: clip.offsetSamples,
    });
    if (fadeIn || fadeOut) {
      // le gauche garde son fade-in, perd le fade-out (parti au droit)
      this.setClipFades(trackId, clipId, fadeIn, 0);
    }
    this.addClip(trackId, rightClip);
    this.endUndoGroup();
    return rightId;
  }

  /**
   * D4 (DND-DESIGN.md) : deplace un clip vers une AUTRE piste (drag
   * vertical). COMPROMIS D'IDENTITE ASSUME (grave dans DND-DESIGN) :
   * changer un clip de piste = SUPPRIMER + RECREER (meme id, tous champs
   * copies). Un clip n'a pas d'edits concurrents fins hors notes - et les
   * notes voyagent DANS la copie. Pas de nouveaux InverseOp : les captures
   * de deleteClip (re-add complet sur la piste d'origine) et addClip
   * (re-delete sur la cible) suffisent, groupees en UN geste - l'undo
   * remet le clip, tous champs, sur la piste d'origine.
   *
   * NOTE groupe : si un groupe est DEJA ouvert (drag de clip : le geste a
   * commence par des setClipStart coalesces), beginUndoGroup est un no-op
   * imbrique et le endUndoGroup ci-dessous FERME ce groupe exterieur - le
   * journal ne compte pas les imbrications. Voulu : le move est toujours
   * la DERNIERE mutation du geste (les appelants qui combinent avec
   * setClipScene le placent en dernier, voir slot_reorder.ts).
   */
  moveClipToTrack(fromTrackId: string, clipId: string, toTrackId: string,
    startSample?: number): void {
    const clip = this.doc.tracks.find((t) => t.id === fromTrackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return;                                        // source partie
    if (!this.doc.tracks.some((t) => t.id === toTrackId)) return;  // cible partie
    const curStart = clipStartSamples(clip, this.doc);
    const dest = Math.max(0, Math.round(startSample ?? curStart));
    if (fromTrackId === toTrackId && dest === curStart) return;  // no-op
    // Copie plain AVANT toute mutation (jamais un proxy Automerge reinsere
    // dans le meme doc - meme doctrine que moveProcessor).
    const copy = plain(clip) as ClipDef;
    // T3 dual-aware : un clip musical demenage en ticks (la cible du
    // geste passe par le pipeline sample -> tick), jamais en samples.
    if (isMusicalClip(clip)) copy.startTick = clampTick(sampleToTick(this.doc, dest));
    else copy.startSample = dest;
    this.beginUndoGroup();
    this.deleteClip(fromTrackId, clipId);
    this.addClip(toTrackId, copy);
    this.endUndoGroup();
  }

  /**
   * v8 MIDI : cree un clip MIDI (pas d'asset, notes editables au piano-roll)
   * et rend son id. Un clip a assetHash vide + notes = clip MIDI ; l'instrument
   * en tete de chaine de la piste le joue.
   */
  addMidiClip(trackId: string, startSample: number, lengthSamples: number): string {
    const id = newId('clip');
    // T3 : un clip MIDI FRAIS nait MUSICAL (ticks) - la cible en
    // samples de l'appelant passe par le pipeline sample -> tick.
    // Il suit desormais le tempo ; l'existant absolu ne bouge pas.
    const startTick = clampTick(sampleToTick(this.doc, startSample));
    const endTick = clampTick(sampleToTick(this.doc, startSample + lengthSamples));
    const clip: ClipDef = {
      id, assetHash: '', offsetSamples: 0, notes: [],
      startTick, lengthTick: Math.max(960, endTick - startTick),
    };
    this.addClip(trackId, clip);
    return id;
  }

  /** T7 Session : ajoute une scene (une LIGNE du clip-launcher) et rend son
   *  id. F5+ : undo-journalisee (inverse = deleteScene). */
  addScene(name: string): string {
    const id = newId('scene');
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
    const copyId = this.addScene(`${scene.name} (copie)`);
    for (const t of this.doc.tracks) {
      const slot = t.clips.find((c) => c.sceneId === sceneId);
      if (slot) {
        this.addClip(t.id, {
          ...(plain(slot) as ClipDef),
          id: newId('clip'),
          sceneId: copyId,
        });
      }
    }
    this.endUndoGroup();
    return copyId;
  }

  /** T7 Session : cree un SLOT (clip MIDI de session) sur une piste dans une
   *  scene. Porte sceneId -> le moteur l'ignore en timeline. */
  addSessionClip(trackId: string, sceneId: string): string {
    const id = newId('clip');
    const clip: ClipDef = {
      id, assetHash: '', startSample: 0, lengthSamples: 96000, offsetSamples: 0,
      notes: [], sceneId,
    };
    this.addClip(trackId, clip);
    return id;
  }

  /**
   * D4 : change la SCENE d'un slot Session (drag de slot dans la grille).
   * Ecrit UNIQUEMENT le champ sceneId (LWW par champ - l'identite du clip
   * survit, contrairement au changement de piste). Reserve aux clips qui
   * SONT deja des slots (sceneId present) : transformer un clip timeline
   * en slot est un autre geste, pas celui-ci. Inverse = l'ancien sceneId.
   */
  setClipScene(trackId: string, clipId: string, sceneId: string): void {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip || !clip.sceneId || clip.sceneId === sceneId) return;
    this.journal.capture({
      type: 'setClipScene', trackId, clipId, sceneId: clip.sceneId });
    this.doc = Automerge.change(this.doc, (d) => {
      const c = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId);
      if (c) c.sceneId = sceneId;
    });
    this.capturePending();
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
      // T3 : l'identite d'une note suit son domaine (tick pour une
      // note musicale, sample pour une absolue - jamais un mix)
      const i = c.notes.findIndex((n) => n.pitch === note.pitch &&
        (typeof note.startTick === 'number'
          ? n.startTick === note.startTick
          : n.startSample === note.startSample));
      if (i >= 0) c.notes.splice(i, 1);
      else {
        if (typeof note.startTick === 'number') ensureV2(d);
        // Identite stable a la naissance (additif) - l'adresse des edits
        c.notes.push({ ...note, id: note.id ?? newId('n') });
      }
    });
    this.capturePending();
  }

  /**
   * Edite une note PAR SON ID (velocite, hauteur, position, longueur - les
   * champs du domaine du clip). LWW par champ : deux pairs qui touchent
   * des champs differents de la meme note convergent ; le meme champ, le
   * dernier gagne. Undo-journalise (l'inverse = les valeurs d'avant).
   * Une note historique sans id n'est pas adressable ici (toggleNote).
   */
  updateNote(trackId: string, clipId: string, noteId: string,
             patch: Partial<Pick<NoteDef, 'pitch' | 'velocity' | 'startSample' |
                                          'lengthSamples' | 'startTick' | 'lengthTick'>>): boolean {
    const clip = this.doc.tracks.find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    const before = clip?.notes?.find((n) => n.id === noteId);
    if (!before) return false;
    const inverse: typeof patch = {};
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      if (typeof before[k] === 'number') inverse[k] = before[k] as number;
    }
    this.journal.capture({ type: 'updateNote', trackId, clipId, noteId, patch: inverse });
    this.doc = Automerge.change(this.doc, (d) => {
      const n = d.tracks.find((t) => t.id === trackId)
        ?.clips.find((x) => x.id === clipId)?.notes?.find((x) => x.id === noteId);
      if (!n) return;
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
        const v = patch[k];
        if (typeof v === 'number') (n as unknown as Record<string, number>)[k] = v;
      }
    });
    this.capturePending();
    return true;
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
   * D2 (DND-DESIGN.md) : deplace un device dans la chaine de sa piste.
   * `toIndex` = l'index FINAL vise dans la chaine (position apres le
   * retrait, la ou le device DOIT se retrouver) - symetrique : l'inverse
   * est moveProcessor vers l'index d'origine.
   *
   * COMPROMIS CRDT ASSUME (decision DND-DESIGN.md) : l'ordre de la
   * chaine EST le sens (pipeline audio, le moteur lit l'ordre du
   * tableau) - pas de champ order fractionnaire ici (ce serait un
   * changement de contrat sur 3 etages). v1 = remove + insert d'une
   * COPIE plain() de la MEME def dans UN SEUL Automerge.change (le
   * moule exact de l'undo de removeProcessor). Consequence : l'objet
   * reinsere est un NOUVEL objet Automerge - un pair qui tournait un
   * knob de CE device pendant la fenetre du move perd cet edit (son
   * change vise l'objet supprime). Un device se deplace rarement
   * pendant qu'un pair le regle ; le champ order viendra si la
   * collaboration s'y cogne.
   */
  moveProcessor(trackId: string, processorId: string, toIndex: number): void {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    const from = track ? track.chain.findIndex((p) => p.id === processorId) : -1;
    if (!track || from < 0) return;  // cible partie (peut-etre remote) : no-op
    const to = Math.max(0, Math.min(track.chain.length - 1, Math.round(toIndex)));
    if (to === from) return;  // meme place : pas d'entree d'undo
    // Copie AVANT le change (jamais de proxy Automerge reinsere dans le
    // meme doc) - params, name, uid, state : tout survit au move.
    const copy = plain(track.chain[from]) as ProcessorDef;
    this.journal.capture({ type: 'moveProcessor', trackId, processorId, toIndex: from });
    this.doc = Automerge.change(this.doc, (d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (!t) return;
      const i = t.chain.findIndex((p) => p.id === processorId);
      if (i < 0) return;
      t.chain.splice(i, 1);
      // re-clamp dans le draft : la chaine a UN element de moins
      const at = Math.max(0, Math.min(t.chain.length, to));
      t.chain.splice(at, 0, copy);
    });
    this.capturePending();
  }

  // ---- A1 automation (AUTOMATION-DESIGN.md section 1) ---------------------
  // trackId null = lanes du MASTER (ProjectDef.automation). Le moteur
  // ignore tout ceci jusqu'a la tranche A2 - couche document seulement.

  /**
   * Cree une lane d'automation (vide, enabled) et rend son id ('' si la
   * piste ciblee n'existe plus - le no-op silencieux du moule). Inverse =
   * deleteAutomationLane : l'id est tire AVANT le change, comme addScene.
   */
  addAutomationLane(trackId: string | null,
    target: { processorId?: string; param: string }): string {
    if (trackId !== null && !this.doc.tracks.some((t) => t.id === trackId)) return '';
    const id = newId('lane');
    this.journal.capture({ type: 'deleteAutomationLane', trackId, laneId: id });
    this.doc = Automerge.change(this.doc, (d) => {
      const lanes = ensureLanes(d, trackId);
      if (!lanes) return;
      // Automerge rejette undefined : processorId absent s'OMET, jamais nul
      const tgt: AutomationLaneDef['target'] = { param: target.param };
      if (target.processorId !== undefined) tgt.processorId = target.processorId;
      (lanes as unknown[]).push({ id, target: tgt, points: [], enabled: true });
    });
    this.capturePending();
    return id;
  }

  /**
   * Supprime une lane. Inverse = restoreAutomationLane avec la lane
   * ENTIERE (points compris) et son index - meme doctrine que
   * deleteTrack/removeProcessor : l'inverse restaure tout, a sa place.
   */
  deleteAutomationLane(trackId: string | null, laneId: string): void {
    const lanes = lanesIn(this.doc, trackId);
    const index = lanes ? lanes.findIndex((l) => l.id === laneId) : -1;
    if (!lanes || index < 0) return;
    this.journal.capture({
      type: 'restoreAutomationLane', trackId,
      lane: plain(lanes[index]) as AutomationLaneDef, index,
    });
    this.doc = Automerge.change(this.doc, (d) => {
      const ls = lanesIn(d, trackId);
      if (!ls) return;
      const i = ls.findIndex((l) => l.id === laneId);
      if (i >= 0) ls.splice(i, 1);
    });
    this.capturePending();
  }

  /** Inverse de deleteAutomationLane - restaure la lane A SA PLACE. */
  restoreAutomationLane(trackId: string | null,
    lane: AutomationLaneDef, index: number): void {
    if (trackId !== null && !this.doc.tracks.some((t) => t.id === trackId)) return;
    if (lanesIn(this.doc, trackId)?.some((l) => l.id === lane.id)) return;
    this.journal.capture({ type: 'deleteAutomationLane', trackId, laneId: lane.id });
    this.doc = Automerge.change(this.doc, (d) => {
      const ls = ensureLanes(d, trackId);
      if (!ls) return;
      const at = index >= 0 && index <= ls.length ? index : ls.length;
      (ls as unknown[]).splice(at, 0, {
        ...lane,
        target: { ...lane.target },
        points: lane.points.map((p) => ({ ...p })),
      });
    });
    this.capturePending();
  }

  /** Bypass de lane (enabled=false : l'etat manuel reprend). Meme moule
   *  que setProcessorBypass. */
  setAutomationLaneEnabled(trackId: string | null,
    laneId: string, enabled: boolean): void {
    const lane = lanesIn(this.doc, trackId)?.find((l) => l.id === laneId);
    if (!lane) return;
    this.journal.capture({
      type: 'setAutomationLaneEnabled', trackId, laneId, enabled: lane.enabled });
    this.doc = Automerge.change(this.doc, (d) => {
      const l = lanesIn(d, trackId)?.find((x) => x.id === laneId);
      if (l) l.enabled = enabled;
    });
    this.capturePending();
  }

  /**
   * Ajoute un point (t rond+clamp >= 0, v clamp 0..1). L'insertion est a
   * l'INDEX TRIE (apres les points de meme t) - le tri par t est un
   * invariant d'ECRITURE, jamais repare a la lecture (automationValueAt
   * et le futur moteur A2 le presument). Inverse = deleteAutomationPoint
   * a l'index d'insertion.
   */
  addAutomationPoint(trackId: string | null, laneId: string,
    t: number, v: number): void {
    const lane = lanesIn(this.doc, trackId)?.find((l) => l.id === laneId);
    if (!lane) return;
    const pt = clampT(t);
    const pv = clampV(v);
    const at = lane.points.filter((p) => p.t <= pt).length;
    this.journal.capture({ type: 'deleteAutomationPoint', trackId, laneId, index: at });
    this.doc = Automerge.change(this.doc, (d) => {
      const l = lanesIn(d, trackId)?.find((x) => x.id === laneId);
      if (!l) return;
      (l.points as unknown[]).splice(at, 0, { t: pt, v: pv });
    });
    this.capturePending();
  }

  /**
   * Deplace un point (drag). Tant que t ne traverse pas un voisin, on
   * REECRIT ce point en place - il garde son identite Automerge et deux
   * pairs qui draguent des points differents mergent en LWW par champ
   * (decision design). S'il traverse, splice out + splice in a l'index
   * trie ; l'inverse vise alors le NOUVEL index (la ou le point EST
   * maintenant), avec les anciennes valeurs.
   */
  moveAutomationPoint(trackId: string | null, laneId: string,
    index: number, t: number, v: number): void {
    const lane = lanesIn(this.doc, trackId)?.find((l) => l.id === laneId);
    if (!lane || index < 0 || index >= lane.points.length) return;
    const old = lane.points[index];
    const pt = clampT(t);
    const pv = clampV(v);
    // Index final = position triee parmi les AUTRES points (comme si le
    // point etait retire puis reinsere apres ses egaux en t).
    const newIndex = lane.points
      .filter((p, i) => i !== index && p.t <= pt).length;
    this.journal.capture({
      type: 'moveAutomationPoint', trackId, laneId,
      index: newIndex, t: old.t, v: old.v,
    });
    this.doc = Automerge.change(this.doc, (d) => {
      const l = lanesIn(d, trackId)?.find((x) => x.id === laneId);
      if (!l || index >= l.points.length) return;
      if (newIndex === index) {
        l.points[index].t = pt;
        l.points[index].v = pv;
      } else {
        l.points.splice(index, 1);
        (l.points as unknown[]).splice(newIndex, 0, { t: pt, v: pv });
      }
    });
    this.capturePending();
  }

  /** Supprime un point. Inverse = addAutomationPoint (t,v) - la
   *  reinsertion triee retrouve sa place, un point n'a pas d'id. */
  deleteAutomationPoint(trackId: string | null, laneId: string, index: number): void {
    const lane = lanesIn(this.doc, trackId)?.find((l) => l.id === laneId);
    if (!lane || index < 0 || index >= lane.points.length) return;
    const p = lane.points[index];
    this.journal.capture({ type: 'addAutomationPoint', trackId, laneId, t: p.t, v: p.v });
    this.doc = Automerge.change(this.doc, (d) => {
      const l = lanesIn(d, trackId)?.find((x) => x.id === laneId);
      if (l && index < l.points.length) l.points.splice(index, 1);
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
