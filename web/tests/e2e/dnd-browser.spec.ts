// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * D3 : drag & drop du navigateur vers les pistes (DND-DESIGN.md).
 *
 * En lab (?lab=1) le catalogue moteur est ABSENT (pas d'items
 * Instruments/Effets dans le rail) : le chemin instrument/effet est donc
 * teste en SIMULANT les DragEvent (dragstart/dragover/drop) avec un
 * DataTransfer construit dans page.evaluate - exactement ce que le
 * navigateur fabrique, sans dependre du scan de plugins. Le chemin
 * sample utilise le VRAI kit lab (chips data-role="sample").
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const DND_MIME = 'application/x-daw-dnd';
const AGAIN_UID = '84E8DE5F92554F5396FAE4133C935A18';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const clipCount = (page: Page) =>
  page.evaluate(() => (window as any).__dawProject.getDocument()
    .tracks.reduce((n: number, t: any) => n + t.clips.length, 0));

/** Simule un drop d'instrument/effet : DataTransfer construit + dragover +
 *  drop sur l'element vise par le selecteur (nth). Rend les classes de
 *  feedback observees PENDANT le dragover (pour l'assertion c). */
function dispatchDeviceDrop(page: Page, selector: string, nth: number) {
  return page.evaluate(({ sel, n, mime, uid }) => {
    const target = document.querySelectorAll<HTMLElement>(sel)[n];
    if (!target) throw new Error(`cible introuvable: ${sel}[${n}]`);
    const dt = new DataTransfer();
    dt.setData(mime, JSON.stringify({ kind: 'instrument', uid, name: 'AGain' }));
    const rect = target.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    };
    target.dispatchEvent(new DragEvent('dragover', opts));
    const during = {
      trackHighlight: document.querySelectorAll('.dnd-drop-track').length,
      newTrackZone: document.getElementById('tracks')!
        .classList.contains('dnd-drop-new'),
    };
    target.dispatchEvent(new DragEvent('drop', opts));
    return during;
  }, { sel: selector, n: nth, mime: DND_MIME, uid: AGAIN_UID });
}

test.describe('D3 : drag & drop navigateur -> pistes', () => {
  test('(a) drag d un sample du kit lab vers une lane : clip pose a la position du drop', async ({ page }) => {
    await open(page, `dnd-a-${Date.now()}`);

    // Les chips du kit lab deviennent draggables (decoration refreshPalette)
    await page.waitForFunction(() =>
      document.querySelector('[data-role="sample"]')?.getAttribute('draggable') === 'true');
    const before = await clipCount(page);

    // Vrai payload : dragstart sur la chip (le handler pose le JSON),
    // puis dragover + drop sur la lane a x=200px (= 10 s a 20 pps).
    await page.evaluate((mime) => {
      const chip = document.querySelector<HTMLElement>('[data-role="sample"]')!;
      const lane = document.querySelector<HTMLElement>(
        '#tracks [data-track-id] .track-lane')!;
      const dt = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart',
        { bubbles: true, cancelable: true, dataTransfer: dt }));
      if (!dt.types.includes(mime)) throw new Error('dragstart n a pas pose le payload');
      const rect = lane.getBoundingClientRect();
      const opts = {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: rect.left + 200, clientY: rect.top + 20,
      };
      lane.dispatchEvent(new DragEvent('dragover', opts));
      lane.dispatchEvent(new DragEvent('drop', opts));
    }, DND_MIME);

    // La pose est async (resolution nom -> hash via le kit lab) : poll.
    await expect.poll(() => clipCount(page), { timeout: 10000 }).toBe(before + 1);
    const { startSample, expected, sr } = await page.evaluate(() => {
      const doc = (window as any).__dawProject.getDocument();
      // Le clip pose est sur la PREMIERE piste (la lane visee)
      const clips = doc.tracks[0].clips;
      const clip = clips[clips.length - 1];
      const sr = doc.sampleRate || 48000;
      return { startSample: clip.startSample, expected: 10 * sr, sr };
    });
    // Position approx : x=200px / 20pps = 10 s, snap 0.25 s
    expect(Math.abs(startSample - expected)).toBeLessThanOrEqual(0.25 * sr);
  });

  test('(b) drop instrument sur une piste : device ajoute, piste selectionnee ; zone vide : nouvelle piste', async ({ page }) => {
    await open(page, `dnd-b-${Date.now()}`);

    // Le seed a 2 pistes (track-1/track-2) : la bascule de selection est
    // observable en visant la 2e (la 1re est la selection par defaut)
    const heads = page.locator('#tracks [data-track-id]');
    const n0 = await heads.count();
    expect(n0).toBeGreaterThanOrEqual(2);
    await expect(heads.first()).toHaveClass(/track-selected/);

    await dispatchDeviceDrop(page, '#tracks [data-track-id]', 1);

    // Le doc gagne le device sur CETTE piste...
    await expect.poll(() => page.evaluate((uid) => {
      const doc = (window as any).__dawProject.getDocument();
      return doc.tracks[1]?.chain.some((p: any) => p.uid === uid);
    }, AGAIN_UID)).toBe(true);
    // ...et la selection bascule (le rack montre le nouveau device)
    await expect(heads.nth(1)).toHaveClass(/track-selected/);
    await expect(page.locator('#device-view .device')).toHaveCount(1);

    // Zone vide de #tracks (hors de toute piste) : nouvelle piste + device
    await dispatchDeviceDrop(page, '#tracks', 0);
    await expect(heads).toHaveCount(n0 + 1);
    await expect.poll(() => page.evaluate((uid) => {
      const doc = (window as any).__dawProject.getDocument();
      const last = doc.tracks[doc.tracks.length - 1];
      return last.chain.length === 1 && last.chain[0].uid === uid;
    }, AGAIN_UID)).toBe(true);
    await expect(heads.nth(n0)).toHaveClass(/track-selected/);
  });

  test('(c) feedback visuel : classe posee pendant dragover, retiree apres', async ({ page }) => {
    await open(page, `dnd-c-${Date.now()}`);

    // Sur une piste : surlignage pendant le dragover (rendu par le helper),
    // retire apres le drop
    const during = await dispatchDeviceDrop(page, '#tracks [data-track-id]', 0);
    expect(during.trackHighlight).toBe(1);
    expect(during.newTrackZone).toBe(false);
    await expect(page.locator('.dnd-drop-track')).toHaveCount(0);

    // Sur la zone vide : lisere "+ nouvelle piste" pendant le dragover ;
    // un dragend (drag annule) l'eteint aussi
    const during2 = await page.evaluate((mime) => {
      const tracks = document.getElementById('tracks')!;
      const dt = new DataTransfer();
      dt.setData(mime, JSON.stringify(
        { kind: 'effect', uid: 'ABCDEF019182FAEB4175446152523330', name: 'RR3' }));
      tracks.dispatchEvent(new DragEvent('dragover',
        { bubbles: true, cancelable: true, dataTransfer: dt }));
      const zone = tracks.classList.contains('dnd-drop-new');
      document.body.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      return { zone, after: tracks.classList.contains('dnd-drop-new') };
    }, DND_MIME);
    expect(during2.zone).toBe(true);
    expect(during2.after).toBe(false);
  });
});
