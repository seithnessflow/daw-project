// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Render: tracks + Device View from the project document.
 *
 * Same structure -> update gains/bypass/params in place (a full rebuild
 * on every received change would thrash the DOM and yank sliders out of
 * the local user's hand). `force` rebuilds regardless (track selection).
 */

import {
  createTrackUI,
  createRulerUI,
  createDeviceView,
  updateTrackGainUI,
  updateDeviceViewUI,
  TIMELINE,
} from '../ui/track';
import * as life from '../ui/life';
import { fillWaveforms } from '../ui/waveform';
import { ctx, els, sendLastChange } from './context';
import { updateInsertMarker, refreshOverview } from './navigation';
import { refreshPalette } from './placement';
import { cssId } from '../document/sanitize';

export function renderTracks(force = false): void {
  if (!ctx.project) return;
  const doc = ctx.project.getDocument();

  if (ctx.selectedTrackId === null ||
      !doc.tracks.some((t) => t.id === ctx.selectedTrackId)) {
    ctx.selectedTrackId = doc.tracks[0]?.id ?? null;
  }
  const selectedTrack =
    doc.tracks.find((t) => t.id === ctx.selectedTrackId) ?? null;

  const existingEls = Array.from(els.tracks.querySelectorAll('[data-track-id]'));
  const deviceCount = els.deviceViewSlot.querySelectorAll('.device').length;
  const sameStructure =
    !force &&
    existingEls.length === doc.tracks.length &&
    doc.tracks.every(
      (t, i) =>
        existingEls[i].getAttribute('data-track-id') === t.id &&
        existingEls[i].querySelectorAll('.clip').length === t.clips.length
    ) &&
    deviceCount === (selectedTrack?.chain.length ?? 0);

  if (sameStructure) {
    for (const track of doc.tracks) {
      updateTrackGainUI(track.id, track.gain);
    }
    if (selectedTrack) updateDeviceViewUI(selectedTrack.chain);
    return;
  }

  els.tracks.innerHTML = '';

  // Shared time scale: the longest clip end, with margin (min 35 s)
  const sr = doc.sampleRate || 48000;
  let endSec = 30;
  for (const t of doc.tracks) {
    for (const c of t.clips) {
      endSec = Math.max(endSec, (c.startSample + c.lengthSamples) / sr);
    }
  }
  const laneSeconds = Math.ceil(endSec) + 5;

  els.tracks.appendChild(createRulerUI(laneSeconds));

  for (const track of doc.tracks) {
    const element = createTrackUI(
      track, sr, laneSeconds, track.id === ctx.selectedTrackId,
      (gain) => {
        ctx.project!.setTrackGain(track.id, gain);
        sendLastChange();
      },
      (kind, on) => {
        // Engine-local monitoring (not document state)
        ctx.engineClient?.setMonitor(track.id,
          kind === 'solo' ? on : undefined, kind === 'mute' ? on : undefined);
        // Solo makes the view breathe: the rest dims (life layer)
        if (ctx.engineClient) {
          life.applyMonitorShade(ctx.engineClient.monitorSnapshot());
        }
      },
    );
    els.tracks.appendChild(element);
  }

  // One playhead across ruler and every lane (moved by onPosition)
  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  playhead.id = 'playhead';
  playhead.style.left = `${TIMELINE.headWidth}px`;
  els.tracks.appendChild(playhead);

  // The insert marker (potion A1): where Play starts from
  const marker = document.createElement('div');
  marker.className = 'insert-marker';
  marker.id = 'insert-marker';
  els.tracks.appendChild(marker);
  updateInsertMarker();

  // Selection reflection (C1): the selected clip is unambiguous
  if (ctx.selectedClipId) {
    const el = els.tracks.querySelector(
      `[data-clip-id="${cssId(ctx.selectedClipId)}"]`) as HTMLElement | null;
    if (el) el.setAttribute('aria-selected', 'true');
    else ctx.selectedClipId = null;
  }

  // Device View for the selected track (bypass and params are DOCUMENT
  // state: the display only settles when the change comes back)
  els.deviceViewSlot.innerHTML = '';
  els.deviceViewSlot.appendChild(createDeviceView(
    selectedTrack,
    (procId, bypass) => {
      ctx.project!.setProcessorBypass(ctx.selectedTrackId!, procId, bypass);
      sendLastChange();
      renderTracks();
    },
    (procId, key, value) => {
      ctx.project!.setProcessorParam(ctx.selectedTrackId!, procId, key, value);
      sendLastChange();
    },
  ));

  // Waveforms inside the freshly built clips (cached peaks draw
  // synchronously; new assets stream in from the store)
  fillWaveforms(els.tracks);
  refreshOverview();
  refreshPalette();
  if (ctx.engineClient) {
    life.applyMonitorShade(ctx.engineClient.monitorSnapshot());
  }
}
