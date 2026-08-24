// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Session 3 (arbitrage b) : LE BADGE DE FRAICHEUR NE MENT JAMAIS.
 *
 * Le producteur (moteur) diffuse sf:1 toutes les 2 s sur le canal
 * ephemere pour chaque noeud vst3 qu'il resout ; le badge STEM a trois
 * etats et le pire mensonge (« rejouer l'ancien stem en silence ») est
 * rendu VISIBLE :
 * 1. producteur vivant + cle a jour -> data-fresh="fresh" ;
 * 2. un reglage change -> le stem se re-rend, le badge REVIENT frais
 *    avec un NOUVEAU hash (le cycle perime->re-rendu->frais prouve) ;
 * 3. producteur MORT -> "unknown" en < 10 s (« fraicheur inconnue »),
 *    jamais un faux frais.
 *
 * Moteur reel sur 47821 (port LIBRE requis, meme contrainte que les
 * autres specs moteur-reel).
 */
import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForServerConnection, resolveBinary, waitUntil, countInFile } from './helpers';

const ENGINE_PORT = 47821;
const AGAIN_UID = '84E8DE5F92554F5396FAE4133C935A18';

test.describe('Stem freshness (session 3, arbitrage b)', () => {
  test('fresh -> param change -> new fresh stem -> engine dead -> unknown', async ({ page }) => {
    test.setTimeout(150000);
    const projectId = `e2e-fresh-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-fresh-${Date.now()}.log`);
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const logFd = fs.openSync(logPath, 'w');
    const engine: ChildProcess = spawn(
      engineExe,
      ['--server', 'ws://localhost:3000', '--project', projectId,
       '--play', '--start-stopped', '--mute', '--ws-port', String(ENGINE_PORT),
       '--vst3-module', `${AGAIN_UID}=VST3/again.vst3`],
      { stdio: ['ignore', logFd, logFd] },
    );
    fs.closeSync(logFd);

    try {
      expect(
        await waitUntil(() => countInFile(logPath, 'WebSocket server') >= 1, 15000),
        `engine WS never came up (log: ${logPath})`,
      ).toBe(true);

      await page.goto(`/?project=${projectId}&lab=1`);
      await waitForServerConnection(page);
      await page.waitForSelector('[data-track-id]', { timeout: 10000 });
      await expect(page.locator('#engine-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      // Contenu + un device AGain (le prefill du champ uid)
      await page.locator('[data-role="sample"]').first().click();
      await page.locator('[data-track-id] .track-lane').first()
        .click({ position: { x: 20, y: 20 } });
      await expect(page.locator('.clip').first()).toBeVisible({ timeout: 10000 });
      await page.locator('[data-role="sample"]').first().click();
      await page.locator('[data-track-id]').first().click();
      await page.locator('#add-device-btn').click();
      await page.locator('[data-role="add-vst3"]').click();

      // 1. Le stem apparait et le badge devient FRAIS (signal sf vivant)
      const stem = page.locator('[data-role="device-stem"]').first();
      await expect(stem).toBeVisible({ timeout: 30000 });
      await expect(stem).toHaveAttribute('data-fresh', 'fresh', { timeout: 15000 });
      const hashBefore = await stem.textContent();

      // 2. Une ENTREE du rendu change (un 2e clip - la geometrie des
      // clips est dans la cle) -> nouveau stem, badge REVENU frais avec
      // un NOUVEAU hash (cycle complet ; l'etat intermediaire "stale"
      // est reel mais trop bref pour une assertion stable)
      await page.locator('[data-role="sample"]').first().click();
      await page.locator('[data-track-id] .track-lane').first()
        .click({ position: { x: 160, y: 20 } });
      await expect(page.locator('.clip')).toHaveCount(2, { timeout: 10000 });
      await page.locator('[data-role="sample"]').first().click();
      await expect
        .poll(async () => {
          const fresh = await stem.getAttribute('data-fresh');
          const text = await stem.textContent();
          return fresh === 'fresh' && text !== hashBefore ? 'cycled' : `${fresh}/${text === hashBefore ? 'same' : 'new'}`;
        }, { timeout: 30000 })
        .toBe('cycled');

      // 3. Producteur mort -> « fraicheur inconnue », jamais un faux frais
      engine.kill('SIGKILL');
      await expect(stem).toHaveAttribute('data-fresh', 'unknown', { timeout: 12000 });
    } finally {
      try { engine.kill('SIGKILL'); } catch { /* already dead */ }
    }
  });
});
