// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * LE FUSIBLE (2026-08-29) : le moteur porte un limiteur brick-wall sur sa
 * sortie LIVE (jamais dans les stems ni l'export). Ce que le gtest
 * testOutputLimiter prouve au signal connu (crete <= plafond, transparence
 * sous le plafond), cette spec le prouve DE BOUT EN BOUT sur le vrai
 * moteur : un kit pousse a +12 dB (piste x2, master x2) fait travailler le
 * fusible, la telemetrie le dit (EngineState 11-14) et l'UI le MONTRE
 * (badge LIM actif) - une action qui retient le son ne se cache pas.
 * Moteur reel en --mute (port 47821 libre exige).
 */
import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  waitForServerConnection, resolveBinary, waitUntil, countInFile,
  getTrackIds, setTrackGain, waitForGain,
} from './helpers';

const ENGINE_PORT = 47821;

const limiter = (page: Page) =>
  page.evaluate(() => (window as any).__dawLimiter ?? null);

test.describe('Output limiter (le fusible)', () => {
  test('a hot mix engages the engine limiter and the LIM badge shows it', async ({ page }) => {
    test.setTimeout(90000);
    const projectId = `e2e-limiter-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-limiter-${Date.now()}.log`);
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const logFd = fs.openSync(logPath, 'w');
    const engine: ChildProcess = spawn(
      engineExe,
      ['--server', 'ws://localhost:3000', '--project', projectId,
       '--play', '--mute', '--ws-port', String(ENGINE_PORT)],
      { stdio: ['ignore', logFd, logFd] },
    );
    fs.closeSync(logFd);

    try {
      expect(
        await waitUntil(() => countInFile(logPath, 'WebSocket server') >= 1, 15000),
        `engine WS never came up (log: ${logPath})`,
      ).toBe(true);
      // Le contrat de log : le fusible est ON par defaut, plafond -0.3
      expect(countInFile(logPath, 'output-limiter: ON ceiling=-0.3'),
        'output-limiter contract line').toBeGreaterThan(0);

      await page.goto(`/?project=${projectId}&lab=1`);
      await waitForServerConnection(page);
      await page.waitForSelector('[data-track-id]', { timeout: 10000 });
      await expect(page.locator('#engine-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      // Le badge existe, au repos, et la telemetrie dit : fusible arme
      const badge = page.locator('#limiter-badge');
      await expect(badge).toBeVisible();
      await expect.poll(() => limiter(page), { timeout: 10000 })
        .toMatchObject({ enabled: true, ceilingDb: expect.closeTo(-0.3, 2) });
      await expect(badge).toHaveAttribute('data-state', 'idle');

      // Un kit pose par l'UI, boucle ON pour que le son revienne
      await page.locator('[data-role="sample"]').first().click();
      await page.locator('[data-track-id] .track-lane').first()
        .click({ position: { x: 20, y: 20 } });
      await expect(page.locator('.clip').first()).toBeVisible({ timeout: 10000 });
      await page.locator('[data-role="sample"]').first().click();
      await expect.poll(() => countInFile(logPath, 'Graph updated'),
        { timeout: 10000 }).toBeGreaterThan(0);

      // Chaud : piste x2 et master x2 (+12 dB) - le kit depasse le plafond
      const [trackId] = await getTrackIds(page);
      await setTrackGain(page, trackId, 2);
      expect(await waitForGain(page, trackId, 2)).toBeCloseTo(2, 2);
      await page.locator('#master-gain').fill('2');
      await expect(page.locator('#master-db')).toHaveText('6.0 dB');  // formatGain : pas de signe

      await page.locator('#loop-btn').click();
      await page.locator('#play-btn').click();

      // Le moteur retient des blocs, et l'UI l'a MONTRE (badge actif,
      // reduction en dB dans le texte)
      await expect.poll(async () => (await limiter(page))?.engagedBlocks ?? 0,
        { timeout: 20000, message: 'the limiter never engaged on a +12 dB kit' })
        .toBeGreaterThan(0);
      await expect.poll(async () => (await limiter(page))?.state,
        { timeout: 5000 }).toBe('active');
      await expect(badge).toHaveText(/LIM -\d+\.\d/);
      // Trace visuelle (CLAUDE.md §8) : le badge allume, dans son contexte
      await page.locator('#master-strip').screenshot({ path: 'test-results/limiter-active.png' });

      await page.locator('#play-btn').click();
    } finally {
      engine.kill();
      await new Promise((r) => setTimeout(r, 300));
    }
  });
});
