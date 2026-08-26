// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A2 - l'automation de bout en bout, MOTEUR REEL : une lane de gain ecrite
 * par la PAGE (couche A1) voyage par le serveur Automerge jusqu'au moteur,
 * qui l'EVALUE dans son chemin audio - preuve par les VU (telemetrie
 * meters) : lane basse enabled = niveau bas ; lane disabled = le gain
 * manuel reprend et le niveau remonte. L'exactitude au bit est gtestee
 * cote moteur (testAutomationRender) ; ICI on prouve le CHEMIN complet
 * page -> serveur -> moteur -> telemetrie.
 *
 * Idiome : ce spec SPAWNE son moteur (port dedie 47906, log frais),
 * comme fader-to-engine / asset-fetch.
 */

import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  waitForServerConnection, getTrackIds, REPO_ROOT, resolveBinary,
  waitUntil, countInFile,
} from './helpers';

test('une lane de gain ecrite par la page pilote le niveau du moteur', async ({ page }) => {
  test.setTimeout(90000);
  const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const projectId = `e2e-auto-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-auto-'));

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

  // PURGER le token d'un run precedent : sinon la page peche le token
  // PERIME (waitUntil « le fichier existe » est satisfait instantanement),
  // le moteur repond 4001 et le re-essai unique peut rater la fenetre
  // (vu en sonde : 4001 puis 1006, connexion morte).
  const tokFile = path.join(os.tmpdir(), 'daw-engine-token-47906');
  fs.rmSync(tokFile, { force: true });

  const logPath = path.join(dir, 'engine.log');
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--start-stopped', '--mute', '--assets', dir,
     '--ws-port', '47906'],
    { stdio: ['ignore', logFd, logFd] }
  );
  fs.closeSync(logFd);

  try {
    expect(
      await waitUntil(() => countInFile(logPath, 'Document loaded') >= 1, 20000),
      `engine did not load the document (log: ${logPath})`
    ).toBe(true);
    // Le TOKEN doit exister AVANT d'ouvrir la page : le zero-paste fetch
    // /api/engine-token ne re-essaie pas un 404 (il ne re-fetch que sur
    // 4001) - une page ouverte trop tot ne se connecte jamais.
    expect(
      await waitUntil(() => fs.existsSync(tokFile), 15000),
      'token file never appeared'
    ).toBe(true);
    // ... et le WS doit ECOUTER avant que la page ne tente sa connexion :
    // le client moteur ne re-essaie pas un ERR_CONNECTION_REFUSED initial
    // (il ne re-essaie que sur 4001) - dette signalee, pas un flake a
    // masquer par un sleep.
    expect(
      await waitUntil(
        () => countInFile(logPath, 'WebSocket server listening') >= 1, 15000),
      'engine WS never started listening'
    ).toBe(true);

    await page.goto(`/?project=${projectId}&engine=47906`);
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });
    await page.waitForFunction(
      () => (window as any).__dawEngine?.isConnected?.() ?? false,
      null, { timeout: 15000 });

    const trackIds = await getTrackIds(page);
    expect(trackIds.length).toBeGreaterThan(0);
    // La piste QUI SONNE (celle du tone) - la lane doit viser celle-la
    const target = await page.evaluate(() => {
      const d = (window as any).__dawProject.getDocument();
      return (d.tracks.find((t: any) => t.clips.length > 0) ?? d.tracks[0]).id as string;
    });

    // Espion meters : le pic de la piste cible, collecte en continu
    await page.evaluate((tid) => {
      const eng = (window as any).__dawEngine;
      (window as any).__peaks = [] as number[];
      const prev = eng.onMeters;
      eng.onMeters = (meters: any[], l: number, r: number) => {
        const m = meters.find((x) => x.trackId === tid);
        if (m) (window as any).__peaks.push(Math.max(m.peakLeft, m.peakRight));
        prev?.(meters, l, r);
      };
    }, target);

    // LANE BASSE (plate a 0.05 -> gain 0.1) ecrite par la page (A1),
    // AVANT de jouer - le moteur doit la recevoir (Graph updated)
    const rebuilds0 = countInFile(logPath, 'Graph updated');
    const laneId = await page.evaluate((tid) => {
      const proj = (window as any).__dawProject;
      const id = proj.addAutomationLane(tid, { param: 'gain' });
      proj.addAutomationPoint(tid, id, 0, 0.05);
      proj.addAutomationPoint(tid, id, 10 * 48000, 0.05);
      (window as any).__dawFlush?.();
      return id as string;
    }, target);
    expect(
      await waitUntil(() => countInFile(logPath, 'Graph updated') > rebuilds0, 10000),
      'le moteur n a pas reconstruit apres l ajout de la lane'
    ).toBe(true);

    // PLAY en boucle (le doc fait ~2 s ; loop = mesure stable)
    await page.locator('#loop-btn').click();
    await page.locator('#play-btn').click();

    const collect = async (ms: number): Promise<number> => {
      await page.evaluate(() => { (window as any).__peaks = []; });
      await page.waitForTimeout(ms);
      return page.evaluate(() =>
        Math.max(0, ...((window as any).__peaks as number[])));
    };

    // Phase A : lane enabled -> niveau BAS mais non nul
    const low = await collect(1800);
    expect(low, 'aucun signal mesure avec la lane basse').toBeGreaterThan(0.001);

    // Phase B : lane DISABLED par la page -> le gain manuel (1.0) reprend
    const rebuilds1 = countInFile(logPath, 'Graph updated');
    await page.evaluate(([tid, lid]) => {
      const proj = (window as any).__dawProject;
      proj.setAutomationLaneEnabled(tid, lid, false);
      (window as any).__dawFlush?.();
    }, [target, laneId] as [string, string]);
    expect(
      await waitUntil(() => countInFile(logPath, 'Graph updated') > rebuilds1, 10000),
      'le moteur n a pas reconstruit apres le disable'
    ).toBe(true);
    await page.waitForTimeout(400);  // purge des pics de l ancien graphe

    const high = await collect(1800);

    // La preuve : lane 0.05 (gain 0.1) vs manuel 1.0 -> rapport ~10x ;
    // on exige >= 4x (marge large : fenetres de mesure, ramps de clips)
    expect(
      high,
      `niveau inchange apres disable (low=${low}, high=${high})`
    ).toBeGreaterThan(low * 4);

    expect(engine.exitCode, 'engine died during the test').toBeNull();
  } finally {
    engine.kill();
  }
});
