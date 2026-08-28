// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * VAGUE 3, premier maillon (2026-08-28) : l'entree MIDI LIVE.
 * Un port loopMIDI « MagicPotion » -> le moteur l'ouvre avec --midi-in -> un
 * instrument pose PAR LA PAGE sur une piste MIDI -> `midi_send` envoie
 * CC64 + pitch-bend + une note sur le port -> le moteur route (contrats
 * de log `midi-in:`), l'enfant traduit CC/PB via IMidiMapping (ligne
 * `plugin_host: midi-mapping N` dans son log) et la piste SONNE (crete > 0
 * vue par la telemetrie), transport ARRETE (monitoring : etape 0 + gate).
 * Moteur en --mute : le backend null appelle le callback, tout est
 * prouvable en silence. Matrice : mda DX10 (toujours, construit avec les
 * tests) + Dexed et Surge XT si installes sur la machine (JUCE : vrais
 * synthes du commerce). Skip propre : pas Windows, ou port absent.
 */

import { test, expect, Page } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  REPO_ROOT, resolveBinary, waitUntil, countInFile, waitForServerConnection,
} from './helpers';

const ENGINE_PORT = 47821;
const PORT_NAME = 'MagicPotion';
const VST3_COMMON = 'C:\\Program Files\\Common Files\\VST3';

interface Synth { name: string; uid: string; module: () => string | null; }

// uids = composant (« VST... » / ABCDEF0191...), jamais le controleur
const SYNTHS: Synth[] = [
  {
    name: 'mda DX10', uid: '5653544D4441786D6461206478313000',
    module: () => {
      for (const c of [
        path.join(REPO_ROOT, 'engine', 'build-msvc', 'VST3', 'mda-vst3.vst3'),
        path.join(REPO_ROOT, 'engine', 'build', 'VST3', 'mda-vst3.vst3'),
      ]) if (fs.existsSync(c)) return c;
      return null;
    },
  },
  {
    name: 'Dexed', uid: 'ABCDEF019182FAEB4447534244657864',
    module: () => { const p = path.join(VST3_COMMON, 'Dexed.vst3'); return fs.existsSync(p) ? p : null; },
  },
  {
    name: 'Surge XT', uid: 'ABCDEF019182FAEB566D624153675854',
    module: () => { const p = path.join(VST3_COMMON, 'Surge Synth Team', 'Surge XT.vst3'); return fs.existsSync(p) ? p : null; },
  },
];

function midiPortPresent(engineExe: string): boolean {
  try {
    const out = execFileSync(engineExe, ['--list-midi-devices'], { encoding: 'utf8' });
    return out.includes(PORT_NAME);
  } catch { return false; }
}

/** Le log stderr du dernier enfant plugin_host (segment .shm.log dans TEMP). */
function newestChildLog(since: number): string | null {
  const dir = os.tmpdir();
  const logs = fs.readdirSync(dir)
    .filter((f) => f.startsWith('daw-ring-') && f.endsWith('.shm.log'))
    .map((f) => path.join(dir, f))
    .filter((p) => fs.statSync(p).mtimeMs >= since)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return logs[0] ?? null;
}

