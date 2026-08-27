// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Boucle UTILISATEUR (AUDIT-6 QW), MOTEUR REEL : un drag sur la bande
 * cycle de la regle pose la region, le MOTEUR wrap dessus (preuve par la
 * telemetrie de position) ; double-clic efface et la lecture depasse la
 * region. La bande .ruler-cycle etait inerte (« reserved for the future
 * loop/cycle brace ») - elle prend vie ici.
 */

import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  waitForServerConnection, REPO_ROOT, resolveBinary, waitUntil, countInFile,
} from './helpers';

test('drag sur la bande cycle : le moteur boucle sur la region ; dblclick efface', async ({ page }) => {
  test.setTimeout(120000);
  const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const projectId = `e2e-loop-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-loop-'));

  execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], {
    encoding: 'utf-8',
  });
  execFileSync(
    'node',
    ['scripts/seed-again.mjs', '--base', path.join(dir, 'base.am'),
     '--assets', dir, '--project', projectId],
    { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' }
  );

  const tokFile = path.join(os.tmpdir(), 'daw-engine-token-47909');
  fs.rmSync(tokFile, { force: true });
  const logPath = path.join(dir, 'engine.log');
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--start-stopped', '--mute', '--assets', dir,
     '--ws-port', '47909'],
    { stdio: ['ignore', logFd, logFd] }
  );
  fs.closeSync(logFd);

  try {
    expect(
      await waitUntil(() => countInFile(logPath, 'Document loaded') >= 1, 20000),
      'engine did not load').toBe(true);
    expect(
      await waitUntil(() => fs.existsSync(tokFile), 15000),
      'no token file').toBe(true);
    expect(
      await waitUntil(
        () => countInFile(logPath, 'WebSocket server listening') >= 1, 15000),
      'engine WS never listened').toBe(true);

    await page.goto(`/?project=${projectId}&engine=47909`);
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });
    await page.waitForFunction(
      () => (window as any).__dawEngine?.isConnected?.() ?? false,
      null, { timeout: 15000 });

    // Collecte de position COTE NODE via l'horloge DOM #position
    // (MM:SS.mmm). Lecon du premier flake : une variable window injectee
    // ne survit pas a un reload incident (vite sous charge) - le DOM,
    // lui, se repeuple tout seul.
    const readSec = async (): Promise<number> => {
      const t = await page.locator('#position').textContent() ?? '';
      const m = /(\d+):(\d+(?:\.\d+)?)/.exec(t);
      return m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) : -1;
    };
    const collect = async (ms: number): Promise<number[]> => {
      const out: number[] = [];
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const s = await readSec();
        if (s >= 0) out.push(s);
        await page.waitForTimeout(60);
      }
      return out;
    };
    const stats = (arr: number[]) => {
      let wraps = 0;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] < arr[i - 1] - 0.1) wraps++;
      }
      return { max: Math.max(0, ...arr), wraps, n: arr.length,
        last: arr[arr.length - 1] ?? -1 };
    };

    // Drag [0.5 s -> 1.0 s] sur la bande cycle (grille 0.125 s a ce zoom)
    const band = page.locator('.ruler-cycle');
    const box = (await band.boundingBox())!;
    const pps = await page.evaluate(() => parseFloat(
      getComputedStyle(document.getElementById('tracks')!)
        .getPropertyValue('--grid-sec-px')));
    await page.mouse.move(box.x + 0.5 * pps, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 1.0 * pps, box.y + box.height / 2,
      { steps: 5 });
    await page.mouse.up();

    // L'etrier existe et le bouton loop est passe ON
    await expect(page.locator('.cycle-brace')).toBeVisible();
    await expect(page.locator('#loop-btn')).toHaveAttribute(
      'aria-pressed', 'true');

    // PLAY : les positions doivent rester bornees par la region et WRAPPER
    await page.locator('#play-btn').click();
    const phase1 = stats(await collect(2500));
    expect(phase1.n, 'aucune position lue').toBeGreaterThan(10);
    // Tolerance : 1 buffer driver + granularite telemetrie
    expect(phase1.max, 'la position a depasse la region').toBeLessThan(1.15);
    expect(phase1.wraps, 'aucun wrap observe').toBeGreaterThan(0);

    // DBLCLICK : efface la region -> la lecture DEPASSE l'ancienne fin
    await band.dblclick();
    await expect(page.locator('.cycle-brace')).toHaveCount(0);
    await expect(page.locator('#loop-btn')).toHaveAttribute(
      'aria-pressed', 'false');
    // La lecture continue (elle etait dans [0.5,1.0]) jusqu'a la fin du
    // contenu (2 s) : on doit voir des positions > 1.2 s. Diagnostic
    // riche : wraps>0 apres clear = le moteur a garde la region.
    const phase2 = stats(await collect(4000));
    expect(phase2.max,
      `apres clear : max=${phase2.max} wraps=${phase2.wraps} ` +
      `last=${phase2.last} n=${phase2.n}`
    ).toBeGreaterThan(1.2);

    expect(engine.exitCode, 'engine died during the test').toBeNull();
  } finally {
    engine.kill();
  }
});
