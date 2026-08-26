// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * D4 (DND-DESIGN.md) : clips ENTRE pistes + slots Session.
 *
 * Invariants testes :
 * - drag VERTICAL d'un clip vers une autre piste : le document bouge
 *   (delete+recreate MEME id, compromis d'identite assume) - la piste
 *   d'origine ne l'a plus, la cible l'a, a la position droppee, TOUS
 *   champs conserves (name pose avant via renameClip compris) ;
 * - Ctrl+Z remet le clip sur sa piste d'origine, position ET nom ;
 * - le drag HORIZONTAL sur sa propre piste reste le comportement
 *   existant (setClipStart, meme piste) ;
 * - slot Session : drag vers la cellule VIDE d'une autre piste -> le
 *   clip porte la nouvelle piste, la grille suit ; Ctrl+Z restaure.
 *
 * Projet isole par test ; contenu pose par l'UI (KIT du harnais lab=1,
 * idiome clip-drag.spec) ou par l'API projet + __dawFlush (idiome
 * ui-session.spec pour la grille Session).
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection, getTrackIds } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

/** Pose un clip du KIT sur la premiere piste puis DESARME (sans le
 *  desarmement, le mouse.up d'un drag rate posait un clip fantome a
 *  l'endroit du drop - vu en sonde : t0 = [480000, 804000]). */
async function placeKitClip(page: Page): Promise<void> {
  await page.locator('[data-role="sample"]').first().click();
  await page.locator('#tracks .track[data-track-id] .track-lane').first()
    .click({ position: { x: 200, y: 20 } });
  await expect(page.locator('.clip').first()).toBeVisible({ timeout: 10000 });
  await page.locator('[data-role="sample"]').first().click();  // disarm
}

/** Le CENTRE de la poignee du 1er clip : le kick fait 0.4 s = ~10 px de
 *  large a 20 pps - un offset fixe (+15) cliquait A COTE de la cible
 *  (le flake 2px historique de clip-selection, meme lecon). */
async function handleCenter(page: Page): Promise<{ x: number; y: number }> {
  const hbox = (await page.locator('[data-role="clip-handle"]').first()
    .boundingBox())!;
  return { x: hbox.x + hbox.width / 2, y: hbox.y + hbox.height / 2 };
}

/** Le clip [0] de la piste d'index ti, champs utiles (null si absent). */
function clipOn(page: Page, ti: number) {
  return page.evaluate((i) => {
    const d = (window as any).__dawProject.getDocument();
    const c = d.tracks[i]?.clips[0];
    return c ? {
      id: c.id, name: c.name ?? '', assetHash: c.assetHash,
      start: c.startSample, len: c.lengthSamples, off: c.offsetSamples,
    } : null;
  }, ti);
}

