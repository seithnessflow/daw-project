// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Piano-roll (v8 MIDI ; gestes + selection 2026-08-28). Une grille pitch
 * (lignes) x pas de temps (colonnes) pour UN clip MIDI. Les notes vivent
 * dans le document et se synchronisent comme tout le reste ; l'instrument
 * en tete de chaine de la piste les joue.
 *
 * Modele de SELECTION (comme tout DAW ; chaque poignee garde sa branche
 * « clic sans mouvement ») :
 *  - clic sur une case vide         : pose une note d'un pas, selectionnee
 *  - clic sur une note              : la selectionne (Shift/Ctrl : ajoute
 *                                     ou retire de la selection)
 *  - glisser depuis une case vide   : LASSO - selectionne les notes
 *                                     touchees (Shift : ajoute)
 *  - glisser une note               : DEPLACE toute la selection (temps
 *                                     et hauteur, au pas)
 *  - glisser son bord droit         : LONGUEUR de toute la selection
 *  - Alt + glisser verticalement, ou molette sur une note : VELOCITE de
 *    toute la selection (1 px = 1, molette = 5 par cran), visible a
 *    l'intensite de la case
 *  - Suppr / Retour arriere         : supprime la selection
 *  - Echap                          : deselectionne
 * Les edits passent par updateNote(id) ; un geste = UN groupe d'undo. Un
 * deplacement qui poserait une note sur l'adresse (pitch+debut) d'une note
 * NON selectionnee, ou hors de la grille, est REFUSE et montre (flash),
 * jamais silencieux. Pendant un geste, le rack n'est pas reconstruit
 * (pianoRollGestureActive - un echo reseau tuait la grille sous la
 * souris) ; la grille se repeint sur place et chaque edit part au reseau.
 */

import type { Project } from '../document/project';
import type { ClipDef, NoteDef } from '../document/schema';
import { isMusicalClip } from '../document/schema';

