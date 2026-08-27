// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Gardes d'onglet (2026-08-27, « ca m'arrive trop souvent d'ouvrir un
 * onglet qui est une vieille version du site » + l'incident « rien dans
 * l'arrangement et pourtant l'export sonne ») :
 *
 * 1. GARDE DE VERSION : /api/version change (stack relancee sous
 *    l'onglet) -> l'onglet se RECHARGE seul (<= ~10 s de poll).
 * 2. GARDE DE PROJET : badge du projet dans la topbar ; moteur sur un
 *    AUTRE projet -> bandeau visible + export REFUSE.
 */

import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  waitForServerConnection, REPO_ROOT, resolveBinary, waitUntil, countInFile,
} from './helpers';

test('version du site changee -> l onglet se recharge seul', async ({ page }) => {
  test.setTimeout(60000);
  // Interception : 2 premieres reponses = version A (chargement + 1er
  // poll), ensuite version B - le guard doit recharger la page.
  let calls = 0;
  await page.route('**/api/version', (route) => {
    calls++;
    const v = calls <= 2 ? 'serve-A' : 'serve-B';
    void route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ v }),
    });
  });

  await page.goto('/?project=e2e-guard-version');
  await waitForServerConnection(page);
  // Marqueur volatil : il ne survit PAS a un reload
  await page.evaluate(() => { (window as any).__notReloaded = true; });

  // Le poll est a 10 s : sous 15 s le marqueur doit avoir disparu
  expect(
    await waitUntil(async () =>
      !(await page.evaluate(() => (window as any).__notReloaded)), 15000),
    'l onglet ne s est pas recharge apres le changement de version'
  ).toBe(true);
  // Et la page est bien revivante (pas une page blanche)
  await page.waitForSelector('#project-badge', { timeout: 10000 });
});

test('badge projet affiche ; moteur sur un AUTRE projet -> bandeau + export refuse', async ({ page }) => {
  test.setTimeout(120000);
  const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const engineProject = `e2e-guard-eng-${Date.now()}`;
  const tabProject = `e2e-guard-tab-${Date.now()}`;

  // Deux projets seedes : le moteur jouera l'un, l'onglet montrera
  // l'autre. HERMETIQUE (rouge CI 33075743392) : un DOSSIER et un
  // base.am PAR seed - deux seeds partageant le meme dossier ont produit
  // en CI un base.am aux tracks illisibles au second passage.
  let dir = '';
  for (const p of [engineProject, tabProject]) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-guard-'));
    if (p === engineProject) dir = d;  // le moteur pointe ce dossier
    execFileSync(createTestDoc, [path.join(d, 'base.am'), d, '2'], {
      encoding: 'utf-8',
    });
    execFileSync(
      'node',
      ['scripts/seed-again.mjs', '--base', path.join(d, 'base.am'),
       '--assets', d, '--project', p],
      { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' }
    );
  }

  const tokFile = path.join(os.tmpdir(), 'daw-engine-token-47908');
  fs.rmSync(tokFile, { force: true });
  const logPath = path.join(dir, 'engine.log');
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', engineProject,
     '--play', '--start-stopped', '--mute', '--assets', dir,
     '--ws-port', '47908'],
    { stdio: ['ignore', logFd, logFd] }
  );
  fs.closeSync(logFd);

  try {
    expect(
      await waitUntil(() => countInFile(logPath, 'Document loaded') >= 1, 20000),
      'engine did not load').toBe(true);
    expect(
      await waitUntil(() => fs.existsSync(tokFile), 15000),
      'token file never appeared').toBe(true);
    expect(
      await waitUntil(
        () => countInFile(logPath, 'WebSocket server listening') >= 1, 15000),
      'engine WS never started').toBe(true);

    // L'onglet montre tabProject, le moteur joue engineProject
    await page.goto(`/?project=${tabProject}&engine=47908`);
    await waitForServerConnection(page);
    await page.waitForFunction(
      () => (window as any).__dawEngine?.isConnected?.() ?? false,
      null, { timeout: 15000 });

    // Badge : l'onglet dit ce qu'il montre
    await expect(page.locator('#project-badge')).toHaveText(tabProject);

    // Bandeau de desaccord (poll 1 s + telemetrie 30 Hz)
    const banner = page.locator('#project-banner');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText(engineProject);

    // Export refuse VISIBLEMENT (le WAV sortirait l'autre projet)
    await page.locator('#export-btn').click();
    await expect(page.locator('#export-btn')).toHaveClass(/refused/);
    const title = await page.locator('#export-btn').getAttribute('title');
    expect(title).toContain(engineProject);

    // Le bouton du bandeau rejoint le projet du moteur -> bandeau eteint
    await banner.locator('button').click();
    await page.waitForURL(`**project=${engineProject}**`, { timeout: 10000 });
    await waitForServerConnection(page);
    await page.waitForFunction(
      () => (window as any).__dawEngine?.isConnected?.() ?? false,
      null, { timeout: 15000 });
    await expect(page.locator('#project-banner')).toBeHidden({ timeout: 10000 });

    expect(engine.exitCode, 'engine died during the test').toBeNull();
  } finally {
    engine.kill();
  }
});