test.describe('D4 - clips entre pistes + slots Session', () => {
  test('drag vertical vers la piste 2 : le doc bouge, tous champs conserves ; Ctrl+Z restaure', async ({ page }) => {
    await open(page, `dnd-clips-a-${Date.now()}`);
    const ids = await getTrackIds(page);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    await placeKitClip(page);

    // Nom pose AVANT le drag - il doit survivre au delete+recreate
    await page.evaluate(() => {
      const proj = (window as any).__dawProject;
      const t = proj.getDocument().tracks[0];
      proj.renameClip(t.id, t.clips[0].id, 'gardien');
      (window as any).__dawFlush?.();
    });
    const before = (await clipOn(page, 0))!;
    const sr = await page.evaluate(() =>
      (window as any).__dawProject.getDocument().sampleRate || 48000);

    // Drag par la barre de titre : +10 px en X (= 0.5 s a 20 pps, sur la
    // grille de snap 0.25 s) et Y au milieu de la LANE de la piste 2.
    const { x: x0, y: y0 } = await handleCenter(page);
    const lane2 = page.locator('#tracks .track[data-track-id] .track-lane').nth(1);
    const lbox = (await lane2.boundingBox())!;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x0 + (10 * i) / 8,
        y0 + ((lbox.y + lbox.height / 2 - y0) * i) / 8);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();

    // Piste 1 vide, piste 2 porte le clip - MEME id, position droppee
    // (+0.5 s), name/assetHash/longueur/offset intacts.
    await expect.poll(() => clipOn(page, 0)).toBeNull();
    const after = (await clipOn(page, 1))!;
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('gardien');
    expect(after.assetHash).toBe(before.assetHash);
    expect(after.len).toBe(before.len);
    expect(after.off).toBe(before.off);
    expect(after.start).toBe(before.start + sr / 2);

    // Ctrl+Z : UN geste - le clip revient sur la piste 1, position ET nom
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await expect.poll(() => clipOn(page, 1)).toBeNull();
    const restored = (await clipOn(page, 0))!;
    expect(restored.id).toBe(before.id);
    expect(restored.name).toBe('gardien');
    expect(restored.start).toBe(before.start);
  });

  test('drag horizontal sur sa propre piste : comportement existant intact', async ({ page }) => {
    await open(page, `dnd-clips-b-${Date.now()}`);
    await placeKitClip(page);
    const before = (await clipOn(page, 0))!;
    const sr = await page.evaluate(() =>
      (window as any).__dawProject.getDocument().sampleRate || 48000);

    // +120 px en X, Y constant (on reste dans sa lane) - idiome clip-drag
    const { x: x0, y: y0 } = await handleCenter(page);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x0 + i * 12, y0);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();

    // Meme piste, meme id, position deplacee de 6 s pile (snap 0.25 s)
    await expect.poll(async () => (await clipOn(page, 0))?.start)
      .toBe(before.start + 6 * sr);
    const after = (await clipOn(page, 0))!;
    expect(after.id).toBe(before.id);
    expect(await clipOn(page, 1)).toBeNull();
  });

  test('slot Session : drag vers la cellule d\'une autre piste ; la grille suit ; Ctrl+Z restaure', async ({ page }) => {
    await open(page, `dnd-clips-c-${Date.now()}`);
    const ids = await getTrackIds(page);
    expect(ids.length).toBeGreaterThanOrEqual(2);

    // scene + slot sur la piste 1 (idiome ui-session.spec : API + flush)
    const { sceneId, clipId } = await page.evaluate(() => {
      const proj = (window as any).__dawProject;
      proj.addScene('Scene 1'); (window as any).__dawFlush?.();
      const sid = proj.getDocument().scenes[0].id as string;
      const tid = proj.getDocument().tracks[0].id as string;
      const cid = proj.addSessionClip(tid, sid) as string;
      (window as any).__dawFlush?.();
      return { sceneId: sid, clipId: cid };
    });
    await page.locator('[data-role="paradigm"][data-view="session"]').click();
    await expect(page.locator('.ss-slot.filled')).toHaveCount(1);

    // ou vit le slot dans le doc (par id de piste, pas d'index suppose)
    const slotTrack = () => page.evaluate((cid) => {
      const d = (window as any).__dawProject.getDocument();
      const t = d.tracks.find((x: any) =>
        (x.clips ?? []).some((c: any) => c.id === cid));
      return t ? t.id as string : null;
    }, clipId);
    expect(await slotTrack()).toBe(ids[0]);

    // drag du slot plein vers la cellule VIDE de la piste 2, meme scene
    const src = (await page.locator('.ss-slot.filled').boundingBox())!;
    const dst = (await page.locator(
      `.ss-slot[data-ss-track="${ids[1]}"][data-ss-scene="${sceneId}"]`)
      .boundingBox())!;
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2,
      { steps: 10 });
    await page.mouse.up();

    // Le clip porte la nouvelle piste (meme id, meme scene), la grille suit
    await expect.poll(slotTrack).toBe(ids[1]);
    const scene = await page.evaluate((cid) => {
      const d = (window as any).__dawProject.getDocument();
      for (const t of d.tracks) {
        const c = (t.clips ?? []).find((x: any) => x.id === cid);
        if (c) return c.sceneId as string;
      }
      return null;
    }, clipId);
    expect(scene).toBe(sceneId);
    await expect(page.locator('.ss-slot.filled')).toHaveCount(1);
    await expect(page.locator('.ss-slot.filled'))
      .toHaveAttribute('data-ss-track', ids[1]);

    // Ctrl+Z : le slot revient sur la piste 1, la grille suit
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+z');
    await expect.poll(slotTrack).toBe(ids[0]);
    await expect(page.locator('.ss-slot.filled'))
      .toHaveAttribute('data-ss-track', ids[0]);
  });
});
