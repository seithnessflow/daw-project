// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * D2 (DND-DESIGN.md) : reordonner les DEVICES d'une chaine par drag
 * HORIZONTAL du panneau dans le rack (Device View, panneau du bas).
 *
 * L'ordre de la chaine EST le sens (pipeline audio) : le drop appelle
 * moveProcessor (remove + insert de la meme def dans UN change - le
 * compromis CRDT est documente sur le mutateur, project.ts), jamais un
 * champ order. Un move = UNE entree d'undo (le mutateur capture le move
 * retour), pas besoin de groupe.
 *
 * Cablage : DELEGATION sur document, posee UNE fois (garde idempotente)
 * par initDeviceReorder() appele en tete de renderTracks - meme moule
 * que track_reorder.ts (D1), wiring.ts reste intouche et la delegation
 * survit aux rebuilds du Device View.
 *
 * Regle gravee des poignees : la prise est la BARRE DE TITRE du panneau
 * (.device-title - le nom et le fond ; JAMAIS les boutons bypass/BOX/
 * retirer ni les knobs, exclus par closest). Le clic SANS mouvement ne
 * fait RIEN ici (pas de preventDefault sur pointerdown, pas de
 * justDragged) : les boutons de la barre gardent leur click, et un clic
 * sur le nom reste inerte comme avant - rien ne s'arme sous 5 px.
 */

import { ctx, sendLastChange } from './context';
import { renderTracks } from './render';

/** Seuil d'armement (px) : en-deca, le geste reste un clic. */
const DRAG_THRESHOLD = 5;

let installed = false;

/** Les panneaux device du rack, dans l'ordre du DOM (= ordre de la
 *  chaine du doc - createDeviceView itere track.chain). .device filtre
 *  les intercalaires (.device-vu, .device-empty). */
function deviceEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    '#device-view .device-chain .device[data-proc-id]'));
}

/** Slot d'insertion (0..N) sous le curseur : nombre de panneaux dont le
 *  milieu HORIZONTAL est a gauche du pointeur (axe X - le rack est une
 *  rangee, le jumeau vertical vit dans track_reorder.ts). */
function slotAt(clientX: number, els: HTMLElement[]): number {
  let slot = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.left + r.width / 2 < clientX) slot++;
  }
  return slot;
}

/**
 * Applique le drop : slot (0..N parmi les panneaux) -> index FINAL dans
 * la chaine (retirer la source decale d'un cran tout ce qui la suit).
 * L'index source est relu dans le DOCUMENT au moment du drop - un pair
 * a pu bouger la chaine pendant le geste, le DOM du debut ment.
 */
function applyDrop(trackId: string, procId: string, slot: number): void {
  if (!ctx.project) return;
  const track = ctx.project.getDocument().tracks.find((t) => t.id === trackId);
  const srcPos = track ? track.chain.findIndex((p) => p.id === procId) : -1;
  if (srcPos < 0) return;                              // device parti (remote)
  if (slot === srcPos || slot === srcPos + 1) return;  // meme place : no-op
  const toIndex = slot > srcPos ? slot - 1 : slot;
  ctx.project.moveProcessor(trackId, procId, toIndex);
  sendLastChange();
  renderTracks(true);
}

/** Ligne d'insertion VERTICALE : creee une fois, position: fixed (immune
 *  au scroll horizontal du rack), montree/cachee pendant le drag. */
function insertLine(): HTMLElement {
  let line = document.getElementById('device-reorder-line');
  if (!line) {
    line = document.createElement('div');
    line.id = 'device-reorder-line';
    line.className = 'device-reorder-line';
    line.hidden = true;
    document.body.appendChild(line);
  }
  return line;
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !ctx.project) return;
  const target = e.target as HTMLElement;
  const title = target.closest('.device-title') as HTMLElement | null;
  // Seulement la barre de titre du rack - et JAMAIS depuis les controles
  // qui ont leur propre geste (bypass, BOX, retirer, knobs, tout input).
  if (!title || !title.closest('#device-view')) return;
  if (target.closest('button, input, select, textarea, .knob')) return;
  const panel = title.closest('.device[data-proc-id]') as HTMLElement | null;
  const procId = panel?.getAttribute('data-proc-id');
  // La piste se retrouve par le DEVICE dans le doc - PAS par
  // ctx.selectedTrackId : le rack affiche la premiere piste en fallback
  // SANS poser la selection (drag muet constate en spec), et le doc est
  // de toute facon la seule verite.
  const trackId = procId
    ? ctx.project.getDocument().tracks
        .find((t) => t.chain.some((p) => p.id === procId))?.id ?? null
    : null;
  if (!panel || !procId || !trackId) return;

  const startX = e.clientX;
  const startY = e.clientY;
  let armed = false;
  let slot = -1;
  const line = insertLine();

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    panel.classList.remove('device-reorder-source');
    document.body.classList.remove('device-reorder-active');
    line.hidden = true;
  };

  const onMove = (ev: PointerEvent): void => {
    if (!armed) {
      // Le clic simple reste inerte (regle gravee) : rien ne s'arme
      // avant 5 px de mouvement.
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      armed = true;
      panel.classList.add('device-reorder-source');
      // user-select: none pendant le geste (dnd.css) - on ne
      // preventDefault pas le pointerdown pour ne pas toucher au clic.
      document.body.classList.add('device-reorder-active');
    }
    ev.preventDefault();
    const els = deviceEls();
    slot = slotAt(ev.clientX, els);
    const srcPos = els.indexOf(panel);
    // Slot adjacent a la source = drop sans effet : pas de ligne (une
    // promesse visuelle qui ne ferait rien serait un mensonge).
    if (slot === srcPos || slot === srcPos + 1 || els.length === 0) {
      line.hidden = true;
      return;
    }
    const x = slot < els.length
      ? els[slot].getBoundingClientRect().left
      : els[els.length - 1].getBoundingClientRect().right;
    const box = (document.querySelector('#device-view .device-chain') ?? els[0])
      .getBoundingClientRect();
    line.style.left = `${x - 1}px`;
    line.style.top = `${box.top}px`;
    line.style.height = `${box.height}px`;
    line.hidden = false;
  };

  const onUp = (): void => {
    const wasArmed = armed;
    const dropSlot = line.hidden ? -1 : slot;
    cleanup();
    if (!wasArmed) return;  // clic simple : aucun effet, aucun undo
    // Un drag fini ne doit pas declencher un chemin click ailleurs -
    // meme idiome que les gestes de clips et de pistes.
    ctx.justDragged = true;
    setTimeout(() => { ctx.justDragged = false; }, 0);
    if (dropSlot >= 0) applyDrop(trackId, procId, dropSlot);
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    // Echap pendant le drag = annule (aucune mutation n'a encore eu
    // lieu : le document n'est ecrit qu'au drop).
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
    if (armed) {
      // Le relachement qui suit un drag ANNULE ne doit pas non plus
      // devenir un clic surprise.
      window.addEventListener('pointerup', () => {
        ctx.justDragged = true;
        setTimeout(() => { ctx.justDragged = false; }, 0);
      }, { once: true });
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
}

/** Pose la delegation UNE fois (idempotent - appele a chaque rendu). */
export function initDeviceReorder(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown);
}
