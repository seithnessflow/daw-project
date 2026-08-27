// SPIKE s2 : mesure du pipeline jam sur UNE machine (reseau ~0) -
// A broadcaster (JAM on) + B listener ; 10 s de lecture ; collecte :
// - espacement d'arrivee des messages AudioTap (quantisation pumpTap)
// - dwell du FIFO worklet broadcaster (stats? enfin consomme)
// - NetEq + playout du listener (pc.getStats)
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { homedir } from 'os';
const require = createRequire('C:/Users/mb668/daw-project/web/');
const { chromium } = require('@playwright/test');
const stoken = readFileSync(`${homedir()}/.daw-server-token`, 'utf8').trim();

// HEADED + fenetres VISIBLES : le piege grave (onglet pilote en
// arriere-plan = throttle ~16 ms) contaminait la mesure headless.
const browser = await chromium.launch({ headless: false,
  args: ['--window-size=780,500', '--window-position=0,0'] });
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const A = await ctxA.newPage();
const B = await ctxB.newPage();

await A.goto(`http://localhost:5173/?project=studio#stoken=${stoken}`);
// B = auditeur : le mode pilotage ?jam=listen (JOIN auto avec retry)
await B.goto(`http://localhost:5173/?project=studio&jam=listen#stoken=${stoken}`);
for (const p of [A, B]) {
  await p.waitForSelector('[data-track-id]', { timeout: 15000 });
}
await A.waitForFunction(() => window.__dawEngine?.isConnected?.(), null, { timeout: 20000 });

// A : sonde d'espacement d'arrivee des taps
await A.evaluate(() => {
  const eng = window.__dawEngine;
  window.__tapArrivals = [];
  const prev = eng.onAudioTap;
  eng.onAudioTap = (seq, n, s, d) => {
    window.__tapArrivals.push({ t: performance.now(), n });
    prev?.(seq, n, s, d);
  };
});

// A diffuse (JAM) ; B (jam=listen) JOIN en boucle jusqu'a l'offre
await A.locator('#jam-btn').click();
await A.waitForFunction(() => window.__dawJam.peerCount() > 0, null, { timeout: 15000 });
await B.waitForFunction(() => window.__dawJam.peerCount() > 0, null, { timeout: 15000 });
// autoplay headless : geste + resume explicite
await B.locator('body').click();
await B.evaluate(() => window.__dawJamAudio.resume());
await B.waitForTimeout(500);

// PLAY sur A (le moteur joue, le tap coule)
await A.locator('#play-btn').click();
await A.waitForTimeout(10000);
await A.locator('#stop-btn').click();

const arrivals = await A.evaluate(() => {
  const a = window.__tapArrivals;
  const gaps = [];
  for (let i = 1; i < a.length; i++) gaps.push(a[i].t - a[i - 1].t);
  gaps.sort((x, y) => x - y);
  const q = (p) => gaps[Math.floor(gaps.length * p)] ?? -1;
  const blocks = a.reduce((s, x) => s + x.n, 0);
  return { msgs: a.length, blocks,
    gapP50: q(0.5), gapP90: q(0.9), gapMax: gaps[gaps.length - 1] ?? -1,
    blocksPerMsg: blocks / Math.max(1, a.length) };
});
const worklet = await A.evaluate(() => window.__dawJamAudio.workletStats());
const statsB = await B.evaluate(() => window.__dawJam.rtcStats());
const statsA = await A.evaluate(() => window.__dawJam.rtcStats());

console.log('TAP arrivals (A):', JSON.stringify(arrivals));
console.log('WORKLET (A):', JSON.stringify(worklet));
console.log('RTC stats (B, listener):', JSON.stringify(statsB));
console.log('RTC stats (A):', JSON.stringify(statsA));
await browser.close();
