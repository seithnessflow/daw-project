// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Invariants de la vue Session (clip-launcher, T7 + F5 cote WEB). Un slot se
 * cree et s'affiche ; lancer un slot / une scene appelle
 * engineClient.sessionLaunch (signal LOCAL de performance, PAS le document) et
 * marque l'etat « en lecture ». La boucle audio (horloge de session libre)
 * est gtestee cote moteur.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

test.describe('Vue Session : slots + launch (T7 + F5 web)', () => {
  test('creer un slot l\'affiche ; lancer appelle sessionLaunch + marque en lecture', async ({ page }) => {
    await open(page, `ui-sess-${Date.now()}`);

    // espionne sessionLaunch AVANT toute action
    await page.evaluate(() => {
      const eng = (window as any).__dawEngine;
      (window as any).__slCalls = [];
      const orig = eng.sessionLaunch.bind(eng);
      eng.sessionLaunch = (s: string, t: string, stop: boolean) => {
        (window as any).__slCalls.push([s, t, stop]); orig(s, t, stop);
      };
    });

    // scene + slot de session sur la 1ere piste (via l'API + flush, comme l'UI)
    const sceneId = await page.evaluate(() => {
      const proj = (window as any).__dawProject;
      proj.addScene('Scene 1'); (window as any).__dawFlush?.();
      const sid = proj.getDocument().scenes[0].id;
      const tid = proj.getDocument().tracks[0].id;
      proj.addSessionClip(tid, sid); (window as any).__dawFlush?.();
      return sid as string;
    });

    // vue Session : le slot rempli apparait
    await page.locator('[data-role="paradigm"][data-view="session"]').click();
    await expect(page.locator('#session-slot')).toBeVisible();
    await expect(page.locator('.ss-slot.filled')).toHaveCount(1);

    // lancer la scene -> sessionLaunch(sceneId, '', false) + etat visuel
    await page.locator('.ss-scene').first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__slCalls))
      .toContainEqual([sceneId, '', false]);
    await expect(page.locator('.ss-slot.playing')).toHaveCount(1);

    // re-cliquer la scene -> stop (toggle)
    await page.locator('.ss-scene').first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__slCalls.some((c: any[]) => c[2] === true))).toBe(true);
    await expect(page.locator('.ss-slot.playing')).toHaveCount(0);
  });
});
