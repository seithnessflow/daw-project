// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * L1b invariants: TRANSPORT ANCHORS (Link etage 1+3).
 *
 * Two tabs, one project, the real engine on 47821. SYNC is opt-in:
 * 1. ?sync=1 arms the button at load (piloting mode); default is OFF.
 * 2. A tab with SYNC off RECEIVES anchors but never applies them
 *    (counted as ignored - the positive signal for the negative case).
 * 3. Once armed, a remote PLAY/STOP gesture is applied locally, LWW.
 * 4. TRANSLATION TRUTH: performance.now() has a per-tab epoch (L1a
 *    lesson - 580 ms measured between two tabs), so the applied
 *    position is only right if the sender's timebase was translated
 *    with the estimated offset. Ground truth on one machine:
 *    timeOrigin difference. The applied position must match
 *    posSec + elapsed-in-true-time within clock-estimate error.
 *
 * L1c invariants (second test):
 * 5. REJOIN - a tab arming SYNC while the performance already plays
 *    adopts it without any new gesture on the playing side (ta:2
 *    request -> fresh directed anchor from the live engine).
 * 6. JAM ARBITRATION (decided 2026-08-24) - a jam listener's local
 *    transport is suspended: engine stopped, PLAY gated and announced,
 *    incoming anchors counted (suppressed) but never applied.
 *
 * Needs the real engine on the page's port (47821): cannot share the
 * machine with an interactive stack (same constraint as token spec).
 */
import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForServerConnection, resolveBinary, waitUntil, countInFile } from './helpers';

const ENGINE_PORT = 47821;

type SyncSnap = {
  enabled: boolean; published: number; applied: number; ignored: number;
  lastPublished: { playing: boolean; posSec: number; t: number } | null;
  lastApplied: { playing: boolean; posSec: number; appliedAtLocal: number } | null;
};

const readSync = (p: Page): Promise<SyncSnap> =>
  p.evaluate(() => (window as any).__dawSync.snapshot());

async function openTab(p: Page, projectId: string, sync: boolean): Promise<void> {
  await p.goto(`/?project=${projectId}&lab=1${sync ? '&sync=1' : ''}`);
  await waitForServerConnection(p);
  await p.waitForSelector('[data-track-id]', { timeout: 10000 });
  await expect(p.locator('#engine-status'))
    .toHaveAttribute('data-state', 'connected', { timeout: 15000 });
}

