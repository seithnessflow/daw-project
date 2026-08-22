// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Potion C2 invariant: TWO TABS DURING A DRAG - convergence without
 * trembling. A clip dragged in tab A must land at the same position in
 * tab B, and once the pointer is released the document must go QUIET
 * (no writes after pointerup: coalescing means the gesture ends, not
 * echoes). Resize converges the same way.
 *
 * Isolated project per run; content is created through the UI itself
 * (add track + KIT placement) - the document road end to end. The kit
 * ASSETS may be absent from a fresh CI store: irrelevant here, this
 * invariant is about document geometry, not audio.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `drag-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

function clipGeom(page: Page, trackIndex = 0) {
  return page.evaluate((ti) => {
    const d = (window as any).__dawProject.getDocument();
    const c = d.tracks[ti].clips[0];
    return c ? { start: c.startSample, len: c.lengthSamples, off: c.offsetSamples } : null;
  }, trackIndex);
}

test.describe('Clip drag convergence (two tabs)', () => {
  test('drag in A lands identically in B, document quiet after release', async ({ context, page }) => {
    const A = page;
    const B = await context.newPage();
    await openTab(A);
    await openTab(B);

    // Content through the UI: arm a kit sample, place it on track 1
    await A.locator('[data-role="sample"]').first().click();
    await A.locator('[data-track-id] .track-lane').first()
      .click({ position: { x: 200, y: 20 } });
    await expect(A.locator('.clip').first()).toBeVisible({ timeout: 10000 });
    await expect(B.locator('.clip').first()).toBeVisible({ timeout: 10000 });

    // Drag by the title bar in A (steps: the coalesced live road)
    const handle = A.locator('[data-role="clip-handle"]').first();
    const box = (await handle.boundingBox())!;
    await A.mouse.move(box.x + 15, box.y + 5);
    await A.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await A.mouse.move(box.x + 15 + i * 12, box.y + 5);
      await A.waitForTimeout(30);
    }
    await A.mouse.up();

    // A's document settles; B converges to the SAME geometry
    await A.waitForTimeout(400);
    const geomA = await clipGeom(A);
    expect(geomA!.start).toBeGreaterThan(0);
    await expect.poll(async () => (await clipGeom(B))?.start, {
      timeout: 10000, message: 'tab B never converged to the dragged position',
    }).toBe(geomA!.start);

    // QUIET after release: no stray writes (heads stable a full second)
    const headsA1 = await A.evaluate(() =>
      JSON.stringify((window as any).__dawProject.getHeads()));
    await A.waitForTimeout(1000);
    const headsA2 = await A.evaluate(() =>
      JSON.stringify((window as any).__dawProject.getHeads()));
    expect(headsA2, 'document kept changing after pointerup').toBe(headsA1);

    // Resize by the right edge in A; B converges on all three fields
    const edge = A.locator('.clip-edge-right').first();
    const ebox = (await edge.boundingBox())!;
    await A.mouse.move(ebox.x + 3, ebox.y + 20);
    await A.mouse.down();
    await A.mouse.move(ebox.x + 3 + 80, ebox.y + 20, { steps: 6 });
    await A.mouse.up();
    await A.waitForTimeout(400);
    const resizedA = await clipGeom(A);
    expect(resizedA!.len).toBeGreaterThan(geomA!.len);
    await expect.poll(async () => JSON.stringify(await clipGeom(B)), {
      timeout: 10000, message: 'tab B never converged after resize',
    }).toBe(JSON.stringify(resizedA));

    await B.close();
  });
});
