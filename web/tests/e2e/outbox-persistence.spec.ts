// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The outbox survives the tab (residual criterion-3 debt, settled).
 *
 * Scenario: a tab edits OFFLINE (server really stopped), then the tab is
 * CLOSED - the in-memory queue dies with it, but its localStorage mirror
 * survives in the browser profile. The next tab on the same project adopts
 * the orphaned queue at connection and delivers it. The edit made in a
 * dead tab must reach the server, and be visible in the new tab.
 *
 * Companion of criterion3-offline.spec.ts (same script-managed server so
 * the mid-test stop/start reuses the same file store).
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForServerConnection,
  waitForServerDisconnected,
  getTrackIds,
  setTrackGain,
  waitForGain,
} from './helpers';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(specDir, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'start-stack.ps1');
const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

function serverControl(action: 'stop' | 'start'): void {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    ...(action === 'stop' ? ['-Stop'] : []),
    '-Component', 'server',
  ];
  execFileSync(SHELL, args, { stdio: 'ignore', timeout: 60000 });
}

test.describe('Outbox persistence', () => {
  test('an offline edit from a CLOSED tab reaches the server through the next tab', async ({ browser }) => {
    test.setTimeout(120000);

    serverControl('stop');
    serverControl('start');

    // One browser context = one localStorage profile: the tab dies, the
    // storage survives - exactly the real-world shape of this debt
    const context = await browser.newContext();
    const projectId = `e2e-outbox-${Date.now()}`;

    const page1 = await context.newPage();
    await page1.goto(`http://localhost:5173/?project=${projectId}`);
    await waitForServerConnection(page1);
    await page1.waitForSelector('[data-track-id]', { timeout: 10000 });
    const trackIds = await getTrackIds(page1);

    // Real outage, offline edit, then the tab CLOSES with its queue
    serverControl('stop');
    await waitForServerDisconnected(page1);
    await setTrackGain(page1, trackIds[0], 0.77);
    await page1.close();

    serverControl('start');

    // A fresh tab on the same project adopts the orphaned queue and
    // delivers it; the dead tab's edit must come back through the server
    const page2 = await context.newPage();
    await page2.goto(`http://localhost:5173/?project=${projectId}`);
    await waitForServerConnection(page2);
    await page2.waitForSelector('[data-track-id]', { timeout: 10000 });
    await waitForGain(page2, trackIds[0], 0.77);

    // And the orphan key was consumed, not left to be replayed forever
    const leftoverKeys = await page2.evaluate((pid) => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`daw-outbox:${pid}:`)) keys.push(k);
      }
      return keys;
    }, projectId);
    expect(leftoverKeys, 'orphan outbox keys not cleaned up').toHaveLength(0);

    await context.close();
  });
});
