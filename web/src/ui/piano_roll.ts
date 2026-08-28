// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Piano-roll (v8 MIDI, gestes 2026-08-28). Une grille pitch (lignes) x pas
 * de temps (colonnes) pour UN clip MIDI. Les notes vivent dans le document
 * et se synchronisent comme tout le reste ; l'instrument en tete de chaine
 * de la piste les joue.
 *
 * Les gestes (chaque poignee garde sa branche « clic sans mouvement ») :
 *  - clic sur une case vide     : pose une note d'un pas (toggleNote)
 *  - clic sur une note          : l'enleve (toggleNote, meme sur sa queue)
 *  - glisser une note           : la DEPLACE (temps et hauteur, au pas)
 *  - glisser son bord droit     : sa LONGUEUR (au pas, >= 1 pas)
 *  - Alt + glisser verticalement, ou molette sur la note : sa VELOCITE
 *    (1 px = 1, molette = 5 par cran) - visible par l'intensite de la case
 * Les edits passent par updateNote(id) : un seul groupe d'undo par geste
 * (beginUndoGroup / endUndoGroup - la premiere capture par note garde les
 * valeurs d'avant le geste). Deplacer sur une case deja occupee par une
 * autre note au meme pitch+debut est REFUSE et montre (flash), jamais
 * silencieux : deux notes a la meme adresse seraient indistinguables.
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
const HINT = 'clic : poser / enlever · glisser : deplacer · bord droit : longueur · Alt+glisser ou molette : velocite';

type Mode = 'move' | 'len' | 'vel';

interface Placed {
  note: NoteDef;
  id: string;
  startStep: number;   // pas de debut (arrondi vers le bas)
  lenSteps: number;    // >= 1
}

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

  const grid = document.createElement('div');
  grid.className = 'pr-grid';
  grid.style.setProperty('--steps', String(STEPS));
  const status = document.createElement('div');
  status.className = 'pr-status';
  status.dataset.role = 'pr-status';
  status.textContent = HINT;

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
      // Outillage de pilotage (compo 2026-08-27) : adresser une cellule
      // par donnees, pas par geometrie - le meme contrat que les specs.
      cell.dataset.pitch = String(p);
      cell.dataset.step = String(s);
      cell.setAttribute('aria-label', `${noteName(p)} pas ${s + 1}`);
      cells.set(`${p}:${s}`, cell);
      grid.appendChild(cell);
    }
  }

  /** Repeint la grille depuis les notes (sans reconstruire les cases). */
  const paint = (notes: NoteDef[]): void => {
    for (const cell of cells.values()) {
      cell.classList.remove('pr-on', 'pr-tail', 'pr-head');
      delete cell.dataset.noteId;
      cell.style.removeProperty('--vel');
      cell.removeAttribute('title');
    }
    for (const pl of place(notes)) {
      const vel = Math.max(1, Math.min(127, pl.note.velocity));
      for (let k = 0; k < pl.lenSteps; k++) {
        const cell = cellAt(pl.note.pitch, pl.startStep + k);
        if (!cell) break;
        cell.classList.add('pr-on', k === 0 ? 'pr-head' : 'pr-tail');
        cell.dataset.noteId = pl.id;
        cell.style.setProperty('--vel', String(vel / 127));
        cell.title = `${noteName(pl.note.pitch)} · vel ${vel} · ${pl.lenSteps} pas`;
      }
    }
  };
  paint(clip.notes ?? []);

  const findPlaced = (id: string): Placed | undefined =>
    place(freshNotes()).find((pl) => pl.id === id);
  const occupied = (pitch: number, start: number, exceptId: string): boolean =>
    freshNotes().some((n) => n.id !== exceptId && n.pitch === pitch && startOf(n) === start);
  const flashRefusal = (): void => {
    grid.classList.remove('pr-refused');
    void grid.offsetWidth;  // relance l'animation
    grid.classList.add('pr-refused');
  };
  const say = (pl: Placed | undefined): void => {
    if (!pl) return;
    status.textContent = `${noteName(pl.note.pitch)} · pas ${pl.startStep + 1} · ${pl.lenSteps} pas · vel ${pl.note.velocity}`;
  };

  // ---- Clic : poser / enlever -----------------------------------------
  const toggleAt = (cell: HTMLButtonElement): void => {
    const p = Number(cell.dataset.pitch);
    const s = Number(cell.dataset.step);
    const id = cell.dataset.noteId;
    const existing = id ? freshNotes().find((n) => n.id === id) : undefined;
    const start = existing ? startOf(existing) : s * stepLen;
    const pitch = existing ? existing.pitch : p;
    const note: NoteDef = musical
      ? { pitch, velocity: 100, startTick: start, lengthTick: stepLen }
      : { pitch, velocity: 100, startSample: start, lengthSamples: stepLen };
    project.toggleNote(trackId, clip.id, note);
    onChange();
  };

  // ---- Glisser : deplacer / longueur / velocite ------------------------
  interface Drag {
    pointerId: number;
    cell: HTMLButtonElement;
    id: string;
    mode: Mode;
    x0: number; y0: number;
    cellW: number; rowH: number;
    pitch0: number; startStep0: number; lenSteps0: number; vel0: number;
    moved: boolean;
    grouped: boolean;
  }
  let drag: Drag | null = null;

  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target as HTMLElement;
    if (!(cell instanceof HTMLButtonElement) || !cell.classList.contains('pr-cell')) return;
    if (e.button !== 0) return;
    const id = cell.dataset.noteId;
    if (!id) return;  // case vide : le clic posera la note (branche click)
    const pl = findPlaced(id);
    if (!pl) return;
    const r = cell.getBoundingClientRect();
    const rowH = r.height + 1;   // + le gap de la grille
    const cellW = r.width + 1;
    const step = Number(cell.dataset.step);
    const onEdge = step === pl.startStep + pl.lenSteps - 1 && e.clientX >= r.right - EDGE_PX;
    const mode: Mode = e.altKey ? 'vel' : onEdge ? 'len' : 'move';
    drag = {
      pointerId: e.pointerId, cell, id, mode,
      x0: e.clientX, y0: e.clientY, cellW, rowH,
      pitch0: pl.note.pitch, startStep0: pl.startStep, lenSteps0: pl.lenSteps,
      vel0: pl.note.velocity, moved: false, grouped: false,
    };
    cell.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  grid.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
      drag.moved = true;
      project.beginUndoGroup();
      drag.grouped = true;
      grid.classList.add('pr-dragging');
      grid.dataset.mode = drag.mode;
    }
    let changed = false;
    if (drag.mode === 'vel') {
      const vel = Math.max(1, Math.min(127, Math.round(drag.vel0 - dy)));
      const cur = freshNotes().find((n) => n.id === drag!.id);
      if (cur && cur.velocity !== vel) {
        changed = project.updateNote(trackId, clip.id, drag.id, { velocity: vel });
      }
    } else if (drag.mode === 'len') {
      const len = Math.max(1, Math.min(STEPS - drag.startStep0,
        drag.lenSteps0 + Math.round(dx / drag.cellW)));
      const cur = findPlaced(drag.id);
      if (cur && cur.lenSteps !== len) {
        changed = project.updateNote(trackId, clip.id, drag.id, { [lengthKey]: len * stepLen });
      }
    } else {
      const maxStart = STEPS - drag.lenSteps0;
      const start = Math.max(0, Math.min(maxStart, drag.startStep0 + Math.round(dx / drag.cellW)));
      const pitch = Math.max(LOW, Math.min(HIGH, drag.pitch0 - Math.round(dy / drag.rowH)));
      const cur = findPlaced(drag.id);
      if (cur && (cur.startStep !== start || cur.note.pitch !== pitch)) {
        if (occupied(pitch, start * stepLen, drag.id)) flashRefusal();
        // Les DEUX champs a chaque fois : la premiere capture du groupe
        // garde ainsi pitch ET debut d'avant le geste (premiere capture
        // par note gagne dans un groupe d'undo).
        else changed = project.updateNote(trackId, clip.id, drag.id,
          { pitch, [startKey]: start * stepLen });
      }
    }
    if (changed) {
      onLive();
      paint(freshNotes());
      say(findPlaced(drag.id));
    }
  });

  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    try { d.cell.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    grid.classList.remove('pr-dragging');
    delete grid.dataset.mode;
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

  grid.addEventListener('click', (e) => {
    const cell = e.target as HTMLElement;
    if (!(cell instanceof HTMLButtonElement) || !cell.classList.contains('pr-cell')) return;
    toggleAt(cell);
  });

  // Molette sur une note : velocite par crans (un groupe d'undo par cran ;
  // le geste n'a pas de fin naturelle, chaque cran est un edit).
  grid.addEventListener('wheel', (e) => {
    const cell = e.target as HTMLElement;
    if (!(cell instanceof HTMLButtonElement) || !cell.dataset.noteId) return;
    const id = cell.dataset.noteId;
    const n = freshNotes().find((x) => x.id === id);
    if (!n) return;
    e.preventDefault();
    const vel = Math.max(1, Math.min(127, n.velocity + (e.deltaY < 0 ? WHEEL_VEL : -WHEEL_VEL)));
    if (vel === n.velocity) return;
    project.updateNote(trackId, clip.id, id, { velocity: vel });
    onLive();
    paint(freshNotes());
    say(findPlaced(id));
  }, { passive: false });

  grid.addEventListener('pointerover', (e) => {
    if (drag) return;
    const cell = e.target as HTMLElement;
    if (cell instanceof HTMLButtonElement && cell.dataset.noteId) say(findPlaced(cell.dataset.noteId));
    else if (cell instanceof HTMLButtonElement) status.textContent = HINT;
  });

  container.appendChild(grid);
  container.appendChild(status);
}
