// SPDX-License-Identifier: GPL-3.0-or-later
// USING THE SITE (session organes): a scripted user on the living stack.
// Not a spec - an exploration harness: real gestures through the
// selection contract, assertion after each one, snaps at key moments.
// Findings feed the loop; invariants stay in tests/e2e.
//
// Usage (from web/, stack up): node scripts/ui-drive.mjs [--project lab]

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const snapDir = join(here, '..', 'snap');
mkdirSync(snapDir, { recursive: true });

const args = process.argv.slice(2);
const projectId = (() => {
  const i = args.indexOf('--project');
  return i >= 0 ? args[i + 1] : 'lab';
})();

let token = '';
try {
  token = JSON.parse(readFileSync(join(tmpdir(), 'daw-engine-token'), 'utf8')).token ?? '';
} catch { /* engine pill will just stay grey */ }
const url = `http://localhost:5173/?project=${projectId}${token ? `&token=${token}` : ''}`;

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ok: ${label}`);
  else { failures++; console.error(`  FAILED: ${label} ${detail}`); }
}

const getGain = (page, id) => page.evaluate((tid) => {
  const t = document.querySelector(`[data-track-id="${tid}"]`);
  const input = t?.querySelector('[data-role="gain"]');
  return input ? parseFloat(input.value) : NaN;
}, id);

const setGain = (page, id, g) => page.evaluate(({ tid, gv }) => {
  const t = document.querySelector(`[data-track-id="${tid}"]`);
  const input = t?.querySelector('[data-role="gain"]');
  if (input) {
    input.value = String(gv);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, { tid: id, gv: g });

const docGain = (page, id) => page.evaluate((tid) => {
  const d = window.__dawProject?.getDocument();
  return d?.tracks.find((t) => t.id === tid)?.gain ?? NaN;
}, id);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
const page = await context.newPage();

console.log('Gesture 1: open the lab, both pills, five tracks');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#server-status[data-state="connected"]', { timeout: 10000 });
const engineUp = await page
  .waitForSelector('#engine-status[data-state="connected"]', { timeout: 10000 })
  .then(() => true).catch(() => false);
check('engine pill connected', engineUp);
await page.waitForSelector('[data-track-id]', { timeout: 10000 });
const ids = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-track-id]'))
    .map((t) => t.getAttribute('data-track-id')));
check('5 lab tracks', ids.length === 5 && ids[0] === 'lab-sine440', ids.join(','));
const clipCount = await page.locator('.clip').count();
check('5 clips drawn on the timeline', clipCount === 5, String(clipCount));
await page.screenshot({ path: join(snapDir, 'drive-1-lab.png'), fullPage: true });

console.log('Gesture 2: one distinct fader value per track, label + doc follow');
const gains = [0.9, 0.8, 0.7, 0.6, 0.5];
for (let i = 0; i < ids.length; i++) {
  await setGain(page, ids[i], gains[i]);
}
await page.waitForTimeout(300);
for (let i = 0; i < ids.length; i++) {
  const ui = await getGain(page, ids[i]);
  const doc = await docGain(page, ids[i]);
  check(`${ids[i]} fader=${gains[i]}`,
    Math.abs(ui - gains[i]) < 0.005 && Math.abs(doc - gains[i]) < 0.005,
    `ui=${ui} doc=${doc}`);
}

console.log('Gesture 3: bypass toggle settles THROUGH the document');
const bypass = page.locator('[data-role="bypass"]');
check('one bypass button (sine440 chain)', await bypass.count() === 1);
const before = await bypass.getAttribute('aria-pressed');
await bypass.click();
await page.waitForFunction(
  (prev) => document.querySelector('[data-role="bypass"]')
    ?.getAttribute('aria-pressed') !== prev,
  before, { timeout: 10000 }
).catch(() => {});
const after = await bypass.getAttribute('aria-pressed');
check(`aria-pressed flipped ${before} -> ${after}`, after !== before);
await bypass.click();  // put it back
await page.waitForFunction(
  (prev) => document.querySelector('[data-role="bypass"]')
    ?.getAttribute('aria-pressed') === prev,
  before, { timeout: 10000 }
).catch(() => {});
check('aria-pressed restored', await bypass.getAttribute('aria-pressed') === before);

console.log('Gesture 4: the playhead moves while the engine plays');
if (engineUp) {
  const left1 = await page.evaluate(() =>
    parseFloat(document.getElementById('playhead')?.style.left ?? '0'));
  await page.waitForTimeout(2500);
  const left2 = await page.evaluate(() =>
    parseFloat(document.getElementById('playhead')?.style.left ?? '0'));
  check(`playhead advanced (${left1.toFixed(0)}px -> ${left2.toFixed(0)}px)`, left2 > left1);
  const pos = await page.locator('#position').textContent();
  check(`position readout alive (${pos})`, pos !== '00:00.000');
  await page.screenshot({ path: join(snapDir, 'drive-4-playing.png'), fullPage: true });
} else {
  console.log('  (skipped: engine not connected)');
}

console.log('Gesture 5: two tabs converge through the server');
const page2 = await context.newPage();
await page2.goto(url, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('#server-status[data-state="connected"]', { timeout: 10000 });
await page2.waitForSelector('[data-track-id]', { timeout: 10000 });
await setGain(page, 'lab-noise', 0.33);
let converged = false;
for (let attempt = 0; attempt < 40 && !converged; attempt++) {
  converged = Math.abs(await getGain(page2, 'lab-noise') - 0.33) < 0.005;
  if (!converged) await page2.waitForTimeout(250);
}
check('tab2 sees tab1 fader move (0.33)', converged);
await page2.screenshot({ path: join(snapDir, 'drive-5-tab2.png'), fullPage: true });

console.log('Gesture 6: Add Track from the UI');
await page.locator('#add-track-btn').click();
let grew = false;
for (let attempt = 0; attempt < 20 && !grew; attempt++) {
  grew = (await page.locator('[data-track-id]').count()) === 6;
  if (!grew) await page.waitForTimeout(250);
}
check('6th track appears', grew);

await browser.close();
if (failures > 0) {
  console.error(`\nui-drive: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nui-drive: all gestures green');
