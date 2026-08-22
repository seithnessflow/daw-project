// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Waveform rendering inside clips (2026-08-22) — the convention every
 * DAW shares: the waveform is drawn IN the clip, in a contrasting shade
 * of the clip color.
 *
 * Assets come from the server's content-addressed store (GET
 * /assets/:hash). Decoded peaks are cached per hash: a clip appearing
 * on a rebuild redraws instantly; the network is hit once per asset.
 */

const SERVER_HTTP = 'http://localhost:3000';

// hash -> per-bucket [min, max] pairs (fixed bucket count, scaled at draw)
const peaksCache = new Map<string, Float32Array>();
const pending = new Set<string>();
const BUCKETS = 256;

let audioCtx: AudioContext | null = null;

async function loadPeaks(hash: string): Promise<Float32Array | null> {
  const cached = peaksCache.get(hash);
  if (cached) return cached;
  if (pending.has(hash)) return null;  // someone else is fetching
  pending.add(hash);
  try {
    const res = await fetch(`${SERVER_HTTP}/assets/${hash}`);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    audioCtx ??= new AudioContext({ sampleRate: 48000 });
    const audio = await audioCtx.decodeAudioData(bytes);
    const data = audio.getChannelData(0);
    const peaks = new Float32Array(BUCKETS * 2);
    const per = Math.max(1, Math.floor(data.length / BUCKETS));
    for (let b = 0; b < BUCKETS; b++) {
      let min = 0, max = 0;
      const start = b * per;
      for (let i = start; i < start + per && i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
      }
      peaks[b * 2] = min;
      peaks[b * 2 + 1] = max;
    }
    peaksCache.set(hash, peaks);
    return peaks;
  } catch {
    return null;
  } finally {
    pending.delete(hash);
  }
}

function draw(canvas: HTMLCanvasElement, peaks: Float32Array): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(235, 242, 250, 0.55)';
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const b = Math.min(BUCKETS - 1, Math.floor((x / w) * BUCKETS));
    const min = peaks[b * 2];
    const max = peaks[b * 2 + 1];
    const y0 = mid + min * mid;
    const y1 = mid + max * mid;
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  canvas.dataset.drawn = '1';
}

/**
 * Fill every clip waveform canvas under root that isn't drawn yet.
 * Safe to call after every render: cached hashes draw synchronously.
 */
export function fillWaveforms(root: ParentNode = document): void {
  const canvases = root.querySelectorAll<HTMLCanvasElement>(
    'canvas.clip-wave:not([data-drawn])');
  for (const canvas of canvases) {
    const hash = canvas.dataset.assetHash;
    if (!hash) continue;
    const cached = peaksCache.get(hash);
    if (cached) {
      draw(canvas, cached);
    } else {
      void loadPeaks(hash).then((peaks) => {
        if (peaks && !canvas.dataset.drawn) draw(canvas, peaks);
      });
    }
  }
}
