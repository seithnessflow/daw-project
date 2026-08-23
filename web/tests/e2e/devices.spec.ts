// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.5 invariants: devices are ADDED and REMOVED from the UI.
 * 1. + device -> gain (builtin): panel appears, and CONVERGES to tab 2.
 * 2. An invalid vst3 uid never reaches the document (field flags, no add).
 * 3. A valid uid (AGain prefill) adds a vst3 device.
 * 4. Removal is two-step (armed then fired) and converges.
 * 5. Ctrl+Z restores the removed device AT ITS POSITION (chain order
 *    is a pipeline - the undo test asserts order, not just presence).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `devices-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const deviceNames = (page: Page) =>
  page.locator('#device-view .device-name').allTextContents();

test.describe('Devices (V1.5)', () => {
  test('add, refuse bad uid, remove armed, undo restores order', async ({ page, context }) => {
    await openTab(page);
    const page2 = await context.newPage();
    await openTab(page2);

    // 1. + device -> gain (builtin)
    await page.locator('#add-device-btn').click();
    await expect(page.locator('#device-add-menu')).toBeVisible();
    await page.locator('[data-role="add-gain"]').click();
    await expect(page.locator('#device-view .device')).toHaveCount(1);
    await expect(page.locator('#device-view .device-name').first())
      .toHaveText('builtin.gain');
    // ...and tab 2 converges (same default-selected track)
    await expect(page2.locator('#device-view .device')).toHaveCount(1);

    // 2. Invalid uid: flagged, nothing added
    await page.locator('#add-device-btn').click();
    await page.locator('#vst3-uid-input').fill('not-a-uid');
    await page.locator('[data-role="add-vst3"]').click();
    await expect(page.locator('#vst3-uid-input')).toHaveClass(/invalid/);
    await expect(page.locator('#device-view .device')).toHaveCount(1);

    // 3. Valid uid (the AGain prefill)
    await page.locator('#vst3-uid-input')
      .fill('84E8DE5F92554F5396FAE4133C935A18');
    await page.locator('[data-role="add-vst3"]').click();
    await expect(page.locator('#device-view .device')).toHaveCount(2);
    expect(await deviceNames(page)).toEqual(['builtin.gain', 'AGain (vst3)']);
    await expect(page2.locator('#device-view .device')).toHaveCount(2);

    // 4. Remove the FIRST device: click one ARMS, click two fires
    const rmFirst = page.locator('[data-role="remove-device"]').first();
    await rmFirst.click();
    await expect(rmFirst).toHaveClass(/armed/);
    await expect(page.locator('#device-view .device')).toHaveCount(2);  // armed != removed
    await rmFirst.click();
    await expect(page.locator('#device-view .device')).toHaveCount(1);
    expect(await deviceNames(page)).toEqual(['AGain (vst3)']);
    await expect(page2.locator('#device-view .device')).toHaveCount(1);

    // 5. Ctrl+Z: the gain device comes back FIRST (original index)
    await page.keyboard.press('Control+z');
    await expect(page.locator('#device-view .device')).toHaveCount(2);
    expect(await deviceNames(page)).toEqual(['builtin.gain', 'AGain (vst3)']);
    await expect(page2.locator('#device-view .device')).toHaveCount(2);

    await page2.close();
  });
});
