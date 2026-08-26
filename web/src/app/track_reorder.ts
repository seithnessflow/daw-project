// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * D1 (DND-DESIGN.md) : reordonner les PISTES par drag de la tete.
 *
 * Principe CRDT : on n'ecrit QUE le champ additif TrackDef.order
 * (fractionnaire) - la liste Automerge ne bouge jamais, l'identite des
 * objets survit, les edits concurrents d'un pair (gain, pan...) ne sont
 * pas perdus pendant un deplacement. Tri d'affichage : orderedTracks
 * (schema.ts, source unique).
 *
 * Cablage : DELEGATION sur document, posee UNE fois (garde idempotente)
 * par initTrackReorder() appele en tete de renderTracks - wiring.ts
 * (autre chantier) reste intouche, et la delegation survit a tous les
 * rebuilds de #tracks.
 *
 * Regle gravee des poignees : le clic SANS mouvement sur la tete reste
 * la selection de piste - ce module n'arme le drag qu'apres 5 px de
 * mouvement et, sans mouvement, ne fait RIEN (il ne preventDefault pas
 * le pointerdown, ne pose pas justDragged : le handler click existant
 * de wiring.ts recoit le clic normalement et selectionne).
 */

import { ctx, sendLastChange } from './context';
import { renderTracks } from './render';
import { orderedTracks } from '../document/schema';

/** Seuil d'armement (px) : en-deca, le geste reste un clic (selection). */
const DRAG_THRESHOLD = 5;
/** En-deca de cet ecart entre voisins, (a+b)/2 ne separe plus de facon
 *  fiable (flottants) : on REEQUILIBRE tout a 0,1,2,... */
const MIN_GAP = 1e-9;

let installed = false;

/** Les elements piste de l'ARRANGEMENT, dans l'ordre du DOM (= ordre
 *  d'affichage). #tracks contient aussi ruler/playhead - .track filtre. */
function trackEls(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('#tracks .track[data-track-id]'));
}

/** Slot d'insertion (0..N) sous le curseur : nombre de pistes dont le
 *  milieu vertical est au-dessus du pointeur. */
function slotAt(clientY: number, els: HTMLElement[]): number {
  let slot = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.top + r.height / 2 < clientY) slot++;
  }
  return slot;
}

/**
 * Applique le drop : la piste draggee prend un order fractionnaire entre
 * ses nouveaux voisins ((avant+apres)/2 ; premiere place = min-1 ;
 * derniere = max+1). Si l'ecart entre les deux voisins est < MIN_GAP
 * (bisections repetees au meme endroit), on REEQUILIBRE toutes les
 * pistes a 0,1,2,... dans l'ordre d'affichage vise - UN seul groupe
 * d'undo (la dedup par targetKey garde, pour chaque piste, la valeur
 * pre-geste comme inverse ; Ctrl+Z restaure donc tout l'etat d'avant,
 * champs absents compris via clearTrackOrder).
 */
function applyDrop(trackId: string, slot: number): void {
  if (!ctx.project) return;
  const doc = ctx.project.getDocument();
  // Cle d'ordre EFFECTIVE par id (le contrat de orderedTracks :
  // order ?? index de creation), construite en UNE lecture de la liste -
  // jamais d'identite d'objet entre deux lectures d'un doc Automerge.
  const keyOf = new Map<string, number>();
  doc.tracks.forEach((t, i) => keyOf.set(t.id, t.order ?? i));
  const shown = orderedTracks(doc);
  const srcPos = shown.findIndex((t) => t.id === trackId);
  if (srcPos < 0) return;                          // piste partie (remote)
  if (slot === srcPos || slot === srcPos + 1) return;  // meme place : no-op
  const others = shown.filter((t) => t.id !== trackId);
  const posInOthers = slot > srcPos ? slot - 1 : slot;
  const prev = others[posInOthers - 1];
  const next = others[posInOthers];

  ctx.project.beginUndoGroup();
  if (!prev && !next) {
    // piste seule : rien a ordonner
  } else if (!prev) {
    // premiere place = min - 1 (others est trie : next porte le min)
    ctx.project.setTrackOrder(trackId, keyOf.get(next.id)! - 1);
  } else if (!next) {
    // derniere place = max + 1 (prev porte le max)
    ctx.project.setTrackOrder(trackId, keyOf.get(prev.id)! + 1);
  } else {
    const a = keyOf.get(prev.id)!;
    const b = keyOf.get(next.id)!;
    if (b - a < MIN_GAP) {
      // Reequilibrage : l'ordre d'affichage VISE, renumerote 0,1,2,...
      const target = others.map((t) => t.id);
      target.splice(posInOthers, 0, trackId);
      target.forEach((id, i) => ctx.project!.setTrackOrder(id, i));
    } else {
      ctx.project.setTrackOrder(trackId, (a + b) / 2);
    }
  }
  ctx.project.endUndoGroup();
  sendLastChange();
  renderTracks(true);
}

