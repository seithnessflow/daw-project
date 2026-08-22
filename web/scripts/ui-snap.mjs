// SPDX-License-Identifier: GPL-3.0-or-later
// The EYES (session outillage 2026-08-22): capture the LIVING stack.
// Never starts or restarts anything - vite hot-reload is the loop; this
// script only opens tabs on it and screenshots what a user would see.
//
// Usage: npm run snap [-- --zone <css>] [-- --two-tabs] [-- --project <id>]
//   Outputs in web/snap/:
//     full-1536.png / full-1280.png   whole page, both viewports
//     zone-1536.png / zone-1280.png   the zone under work (default #tracks)
//     tab1.png / tab2.png             with --two-tabs (1536x864), same
//                                     project, two pages - for visual
//                                     convergence checks
//   The engine token is read from %TEMP%/daw-engine-token when present, so
//   the engine pill can connect; its absence is reported, never fatal.

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const snapDir = join(here, '..', 'snap');
mkdirSync(snapDir, { recursive: true });

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const zoneSel = argValue('--zone', '#tracks');
const projectId = argValue('--project', 'default');
const twoTabs = args.includes('--two-tabs');
const baseUrl = argValue('--url', 'http://localhost:5173');

function readToken() {
  try {
    const raw = readFileSync(join(tmpdir(), 'daw-engine-token'), 'utf8');
    return JSON.parse(raw).token ?? '';
  } catch {
    return '';
  }
}

const token = readToken();
const url = `${baseUrl}/?project=${encodeURIComponent(projectId)}` +
  (token ? `&token=${token}` : '');

const VIEWPORTS = [
  { width: 1536, height: 864 },  // the user's screen
  { width: 1280, height: 720 },
];

/** Wait for the stable state; degrade loudly, never hang. */
async function settle(page) {
  const notes = [];
  try {
    await page.waitForSelector('#server-status[data-state="connected"]', { timeout: 10000 });
    notes.push('server pill: connected');
  } catch {
    notes.push('server pill: NOT connected (10s) - captures show the degraded state');
  }
  try {
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });
    const n = await page.locator('[data-track-id]').count();
    notes.push(`tracks rendered: ${n}`);
  } catch {
    notes.push('tracks: NONE rendered (10s)');
  }
  const engineConnected = await page
    .locator('#engine-status[data-state="connected"]')
    .count()
    .then((c) => c > 0)
    .catch(() => false);
  notes.push(`engine pill: ${engineConnected ? 'connected' : 'not connected'}`);
  await page.waitForTimeout(500); // meters/last paint
  return notes;
}

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: vp });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const notes = await settle(page);
    await page.screenshot({ path: join(snapDir, `full-${vp.width}.png`), fullPage: true });
    const zone = page.locator(zoneSel).first();
    if (await zone.count()) {
      await zone.screenshot({ path: join(snapDir, `zone-${vp.width}.png`) });
    } else {
      notes.push(`zone '${zoneSel}': NOT FOUND - no zone capture`);
    }
    console.log(`[${vp.width}x${vp.height}] ${notes.join(' | ')}`);
    await context.close();
  }

  if (twoTabs) {
    const context = await browser.newContext({ viewport: VIEWPORTS[0] });
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    await p1.goto(url, { waitUntil: 'domcontentloaded' });
    await p2.goto(url, { waitUntil: 'domcontentloaded' });
    await settle(p1);
    const notes2 = await settle(p2);
    await p1.screenshot({ path: join(snapDir, 'tab1.png'), fullPage: true });
    await p2.screenshot({ path: join(snapDir, 'tab2.png'), fullPage: true });
    console.log(`[two-tabs] captured tab1.png/tab2.png | ${notes2.join(' | ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`snap: wrote ${snapDir}`);
if (!existsSync(join(snapDir, 'full-1536.png'))) process.exit(1);