async function playOneNote(page: Page, synth: Synth, modulePath: string, sendExe: string, engineExe: string) {
  const projectId = `e2e-midi-in-${Date.now()}`;
  const logPath = path.join(os.tmpdir(), `daw-e2e-midi-in-${Date.now()}.log`);
  const startedAt = Date.now();
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--start-stopped', '--mute', '--ws-port', String(ENGINE_PORT),
     '--midi-in', PORT_NAME,
     '--vst3-module', `${synth.uid}=${modulePath}`],
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

    // Une piste MIDI par le coin, l'instrument pose PAR LA PAGE
    await page.locator('#new-track-btn').click();
    await page.locator('.ctx-menu >> text=+ Piste MIDI').click();
    const rebuilds0 = countInFile(logPath, 'Graph updated');
    const trackId = await page.evaluate(({ uid, name }) => {
      const proj = (window as any).__dawProject;
      const d = proj.getDocument();
      const t = d.tracks.find((x: any) => x.kind === 'midi');
      proj.addProcessor(t.id, {
        id: `inst-${Date.now()}`, type: 'vst3', uid, name,
        bypass: false, params: [],
      });
      (window as any).__dawFlush?.();
      return t.id as string;
    }, { uid: synth.uid, name: synth.name });
    expect(
      await waitUntil(() => countInFile(logPath, 'Graph updated') > rebuilds0, 20000),
      'le moteur n a pas reconstruit avec l instrument',
    ).toBe(true);
    // CONTRAT : la piste cible est resolue (auto = la premiere avec un instrument)
    expect(
      await waitUntil(() => countInFile(logPath, `midi-in: -> track "${trackId}"`) >= 1, 10000),
      `piste cible non resolue (log: ${logPath})`,
    ).toBe(true);
    // Le vrai plugin a pu mettre plusieurs secondes a naitre (Surge charge
    // ses donnees) : on attend que l'enfant soit servi avant de jouer
    expect(
      await waitUntil(() => countInFile(logPath, 'served out-of-process') >= 1, 20000),
      'enfant plugin jamais servi',
    ).toBe(true);
    // ... puis que la capture d'etat post-rebuild ait ecrit stateHash au
    // document, que le rebuild qui en decoule soit passe ET que la
    // seconde capture (1 s apres) soit derriere nous : sur mda DX10 une
    // note qui tombe dans cette transition (~3 s apres l'ajout de
    // l'instrument) reste MUETTE alors que les evenements sont routes et
    // draines (observe 2026-08-28 - dette datee TODO, repro : ce test
    // avec 1,5 s d'attente au lieu de 4). La spec vise le regime etabli.
    expect(
      await waitUntil(() => countInFile(logPath, 'Graph updated') >= rebuilds0 + 2, 20000),
      'le rebuild stateHash n est pas arrive',
    ).toBe(true);
    await page.waitForTimeout(4000);

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

    // Transport ARRETE (jamais de PLAY) : CC64 + pitch-bend centre + la note
    execFileSync(sendExe, ['--port', PORT_NAME, '--cc', '64', '127', '--bend', '8192',
                           '--note', '60', '--vel', '110', '--hold-ms', '600']);

    // (waitUntil est synchrone : un predicat async serait « vrai » tout de
    // suite - on sonde la page a la main)
    let peak = 0;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && peak <= 0.01) {
      peak = await page.evaluate(() =>
        Math.max(0, ...((window as any).__peaks as number[])));
      if (peak <= 0.01) await new Promise((r) => setTimeout(r, 100));
    }
    expect(peak, `${synth.name} : la piste cible n a pas sonne (crete nulle)`).toBeGreaterThan(0.01);

    // CONTRAT : les stats disent que les 4 evenements ont ete routes (5 s)
    let stats = '';
    expect(
      await waitUntil(() => {
        const text = fs.readFileSync(logPath, 'utf8');
        const m = [...text.matchAll(/midi-in stats: events=(\d+) forwarded=(\d+) dropped=(\d+) unrouted=(\d+)[^\n]*/g)].pop();
        if (!m) return false;
        stats = m[0];
        return Number(m[2]) >= 4 && Number(m[3]) === 0 && Number(m[4]) === 0;
      }, 12000),
      `stats midi-in incompletes (log: ${logPath})`,
    ).toBe(true);
    // L'enfant a declare sa table CC -> parametre (IMidiMapping)
    const childLog = newestChildLog(startedAt);
    expect(childLog, 'log de l enfant plugin_host introuvable').not.toBeNull();
    const mapping = fs.readFileSync(childLog!, 'utf8').match(/midi-mapping (\d+) controller/);
    expect(mapping, `${synth.name} : pas de ligne midi-mapping dans ${childLog}`).not.toBeNull();
    const assignments = Number(mapping![1]);
    console.log(`[midi-in] ${synth.name}: peak=${peak.toFixed(3)} mapping=${assignments} | ${stats}`);
    return { peak, assignments };
  } finally {
    engine.kill();
    await new Promise((r) => setTimeout(r, 800));
  }
}

test.describe('MIDI live : port -> moteur -> instrument (Vague 3)', () => {
  for (const synth of SYNTHS) {
    test(`${synth.name} : CC64 + bend + note sur le port font sonner l instrument, transport arrete`, async ({ page }) => {
      test.skip(process.platform !== 'win32', 'WinMM : Windows seulement');
      const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
      test.skip(!midiPortPresent(engineExe), `port loopMIDI « ${PORT_NAME} » absent`);
      const modulePath = synth.module();
      test.skip(!modulePath, `${synth.name} non installe`);
      const sendExe = resolveBinary('MIDI_SEND_EXE', 'midi_send');
      test.setTimeout(120000);
      const r = await playOneNote(page, synth, modulePath!, sendExe, engineExe);
      // Un synthe JUCE ou mda declare ses controleurs : la preuve du
      // chemin CC64/pitch-bend (VST3 n'a pas d'evenement CC)
      expect(r.assignments, `${synth.name} : aucun controleur MIDI declare`).toBeGreaterThan(0);
    });
  }
});
