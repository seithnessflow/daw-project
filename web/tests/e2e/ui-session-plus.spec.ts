// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * F5+ Session performante (cote web, lab sans moteur) : STOP ALL, toggle de
 * launch quantise (Q), gestion des scenes au clic droit (renommer inline,
 * dupliquer avec slots, supprimer avec slots, undo qui restaure tout).
 * Le quantum moteur (ancre, file, promotion) est gteste cote moteur
 * (testSessionQuantizedLaunch).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const sceneCount = (page: Page) =>
  page.evaluate(() => ((window as any).__dawProject.getDocument().scenes ?? []).length);
const slotCount = (page: Page) =>
  page.evaluate(() => (window as any).__dawProject.getDocument()
    .tracks.reduce((n: number, t: any) =>
      n + t.clips.filter((c: any) => c.sceneId).length, 0));

test.describe('Session F5+ : stop-all, quantize, gestion scenes', () => {
  test('stop all coupe tout ; Q commute ; scenes: rename/dupliquer/supprimer/undo', async ({ page }) => {
    await open(page, `ui-sessplus-${Date.now()}`);

    // une scene + un slot sur chacune des 2 premieres pistes
    await page.evaluate(() => {
      const proj = (window as any).__dawProject;
      proj.addScene('Scene 1'); (window as any).__dawFlush?.();
      const d = proj.getDocument();
      proj.addSessionClip(d.tracks[0].id, d.scenes[0].id);
      proj.addSessionClip(d.tracks[1].id, d.scenes[0].id);
      (window as any).__dawFlush?.();
    });
    await page.locator('[data-role="paradigm"][data-view="session"]').click();
    await expect(page.locator('.ss-slot.filled')).toHaveCount(2);

    // Q : actif par defaut, commute et se memorise (aria-pressed)
    const q = page.locator('.ss-quantize');
    await expect(q).toHaveAttribute('aria-pressed', 'true');
    await q.click();
    await expect(q).toHaveAttribute('aria-pressed', 'false');
    await q.click();
    await expect(q).toHaveAttribute('aria-pressed', 'true');

    // lancer la scene -> 2 slots en lecture ; STOP ALL -> 0
    await page.locator('.ss-scene').first().click();
    await expect(page.locator('.ss-slot.playing')).toHaveCount(2);
    await page.locator('.ss-stopall').click();
    await expect(page.locator('.ss-slot.playing')).toHaveCount(0);

    // Renommer la scene (clic droit -> inline)
    await page.locator('.ss-scene').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Renommer' }).click();
    await page.locator('.inline-rename').fill('Intro');
    await page.locator('.inline-rename').press('Enter');
    await expect.poll(() => page.evaluate(() =>
      (window as any).__dawProject.getDocument().scenes[0].name)).toBe('Intro');
    await expect(page.locator('.ss-scene').first()).toHaveText('Intro');

    // Dupliquer : 2 scenes, slots doubles (copies comprises)
    await page.locator('.ss-scene').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Dupliquer la scene' }).click();
    await expect.poll(() => sceneCount(page)).toBe(2);
    await expect.poll(() => slotCount(page)).toBe(4);
    await expect(page.locator('.ss-scene').nth(1)).toHaveText('Intro (copie)');

    // Supprimer la COPIE (et ses slots)
    await page.locator('.ss-scene').nth(1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Supprimer la scene (et ses slots)' }).click();
    await expect.poll(() => sceneCount(page)).toBe(1);
    await expect.poll(() => slotCount(page)).toBe(2);

    // Undo : la scene ET ses slots reviennent
    await page.keyboard.press('Control+z');
    await expect.poll(() => sceneCount(page)).toBe(2);
    await expect.poll(() => slotCount(page)).toBe(4);
  });
});
