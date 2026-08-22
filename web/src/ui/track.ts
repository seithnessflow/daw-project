// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Track UI components.
 */

import type { TrackDef } from '../document/schema';

/** Timeline scale, shared by tracks, ruler and playhead (refonte lot 2). */
export const TIMELINE = {
  pps: 20,          // pixels per second
  headWidth: 260,   // sticky track-head column, px (mirrors CSS flex-basis)
};

/**
 * Create a track UI element: a sticky head (name, fader, chain, meter)
 * and a time lane where the document's clips are finally DRAWN.
 *
 * @param laneSeconds width of the time lane, in seconds (shared scale)
 */
export function createTrackUI(
  track: TrackDef,
  sampleRate: number,
  laneSeconds: number,
  onGainChange: (gain: number) => void,
  onBypassToggle?: (processorId: string, bypass: boolean) => void
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'track';
  el.dataset.trackId = track.id;
  const isEmpty = track.clips.length === 0 && track.chain.length === 0;
  if (isEmpty) el.classList.add('track-empty');

  const head = document.createElement('div');
  head.className = 'track-head';
  el.appendChild(head);

  // Title row: name + gain value
  const titleRow = document.createElement('div');
  titleRow.className = 'track-title-row';
  const nameEl = document.createElement('div');
  nameEl.className = 'track-name';
  nameEl.textContent = track.name;
  titleRow.appendChild(nameEl);
  head.appendChild(titleRow);

  // Fader
  const faderContainer = document.createElement('div');
  faderContainer.className = 'track-fader';

  const faderInput = document.createElement('input');
  faderInput.type = 'range';
  faderInput.min = '0';
  faderInput.max = '2';
  faderInput.step = '0.01';
  faderInput.value = track.gain.toString();
  // SELECTION CONTRACT (refonte prep, section 3): tests and helpers anchor
  // on data-role, never on the element type or a style class - a redesigned
  // fader keeps the contract, the pixels stay free. aria-label rides along:
  // the contract IS accessibility.
  faderInput.dataset.role = 'gain';
  faderInput.setAttribute('aria-label', `Gain ${track.name}`);

  const gainDisplay = document.createElement('span');
  gainDisplay.className = 'track-gain';
  gainDisplay.textContent = formatGain(track.gain);

  faderInput.addEventListener('input', () => {
    const gain = parseFloat(faderInput.value);
    gainDisplay.textContent = formatGain(gain);
    onGainChange(gain);
  });

  faderContainer.appendChild(faderInput);
  head.appendChild(faderContainer);
  titleRow.appendChild(gainDisplay);

  // Meter rides the fader row
  const meter = document.createElement('div');
  meter.className = 'track-meter';
  meter.id = `meter-${track.id}`;
  const meterFill = document.createElement('div');
  meterFill.className = 'track-meter-fill';
  meter.appendChild(meterFill);
  faderContainer.appendChild(meter);

  // Chain (2.4d): one row per processor with its bypass toggle. The
  // button reflects DOCUMENT state; a click asks for the opposite - the
  // display only settles when the change comes back through the doc.
  if (track.chain.length > 0) {
    const chainEl = document.createElement('div');
    chainEl.className = 'track-chain';
    for (const proc of track.chain) {
      const row = document.createElement('div');
      row.className = 'chain-node';
      row.dataset.procId = proc.id;

      const label = document.createElement('span');
      label.className = 'chain-node-type';
      label.textContent = proc.type;
      row.appendChild(label);

      const bypassBtn = document.createElement('button');
      bypassBtn.className = 'chain-bypass';
      bypassBtn.dataset.role = 'bypass';  // selection contract
      bypassBtn.dataset.procId = proc.id;
      bypassBtn.textContent = 'bypass';
      bypassBtn.setAttribute('aria-pressed', proc.bypass ? 'true' : 'false');
      bypassBtn.setAttribute('aria-label', `Bypass ${proc.type} ${track.name}`);
      bypassBtn.addEventListener('click', () => {
        const current = bypassBtn.getAttribute('aria-pressed') === 'true';
        onBypassToggle?.(proc.id, !current);
      });
      row.appendChild(bypassBtn);

      chainEl.appendChild(row);
    }
    head.appendChild(chainEl);
  }

  // The time lane: the document's clips, finally drawn to scale
  const lane = document.createElement('div');
  lane.className = 'track-lane';
  lane.style.width = `${laneSeconds * TIMELINE.pps}px`;
  for (const clip of track.clips) {
    const clipEl = document.createElement('div');
    clipEl.className = 'clip';
    clipEl.dataset.clipId = clip.id;
    clipEl.style.left = `${(clip.startSample / sampleRate) * TIMELINE.pps}px`;
    clipEl.style.width = `${Math.max(
      2, (clip.lengthSamples / sampleRate) * TIMELINE.pps)}px`;
    clipEl.textContent = clip.assetHash.slice(0, 8);
    clipEl.title = clip.assetHash;
    lane.appendChild(clipEl);
  }
  el.appendChild(lane);

  return el;
}

