// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Vue Mixage (Refonte T8) : une console reelle - une tranche par piste. VU
 * (alimente par onMeters, data-track-id), fader (reutilise setTrackGain),
 * M/S (reutilise engineClient.setMonitor), + une tranche MASTER. Le pan et
 * les departs/bus = extensions de schema (T8b). Reutilise au maximum.
 */

import { ctx, sendLastChange, els } from './../app/context';
import { renderTracks } from './../app/render';
import { trackHue, formatGain } from './track';

const fmtPan = (p: number): string =>
  p === 0 ? 'C' : p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}`;

function strip(
  id: string, name: string, hue: number, gain: number,
  onGain: (g: number) => void, mono?: { mute: boolean; solo: boolean },
  onMon?: (kind: 'mute' | 'solo', on: boolean) => void,
  pan?: number, onPan?: (p: number) => void,
): HTMLElement {
  const s = document.createElement('div');
  s.className = 'mx-strip';
  s.style.setProperty('--hue', String(hue));
  const nm = document.createElement('div');
  nm.className = 'mx-name';
  nm.textContent = name;
  const vu = document.createElement('div');
  vu.className = 'mx-vu';
  vu.dataset.trackId = id;
  vu.append(document.createElement('i'), document.createElement('i'));
  const body = document.createElement('div');
  body.className = 'mx-body';
  const fader = document.createElement('input');
  fader.type = 'range'; fader.min = '0'; fader.max = '2'; fader.step = '0.01';
  fader.value = String(gain); fader.className = 'mx-fader';
  fader.setAttribute('orient', 'vertical');
  fader.addEventListener('input', () => onGain(parseFloat(fader.value)));
  body.append(vu, fader);
  const db = document.createElement('div');
  db.className = 'mx-db';
  db.textContent = formatGain(gain);
  const ms = document.createElement('div');
  ms.className = 'mx-ms';
  if (mono && onMon) {
    for (const kind of ['mute', 'solo'] as const) {
      const btn = document.createElement('button');
      btn.className = `mx-${kind}`;
      btn.textContent = kind === 'mute' ? 'M' : 'S';
      btn.setAttribute('aria-pressed', mono[kind] ? 'true' : 'false');
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        onMon(kind, on);
      });
      ms.appendChild(btn);
    }
  }
  // F2 : pan au-dessus du fader (convention console). Absent pour le master
  // (sortie stereo, pas de pan). Double-clic = recentrer.
  s.append(nm, ms);
  if (onPan) {
    const panRow = document.createElement('div');
    panRow.className = 'mx-pan';
    const pv = document.createElement('span');
    pv.className = 'mx-pan-val';
    pv.textContent = fmtPan(pan ?? 0);
    const pin = document.createElement('input');
    pin.type = 'range'; pin.min = '-1'; pin.max = '1'; pin.step = '0.02';
    pin.value = String(pan ?? 0); pin.className = 'mx-pan-slider';
    pin.dataset.trackId = id;
    pin.setAttribute('aria-label', `Pan ${name}`);
    pin.addEventListener('input', () => {
      pv.textContent = fmtPan(parseFloat(pin.value));
      onPan(parseFloat(pin.value));
    });
    pin.addEventListener('dblclick', () => {
      pin.value = '0'; pv.textContent = 'C'; onPan(0);
    });
    panRow.append(pv, pin);
    s.append(panRow);
  }
  s.append(body, db);
  return s;
}

export function renderMixer(): void {
  const slot = document.getElementById('mixer-slot');
  if (!slot || !ctx.project) return;
  const doc = ctx.project.getDocument();
  const mon = ctx.engineClient?.monitorSnapshot?.() ?? {};
  slot.replaceChildren();
  const console_ = document.createElement('div');
  console_.className = 'mx-console';

  for (const t of doc.tracks) {
    const m = (mon as Record<string, { mute?: boolean; solo?: boolean }>)[t.id] ?? {};
    console_.appendChild(strip(
      t.id, t.name, trackHue(t.id), t.gain,
      (g) => { ctx.project!.setTrackGain(t.id, g); sendLastChange(); renderTracks(); },
      { mute: !!m.mute, solo: !!m.solo },
      (kind, on) => ctx.engineClient?.setMonitor(
        t.id, kind === 'solo' ? on : undefined, kind === 'mute' ? on : undefined),
      t.pan ?? 0,
      (p) => { ctx.project!.setTrackPan(t.id, p); sendLastChange(); renderTracks(); },
    ));
  }
  // Tranche MASTER (reutilise le master gain de la command bar)
  const master = strip(
    '__master__', 'MASTER', 0,
    typeof doc.masterGain === 'number' ? doc.masterGain : 1,
    (g) => { els.masterGain.value = String(g); els.masterGain.dispatchEvent(new Event('input')); });
  master.classList.add('mx-master');
  console_.appendChild(master);

  slot.appendChild(console_);
}
