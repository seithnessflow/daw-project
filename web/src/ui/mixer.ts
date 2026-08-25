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

function strip(
  id: string, name: string, hue: number, gain: number,
  onGain: (g: number) => void, mono?: { mute: boolean; solo: boolean },
  onMon?: (kind: 'mute' | 'solo', on: boolean) => void,
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
  s.append(nm, ms, body, db);
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