test.describe('Transport sync (Link L1b)', () => {
  test('anchors: opt-in respected, PLAY/STOP travel, position translated', async ({ page, context }) => {
    test.setTimeout(120000);
    const projectId = `e2e-tsync-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-tsync-${Date.now()}.log`);
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

      // Tab A armed at load (?sync=1); the deliberate delay before B is
      // NOT a race mask: it CONSTRUCTS the epoch gap that gives the
      // translation assertion its power (gap ~0 would hide a sign bug).
      await openTab(page, projectId, true);
      await new Promise((r) => setTimeout(r, 1200));
      const tabB = await context.newPage();
      await openTab(tabB, projectId, false);

      // 1. Opt-in states: A armed by URL, B off by default
      await expect(page.locator('#sync-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect(tabB.locator('#sync-btn')).toHaveAttribute('aria-pressed', 'false');

      // The L1a clock must have an estimate on both sides before anchors
      // can translate (same wait as clock.spec)
      for (const p of [page, tabB]) {
        await expect.poll(async () =>
          p.evaluate(() => {
            const snap = (window as any).__dawClock.snapshot();
            const ids = Object.keys(snap);
            return ids.length >= 1 ? snap[ids[0]].samples : 0;
          }), { timeout: 20000 }).toBeGreaterThanOrEqual(3);
      }

      // 2. B has SYNC off: A's PLAY is received but NOT applied
      await page.locator('#play-btn').click();
      await expect.poll(async () => (await readSync(page)).published).toBe(1);
      await expect.poll(async () => (await readSync(tabB)).ignored,
        { timeout: 10000 }).toBeGreaterThanOrEqual(1);
      expect((await readSync(tabB)).applied).toBe(0);

      // 3. B arms SYNC; A's STOP then PLAY are applied in order
      await tabB.locator('#sync-btn').click();
      await expect(tabB.locator('#sync-btn')).toHaveAttribute('aria-pressed', 'true');

      await page.locator('#stop-btn').click();
      await expect.poll(async () => (await readSync(tabB)).applied,
        { timeout: 10000 }).toBeGreaterThanOrEqual(1);
      expect((await readSync(tabB)).lastApplied!.playing).toBe(false);

      const before = (await readSync(tabB)).applied;
      await page.locator('#play-btn').click();
      await expect.poll(async () => (await readSync(tabB)).applied,
        { timeout: 10000 }).toBeGreaterThan(before);
      const a = await readSync(page);
      const b = await readSync(tabB);
      expect(b.lastApplied!.playing).toBe(true);

      // 4. Translation truth: applied pos == published pos + elapsed in
      // TRUE time (timeOrigin difference = the real offset, same machine)
      const originA = await page.evaluate(() => performance.timeOrigin);
      const originB = await tabB.evaluate(() => performance.timeOrigin);
      expect(Math.abs(originB - originA)).toBeGreaterThan(1000);
      const elapsedTrueSec =
        ((b.lastApplied!.appliedAtLocal + originB) -
         (a.lastPublished!.t + originA)) / 1000;
      const expected = a.lastPublished!.posSec + elapsedTrueSec;
      expect(Math.abs(b.lastApplied!.posSec - expected)).toBeLessThan(0.2);

      await tabB.close();
    } finally {
      try { engine.kill('SIGKILL'); } catch { /* already dead */ }
    }
  });

  test('L1c: late tab rejoins mid-playback; jam listening suspends the transport', async ({ page, context }) => {
    test.setTimeout(120000);
    const projectId = `e2e-tsync-l1c-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-tsync-l1c-${Date.now()}.log`);
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

      // Tab A: content (a kit clip, as transport-loop does), loop ON so
      // the engine KEEPS playing (empty projects end-stop immediately
      // and a stopped peer does not answer rejoin requests - by design)
      await openTab(page, projectId, true);
      await page.locator('[data-role="sample"]').first().click();
      await page.locator('[data-track-id] .track-lane').first()
        .click({ position: { x: 20, y: 20 } });
      await expect(page.locator('.clip').first()).toBeVisible({ timeout: 10000 });
      await page.locator('[data-role="sample"]').first().click();
      await expect.poll(() => countInFile(logPath, 'Graph updated'),
        { timeout: 10000 }).toBeGreaterThan(0);
      await page.locator('#loop-btn').click();
      await page.locator('#play-btn').click();
      await expect.poll(async () => (await readSync(page)).published).toBe(1);

      // 5. REJOIN: B arrives LATE, arms sync at load, adopts the
      // running performance without any new gesture on A
      const tabB = await context.newPage();
      await openTab(tabB, projectId, true);
      await expect.poll(async () => (await readSync(tabB)).applied,
        { timeout: 20000 }).toBeGreaterThanOrEqual(1);
      const joined = await readSync(tabB);
      expect(joined.lastApplied!.playing).toBe(true);

      // 6. JAM ARBITRATION: B starts listening - transport suspended,
      // announced, and incoming anchors suppressed
      await tabB.evaluate(() => (window as any).__dawJam.startListen());
      await expect(tabB.locator('#jam-status'))
        .toContainText('lecture locale suspendue');
      await expect(tabB.locator('#play-btn')).toBeDisabled();

      const before = await readSync(tabB);
      await page.locator('#stop-btn').click();   // A's gesture -> anchor
      await expect.poll(async () => (await readSync(tabB)).suppressed,
        { timeout: 10000 }).toBeGreaterThanOrEqual(1);
      expect((await readSync(tabB)).applied).toBe(before.applied);

      // Leaving the jam gives the transport back (manual resume)
      await tabB.evaluate(() => (window as any).__dawJam.stop());
      await expect(tabB.locator('#play-btn')).toBeEnabled();

      await tabB.close();
    } finally {
      try { engine.kill('SIGKILL'); } catch { /* already dead */ }
    }
  });
});
