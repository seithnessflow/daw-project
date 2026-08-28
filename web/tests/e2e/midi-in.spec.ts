// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * VAGUE 3, premier maillon (2026-08-28) : l'entree MIDI LIVE.
 * Un port loopMIDI « MagicPotion » (cree par l'utilisateur) -> le moteur
 * l'ouvre avec --midi-in -> un instrument mda DX10 pose PAR LA PAGE sur une
 * piste MIDI -> `midi_send` envoie une note sur le port -> le moteur la
 * route (contrats de log `midi-in:`) et la piste SONNE (crete > 0 vue par
 * la telemetrie), transport ARRETE (monitoring : etape 0 + gate arme).
 * Moteur en --mute : le backend null appelle le callback, tout est
 * prouvable en silence. Skip propre : pas Windows, ou port absent.
 */

import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  REPO_ROOT, resolveBinary, waitUntil, countInFile, waitForServerConnection,
} from './helpers';

const ENGINE_PORT = 47821;
const PORT_NAME = 'MagicPotion';
// mda DX10 : composant (uid « VST... »), pas le controleur (« VSE... »)
const DX10_UID = '5653544D4441786D6461206478313000';

function mdaModule(): string {
  const candidates = [
    path.join(REPO_ROOT, 'engine', 'build-msvc', 'VST3', 'mda-vst3.vst3'),
    path.join(REPO_ROOT, 'engine', 'build', 'VST3', 'mda-vst3.vst3'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('mda-vst3.vst3 introuvable (build du moteur ?)');
}

function midiPortPresent(engineExe: string): boolean {
  try {
    const out = execFileSync(engineExe, ['--list-midi-devices'], { encoding: 'utf8' });
    return out.includes(PORT_NAME);
  } catch { return false; }
}

test.describe('MIDI live : port -> moteur -> instrument (Vague 3)', () => {
  test('une note envoyee sur le port fait sonner l instrument, transport arrete', async ({ page }) => {
    test.skip(process.platform !== 'win32', 'WinMM : Windows seulement');
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    test.skip(!midiPortPresent(engineExe), `port loopMIDI « ${PORT_NAME} » absent`);
    const sendExe = resolveBinary('MIDI_SEND_EXE', 'midi_send');
    test.setTimeout(90000);

    const projectId = `e2e-midi-in-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-midi-in-${Date.now()}.log`);
    const logFd = fs.openSync(logPath, 'w');
    const engine: ChildProcess = spawn(
      engineExe,
      ['--server', 'ws://localhost:3000', '--project', projectId,
       '--play', '--start-stopped', '--mute', '--ws-port', String(ENGINE_PORT),
       '--midi-in', PORT_NAME,
       '--vst3-module', `${DX10_UID}=${mdaModule()}`],
      { stdio: ['ignore', logFd, logFd] },
    );
    fs.closeSync(logFd);

    try {
      expect(
        await waitUntil(() => countInFile(logPath, 'WebSocket server') >= 1, 15000),
        `moteur jamais pret (log: ${logPath})`,
      ).toBe(true);
      // CONTRAT : le port est ouvert au demarrage
      expect(countInFile(logPath, `midi-in: opened "`)).toBeGreaterThanOrEqual(1);

      await page.goto(`/?project=${projectId}`);
      await waitForServerConnection(page);
      await page.waitForSelector('[data-track-id]', { timeout: 10000 });
      await expect(page.locator('#engine-status'))
        .toHaveAttribute('data-state', 'connected', { timeout: 15000 });

      // Une piste MIDI par le coin, l'instrument DX10 pose PAR LA PAGE
      await page.locator('#new-track-btn').click();
      await page.locator('.ctx-menu >> text=+ Piste MIDI').click();
      const rebuilds0 = countInFile(logPath, 'Graph updated');
      const trackId = await page.evaluate((uid) => {
        const proj = (window as any).__dawProject;
        const d = proj.getDocument();
        const t = d.tracks.find((x: any) => x.kind === 'midi');
        proj.addProcessor(t.id, {
          id: `dx10-${Date.now()}`, type: 'vst3', uid, name: 'mda DX10',
          bypass: false, params: [],
        });
        (window as any).__dawFlush?.();
        return t.id as string;
      }, DX10_UID);
      expect(
        await waitUntil(() => countInFile(logPath, 'Graph updated') > rebuilds0, 15000),
        'le moteur n a pas reconstruit avec l instrument',
      ).toBe(true);
      // CONTRAT : la piste cible est resolue (auto = la premiere avec un instrument)
      expect(
        await waitUntil(() => countInFile(logPath, `midi-in: -> track "${trackId}"`) >= 1, 10000),
        `piste cible non resolue (log: ${logPath})`,
      ).toBe(true);

      // Espion meters sur la piste cible
      await page.evaluate((tid) => {
        const eng = (window as any).__dawEngine;
        (window as any).__peaks = [] as number[];
        const prev = eng.onMeters;
        eng.onMeters = (meters: any[], l: number, r: number) => {
          const m = meters.find((x) => x.trackId === tid);
          if (m) (window as any).__peaks.push(Math.max(m.peakLeft, m.peakRight));
          prev?.(meters, l, r);
        };
      }, trackId);

      // Transport ARRETE (jamais de PLAY) : la note doit sonner quand meme
      execFileSync(sendExe, ['--port', PORT_NAME, '--note', '60', '--vel', '110', '--hold-ms', '600']);

      const peak = await (async () => {
        let best = 0;
        await waitUntil(async () => {
          best = await page.evaluate(() => Math.max(0, ...((window as any).__peaks as number[])));
          return best > 0.01;
        }, 8000);
        return best;
      })();
      expect(peak, 'la piste cible n a pas sonne (crete nulle)').toBeGreaterThan(0.01);

      // CONTRAT : les stats disent que l'evenement a ete route (cadence 5 s)
      expect(
        await waitUntil(() => {
          const text = fs.readFileSync(logPath, 'utf8');
          const m = [...text.matchAll(/midi-in stats: events=(\d+) forwarded=(\d+)/g)].pop();
          return !!m && Number(m[2]) >= 2;  // note-on + note-off
        }, 12000),
        `stats midi-in sans evenement route (log: ${logPath})`,
      ).toBe(true);
    } finally {
      engine.kill();
      await new Promise((r) => setTimeout(r, 500));
    }
  });
});
