// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Invariants du rack : knobs rotatifs (F4) et bouton BOX = fenetre GUI a la
 * demande (F1, cote WEB : le clic appelle engineClient.setEditor). Le <input
 * range> masque reste LA source de verite (contrat data-role=param) ; le knob
 * le pilote. L'audio (GUI reelle, boucle de session) est gteste a part.
 */
import { test, expect, Page } from '@playwright/test';
import { waitForServerConnection } from './helpers';

async function open(page: Page, id: string): Promise<void> {
  await page.goto(`/?project=${id}&lab=1`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
}

/** Ajoute un processor sur la piste selectionnee (via l'API + flush, comme
 *  l'UI) et attend que le rack le rende. */
async function addProcessor(page: Page, proc: unknown): Promise<void> {
  await page.evaluate((p) => {
    const proj = (window as any).__dawProject;
    const tid = proj.getDocument().tracks[0].id;
    proj.addProcessor(tid, p);
    (window as any).__dawFlush?.();
  }, proc);
}

test.describe('Rack : knobs (F4)', () => {
  test('un device a params rend des knobs ; le <input range> masque reste la source de verite', async ({ page }) => {
    await open(page, `ui-knob-${Date.now()}`);

    await addProcessor(page, {
      id: 'dev-eq-test', type: 'builtin.eq3', name: 'EQ Three', bypass: false,
      params: [
        { key: 'lowGainDb', value: 3 }, { key: 'lowFreq', value: 120 },
        { key: 'peakGainDb', value: -2 }, { key: 'peakFreq', value: 1000 },
        { key: 'peakQ', value: 0.9 }, { key: 'highGainDb', value: 0 },
        { key: 'highFreq', value: 6000 },
      ],
    });

    // 7 params -> 7 knobs, et 7 <input range> masques (le contrat)
    await expect(page.locator('#device-view-slot .knob')).toHaveCount(7);
    await expect(page.locator('#device-view-slot .param-input[data-role="param"]')).toHaveCount(7);

    // le knob PILOTE l'input : un drag change la valeur du slot + le doc
    const before = await page.evaluate(() =>
      (window as any).__dawProject.getDocument().tracks[0].chain
        .find((p: any) => p.id === 'dev-eq-test').params.find((x: any) => x.key === 'lowGainDb').value);
    const knob = page.locator('#device-view-slot .knob').first();
    const box = (await knob.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 6 }); // drag vers le haut = +
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() =>
      (window as any).__dawProject.getDocument().tracks[0].chain
        .find((p: any) => p.id === 'dev-eq-test')?.params.find((x: any) => x.key === 'lowGainDb')?.value))
      .not.toBe(before);
  });
});

test.describe('Rack : bouton BOX = fenetre GUI a la demande (F1 web)', () => {
  test('un vst3 a un bouton editeur ; le clic appelle engineClient.setEditor(procId, open)', async ({ page }) => {
    await open(page, `ui-editor-${Date.now()}`);

    // MODIF DE TEST SIGNALEE (2026-08-27) : BOX refuse desormais VISIBLEMENT
    // le clic quand le moteur est deconnecte (une action montre tous ses
    // effets - fin des clics dans le vide). Pour tester le CHEMIN d'envoi
    // en lab (sans moteur), on simule l'etat connecte ; le refus a son
    // pilote dedie (traces/box-refus.png).
    await page.evaluate(() => {
      const eng = (window as any).__dawEngine;
      eng.isConnected = () => true;
      (window as any).__edCalls = [];
      const orig = eng.setEditor.bind(eng);
      eng.setEditor = (idArg: string, open: boolean) => { (window as any).__edCalls.push([idArg, open]); orig(idArg, open); };
    });

    await addProcessor(page, {
      id: 'dev-vst-test', type: 'vst3', uid: '84E8DE5F92554F5396FAE4133C935A18',
      name: 'AGain', bypass: false, params: [],
    });

    const ed = page.locator('#device-view-slot .device[data-proc-id="dev-vst-test"] [data-role="editor"]');
    await expect(ed).toHaveCount(1);
    await ed.click();
    await expect.poll(() => page.evaluate(() => (window as any).__edCalls)).toContainEqual(['dev-vst-test', true]);
  });
});
