// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Vague « gestes complets » (2026-08-27, demande utilisateur : « le site
 * doit etre complet avec du drag and drop, des menus click droit, etc ») :
 * - le RACK est une cible de drop (geste Ableton) : deposer un instrument
 *   dans la Device View ajoute le device A LA POSITION visee de la chaine ;
 * - clic droit sur un item du navigateur : ajouter a la piste selectionnee /
 *   nouvelle piste avec ce plugin ;
 * - double-clic sur la barre de titre d'un device vst3 = ouvrir/fermer la
 *   fenetre du plugin (le geste decouvrable ; BOX reste).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection, getTrackIds } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const chainOf = (page: Page, trackId: string) =>
  page.evaluate((id) => {
    const t = (window as any).__dawProject.getDocument()
      .tracks.find((x: any) => x.id === id);
    return t ? t.chain.map((p: any) => ({ uid: p.uid, name: p.name })) : [];
  }, trackId);

/** Drop simule (DataTransfer construit en page) d'un instrument sur le
 *  rack. Le point de drop se calcule DANS la page (meme repere que le
 *  produit) : 'before-first' = 20 px a gauche du 1er panneau. Rend le
 *  clientX utilise et les milieux des panneaux (diagnostic). */
const dropInstrumentOnRack = (page: Page, where: 'before-first' | 'end') =>
  page.evaluate((mode) => {
    const dt = new DataTransfer();
    dt.setData('application/x-daw-dnd', JSON.stringify(
      { kind: 'instrument', uid: 'ABCDEF0123456789ABCDEF0123456789', name: 'FakeSynth' }));
    const slot = document.querySelector('#device-view-slot')!;
    const devs = Array.from(document.querySelectorAll(
      '#device-view .device-chain .device[data-proc-id]'));
    const rects = devs.map((d) => d.getBoundingClientRect());
    const x = mode === 'before-first'
      ? Math.max(1, (rects[0]?.left ?? 40) - 20)
      : (rects[rects.length - 1]?.right ?? 200) + 30;
    const y = slot.getBoundingClientRect().top + 10;
    slot.dispatchEvent(new DragEvent('dragover',
      { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    slot.dispatchEvent(new DragEvent('drop',
      { bubbles: true, dataTransfer: dt, clientX: x, clientY: y }));
    return { x, mids: rects.map((r) => r.left + r.width / 2) };
  }, where);

test.describe('Gestes complets : rack-cible, clic droit navigateur, dblclick', () => {
  test('drop d un instrument sur le RACK : device ajoute a la position visee', async ({ page }) => {
    await open(page, `gest-rack-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];
    // selectionner la piste 1 (le rack l affiche)
    await page.locator('.track[data-track-id]').first().click();
    // un device natif d abord, pour tester l INSERTION AVANT lui
    await page.locator('#add-device-btn').click();
    await page.locator('[data-role="add-gain"]').click();
    await expect(page.locator('#device-view .device')).toHaveCount(1);

    // drop a GAUCHE du panneau existant -> index 0 (avant lui)
    const diag = await dropInstrumentOnRack(page, 'before-first');

    await expect.poll(async () => (await chainOf(page, trackId)).length).toBe(2);
    const chain = await chainOf(page, trackId);
    expect(chain[0].name,
      `insertion avant attendue (drop x=${diag.x}, milieux=${diag.mids})`)
      .toBe('FakeSynth');
    // feedback : la classe de survol est retiree apres le drop
    await expect(page.locator('#device-view-slot.dnd-drop-rack')).toHaveCount(0);
  });

  test('clic droit sur un item du navigateur : ajouter / nouvelle piste', async ({ page }) => {
    await open(page, `gest-menu-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];
    await page.locator('.track[data-track-id]').first().click();
    // le catalogue moteur est absent en lab : on materialise UN item du
    // navigateur (le dispatch du menu ne lit que le DOM de l item)
    await page.evaluate(() => {
      const it = document.createElement('button');
      it.className = 'browser-item';
      it.dataset.uid = 'FEEDFACE0123456789ABCDEF01234567';
      it.innerHTML = '<span class="bi-ic inst">◈</span>' +
        '<span class="bi-name">TestPlug</span><span class="bi-vendor">Lab</span>';
      document.getElementById('browser-slot')!.appendChild(it);
    });

    await page.locator('.browser-item[data-uid]').click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: /^Ajouter a/ }).click();
    await expect.poll(async () => (await chainOf(page, trackId)).length).toBe(1);
    expect((await chainOf(page, trackId))[0].name).toBe('TestPlug');

    const tracksBefore = (await getTrackIds(page)).length;
    await page.locator('.browser-item[data-uid]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Nouvelle piste avec ce plugin' }).click();
    await expect.poll(async () => (await getTrackIds(page)).length).toBe(tracksBefore + 1);
  });

  test('double-clic sur la barre de titre d un vst3 : la fenetre bascule', async ({ page }) => {
    await open(page, `gest-dbl-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];
    await page.locator('.track[data-track-id]').first().click();
    // un device vst3 via l API (uid bidon : le geste est cote web)
    await page.evaluate((tid) => {
      const proj = (window as any).__dawProject;
      proj.addProcessor(tid, { id: 'dev-dbl-test', type: 'vst3',
        uid: 'CAFEBABE0123456789ABCDEF01234567', name: 'DblTest',
        bypass: false, params: [] });
      (window as any).__dawFlush?.();
    }, trackId);
    await page.evaluate(() => {
      const eng = (window as any).__dawEngine;
      (window as any).__edCalls = [];
      const orig = eng.setEditor?.bind(eng);
      eng.setEditor = (id: string, open: boolean) => {
        (window as any).__edCalls.push([id, open]); orig?.(id, open);
      };
    });
    // re-render : l'API ne rend pas - changer de selection et revenir
    // (le clic de tete de piste re-rend, wiring)
    await page.locator('.track[data-track-id]').nth(1).click();
    await page.locator('.track[data-track-id]').first().click();
    // Cible = le NOM dans la barre (les boutons de la barre sont exclus
    // du geste ; viser le centre de la barre pourrait tomber sur BOX)
    const name = page.locator(
      '.device[data-proc-id="dev-dbl-test"] .device-title .device-name');
    await name.waitFor({ timeout: 5000 });
    await name.dblclick();
    await expect.poll(() => page.evaluate(() => (window as any).__edCalls))
      .toContainEqual(['dev-dbl-test', true]);
    const ed = page.locator('[data-role="editor"][data-proc-id="dev-dbl-test"]');
    await expect(ed).toHaveAttribute('aria-pressed', 'true');
    await name.dblclick();
    await expect.poll(() => page.evaluate(() => (window as any).__edCalls))
      .toContainEqual(['dev-dbl-test', false]);
  });
});
