// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Clip gestures (potion C1/C2): drag by the title bar, resize by the
 * 6px edges - snapped to the zoom-refined grid AND neighbor edges,
 * Alt = free. Coalescing: at most one document write per animation
 * frame during a gesture, a final one on release (the fader's road).
 * D4: the title-bar drag is BI-DIMENSIONAL - X keeps the historic
 * horizontal behavior, Y targets another track's lane (drop = the
 * moveClipToTrack mutator, Escape cancels).
 */

import { TIMELINE } from '../ui/track';
import { clipStartSamples, clipLengthSamples, clipEndSamples }
  from '../document/geometry';
import { ctx, sendLastChange } from './context';
import { snapStep, snapSecMusical } from './navigation';
import { isMusicalClip } from '../document/schema';
import { renderTracks } from './render';
import { cssId } from '../document/sanitize';
import { selectClip, setClipSelection, selectedClips, isClipSelected, setTimeSelection } from './clip_selection';

const isAdditive = (e: PointerEvent | MouseEvent): boolean => e.shiftKey || e.ctrlKey || e.metaKey;

/** Touch mode A: a freshly placed clip "lands" (CSS decides if it shows). */
export function markLanded(clipId: string): void {
  const el = document.querySelector(
    `[data-clip-id="${cssId(clipId)}"]`) as HTMLElement | null;
  el?.classList.add('landed');
}

