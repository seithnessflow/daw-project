// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Navigation (potion A1/A2): zoom around anchors, fit, snap grid,
 * insert marker, overview refresh. Cross-import with render.ts is a
 * CONTROLLED cycle: every cross-use is inside a function body (deferred),
 * never at module top level.
 */

import { TIMELINE } from '../ui/track';
import { clipEndSamples, sampleToTick, tickToSample }
  from '../document/geometry';
import type { ProjectDef } from '../document/schema';
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
        end = Math.max(end, clipEndSamples(c, doc) / sr);
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
 * T3 : le pas de grille MUSICAL (ticks, PPQ 960) par zoom - le miroir
 * exact des paliers de snapStep : a 120 BPM les deux grilles
 * COINCIDENT (120 ticks = 0,0625 s), aux autres tempos la grille
 * musicale gouverne les objets musicaux.
 */
export function snapTickStep(): number {
  const pps = TIMELINE.pps;
  if (pps >= 80) return 120;   // double-croche/2
  if (pps >= 40) return 240;   // double-croche
  if (pps >= 10) return 480;   // croche
  return 960;                  // noire
}

/**
 * T3 : snap MUSICAL d'une cible de geste (secondes -> tick le plus
 * proche sur la grille snapTickStep -> secondes). Pour les clips
 * musicaux uniquement - l'absolu garde la grille en secondes.
 */
export function snapSecMusical(doc: ProjectDef, sec: number): number {
  const sr = doc.sampleRate || 48000;
  const step = snapTickStep();
  const tick = Math.max(0,
    Math.round(sampleToTick(doc, sec * sr) / step) * step);
  return tickToSample(doc, tick) / sr;
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
