// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * L1a invariant: THE SESSION CLOCK MEASURES.
 * Two tabs on the same project estimate each other's clock offset over
 * the signal relay. Same machine, same performance.now() epoch per
 * process - the estimate must be small and the rtt sane. The badge
 * appears once a peer answers.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `clk-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

test.describe('Session clock (Link L1a)', () => {
  test('two tabs measure each other: offset bounded, rtt sane, badge shown', async ({ page, context }) => {
    test.setTimeout(60000);
    await openTab(page);
    const other = await context.newPage();
    await openTab(other);

    // Both sides accumulate samples about exactly one peer
    for (const [name, p] of [['tab A', page], ['tab B', other]] as const) {
      await expect.poll(async () =>
        p.evaluate(() => {
          const snap = (window as any).__dawClock.snapshot();
          const ids = Object.keys(snap);
          return ids.length === 1 ? snap[ids[0]].samples : 0;
        }),
        { timeout: 20000, message: `${name} never heard its peer` },
      ).toBeGreaterThanOrEqual(3);
    }

    // performance.now() has a PER-TAB epoch (timeOrigin = page load),
    // so two tabs opened moments apart REALLY are offset by that gap -
    // the first version of this assertion expected ~0 and was wrong
    // (measured: the exact load-time gap, 580 ms). The true invariants:
    // (1) symmetry - A's estimate of B negates B's estimate of A;
    // (2) ground truth - same machine, timeOrigin difference IS the
    //     offset; the estimate must agree within transport jitter.
    const read = (p: Page) => p.evaluate(() => {
      const snap = (window as any).__dawClock.snapshot();
      const vals = Object.values(snap) as Array<{ offsetMs: number; rttMs: number }>;
      return { off: vals[0].offsetMs, rtt: vals[0].rttMs,
               origin: performance.timeOrigin };
    });
    const a = await read(page);
    const b = await read(other);
    expect(Math.abs(a.off + b.off)).toBeLessThan(50);
    expect(Math.abs(a.off - (a.origin - b.origin))).toBeLessThan(50);
    for (const c of [a, b]) {
      expect(c.rtt).toBeGreaterThanOrEqual(0);
      expect(c.rtt).toBeLessThan(5000);
    }

    // The badge says it, on both tabs
    await expect(page.locator('#clk-status')).toContainText('clk');
    await expect(other.locator('#clk-status')).toContainText('ms (1)');

    await other.close();
  });
});