/**
 * Build the ruler row: sticky spacer + second ticks on the shared scale.
 */
export function createRulerUI(laneSeconds: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ruler-row';
  const spacer = document.createElement('div');
  spacer.className = 'ruler-spacer';
  spacer.textContent = 'tracks';
  row.appendChild(spacer);
  const ruler = document.createElement('div');
  ruler.className = 'ruler';
  ruler.style.width = `${laneSeconds * TIMELINE.pps}px`;
  for (let s = 0; s <= laneSeconds; s += 1) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick';
    tick.style.left = `${s * TIMELINE.pps}px`;
    if (s % 5 === 0) tick.textContent = `${s}s`;
    ruler.appendChild(tick);
  }
  row.appendChild(ruler);
  return row;
}

/**
 * Update a meter display.
 */
export function updateMeter(trackId: string, peak: number): void {
  const meter = document.getElementById(`meter-${trackId}`);
  if (!meter) return;

  const fill = meter.querySelector('.track-meter-fill') as HTMLElement;
  if (!fill) return;

  // Convert to percentage (clamp at 100%)
  const percent = Math.min(100, peak * 100);
  fill.style.width = `${percent}%`;
}

/**
 * Update an existing track's gain UI in place (no DOM rebuild).
 *
 * Skips the slider if the user is currently holding it: a remote peer's
 * concurrent drag must not fight the local hand.
 */
export function updateTrackGainUI(trackId: string, gain: number): void {
  const el = document.querySelector(`[data-track-id="${trackId}"]`);
  if (!el) return;

  const input = el.querySelector('[data-role="gain"]') as HTMLInputElement | null;
  if (input && document.activeElement !== input) {
    input.value = gain.toString();
  }

  const display = el.querySelector('.track-gain') as HTMLElement | null;
  if (display) {
    display.textContent = formatGain(gain);
  }
}

/**
 * Update a track's chain bypass states in place (no DOM rebuild) - the
 * bypass twin of updateTrackGainUI, for remote changes.
 */
export function updateTrackChainUI(trackId: string, chain: TrackDef['chain']): void {
  const el = document.querySelector(`[data-track-id="${trackId}"]`);
  if (!el) return;
  for (const proc of chain) {
    const btn = el.querySelector(
      `[data-role="bypass"][data-proc-id="${proc.id}"]`
    ) as HTMLElement | null;
    if (btn) {
      btn.setAttribute('aria-pressed', proc.bypass ? 'true' : 'false');
    }
  }
}

/**
 * Format gain value for display.
 */
function formatGain(gain: number): string {
  if (gain === 0) return '-inf';
  const db = 20 * Math.log10(gain);
  return `${db.toFixed(1)} dB`;
}
