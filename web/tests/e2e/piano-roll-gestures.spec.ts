// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * LES GESTES DU PIANO-ROLL (2026-08-28, Vague 3). Sur une vraie page, a la
 * souris : poser une note, la DEPLACER (temps + hauteur), etirer sa
 * LONGUEUR par le bord droit, changer sa VELOCITE (Alt+glisser, molette),
 * un glisser = UN undo, une destination occupee est REFUSEE, un LASSO
 * selectionne plusieurs notes qui se deplacent ensemble, Suppr efface la
 * selection. Un glisser LENT (un humain) survit a l'echo reseau qui
 * re-rend la page. Tout est lu dans le document, par l'id de la note.
 */

import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

interface N { id: string; pitch: number; velocity: number; start: number; length: number }

async function notes(page: Page, clipId: string): Promise<N[]> {
  return page.evaluate((cid) => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) for (const c of t.clips) if (c.id === cid) {
      return (c.notes ?? []).map((n: any) => ({
        id: n.id, pitch: n.pitch, velocity: n.velocity,
        start: n.startTick ?? n.startSample, length: n.lengthTick ?? n.lengthSamples,
      }));
    }
    return [];
  }, clipId);
}

async function center(page: Page, pitch: number, step: number) {
  const loc = page.locator(`.pr-cell[data-pitch="${pitch}"][data-step="${step}"]`);
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`cell ${pitch}:${step} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height, right: box.x + box.width };
}

const selectedCount = (page: Page) =>
  page.locator('.pr-grid').getAttribute('data-selected').then((v) => Number(v));

test('deplacer, etirer, velocite, refus, undo par geste, lasso, Suppr', async ({ page }) => {
  test.setTimeout(90000);
  const projectId = `e2e-pr-gestures-${Date.now()}`;
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // Piste MIDI + clip MIDI par l'UI (mold notes-ids.spec)
  await page.locator('#new-track-btn').click();
  await page.locator('.ctx-menu >> text=+ Piste MIDI').click();
  const trackId = await page.evaluate(() =>
    (window as any).__dawProject.getDocument().tracks.find((t: any) => t.kind === 'midi').id as string);
  await page.locator(`[data-track-id="${trackId}"] .track-name`).click({ force: true });
  await page.locator('[data-role="rack-tab"][data-tab="piano"]').click();
  await page.locator('[data-role="add-midi"]').first().click();
  const { clipId, stepLen } = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) for (const c of t.clips) if (!c.assetHash) {
      const len = c.lengthTick ?? c.lengthSamples;
      return { clipId: c.id as string, stepLen: Math.floor(len / 16) };
    }
    return { clipId: '', stepLen: 0 };
  });
  expect(clipId).not.toBe('');
  expect(stepLen).toBeGreaterThan(0);

  // Poser C4 au pas 1 (clic = branche « sans mouvement ») : posee ET selectionnee
  await page.locator('.pr-cell[data-pitch="60"][data-step="0"]').click();
  let ns = await notes(page, clipId);
  expect(ns).toHaveLength(1);
  const id = ns[0].id;
  expect(id).toMatch(/^n-/);
  await expect(page.locator('.pr-cell[data-pitch="60"][data-step="0"]')).toHaveClass(/pr-sel/);
  // Un clic sur une note ne l'efface PAS : il la selectionne
  await page.locator('.pr-cell[data-pitch="60"][data-step="0"]').click();
  expect(await notes(page, clipId)).toHaveLength(1);
  expect(await selectedCount(page)).toBe(1);

  // DEPLACER LENTEMENT (un humain : ~600 ms, l'echo reseau arrive pendant)
  const from = await center(page, 60, 0);
  const to = await center(page, 62, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6);
    await page.waitForTimeout(100);   // le temps d'un vrai geste, pas un masque de race
  }
  await page.mouse.up();
  ns = await notes(page, clipId);
  expect(ns).toHaveLength(1);          // le clic de fin de glisser est avale
  expect(ns[0]).toMatchObject({ id, pitch: 62, start: 2 * stepLen });
  // Un glisser = UN undo, qui rend pitch ET debut d'avant le geste
  await page.keyboard.press('Control+z');
  ns = await notes(page, clipId);
  expect(ns[0]).toMatchObject({ id, pitch: 60, start: 0 });
  await page.keyboard.press('Control+Shift+z');
  ns = await notes(page, clipId);
  expect(ns[0]).toMatchObject({ id, pitch: 62, start: 2 * stepLen });

  // LONGUEUR : tirer le bord droit de la note de deux pas
  const head = await center(page, 62, 2);
  await page.mouse.move(head.right - 2, head.y);
  await page.mouse.down();
  await page.mouse.move(head.right - 2 + 2 * (head.w + 1), head.y, { steps: 4 });
  await page.mouse.up();
  ns = await notes(page, clipId);
  expect(ns[0]).toMatchObject({ id, pitch: 62, start: 2 * stepLen, length: 3 * stepLen });
  // La queue est peinte et porte l'id
  await expect(page.locator('.pr-cell[data-pitch="62"][data-step="4"]')).toHaveClass(/pr-tail/);
  expect(await page.locator('.pr-cell[data-pitch="62"][data-step="4"]').getAttribute('data-note-id')).toBe(id);

  // VELOCITE : Alt + glisser vers le bas de 30 px depuis la queue
  const tail = await center(page, 62, 3);
  await page.keyboard.down('Alt');
  await page.mouse.move(tail.x, tail.y);
  await page.mouse.down();
  await page.mouse.move(tail.x, tail.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  ns = await notes(page, clipId);
  expect(ns[0]).toMatchObject({ id, velocity: 70, pitch: 62, start: 2 * stepLen, length: 3 * stepLen });
  // ... et la molette (un cran vers le haut = +5)
  await page.mouse.move(tail.x, tail.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await notes(page, clipId))[0].velocity).toBe(75);
  // L'intensite de la case suit la velocite
  const vel = await page.locator('.pr-cell[data-pitch="62"][data-step="2"]').evaluate(
    (el) => (el as HTMLElement).style.getPropertyValue('--vel'));
  expect(Number(vel)).toBeCloseTo(75 / 127, 3);
  // Le statut dit la note sous la souris
  await expect(page.locator('[data-role="pr-status"]')).toContainText('D4');
  await expect(page.locator('[data-role="pr-status"]')).toContainText('vel 75');

  // REFUS : une autre note en (C4, pas 1) ; glisser la premiere dessus
  await page.locator('.pr-cell[data-pitch="60"][data-step="0"]').click();
  ns = await notes(page, clipId);
  expect(ns).toHaveLength(2);
  const other = ns.find((n) => n.id !== id)!;
  expect(other).toMatchObject({ pitch: 60, start: 0 });
  const src = await center(page, 62, 2);
  const dst = await center(page, 60, 0);
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  await page.mouse.move(dst.x, dst.y, { steps: 4 });
  await page.mouse.up();
  ns = await notes(page, clipId);
  expect(ns).toHaveLength(2);
  const moved = ns.find((n) => n.id === id)!;
  // Jamais sur l'adresse occupee : la note est restee a la derniere
  // position acceptee du chemin (qui depend de l'arrondi des pas)
  expect(moved.length).toBe(3 * stepLen);
  expect(moved.pitch === 60 && moved.start === 0).toBe(false);
  expect(Math.abs(moved.pitch - 60) + moved.start / stepLen).toBeLessThanOrEqual(2);
  expect(ns.find((n) => n.id !== id)).toMatchObject({ pitch: 60, start: 0 });

  // LASSO depuis une case vide, autour des deux notes -> 2 selectionnees
  const a = await center(page, 65, 0);
  const b = await center(page, 58, 5);
  await page.mouse.move(a.x - a.w / 2 + 2, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  expect(await selectedCount(page)).toBe(2);
  expect(await notes(page, clipId)).toHaveLength(2);   // un lasso ne pose rien
  // ... et le lot se deplace ensemble d'un pas vers la droite et une tierce
  const grab = await center(page, 60, 0);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 3 * (grab.w + 1), grab.y - 4 * (grab.h + 1), { steps: 6 });
  await page.mouse.up();
  ns = await notes(page, clipId);
  expect(ns.find((n) => n.id === other.id)).toMatchObject({ pitch: 64, start: 3 * stepLen });
  expect(ns.find((n) => n.id === id)).toMatchObject({ pitch: moved.pitch + 4, start: moved.start + 3 * stepLen });
  // Un seul Ctrl+Z rend les DEUX notes
  await page.keyboard.press('Control+z');
  ns = await notes(page, clipId);
  expect(ns.find((n) => n.id === other.id)).toMatchObject({ pitch: 60, start: 0 });
  expect(ns.find((n) => n.id === id)).toMatchObject({ pitch: moved.pitch, start: moved.start });

  // SUPPR efface la selection (les deux), un seul undo les rend
  await page.locator('.pr-grid').focus();
  expect(await selectedCount(page)).toBe(2);
  await page.keyboard.press('Delete');
  expect(await notes(page, clipId)).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect(await notes(page, clipId)).toHaveLength(2);
  // Echap deselectionne
  await page.locator('.pr-cell[data-pitch="60"][data-step="0"]').click();
  expect(await selectedCount(page)).toBe(1);
  await page.keyboard.press('Escape');
  expect(await selectedCount(page)).toBe(0);
});
