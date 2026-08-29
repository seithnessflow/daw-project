// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * L'ASSET QUI ARRIVE TARD (2026-08-29) : un clip pose AVANT que son asset
 * ne soit au store prenait un 404 que le moteur retenait pour toute la
 * session - clip muet a vie, sans refus visible (CI Linux, kit jamais
 * seme). Desormais le moteur RETENTE avec backoff (1 s, x2, plafond
 * 30 s) au rebuild suivant. Cette spec rejoue le scenario sur le vrai
 * moteur : clip pose -> 404 + « retry in 1 s » -> l'asset est PUT ->
 * un geste (gain) provoque le rebuild -> « now on server ... fetched »
 * et le son joue (le fusible a -24 dBFS sert d'oracle de son : il
 * retient des blocs). Moteur reel en --mute (port 47821 libre exige).
 */
import { test, expect, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  waitForServerConnection, resolveBinary, waitUntil, countInFile,
  getTrackIds, setTrackGain, waitForGain,
} from './helpers';

const ENGINE_PORT = 47821;
const SR = 48000;

/** Un WAV 16 bits stereo d'une seconde, sinus 220 Hz a -6 dBFS, unique
 *  par appel (la phase depend du seed) - un hash que le store n'a jamais. */
function makeWav(seed: number): Buffer {
  const frames = SR;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * 220 * i / SR + seed));
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const limiter = (page: Page) =>
  page.evaluate(() => (window as any).__dawLimiter ?? null);

test('a clip whose asset arrives AFTER the first rebuild plays once the asset is there', async ({ page }) => {
  test.setTimeout(90000);
  const projectId = `e2e-late-${Date.now()}`;
  const logPath = path.join(os.tmpdir(), `daw-e2e-late-${Date.now()}.log`);
  const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--mute', '--ws-port', String(ENGINE_PORT),
     '--limiter-ceiling', '-24'],
    { stdio: ['ignore', logFd, logFd] },
  );
  fs.closeSync(logFd);

  try {
    expect(await waitUntil(() => countInFile(logPath, 'WebSocket server') >= 1, 15000),
      `engine WS never came up (log: ${logPath})`).toBe(true);

    await page.goto(`/?project=${projectId}`);
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });
    await expect(page.locator('#engine-status'))
      .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

    // 1. Le clip est pose AVANT que l'asset n'existe au store
    const wav = makeWav(Date.now() % 1000);
    const hash = createHash('sha256').update(wav).digest('hex');
    const [trackId] = await getTrackIds(page);
    await page.evaluate(({ trackId, hash }) => {
      (window as any).__dawProject.addClip(trackId, {
        id: `clip-late-${hash.slice(0, 8)}`, assetHash: hash,
        startSample: 0, lengthSamples: 48000, offsetSamples: 0,
      });
    }, { trackId, hash });
    // Le geste qui envoie (sendLastChange pousse TOUS les changes en attente)
    await setTrackGain(page, trackId, 2);
    expect(await waitForGain(page, trackId, 2)).toBeCloseTo(2, 2);

    await expect.poll(() => countInFile(logPath, `Asset ${hash}: not on server (404)`),
      { timeout: 15000, message: 'the engine never looked for the asset' }).toBeGreaterThan(0);
    expect(countInFile(logPath, `Asset ${hash.slice(0, 8)}: retry in 1 s (attempt 1)`),
      'the miss is scheduled for a retry, not remembered forever').toBeGreaterThan(0);

    // 2. L'asset arrive au store (PUT verifie par hash)
    const put = await fetch(`http://localhost:3000/assets/${hash}`, { method: 'PUT', body: wav });
    expect(put.status, 'store refused the late asset').toBe(201);

    // 3. Un rebuild apres l'echeance : le moteur retente, l'asset joue
    await page.locator('#loop-btn').click();
    await page.locator('#play-btn').click();
    const engagedBlocks = async () => (await limiter(page))?.engagedBlocks ?? 0;
    const deadline = Date.now() + 30000;
    let nudge = 1.9;
    while (Date.now() < deadline && (await engagedBlocks()) === 0) {
      await new Promise((r) => setTimeout(r, 700));
      nudge = nudge === 1.9 ? 2 : 1.9;   // un rebuild par tour, au-dela de l'echeance
      await setTrackGain(page, trackId, nudge);
    }
    expect(countInFile(logPath, `Asset ${hash.slice(0, 8)}: now on server after`),
      `the engine never re-fetched the late asset (log: ${logPath})`).toBeGreaterThan(0);
    expect(await engagedBlocks(), 'the late asset never produced sound').toBeGreaterThan(0);

    await page.locator('#play-btn').click();
  } finally {
    engine.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
});
