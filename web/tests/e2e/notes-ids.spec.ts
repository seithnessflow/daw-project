// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * NOTES A IDS STABLES (2026-08-28, Vague 3 - l'ecart SCHEMA-V2 §4). Deux
 * onglets posent des notes EN MEME TEMPS dans le meme clip MIDI : les deux
 * notes survivent chez les deux (une liste Automerge merge les insertions
 * concurrentes), chacune porte un id ; l'onglet A edite la velocite PAR
 * L'ID (updateNote) et B la voit ; Ctrl+Z chez A la ramene chez B.
 */

import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function notesOf(page: Page, clipId: string) {
  return page.evaluate((cid) => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) for (const c of t.clips) if (c.id === cid) {
      return (c.notes ?? []).map((n: any) => ({ id: n.id ?? null, pitch: n.pitch, velocity: n.velocity }));
    }
    return [];
  }, clipId);
}

test('deux onglets posent des notes en concurrence ; la velocite s edite par l id et voyage', async ({ context }) => {
  test.setTimeout(90000);
  const projectId = `e2e-notes-ids-${Date.now()}`;
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto(`/?project=${projectId}`);
  await waitForServerConnection(a);
  await a.waitForSelector('[data-track-id]', { timeout: 10000 });

  // A : piste MIDI + clip MIDI par l'UI (mold tempo.spec)
  await a.locator('#new-track-btn').click();
  await a.locator('.ctx-menu >> text=+ Piste MIDI').click();
  const trackId = await a.evaluate(() =>
    (window as any).__dawProject.getDocument().tracks.find((t: any) => t.kind === 'midi').id as string);
  await a.locator(`[data-track-id="${trackId}"] .track-name`).click({ force: true });
  await a.locator('[data-role="rack-tab"][data-tab="piano"]').click();
  await a.locator('[data-role="add-midi"]').first().click();
  const clipId = await a.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) for (const c of t.clips) if (!c.assetHash) return c.id as string;
    return '';
  });
  expect(clipId).not.toBe('');

  // B ouvre le meme projet et voit le clip
  await b.goto(`/?project=${projectId}`);
  await waitForServerConnection(b);
  await b.waitForSelector('[data-track-id]', { timeout: 10000 });
  await b.waitForFunction((cid) => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.some((t: any) => t.clips.some((c: any) => c.id === cid));
  }, clipId, { timeout: 15000 });
  await b.locator(`[data-track-id="${trackId}"] .track-name`).click({ force: true });
  await b.locator('[data-role="rack-tab"][data-tab="piano"]').click();

  // CONCURRENCE : A pose C4 pas 1, B pose E4 pas 5, sans attendre l'autre
  await Promise.all([
    a.locator('.pr-cell[data-pitch="60"][data-step="0"]').click(),
    b.locator('.pr-cell[data-pitch="64"][data-step="4"]').click(),
  ]);

  // Les deux notes survivent chez les deux, chacune avec un id
  for (const page of [a, b]) {
    await page.waitForFunction((cid) => {
      const d = (window as any).__dawProject.getDocument();
      for (const t of d.tracks) for (const c of t.clips) if (c.id === cid) return (c.notes ?? []).length === 2;
      return false;
    }, clipId, { timeout: 15000 });
  }
  const na = await notesOf(a, clipId);
  const nb = await notesOf(b, clipId);
  expect(na.map((n) => n.pitch).sort()).toEqual([60, 64]);
  expect(nb.map((n) => n.pitch).sort()).toEqual([60, 64]);
  expect(na.every((n) => typeof n.id === 'string' && n.id.startsWith('n-'))).toBe(true);
  expect(new Set(na.map((n) => n.id)).size).toBe(2);
  expect(nb.map((n) => n.id).sort()).toEqual(na.map((n) => n.id).sort());

  // A edite la velocite de SA note par l'id ; B la voit
  const idA = na.find((n) => n.pitch === 60)!.id!;
  const ok = await a.evaluate(({ tid, cid, nid }) => {
    const r = (window as any).__dawProject.updateNote(tid, cid, nid, { velocity: 37 });
    (window as any).__dawFlush?.();
    return r;
  }, { tid: trackId, cid: clipId, nid: idA });
  expect(ok).toBe(true);
  await b.waitForFunction(({ cid, nid }) => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) for (const c of t.clips) if (c.id === cid)
      return (c.notes ?? []).some((n: any) => n.id === nid && n.velocity === 37);
    return false;
  }, { cid: clipId, nid: idA }, { timeout: 15000 });

  // Ctrl+Z chez A : la velocite revient a 100, et B suit
  await a.keyboard.press('Control+z');
  await b.waitForFunction(({ cid, nid }) => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) for (const c of t.clips) if (c.id === cid)
      return (c.notes ?? []).some((n: any) => n.id === nid && n.velocity === 100);
    return false;
  }, { cid: clipId, nid: idA }, { timeout: 15000 });
  // Un id inconnu est refuse (false), sans rien casser
  expect(await a.evaluate(({ tid, cid }) =>
    (window as any).__dawProject.updateNote(tid, cid, 'n-nope', { velocity: 1 }),
    { tid: trackId, cid: clipId })).toBe(false);
});
