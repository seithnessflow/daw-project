// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * D4 (DND-DESIGN.md) : deplacer un SLOT Session vers une autre cellule
 * (piste et/ou scene) par pointer-drag dans la grille du clip-launcher.
 *
 * Meme moule que track_reorder/device_reorder (regle SPLITTER : un module
 * par geste) : delegation pointerdown posee UNE fois, seuil de 5 px avant
 * armement - le CLIC simple existant des slots (lancer/arreter, handler
 * direct dans session.ts) reste intact sous le seuil.
 *
 * Cible : une cellule VIDE d'une autre piste et/ou d'une autre scene.
 * Drop sur une cellule PLEINE = no-op (jamais d'ecrasement silencieux).
 * Mutations au DROP seulement (Echap annule sans rien ecrire) :
 * - piste differente -> moveClipToTrack (delete+recreate meme id, le
 *   compromis d'identite D4 assume dans project.ts) ;
 * - scene differente -> setClipScene (LWW par champ, identite preservee) ;
 * - les deux -> UN groupe d'undo qui combine les deux mutateurs.
 */

import { ctx, sendLastChange } from './context';
import { renderTracks } from './render';

/** Seuil d'armement (px) : en-deca, le geste reste un clic (launch). */
const DRAG_THRESHOLD = 5;

let installed = false;

/** La cellule de la grille sous le pointeur, par GEOMETRIE (les cellules
 *  sont des <button> - closest sur le target du move suffirait, mais la
 *  geometrie reste vraie meme si un autre element passe sous la souris). */
function cellAt(clientX: number, clientY: number): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(
    '#session-slot .ss-slot')) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX < r.right &&
        clientY >= r.top && clientY < r.bottom) return el;
  }
  return null;
}

/**
 * Applique le drop. L'existence du slot est RELUE dans le document au
 * moment du drop (un pair a pu le supprimer pendant le geste - le DOM du
 * debut ment). ORDRE IMPOSE quand piste ET scene changent : setClipScene
 * AVANT moveClipToTrack - le endUndoGroup INTERNE de moveClipToTrack
 * ferme le groupe (le journal ne compte pas les imbrications), la capture
 * de scene doit donc deja etre dedans.
 */
function applyDrop(fromTrack: string, fromScene: string, clipId: string,
  cell: HTMLElement): void {
  if (!ctx.project) return;
  const toTrack = cell.dataset.ssTrack;
  const toScene = cell.dataset.ssScene;
  if (!toTrack || !toScene) return;
  if (cell.dataset.ssClip) return;         // cellule PLEINE : no-op grave
  const trackChanged = toTrack !== fromTrack;
  const sceneChanged = toScene !== fromScene;
  if (!trackChanged && !sceneChanged) return;
  const still = ctx.project.getDocument().tracks
    .find((t) => t.id === fromTrack)?.clips.some((c) => c.id === clipId);
  if (!still) return;                      // slot parti (remote) : no-op

  ctx.project.beginUndoGroup();
  if (sceneChanged) ctx.project.setClipScene(fromTrack, clipId, toScene);
  if (trackChanged) ctx.project.moveClipToTrack(fromTrack, clipId, toTrack);
  ctx.project.endUndoGroup();
  sendLastChange();
  renderTracks(true);   // re-rend l'arrangement ET la grille Session
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !ctx.project) return;
  const target = e.target as HTMLElement;
  // Seuls les slots PLEINS se prennent (un slot vide, c'est le bouton +)
  const cell = target.closest('.ss-slot.filled') as HTMLElement | null;
  if (!cell || !cell.closest('#session-slot')) return;
  const fromTrack = cell.dataset.ssTrack;
  const fromScene = cell.dataset.ssScene;
  const clipId = cell.dataset.ssClip;
  if (!fromTrack || !fromScene || !clipId) return;

  const startX = e.clientX;
  const startY = e.clientY;
  let armed = false;
  let over: HTMLElement | null = null;

  const clearOver = (): void => {
    over?.classList.remove('dnd-drop-cell');
    over = null;
  };
  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    cell.classList.remove('slot-reorder-source');
    document.body.classList.remove('slot-reorder-active');
    clearOver();
  };
  /** Les handlers click des slots sont DIRECTS (session.ts, pas de garde
   *  justDragged chez eux) : on avale le click synthetique qui suit le
   *  drag en capture, puis on desarme au tour de boucle suivant (le click
   *  est synchrone apres pointerup - un drop hors cellule ne doit pas
   *  voler le VRAI clic suivant). */
  const swallowNextClick = (): void => {
    const swallow = (ce: MouseEvent): void => {
      ce.stopPropagation();
      ce.preventDefault();
    };
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };

  const onMove = (ev: PointerEvent): void => {
    if (!armed) {
      // Le clic simple reste le launch (regle gravee des poignees) :
      // rien ne s'arme avant 5 px de mouvement.
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      armed = true;
      cell.classList.add('slot-reorder-source');
      document.body.classList.add('slot-reorder-active');
    }
    ev.preventDefault();
    const t = cellAt(ev.clientX, ev.clientY);
    // Seule une cellule VIDE d'une autre piste/scene promet un drop -
    // pas de surlignage mensonger sur une cellule pleine ou la source.
    const ok = t !== null && t !== cell && !t.dataset.ssClip &&
      (t.dataset.ssTrack !== fromTrack || t.dataset.ssScene !== fromScene);
    const next = ok ? t : null;
    if (next !== over) {
      clearOver();
      if (next) {
        over = next;
        over.classList.add('dnd-drop-cell');
      }
    }
  };

  const onUp = (): void => {
    const wasArmed = armed;
    const drop = over;
    cleanup();
    if (!wasArmed) return;  // clic simple : le click de session.ts lance
    ctx.justDragged = true;
    setTimeout(() => { ctx.justDragged = false; }, 0);
    swallowNextClick();
    if (drop) applyDrop(fromTrack, fromScene, clipId, drop);
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    // Echap pendant le drag = annule (aucune mutation n'a encore eu
    // lieu : le document n'est ecrit qu'au drop).
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
    if (armed) {
      // Le relachement qui suit un drag ANNULE ne doit pas relancer le
      // slot par un clic surprise.
      window.addEventListener('pointerup', () => {
        ctx.justDragged = true;
        setTimeout(() => { ctx.justDragged = false; }, 0);
        swallowNextClick();
      }, { once: true });
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
}

/** Pose la delegation UNE fois (idempotent - appele a chaque rendu de la
 *  grille Session par renderSession, session.ts). */
export function initSlotReorder(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown);
}
