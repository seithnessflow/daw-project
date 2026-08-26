// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A1 automation - COUCHE DOCUMENT seulement (AUTOMATION-DESIGN.md) :
 * lanes et points via les mutateurs du Project (pas d'UI, pas de moteur).
 * Verifie les invariants d'ECRITURE (points tries par t, t rond >= 0,
 * v clamp 0..1), l'undo d'un ajout de point, et que delete lane + undo
 * restaure la lane A SA PLACE (index) avec ses points.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

/** Lanes d'automation de tracks[0], en plain JS (null si absent). */
const docLanes = (page: Page) =>
  page.evaluate(() => {
    const t = (window as any).__dawProject.getDocument().tracks[0];
    return t.automation ? JSON.parse(JSON.stringify(t.automation)) : null;
  });

test.describe('Automation - couche document (A1)', () => {
  test('lane + points clampes/tries ; undo point ; delete lane + undo a sa place', async ({ page }) => {
    await open(page, `auto-doc-${Date.now()}`);

    // ---- Lane sur tracks[0] ciblant gain ----
    const laneId = await page.evaluate(() => {
      const proj = (window as any).__dawProject;
      const tid = proj.getDocument().tracks[0].id;
      const id = proj.addAutomationLane(tid, { param: 'gain' });
      (window as any).__dawFlush?.();
      return id;
    });
    expect(laneId).toMatch(/^lane-/);

    // ---- 3 points, DANS LE DESORDRE, dont un HORS BORNES (t<0, v>1) ----
    await page.evaluate((lid) => {
      const proj = (window as any).__dawProject;
      const tid = proj.getDocument().tracks[0].id;
      proj.addAutomationPoint(tid, lid, 48000, 0.5);
      proj.addAutomationPoint(tid, lid, -100, 1.7);    // clamp -> t=0, v=1
      proj.addAutomationPoint(tid, lid, 24000.4, 0.25); // round -> t=24000
      (window as any).__dawFlush?.();
    }, laneId);

    let lanes = await docLanes(page);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe(laneId);
    expect(lanes[0].enabled).toBe(true);
    expect(lanes[0].target).toEqual({ param: 'gain' });
    // Tries par t A L'ECRITURE, valeurs clampees/arrondies
    expect(lanes[0].points).toEqual([
      { t: 0, v: 1 },
      { t: 24000, v: 0.25 },
      { t: 48000, v: 0.5 },
    ]);

    // ---- Ctrl+Z : le dernier ajout de point est undo-journalise ----
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await docLanes(page))[0].points).toEqual([
      { t: 0, v: 1 },
      { t: 48000, v: 0.5 },
    ]);

    // ---- Delete lane + undo : restauree A SA PLACE avec ses points ----
    // Une 2e lane (pan) donne un contexte d'ordre : la 1re doit revenir
    // a l'index 0, pas a la fin.
    const laneId2 = await page.evaluate((lid) => {
      const proj = (window as any).__dawProject;
      const tid = proj.getDocument().tracks[0].id;
      const id2 = proj.addAutomationLane(tid, { param: 'pan' });
      proj.deleteAutomationLane(tid, lid);
      (window as any).__dawFlush?.();
      return id2;
    }, laneId);

    lanes = await docLanes(page);
    expect(lanes.map((l: any) => l.id)).toEqual([laneId2]);

    await page.keyboard.press('Control+z');
    await expect.poll(async () =>
      (await docLanes(page)).map((l: any) => l.id)
    ).toEqual([laneId, laneId2]);
    lanes = await docLanes(page);
    expect(lanes[0].points).toEqual([
      { t: 0, v: 1 },
      { t: 48000, v: 0.5 },
    ]);
    expect(lanes[0].enabled).toBe(true);
  });
});
