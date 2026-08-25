// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Invariants du clic droit CONTEXTUEL : le menu s'adapte a la zone (clip,
 * piste, device, slot Session) et ses actions mutent le document.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const clipCount = (page: Page) =>
  page.evaluate(() => (window as any).__dawProject.getDocument()
    .tracks.reduce((n: number, t: any) => n + t.clips.length, 0));

const menuLabels = (page: Page) =>
  page.$$eval('.ctx-menu .ctx-item', (els) => els.map((e) => e.textContent));

test.describe('Clic droit contextuel', () => {
  test('le menu s\'adapte a la zone ; Dupliquer/Supprimer un clip mutent le doc', async ({ page }) => {
    await open(page, `ui-ctx-${Date.now()}`);

    // poser un clip (kit lab)
    await page.locator('[data-role="sample"]').first().click();
    await page.locator('[data-track-id] .track-lane').first().click({ position: { x: 200, y: 20 } });
    await expect(page.locator('.clip').first()).toBeVisible({ timeout: 10000 });
    await page.locator('[data-role="sample"]').first().click();  // disarm

    // clic droit sur le CLIP -> Dupliquer / Supprimer
    await page.locator('.clip').first().click({ button: 'right', force: true });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    expect(await menuLabels(page)).toEqual(expect.arrayContaining(['Dupliquer', 'Supprimer']));

    const before = await clipCount(page);
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect.poll(() => clipCount(page)).toBe(before + 1);

    // clic droit sur la TETE de piste -> actions de piste (pas de clip)
    await page.locator('.tracks [data-track-id]').first()
      .click({ button: 'right', position: { x: 70, y: 10 }, force: true });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    expect(await menuLabels(page)).toEqual(
      expect.arrayContaining(['Muter', 'Solo', 'Supprimer la piste']));

    // Echap ferme le menu
    await page.keyboard.press('Escape');
    await expect(page.locator('.ctx-menu')).toHaveCount(0);

    // Supprimer via le menu ramene au compte initial
    await page.locator('.clip').first().click({ button: 'right', force: true });
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await expect.poll(() => clipCount(page)).toBe(before);
  });
});
