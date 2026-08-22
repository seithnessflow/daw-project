// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * THE LIFE LAYER (Magic Potion phase 2) — the software reads itself and
 * shows it. Read-only, rAF-driven, direct DOM mutation. It reads two
 * sources that already exist (engine telemetry + cached asset peaks)
 * and WRITES NOWHERE — no document API is even imported here; a grep
 * proves it at every session close.
 *
 * Rules:
 * - everything it creates is aria-hidden + pointer-events:none: the
 *   harness cannot see it, the mouse cannot touch it;
 * - budget: one rAF loop, ~0 when the transport is stopped and every
 *   level has decayed; suspended when the tab is hidden (rAF does that);
 * - engine absent -> everything rests at zero, calmly.
 *
 * VU ballistics: instant rise, ~300 ms decay, 1 s peak hold — the
 * ballistics are what make meters organic instead of jittery numbers.
 */

import { getPeaksEntry } from './waveform';
import { TIMELINE } from './track';

interface TrackState {
  target: number;   // last telemetry value (0..1+)
  shown: number;    // ballistic display value
  peak: number;     // held peak
  peakAt: number;   // ms timestamp of the held peak
  hot: boolean;     // > -1 dBFS threshold (the ear's threshold)
}

const DECAY_PER_MS = 1 / 300;   // full-scale decay in ~300 ms
const PEAK_HOLD_MS = 1000;
const HOT_LINEAR = Math.pow(10, -1 / 20);  // -1 dBFS

const tracks = new Map<string, TrackState>();
let playing = false;
let positionSec = 0;
let rafId = 0;
let lastTs = 0;
let silentSinceMs = 0;
let lastBlocksMissed = -1;
let missedFlashUntil = 0;

let statusEl: HTMLElement | null = null;

function ensureStatusEl(): HTMLElement {
  if (!statusEl || !statusEl.isConnected) {
    statusEl = document.getElementById('life-status');
    if (!statusEl) {
      statusEl = document.createElement('span');
      statusEl.id = 'life-status';
    }
    statusEl.setAttribute('aria-hidden', 'true');
    statusEl.style.pointerEvents = 'none';
  }
  return statusEl;
}

/** Telemetry meters in (called ~30 Hz by the network layer). */
export function setTrackLevels(meters: { trackId: string; peak: number }[]): void {
  // read-only debug surface (probes): the last raw frame, timestamped
  (window as unknown as Record<string, unknown>).__lifeLastMeters =
    { at: performance.now(), meters };
  for (const m of meters) {
    let s = tracks.get(m.trackId);
    if (!s) {
      s = { target: 0, shown: 0, peak: 0, peakAt: 0, hot: false };
      tracks.set(m.trackId, s);
    }
    s.target = m.peak;
  }
  wake();
}

export function setPosition(sec: number, isPlaying: boolean): void {
  positionSec = sec;
  playing = isPlaying;
  if (isPlaying) wake();
}

/** EngineState in: the plugin child's missed blocks flash discreetly. */
export function setEngineState(blocksMissed: number): void {
  if (lastBlocksMissed >= 0 && blocksMissed > lastBlocksMissed) {
    missedFlashUntil = performance.now() + 1200;
    wake();
  }
  lastBlocksMissed = blocksMissed;
}

