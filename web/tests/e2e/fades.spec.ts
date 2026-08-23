// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.6 invariants: fades are VISIBLE, DRAGGABLE, and collab-safe.
 * 1. Dragging the fade-in handle writes the document (the shade
 *    grows) and CONVERGES to tab 2.
 * 2. Handles rule (CLAUDE.md): a plain click on a fade handle SELECTS
 *    the clip - never a silent no-op.
 * 3. Ctrl+Z restores the pre-drag fades (one gesture = one entry).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `fades-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const shadeWidth = (page: Page) =>
  page.locator('.clip .clip-fade-in').first()
    .evaluate((el) => parseFloat((el as HTMLElement).style.width) || 0);

test.describe('Fades (V1.6)', () => {
  test('drag writes and converges, click selects, undo restores', async ({ page, context }) => {
    await openTab(page);

    // Place one clip - the LAST kit sample (riser, the longest): a
    // short clip's corner handles share its width (overlap guard) and
    // this drag test wants clearly separate in/out targets
    await page.locator('[data-role="sample"]').last().click();
    await page.locator('[data-track-id] .track-lane').first()
      .click({ position: { x: 200, y: 30 } });
    await expect(page.locator('.clip')).toHaveCount(1);
    await page.locator('[data-role="sample"]').last().click(); // disarm

    const page2 = await context.newPage();
    await openTab(page2);
    await expect(page2.locator('.clip')).toHaveCount(1);

    // 1. Drag the fade-in handle 30px right
    const handle = page.locator('.clip .fade-handle-in').first();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    // A short kit clip clamps the fade to half its length - the shade
    // is small in px but must be NONZERO and identical across tabs
    await expect.poll(() => shadeWidth(page)).toBeGreaterThan(1);
    const w1 = await shadeWidth(page);
    await expect.poll(() => shadeWidth(page2)).toBe(w1);

    // 2. Plain click on the fade-out handle: the clip gets selected
    await page.locator('.clip .fade-handle-out').first().click();
    await expect(page.locator('.clip[aria-selected="true"]')).toHaveCount(1);

    // 3. Ctrl+Z: the whole drag rolls back to zero fades
    await page.keyboard.press('Control+z');
    await expect.poll(() => shadeWidth(page)).toBe(0);
    await expect.poll(() => shadeWidth(page2)).toBe(0);

    await page2.close();
  });
});
