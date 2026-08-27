// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Export mixdown (AUDIT-6 QW1), MOTEUR REEL : le clic WAV↓ de la topbar
 * demande un rendu offline au moteur (thread ouvrier), le moteur publie
 * le WAV au store serveur, la page le telecharge et le tend au
 * navigateur. Preuves : l'evenement download livre un RIFF/WAVE non
 * vide ; la sonde __dawLastExport porte le hash ; le store serveur
 * contient <hash>.wav.
 *
 * Et le REFUS VISIBLE : sans moteur connecte, le clic flashe .refused
 * et ne telecharge rien (modele BOX - jamais un clic dans le vide).
 *
 * Idiome : ce spec SPAWNE son moteur (port dedie 47907, log frais),
 * comme automation-engine / fader-to-engine.
 */

import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  waitForServerConnection, REPO_ROOT, resolveBinary, waitUntil, countInFile,
  resolveAgainModule,
} from './helpers';

const AGAIN_UID = '84E8DE5F92554F5396FAE4133C935A18';

test('le bouton WAV exporte un mixdown telechargeable', async ({ page }) => {
  test.setTimeout(120000);
  const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const projectId = `e2e-export-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-export-'));

  // Tone + doc du generateur moteur, projet seede cote serveur
  execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], {
    encoding: 'utf-8',
  });
  execFileSync(
    'node',
    ['scripts/seed-again.mjs', '--base', path.join(dir, 'base.am'),
     '--assets', dir, '--project', projectId],
    { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' }
  );

  const tokFile = path.join(os.tmpdir(), 'daw-engine-token-47907');
  fs.rmSync(tokFile, { force: true });

  const logPath = path.join(dir, 'engine.log');
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--start-stopped', '--mute', '--assets', dir,
     '--ws-port', '47907',
     // Le doc seede contient AGain : sans ce mapping, le rendu offline
     // refuse BRUYAMMENT (voulu) - l'export doit donc le resoudre.
     '--vst3-module', `${AGAIN_UID}=${resolveAgainModule()}`],
    { stdio: ['ignore', logFd, logFd] }
  );
  fs.closeSync(logFd);

  try {
    expect(
      await waitUntil(() => countInFile(logPath, 'Document loaded') >= 1, 20000),
      `engine did not load the document (log: ${logPath})`
    ).toBe(true);
    expect(
      await waitUntil(() => fs.existsSync(tokFile), 15000),
      'token file never appeared'
    ).toBe(true);
    expect(
      await waitUntil(
        () => countInFile(logPath, 'WebSocket server listening') >= 1, 15000),
      'engine WS never started listening'
    ).toBe(true);

    await page.goto(`/?project=${projectId}&engine=47907`);
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });
    await page.waitForFunction(
      () => (window as any).__dawEngine?.isConnected?.() ?? false,
      null, { timeout: 15000 });

    // Le clic + le download (blob) : la page fetch le store puis tend le WAV
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${projectId}-mixdown.wav`);

    const saved = path.join(dir, 'downloaded.wav');
    await download.saveAs(saved);
    const bytes = fs.readFileSync(saved);
    expect(bytes.length, 'WAV telecharge trop petit').toBeGreaterThan(1000);
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WAVE');

    // La sonde de pilotage porte le hash, et le STORE serveur l'a
    const last = await page.evaluate(() => (window as any).__dawLastExport);
    expect(last?.wavHash).toMatch(/^[0-9a-f]{64}$/);
    expect(last.lengthSamples).toBeGreaterThan(0);
    const storeFile = path.join(
      REPO_ROOT, 'server', 'assets', `${last.wavHash}.wav`);
    expect(fs.existsSync(storeFile),
      `store file missing: ${storeFile}`).toBe(true);

    // Le bouton est rendu (plus busy) et raconte l'export dans son title
    await expect(page.locator('#export-btn')).not.toHaveClass(/busy/);

    expect(engine.exitCode, 'engine died during the test').toBeNull();
  } finally {
    engine.kill();
  }
});

test('sans moteur connecte, le clic WAV refuse VISIBLEMENT', async ({ page }) => {
  // Port moteur volontairement mort (47999) : la page ne se connecte pas.
  await page.goto('/?project=e2e-export-refus&engine=47999');
  await waitForServerConnection(page);
  await page.waitForSelector('#export-btn', { timeout: 10000 });

  await page.locator('#export-btn').click();
  await expect(page.locator('#export-btn')).toHaveClass(/refused/);
  const title = await page.locator('#export-btn').getAttribute('title');
  expect(title).toContain('MOTEUR NON CONNECTE');
});
