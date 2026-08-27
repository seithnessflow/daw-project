// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Transport, Ableton semantics (potion A1): Play starts from the insert
 * marker; Stop halts, Stop again returns to the marker.
 */

import { ctx, els, PROJECT_ID } from './context';
import { updateFollowUI } from './navigation';

/**
 * Garde de projet sur le TRANSPORT (2026-08-27, session de composition :
 * PLAY dans un onglet en desaccord jouait UN AUTRE MORCEAU - le bandeau
 * disait la verite mais le geste restait permis). Meme regle que
 * l'export : desaccord = refus VISIBLE (flash + raison), jamais un son
 * qui ne correspond pas a l'ecran.
 */
function transportRefusedByProjectGuard(): boolean {
  const enginePid = ctx.engineClient?.engineProjectId() ?? '';
  if (!enginePid || enginePid === PROJECT_ID) return false;
  const btn = els.playBtn;
  btn.classList.remove('refused');
  void btn.offsetWidth;
  btn.classList.add('refused');
  btn.title = `Le moteur joue « ${enginePid} », cet onglet montre `
    + `« ${PROJECT_ID} » : lire ici jouerait l'AUTRE morceau. `
    + 'Utiliser le bandeau pour rejoindre le projet du moteur.';
  document.getElementById('engine-status')?.classList.add('attention');
  setTimeout(() => document.getElementById('engine-status')
    ?.classList.remove('attention'), 2000);
  return true;
}

export function startPlayback(): void {
  if (!ctx.engineClient?.isConnected()) return;
  // L1c arbitration (2026-08-24): while listening to a jam the remote
  // stream IS the playback - the local transport stays suspended.
  if (ctx.jamListening) return;
  if (transportRefusedByProjectGuard()) return;
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
