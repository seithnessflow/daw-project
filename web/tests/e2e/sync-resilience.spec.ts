// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Critere-3-vraiment-vrai guards (AUDIT-4 trio + heartbeat).
 * 1. A4-2: a change with missing dependencies is SURFACED (applyChange
 *    false - Automerge buffers silently, the guard reads getMissingDeps),
 *    and integrates once the dependency arrives.
 * 2. A4-4: the server heartbeats (text "hb") so a tab can detect a
 *    zombie socket.
 * 3. A4-3: edits made while the server is DOWN survive its arrival -
 *    the vendored seed gives placeholder and server the same root, the
 *    reconnection merges and pushes; a second tab sees the edit.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection, REPO_ROOT } from './helpers';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as Automerge from '@automerge/automerge';
import { seedBytes } from '../../src/document/seed';

const b64 = (u8: Uint8Array) => Buffer.from(u8).toString('base64');

test.describe('Sync resilience (critere 3 round 2)', () => {
  test('missing deps surfaced, then integrate in order', async ({ page }) => {
    await page.goto(`/?project=deps-${Date.now()}&lab=1`);
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]');

    // Two dependent changes on the SEED root (the server seeds new
    // projects from the same bytes, so c1's deps are already present)
    let doc = Automerge.load<any>(seedBytes());
    doc = Automerge.change(doc, (d) => { d.sampleRate = 44100; });
    const c1 = Automerge.getLastLocalChange(doc)!;
    doc = Automerge.change(doc, (d) => { d.sampleRate = 96000; });
    const c2 = Automerge.getLastLocalChange(doc)!;

    const apply = (b: string) => page.evaluate((bb) => {
      const bin = atob(bb);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return (window as any).__dawProject.applyChange(bytes);
    }, b);

    // Out of order: c2 alone = buffered = MUST return false (the old
    // code returned true and the tab silently diverged)
    expect(await apply(b64(c2))).toBe(false);
    // The dependency arrives: both integrate, the document converges
    expect(await apply(b64(c1))).toBe(true);
    const sr = await page.evaluate(() =>
      (window as any).__dawProject.getDocument().sampleRate);
    expect(sr).toBe(96000);
  });

  test('server heartbeats reach the tab', async ({ page }) => {
    const sawHeartbeat = new Promise<string>((resolve) => {
      page.on('websocket', (ws) => {
        if (!ws.url().includes(':3000')) return;
        ws.on('framereceived', (frame) => {
          if (typeof frame.payload === 'string' && frame.payload === 'hb') {
            resolve(frame.payload);
          }
        });
      });
    });
    await page.goto(`/?project=hb-${Date.now()}&lab=1`);
    await waitForServerConnection(page);
    // The server beats every 15 s
    expect(await Promise.race([
      sawHeartbeat,
      new Promise<string>((r) => setTimeout(() => r('TIMEOUT'), 25000)),
    ])).toBe('hb');
  });

  test('offline edits survive the server starting later', async ({ page, context }) => {
    const port = 39917;
    const projectId = `offline-${Date.now()}`;
    const storeDir = path.join(REPO_ROOT, 'web', 'test-results', `offline-store-${Date.now()}`);
    fs.mkdirSync(storeDir, { recursive: true });
    const serverBin = path.join(REPO_ROOT, 'server', 'target', 'debug',
      process.platform === 'win32' ? 'daw-server.exe' : 'daw-server');
    test.skip(!fs.existsSync(serverBin), 'server binary not built');

    let child: ChildProcess | null = null;
    try {
      // 1. Server DOWN: the page shows the seed placeholder and stays
      // editable (Track 1/2 come from the vendored seed)
      await page.goto(`/?project=${projectId}&lab=1&server=ws://127.0.0.1:${port}`);
      await page.waitForSelector('[data-track-id]', { timeout: 10000 });
      await expect(page.locator('#server-status')).toHaveAttribute('data-state', 'disconnected');

      // Edit offline: add a third track (pure document op)
      // MODIF DE TEST SIGNALEE (2026-08-26) : `.track[data-track-id]` au lieu
      // de `[data-track-id]` - depuis T8 la console Mixage (toujours dans le
      // DOM) porte data-track-id sur ses VU/pins ; le selecteur nu comptait
      // 10 elements pour 3 pistes. L'intention (nombre de PISTES) et le
      // compte attendu sont inchanges.
      await page.locator('#add-track-btn').click();
      await expect(page.locator('.track[data-track-id]')).toHaveCount(3);

      // 2. The server ARRIVES (fresh store: it seeds the project)
      child = spawn(serverBin, [], {
        cwd: storeDir,
        env: { ...process.env, DAW_SERVER_PORT: String(port) },
        stdio: 'ignore',
      });
      // Reconnect cycle is 3 s; merge + push follow
      await expect(page.locator('#server-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      // 3. NOTHING lost locally...
      await expect(page.locator('.track[data-track-id]')).toHaveCount(3);
      // ...and the server HOLDS the offline edit: a second tab sees it
      const page2 = await context.newPage();
      await page2.goto(`/?project=${projectId}&lab=1&server=ws://127.0.0.1:${port}`);
      await expect(page2.locator('#server-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });
      await expect(page2.locator('.track[data-track-id]')).toHaveCount(3, { timeout: 10000 });
      await page2.close();
    } finally {
      child?.kill();
    }
  });
});
