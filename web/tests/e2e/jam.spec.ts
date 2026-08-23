// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * S8b invariant: THE TRAVERSAL CONNECTS AND MEASURES.
 * Tab A broadcasts, tab B listens; signaling rides the sync server as
 * text; the RTCPeerConnection reaches 'connected' and the DataChannel
 * ping puts a MEASURED latency on both badges. STUN-only loopback.
 */
import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForServerConnection, resolveBinary, waitUntil, countInFile } from './helpers';

const projectId = `jam-${Date.now()}`;

async function openTab(page: Page, mode: string): Promise<void> {
  await page.goto(`/?project=${projectId}&lab=1&jam=${mode}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

test.describe('Jam traversal (S8b)', () => {
  test('broadcast + listen connect and measure latency', async ({ page, context }) => {
    test.setTimeout(60000);
    await openTab(page, 'broadcast');
    const listener = await context.newPage();
    await openTab(listener, 'listen');

    // Both sides reach one connected peer
    for (const [name, p] of [['broadcaster', page], ['listener', listener]] as const) {
      await expect.poll(async () =>
        p.evaluate(() => (window as any).__dawJam.peerCount()),
        { timeout: 20000, message: `${name} never connected` }).toBe(1);
    }

    // The ping measured a latency and the badge SAYS it
    await expect.poll(async () =>
      page.evaluate(() => [...(window as any).__dawJam.latencyMs.values()][0]),
      { timeout: 15000 }).toBeGreaterThanOrEqual(0);
    await expect(page.locator('#jam-status')).toContainText('diffuse 1 pair(s)');
    await expect(listener.locator('#jam-status')).toContainText('ecoute 1 pair(s)');
    await expect(page.locator('#jam-status')).toContainText('ms');

    // Clean shutdown: the broadcaster stops, the listener sees it leave
    await page.locator('#jam-btn').click();
    await expect.poll(async () =>
      listener.evaluate(() => (window as any).__dawJam.peerCount()),
      { timeout: 10000 }).toBe(0);

    await listener.close();
  });

  /**
   * S8c: AUDIO FRAMES CROSS THE PIPE. With the real engine tapped,
   * the broadcaster's outgoing MediaStream rides the connection and
   * the listener's remote audio track UNMUTES - Chromium flips
   * track.muted to false exactly when RTP frames arrive. That is the
   * by-construction proof the jam audio flows end to end.
   */
  test('audio frames reach the listener (real engine)', async ({ page, context }) => {
    test.setTimeout(90000);
    const proj = `jamaudio-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-jam-${Date.now()}.log`);
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const logFd = fs.openSync(logPath, 'w');
    const engine: ChildProcess = spawn(
      engineExe,
      ['--server', 'ws://localhost:3000', '--project', proj,
       '--play', '--mute', '--ws-port', '47821'],
      { stdio: ['ignore', logFd, logFd] },
    );
    fs.closeSync(logFd);
    try {
      expect(
        await waitUntil(() => countInFile(logPath, 'WebSocket server') >= 1, 15000),
        'engine WS never came up').toBe(true);

      const bcast = page;
      await bcast.goto(`/?project=${proj}&lab=1&jam=broadcast`);
      await waitForServerConnection(bcast);
      await expect(bcast.locator('#engine-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      const listener = await context.newPage();
      await listener.goto(`/?project=${proj}&lab=1&jam=listen`);
      await waitForServerConnection(listener);

      await expect.poll(async () =>
        listener.evaluate(() => (window as any).__dawJam.peerCount()),
        { timeout: 20000 }).toBe(1);

      // The remote track exists AND unmutes (frames arriving)
      await expect.poll(async () => listener.evaluate(() => {
        const el = (window as any).__dawJamAudio.remoteEl;
        const track = el?.srcObject?.getAudioTracks?.()[0];
        return track ? `${track.readyState}/${track.muted}` : 'none';
      }), { timeout: 20000 }).toBe('live/false');

      await listener.close();
    } finally {
      engine.kill();
    }
  });
});
