// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Renommage piste/clip au clic droit (2026-08-26) : l'entree "Renommer"
 * ouvre un input inline, Entree ecrit le document (renameTrack/renameClip),
 * Echap annule, Ctrl+Z restaure ; un clip MIDI n'affiche jamais son id brut.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const docTrackName = (page: Page) =>
  page.evaluate(() => (window as any).__dawProject.getDocument().tracks[0].name);

test.describe('Renommer au clic droit', () => {
  test('piste et clip se renomment inline ; undo restaure ; pas d\'id brut', async ({ page }) => {
    await open(page, `ui-ren-${Date.now()}`);

    // ---- PISTE : Renommer -> input inline -> Entree ecrit le doc ----
    const before = await docTrackName(page);
    await page.locator('.tracks [data-track-id]').first()
      .click({ button: 'right', position: { x: 70, y: 10 }, force: true });
    await page.getByRole('menuitem', { name: 'Renommer' }).click();
    const input = page.locator('.inline-rename');
    await expect(input).toBeVisible();
    await input.fill('Batterie');
    await input.press('Enter');
    await expect.poll(() => docTrackName(page)).toBe('Batterie');
    await expect(page.locator('.track-name').first()).toHaveText('Batterie');

    // Echap = annulation (le doc ne bouge pas)
    await page.locator('.tracks [data-track-id]').first()
      .click({ button: 'right', position: { x: 70, y: 10 }, force: true });
    await page.getByRole('menuitem', { name: 'Renommer' }).click();
    await page.locator('.inline-rename').fill('Oubli');
    await page.locator('.inline-rename').press('Escape');
    await expect.poll(() => docTrackName(page)).toBe('Batterie');

    // Ctrl+Z : le rename est undo-journalise
    await page.keyboard.press('Control+z');
    await expect.poll(() => docTrackName(page)).toBe(before);

    // ---- CLIP : un clip MIDI n'affiche jamais son id aleatoire ----
    await page.locator('.tracks [data-track-id]').first()
      .click({ button: 'right', position: { x: 70, y: 10 }, force: true });
    await page.getByRole('menuitem', { name: '+ clip MIDI' }).click();
    // le seed peut deja porter des clips : cibler le NOTRE par id (dernier)
    const midiId = await page.evaluate(() => {
      const t = (window as any).__dawProject.getDocument().tracks[0];
      return t.clips[t.clips.length - 1].id;
    });
    const strip = page.locator(`[data-clip-id="${midiId}"] .clip-name`);
    await expect(strip).toHaveText('MIDI');

    // Renommer le clip -> doc + affichage
    await page.locator(`[data-clip-id="${midiId}"]`)
      .click({ button: 'right', force: true });
    await page.getByRole('menuitem', { name: 'Renommer' }).click();
    await page.locator('.inline-rename').fill('Groove A');
    await page.locator('.inline-rename').press('Enter');
    await expect(strip).toHaveText('Groove A');
    const clipName = await page.evaluate((id) => (window as any).__dawProject
      .getDocument().tracks[0].clips.find((c: any) => c.id === id).name, midiId);
    expect(clipName).toBe('Groove A');

    // Ctrl+Z : retour au nom derive
    await page.keyboard.press('Control+z');
    await expect(strip).toHaveText('MIDI');
  });
});