/** Ligne d'insertion : creee une fois, position: fixed (immune au scroll
 *  interne de #tracks), montree/cachee pendant le drag. */
function insertLine(): HTMLElement {
  let line = document.getElementById('track-reorder-line');
  if (!line) {
    line = document.createElement('div');
    line.id = 'track-reorder-line';
    line.className = 'track-reorder-line';
    line.hidden = true;
    document.body.appendChild(line);
  }
  return line;
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !ctx.project) return;
  const target = e.target as HTMLElement;
  const head = target.closest('.track-head') as HTMLElement | null;
  // Seulement la tete de l'arrangement - et JAMAIS depuis les controles
  // qui ont leur propre geste (M/S, fader et sa rangee, tout input) :
  // la zone de grab est le nom + la barre de couleur + le fond.
  if (!head || !head.closest('#tracks')) return;
  if (target.closest('button, input, select, textarea, .track-fader')) return;
  const trackEl = head.closest('.track[data-track-id]') as HTMLElement | null;
  const trackId = trackEl?.getAttribute('data-track-id');
  if (!trackEl || !trackId) return;

  const startX = e.clientX;
  const startY = e.clientY;
  let armed = false;
  let slot = -1;
  const line = insertLine();

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    trackEl.classList.remove('track-reorder-source');
    document.body.classList.remove('track-reorder-active');
    line.hidden = true;
  };

  const onMove = (ev: PointerEvent): void => {
    if (!armed) {
      // Le clic simple reste la selection (regle gravee) : rien ne
      // s'arme avant 5 px de mouvement.
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      armed = true;
      trackEl.classList.add('track-reorder-source');
      // user-select: none pendant le geste (dnd.css) - on ne
      // preventDefault pas le pointerdown pour ne pas toucher au clic.
      document.body.classList.add('track-reorder-active');
    }
    ev.preventDefault();
    const els = trackEls();
    slot = slotAt(ev.clientY, els);
    const srcPos = els.indexOf(trackEl);
    // Slot adjacent a la source = drop sans effet : pas de ligne (une
    // promesse visuelle qui ne ferait rien serait un mensonge).
    if (slot === srcPos || slot === srcPos + 1 || els.length === 0) {
      line.hidden = true;
      return;
    }
    const y = slot < els.length
      ? els[slot].getBoundingClientRect().top
      : els[els.length - 1].getBoundingClientRect().bottom;
    const box = (document.getElementById('tracks') ?? els[0])
      .getBoundingClientRect();
    line.style.top = `${y - 1}px`;
    line.style.left = `${box.left}px`;
    line.style.width = `${box.width}px`;
    line.hidden = false;
  };

  const onUp = (): void => {
    const wasArmed = armed;
    const dropSlot = line.hidden ? -1 : slot;
    cleanup();
    if (!wasArmed) return;  // clic simple : le click de wiring selectionne
    // Un drag fini ne doit pas declencher le chemin click (selection /
    // placement de sample) - meme idiome que les gestes de clips.
    ctx.justDragged = true;
    setTimeout(() => { ctx.justDragged = false; }, 0);
    if (dropSlot >= 0) applyDrop(trackId, dropSlot);
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
      // devenir un clic de selection surprise.
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
export function initTrackReorder(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown);
}
