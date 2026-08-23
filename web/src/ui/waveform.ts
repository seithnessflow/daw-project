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

// 1bis + ultra bug_009: SERVER_HTTP's single owner is app/context -
// imported here for local use only, no re-export (the forwarding twin
// is dead for real this time).
import { SERVER_HTTP } from '../app/context';

/** Decode audio duration in seconds (shared AudioContext). */
export async function decodeDurationSec(bytes: ArrayBuffer): Promise<number> {
  audioCtx ??= new AudioContext({ sampleRate: 48000 });
  const audio = await audioCtx.decodeAudioData(bytes.slice(0));
  return audio.duration;
}

// hash -> {peaks: per-bucket [min,max] pairs, frames: asset length}
interface PeaksEntry { peaks: Float32Array; frames: number }
const peaksCache = new Map<string, PeaksEntry>();
const pending = new Set<string>();
const BUCKETS = 256;

let audioCtx: AudioContext | null = null;

async function loadPeaks(hash: string): Promise<PeaksEntry | null> {
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
    const entry = { peaks, frames: data.length };
    peaksCache.set(hash, entry);
    return entry;
  } catch {
    return null;
  } finally {
    pending.delete(hash);
  }
}

function draw(canvas: HTMLCanvasElement, entry: PeaksEntry): void {
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
  // The clip shows a WINDOW of the asset (trims move offset/length):
  // map pixels into the bucket range of that window; beyond the asset's
  // end there is honestly nothing to draw.
  const offset = Number(canvas.dataset.offsetSamples ?? 0);
  const length = Number(canvas.dataset.lengthSamples ?? entry.frames);
  const b0 = (offset / entry.frames) * BUCKETS;
  const bSpan = (length / entry.frames) * BUCKETS;
  for (let x = 0; x < w; x++) {
    const b = b0 + (x / w) * bSpan;
    if (b >= BUCKETS) break;
    const bi = Math.min(BUCKETS - 1, Math.floor(b));
    const min = entry.peaks[bi * 2];
    const max = entry.peaks[bi * 2 + 1];
    const y0 = mid + min * mid;
    const y1 = mid + max * mid;
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  canvas.dataset.drawn = '1';
}

/** Read-only access for the life layer (clip pulse): peaks + frames. */
export function getPeaksEntry(hash: string): { peaks: Float32Array; frames: number } | null {
  return peaksCache.get(hash) ?? null;
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
      void loadPeaks(hash).then((entry) => {
        if (entry && !canvas.dataset.drawn) draw(canvas, entry);
      });
    }
  }
}
