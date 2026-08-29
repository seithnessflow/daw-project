// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A4-8 (decision utilisateur 2026-08-29 : « on charge avec un bandeau ») :
 * un document invalide (gain 7, piste sans id) se CHARGE - les pistes sont
 * la, on peut travailler - et le bandeau #doc-banner le DIT avec les
 * fautes. Un projet sain n'a pas de bandeau. Le moteur charge aussi et
 * loggue `WARNING: document invalid (loaded anyway)` une fois (vrai
 * moteur en --mute, port 47821 libre exige).
 */
import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  waitForServerConnection, resolveBinary, waitUntil, countInFile, REPO_ROOT,
} from './helpers';

test('an invalid document loads anyway and the banner names the faults', async ({ page }) => {
  test.setTimeout(60000);
  const projectId = `e2e-invalid-${Date.now()}`;
  // Le projet existe des que quelqu'un s'y connecte : l'onglet d'abord
  await page.goto(`/?project=${projectId}`);
  await waitForServerConnection(page);
  await page.waitForSelector('[data-track-id]', { timeout: 10000 });
  await expect(page.locator('#doc-banner')).toBeHidden();

  execFileSync('node', ['scripts/seed-invalid.mjs', '--project', projectId],
    { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' });

  // Le change arrive par le serveur : CHARGE (la piste « sans id » est dans
  // le document) ET ANNONCE
  const banner = page.locator('#doc-banner');
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toContainText('Document invalide');
  await expect(banner).toContainText('gain 7');
  await expect(banner).toContainText('id vide');
  await banner.screenshot({ path: 'test-results/doc-banner.png' });  // trace visuelle
  const validity = await page.evaluate(() => (window as any).__dawDocValidity);
  expect(validity.errors.length).toBeGreaterThanOrEqual(2);
  const names = await page.evaluate(() =>
    (window as any).__dawProject.getDocument().tracks.map((t: { name: string }) => t.name));
  expect(names).toContain('sans id');

  // Un onglet neuf sur ce projet : le bandeau des le premier contact
  const fresh = await page.context().newPage();
  await fresh.goto(`/?project=${projectId}`);
  await waitForServerConnection(fresh);
  await expect(fresh.locator('#doc-banner')).toBeVisible({ timeout: 10000 });
  await fresh.close();

  // Le moteur charge aussi, et le dit une fois
  const logPath = path.join(os.tmpdir(), `daw-e2e-invalid-${Date.now()}.log`);
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(resolveBinary('ENGINE_EXE', 'daw_engine'),
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--mute', '--ws-port', '47821'],
    { stdio: ['ignore', logFd, logFd] });
  fs.closeSync(logFd);
  try {
    expect(await waitUntil(() =>
      countInFile(logPath, 'WARNING: document invalid (loaded anyway)') >= 1, 20000),
      `engine never reported the invalid document (log: ${logPath})`).toBe(true);
    expect(countInFile(logPath, 'invalid gain 7')).toBeGreaterThan(0);
    expect(countInFile(logPath, 'Graph updated'), 'the engine must still build the graph')
      .toBeGreaterThan(0);
  } finally {
    engine.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
});
