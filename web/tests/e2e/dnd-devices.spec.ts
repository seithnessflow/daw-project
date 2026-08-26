// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * D2 (DND-DESIGN.md) : reordonner les devices d'une chaine par drag
 * horizontal de la barre de titre dans le rack (Device View).
 *
 * Invariants testes :
 * - le drag appelle moveProcessor (remove + insert de la MEME def dans
 *   UN change - decision DND-DESIGN, l'ordre de la chaine est le
 *   pipeline) : l'ordre du doc ET l'ordre DOM du rack s'inversent ;
 * - le clic simple sans mouvement sur la barre de titre ne change rien
 *   a l'ordre et ne cree AUCUNE entree d'undo (regle gravee) ;
 * - Ctrl+Z restaure l'ordre (inverse = move retour) et les params du
 *   device SURVIVENT au move + undo (la copie plain() porte tout) ;
 * - deux onglets du meme projet convergent vers le meme ordre affiche.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection, getTrackIds } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

/** Ids des devices dans l'ordre du DOM du rack (= ordre affiche). */
const domChain = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll(
      '#device-view .device-chain .device[data-proc-id]'))
      .map((el) => el.getAttribute('data-proc-id') || ''));

/** Ids de la chaine du DOCUMENT pour une piste (l'ordre EST le sens). */
const docChain = (page: Page, trackId: string) =>
  page.evaluate((id) => {
    const doc = (window as any).__dawProject.getDocument();
    const t = doc.tracks.find((x: any) => x.id === id);
    return t ? t.chain.map((p: any) => p.id) : [];
  }, trackId);

/** Profondeur du journal d'undo (runtime : champ prive TS accessible). */
const undoDepth = (page: Page) =>
  page.evaluate(() => (window as any).__dawProject.journal.undoDepth as number);

/**
 * Cree 2 devices natifs sur la piste selectionnee (la premiere) via le
 * menu + device de l'UI - le meme chemin que devices.spec.ts. Deux types
 * DIFFERENTS (gain puis utility) pour que les panneaux se distinguent.
 */
async function addTwoDevices(page: Page): Promise<void> {
  await page.locator('#add-device-btn').click();
  await page.locator('[data-role="add-gain"]').click();
  await expect(page.locator('#device-view .device')).toHaveCount(1);
  await page.locator('#add-device-btn').click();
  await page.locator('[data-role="add-utility"]').click();
  await expect(page.locator('#device-view .device')).toHaveCount(2);
}

/**
 * Drague la barre de titre du panneau `fromIdx` jusqu'APRES le panneau
 * `afterIdx` (pointeur a droite du milieu horizontal de la cible ->
 * slot d'insertion apres elle). Prise = le NOM du device (la zone de
 * grab de la barre de titre - jamais les boutons, exclus par closest).
 */
async function dragDeviceAfter(page: Page, fromIdx: number, afterIdx: number): Promise<void> {
  // Le rack SCROLLE horizontalement : au viewport 1280x720 du runner,
  // l'ajout du device utility (large) pousse le panneau 0 HORS ecran a
  // gauche (x negatif) et un clic a ces coordonnees tombe sur <html>.
  // On ramene la SOURCE dans la vue avant de lire les boxes.
  const srcName = page.locator('#device-view .device .device-name').nth(fromIdx);
  await srcName.scrollIntoViewIfNeeded();
  const src = await srcName.boundingBox();
  const dst = await page.locator('#device-view .device[data-proc-id]')
    .nth(afterIdx).boundingBox();
  if (!src || !dst) throw new Error('device panel not visible');
  const vw = page.viewportSize()?.width ?? 1280;
  if (src.x < 0 || dst.x + dst.width - 4 >= vw) {
    throw new Error(`drag coords hors viewport (${vw}px): src.x=${src.x} drop=${dst.x + dst.width - 4}`);
  }
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + dst.width - 4, dst.y + 10, { steps: 12 });
  await page.mouse.up();
}

