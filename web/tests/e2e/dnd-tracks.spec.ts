// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * D1 (DND-DESIGN.md) : reordonner les pistes par drag de la tete.
 *
 * Invariants testes :
 * - le drag ecrit le champ additif TrackDef.order (jamais de
 *   delete+insert dans la liste Automerge) et l'ordre AFFICHE suit
 *   orderedTracks (order ?? index de liste) ;
 * - le clic simple sans mouvement reste la selection de piste (regle
 *   gravee des poignees) et ne cree AUCUNE entree d'undo ;
 * - Ctrl+Z restaure l'ordre precedent (inverse = retrait du champ) ;
 * - deux onglets du meme projet convergent vers le meme ordre affiche.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection, getTrackIds } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

/** Ids des pistes dans l'ordre du DOM de l'arrangement (= ordre affiche). */
const domOrder = (page: Page) => getTrackIds(page);

/** Ids tries comme orderedTracks (schema.ts) : (order ?? index), stable. */
const docOrder = (page: Page) =>
  page.evaluate(() => {
    const doc = (window as any).__dawProject.getDocument();
    return doc.tracks
      .map((t: any, i: number) => ({ id: t.id, key: t.order ?? i, i }))
      .sort((a: any, b: any) => (a.key - b.key) || (a.i - b.i))
      .map((x: any) => x.id);
  });

/** Profondeur du journal d'undo (runtime : champ prive TS accessible). */
const undoDepth = (page: Page) =>
  page.evaluate(() => (window as any).__dawProject.journal.undoDepth as number);

/**
 * Drague la tete de la piste `fromIdx` jusque SOUS la piste `belowIdx`
 * (pointeur sous le milieu vertical de la cible -> slot d'insertion
 * apres elle). Prise = le nom de piste (la zone de grab de la tete).
 */
async function dragTrackBelow(page: Page, fromIdx: number, belowIdx: number): Promise<void> {
  const src = await page.locator('#tracks .track .track-name').nth(fromIdx).boundingBox();
  const dst = await page.locator('#tracks .track[data-track-id]').nth(belowIdx).boundingBox();
  if (!src || !dst) throw new Error('track head not visible');
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + 80, dst.y + dst.height - 2, { steps: 12 });
  await page.mouse.up();
}

test.describe('D1 - reordonner les pistes par drag de la tete', () => {
  test('drag de la piste 1 sous la piste 2 : ordre affiche inverse, doc trie pareil', async ({ page }) => {
    await open(page, `dnd-tracks-a-${Date.now()}`);
    const before = await domOrder(page);
    expect(before.length).toBeGreaterThanOrEqual(2);

    await dragTrackBelow(page, 0, 1);

    const expected = [before[1], before[0], ...before.slice(2)];
    await expect.poll(() => domOrder(page)).toEqual(expected);
    // Le document reflete le MEME tri via (order ?? index) - la liste
    // Automerge, elle, n'a pas bouge (identite preservee).
    expect(await docOrder(page)).toEqual(expected);
    const rawList = await page.evaluate(() =>
      (window as any).__dawProject.getDocument().tracks.map((t: any) => t.id));
    expect(rawList).toEqual(before);
  });

  test('clic simple sans mouvement : selection intacte, zero entree d\'undo', async ({ page }) => {
    await open(page, `dnd-tracks-b-${Date.now()}`);
    const ids = await domOrder(page);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const depthBefore = await undoDepth(page);

    // clic sur le NOM de la deuxieme piste (pas encore selectionnee)
    await page.locator('#tracks .track .track-name').nth(1).click();

    await expect(page.locator(`#tracks [data-track-id="${ids[1]}"]`))
      .toHaveClass(/track-selected/);
    // l'ordre n'a pas bouge et le journal d'undo non plus
    expect(await domOrder(page)).toEqual(ids);
    expect(await undoDepth(page)).toBe(depthBefore);
  });

  test('Ctrl+Z restaure l\'ordre precedent', async ({ page }) => {
    await open(page, `dnd-tracks-c-${Date.now()}`);
    const before = await domOrder(page);
    expect(before.length).toBeGreaterThanOrEqual(2);

    await dragTrackBelow(page, 0, 1);
    await expect.poll(() => domOrder(page))
      .toEqual([before[1], before[0], ...before.slice(2)]);

    await page.keyboard.press('Control+z');
    await expect.poll(() => domOrder(page)).toEqual(before);
    // l'inverse a RETIRE le champ order pose par le drag (premier set)
    expect(await docOrder(page)).toEqual(before);
  });

  test('convergence 2 onglets : reordre dans A, B affiche le meme ordre', async ({ browser }) => {
    const projectId = `dnd-tracks-d-${Date.now()}`;
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    try {
      await open(page1, projectId);
      await open(page2, projectId);

      const before = await domOrder(page1);
      expect(before.length).toBeGreaterThanOrEqual(2);
      expect(await domOrder(page2)).toEqual(before);

      await dragTrackBelow(page1, 0, 1);
      const expected = [before[1], before[0], ...before.slice(2)];
      await expect.poll(() => domOrder(page1)).toEqual(expected);

      // l'onglet B converge vers le meme ordre AFFICHE (le change ne
      // transporte qu'un champ order - l'identite des pistes survit)
      await expect.poll(() => domOrder(page2), { timeout: 10000 }).toEqual(expected);
      expect(await docOrder(page2)).toEqual(expected);
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
