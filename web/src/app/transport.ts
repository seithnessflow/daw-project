// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Transport, Ableton semantics (potion A1): Play starts from the insert
 * marker; Stop halts, Stop again returns to the marker.
 */

import { ctx } from './context';
import { updateFollowUI } from './navigation';

export function startPlayback(): void {
  if (!ctx.engineClient?.isConnected()) return;
  // L1c arbitration (2026-08-24): while listening to a jam the remote
  // stream IS the playback - the local transport stays suspended.
  if (ctx.jamListening) return;
  const sr = ctx.project?.getDocument().sampleRate || 48000;
  ctx.engineClient.seek(Math.round(ctx.insertMarkerSec * sr));
  ctx.engineClient.play();
  // L1b: PLAY here = PLAY there (anchor broadcast; no-op when SYNC off)
  ctx.transportSync?.publish(true, ctx.insertMarkerSec);
  ctx.followPaused = false;          // Follow resumes on restart (Ableton)
  updateFollowUI();
}

export function stopPlayback(): void {
  if (!ctx.engineClient?.isConnected()) return;
  const sr = ctx.project?.getDocument().sampleRate || 48000;
  if (ctx.engineClient.isPlaying()) {
    ctx.engineClient.stop();         // 1st stop: halt where you are
    ctx.transportSync?.publish(false, Math.max(0, ctx.lastPlayheadSec));
  } else {
    ctx.engineClient.seek(Math.round(ctx.insertMarkerSec * sr));  // 2nd: come home
    ctx.transportSync?.publish(false, ctx.insertMarkerSec);
  }
}
