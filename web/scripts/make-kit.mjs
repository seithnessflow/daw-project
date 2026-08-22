// SPDX-License-Identifier: GPL-3.0-or-later
// THE BASE KIT (2026-08-22): a deterministic, synthesized sample kit so
// the site is usable out of the box - drums, a bass note, a chord, a
// riser. Assets go through the server's VERIFYING store (the engine
// pulls them on miss) AND to engine/test-assets (offline render / ear).
// The UI reads web/public/kit.json (served by vite at /kit.json).
//
// Everything is synthesized deterministically (fixed-seed noise): same
// bytes -> same sha256 on every machine, every run.
//
// Usage (from web/, server up): node scripts/make-kit.mjs

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assetsDir = path.join(root, 'engine', 'test-assets');
const publicDir = path.join(here, '..', 'public');
const SR = 48000;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wav16Stereo(samplesMono) {
  const frames = samplesMono.length;
  const dataLen = frames * 4;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let n = 0; n < frames; n++) {
    const v = Math.max(-1, Math.min(1, samplesMono[n]));
    const s = Math.round(v * 32767);
    buf.writeInt16LE(s, 44 + n * 4);
    buf.writeInt16LE(s, 44 + n * 4 + 2);
  }
  return buf;
}

const env = (n, len, a, d) => {
  // attack a samples, then exponential decay with time constant d
  if (n < a) return n / a;
  return Math.exp(-(n - a) / d);
};

function synth(seconds, fn) {
  const frames = Math.round(seconds * SR);
  const out = new Float64Array(frames);
  for (let n = 0; n < frames; n++) out[n] = fn(n, n / SR);
  return out;
}

const KIT = [
  { name: 'kick', seconds: 0.4, make: () =>
      synth(0.4, (n, t) => {
        const f = 120 * Math.exp(-t * 18) + 45;           // pitch drop
        const click = n < 60 ? (1 - n / 60) * 0.4 : 0;
        return (0.9 * Math.sin(2 * Math.PI * f * t) * env(n, 8, 5000) + click) * 0.8;
      }) },
  { name: 'snare', seconds: 0.25, make: () => {
      const rand = mulberry32(0x5a4e);
      return synth(0.25, (n, t) =>
        (0.5 * (2 * rand() - 1) * env(n, 4, 2600) +
         0.45 * Math.sin(2 * Math.PI * 185 * t) * env(n, 4, 1600)) * 0.8);
    } },
  { name: 'hat', seconds: 0.09, make: () => {
      const rand = mulberry32(0x4a47);
      let prev = 0;
      return synth(0.09, (n) => {
        const white = 2 * rand() - 1;
        const hp = white - prev;                           // crude highpass
        prev = white;
        return 0.55 * hp * env(n, 2, 700);
      });
    } },
  { name: 'clap', seconds: 0.3, make: () => {
      const rand = mulberry32(0xc1a9);
      return synth(0.3, (n) => {
        const burst = [0, 480, 960].reduce((acc, off) =>
          acc + (n >= off ? Math.exp(-(n - off) / 900) : 0), 0);
        return 0.4 * (2 * rand() - 1) * burst * env(n, 2, 4200);
      });
    } },
  { name: 'bass-C2', seconds: 1.0, make: () =>
      synth(1.0, (n, t) => {
        const f = 65.41;
        const saw = 2 * ((f * t) % 1) - 1;
        const sub = Math.sin(2 * Math.PI * f * t);
        return (0.35 * saw + 0.4 * sub) * env(n, 40, 14000) * 0.8;
      }) },
  { name: 'chord-Am', seconds: 1.5, make: () =>
      synth(1.5, (n, t) => {
        const fs = [220.0, 261.63, 329.63];
        let v = 0;
        for (const f of fs) v += Math.sin(2 * Math.PI * f * t);
        return (v / fs.length) * 0.55 * env(n, 200, 22000);
      }) },
  { name: 'riser', seconds: 2.0, make: () => {
      const rand = mulberry32(0x9153);
      return synth(2.0, (n, t) => {
        const f = 80 + (2200 - 80) * (t / 2) * (t / 2);    // slow-in sweep
        const tone = Math.sin(2 * Math.PI * f * t);
        const noise = (2 * rand() - 1) * (t / 2);
        return (0.4 * tone + 0.25 * noise) * (0.2 + 0.8 * (t / 2)) * 0.7;
      });
    } },
];

const manifest = [];
for (const item of KIT) {
  const buf = wav16Stereo(item.make());
  const hash = createHash('sha256').update(buf).digest('hex');
  const file = path.join(assetsDir, `${hash}.wav`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  const res = await fetch(`http://localhost:3000/assets/${hash}`, {
    method: 'PUT', body: buf,
  });
  if (res.status !== 201) {
    console.error(`store refused ${item.name}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  manifest.push({ name: item.name, hash, seconds: item.seconds });
  console.log(`${item.name.padEnd(9)} ${item.seconds}s ${hash.slice(0, 12)}... stored`);
}

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(
  path.join(publicDir, 'kit.json'),
  JSON.stringify({ sampleRate: SR, samples: manifest }, null, 2),
);
console.log(`kit.json written (${manifest.length} samples) - the site has material now`);
