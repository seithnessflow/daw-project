// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * S8a invariant: THE TAP FLOWS, CONTINUOUSLY.
 * ?tap=1 subscribes the tab to the engine's post-master PCM; the spec
 * asserts real blocks arrive with CONTIGUOUS sequence numbers and zero
 * ring drops while playing. (The jam road's first leg: engine -> tab.)
 *
 * Needs the real engine on 47821 - same constraint as the loop spec.
 */
import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForServerConnection, resolveBinary, waitUntil, countInFile } from './helpers';

const ENGINE_PORT = 47821;

test.describe('Master tap (S8a)', () => {
  test('tap blocks flow, contiguous, zero drops', async ({ page }) => {
    test.setTimeout(90000);
    const projectId = `e2e-tap-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-tap-${Date.now()}.log`);
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const logFd = fs.openSync(logPath, 'w');
    const engine: ChildProcess = spawn(
      engineExe,
      ['--server', 'ws://localhost:3000', '--project', projectId,
       '--play', '--mute', '--ws-port', String(ENGINE_PORT)],
      { stdio: ['ignore', logFd, logFd] },
    );
    fs.closeSync(logFd);

    try {
      expect(
        await waitUntil(() => countInFile(logPath, 'WebSocket server') >= 1, 15000),
        `engine WS never came up (log: ${logPath})`,
      ).toBe(true);

      await page.goto(`/?project=${projectId}&lab=1&tap=1`);
      await waitForServerConnection(page);
      await expect(page.locator('#engine-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      // Blocks flow whether or not the transport runs (the callback
      // always renders); ~2 s of tap = ~375 blocks
      await expect.poll(async () => {
        const t = await page.evaluate(() => (window as any).__dawTap);
        return t?.blocks ?? 0;
      }, { timeout: 15000 }).toBeGreaterThan(300);

      const tap = await page.evaluate(() => (window as any).__dawTap);
      expect(tap.gaps, 'sequence gaps in the tap stream').toBe(0);
      expect(tap.dropped, 'ring drops while draining every tick').toBe(0);

      // The badge SAYS it (visibility rule)
      await expect(page.locator('#tap-status')).toContainText('continu');
    } finally {
      engine.kill();
    }
  });
});
