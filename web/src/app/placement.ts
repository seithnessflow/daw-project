// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Material intake (Magic Potion phase 1): dropped WAV files become
 * project assets + clips through the verifying store; the palette
 * rebuilds itself from the PROJECT's own assets (no embedded demo kit
 * outside ?lab=1).
 */

import { TIMELINE } from '../ui/track';
import { Library, type Kit } from '../ui/library';
import { decodeDurationSec } from '../ui/waveform';
import { SERVER_HTTP, assetAuthHeaders } from './context';
import { ctx, sendLastChange, LAB_MODE } from './context';
import { renderTracks } from './render';
import { markLanded } from './gestures';

/**
 * A dropped file becomes a project asset + a clip: verify it is a WAV,
 * hash it client-side, PUT through the verifying store, place the clip
 * where it was dropped. Failures are loud, never silent.
 */
export async function handleFileDrop(
  file: File, trackId: string, laneX: number): Promise<void> {
  if (!ctx.project) return;
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 12));
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...head.slice(o, o + n));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    console.error(`drop refused: ${file.name} is not a WAV (compressed formats are backlog)`);
    return;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const res = await fetch(`${SERVER_HTTP}/assets/${hash}`, {
    method: 'PUT', body: bytes, headers: assetAuthHeaders(),
  });
  if (res.status !== 201) {
    console.error(`asset store refused ${file.name}: ${res.status} ${await res.text()}`);
    return;
  }
  let durationSec: number;
  try {
    durationSec = await decodeDurationSec(bytes);
  } catch {
    console.error(`drop refused: ${file.name} did not decode as audio`);
    return;
  }
  const sr = ctx.project.getDocument().sampleRate || 48000;
  const sec = Math.max(0, Math.round((laneX / TIMELINE.pps) / 0.25) * 0.25);
  const stem = file.name.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 24) || 'audio';
  const clipId = `clip-${stem}-${Date.now()}`;
  ctx.project.addClip(trackId, {
    id: clipId,
    assetHash: hash,
    startSample: Math.round(sec * sr),
    lengthSamples: Math.max(1024, Math.round(durationSec * sr)),
    offsetSamples: 0,
  });
  sendLastChange();
  renderTracks();
  markLanded(clipId);
  console.log(`dropped ${file.name}: asset ${hash.slice(0, 12)}..., clip at ${sec}s`);
}

/**
 * Product palette: the arm/click gesture as a generic gesture over the
 * PROJECT's assets.
 */
let lastPaletteKey = '\0unset';  // sentinel: an empty project still renders its hint
export function refreshPalette(): void {
  if (LAB_MODE || !ctx.project) return;
  const doc = ctx.project.getDocument();
  const sr = doc.sampleRate || 48000;
  const byHash = new Map<string, { name: string; seconds: number }>();
  for (const t of doc.tracks) {
    for (const c of t.clips) {
      const name = c.id.replace(/^clip-/, '').replace(/-\d+$/, '');
      const prev = byHash.get(c.assetHash);
      const seconds = c.lengthSamples / sr;
      if (!prev || seconds > prev.seconds) {
        byHash.set(c.assetHash, { name: prev?.name ?? name, seconds });
      }
    }
  }
  const key = [...byHash.keys()].sort().join(',');
  if (key === lastPaletteKey) return;
  lastPaletteKey = key;
  const slot = document.getElementById('library-slot')!;
  slot.innerHTML = '';
  if (byHash.size === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'drop a WAV on a lane to begin';
    slot.appendChild(hint);
    ctx.library = null;
    return;
  }
  const kit: Kit = {
    sampleRate: sr,
    samples: [...byHash.entries()].map(([hash, v]) =>
      ({ name: v.name, hash, seconds: v.seconds })),
  };
  ctx.library = new Library(kit);
  slot.appendChild(ctx.library.element);
}
