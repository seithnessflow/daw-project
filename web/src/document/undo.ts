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

import type {
  ClipDef, TrackDef, ProcessorDef, NoteDef, SceneDef, AutomationLaneDef,
} from './schema';

/** T3 : la photo EXACTE des champs temporels d'un clip - seuls les
 *  champs PRESENTS sur le clip figurent (absent = a retirer au restore).
 *  C'est le vehicule unique de capture/restore dual-domaine. */
export interface ClipTiming {
  startSample?: number;
  lengthSamples?: number;
  offsetSamples?: number;
  startTick?: number;
  lengthTick?: number;
}

export type InverseOp =
  | { type: 'setTrackGain'; trackId: string; gain: number }
  | { type: 'setTrackPan'; trackId: string; pan: number }
  // D1 : ordre d'affichage fractionnaire. clearTrackOrder = inverse d'un
  // PREMIER setTrackOrder (le champ etait ABSENT - l'inverse le retire,
  // meme doctrine que removeProcessorParam pour un param cree).
  | { type: 'setTrackOrder'; trackId: string; order: number }
  | { type: 'clearTrackOrder'; trackId: string }
  | { type: 'renameTrack'; trackId: string; name: string }
  | { type: 'renameClip'; trackId: string; clipId: string; name: string }
  | { type: 'setMasterGain'; gain: number }
  // T3 tempo : registre milli-BPM (l'absent d'origine = 120000 explicite)
  | { type: 'setTempo'; milliBpm: number }
  | { type: 'setProcessorBypass'; trackId: string; processorId: string; bypass: boolean }
  | { type: 'setProcessorParam'; trackId: string; processorId: string; key: string; value: number }
  | { type: 'removeProcessorParam'; trackId: string; processorId: string; key: string }
  | { type: 'setClipStart'; trackId: string; clipId: string; startSample: number }
  | { type: 'setClipBounds'; trackId: string; clipId: string;
      bounds: { startSample: number; lengthSamples: number; offsetSamples: number } }
  // T3 tempo : LA capture dual-aware (regle des jumeaux). timing = la
  // photo EXACTE des cinq champs temporels du clip (presents seulement) ;
  // restaurer = poser les presents ET RETIRER les absents - l'undo d'un
  // « Rendre musical » retire startTick et remet startSample.
  | { type: 'setClipTiming'; trackId: string; clipId: string;
      timing: ClipTiming }
  | { type: 'setClipFades'; trackId: string; clipId: string;
      fadeInSamples: number; fadeOutSamples: number }
  | { type: 'addClip'; trackId: string; clip: ClipDef }
  | { type: 'deleteClip'; trackId: string; clipId: string }
  // D4 : changer la scene d'un slot Session ecrit le seul champ sceneId
  // (identite du clip preservee) - l'inverse porte l'ancien sceneId.
  | { type: 'setClipScene'; trackId: string; clipId: string; sceneId: string }
  | { type: 'addTrack'; track: TrackDef }
  | { type: 'deleteTrack'; trackId: string }
  // V1.5: index restores the chain ORDER (a chain is a pipeline - putting
  // a device back at the end is not putting it back)
  | { type: 'addProcessor'; trackId: string; proc: ProcessorDef; index: number }
  | { type: 'removeProcessor'; trackId: string; processorId: string }
  // D2 : deplacer un device dans la chaine. L'inverse d'un move est le
  // move RETOUR (toIndex = l'index d'origine) - jamais un remove+add
  // journalise separement : un seul geste, une seule entree.
  | { type: 'moveProcessor'; trackId: string; processorId: string; toIndex: number }
  // F7 : le toggle de note est SON PROPRE inverse (re-toggler la meme note
  // annule l'ajout/retrait) - on capture la note identique.
  | { type: 'toggleNote'; trackId: string; clipId: string; note: NoteDef }
  // F5+ gestion scenes : supprimer une scene emporte ses slots sur TOUTES les
  // pistes - l'inverse restaure la scene ET chaque clip a sa piste.
  | { type: 'renameScene'; sceneId: string; name: string }
  | { type: 'deleteScene'; sceneId: string }
  | { type: 'restoreScene'; scene: SceneDef; index: number;
      clips: Array<{ trackId: string; clip: ClipDef }> }
  // A1 automation : trackId null = lanes du MASTER (ProjectDef.automation).
  // deleteLane capture la lane ENTIERE + son index (une lane est une liste
  // ordonnee a l'ecran - la remettre a la fin n'est pas la remettre).
  | { type: 'deleteAutomationLane'; trackId: string | null; laneId: string }
  | { type: 'restoreAutomationLane'; trackId: string | null;
      lane: AutomationLaneDef; index: number }
  | { type: 'setAutomationLaneEnabled'; trackId: string | null;
      laneId: string; enabled: boolean }
  | { type: 'addAutomationPoint'; trackId: string | null; laneId: string;
      t: number; v: number }
  | { type: 'moveAutomationPoint'; trackId: string | null; laneId: string;
      index: number; t: number; v: number }
  | { type: 'deleteAutomationPoint'; trackId: string | null; laneId: string;
      index: number };

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
    // D1 : set et clear partagent la cle - dans un groupe (reequilibrage),
    // seule la PREMIERE capture par piste survit : la valeur pre-geste.
    case 'setTrackOrder':
    case 'clearTrackOrder': return `order:${op.trackId}`;
    case 'renameTrack': return `trackname:${op.trackId}`;
    case 'renameClip': return `clipname:${op.trackId}:${op.clipId}`;
    case 'setMasterGain': return 'master';
    case 'setTempo': return 'tempo';
    case 'setProcessorBypass': return `byp:${op.trackId}:${op.processorId}`;
    case 'setProcessorParam':
    case 'removeProcessorParam': return `param:${op.trackId}:${op.processorId}:${op.key}`;
    case 'setClipStart': return `clipstart:${op.trackId}:${op.clipId}`;
    case 'setClipBounds': return `clipbounds:${op.trackId}:${op.clipId}`;
    // T3 : MEME cle que start/bounds - dans un geste, la premiere photo
    // du timing (quel que soit le domaine) est celle qui compte.
    case 'setClipTiming': return `clipstart:${op.trackId}:${op.clipId}`;
    case 'setClipFades': return `clipfades:${op.trackId}:${op.clipId}`;
    case 'addClip': return `clip:${op.trackId}:${op.clip.id}`;
    case 'deleteClip': return `clip:${op.trackId}:${op.clipId}`;
    case 'setClipScene': return `clipscene:${op.trackId}:${op.clipId}`;
    case 'addTrack': return `track:${op.track.id}`;
    case 'deleteTrack': return `track:${op.trackId}`;
    case 'addProcessor': return `proc:${op.trackId}:${op.proc.id}`;
    case 'removeProcessor': return `proc:${op.trackId}:${op.processorId}`;
    // D2 : cle PROPRE au move (pas `proc:` - un move dans le meme groupe
    // qu'un add/remove du meme device ne doit pas etre dedupe avec eux :
    // ce ne sont pas des inverses interchangeables).
    case 'moveProcessor': return `procmove:${op.trackId}:${op.processorId}`;
    case 'toggleNote':
      // T3 : une note musicale s'identifie par son tick (l'absolu par
      // son sample) - les deux domaines ne se melangent jamais.
      return `note:${op.trackId}:${op.clipId}:${op.note.pitch}:` +
        `${op.note.startTick ?? op.note.startSample}`;
    case 'renameScene': return `scenename:${op.sceneId}`;
    case 'deleteScene': return `scene:${op.sceneId}`;
    case 'restoreScene': return `scene:${op.scene.id}`;
    // A1 automation - CHOIX DE CLES :
    // - lane (delete/restore partagent la cle) : scope + laneId, comme
    //   scene/track - l'identite est l'id, stable.
    // - POINT : un point n'a PAS d'id, et son INDEX n'est pas stable (le
    //   tri par t le deplace quand il traverse un voisin). La cle stable
    //   d'un drag est lane + identite du point de DEPART du geste : on
    //   cle sur les (t,v) PRE-MUTATION portes par l'inverse. Consequence
    //   voulue : dans un groupe, chaque micro-pas d'un drag garde son
    //   inverse (les (t,v) changent a chaque pas) et l'undo DEROULE le
    //   geste pas a pas - deduper sur un index mouvant laisserait un
    //   inverse perime des que le point croise un voisin.
    case 'deleteAutomationLane':
      return `alane:${op.trackId ?? 'master'}:${op.laneId}`;
    case 'restoreAutomationLane':
      return `alane:${op.trackId ?? 'master'}:${op.lane.id}`;
    case 'setAutomationLaneEnabled':
      return `alaneon:${op.trackId ?? 'master'}:${op.laneId}`;
    case 'addAutomationPoint':
    case 'moveAutomationPoint':
      return `apoint:${op.trackId ?? 'master'}:${op.laneId}:${op.t}:${op.v}`;
    case 'deleteAutomationPoint':
      return `apoint-i:${op.trackId ?? 'master'}:${op.laneId}:${op.index}`;
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
