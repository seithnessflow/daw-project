// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Clip gestures (potion C1/C2): drag by the title bar, resize by the
 * 6px edges - snapped to the zoom-refined grid AND neighbor edges,
 * Alt = free. Coalescing: at most one document write per animation
 * frame during a gesture, a final one on release (the fader's road).
 */

import { TIMELINE } from '../ui/track';
import { ctx, sendLastChange } from './context';
import { snapStep } from './navigation';
import { renderTracks } from './render';
import { cssId } from '../document/sanitize';

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
  const edges: number[] = [];
  for (const c of track.clips) {
    if (c.id === clipId) continue;
    edges.push(c.startSample / sr, (c.startSample + c.lengthSamples) / sr);
  }

  const startX = e.clientX;
  const origSec = clip.startSample / sr;
  let moved = false;
  let pendingSec = origSec;
  let writeRaf = 0;
  e.preventDefault();

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;    // click, not yet a drag
    if (!moved) ctx.project!.beginUndoGroup(); // V1.3: one gesture = one undo
    moved = true;
    clipEl.classList.add('dragging');
    let sec = Math.max(0, origSec + dx / TIMELINE.pps);
    if (!ev.altKey) {
      const step = snapStep();
      let snapped = Math.round(sec / step) * step;
      // Neighbor edges win within 8 px
      for (const edge of edges) {
        if (Math.abs(sec - edge) * TIMELINE.pps < 8) { snapped = edge; break; }
      }
      sec = Math.max(0, snapped);
    }
    clipEl.style.left = `${sec * TIMELINE.pps}px`;
    pendingSec = sec;
    if (!writeRaf) {
      writeRaf = requestAnimationFrame(() => {
        writeRaf = 0;
        ctx.project!.setClipStart(trackId, clipId, pendingSec * sr);
        sendLastChange();
      });
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (writeRaf) cancelAnimationFrame(writeRaf);
    clipEl.classList.remove('dragging');
    if (moved) {
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      ctx.project!.setClipStart(trackId, clipId, pendingSec * sr);
      ctx.project!.endUndoGroup();  // V1.3
      sendLastChange();
      renderTracks(true);
    } else {
      // A plain click on the title bar: select the clip (and its track)
      ctx.selectedClipId = clipId;
      ctx.selectedTrackId = trackId;
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
    edges.push(c.startSample / sr, (c.startSample + c.lengthSamples) / sr);
  }

  const startX = e.clientX;
  const orig = {
    start: clip.startSample / sr,
    length: clip.lengthSamples / sr,
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
    let snapped = Math.round(sec / step) * step;
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
      ctx.selectedClipId = clipId;
      ctx.selectedTrackId = trackId;
      ctx.justDragged = true;
      setTimeout(() => { ctx.justDragged = false; }, 0);
      renderTracks(true);
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
