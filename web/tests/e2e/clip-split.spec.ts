// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * SCISSION de clip (AUDIT-6, edition d'echelle) : clic droit -> "Scinder
 * ici" a la position du clic (snappee), Ctrl+E au marqueur. Preuves de
 * GEOMETRIE (non destructif : left.len + right.len = total, right.offset
 * = left.len - la recette, pas l'asset), UN Ctrl+Z recolle (groupe
 * d'undo), le fade-out part au clip droit, et un clip MIDI n'offre PAS
 * l'entree (refus par absence, pas par erreur).
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForServerConnection, REPO_ROOT, resolveBinary } from './helpers';

async function seedProject(projectId: string): Promise<void> {
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-split-'));
  execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], {
    encoding: 'utf-8',
  });
  execFileSync(
    'node',
    ['scripts/seed-again.mjs', '--base', path.join(dir, 'base.am'),
     '--assets', dir, '--project', projectId],
    { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' }
  );
}

test('clic droit -> Scinder ici : geometrie exacte, fades repartis, un Ctrl+Z recolle', async ({ page }) => {
  const projectId = `e2e-split-${Date.now()}`;
  await seedProject(projectId);
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('.clip[data-clip-id]', { timeout: 10000 });

  // Etat initial + un fade-out pose (pour prouver la repartition)
  const before = await page.evaluate(() => {
    const p = (window as any).__dawProject;
    const d = p.getDocument();
    const t = d.tracks.find((x: any) => x.clips.length > 0);
    const c = t.clips[0];
    p.setClipFades(t.id, c.id, 0, 4800);
    (window as any).__dawFlush?.();
    return { trackId: t.id, clipId: c.id, start: c.startSample,
      len: c.lengthSamples, offset: c.offsetSamples };
  });

  // Clic droit au MILIEU du clip -> "Scinder ici"
  const clip = page.locator(`.clip[data-clip-id="${before.clipId}"]`);
  // force: les clips s'animent (life layer) - idiome ui-context-menu.
  // Centre par defaut : une position fixe en px sortait du clip aux
  // petits zooms (force clique alors la LANE - menu de piste, piege paye)
  await clip.click({ button: 'right', force: true });
  await page.locator('.ctx-menu >> text=Scinder ici').click();

  const after = await page.evaluate((args) => {
    const d = (window as any).__dawProject.getDocument();
    const t = d.tracks.find((x: any) => x.id === args.trackId);
    return t.clips.map((c: any) => ({ id: c.id, start: c.startSample,
      len: c.lengthSamples, offset: c.offsetSamples,
      fadeIn: c.fadeInSamples ?? 0, fadeOut: c.fadeOutSamples ?? 0 }));
  }, before);
  expect(after.length).toBe(2);
  const left = after.find((c: any) => c.id === before.clipId)!;
  const right = after.find((c: any) => c.id !== before.clipId)!;
  // Geometrie : le total est conserve, la recette droite reprend ou la
  // gauche s'arrete (non destructif - meme asset, offsets contigus)
  expect(left.start).toBe(before.start);
  expect(left.len + right.len).toBe(before.len);
  expect(right.start).toBe(before.start + left.len);
  expect(right.offset).toBe(before.offset + left.len);
  // Fades : le fade-out est parti au clip droit
  expect(left.fadeOut).toBe(0);
  expect(right.fadeOut).toBe(4800);

  // UN SEUL Ctrl+Z recolle (groupe d'undo)
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate((args) => {
    const d = (window as any).__dawProject.getDocument();
    const t = d.tracks.find((x: any) => x.id === args.trackId);
    return { n: t.clips.length, len: t.clips[0].lengthSamples,
      fadeOut: t.clips[0].fadeOutSamples ?? 0 };
  }, before);
  expect(undone.n).toBe(1);
  expect(undone.len).toBe(before.len);
  expect(undone.fadeOut).toBe(4800);
});

test('Ctrl+E scinde au marqueur ; un clip MIDI n offre pas Scinder', async ({ page }) => {
  const projectId = `e2e-split2-${Date.now()}`;
  await seedProject(projectId);
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('.clip[data-clip-id]', { timeout: 10000 });

  // Selectionner le clip + poser le marqueur en son milieu (clic couloir)
  const info = await page.evaluate(() => {
    const d = (window as any).__dawProject.getDocument();
    const t = d.tracks.find((x: any) => x.clips.length > 0);
    const c = t.clips[0];
    return { trackId: t.id, clipId: c.id, len: c.lengthSamples,
      midSec: (c.startSample + c.lengthSamples / 2) / d.sampleRate };
  });
  await page.locator(`.clip[data-clip-id="${info.clipId}"] .clip-name`)
    .click({ force: true });
  // Poser le marqueur par un clic sur le couloir au milieu du clip
  const lane = page.locator(`[data-track-id="${info.trackId}"] .track-lane`);
  const laneBox = (await lane.boundingBox())!;
  const pps = await page.evaluate(() => parseFloat(
    getComputedStyle(document.getElementById('tracks')!)
      .getPropertyValue('--grid-sec-px')));
  await lane.click({ position: { x: info.midSec * pps, y: laneBox.height - 4 } });
  // Re-selectionner le clip (le clic couloir a pu deselectionner)
  await page.locator(`.clip[data-clip-id="${info.clipId}"] .clip-name`)
    .click({ force: true });
  await page.keyboard.press('Control+e');
  const n = await page.evaluate((args) => {
    const d = (window as any).__dawProject.getDocument();
    return d.tracks.find((x: any) => x.id === args.trackId).clips.length;
  }, info);
  expect(n).toBe(2);

  // Clip MIDI : pas d'entree "Scinder ici" au menu
  await page.evaluate((args) => {
    const p = (window as any).__dawProject;
    p.addMidiClip(args.trackId, 480000, 96000);
    (window as any).__dawFlush?.();
  }, info);
  await page.waitForTimeout(200);
  const midiClip = page.locator(
    `[data-track-id="${info.trackId}"] .clip[data-clip-id]`).last();
  await midiClip.click({ button: 'right', force: true });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await expect(page.locator('.ctx-menu >> text=Scinder ici'))
    .toHaveCount(0);
});
