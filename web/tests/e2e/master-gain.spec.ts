// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * V1.2 invariants: THE MASTER STRIP IS DOCUMENT STATE.
 * The master fader writes doc.masterGain (additive root field, absent =
 * 1.0) and converges between tabs exactly like a track gain (criterion 3
 * pattern). The engine-side application is proven by gtest
 * (testMasterGainRender: exact halving); the VU path is proto-typed and
 * exercised live, not here (no engine in this spec).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `master-${Date.now()}`;

async function openTab(page: Page): Promise<void> {
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const docMaster = (page: Page) =>
  page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return typeof d.masterGain === 'number' ? d.masterGain : null;
  });

test.describe('Master gain (V1.2)', () => {
  test('fader writes the document and converges to the other tab', async ({ context, page }) => {
    const A = page;
    const B = await context.newPage();
    await openTab(A);
    await openTab(B);

    // The strip exists with its default reading
    await expect(A.locator('#master-strip')).toBeVisible();
    await expect(A.locator('#master-db')).toHaveText('0.0 dB');

    // Move the master in A: document written, clamped domain respected
    await A.locator('#master-gain').fill('0.5');
    await expect.poll(() => docMaster(A), { timeout: 5000 }).toBe(0.5);
    await expect(A.locator('#master-db')).toHaveText('-6.0 dB');

    // B converges: document AND display
    await expect.poll(() => docMaster(B), {
      timeout: 10000, message: 'tab B never converged on masterGain',
    }).toBe(0.5);
    await expect(B.locator('#master-db')).toHaveText('-6.0 dB');
    await expect(B.locator('#master-gain')).toHaveValue('0.5');

    await B.close();
  });
});
