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
import { clipEndSamples } from '../document/geometry';
import { refreshTempoField } from './tempo_field';
import * as life from '../ui/life';
import { fillWaveforms } from '../ui/waveform';
import { ctx, els, sendLastChange } from './context';
import { updateInsertMarker, refreshOverview, updateGridVars } from './navigation';
import { refreshPalette } from './placement';
import { renderPresence } from './presence_view';
import { renderPianoRoll, pianoRollGestureActive } from '../ui/piano_roll';
import { renderSession } from '../ui/session';
import { renderMixer } from '../ui/mixer';
import { renderAutomationLanes } from '../ui/automation_lane';
import { cssId } from '../document/sanitize';
import { trackAcceptsMidi } from '../document/schema';
import { showRackTab } from './rack_tabs';
import { orderedTracks } from '../document/schema';
import { initTrackReorder } from './track_reorder';
import { initDeviceReorder } from './device_reorder';

/** Scroll du rack par piste (le piano-roll depasse le rack : voir render). */
const rackScroll = new Map<string, number>();

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
  // D1 : la delegation du reordonnement de pistes se pose UNE fois
  // (garde idempotente dans le module) - wiring.ts reste intouche.
  initTrackReorder();
  // D2 : idem pour le reordonnement des devices du rack.
  initDeviceReorder();
  const doc = ctx.project.getDocument();
  refreshTempoField();  // T3 : le registre suit le document (LWW)
  // D1 : l'ordre d'AFFICHAGE (order fractionnaire, source unique
  // orderedTracks) - doc.tracks garde l'ordre de creation.
  const shown = orderedTracks(doc);

  if (ctx.selectedTrackId === null ||
      !doc.tracks.some((t) => t.id === ctx.selectedTrackId)) {
    ctx.selectedTrackId = shown[0]?.id ?? null;
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
  // D2 : position-a-position par data-proc-id (pas un simple comptage) -
  // un reordre DISTANT de la chaine garde le meme nombre de devices et
  // doit quand meme casser sameStructure pour que le rack se replace
  // (jumeau exact du diff d'ordre des pistes ci-dessous).
  const deviceEls = Array.from(els.deviceViewSlot.querySelectorAll('.device'));
  const chainNow = selectedTrack?.chain ?? [];
  // D1 : la comparaison position-a-position se fait contre l'ordre
  // d'AFFICHAGE (shown) - un reordre distant change l'id attendu a une
  // position et casse sameStructure, donc declenche le rebuild qui
  // replace les pistes. Meme diff incremental qu'avant sinon.
  const sameStructure =
    !force &&
    existingEls.length === shown.length &&
    shown.every(
      (t, i) =>
        existingEls[i].getAttribute('data-track-id') === t.id &&
        existingEls[i].querySelectorAll('.clip').length === t.clips.length
    ) &&
    deviceEls.length === chainNow.length &&
    chainNow.every((p, i) => deviceEls[i].getAttribute('data-proc-id') === p.id);

  if (sameStructure) {
    for (const track of shown) {
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
      endSec = Math.max(endSec, clipEndSamples(c, doc) / sr);
    }
  }
  const laneSeconds = Math.ceil(endSec) + 5;

  els.tracks.appendChild(createRulerUI(laneSeconds, doc));

  for (const track of shown) {
    const element = createTrackUI(
      track, doc, sr, laneSeconds, track.id === ctx.selectedTrackId,
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

  // Selection de TEMPS (lasso, 2026-08-28) : une bande sur chaque lane,
  // la plage que Ctrl+D duplique - visible tant qu'elle existe.
  if (ctx.timeSelection) {
    const { startSec, endSec } = ctx.timeSelection;
    for (const lane of els.tracks.querySelectorAll<HTMLElement>('.track-lane')) {
      const band = document.createElement('div');
      band.className = 'time-sel';
      band.dataset.role = 'time-selection';
      band.style.left = `${startSec * TIMELINE.pps}px`;
      band.style.width = `${(endSec - startSec) * TIMELINE.pps}px`;
      lane.appendChild(band);
    }
  }
  updateInsertMarker();

  // Selection reflection (C1): the selected clip is unambiguous
  // 2026-08-28 : le LOT (clip_selection.ts) ; le principal en fait partie
  if (ctx.selectedClipId && !ctx.selectedClipIds.has(ctx.selectedClipId)) {
    ctx.selectedClipIds.add(ctx.selectedClipId);
  }
  for (const id of [...ctx.selectedClipIds]) {
    const el = els.tracks.querySelector(
      `[data-clip-id="${cssId(id)}"]`) as HTMLElement | null;
    if (el) el.setAttribute('aria-selected', 'true');
    else ctx.selectedClipIds.delete(id);
  }
  if (ctx.selectedClipId && !ctx.selectedClipIds.has(ctx.selectedClipId)) {
    ctx.selectedClipId = [...ctx.selectedClipIds].pop() ?? null;
  }

  // Device View for the selected track (bypass and params are DOCUMENT
  // state: the display only settles when the change comes back)
  // Le rack est le scroller du piano-roll : un re-rendu ne doit pas
  // ramener l'utilisateur en haut de la grille (le scroll se garde par
  // piste ; premiere ouverture = centre sur C4, ou l'on pose ses notes).
  const rackScrollKey = selectedTrack ? `rack:${selectedTrack.id}` : '';
  if (rackScrollKey) rackScroll.set(rackScrollKey, els.deviceViewSlot.scrollTop);
  // Un geste est en cours dans le piano-roll : le rack reste tel quel (un
  // echo reseau qui reconstruisait la grille tuait le glisser sous la
  // souris) ; le re-rendu vient en fin de geste (onChange).
  if (pianoRollGestureActive()) { finishRender(); return; }
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
  // Pistes typees : une piste AUDIO n'a ni piano-roll ni "+ clip MIDI".
  if (selectedTrack && trackAcceptsMidi(selectedTrack)) {
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
      showRackTab('piano');  // montrer l'editeur qu'on vient de remplir
    });
    head.appendChild(addBtn);
    slot.appendChild(head);
    if (midiClip) {
      const roll = document.createElement('div');
      renderPianoRoll(roll, ctx.project!, selectedTrack.id, midiClip, () => {
        sendLastChange();
        renderTracks(true);
      }, sendLastChange);  // pendant un glisser : pousser sans re-rendre
      slot.appendChild(roll);
    }
    els.deviceViewSlot.appendChild(slot);
    const saved = rackScroll.get(rackScrollKey);
    if (saved !== undefined && saved > 0) els.deviceViewSlot.scrollTop = saved;
    else if (midiClip && !rackScroll.has(rackScrollKey)) {
      const c4 = slot.querySelector<HTMLElement>('.pr-cell[data-pitch="60"][data-step="0"]');
      if (c4) {
        const top = c4.offsetTop - els.deviceViewSlot.clientHeight / 2;
        els.deviceViewSlot.scrollTop = Math.max(0, top);
        rackScroll.set(rackScrollKey, els.deviceViewSlot.scrollTop);
      }
    }
  }

  finishRender();
}

/** La fin d'un rendu (tout ce qui suit le rack) - aussi quand le rack
 *  est laisse en place pendant un geste du piano-roll. */
function finishRender(): void {
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
  // T7/T8 : la grille Session et la console Mixage suivent le doc. Cheap si cachees.
  renderSession();
  renderMixer();
  // A3 : les lanes d'automation decorent les .track frais (no-op si fermees)
  renderAutomationLanes();
}
