// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * S8b invariant: THE TRAVERSAL CONNECTS AND MEASURES.
 * Tab A broadcasts, tab B listens; signaling rides the sync server as
 * text; the RTCPeerConnection reaches 'connected' and the DataChannel
 * ping puts a MEASURED latency on both badges. STUN-only loopback.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

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
});
