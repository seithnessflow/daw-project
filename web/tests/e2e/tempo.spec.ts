// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * T3 TEMPO : la surface web du modele ADDITIVE-DUAL.
 * Preuves : le champ topbar ecrit un milli-BPM ENTIER + bump v2 lazy
 * (un projet jamais touche reste v1) ; un clip MIDI frais nait MUSICAL
 * (startTick, jamais startSample - exclusivite de domaine) ; un
 * changement de tempo DEPLACE le musical a l'ecran (prediction noyau,
 * ratio au pixel) et ne bouge PAS l'absolu ; undo du tempo ;
 * convergence LWW entre deux onglets ; bascule « Rendre musical » /
 * « Rendre absolu » undoable.
 *
 * Idiome : les mutations par evaluate ne re-rendent pas l'onglet
 * emetteur - les PIXELS se mesurent sur l'onglet RECEPTEUR (page2),
 * qui re-rend a chaque change distant.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

const leftPx = async (p: Page, selector: string): Promise<number> => {
  const el = p.locator(selector).first();
  return Number((await el.evaluate((e) =>
    (e as HTMLElement).style.left)).replace('px', ''));
};

test('tempo : registre v2 lazy, clip MIDI musical, deplacement au tempo, LWW',
  async ({ page, context }) => {
  test.setTimeout(90000);
  const projectId = `e2e-tempo-${Date.now()}`;
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // ---- v1 tant que rien de musical n'est ecrit --------------------
  expect(await page.evaluate(() =>
    (window as any).__dawProject.getDocument().schemaVersion)).toBe(1);

  // ---- le champ tempo : 100 BPM -> milli-BPM entier + v2 lazy -----
  await expect(page.locator('#tempo-input')).toBeVisible();
  await expect(page.locator('#tempo-input')).toHaveValue('120');
  await page.locator('#tempo-input').fill('100');
  await page.locator('#tempo-input').press('Enter');
  const afterTempo = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return { mb: d.tempoMilliBpm, v: d.schemaVersion };
  });
  expect(afterTempo.mb).toBe(100000);
  expect(afterTempo.v).toBe(2);

  // ---- un clip MIDI frais nait MUSICAL ----------------------------
  await page.locator('#new-track-btn').click();
  await page.locator('.ctx-menu >> text=+ Piste MIDI').click();
  const midiTrackId = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.find((t: any) => t.kind === 'midi').id as string;
  });
  await page.locator(`[data-track-id="${midiTrackId}"] .track-name`)
    .click({ force: true });
  // Le bouton « + clip MIDI » vit dans l'onglet piano du rack
  await page.locator('[data-role="rack-tab"][data-tab="piano"]').click();
  await page.locator('[data-role="add-midi"]').first().click();
  const midiClip = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) {
      for (const c of t.clips) {
        if (!c.assetHash) {
          return { id: c.id as string,
                   startTick: c.startTick ?? null,
                   lengthTick: c.lengthTick ?? null,
                   startSample: c.startSample ?? null };
        }
      }
    }
    return null;
  });
  expect(midiClip).not.toBeNull();
  expect(midiClip!.startTick).toBe(0);
  expect(midiClip!.lengthTick).toBeGreaterThanOrEqual(960);
  expect(midiClip!.startSample).toBeNull();  // exclusivite de domaine
  await expect(page.locator('.clip[data-domain="musical"]').first())
    .toBeVisible();

  // ---- le piano-roll musical pose des notes en TICKS --------------
  await page.locator('[data-role="rack-tab"][data-tab="piano"]').click();
  await page.locator('.pr-cell[data-pitch="60"][data-step="0"]').click();
  const note = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    for (const t of d.tracks) {
      for (const c of t.clips) {
        if (!c.assetHash && (c.notes ?? []).length) {
          const n = c.notes[0];
          return { startTick: n.startTick ?? null,
                   startSample: n.startSample ?? null };
        }
      }
    }
    return null;
  });
  expect(note).not.toBeNull();
  expect(note!.startTick).toBe(0);
  expect(note!.startSample).toBeNull();

  // ---- l'onglet recepteur (pixels + LWW) --------------------------
  const page2 = await context.newPage();
  await page2.goto(`/?project=${projectId}`);
  await waitForServerConnection(page2);
  await page2.waitForSelector('.clip[data-domain="musical"]',
    { timeout: 10000 });
  await expect(page2.locator('#tempo-input')).toHaveValue('100');

  // Le clip musical a la mesure 2 (tick 3840) - mutation emetteur,
  // rendu recepteur.
  await page.evaluate(([tid, cid]) => {
    const p = (window as any).__dawProject;
    p.setClipTiming(tid, cid, {
      startTick: 3840, lengthTick: 3840, offsetSamples: 0 });
    (window as any).__dawFlush();
  }, [midiTrackId, midiClip!.id]);
  await expect.poll(() =>
    leftPx(page2, '.clip[data-domain="musical"]')).toBeGreaterThan(0);
  const musical100 = await leftPx(page2, '.clip[data-domain="musical"]');

  // ---- tempo 100 -> 80 : le MUSICAL bouge du ratio 1,25 -----------
  await page.locator('#tempo-input').fill('80');
  await page.locator('#tempo-input').press('Enter');
  await expect.poll(async () =>
    (await leftPx(page2, '.clip[data-domain="musical"]')) / musical100)
    .toBeCloseTo(1.25, 2);

  // ---- undo du tempo ----------------------------------------------
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() =>
    (window as any).__dawProject.getDocument().tempoMilliBpm)).toBe(100000);
  await expect(page.locator('#tempo-input')).toHaveValue('100');

  // ---- LWW : l'autre onglet ecrit, tous convergent ----------------
  await page2.locator('#tempo-input').fill('140');
  await page2.locator('#tempo-input').press('Enter');
  await expect(page.locator('#tempo-input')).toHaveValue('140');
  const both = await Promise.all([page, page2].map((p) => p.evaluate(() =>
    (window as any).__dawProject.getDocument().tempoMilliBpm)));
  expect(both[0]).toBe(both[1]);
  await page2.close();
});

