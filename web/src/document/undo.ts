// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.3 - Undo journal: typed INVERSE descriptors, never closures.
 *
 * Every local mutation captures, BEFORE applying, the operation that
 * reverts it. Undo replays inverses as NEW Automerge changes (heads are
 * never rewound - collab-safe by construction: an undo only rewrites
 * the fields it touched, remote work survives).
 *
 * Groups: one user GESTURE = one undo entry. While a group is open,
 * only the FIRST capture per target is kept (a drag emits dozens of
 * setClipStart - the gesture's origin is the value to restore).
 *
 * Replay routing: while undo() replays, the mutators' captures are the
 * original ops - they are routed to the REDO stack (and vice versa).
 * Outside replay, any local op clears redo.
 */

import type { ClipDef, TrackDef, ProcessorDef, NoteDef } from './schema';

export type InverseOp =
  | { type: 'setTrackGain'; trackId: string; gain: number }
  | { type: 'setTrackPan'; trackId: string; pan: number }
  | { type: 'setMasterGain'; gain: number }
  | { type: 'setProcessorBypass'; trackId: string; processorId: string; bypass: boolean }
  | { type: 'setProcessorParam'; trackId: string; processorId: string; key: string; value: number }
  | { type: 'removeProcessorParam'; trackId: string; processorId: string; key: string }
  | { type: 'setClipStart'; trackId: string; clipId: string; startSample: number }
  | { type: 'setClipBounds'; trackId: string; clipId: string;
      bounds: { startSample: number; lengthSamples: number; offsetSamples: number } }
  | { type: 'setClipFades'; trackId: string; clipId: string;
      fadeInSamples: number; fadeOutSamples: number }
  | { type: 'addClip'; trackId: string; clip: ClipDef }
  | { type: 'deleteClip'; trackId: string; clipId: string }
  | { type: 'addTrack'; track: TrackDef }
  | { type: 'deleteTrack'; trackId: string }
  // V1.5: index restores the chain ORDER (a chain is a pipeline - putting
  // a device back at the end is not putting it back)
  | { type: 'addProcessor'; trackId: string; proc: ProcessorDef; index: number }
  | { type: 'removeProcessor'; trackId: string; processorId: string }
  // F7 : le toggle de note est SON PROPRE inverse (re-toggler la meme note
  // annule l'ajout/retrait) - on capture la note identique.
  | { type: 'toggleNote'; trackId: string; clipId: string; note: NoteDef };

interface UndoGroup {
  ops: InverseOp[];
  /** First-capture-wins keys while the group is open. */
  seen: Set<string>;
}

/** Identity of the TARGET a capture restores (dedup key inside a group). */
function targetKey(op: InverseOp): string {
  switch (op.type) {
    case 'setTrackGain': return `gain:${op.trackId}`;
    case 'setTrackPan': return `pan:${op.trackId}`;
    case 'setMasterGain': return 'master';
    case 'setProcessorBypass': return `byp:${op.trackId}:${op.processorId}`;
    case 'setProcessorParam':
    case 'removeProcessorParam': return `param:${op.trackId}:${op.processorId}:${op.key}`;
    case 'setClipStart': return `clipstart:${op.trackId}:${op.clipId}`;
    case 'setClipBounds': return `clipbounds:${op.trackId}:${op.clipId}`;
    case 'setClipFades': return `clipfades:${op.trackId}:${op.clipId}`;
    case 'addClip': return `clip:${op.trackId}:${op.clip.id}`;
    case 'deleteClip': return `clip:${op.trackId}:${op.clipId}`;
    case 'addTrack': return `track:${op.track.id}`;
    case 'deleteTrack': return `track:${op.trackId}`;
    case 'addProcessor': return `proc:${op.trackId}:${op.proc.id}`;
    case 'removeProcessor': return `proc:${op.trackId}:${op.processorId}`;
    case 'toggleNote':
      return `note:${op.trackId}:${op.clipId}:${op.note.pitch}:${op.note.startSample}`;
  }
}

const MAX_ENTRIES = 100;

export class UndoJournal {
  private undoStack: UndoGroup[] = [];
  private redoStack: UndoGroup[] = [];
  private grouping: UndoGroup | null = null;
  private route: 'normal' | 'to-redo' | 'to-undo' = 'normal';

  /** Record the inverse of a mutation about to be applied. */
  capture(op: InverseOp): void {
    if (this.route === 'normal') {
      this.redoStack.length = 0;  // any fresh local op invalidates redo
    }
    const stack = this.route === 'to-redo' ? this.redoStack : this.undoStack;

    if (this.grouping) {
      const key = targetKey(op);
      if (!this.grouping.seen.has(key)) {
        this.grouping.seen.add(key);
        this.grouping.ops.push(op);
      }
      return;
    }
    stack.push({ ops: [op], seen: new Set([targetKey(op)]) });
    if (stack.length > MAX_ENTRIES) stack.shift();
  }

  beginGroup(): void {
    if (this.grouping) return;  // nested begin: keep the outer gesture
    this.grouping = { ops: [], seen: new Set() };
  }

  endGroup(): void {
    const g = this.grouping;
    this.grouping = null;
    if (!g || g.ops.length === 0) return;
    const stack = this.route === 'to-redo' ? this.redoStack : this.undoStack;
    stack.push(g);
    if (stack.length > MAX_ENTRIES) stack.shift();
  }

  /** Pop the entry to revert; its replay must run under routeReplay(). */
  popUndo(): InverseOp[] | null {
    const g = this.undoStack.pop();
    return g ? [...g.ops].reverse() : null;
  }

  popRedo(): InverseOp[] | null {
    const g = this.redoStack.pop();
    return g ? [...g.ops].reverse() : null;
  }

  /** Route the captures made while fn runs (undo -> redo, redo -> undo). */
  routeReplay(direction: 'to-redo' | 'to-undo', fn: () => void): void {
    this.route = direction;
    this.beginGroup();
    try {
      fn();
    } finally {
      this.endGroup();
      this.route = 'normal';
    }
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.grouping = null;
    this.route = 'normal';
  }

  get undoDepth(): number { return this.undoStack.length; }
  get redoDepth(): number { return this.redoStack.length; }
}
