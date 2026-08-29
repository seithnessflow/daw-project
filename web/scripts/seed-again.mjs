// SPDX-License-Identifier: GPL-3.0-or-later
// Seed a server project with a clip + an out-of-process AGain chain node,
// THROUGH THE SERVER'S OWN CONTRACT (first message = full doc, then
// changes) - the same path the E2E milestone spec uses. For the manual
// test of the 2.4 milestone (docs/test-des-mains-2.4.md).
//
// Usage (from web/):
//   node scripts/seed-again.mjs --base <doc.am> --assets <dir> [--project default]
//
// --base: a document produced by create_test_doc (provides a real clip +
//         the tone asset hash). The tone is copied to <assets>/<hash>.wav
//         so the engine resolves it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

// Same CJS entry points as the E2E specs - proven resolution
const require = createRequire(import.meta.url);
const Automerge = require('@automerge/automerge');
const WsWebSocket = require('ws').WebSocket;

const AGAIN_UID = '84E8DE5F92554F5396FAE4133C935A18';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const basePath = arg('base', null);
const assetsDir = arg('assets', null);
const projectId = arg('project', 'default');
if (!basePath || !assetsDir) {
  console.error('usage: node scripts/seed-again.mjs --base <doc.am> --assets <dir> [--project <id>]');
  process.exit(2);
}

const WS = globalThis.WebSocket ?? WsWebSocket;
const wsUrl = `ws://localhost:3000/ws/${projectId}`;

const openSocket = () =>
  new Promise((resolve, reject) => {
    const sock = new WS(wsUrl);
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => resolve(sock);
    sock.onerror = () => reject(new Error(`cannot connect ${wsUrl} - is the server up?`));
  });
const nextMessage = (sock) =>
  new Promise((resolve) => {
    sock.onmessage = (ev) => resolve(new Uint8Array(ev.data));
  });

const base = Automerge.load(new Uint8Array(fs.readFileSync(basePath)));
const baseClip = base.tracks[0].clips[0];
const tonePath = path.join(path.dirname(basePath), 'test_tone.wav');
const hashedPath = path.join(assetsDir, `${baseClip.assetHash}.wav`);
if (!fs.existsSync(hashedPath)) {
  fs.copyFileSync(tonePath, hashedPath);
  console.log(`asset exposed: ${hashedPath}`);
}

const sock = await openSocket();
const serverDoc = Automerge.load(await nextMessage(sock));

// Garde (CI 2026-08-29) : un doc serveur encore VIDE (pas de tracks) ne
// doit pas faire crasher le seeder - il faut seeder, et la boucle de
// confirmation doit RE-ESSAYER, pas mourir sur `undefined[0]`.
if (serverDoc.tracks?.[0]?.chain?.some((p) => p.id === 'mains-again')) {
  console.log(`project '${projectId}' already seeded - nothing to do`);
  sock.close();  // natural exit once the socket drains
} else {
  seedAndConfirm();
}

async function seedAndConfirm() {

const seeded = Automerge.change(serverDoc, (d) => {
  const t = d.tracks[0];
  t.clips.push({
    id: 'mains-clip',
    assetHash: baseClip.assetHash,
    startSample: 0,
    lengthSamples: baseClip.lengthSamples,
    offsetSamples: 0,
  });
  t.chain.push({
    id: 'mains-again',
    type: 'vst3',
    uid: AGAIN_UID,
    bypass: false,
    params: [{ key: '0', value: 0.5 }],
  });
});
sock.send(Automerge.getLastLocalChange(seeded));
sock.close();

// Deterministic confirmation through a fresh connection
for (let attempt = 0; attempt < 40; attempt++) {
  const s2 = await openSocket();
  const d = Automerge.load(await nextMessage(s2));
  s2.close();
  if (d.tracks?.[0]?.chain?.some((p) => p.id === 'mains-again')) {
    console.log(`project '${projectId}' seeded: clip (${baseClip.lengthSamples} samples) + AGain at 0.5, bypass off`);
    // natural exit once sockets drain - process.exit() here races the ws
    // teardown on Windows (libuv assertion)
    process.exitCode = 0;
    break;
  }
  if (attempt === 39) {
    console.error('server never confirmed the seed');
    process.exitCode = 1;
  }
  await new Promise((r) => setTimeout(r, 250));
}
}  // seedAndConfirm
