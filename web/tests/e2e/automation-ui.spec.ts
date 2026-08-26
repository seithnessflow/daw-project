// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A3 : l'UI des enveloppes. Le bouton A ouvre la lane ; double-clic pose
 * un point (cree la lane au premier geste) ; drag deplace ; clic droit
 * supprime ; ON/off bypass ; Ctrl+Z remonte le temps. Le document (A1)
 * et le moteur (A2) sont deja testes - ICI on teste les GESTES.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection, getTrackIds } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

const lanesOf = (page: Page, trackId: string) =>
  page.evaluate((tid) => {
    const t = (window as any).__dawProject.getDocument()
      .tracks.find((x: any) => x.id === tid);
    return (t?.automation ?? []).map((l: any) => ({
      param: l.target.param, enabled: l.enabled,
      points: l.points.map((p: any) => ({ t: p.t, v: p.v })),
    }));
  }, trackId);

test.describe('A3 - lane d\'automation : gestes', () => {
  test('A ouvre la lane ; dblclick pose ; drag deplace ; clic droit supprime ; undo', async ({ page }) => {
    await open(page, `auto-ui-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];

    // le bouton A de la piste 1 ouvre la rangee
    const aBtn = page.locator(
      `.track[data-track-id="${trackId}"] [data-role="automation"]`);
    await aBtn.click();
    const row = page.locator(`.automation-row[data-auto-track="${trackId}"]`);
    await expect(row).toBeVisible();

    // double-clic sur la courbe : lane creee + premier point
    const svg = row.locator('.automation-svg');
    const box = (await svg.boundingBox())!;
    await page.mouse.dblclick(box.x + 200, box.y + box.height / 2);
    await expect.poll(async () => (await lanesOf(page, trackId)).length).toBe(1);
    let lanes = await lanesOf(page, trackId);
    expect(lanes[0].param).toBe('gain');
    expect(lanes[0].enabled).toBe(true);
    expect(lanes[0].points.length).toBe(1);
    expect(lanes[0].points[0].v).toBeGreaterThan(0.3);
    expect(lanes[0].points[0].v).toBeLessThan(0.7);

    // deuxieme point plus loin et plus haut - tries par t
    await page.mouse.dblclick(box.x + 400, box.y + 8);
    await expect.poll(async () =>
      (await lanesOf(page, trackId))[0].points.length).toBe(2);
    lanes = await lanesOf(page, trackId);
    expect(lanes[0].points[1].t).toBeGreaterThan(lanes[0].points[0].t);
    expect(lanes[0].points[1].v).toBeGreaterThan(0.8);

    // DRAG du premier point vers le bas (v diminue)
    const before = lanes[0].points[0];
    const pt = row.locator('.automation-point').first();
    const pb = (await pt.boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + 30, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () =>
      (await lanesOf(page, trackId))[0].points[0].v).toBeLessThan(before.v);

    // clic droit sur un point -> Supprimer le point
    await row.locator('.automation-point').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Supprimer le point' }).click();
    await expect.poll(async () =>
      (await lanesOf(page, trackId))[0].points.length).toBe(1);

    // ON/off : bypass de la lane
    await row.locator('.automation-enable').click();
    await expect.poll(async () =>
      (await lanesOf(page, trackId))[0].enabled).toBe(false);

    // Ctrl+Z remonte : re-enabled, puis le point revient
    await page.keyboard.press('Control+z');
    await expect.poll(async () =>
      (await lanesOf(page, trackId))[0].enabled).toBe(true);
    await page.keyboard.press('Control+z');
    await expect.poll(async () =>
      (await lanesOf(page, trackId))[0].points.length).toBe(2);
  });

  test('clic droit sur la lane : bypass et suppression de l\'enveloppe', async ({ page }) => {
    await open(page, `auto-ui2-${Date.now()}`);
    const trackId = (await getTrackIds(page))[0];
    await page.locator(
      `.track[data-track-id="${trackId}"] [data-role="automation"]`).click();
    const row = page.locator(`.automation-row[data-auto-track="${trackId}"]`);
    const svg = row.locator('.automation-svg');
    const box = (await svg.boundingBox())!;
    await page.mouse.dblclick(box.x + 150, box.y + 20);
    await expect.poll(async () => (await lanesOf(page, trackId)).length).toBe(1);

    // menu de lane (clic droit hors point)
    await page.mouse.click(box.x + 500, box.y + 40, { button: 'right' });
    await page.getByRole('menuitem', { name: /Bypass/ }).click();
    await expect.poll(async () =>
      (await lanesOf(page, trackId))[0].enabled).toBe(false);

    await page.mouse.click(box.x + 500, box.y + 40, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Supprimer l\'enveloppe' }).click();
    await expect.poll(async () => (await lanesOf(page, trackId)).length).toBe(0);
  });
});
