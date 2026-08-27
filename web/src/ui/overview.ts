// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The Overview (potion A2) — Ableton's master navigation piece: the
 * whole project as a miniature strip, always visible. Drag horizontally
 * to scroll, drag vertically to zoom (anchored where the drag started),
 * double-click to fit everything. The frame shows the current window.
 *
 * Pure UI: draws from the document + view state it is HANDED; it owns
 * no truth. Contract: #overview canvas, [data-role="overview"].
 */

import type { ProjectDef } from '../document/schema';
import { orderedTracks } from '../document/schema';
import { clipStartSamples, clipLengthSamples } from '../document/geometry';
import { trackHue } from './track';

export interface OverviewCallbacks {
  /** Center the main view on this content time (seconds). */
  onScrollTo: (sec: number) => void;
  /** Multiply zoom by factor, anchored at sec. */
  onZoom: (factor: number, anchorSec: number) => void;
  /** Fit the whole content in the view (double-click). */
  onFit: () => void;
}

const HEIGHT = 36;

export class Overview {
  readonly element: HTMLCanvasElement;
  private cb: OverviewCallbacks;
  private contentSec = 35;
  private dragging = false;
  private dragStartY = 0;
  private dragStartSec = 0;
  private lastDy = 0;

  constructor(cb: OverviewCallbacks) {
    this.cb = cb;
    this.element = document.createElement('canvas');
    this.element.id = 'overview';
    this.element.dataset.role = 'overview';
    this.element.height = HEIGHT;
    this.element.className = 'overview';

    this.element.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragStartY = e.clientY;
      this.lastDy = 0;
      this.dragStartSec = this.xToSec(e);
      this.element.setPointerCapture(e.pointerId);
      this.cb.onScrollTo(this.dragStartSec);
    });
    this.element.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dy = e.clientY - this.dragStartY;
      const dyStep = dy - this.lastDy;
      if (Math.abs(dyStep) >= 8) {
        // Vertical drag = zoom around the grab point (up = in, down = out)
        this.cb.onZoom(dyStep < 0 ? 1.2 : 1 / 1.2, this.dragStartSec);
        this.lastDy = dy;
      } else if (Math.abs(dy) < 8) {
        // Horizontal drag = scroll (center the view on the cursor)
        this.cb.onScrollTo(this.xToSec(e));
      }
    });
    this.element.addEventListener('pointerup', (e) => {
      this.dragging = false;
      this.element.releasePointerCapture(e.pointerId);
    });
    this.element.addEventListener('dblclick', () => this.cb.onFit());
  }

  private xToSec(e: PointerEvent): number {
    const rect = this.element.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return frac * this.contentSec;
  }

  /**
   * Redraw. viewStart/viewEnd = the main view's window in content
   * seconds; playheadSec / markerSec in seconds (negative = hidden).
   */
  render(
    doc: ProjectDef,
    contentSec: number,
    viewStartSec: number,
    viewEndSec: number,
    playheadSec: number,
    markerSec: number,
  ): void {
    this.contentSec = contentSec;
    const w = this.element.clientWidth;
    if (w === 0) return;
    if (this.element.width !== w) this.element.width = w;
    const h = HEIGHT;
    const ctx = this.element.getContext('2d');
    if (!ctx) return;
    const sx = w / contentSec;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 0, w, h);

    // Tracks as thin rows, clips as colored blocks
    // D1 : la minimap suit l'ordre d'AFFICHAGE (orderedTracks), comme
    // l'arrangement - sinon un reordre desynchronise les deux vues.
    const sr = doc.sampleRate || 48000;
    const shown = orderedTracks(doc);
    const rows = Math.max(1, shown.length);
    const rowH = Math.max(2, Math.min(6, (h - 4) / rows));
    shown.forEach((t, i) => {
      const y = 2 + i * rowH;
      if (y + rowH > h - 2) return;  // beyond the strip: elided
      const hue = trackHue(t.id);
      ctx.fillStyle = `hsl(${hue}, 45%, 48%)`;
      for (const c of t.clips) {
        const x = (clipStartSamples(c, doc) / sr) * sx;
        const cw = Math.max(1, (clipLengthSamples(c, doc) / sr) * sx);
        ctx.fillRect(x, y, cw, rowH - 1);
      }
    });

    // Insert marker
    if (markerSec >= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(markerSec * sx, 0, 1, h);
    }
    // Playhead
    if (playheadSec >= 0) {
      ctx.fillStyle = '#d9a441';
      ctx.fillRect(playheadSec * sx, 0, 1, h);
    }
    // Window frame
    const fx = Math.max(0, viewStartSec * sx);
    const fw = Math.max(6, (viewEndSec - viewStartSec) * sx);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(fx + 0.5, 0.5, Math.min(fw, w - fx) - 1, h - 1);
  }
}
