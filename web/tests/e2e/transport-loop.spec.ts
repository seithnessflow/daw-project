// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.1 invariants: LOOPED PLAYBACK AND END-STOP, driven from the tab.
 *
 * Loop is PERFORMANCE state (ADR-002): a WS transport command, never the
 * CRDT. The callback owns the wrap (sample-accurate) and the end-stop;
 * this spec watches both through the 30 Hz telemetry:
 * 1. loop ON  -> the position WRAPS (a strictly decreasing step is seen);
 * 2. loop OFF -> playback STOPS at the end of content (position freezes).
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

/** Parse the transport clock ("m:ss.mmm" or "mm:ss.mmm") to seconds. */
async function positionSec(page: Page): Promise<number> {
  const text = await page.locator('#position').textContent() ?? '0:00.000';
  const m = text.trim().match(/(\d+):(\d+)\.(\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
}

test.describe('Transport loop and end-stop (V1.1)', () => {
  test('loop wraps the position; without loop playback stops at the end', async ({ page }) => {
    test.setTimeout(90000);
    const projectId = `e2e-loop-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-loop-${Date.now()}.log`);
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

      await page.goto(`/?project=${projectId}&lab=1`);
      await waitForServerConnection(page);
      await page.waitForSelector('[data-track-id]', { timeout: 10000 });
      await expect(page.locator('#engine-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      // Content through the UI: one kit clip at ~1 s -> loop braces are
      // short, the wrap arrives within seconds.
      await page.locator('[data-role="sample"]').first().click();
      await page.locator('[data-track-id] .track-lane').first()
        .click({ position: { x: 20, y: 20 } });
      await expect(page.locator('.clip').first()).toBeVisible({ timeout: 10000 });
      await page.locator('[data-role="sample"]').first().click();
      // Let the engine rebuild and refresh the braces
      await expect.poll(() => countInFile(logPath, 'Graph updated'),
        { timeout: 10000 }).toBeGreaterThan(0);

      // 1. Loop ON, play: the clock must WRAP (decrease at least once)
      await page.locator('#loop-btn').click();
      await expect(page.locator('#loop-btn')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#play-btn').click();

      let prev = -1;
      let wrapped = false;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const sec = await positionSec(page);
        if (prev >= 0 && sec < prev - 0.2) { wrapped = true; break; }
        prev = Math.max(prev, sec);
        await page.waitForTimeout(120);
      }
      expect(wrapped, 'position never wrapped with loop ON').toBe(true);

      // 2. Loop OFF: playback stops at end - the clock FREEZES
      await page.locator('#loop-btn').click();
      await expect(page.locator('#loop-btn')).toHaveAttribute('aria-pressed', 'false');
      // Wait until it reaches the end and stops: two consecutive reads
      // equal (helpers.waitUntil is sync-only - inline async loop here)
      let frozen = false;
      const stopDeadline = Date.now() + 30000;
      while (Date.now() < stopDeadline) {
        const a = await positionSec(page);
        await page.waitForTimeout(600);
        const b = await positionSec(page);
        if (b === a && a > 0) { frozen = true; break; }
      }
      expect(frozen, 'playback never froze after loop OFF (end-stop missing)').toBe(true);
    } finally {
      try { engine.kill('SIGKILL'); } catch { /* already dead */ }
    }
  });
});