test('rendre musical / rendre absolu : bascule undoable d un clip audio',
  async ({ page }) => {
  test.setTimeout(60000);
  const projectId = `e2e-tempo-conv-${Date.now()}`;
  await page.goto(`/?project=${projectId}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });

  // Un clip AUDIO pose par le geste du kit (absolu par construction)
  await page.locator('[data-role="sample"]').first().click();
  await page.locator('[data-track-id] .track-lane').first()
    .click({ position: { x: 200, y: 30 } });
  await expect(page.locator('.clip')).toHaveCount(1);
  await page.locator('[data-role="sample"]').first().click();  // disarm
  await expect(page.locator('.clip').first())
    .toHaveAttribute('data-domain', 'absolu');
  const before = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    const c = d.tracks.flatMap((t: any) => t.clips)[0];
    return { start: c.startSample as number,
             len: c.lengthSamples as number };
  });

  // Clic droit -> Rendre musical (tempo 120 : 1 tick = 25 samples)
  await page.locator('.clip').first().click({ button: 'right', force: true });
  await page.locator('.ctx-menu >> text=Rendre musical').click();
  const musical = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    const c = d.tracks.flatMap((t: any) => t.clips)[0];
    return { startTick: c.startTick ?? null, startSample: c.startSample ?? null,
             lengthSamples: c.lengthSamples ?? null, v: d.schemaVersion };
  });
  expect(musical.startTick).not.toBeNull();
  expect(musical.startTick! % 120).toBe(0);  // snappe a la grille
  // Position preservee au demi-pas de grille pres (960 ticks max)
  expect(Math.abs(musical.startTick! * 25 - before.start))
    .toBeLessThanOrEqual(960 * 25 / 2);
  expect(musical.startSample).toBeNull();       // exclusivite
  expect(musical.lengthSamples).toBe(before.len);  // jamais etire
  expect(musical.v).toBe(2);
  await expect(page.locator('.clip').first())
    .toHaveAttribute('data-domain', 'musical');

  // Retour : Rendre absolu (fige au tempo actuel, prediction exacte)
  await page.locator('.clip').first().click({ button: 'right', force: true });
  await page.locator('.ctx-menu >> text=Rendre absolu').click();
  const back = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    const c = d.tracks.flatMap((t: any) => t.clips)[0];
    return { startTick: c.startTick ?? null, startSample: c.startSample ?? null };
  });
  expect(back.startTick).toBeNull();
  expect(back.startSample).toBe(musical.startTick! * 25);

  // Undo : la bascule est UNE entree (retour a musical, meme tick)
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    const c = d.tracks.flatMap((t: any) => t.clips)[0];
    return c.startTick ?? null;
  })).toBe(musical.startTick);
});
