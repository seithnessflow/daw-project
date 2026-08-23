// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Session B invariants (2026-08-23): SELECTION IS VISIBLE, DELETE ACTS.
 * Born from the music session: a click on a tiny clip landed on its
 * resize edge, selected NOTHING (the edge's plain-click branch did not
 * exist), and Delete silently did nothing - the user believed the app.
 *
 * Guards:
 * 1. Plain click on the title bar selects (aria-selected in the DOM).
 * 2. Plain click on a resize EDGE selects too (the missing branch).
 * 3. Lane click deselects AND the DOM says so (no lying visual).
 * 4. Delete removes the selected clip - from the DOM and the document.
 * 5. Delete with no selection changes nothing (heads stable).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `select-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const heads = (page: Page) =>
  page.evaluate(() => JSON.stringify((window as any).__dawProject.getHeads()));
const clipCount = (page: Page) =>
  page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.reduce((n: number, t: any) => n + t.clips.length, 0);
  });

test.describe('Clip selection and delete (session B)', () => {
  test('select by handle, select by edge, deselect visibly, delete for real', async ({ page }) => {
    await openTab(page);

    // Content through the UI: arm a kit sample, place one clip
    await page.locator('[data-role="sample"]').first().click();
    await page.locator('[data-track-id] .track-lane').first()
      .click({ position: { x: 200, y: 20 } });
    await expect(page.locator('.clip').first()).toBeVisible({ timeout: 10000 });
    // Disarm so subsequent lane clicks are selection clicks, not placements
    await page.locator('[data-role="sample"]').first().click();

    // 1. Plain click on the title bar -> selected, visible in the DOM
    await page.locator('[data-role="clip-handle"]').first().click();
    await expect(page.locator('.clip[aria-selected="true"]')).toHaveCount(1);

    // 3. Lane click far away -> deselected AND the DOM says so
    await page.locator('[data-track-id] .track-lane').first()
      .click({ position: { x: 500, y: 20 } });
    await expect(page.locator('.clip[aria-selected="true"]')).toHaveCount(0);

    // 2. Plain click on a resize EDGE -> selects (the missing branch)
    const edge = page.locator('.clip-edge-right').first();
    const ebox = (await edge.boundingBox())!;
    await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2);
    await page.mouse.down();
    await page.mouse.up();   // no movement: a plain click
    await expect(page.locator('.clip[aria-selected="true"]')).toHaveCount(1);

    // 4. Delete removes the clip - DOM and document
    expect(await clipCount(page)).toBe(1);
    await page.keyboard.press('Delete');
    await expect(page.locator('.clip')).toHaveCount(0);
    await expect.poll(() => clipCount(page), { timeout: 5000 }).toBe(0);

    // 5. Delete with no selection is a no-op on the document
    const h1 = await heads(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    expect(await heads(page), 'Delete with no selection wrote to the document').toBe(h1);
  });
});
