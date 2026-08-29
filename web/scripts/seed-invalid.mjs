// SPDX-License-Identifier: GPL-3.0-or-later
// A4-8 test tooling (2026-08-29) : rend le document d'un projet INVALIDE
// au sens de validateDocument - gain 7 sur la premiere piste, une piste
// sans id - pour prouver que l'onglet le CHARGE et le DIT (bandeau) et que
// le moteur le loggue. Meme moule que seed-again.mjs (WS + change).
// Usage (server up) : node scripts/seed-invalid.mjs --project <id>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Automerge = require('@automerge/automerge');
const WsWebSocket = require('ws').WebSocket;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const projectId = arg('project', null);
if (!projectId) {
  console.error('usage: node scripts/seed-invalid.mjs --project <id>');
  process.exit(2);
}

const WS = globalThis.WebSocket ?? WsWebSocket;
const wsUrl = `ws://localhost:3000/ws/${projectId}`;
const openSocket = () => new Promise((resolve, reject) => {
  const sock = new WS(wsUrl);
  sock.binaryType = 'arraybuffer';
  sock.onopen = () => resolve(sock);
  sock.onerror = () => reject(new Error(`cannot connect ${wsUrl} - is the server up?`));
});
const nextMessage = (sock) => new Promise((resolve) => {
  sock.onmessage = (ev) => resolve(new Uint8Array(ev.data));
});

const sock = await openSocket();
const serverDoc = Automerge.load(await nextMessage(sock));
if (!serverDoc.tracks?.[0]) {
  console.error('server doc has no tracks yet');
  process.exit(1);
}
const seeded = Automerge.change(serverDoc, (d) => {
  d.tracks[0].gain = 7;  // hors [0, 2]
  d.tracks.push({ id: '', name: 'sans id', gain: 1, clips: [], chain: [] });
});
sock.send(Automerge.getLastLocalChange(seeded));
sock.close();

for (let attempt = 0; attempt < 40; attempt++) {
  const s2 = await openSocket();
  const d = Automerge.load(await nextMessage(s2));
  s2.close();
  if (d.tracks?.[0]?.gain === 7) {
    console.log(`project '${projectId}' made invalid (gain 7, empty track id)`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.error('the invalid change never showed up on the server');
process.exit(1);
