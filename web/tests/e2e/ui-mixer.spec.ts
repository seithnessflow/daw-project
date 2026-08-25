// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Invariants de la console Mixage (T8) + pan (F2, cote WEB : ecrit au doc).
 * Une tranche par piste + une tranche MASTER ; le fader ecrit le gain du doc,
 * le pan ecrit track.pan (le moteur applique la loi lineaire, gteste a part).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function openMixage(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
  await page.locator('[data-role="paradigm"][data-view="mixage"]').click();
  await expect(page.locator('#mixer-slot')).toBeVisible();
}

const firstTrackId = (page: Page) =>
  page.evaluate(() => (window as any).__dawProject.getDocument().tracks[0].id as string);
const trackGain = (page: Page, id: string) =>
  page.evaluate((tid) => (window as any).__dawProject.getDocument().tracks.find((t: any) => t.id === tid).gain as number, id);
const trackPan = (page: Page, id: string) =>
  page.evaluate((tid) => ((window as any).__dawProject.getDocument().tracks.find((t: any) => t.id === tid).pan ?? 0) as number, id);

test.describe('Console Mixage (T8) + pan (F2)', () => {
  test('une tranche par piste + MASTER ; fader ecrit le gain ; pan ecrit track.pan', async ({ page }) => {
    const id = `ui-mix-${Date.now()}`;
    await openMixage(page, id);

    const nTracks = await page.evaluate(() => (window as any).__dawProject.getDocument().tracks.length);
    // une tranche par piste + la tranche master
    await expect(page.locator('.mx-strip')).toHaveCount(nTracks + 1);
    await expect(page.locator('.mx-master')).toHaveCount(1);

    const tid = await firstTrackId(page);

    // fader -> gain du doc (0..2). On pose 0.5 et on verifie la convergence doc.
    await page.evaluate((t) => {
      const f = document.querySelector(`.mx-strip .mx-fader`) as HTMLInputElement;
      f.value = '0.5';
      f.dispatchEvent(new Event('input', { bubbles: true }));
    }, tid);
    await expect.poll(() => trackGain(page, tid)).toBeCloseTo(0.5, 2);

    // pan -> track.pan (le master n'a PAS de pan)
    await expect(page.locator('.mx-master .mx-pan-slider')).toHaveCount(0);
    const pan = page.locator(`.mx-pan-slider[data-track-id="${tid}"]`);
    await expect(pan).toHaveCount(1);
    await page.evaluate((t) => {
      const p = document.querySelector(`.mx-pan-slider[data-track-id="${t}"]`) as HTMLInputElement;
      p.value = '-1';
      p.dispatchEvent(new Event('input', { bubbles: true }));
    }, tid);
    await expect.poll(() => trackPan(page, tid)).toBeCloseTo(-1, 2);
  });
});
