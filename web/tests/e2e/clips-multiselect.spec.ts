// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * SELECTION MULTIPLE DE CLIPS (2026-08-28, demande utilisateur « comme
 * dans Ableton ») : Shift+clic ajoute au lot, glisser un clip du lot
 * deplace TOUT le lot du meme delta (un seul undo), un clic de lane
 * deselectionne, un LASSO depuis le vide selectionne ce qu'il touche,
 * Ctrl+D duplique le lot en bloc (selection sur les copies), Suppr efface
 * le lot (un seul undo). Tout est lu dans le document.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const projectId = `multisel-${Date.now()}`;

interface C { id: string; start: number; end: number }
const clips = (page: Page): Promise<C[]> => page.evaluate(() => {
  const d = (window as any).__dawProject.getDocument();
  const out: any[] = [];
  for (const t of d.tracks) for (const c of t.clips) {
    out.push({ id: c.id, start: c.startSample, end: c.startSample + c.lengthSamples });
  }
  return out.sort((a, b) => a.start - b.start);
});
const selectedIds = (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('.clip[aria-selected="true"]'))
    .map((el) => (el as HTMLElement).dataset.clipId!).sort());
const handle = (page: Page, id: string) =>
  page.locator(`.clip[data-clip-id="${id}"] [data-role="clip-handle"]`);

test('Shift+clic, deplacer le lot, lasso, Ctrl+D en bloc, Suppr', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // Deux clips par l'UI : armer un sample du kit, poser a deux endroits
  const lane = page.locator('[data-track-id] .track-lane').first();
  await page.locator('[data-role="sample"]').first().click();
  await lane.click({ position: { x: 200, y: 20 } });
  await lane.click({ position: { x: 500, y: 20 } });
  await expect(page.locator('.clip')).toHaveCount(2);
  await page.locator('[data-role="sample"]').first().click();   // desarmer
  let cs = await clips(page);
  const [a, b] = cs;
  const gap = b.start - a.start;
  expect(gap).toBeGreaterThan(0);

  // Clic = un seul ; Shift+clic = le lot
  await handle(page, a.id).click();
  expect(await selectedIds(page)).toEqual([a.id]);
  await handle(page, b.id).click({ modifiers: ['Shift'] });
  expect(await selectedIds(page)).toEqual([a.id, b.id].sort());

  // Glisser A de 120 px : B suit du meme delta, l'ecart est conserve
  const hb = (await handle(page, a.id).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  cs = await clips(page);
  const a2 = cs.find((c) => c.id === a.id)!, b2 = cs.find((c) => c.id === b.id)!;
  expect(a2.start).toBeGreaterThan(a.start);
  expect(b2.start - a2.start).toBe(gap);
  expect(await selectedIds(page)).toEqual([a.id, b.id].sort());   // le lot survit au geste
  // Un seul Ctrl+Z rend les deux
  await page.keyboard.press('Control+z');
  cs = await clips(page);
  expect(cs.find((c) => c.id === a.id)!.start).toBe(a.start);
  expect(cs.find((c) => c.id === b.id)!.start).toBe(b.start);

  // Clic de lane loin des clips : plus rien de selectionne
  await lane.click({ position: { x: 650, y: 20 } });
  expect(await selectedIds(page)).toEqual([]);

  // LASSO depuis le vide, par-dessus les deux clips
  const lb = (await lane.boundingBox())!;
  await page.mouse.move(lb.x + 100, lb.y + 4);
  await page.mouse.down();
  await page.mouse.move(lb.x + 560, lb.y + lb.height - 4, { steps: 6 });
  await expect(page.locator('[data-role="clip-lasso"]')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('[data-role="clip-lasso"]')).toHaveCount(0);
  expect(await selectedIds(page)).toEqual([a.id, b.id].sort());
  expect(await clips(page)).toHaveLength(2);   // un lasso ne pose rien
  // ... et il pose une SELECTION DE TEMPS (la plage balayee, snappee), visible
  const range = await page.evaluate(() => {
    const band = document.querySelector('[data-role="time-selection"]') as HTMLElement | null;
    return band ? { left: parseFloat(band.style.left), width: parseFloat(band.style.width) } : null;
  });
  expect(range).not.toBeNull();
  const sr = await page.evaluate(() => (window as any).__dawProject.getDocument().sampleRate || 48000);
  // pps deduit de la geometrie d'un clip (left px <-> startSample)
  const pps = await page.evaluate(({ id, start, sr }) => {
    const el = document.querySelector(`.clip[data-clip-id="${id}"]`) as HTMLElement;
    return parseFloat(el.style.left) / (start / sr);
  }, { id: b.id, start: b.start, sr });
  expect(pps).toBeGreaterThan(0);

  // Ctrl+D : la PLAGE se duplique (silences compris), selection sur les copies
  await page.keyboard.press('Control+d');
  cs = await clips(page);
  expect(cs).toHaveLength(4);
  const copies = cs.filter((c) => c.id !== a.id && c.id !== b.id).sort((x, y) => x.start - y.start);
  expect(await selectedIds(page)).toEqual(copies.map((c) => c.id).sort());
  const blockEnd = Math.max(a.end, b.end);
  expect(copies[0].start).toBeGreaterThanOrEqual(blockEnd);
  expect(copies[1].start - copies[0].start).toBe(gap);
  const shift = copies[0].start - a.start;
  expect(shift).toBe(copies[1].start - b.start);   // meme decalage
  // Le decalage = la LONGUEUR DE LA PLAGE, pas celle du bloc de clips
  expect(shift).toBeGreaterThan(blockEnd - a.start);
  expect(shift).toBe(Math.round(range!.width / pps * sr));
  // La plage a suivi les copies (Ctrl+D a nouveau enchaine)
  const range2 = await page.evaluate(() => {
    const band = document.querySelector('[data-role="time-selection"]') as HTMLElement | null;
    return band ? parseFloat(band.style.left) : null;
  });
  expect(range2).toBeCloseTo(range!.left + range!.width, 3);
  // Un seul Ctrl+Z retire les deux copies
  await page.keyboard.press('Control+z');
  expect(await clips(page)).toHaveLength(2);
  await page.keyboard.press('Control+Shift+z');
  expect(await clips(page)).toHaveLength(4);

  // Suppr efface le lot (les copies re-selectionnees : un undo/redo
  // ne conserve pas la selection, assume), un seul undo les rend
  await handle(page, copies[0].id).click();
  await handle(page, copies[1].id).click({ modifiers: ['Shift'] });
  expect((await selectedIds(page)).length).toBe(2);
  await page.keyboard.press('Delete');
  cs = await clips(page);
  expect(cs.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  await page.keyboard.press('Control+z');
  expect(await clips(page)).toHaveLength(4);
});
