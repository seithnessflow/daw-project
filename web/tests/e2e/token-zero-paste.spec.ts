// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 1pre invariants: ZERO-PASTE TOKEN DELIVERY.
 *
 * The founding gesture of the product is "j'ouvre le site, ca marche".
 * Until today the engine token had to be pasted into the URL by hand -
 * this spec guards the mechanism that removed the paste:
 *
 * 1. A page opened with NO token anywhere (no fragment, no query)
 *    fetches it from the local /api/engine-token endpoint and the
 *    engine dot turns green (WS + auth + telemetry).
 * 2. 4001 recovery: an engine RESTART regenerates its token; the open
 *    tab holds a stale one. On close 4001 the client re-fetches and
 *    retries once, silently - the tab reconnects without a reload.
 *
 * The engine must run on the page's port (47821): this spec cannot
 * share the machine with an interactive stack.
 */
import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForServerConnection, resolveBinary, waitUntil, countInFile } from './helpers';

const ENGINE_PORT = 47821;

function spawnEngine(projectId: string, logPath: string): ChildProcess {
  const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--mute', '--ws-port', String(ENGINE_PORT)],
    { stdio: ['ignore', logFd, logFd] },
  );
  fs.closeSync(logFd);
  return child;
}

const tokenOnDisk = () =>
  JSON.parse(fs.readFileSync(
    path.join(os.tmpdir(), `daw-engine-token-${ENGINE_PORT}`), 'utf8')).token as string;

test.describe('Token zero-paste (1pre)', () => {
  test('no token in the URL: the page finds it alone; engine restart: 4001 recovery', async ({ page }) => {
    const projectId = `e2e-token-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-token-${Date.now()}.log`);
    let engine: ChildProcess | null = spawnEngine(projectId, logPath);

    try {
      expect(
        await waitUntil(() => countInFile(logPath, 'WebSocket server') >= 1, 15000),
        `engine WS never came up (log: ${logPath})`,
      ).toBe(true);
      const firstToken = tokenOnDisk();

      // 1. NO token anywhere in the URL - the dot must go green alone
      await page.goto(`/?project=${projectId}`);
      await waitForServerConnection(page);
      await expect(page.locator('#engine-status'), 'engine dot never went green without a pasted token')
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      // 2. Restart the engine: NEW token on disk, the tab holds a stale
      // one. The 4001 path must re-fetch and reconnect - no reload.
      engine.kill('SIGKILL');
      await waitUntil(() => { try { return engine!.exitCode !== null; } catch { return true; } }, 5000);
      engine = spawnEngine(projectId, logPath);
      expect(
        await waitUntil(() => {
          try { return tokenOnDisk() !== firstToken; } catch { return false; }
        }, 15000),
        'engine restart never produced a fresh token file',
      ).toBe(true);

      // The tab reconnects: WS drops -> reconnect uses the STALE token ->
      // 4001 -> refresher fetches the fresh one -> green again.
      await expect(page.locator('#engine-status'), 'tab never recovered after engine restart (4001 path)')
        .toHaveAttribute('data-state', 'connected', { timeout: 20000 });
    } finally {
      try { engine?.kill('SIGKILL'); } catch { /* already dead */ }
    }
  });
});