export function beginClipDrag(e: PointerEvent, handle: HTMLElement): void {
  if (!ctx.project) return;
  const clipEl = handle.closest('.clip') as HTMLElement | null;
  const trackEl = handle.closest('[data-track-id]') as HTMLElement | null;
  if (!clipEl || !trackEl) return;
  const clipId = clipEl.dataset.clipId!;
  const trackId = trackEl.getAttribute('data-track-id')!;
  const doc = ctx.project.getDocument();
  const sr = doc.sampleRate || 48000;
  const track = doc.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) return;

  // Neighbor edges (start/end of every OTHER clip on this track)
  // T3 : geometrie via LE point de branche (clips musicaux inclus)
  const edges: number[] = [];
  for (const c of track.clips) {
    if (c.id === clipId) continue;
    edges.push(clipStartSamples(c, doc) / sr, clipEndSamples(c, doc) / sr);
  }

  const startX = e.clientX;
  const startY = e.clientY;
  const additive = isAdditive(e);
  const origSec = clipStartSamples(clip, doc) / sr;
  let moved = false;
  let pendingSec = origSec;
  let writeRaf = 0;
  // 2026-08-28 : glisser un clip du LOT deplace tout le lot du meme
  // delta (chacun borne a 0) ; glisser un clip HORS lot le selectionne
  // seul d'abord (Shift/Ctrl : l'ajoute). Le lot ne change pas de piste
  // (l'axe Y reste au clip seul).
  const wasSelected = isClipSelected(clipId);
  if (!wasSelected) selectClip(clipId, trackId, additive);
  const lot = selectedClips()
    .filter((x) => x.clip.id !== clipId)
    .map((x) => ({
      trackId: x.trackId, clipId: x.clip.id,
      origSec: clipStartSamples(x.clip, doc) / sr,
      el: document.querySelector(`[data-clip-id="${cssId(x.clip.id)}"]`) as HTMLElement | null,
    }));
  const placeLot = (sec: number): void => {
    const delta = sec - origSec;
    for (const m of lot) {
      const s = Math.max(0, m.origSec + delta);
      if (m.el) m.el.style.left = `${s * TIMELINE.pps}px`;
    }
  };
  const writeLot = (sec: number): void => {
    const delta = sec - origSec;
    for (const m of lot) {
      ctx.project!.setClipStart(m.trackId, m.clipId, Math.max(0, m.origSec + delta) * sr);
    }
  };
  // D4 : piste cible d'un drag VERTICAL (null = on reste sur sa piste).
  // L'axe X garde tout le comportement existant (snap, ecritures rAF sur
  // la piste d'ORIGINE) ; l'axe Y ne fait que viser une autre lane - la
  // mutation de piste n'a lieu qu'au DROP (moveClipToTrack).
  let dropTrackId: string | null = null;
  e.preventDefault();

  // D4 : la lane sous le pointeur par GEOMETRIE (elementsFromPoint verrait
  // le clip qui suit la souris ; les rects des lanes ne mentent pas).
  const laneTrackAt = (clientY: number): HTMLElement | null => {
    for (const el of document.querySelectorAll<HTMLElement>(
      '#tracks .track[data-track-id]')) {
      const lane = el.querySelector('.track-lane');
      if (!lane) continue;
      const r = lane.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return el;
    }
    return null;
  };
  const clearDropHighlight = (): void => {
    document.querySelectorAll('#tracks .track.dnd-drop-track')
      .forEach((el) => el.classList.remove('dnd-drop-track'));
  };

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    // D4 : le seuil arme aussi sur Y (un drag purement vertical vers une
    // autre piste doit s'armer) - un clic sans mouvement reste un clic.
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!moved) ctx.project!.beginUndoGroup(); // V1.3: one gesture = one undo
    moved = true;
    clipEl.classList.add('dragging');
    let sec = Math.max(0, origSec + dx / TIMELINE.pps);
    if (!ev.altKey) {
      // T3 : un clip MUSICAL snappe sur la grille en TICKS (a 120 BPM
      // les deux grilles coincident) ; l'absolu garde les secondes.
      const step = snapStep();
      let snapped = isMusicalClip(clip)
        ? snapSecMusical(doc, sec)
        : Math.round(sec / step) * step;
      // Neighbor edges win within 8 px
      for (const edge of edges) {
        if (Math.abs(sec - edge) * TIMELINE.pps < 8) { snapped = edge; break; }
      }
      sec = Math.max(0, snapped);
    }
    clipEl.style.left = `${sec * TIMELINE.pps}px`;
    pendingSec = sec;
    placeLot(sec);
    // D4 : surligner la piste cible quand le pointeur survole la lane
    // d'une AUTRE piste (classe existante .dnd-drop-track, dnd.css).
    const targetEl = lot.length ? null : laneTrackAt(ev.clientY);
    const targetId = targetEl?.getAttribute('data-track-id') ?? null;
    const next = targetId && targetId !== trackId ? targetId : null;
    if (next !== dropTrackId) {
      clearDropHighlight();
      dropTrackId = next;
      if (next && targetEl) targetEl.classList.add('dnd-drop-track');
    }
    if (!writeRaf) {
      writeRaf = requestAnimationFrame(() => {
        writeRaf = 0;
        ctx.project!.setClipStart(trackId, clipId, pendingSec * sr);
        writeLot(pendingSec);
        sendLastChange();
      });
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    if (writeRaf) cancelAnimationFrame(writeRaf);
    clipEl.classList.remove('dragging');
    clearDropHighlight();
    if (moved) {
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      if (dropTrackId) {
        // D4 : drop sur une AUTRE piste - delete+recreate meme id (le
        // compromis d'identite assume, mutateur unique moveClipToTrack),
        // position = le MEME snap que l'horizontal (pendingSec). Son
        // endUndoGroup interne clot le groupe du geste ; le notre plus
        // bas est alors un no-op inoffensif.
        ctx.project!.moveClipToTrack(trackId, clipId, dropTrackId, pendingSec * sr);
      } else {
        // Sur sa propre piste : comportement existant inchange.
        ctx.project!.setClipStart(trackId, clipId, pendingSec * sr);
        writeLot(pendingSec);
      }
      ctx.project!.endUndoGroup();  // V1.3
      sendLastChange();
      renderTracks(true);
    } else {
      // Un sample ARME change le sens du clic : POSER EN COUCHE
      // (chevauchement=somme, le modele moteur) au lieu de selectionner -
      // avant, le clic sur une position occupee etait AVALE en silence
      // (2 snares perdues en composant, 2026-08-27). On laisse l'event
      // 'click' buller vers le placeur de wiring (pas de justDragged).
      if (ctx.library?.getArmed()) return;
      // A plain click on the title bar: select the clip (and its track) ;
      // Shift/Ctrl : ajoute / retire du lot (clip_selection.ts). Un clip
      // deja dans le lot : Shift le RETIRE ; hors lot : deja ajoute au
      // pointerdown (pas de double bascule).
      if (!additive) selectClip(clipId, trackId, false);
      else if (wasSelected) selectClip(clipId, trackId, true);
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      renderTracks(true);
    }
  };
  const onKey = (kev: KeyboardEvent) => {
    if (kev.key !== 'Escape') return;
    // Echap annule (idiome D1/D2) - MAIS ici le doc a deja recu des
    // ecritures coalescees pendant le drag : on REMET la position
    // d'origine puis on ferme le groupe. L'entree d'undo restante est un
    // aller-retour inerte (le journal n'a pas d'abort - assume, commente).
    kev.preventDefault();
    kev.stopPropagation();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    if (writeRaf) { cancelAnimationFrame(writeRaf); writeRaf = 0; }
    clipEl.classList.remove('dragging');
    clearDropHighlight();
    dropTrackId = null;
    if (moved) {
      clipEl.style.left = `${origSec * TIMELINE.pps}px`;
      ctx.project!.setClipStart(trackId, clipId, origSec * sr);
      writeLot(origSec);
      ctx.project!.endUndoGroup();
      sendLastChange();
      // Le relachement qui suit un drag ANNULE ne doit pas devenir un
      // clic surprise (meme idiome que track_reorder).
      window.addEventListener('pointerup', () => {
        ctx.justDragged = true;
        setTimeout(() => { ctx.justDragged = false; }, 0);
      }, { once: true });
      renderTracks(true);
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
}

/**
 * V1.6: drag a top-corner fade handle. Horizontal drag sets the fade
 * length (clamped to half the clip); both fields write together via
 * setClipFades (one gesture = one undo entry). Handles rule: a click
 * without movement SELECTS the clip.
 */
export function beginFadeDrag(e: PointerEvent, handleEl: HTMLElement): void {
  if (!ctx.project) return;
  const additive = isAdditive(e);
  const clipEl = handleEl.closest('.clip') as HTMLElement | null;
  const trackEl = handleEl.closest('[data-track-id]') as HTMLElement | null;
  if (!clipEl || !trackEl) return;
  const side = handleEl.dataset.side as 'in' | 'out';
  const clipId = clipEl.dataset.clipId!;
  const trackId = trackEl.getAttribute('data-track-id')!;
  const doc = ctx.project.getDocument();
  const sr = doc.sampleRate || 48000;
  const clip = doc.tracks.find((t) => t.id === trackId)
    ?.clips.find((c) => c.id === clipId);
  if (!clip) return;

  const half = Math.floor(clipLengthSamples(clip, doc) / 2);
  const origIn = clip.fadeInSamples ?? 0;
  const origOut = clip.fadeOutSamples ?? 0;
  let pendingIn = origIn;
  let pendingOut = origOut;
  const startX = e.clientX;
  let moved = false;
  let writeRaf = 0;
  e.preventDefault();
  e.stopPropagation();

  const shade = clipEl.querySelector(`.clip-fade-${side}`) as HTMLElement | null;
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) ctx.project!.beginUndoGroup();
    moved = true;
    const dSamples = (dx / TIMELINE.pps) * sr;
    // Fade-in grows to the right, fade-out grows to the LEFT
    if (side === 'in') {
      pendingIn = Math.min(half, Math.max(0, Math.round(origIn + dSamples)));
    } else {
      pendingOut = Math.min(half, Math.max(0, Math.round(origOut - dSamples)));
    }
    const px = ((side === 'in' ? pendingIn : pendingOut) / sr) * TIMELINE.pps;
    if (shade) shade.style.width = `${px}px`;
    if (side === 'in') handleEl.style.left = `${px}px`;
    else handleEl.style.right = `${px}px`;
    if (!writeRaf) {
      writeRaf = requestAnimationFrame(() => {
        writeRaf = 0;
        ctx.project!.setClipFades(trackId, clipId, pendingIn, pendingOut);
        sendLastChange();
      });
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (writeRaf) cancelAnimationFrame(writeRaf);
    if (moved) {
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      ctx.project!.setClipFades(trackId, clipId, pendingIn, pendingOut);
      ctx.project!.endUndoGroup();
      sendLastChange();
      renderTracks(true);
    } else {
      // Handles rule: plain click selects (same branch as edges)
      selectClip(clipId, trackId, additive);
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      renderTracks(true);
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export function beginClipResize(e: PointerEvent, edgeEl: HTMLElement): void {
  if (!ctx.project) return;
  const additive = isAdditive(e);
  const clipEl = edgeEl.closest('.clip') as HTMLElement | null;
  const trackEl = edgeEl.closest('[data-track-id]') as HTMLElement | null;
  if (!clipEl || !trackEl) return;
  const side = edgeEl.dataset.edge as 'left' | 'right';
  const clipId = clipEl.dataset.clipId!;
  const trackId = trackEl.getAttribute('data-track-id')!;
  const doc = ctx.project.getDocument();
  const sr = doc.sampleRate || 48000;
  const track = doc.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) return;

  const edges: number[] = [];
  for (const c of track.clips) {
    if (c.id === clipId) continue;
    edges.push(clipStartSamples(c, doc) / sr, clipEndSamples(c, doc) / sr);
  }

  const startX = e.clientX;
  const orig = {
    start: clipStartSamples(clip, doc) / sr,
    length: clipLengthSamples(clip, doc) / sr,
    offset: clip.offsetSamples / sr,
  };
  const MIN_LEN = 1024 / sr;
  let pending = { ...orig };
  let moved = false;
  let writeRaf = 0;
  e.preventDefault();
  e.stopPropagation();

  const snapSec = (sec: number, alt: boolean): number => {
    if (alt) return sec;
    const step = snapStep();
    // T3 : grille musicale pour les clips musicaux (voir drag)
    let snapped = isMusicalClip(clip)
      ? snapSecMusical(doc, sec)
      : Math.round(sec / step) * step;
    for (const edge of edges) {
      if (Math.abs(sec - edge) * TIMELINE.pps < 8) { snapped = edge; break; }
    }
    return snapped;
  };

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) ctx.project!.beginUndoGroup(); // V1.3: one gesture = one undo
    moved = true;
    clipEl.classList.add('dragging');
    if (side === 'right') {
      const endSec = snapSec(orig.start + orig.length + dx / TIMELINE.pps, ev.altKey);
      pending.length = Math.max(MIN_LEN, endSec - orig.start);
    } else {
      let newStart = snapSec(orig.start + dx / TIMELINE.pps, ev.altKey);
      // Head trim: offset cannot go negative, length cannot vanish
      const minStart = orig.start - orig.offset;
      const maxStart = orig.start + orig.length - MIN_LEN;
      newStart = Math.min(maxStart, Math.max(0, Math.max(minStart, newStart)));
      const d = newStart - orig.start;
      pending = {
        start: newStart,
        offset: orig.offset + d,
        length: orig.length - d,
      };
    }
    clipEl.style.left = `${pending.start * TIMELINE.pps}px`;
    clipEl.style.width = `${Math.max(2, pending.length * TIMELINE.pps)}px`;
    if (!writeRaf) {
      writeRaf = requestAnimationFrame(() => {
        writeRaf = 0;
        flushBounds();
      });
    }
  };
  const flushBounds = () => {
    ctx.project!.setClipBounds(trackId, clipId, {
      startSample: pending.start * sr,
      lengthSamples: pending.length * sr,
      offsetSamples: pending.offset * sr,
    });
    sendLastChange();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (writeRaf) cancelAnimationFrame(writeRaf);
    clipEl.classList.remove('dragging');
    if (moved) {
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      flushBounds();
      ctx.project!.endUndoGroup();  // V1.3
      renderTracks(true);
    } else {
      // A plain click on an edge SELECTS the clip, exactly like the
      // title bar. Session B fix: this branch did not exist, so a tiny
      // clip (entirely covered by its 6px edges) could NEVER be
      // selected - and Delete silently did nothing.
      selectClip(clipId, trackId, additive);
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      renderTracks(true);
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/**
 * 2026-08-28 : LASSO de clips depuis le vide d'une lane. Un rectangle
 * (position fixed, coordonnees ecran) ; les clips dont le rect le touche
 * forment la selection (Shift/Ctrl : s'ajoutent). Un clic sans mouvement
 * n'est PAS un lasso : le clic de lane (marqueur, pose) garde son sens.
 */
export function beginClipLasso(e: PointerEvent): void {
  if (!ctx.project) return;
  const additive = isAdditive(e);
  const x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  let lastX: number | null = null;
  let rect: HTMLElement | null = null;
  const tracks = document.getElementById('tracks');
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    lastX = ev.clientX;
    if (!moved) {
      moved = true;
      rect = document.createElement('div');
      rect.className = 'clip-lasso';
      rect.dataset.role = 'clip-lasso';
      document.body.appendChild(rect);
      tracks?.classList.add('lassoing');
    }
    const x1 = Math.min(x0, ev.clientX), x2 = Math.max(x0, ev.clientX);
    const y1 = Math.min(y0, ev.clientY), y2 = Math.max(y0, ev.clientY);
    rect!.style.left = `${x1}px`; rect!.style.top = `${y1}px`;
    rect!.style.width = `${x2 - x1}px`; rect!.style.height = `${y2 - y1}px`;
    const hits: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#tracks .clip[data-clip-id]')) {
      const r = el.getBoundingClientRect();
      if (r.right >= x1 && r.left <= x2 && r.bottom >= y1 && r.top <= y2) hits.push(el.dataset.clipId!);
    }
    setClipSelection(hits, additive);
    // Reflet immediat sans re-rendu (le re-rendu vient au relachement)
    for (const el of document.querySelectorAll<HTMLElement>('#tracks .clip[data-clip-id]')) {
      if (ctx.selectedClipIds.has(el.dataset.clipId!)) el.setAttribute('aria-selected', 'true');
      else el.removeAttribute('aria-selected');
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    tracks?.classList.remove('lassoing');
    rect?.remove();
    if (!moved) return;   // un clic : le 'click' de lane fait son travail
    ctx.justDragged = true;
    setTimeout(() => { ctx.justDragged = false; }, 0);
    const first = selectedClips()[0];
    if (first) ctx.selectedTrackId = first.trackId;
    // Le lasso est aussi une SELECTION DE TEMPS (Ableton) : la plage
    // balayee, snappee a la grille vers l'exterieur - c'est elle que
    // Ctrl+D duplique, silences compris.
    const laneEl = document.querySelector('#tracks .track-lane');
    if (laneEl && lastX !== null) {
      const left = laneEl.getBoundingClientRect().left;
      const step = snapStep();
      const s1 = Math.max(0, Math.min(x0, lastX) - left) / TIMELINE.pps;
      const s2 = Math.max(0, Math.max(x0, lastX) - left) / TIMELINE.pps;
      setTimeSelection(Math.floor(s1 / step) * step, Math.ceil(s2 / step) * step);
    }
    renderTracks(true);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