function wake(): void {
  if (!rafId) {
    lastTs = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function tick(ts: number): void {
  rafId = 0;
  const dt = Math.min(100, ts - lastTs);
  lastTs = ts;
  let alive = false;

  // ---- VU ballistics + hot glow ----
  for (const [trackId, s] of tracks) {
    // instant rise, timed decay
    if (s.target > s.shown) s.shown = s.target;
    else s.shown = Math.max(0, s.shown - DECAY_PER_MS * dt);
    if (s.target >= s.peak || ts - s.peakAt > PEAK_HOLD_MS) {
      s.peak = s.target;
      s.peakAt = ts;
    }
    const wasHot = s.hot;
    s.hot = s.target > HOT_LINEAR;

    const meter = document.getElementById(`meter-${trackId}`);
    if (meter) {
      const fill = meter.querySelector('.track-meter-fill') as HTMLElement | null;
      if (fill) fill.style.width = `${Math.min(100, s.shown * 100)}%`;
      let tick = meter.querySelector('.meter-peak') as HTMLElement | null;
      if (!tick) {
        tick = document.createElement('div');
        tick.className = 'meter-peak';
        tick.setAttribute('aria-hidden', 'true');
        tick.style.pointerEvents = 'none';
        meter.appendChild(tick);
      }
      tick.style.left = `${Math.min(100, s.peak * 100)}%`;
      tick.style.opacity = s.peak > 0.003 ? '1' : '0';
    }
    if (s.hot !== wasHot) {
      const head = document.querySelector(
        `[data-track-id="${trackId}"] .track-head`) as HTMLElement | null;
      head?.classList.toggle('life-hot', s.hot);
    }
    if (s.shown > 0.001 || s.peak > 0.003) alive = true;
  }

  // ---- Clip pulse: energy at the play point (peaks x position) ----
  const pulsed = new Set<HTMLElement>();
  if (playing) {
    for (const laneTrack of document.querySelectorAll<HTMLElement>('[data-track-id]')) {
      const trackId = laneTrack.getAttribute('data-track-id')!;
      const level = tracks.get(trackId)?.shown ?? 0;
      for (const clipEl of laneTrack.querySelectorAll<HTMLElement>('.clip')) {
        const left = parseFloat(clipEl.style.left || '0') / TIMELINE.pps;
        const width = parseFloat(clipEl.style.width || '0') / TIMELINE.pps;
        if (positionSec < left || positionSec > left + width) continue;
        const canvas = clipEl.querySelector('.clip-wave') as HTMLCanvasElement | null;
        const hash = canvas?.dataset.assetHash;
        const entry = hash ? getPeaksEntry(hash) : null;
        let energy = level;  // fallback: the track's own level
        if (entry && canvas) {
          const sr = 48000;
          const off = Number(canvas.dataset.offsetSamples ?? 0);
          const len = Number(canvas.dataset.lengthSamples ?? entry.frames);
          const at = Math.min(off + len, off + (positionSec - left) * sr);
          const b = Math.min(255, Math.max(0,
            Math.floor((at / entry.frames) * 256)));
          energy = Math.abs(entry.peaks[b * 2 + 1]) * (0.4 + 0.6 * Math.min(1, level * 3));
        }
        clipEl.style.filter = `brightness(${(1 + 0.35 * Math.min(1, energy * 2)).toFixed(3)})`;
        pulsed.add(clipEl);
        alive = true;
      }
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('.clip[style*="brightness"]')) {
    if (!pulsed.has(el)) el.style.filter = '';
  }

  // ---- Touch mode C: color IS energy (saturation follows activity) --
  if (document.body.classList.contains('mode-c')) {
    let anyHot = false;
    for (const el of document.querySelectorAll<HTMLElement>('[data-track-id]')) {
      const id = el.getAttribute('data-track-id')!;
      const s = tracks.get(id);
      const level = s?.shown ?? 0;
      if (s?.hot) anyHot = true;
      // playing track = full color, silent track = almost grey
      const sat = 8 + Math.min(1, level * 4) * 42;
      el.style.setProperty('--sat', `${sat.toFixed(0)}%`);
      if (level > 0.001) alive = true;
    }
    document.body.classList.toggle('life-clipping', anyHot);
  }

  // ---- Ambient health: silence while playing / plugin misses ----
  const anySignal = [...tracks.values()].some((s) => s.target > 0.001);
  const status = ensureStatusEl();
  if (playing && !anySignal) {
    if (!silentSinceMs) silentSinceMs = ts;
    status.textContent = ts - silentSinceMs > 1500 ? 'silence' : '';
    alive = true;
  } else {
    silentSinceMs = 0;
    if (ts < missedFlashUntil) {
      status.textContent = 'plugin late';
      status.classList.add('life-warn');
      alive = true;
    } else {
      status.textContent = '';
      status.classList.remove('life-warn');
    }
  }

  if (alive || playing) {
    rafId = requestAnimationFrame(tick);
  }
  // else: everything at rest - the loop stops, budget ~0
}

/**
 * Solo dims the rest (local monitoring, never the document): apply the
 * dim classes from the monitor snapshot. Called on toggle and after
 * every rebuild.
 */
export function applyMonitorShade(
  snapshot: Map<string, { solo: boolean; mute: boolean }>): void {
  const anySolo = [...snapshot.values()].some((v) => v.solo);
  for (const el of document.querySelectorAll<HTMLElement>('[data-track-id]')) {
    const id = el.getAttribute('data-track-id')!;
    const st = snapshot.get(id);
    el.classList.toggle('life-dim', anySolo && !(st?.solo ?? false));
    el.classList.toggle('life-muted', st?.mute ?? false);
  }
}
