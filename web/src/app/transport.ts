// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Transport, Ableton semantics (potion A1): Play starts from the insert
 * marker; Stop halts, Stop again returns to the marker.
 */

import { ctx } from './context';

export function startPlayback(): void {
  if (!ctx.engineClient?.isConnected()) return;
  const sr = ctx.project?.getDocument().sampleRate || 48000;
  ctx.engineClient.seek(Math.round(ctx.insertMarkerSec * sr));
  ctx.engineClient.play();
  ctx.followPaused = false;          // Follow resumes on restart (Ableton)
}

export function stopPlayback(): void {
  if (!ctx.engineClient?.isConnected()) return;
  const sr = ctx.project?.getDocument().sampleRate || 48000;
  if (ctx.engineClient.isPlaying()) {
    ctx.engineClient.stop();         // 1st stop: halt where you are
  } else {
    ctx.engineClient.seek(Math.round(ctx.insertMarkerSec * sr));  // 2nd: come home
  }
}
