// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Invariants de la REFONTE « etabli Magic Potion » (T1-T8) + FINITION F7.
 * Verrouille : le commutateur de paradigmes (presentation LOCALE par onglet)
 * et les splitters de colonnes redimensionnables (largeurs persistees).
 * Ces invariants n'existaient pas apres la refonte (scripts jetables) -
 * discipline CLAUDE.md : invariants Playwright verrouilles.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

test.describe('Refonte UI : commutateur de paradigmes (T6)', () => {
  test('Arrangement/Session/Mixage : body[data-paradigm] + persistance localStorage', async ({ page }) => {
    const id = `ui-para-${Date.now()}`;
    await open(page, id);

    // defaut = arrangement
    await expect(page.locator('body')).toHaveAttribute('data-paradigm', 'arrangement');

    // -> Session : l'attribut bascule, la vue Session est visible
    await page.locator('[data-role="paradigm"][data-view="session"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-paradigm', 'session');
    await expect(page.locator('#session-slot')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('daw-paradigm'));
    expect(stored).toBe('session');

    // -> Mixage : la console est visible
    await page.locator('[data-role="paradigm"][data-view="mixage"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-paradigm', 'mixage');
    await expect(page.locator('#mixer-slot')).toBeVisible();

    // PRESENTATION LOCALE : le choix survit au reload (localStorage, pas le doc)
    await page.reload();
    await waitForServerConnection(page);
    await expect(page.locator('body')).toHaveAttribute('data-paradigm', 'mixage');
  });
});

// MODIF DE TEST SIGNALEE (2026-08-26, rack en bas facon Ableton) : la
// colonne .col-rack est devenue le panneau du bas .panel-device - meme
// mecanique d'onglets, autre hote. Intention et assertions inchangees.
test.describe('Refonte UI : onglets Rack / Piano-roll (F7)', () => {
  test('bascule Rack<->Piano + persistance localStorage', async ({ page }) => {
    await open(page, `ui-racktab-${Date.now()}`);
    const col = page.locator('.panel-device');
    await expect(col).toHaveAttribute('data-rack-tab', 'rack');

    await page.locator('[data-role="rack-tab"][data-tab="piano"]').click();
    await expect(col).toHaveAttribute('data-rack-tab', 'piano');
    expect(await page.evaluate(() => localStorage.getItem('daw-rack-tab'))).toBe('piano');

    await page.reload();
    await waitForServerConnection(page);
    await expect(page.locator('.panel-device')).toHaveAttribute('data-rack-tab', 'piano');
  });
});

test.describe('Refonte UI : splitters de colonnes (F7)', () => {
  test('drag redimensionne + persiste en localStorage + survit au reload', async ({ page }) => {
    const id = `ui-split-${Date.now()}`;
    await open(page, id);

    // MODIF DE TEST SIGNALEE (2026-08-26, rack en bas) : la var CSS vit
    // desormais sur le BODY (le panneau bas n'est pas dans .workspace) et
    // il y a 2 splitters (browser vertical + device horizontal) - l'ancien
    // splitter 'rack' a disparu avec la colonne droite.
    const readW = () => page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('--col-browser').trim());
    const readH = () => page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('--row-device').trim());

    await expect(page.locator('.col-split')).toHaveCount(2);
    const before = await readW();

    // drag du splitter browser de +70px
    const sp = page.locator('.col-split[data-split="browser"]');
    const box = (await sp.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();

    const after = await readW();
    expect(parseInt(after)).toBeGreaterThan(parseInt(before));
    const stored = await page.evaluate(() => localStorage.getItem('daw-col-widths'));
    expect(stored).toContain('browser');

    // le splitter HORIZONTAL du panneau bas : glisser vers le HAUT l'agrandit
    const beforeH = await readH();
    const hs = page.locator('.col-split[data-split="device"]');
    const hbox = (await hs.boundingBox())!;
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hbox.x + hbox.width / 2, hbox.y - 60, { steps: 6 });
    await page.mouse.up();
    expect(parseInt(await readH())).toBeGreaterThan(parseInt(beforeH));

    // survit au reload (presentation locale)
    await page.reload();
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]');
    expect(await readW()).toBe(after);
  });
});
