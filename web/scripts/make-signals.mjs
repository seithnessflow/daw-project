// SPDX-License-Identifier: GPL-3.0-or-later
// The LAB (session organes 2026-08-22): seed a clean project with several
// SIGNAL TYPES so the ear can judge more than one kind of sound and the
// site has real, staggered content on its timeline.
//
// Signals (16-bit stereo 48 kHz, 8 s each, staggered by 2 s):
//   sine 440 @ 0.25    - the reference (exact math)
//   square 220 @ 0.25  - the discontinuity detector's KNOWN blind spot,
//                        on purpose: red verdicts here are the heuristic
//                        working, not the signal broken
//   saw 110 @ 0.25     - harmonic-rich, small jumps (one /period)
//   noise @ 0.1        - RMS/silence metrics on non-periodic material
//   sweep 100->8k @ 0.25 - evolving spectrum, steady RMS
//
// Assets go through the server's VERIFYING store (PUT /assets/:hash) AND
// to engine/test-assets so both the live engine and the offline render
// resolve them. Project 'lab' is (re)built from scratch: existing tracks
// are removed - the lab is a bench, not an archive.
//
// Usage (from web/, server up): node scripts/make-signals.mjs [--project lab]

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Automerge = require('@automerge/automerge');
const WsWebSocket = require('ws').WebSocket;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assetsDir = path.join(root, 'engine', 'test-assets');

const AGAIN_UID = '84E8DE5F92554F5396FAE4133C935A18';
const SR = 48000;
const SECONDS = 8;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const projectId = arg('project', 'lab');

// ---- Signal generators (mono fn -> stereo 16-bit WAV buffer) --------------
function wav16Stereo(fn) {
  const frames = SR * SECONDS;
  const dataLen = frames * 2 * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let n = 0; n < frames; n++) {
    const v = Math.max(-1, Math.min(1, fn(n)));
    const s = Math.round(v * 32767);
    buf.writeInt16LE(s, 44 + n * 4);
    buf.writeInt16LE(s, 44 + n * 4 + 2);
  }
  return buf;
}

// Deterministic noise (mulberry32) - same file every run, stable hash
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xda3);

const SIGNALS = [
  { name: 'sine440',  fn: (n) => 0.25 * Math.sin((2 * Math.PI * 440 * n) / SR) },
  { name: 'square220', fn: (n) => 0.25 * Math.sign(Math.sin((2 * Math.PI * 220 * n) / SR)) },
  { name: 'saw110',   fn: (n) => 0.25 * (2 * (((110 * n) / SR) % 1) - 1) },
  { name: 'noise',    fn: () => 0.1 * (2 * rand() - 1) },
  { name: 'sweep',    fn: (n) => {
      const t = n / SR;
      const f0 = 100, f1 = 8000, T = SECONDS;
      // linear sweep phase: 2*pi*(f0*t + (f1-f0)*t^2/(2T))
      return 0.25 * Math.sin(2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * T)));
    } },
];

// ---- Build assets: file + verifying store ---------------------------------
const made = [];
for (const sig of SIGNALS) {
  const buf = wav16Stereo(sig.fn);
  const hash = createHash('sha256').update(buf).digest('hex');
  const file = path.join(assetsDir, `${hash}.wav`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  const res = await fetch(`http://localhost:3000/assets/${hash}`, {
    method: 'PUT', body: buf,
  });
  if (res.status !== 201) {
    console.error(`store refused ${sig.name}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  made.push({ ...sig, hash });
  console.log(`${sig.name}: ${hash.slice(0, 12)}... stored (file + verifying PUT)`);
}

// ---- Seed project through the server's own contract -----------------------
const WS = globalThis.WebSocket ?? WsWebSocket;
const openSocket = () => new Promise((resolve, reject) => {
  const sock = new WS(`ws://localhost:3000/ws/${projectId}`);
  sock.binaryType = 'arraybuffer';
  sock.onopen = () => resolve(sock);
  sock.onerror = () => reject(new Error('cannot connect - server up?'));
});
const nextMessage = (sock) => new Promise((resolve) => {
  sock.onmessage = (ev) => resolve(new Uint8Array(ev.data));
});

const sock = await openSocket();
const serverDoc = Automerge.load(await nextMessage(sock));

const seeded = Automerge.change(serverDoc, (d) => {
  while (d.tracks.length > 0) d.tracks.splice(d.tracks.length - 1, 1);
  made.forEach((sig, i) => {
    d.tracks.push({
      id: `lab-${sig.name}`,
      name: sig.name,
      gain: 1.0,
      clips: [{
        id: `clip-${sig.name}`,
        assetHash: sig.hash,
        startSample: i * 2 * SR,          // staggered by 2 s
        lengthSamples: SECONDS * SR,
        offsetSamples: 0,
      }],
      chain: sig.name === 'sine440'
        ? [{ id: 'lab-again', type: 'vst3', uid: AGAIN_UID, bypass: false,
             params: [{ key: '0', value: 0.5 }] }]
        : [],
    });
  });
});
sock.send(Automerge.getLastLocalChange(seeded));
sock.close();

// Confirm through a fresh connection
for (let attempt = 0; attempt < 40; attempt++) {
  const s2 = await openSocket();
  const d = Automerge.load(await nextMessage(s2));
  s2.close();
  if (d.tracks.length === SIGNALS.length && d.tracks[0]?.id === 'lab-sine440') {
    console.log(`project '${projectId}' seeded: ${d.tracks.length} signal tracks, AGain on sine440`);
    process.exitCode = 0;
    break;
  }
  if (attempt === 39) {
    console.error('server never confirmed the lab seed');
    process.exitCode = 1;
  }
  await new Promise((r) => setTimeout(r, 250));
}
