// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Track UI components.
 */

import type { TrackDef } from '../document/schema';

/**
 * Create a track UI element.
 */
export function createTrackUI(
  track: TrackDef,
  onGainChange: (gain: number) => void,
  onBypassToggle?: (processorId: string, bypass: boolean) => void
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'track';
  el.dataset.trackId = track.id;

  // Track name
  const nameEl = document.createElement('div');
  nameEl.className = 'track-name';
  nameEl.textContent = track.name;
  el.appendChild(nameEl);

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
  faderContainer.appendChild(gainDisplay);
  el.appendChild(faderContainer);

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
    el.appendChild(chainEl);
  }

  // Meter
  const meter = document.createElement('div');
  meter.className = 'track-meter';
  meter.id = `meter-${track.id}`;

  const meterFill = document.createElement('div');
  meterFill.className = 'track-meter-fill';
  meter.appendChild(meterFill);

  el.appendChild(meter);

  return el;
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
