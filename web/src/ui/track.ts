/**
 * Track UI components.
 */

import type { TrackDef } from '../document/schema';

/**
 * Create a track UI element.
 */
export function createTrackUI(
  track: TrackDef,
  onGainChange: (gain: number) => void
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
 * Format gain value for display.
 */
function formatGain(gain: number): string {
  if (gain === 0) return '-inf';
  const db = 20 * Math.log10(gain);
  return `${db.toFixed(1)} dB`;
}