test.describe('D2 - reordonner les devices par drag du panneau', () => {
  test('drag du panneau 1 apres le panneau 2 : chaine du doc inversee, DOM aussi', async ({ page }) => {
    await open(page, `dnd-devices-a-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];
    await addTwoDevices(page);
    const before = await domChain(page);
    expect(before.length).toBe(2);
    expect(await docChain(page, trackId)).toEqual(before);

    await dragDeviceAfter(page, 0, 1);

    const expected = [before[1], before[0]];
    // Le doc EST la verite (le moteur lit cet ordre) ; le DOM le suit.
    await expect.poll(() => docChain(page, trackId)).toEqual(expected);
    await expect.poll(() => domChain(page)).toEqual(expected);
  });

  test('clic simple sans mouvement sur la barre de titre : ordre intact, zero entree d\'undo', async ({ page }) => {
    await open(page, `dnd-devices-b-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];
    await addTwoDevices(page);
    const before = await domChain(page);
    const depthBefore = await undoDepth(page);

    // clic sur le NOM du premier device (la poignee), sans mouvement
    await page.locator('#device-view .device .device-name').first().click();

    expect(await domChain(page)).toEqual(before);
    expect(await docChain(page, trackId)).toEqual(before);
    expect(await undoDepth(page)).toBe(depthBefore);
  });

  test('Ctrl+Z restaure l\'ordre et les params du device survivent au move', async ({ page }) => {
    await open(page, `dnd-devices-c-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];
    await addTwoDevices(page);
    const before = await domChain(page);
    const movedId = before[0];

    // Un param TEMOIN pose avant le move : la copie plain() du
    // moveProcessor doit le transporter (remove+insert de la MEME def).
    await page.evaluate(({ tid, pid }) => {
      (window as any).__dawProject.setProcessorParam(tid, pid, 'gain', 1.37);
    }, { tid: trackId, pid: movedId });

    await dragDeviceAfter(page, 0, 1);
    await expect.poll(() => docChain(page, trackId)).toEqual([before[1], before[0]]);

    const paramAfterMove = await page.evaluate(({ tid, pid }) => {
      const t = (window as any).__dawProject.getDocument()
        .tracks.find((x: any) => x.id === tid);
      return t.chain.find((p: any) => p.id === pid)
        ?.params.find((x: any) => x.key === 'gain')?.value;
    }, { tid: trackId, pid: movedId });
    expect(paramAfterMove).toBe(1.37);

    await page.keyboard.press('Control+z');
    await expect.poll(() => docChain(page, trackId)).toEqual(before);
    await expect.poll(() => domChain(page)).toEqual(before);

    // ...et le param temoin a survecu au move PUIS a l'undo du move
    const paramAfterUndo = await page.evaluate(({ tid, pid }) => {
      const t = (window as any).__dawProject.getDocument()
        .tracks.find((x: any) => x.id === tid);
      return t.chain.find((p: any) => p.id === pid)
        ?.params.find((x: any) => x.key === 'gain')?.value;
    }, { tid: trackId, pid: movedId });
    expect(paramAfterUndo).toBe(1.37);
  });

  test('convergence 2 onglets : reordre dans A, B affiche le meme ordre', async ({ browser }) => {
    const projectId = `dnd-devices-d-${Date.now()}`;
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    try {
      await open(page1, projectId);
      await open(page2, projectId);
      const trackId = (await getTrackIds(page1))[0];

      await addTwoDevices(page1);
      // l'onglet B recoit les deux devices (meme piste selectionnee par defaut)
      await expect(page2.locator('#device-view .device')).toHaveCount(2);
      const before = await domChain(page1);
      await expect.poll(() => domChain(page2)).toEqual(before);

      await dragDeviceAfter(page1, 0, 1);
      const expected = [before[1], before[0]];
      await expect.poll(() => docChain(page1, trackId)).toEqual(expected);

      // l'onglet B converge : chaine du doc ET ordre DOM du rack (le
      // diff position-a-position de render.ts casse sameStructure)
      await expect.poll(() => docChain(page2, trackId), { timeout: 10000 })
        .toEqual(expected);
      await expect.poll(() => domChain(page2), { timeout: 10000 }).toEqual(expected);
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
