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
  formatGain,
  TIMELINE,
} from '../ui/track';
import * as life from '../ui/life';
import { fillWaveforms } from '../ui/waveform';
import { ctx, els, sendLastChange } from './context';
import { updateInsertMarker, refreshOverview, updateGridVars } from './navigation';
import { refreshPalette } from './placement';
import { renderPresence } from './presence_view';
import { renderPianoRoll } from '../ui/piano_roll';
import { renderSession } from '../ui/session';
import { cssId } from '../document/sanitize';

/**
 * V1.6: remote fade changes settle IN PLACE (the same-structure path
 * rebuilds nothing - without this, a peer's fade never showed).
 */
function updateClipFadesUI(track: { id: string; clips: Array<{
  id: string; fadeInSamples?: number; fadeOutSamples?: number }> },
  sampleRate: number): void {
  for (const clip of track.clips) {
    const el = els.tracks.querySelector(
      `[data-clip-id="${cssId(clip.id)}"]`) as HTMLElement | null;
    if (!el) continue;
    for (const side of ['in', 'out'] as const) {
      const samples = (side === 'in' ? clip.fadeInSamples : clip.fadeOutSamples) ?? 0;
      const px = (samples / sampleRate) * TIMELINE.pps;
      const shade = el.querySelector(`.clip-fade-${side}`) as HTMLElement | null;
      if (shade) shade.style.width = `${px}px`;
      const handle = el.querySelector(`.fade-handle-${side}`) as HTMLElement | null;
      if (handle) {
        if (side === 'in') handle.style.left = `${px}px`;
        else handle.style.right = `${px}px`;
      }
    }
  }
}

export function renderTracks(force = false): void {
  if (!ctx.project) return;
  const doc = ctx.project.getDocument();

  if (ctx.selectedTrackId === null ||
      !doc.tracks.some((t) => t.id === ctx.selectedTrackId)) {
    ctx.selectedTrackId = doc.tracks[0]?.id ?? null;
  }
  const selectedTrack =
    doc.tracks.find((t) => t.id === ctx.selectedTrackId) ?? null;

  // Presence: the local selection is the single funnel here, so tell the
  // multiplayer layer from one place (idempotent - only broadcasts on change).
  ctx.presence?.setSelection(ctx.selectedTrackId);

  // V1.4: the snap grid vars follow the zoom (lanes draw the rule)
  updateGridVars();

  // V1.2: master strip follows the document (remote moves converge) -
  // never fight the hand currently on the fader.
  const masterGain = typeof doc.masterGain === 'number' ? doc.masterGain : 1;
  if (document.activeElement !== els.masterGain) {
    els.masterGain.value = String(masterGain);
  }
  els.masterDb.textContent = formatGain(masterGain);

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
      updateClipFadesUI(track, doc.sampleRate || 48000);
    }
    if (selectedTrack) updateDeviceViewUI(selectedTrack.chain);
    if (ctx.presence) renderPresence(ctx.presence);
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
    // V1.4: a NEWLY selected track flashes once (announce, not a state)
    if (track.id === ctx.selectedTrackId &&
        ctx.lastFlashedTrackId !== ctx.selectedTrackId) {
      element.classList.add('just-selected');
      ctx.lastFlashedTrackId = ctx.selectedTrackId;
    }
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
    // V1.5: add/remove devices (document ops, undo-journaled)
    (proc) => {
      ctx.project!.addProcessor(ctx.selectedTrackId!, proc);
      sendLastChange();
      renderTracks(true);
    },
    (procId) => {
      ctx.project!.removeProcessor(ctx.selectedTrackId!, procId);
      sendLastChange();
      renderTracks(true);
    },
  ));

  // v8 MIDI : piano-roll pour le clip MIDI de la piste (assetHash vide = MIDI).
  // Bouton "+ clip MIDI" si la piste n'en a pas ; sinon la grille du premier.
  if (selectedTrack) {
    const midiClip = selectedTrack.clips.find((c) => !c.assetHash);
    const slot = document.createElement('div');
    slot.className = 'piano-roll-slot';
    const head = document.createElement('div');
    head.className = 'piano-roll-head';
    head.textContent = 'PIANO-ROLL';
    const addBtn = document.createElement('button');
    addBtn.className = 'midi-add-btn';
    addBtn.dataset.role = 'add-midi';
    addBtn.textContent = midiClip ? '+ autre clip' : '+ clip MIDI';
    addBtn.addEventListener('click', () => {
      ctx.project!.addMidiClip(selectedTrack.id, 0, 96000);  // 2 s @48k
      sendLastChange();
      renderTracks(true);
    });
    head.appendChild(addBtn);
    slot.appendChild(head);
    if (midiClip) {
      const roll = document.createElement('div');
      renderPianoRoll(roll, ctx.project!, selectedTrack.id, midiClip, () => {
        sendLastChange();
        renderTracks(true);
      });
      slot.appendChild(roll);
    }
    els.deviceViewSlot.appendChild(slot);
  }

  // Waveforms inside the freshly built clips (cached peaks draw
  // synchronously; new assets stream in from the store)
  fillWaveforms(els.tracks);
  refreshOverview();
  refreshPalette();
  if (ctx.engineClient) {
    life.applyMonitorShade(ctx.engineClient.monitorSnapshot());
  }
  // Heads were just rebuilt - re-place the remote-selection flags on them.
  if (ctx.presence) renderPresence(ctx.presence);
  // T7 : la grille Session suit le doc (slots, scenes). Cheap si cachee.
  renderSession();
}