const STEPS = 16;                 // subdivisions temporelles du clip
const LOW = 48;                   // do3
const HIGH = 72;                  // do5 (inclus)
const NAMES =['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = (p: number) => NAMES[p % 12].includes('#');
const noteName = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const EDGE_PX = 6;                // largeur de la poignee de longueur
const DRAG_PX = 3;                // seuil avant qu'un clic devienne un glisser
const WHEEL_VEL = 5;              // velocite par cran de molette
const HINT = 'clic : poser / selectionner · lasso : selection · glisser : deplacer · bord droit : longueur · Alt+glisser ou molette : velocite · Suppr : effacer';

type Mode = 'move' | 'len' | 'vel' | 'lasso';

interface Placed {
  note: NoteDef;
  id: string;
  startStep: number;   // pas de debut (arrondi vers le bas)
  lenSteps: number;    // >= 1
}

/** La selection survit aux re-rendus (un re-rendu suit chaque geste). */
const selections = new Map<string, Set<string>>();   // clipId -> ids
/** Un geste en cours ? Le rack ne se reconstruit pas pendant. */
let gestureActive = false;
export function pianoRollGestureActive(): boolean { return gestureActive; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Rend le piano-roll d'un clip dans `container`. `onChange` est appele en
 * fin de geste (pousser au reseau + re-rendre) ; `onLive`, pendant un
 * glisser, pour chaque edit intermediaire (pousser au reseau seulement -
 * la grille se repeint sur place, sans perdre la capture du pointeur).
 */
export function renderPianoRoll(
  container: HTMLElement,
  project: Project,
  trackId: string,
  clip: ClipDef,
  onChange: () => void,
  onLive: () => void = onChange,
): void {
  container.replaceChildren();
  container.className = 'piano-roll';
  // T3 : un clip MUSICAL edite en TICKS (clip d'1 mesure : 3840/16 =
  // 240 ticks = la double-croche), un clip absolu en samples - le
  // domaine du clip parent gouverne ses notes (jamais un mix).
  const musical = isMusicalClip(clip) && typeof clip.lengthTick === 'number';
  const stepLen = musical
    ? Math.max(1, Math.floor(clip.lengthTick! / STEPS))
    : Math.max(1, Math.floor((clip.lengthSamples ?? 0) / STEPS));
  const startOf = (n: NoteDef) => (musical ? n.startTick : n.startSample) ?? 0;
  const lengthOf = (n: NoteDef) => (musical ? n.lengthTick : n.lengthSamples) ?? stepLen;
  const startKey = musical ? 'startTick' : 'startSample';
  const lengthKey = musical ? 'lengthTick' : 'lengthSamples';

  let selected = selections.get(clip.id);
  if (!selected) { selected = new Set(); selections.set(clip.id, selected); }
  const sel = selected;

  const freshNotes = (): NoteDef[] => {
    const c = project.getDocument().tracks.find((t) => t.id === trackId)
      ?.clips.find((x) => x.id === clip.id);
    return c?.notes ?? [];
  };
  const place = (notes: NoteDef[]): Placed[] => notes
    .filter((n) => n.pitch >= LOW && n.pitch <= HIGH)
    .map((n) => ({
      note: n,
      id: n.id ?? '',
      startStep: Math.floor(startOf(n) / stepLen),
      lenSteps: Math.max(1, Math.round(lengthOf(n) / stepLen)),
    }));
  // Les ids d'une selection qui n'existent plus (autre pair, undo) tombent
  for (const id of [...sel]) if (!freshNotes().some((n) => n.id === id)) sel.delete(id);

  const grid = document.createElement('div');
  grid.className = 'pr-grid';
  grid.tabIndex = 0;   // Suppr / Echap se recoivent ici
  grid.style.setProperty('--steps', String(STEPS));
  const status = document.createElement('div');
  status.className = 'pr-status';
  status.dataset.role = 'pr-status';
  status.textContent = HINT;
  const lasso = document.createElement('div');
  lasso.className = 'pr-lasso';
  lasso.hidden = true;

  const cells = new Map<string, HTMLButtonElement>();  // "pitch:step" -> case
  const cellAt = (p: number, s: number) => cells.get(`${p}:${s}`);

  // Haut = aigu : on parcourt les pitches du plus haut au plus bas.
  for (let p = HIGH; p >= LOW; p--) {
    const label = document.createElement('div');
    label.className = 'pr-key' + (isBlack(p) ? ' pr-black' : '');
    label.textContent = p % 12 === 0 ? noteName(p) : '';
    grid.appendChild(label);
    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement('button');
      cell.className = 'pr-cell'
        + (isBlack(p) ? ' pr-row-black' : '')
        + (s % 4 === 0 ? ' pr-beat' : '');
      cell.tabIndex = -1;   // le clavier va a la grille, pas a 400 boutons
      // Outillage de pilotage (compo 2026-08-27) : adresser une cellule
      // par donnees, pas par geometrie - le meme contrat que les specs.
      cell.dataset.pitch = String(p);
      cell.dataset.step = String(s);
      cell.setAttribute('aria-label', `${noteName(p)} pas ${s + 1}`);
      cells.set(`${p}:${s}`, cell);
      grid.appendChild(cell);
    }
  }
  grid.appendChild(lasso);

  /** Repeint la grille depuis les notes (sans reconstruire les cases). */
  const paint = (notes: NoteDef[]): void => {
    for (const cell of cells.values()) {
      cell.classList.remove('pr-on', 'pr-tail', 'pr-head', 'pr-sel');
      delete cell.dataset.noteId;
      cell.style.removeProperty('--vel');
      cell.removeAttribute('title');
    }
    for (const pl of place(notes)) {
      const vel = clamp(pl.note.velocity, 1, 127);
      const isSel = sel.has(pl.id);
      for (let k = 0; k < pl.lenSteps; k++) {
        const cell = cellAt(pl.note.pitch, pl.startStep + k);
        if (!cell) break;
        cell.classList.add('pr-on', k === 0 ? 'pr-head' : 'pr-tail');
        if (isSel) cell.classList.add('pr-sel');
        cell.dataset.noteId = pl.id;
        cell.style.setProperty('--vel', String(vel / 127));
        cell.title = `${noteName(pl.note.pitch)} · vel ${vel} · ${pl.lenSteps} pas`;
      }
    }
    grid.dataset.selected = String(sel.size);
  };
  paint(clip.notes ?? []);

  const placedById = (id: string): Placed | undefined =>
    place(freshNotes()).find((pl) => pl.id === id);
  const selectedPlaced = (): Placed[] => place(freshNotes()).filter((pl) => sel.has(pl.id));
  const flashRefusal = (): void => {
    grid.classList.remove('pr-refused');
    void grid.offsetWidth;  // relance l'animation
    grid.classList.add('pr-refused');
  };
  const say = (pl: Placed | undefined): void => {
    if (!pl) return;
    const more = sel.size > 1 && sel.has(pl.id) ? ` · ${sel.size} notes selectionnees` : '';
    status.textContent = `${noteName(pl.note.pitch)} · pas ${pl.startStep + 1} · ${pl.lenSteps} pas · vel ${pl.note.velocity}${more}`;
  };

  // ---- Poser / supprimer --------------------------------------------
  const addAt = (p: number, s: number): void => {
    const start = s * stepLen;
    const note: NoteDef = musical
      ? { pitch: p, velocity: 100, startTick: start, lengthTick: stepLen }
      : { pitch: p, velocity: 100, startSample: start, lengthSamples: stepLen };
    project.toggleNote(trackId, clip.id, note);
    const born = freshNotes().find((n) => n.pitch === p && startOf(n) === start);
    sel.clear();
    if (born?.id) sel.add(born.id);
    onChange();
  };
  const deleteSelection = (): void => {
    const victims = freshNotes().filter((n) => n.id && sel.has(n.id));
    if (!victims.length) return;
    project.beginUndoGroup();
    for (const n of victims) project.toggleNote(trackId, clip.id, { ...n });
    project.endUndoGroup();
    sel.clear();
    onChange();
  };

  // ---- Glisser : deplacer / longueur / velocite / lasso ----------------
  interface Drag {
    pointerId: number;
    cell: HTMLButtonElement;
    mode: Mode;
    x0: number; y0: number;
    cellW: number; rowH: number;
    /** etat d'avant le geste, par note selectionnee */
    before: Map<string, { pitch: number; startStep: number; lenSteps: number; vel: number }>;
    /** derniere delta appliquee (pour ne pas re-ecrire l'identique) */
    last: string;
    additive: boolean;   // Shift : le lasso ajoute a la selection
    moved: boolean;
    grouped: boolean;
    cellDown: { pitch: number; step: number };
  }
  let drag: Drag | null = null;

  const beginGesture = (d: Drag): void => {
    d.moved = true;
    gestureActive = true;
    grid.classList.add('pr-dragging');
    grid.dataset.mode = d.mode;
    if (d.mode !== 'lasso') { project.beginUndoGroup(); d.grouped = true; }
  };

  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target as HTMLElement;
    if (!(cell instanceof HTMLButtonElement) || !cell.classList.contains('pr-cell')) return;
    if (e.button !== 0) return;
    grid.focus({ preventScroll: true });
    const r = cell.getBoundingClientRect();
    const rowH = r.height + 1;   // + le gap de la grille
    const cellW = r.width + 1;
    const pitch = Number(cell.dataset.pitch);
    const step = Number(cell.dataset.step);
    const id = cell.dataset.noteId;
    let mode: Mode = 'lasso';
    if (id) {
      const pl = placedById(id);
      if (!pl) return;
      // Glisser une note non selectionnee : elle devient LA selection
      // (Shift/Ctrl : s'ajoute) - comme partout ailleurs.
      if (!sel.has(id)) {
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) sel.clear();
        sel.add(id);
        paint(freshNotes());
      }
      const onEdge = step === pl.startStep + pl.lenSteps - 1 && e.clientX >= r.right - EDGE_PX;
      mode = e.altKey ? 'vel' : onEdge ? 'len' : 'move';
    }
    const before = new Map<string, { pitch: number; startStep: number; lenSteps: number; vel: number }>();
    for (const pl of selectedPlaced()) {
      before.set(pl.id, { pitch: pl.note.pitch, startStep: pl.startStep, lenSteps: pl.lenSteps, vel: pl.note.velocity });
    }
    drag = {
      pointerId: e.pointerId, cell, mode,
      x0: e.clientX, y0: e.clientY, cellW, rowH, before, last: '',
      additive: e.shiftKey, moved: false, grouped: false,
      cellDown: { pitch, step },
    };
    cell.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  const lassoRect = (d: Drag, e: PointerEvent) => {
    const g = grid.getBoundingClientRect();
    const x1 = Math.min(d.x0, e.clientX) - g.left, x2 = Math.max(d.x0, e.clientX) - g.left;
    const y1 = Math.min(d.y0, e.clientY) - g.top, y2 = Math.max(d.y0, e.clientY) - g.top;
    return { x1, y1, x2, y2, g };
  };

  grid.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
      beginGesture(d);
    }
    if (d.mode === 'lasso') {
      const { x1, y1, x2, y2, g } = lassoRect(d, e);
      lasso.hidden = false;
      lasso.style.left = `${x1}px`; lasso.style.top = `${y1}px`;
      lasso.style.width = `${x2 - x1}px`; lasso.style.height = `${y2 - y1}px`;
      // Les notes dont une case touche le rectangle
      const hit = new Set<string>();
      for (const cell of cells.values()) {
        const id = cell.dataset.noteId;
        if (!id) continue;
        const r = cell.getBoundingClientRect();
        const cx1 = r.left - g.left, cx2 = r.right - g.left, cy1 = r.top - g.top, cy2 = r.bottom - g.top;
        if (cx2 >= x1 && cx1 <= x2 && cy2 >= y1 && cy1 <= y2) hit.add(id);
      }
      if (!d.additive) sel.clear();
      for (const id of hit) sel.add(id);
      paint(freshNotes());
      status.textContent = `${sel.size} note${sel.size > 1 ? 's' : ''} selectionnee${sel.size > 1 ? 's' : ''}`;
      return;
    }
    let changed = false;
    if (d.mode === 'vel') {
      const dv = Math.round(-dy);
      const key = `v${dv}`;
      if (key === d.last) return;
      d.last = key;
      for (const [id, b] of d.before) {
        const vel = clamp(b.vel + dv, 1, 127);
        const cur = freshNotes().find((n) => n.id === id);
        if (cur && cur.velocity !== vel) changed = project.updateNote(trackId, clip.id, id, { velocity: vel }) || changed;
      }
    } else if (d.mode === 'len') {
      const ds = Math.round(dx / d.cellW);
      const key = `l${ds}`;
      if (key === d.last) return;
      d.last = key;
      for (const [id, b] of d.before) {
        const len = clamp(b.lenSteps + ds, 1, STEPS - b.startStep);
        const cur = placedById(id);
        if (cur && cur.lenSteps !== len) changed = project.updateNote(trackId, clip.id, id, { [lengthKey]: len * stepLen }) || changed;
      }
    } else {
      // Deplacer TOUTE la selection d'un meme delta, borne pour que
      // chaque note reste dans la grille
      let ds = Math.round(dx / d.cellW);
      let dp = -Math.round(dy / d.rowH);
      for (const b of d.before.values()) {
        ds = clamp(ds, -b.startStep, STEPS - b.lenSteps - b.startStep);
        dp = clamp(dp, LOW - b.pitch, HIGH - b.pitch);
      }
      const key = `m${ds},${dp}`;
      if (key === d.last) return;
      d.last = key;
      // Refus : une adresse cible tenue par une note NON selectionnee
      const others = freshNotes().filter((n) => !(n.id && sel.has(n.id)));
      const collides = [...d.before.values()].some((b) => others.some((o) =>
        o.pitch === b.pitch + dp && startOf(o) === (b.startStep + ds) * stepLen));
      if (collides) { flashRefusal(); return; }
      for (const [id, b] of d.before) {
        const cur = placedById(id);
        const pitch = b.pitch + dp, start = (b.startStep + ds) * stepLen;
        if (cur && (cur.note.pitch !== pitch || startOf(cur.note) !== start)) {
          // Les DEUX champs a chaque fois : la premiere capture du groupe
          // garde ainsi pitch ET debut d'avant le geste.
          changed = project.updateNote(trackId, clip.id, id, { pitch, [startKey]: start }) || changed;
        }
      }
    }
    if (changed) {
      onLive();
      paint(freshNotes());
      say(placedById(d.cell.dataset.noteId ?? '') ?? selectedPlaced()[0]);
    }
  });

  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    try { d.cell.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    grid.classList.remove('pr-dragging');
    delete grid.dataset.mode;
    lasso.hidden = true;
    gestureActive = false;
    if (d.grouped) project.endUndoGroup();
    if (d.moved) {
      // Un glisser n'est pas un clic : on avale le click qui suit.
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      grid.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => grid.removeEventListener('click', swallow, { capture: true }), 0);
      onChange();
    }
  };
  grid.addEventListener('pointerup', endDrag);
  grid.addEventListener('pointercancel', endDrag);

  // Clic sans mouvement : poser (case vide) ou selectionner (note)
  grid.addEventListener('click', (e) => {
    const cell = e.target as HTMLElement;
    if (!(cell instanceof HTMLButtonElement) || !cell.classList.contains('pr-cell')) return;
    const id = cell.dataset.noteId;
    if (!id) {
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) { addAt(Number(cell.dataset.pitch), Number(cell.dataset.step)); }
      else { sel.clear(); paint(freshNotes()); }
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (sel.has(id)) sel.delete(id); else sel.add(id);
    } else {
      sel.clear(); sel.add(id);
    }
    paint(freshNotes());
    say(placedById(id));
  });

  grid.addEventListener('keydown', (e) => {
    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (sel.size) { e.preventDefault(); e.stopPropagation(); deleteSelection(); }
    } else if (e.key === 'Escape') {
      if (sel.size) { e.preventDefault(); e.stopPropagation(); sel.clear(); paint(freshNotes()); }
    } else if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); e.stopPropagation();
      for (const n of freshNotes()) if (n.id) sel.add(n.id);
      paint(freshNotes());
    }
  });

  // Molette sur une note : velocite de la selection par crans (la note
  // survolee si elle n'est pas selectionnee) ; un groupe d'undo par cran.
  grid.addEventListener('wheel', (e) => {
    const cell = e.target as HTMLElement;
    if (!(cell instanceof HTMLButtonElement) || !cell.dataset.noteId) return;
    const id = cell.dataset.noteId;
    const targets = sel.has(id) ? freshNotes().filter((n) => n.id && sel.has(n.id))
                                : freshNotes().filter((n) => n.id === id);
    if (!targets.length) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? WHEEL_VEL : -WHEEL_VEL;
    project.beginUndoGroup();
    let changed = false;
    for (const n of targets) {
      const vel = clamp(n.velocity + delta, 1, 127);
      if (vel !== n.velocity) changed = project.updateNote(trackId, clip.id, n.id!, { velocity: vel }) || changed;
    }
    project.endUndoGroup();
    if (!changed) return;
    onLive();
    paint(freshNotes());
    say(placedById(id));
  }, { passive: false });

  grid.addEventListener('pointerover', (e) => {
    if (drag) return;
    const cell = e.target as HTMLElement;
    if (cell instanceof HTMLButtonElement && cell.dataset.noteId) say(placedById(cell.dataset.noteId));
    else if (cell instanceof HTMLButtonElement) status.textContent = HINT;
  });

  container.appendChild(grid);
  container.appendChild(status);
}
