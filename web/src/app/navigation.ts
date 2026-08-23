// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Navigation (potion A1/A2): zoom around anchors, fit, snap grid,
 * insert marker, overview refresh. Cross-import with render.ts is a
 * CONTROLLED cycle: every cross-use is inside a function body (deferred),
 * never at module top level.
 */

import { TIMELINE } from '../ui/track';
import { ctx, els, ZOOM_MIN, ZOOM_MAX } from './context';
import { renderTracks } from './render';

let zoomRaf = 0;
let overviewRaf = 0;

export function contentSeconds(): number {
  const doc = ctx.project?.getDocument();
  let end = 30;
  if (doc) {
    const sr = doc.sampleRate || 48000;
    for (const t of doc.tracks) {
      for (const c of t.clips) {
        end = Math.max(end, (c.startSample + c.lengthSamples) / sr);
      }
    }
  }
  return Math.ceil(end) + 5;
}

/** Zoom to newPps keeping anchorSec at the same viewport x. */
export function setZoom(newPps: number, anchorSec: number, anchorViewportX: number): void {
  const pps = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newPps));
  if (pps === TIMELINE.pps) return;
  TIMELINE.pps = pps;
  ctx.followPaused = true;
  updateFollowUI();
  updateGridVars();
  if (zoomRaf) return;               // coalesce zoom ticks to one render
  zoomRaf = requestAnimationFrame(() => {
    zoomRaf = 0;
    renderTracks(true);
    ctx.programmaticScroll = true;
    els.tracks.scrollLeft =
      Math.max(0, anchorSec * TIMELINE.pps - (anchorViewportX - TIMELINE.headWidth));
  });
}

export function fitAll(): void {
  const rect = els.tracks.getBoundingClientRect();
  const fit = (rect.width - TIMELINE.headWidth - 20) / contentSeconds();
  setZoom(fit, 0, TIMELINE.headWidth);
}

/** Snap grid step in seconds, refined as the zoom deepens. */
export function snapStep(): number {
  const pps = TIMELINE.pps;
  if (pps >= 80) return 0.0625;
  if (pps >= 40) return 0.125;
  if (pps >= 10) return 0.25;
  return 0.5;
}

/**
 * V1.4: publish the grid pitches as CSS vars - the lanes DRAW the snap
 * rule (fine = snapStep, strong = one second), refined with the zoom.
 */
export function updateGridVars(): void {
  els.tracks.style.setProperty('--grid-fine-px', `${snapStep() * TIMELINE.pps}px`);
  els.tracks.style.setProperty('--grid-sec-px', `${TIMELINE.pps}px`);
}

/**
 * V1.4: the follow button SAYS when follow is paused (scroll/zoom/edit)
 * - the third silent effect of the lane click, now announced.
 */
export function updateFollowUI(): void {
  const btn = document.getElementById('follow-btn');
  if (!btn) return;
  btn.classList.toggle('follow-paused', ctx.followPaused);
  btn.setAttribute('title', ctx.followPaused
    ? 'Follow en pause (scroll/zoom/edition) - clic pour reprendre'
    : 'Follow playhead');
}

export function updateInsertMarker(): void {
  const marker = document.getElementById('insert-marker');
  if (marker) {
    marker.style.left = `${TIMELINE.headWidth + ctx.insertMarkerSec * TIMELINE.pps}px`;
  }
  refreshOverview();
}

/** Redraw the overview strip (rAF-coalesced; cheap canvas pass). */
export function refreshOverview(): void {
  if (!ctx.overview || !ctx.project || overviewRaf) return;
  overviewRaf = requestAnimationFrame(() => {
    overviewRaf = 0;
    if (!ctx.overview || !ctx.project) return;
    const doc = ctx.project.getDocument();
    const viewStart = Math.max(0, els.tracks.scrollLeft / TIMELINE.pps);
    const viewEnd = viewStart +
      (els.tracks.clientWidth - TIMELINE.headWidth) / TIMELINE.pps;
    ctx.overview.render(doc, contentSeconds(), viewStart, viewEnd,
      ctx.lastPlayheadSec, ctx.insertMarkerSec);
  });
}
