// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.4 invariants: WHAT THE DAW KNOWS, THE SCREEN SAYS.
 * 1. The snap grid is DRAWN (CSS vars follow snapStep x zoom).
 * 2. "?" opens the shortcuts panel (and Escape closes it).
 * 3. The lane click's three effects are announced: marker flash,
 *    follow-paused state on the follow button.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `visib-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const gridVar = (page: Page, name: string) =>
  page.evaluate((n) =>
    document.getElementById('tracks')!.style.getPropertyValue(n), name);

test.describe('Visibility (V1.4)', () => {
  test('grid drawn and zoom-refined, help panel, announced click effects', async ({ page }) => {
    await openTab(page);

    // 1. Grid vars: pps=20, snap=0.25s -> fine 5px, strong 20px
    await expect.poll(() => gridVar(page, '--grid-fine-px')).toBe('5px');
    await expect.poll(() => gridVar(page, '--grid-sec-px')).toBe('20px');

    // Zoom in: the grid refines with the zoom (pps 25 -> fine 6.25px)
    await page.keyboard.press('+');
    await expect.poll(() => gridVar(page, '--grid-fine-px')).toBe('6.25px');
    await page.keyboard.press('-');  // back to 20pps

    // 2. The "?" panel: opens, lists the shortcuts, Escape closes
    await page.keyboard.press('Shift+Slash');  // types '?'
    await expect(page.locator('#help-overlay')).toBeVisible();
    await expect(page.locator('#help-overlay')).toContainText('Ctrl+Z');
    await expect(page.locator('#help-overlay')).toContainText('Dupliquer');
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-overlay')).toBeHidden();
    // ...and the button opens it too
    await page.locator('#help-btn').click();
    await expect(page.locator('#help-overlay')).toBeVisible();
    await page.keyboard.press('Escape');

    // 3. Lane click: marker flashes, follow says "paused"
    await page.locator('[data-track-id] .track-lane').first()
      .click({ position: { x: 300, y: 20 } });
    await expect(page.locator('#insert-marker')).toHaveClass(/flash/);
    await expect(page.locator('#follow-btn')).toHaveClass(/follow-paused/);
    // Follow button click clears the pause announcement
    await page.locator('#follow-btn').click();  // toggles follow off
    await expect(page.locator('#follow-btn')).not.toHaveClass(/follow-paused/);
  });
});
