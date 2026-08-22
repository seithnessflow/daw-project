// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Magic Potion phase 2 — the life layer's contract with the harness:
 * everything it owns is aria-hidden and pointer-events:none, so test
 * selectors CANNOT see it and the mouse CANNOT touch it. The document
 * invariants keep passing WITH the layer active (that is the rest of
 * this suite); the no-document-write rule is proven by grep at session
 * close (life.ts imports no document API).
 */
import { test, expect } from '@playwright/test';
import { waitForServerConnection } from './helpers';

test('life layer is invisible to the harness and untouchable', async ({ page }) => {
  await page.goto(`/?project=life-${Date.now()}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  const status = page.locator('#life-status');
  await expect(status).toHaveAttribute('aria-hidden', 'true');
  const pe = await status.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pe, '#life-status must be untouchable').toBe('none');

  // No accessible leaks: every life-owned element sits under aria-hidden
  const leaks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#life-status, .meter-peak'))
      .filter((el) => !el.closest('[aria-hidden="true"]'))
      .map((el) => el.id || el.className));
  expect(leaks, 'life elements outside aria-hidden').toEqual([]);

  // The document layer stays reachable THROUGH where the layer lives:
  // the gain fader still receives clicks (contracts unbroken)
  const gain = page.locator('[data-role="gain"]').first();
  await gain.click();
  await expect(gain).toBeFocused();
});
