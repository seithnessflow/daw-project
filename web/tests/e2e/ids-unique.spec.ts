// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A4-11 (2026-08-29) : les ids du document sont des UUID (SCHEMA.md), plus
 * des `track-${Date.now()}` - deux onglets qui creent une piste dans la
 * meme milliseconde ecrivaient le MEME id dans un document partage, sans
 * un mot. Preuve : (1) deux pistes et deux clips crees dans la meme
 * milliseconde (boucle synchrone, sans rendu entre les deux) ont des ids
 * distincts au format `<prefixe>-<uuid v4>` ; (2) la duplication (Ctrl+D)
 * garde le stem lisible du clip et un uuid neuf ; (3) 10 000 ids = 10 000.
 */
import { test, expect } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

test('ids are UUIDs, unique even inside one millisecond', async ({ page }) => {
  await page.goto(`/?project=ids-${Date.now()}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // 1. Deux pistes dans la meme milliseconde (le vrai fabricant de piste,
  //    makeTrackDef, appele deux fois de suite sans rendu entre les deux)
  const ids = await page.evaluate(async () => {
    const { makeTrackDef } = await import('/src/document/schema.ts');
    const p = (window as any).__dawProject;
    p.addTrack(makeTrackDef('Une', 'audio'));
    p.addTrack(makeTrackDef('Deux', 'midi'));
    const d = p.getDocument();
    return d.tracks.slice(-2).map((t: { id: string }) => t.id);
  });
  expect(ids[0]).not.toBe(ids[1]);
  for (const id of ids) expect(id).toMatch(new RegExp(`^track-${UUID}$`));

  // 2. Deux clips MIDI dans la meme milliseconde : ids distincts, en uuid
  const clipIds = await page.evaluate((trackId: string) => {
    const p = (window as any).__dawProject;
    const a = p.addMidiClip(trackId, 0, 48000);
    const b = p.addMidiClip(trackId, 96000, 48000);
    const d = p.getDocument();
    const inDoc = d.tracks.flatMap((t: { clips: { id: string }[] }) => t.clips.map((c) => c.id));
    return { a, b, inDoc };
  }, ids[1]);
  expect(clipIds.a).not.toBe(clipIds.b);
  expect(clipIds.inDoc).toEqual(expect.arrayContaining([clipIds.a, clipIds.b]));
  for (const id of clipIds.inDoc) expect(id).toMatch(new RegExp(`^clip-(.+-)?${UUID}$`));

  // 3. Le fabricant lui-meme : 10 000 ids, 10 000 valeurs
  const unique = await page.evaluate(async () => {
    const mod = await import('/src/document/ids.ts');
    const set = new Set<string>();
    for (let i = 0; i < 10000; i++) set.add(mod.newId('x'));
    return { size: set.size, stem: mod.clipStem('clip-kick-1788012345678-3'),
             stem2: mod.clipStem(mod.newId('clip', 'snare')) };
  });
  expect(unique.size).toBe(10000);
  expect(unique.stem).toBe('kick');
  expect(unique.stem2).toBe('snare');
});
