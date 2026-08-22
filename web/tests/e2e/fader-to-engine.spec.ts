// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Milestone Test: Fader to Engine
 *
 * Verifies the real outcome of the milestone "a fader move in the browser
 * changes the sound":
 *
 * 1. Live chain: this spec SPAWNS the engine (fresh log per run, unique
 *    project id), drives gain changes from the browser through the Automerge
 *    sync server, and requires one "Graph updated" per change in the
 *    engine's own log. It fails if the engine process dies (the historical
 *    failure mode: use-after-free crash after the first patch).
 *
 * 2. Audible result: renders the same document twice (gain 1.0 vs 0.25)
 *    through the engine CLI and compares WAV samples: the quieter render
 *    must be exactly 0.25x the reference, sample by sample. Fails if the
 *    engine dies (non-zero exit) or if the audio does not change.
 *
 * Prerequisites:
 * - Sync server running on localhost:3000
 * - Web dev server on the Playwright baseURL
 * - An engine build (or ENGINE_EXE / CREATE_TEST_DOC env overrides)
 */

import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import {
  waitForServerConnection,
  getTrackIds,
  setTrackGain,
} from './helpers';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(specDir, '..', '..', '..');
const require = createRequire(import.meta.url);

function resolveBinary(envVar: string, name: string): string {
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`${envVar}=${fromEnv} does not exist`);
    }
    return fromEnv;
  }
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    path.join(REPO_ROOT, 'engine', 'build-msvc', exe),
    path.join(REPO_ROOT, 'engine', 'build', exe),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `${name} binary not found (looked at: ${candidates.join(', ')}). ` +
    `Build the engine or set ${envVar}.`
  );
}

/**
 * The built AGain bundle (2.4c-1), or null when the SDK is not vendored.
 * When present, the burst test runs WITH the out-of-process proxy in the
 * chain - the same scenario, strengthened, never weakened.
 */
function resolveAgainBundle(): string | null {
  const candidates = [
    path.join(REPO_ROOT, 'engine', 'build-msvc', 'VST3', 'Release', 'again.vst3'),
    path.join(REPO_ROOT, 'engine', 'build', 'VST3', 'Release', 'again.vst3'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Poll a predicate until it holds or the timeout expires. */
async function waitUntil(
  pred: () => boolean,
  timeoutMs: number,
  stepMs = 100
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

/** Count occurrences of a literal string in a file (0 if unreadable). */
function countInFile(file: string, needle: string): number {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    let count = 0;
    let pos = 0;
    while ((pos = content.indexOf(needle, pos)) !== -1) {
      count++;
      pos += needle.length;
    }
    return count;
  } catch {
    return 0;
  }
}

/** Read 16-bit PCM samples from a WAV file (proper RIFF chunk walk). */
function readWav16(file: string): Float32Array {
  const buf = fs.readFileSync(file);
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`${file} is not a RIFF/WAV file`);
  }
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const count = Math.floor(size / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      }
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk found`);
}

test.describe('Milestone: Fader to Engine', () => {
  test('fader moves rebuild the live engine graph and the engine survives', async ({ page }) => {
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const projectId = `e2e-fader-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-engine-${Date.now()}.log`);

    const logFd = fs.openSync(logPath, 'w');
    const engine: ChildProcess = spawn(
      engineExe,
      [
        '--server', 'ws://localhost:3000',
        '--project', projectId,
        '--play', '--mute',
        '--ws-port', '47901',
      ],
      { stdio: ['ignore', logFd, logFd] }
    );
    fs.closeSync(logFd);

    try {
      // The engine must connect to the server and load the initial document
      expect(
        await waitUntil(() => countInFile(logPath, 'Document loaded') >= 1, 15000),
        `engine did not load the initial document (log: ${logPath})`
      ).toBe(true);

      await page.goto(`/?project=${projectId}`);
      await waitForServerConnection(page);
      await page.waitForSelector('[data-track-id]', { timeout: 10000 });

      const trackIds = await getTrackIds(page);
      expect(trackIds.length).toBeGreaterThan(0);

      // Three consecutive fader moves; each one must produce a graph
      // rebuild in the engine's own, fresh log (delta counting: the log
      // file belongs to this run only)
      const values = [0.25, 0.75, 0.5];
      for (let i = 0; i < values.length; i++) {
        await setTrackGain(page, trackIds[0], values[i]);
        expect(
          await waitUntil(() => countInFile(logPath, 'Graph updated') >= i + 1, 5000),
          `engine did not apply change ${i + 1}/${values.length} (log: ${logPath})`
        ).toBe(true);
      }

      expect(countInFile(logPath, 'Graph updated')).toBeGreaterThanOrEqual(values.length);

      // The historical bug: the engine crashed (0xC0000005) right after the
      // first change. A dead engine must fail this test.
      expect(engine.exitCode, 'engine process died during the test').toBeNull();
    } finally {
      engine.kill();
    }
  });

  test('burst of fader changes coalesces rebuilds and converges to the final state', async ({ page }) => {
    test.setTimeout(90000);
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const projectId = `e2e-burst-${Date.now()}`;
    const logPath = path.join(os.tmpdir(), `daw-e2e-burst-${Date.now()}.log`);

    const logFd = fs.openSync(logPath, 'w');
    // --debug-rebuild-delay-ms simulates the expensive builds the VST3 host
    // will have (DLL instantiation): without a cost, a 3-track build takes
    // microseconds and coalescing would be unobservable.
    // With AGain built (2.4c-1), the SAME burst runs through the
    // out-of-process proxy: every rebuild re-attaches to the registry's
    // child instead of re-spawning it (ADR-017).
    const again = resolveAgainBundle();
    const engine: ChildProcess = spawn(
      engineExe,
      [
        '--server', 'ws://localhost:3000',
        '--project', projectId,
        '--play', '--mute',
        '--ws-port', '47902',
        '--debug-rebuild-delay-ms', '100',
        ...(again ? ['--debug-proxy-again', again] : []),
      ],
      { stdio: ['ignore', logFd, logFd] }
    );
    fs.closeSync(logFd);

    try {
      expect(
        await waitUntil(() => countInFile(logPath, 'Document loaded') >= 1, 15000),
        `engine did not load the initial document (log: ${logPath})`
      ).toBe(true);

      await page.goto(`/?project=${projectId}`);
      await waitForServerConnection(page);
      await page.waitForSelector('[data-track-id]', { timeout: 10000 });
      const trackIds = await getTrackIds(page);

      const before = countInFile(logPath, 'Graph updated');

      // The burst: 51 changes, no pacing - a simulated fader drag
      const CHANGES = 51;
      for (let i = 0; i < CHANGES; i++) {
        await setTrackGain(page, trackIds[0], (10 + i) / 100);
      }

      // Final state must be built: initial load is v=1, so the newest
      // version after the burst is v = 1 + CHANGES. This is the "final
      // graph state == final document state" property.
      const finalMarker = `Graph updated (document change, v=${1 + CHANGES})`;
      expect(
        await waitUntil(() => countInFile(logPath, finalMarker) >= 1, 20000),
        `graph never reached the final document version (log: ${logPath})`
      ).toBe(true);

      // Coalescing: FAR fewer rebuilds than changes (in-flight + final +
      // margin, not a queue of 51)
      const rebuilds = countInFile(logPath, 'Graph updated') - before;
      expect(rebuilds, 'no rebuild happened').toBeGreaterThanOrEqual(1);
      expect(rebuilds, `rebuilds not coalesced: ${rebuilds} for ${CHANGES} changes`).toBeLessThan(15);

      // Audio never interrupted during the burst
      const log = fs.readFileSync(logPath, 'utf-8');
      expect(/Underruns: [1-9]/.test(log), 'underruns during the burst').toBe(false);

      // And the engine is alive
      expect(engine.exitCode, 'engine process died during the burst').toBeNull();

      if (again) {
        // The child was spawned exactly ONCE (startup), never by a rebuild
        // (canary: fails the day someone moves the spawn into buildGraph),
        // and its ceremony succeeded
        expect(
          countInFile(logPath, 'Debug proxy: AGain served'),
          'proxy child not spawned exactly once'
        ).toBe(1);
        expect(/Failed to start debug proxy/.test(log), 'proxy child failed to start').toBe(false);
      }
    } finally {
      engine.kill();
    }
  });

  test('gain change is audible: rendered WAV samples scale with gain', () => {
    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-render-'));

    // Base document + 2s tone asset from the engine's own fixture generator
    execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], { stdio: 'pipe' });

    // Two variants via Automerge (the same library the web client uses):
    // 1 second long, gain 1.0 vs 0.25
    const Automerge = require('@automerge/automerge');
    const base = Automerge.load(new Uint8Array(fs.readFileSync(path.join(dir, 'base.am'))));

    // The engine resolves assets as <assetHash>.wav, but create_test_doc
    // writes test_tone.wav: expose the asset under the name the engine loads
    const assetHash: string = base.tracks[0].clips[0].assetHash;
    fs.copyFileSync(path.join(dir, 'test_tone.wav'), path.join(dir, `${assetHash}.wav`));
    const variant = (gain: number) =>
      Automerge.change(Automerge.clone(base), (d: any) => {
        for (const t of d.tracks) {
          t.gain = gain;
          for (const c of t.clips) {
            c.lengthSamples = 48000;
          }
        }
      });
    fs.writeFileSync(path.join(dir, 'ref.am'), Buffer.from(Automerge.save(variant(1.0))));
    fs.writeFileSync(path.join(dir, 'quarter.am'), Buffer.from(Automerge.save(variant(0.25))));

    // Render both. execFileSync throws if the engine exits non-zero or
    // crashes: a dead engine fails the test.
    const render = (doc: string, wav: string) =>
      execFileSync(
        engineExe,
        ['--doc', path.join(dir, doc), '--render', path.join(dir, wav),
         '--assets', dir, '--bit-depth', '16'],
        { stdio: 'pipe' }
      );
    render('ref.am', 'ref.wav');
    render('quarter.am', 'quarter.wav');

    const ref = readWav16(path.join(dir, 'ref.wav'));
    const quarter = readWav16(path.join(dir, 'quarter.wav'));

    expect(ref.length).toBeGreaterThan(0);
    expect(quarter.length).toBe(ref.length);

    // The reference must not be silence, and every sample of the quieter
    // render must be 0.25x the reference (16-bit quantization tolerance)
    let peak = 0;
    let maxError = 0;
    for (let i = 0; i < ref.length; i++) {
      const abs = Math.abs(ref[i]);
      if (abs > peak) peak = abs;
      const err = Math.abs(quarter[i] - 0.25 * ref[i]);
      if (err > maxError) maxError = err;
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(maxError).toBeLessThan(4 / 32768);
  });

  // 2.4d - THE MILESTONE, E2E: a bypass toggle CLICKED IN THE BROWSER
  // changes the sound, proven by samples, through a plugin running in its
  // own process. Bit-exactness of the pipeline itself is engine test 20;
  // here the point is the full round trip: browser -> server doc ->
  // engine render through the out-of-process child.
  test('bypass toggle in the browser changes the sound through an out-of-process plugin', async ({ page }) => {
    test.setTimeout(120000);
    const again = resolveAgainBundle();
    test.skip(!again, 'VST3 SDK not vendored (third_party/vst3sdk) - no plugin to bypass');

    const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
    const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
    const projectId = `e2e-bypass-${Date.now()}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-bypass-'));
    const AGAIN_UID = '84E8DE5F92554F5396FAE4133C935A18';

    // Tone asset via the engine's own generator (for hash + wav)
    execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], { stdio: 'pipe' });
    const Automerge = require('@automerge/automerge');
    const base = Automerge.load(new Uint8Array(fs.readFileSync(path.join(dir, 'base.am'))));
    const assetHash: string = base.tracks[0].clips[0].assetHash;
    fs.copyFileSync(path.join(dir, 'test_tone.wav'), path.join(dir, `${assetHash}.wav`));

    // Talk to the server through ITS OWN contract, like any web client:
    // first server message = full doc, client messages = changes
    const WebSocketImpl: any = (globalThis as any).WebSocket ?? require('ws');
    const wsUrl = `ws://localhost:3000/ws/${projectId}`;
    const openSocket = (): Promise<any> =>
      new Promise((resolve, reject) => {
        const sock = new WebSocketImpl(wsUrl);
        sock.binaryType = 'arraybuffer';
        sock.onopen = () => resolve(sock);
        sock.onerror = () => reject(new Error(`cannot connect ${wsUrl}`));
      });
    const nextMessage = (sock: any): Promise<Uint8Array> =>
      new Promise((resolve) => {
        sock.onmessage = (ev: any) => resolve(new Uint8Array(ev.data));
      });
    const fetchServerDoc = async (): Promise<Uint8Array> => {
      const sock = await openSocket();
      const bytes = await nextMessage(sock);
      sock.close();
      return bytes;
    };

    // --- Seed: clip + AGain chain node (0.5, bypass OFF) as ONE change
    const seedSock = await openSocket();
    const serverDoc = Automerge.load(await nextMessage(seedSock));
    const seeded = Automerge.change(serverDoc, (d: any) => {
      const t = d.tracks[0];
      t.clips.push({
        id: 'e2e-clip', assetHash,
        startSample: 0, lengthSamples: 48000, offsetSamples: 0,
      });
      t.chain.push({
        id: 'e2e-again', type: 'vst3', uid: AGAIN_UID, bypass: false,
        params: [{ key: '0', value: 0.5 }],
      });
    });
    seedSock.send(Automerge.getLastLocalChange(seeded));
    seedSock.close();
    fs.writeFileSync(path.join(dir, 'wet.am'), Buffer.from(Automerge.save(seeded)));

    // Deterministic sync point: the server holds the seeded chain
    let seedVisible = false;
    for (let attempt = 0; attempt < 40 && !seedVisible; attempt++) {
      const d = Automerge.load(await fetchServerDoc());
      seedVisible = d.tracks[0]?.chain?.length === 1;
      if (!seedVisible) await new Promise((r) => setTimeout(r, 250));
    }
    expect(seedVisible, 'server never persisted the seeded chain').toBe(true);

    // --- The browser: see the chain, CLICK bypass, watch the state come
    // back through the document (aria-pressed only settles via the doc)
    await page.goto(`/?project=${projectId}`);
    await waitForServerConnection(page);
    const bypassBtn = page.locator('.chain-bypass');
    await bypassBtn.waitFor({ timeout: 10000 });
    await expect(bypassBtn).toHaveAttribute('aria-pressed', 'false');
    await bypassBtn.click();
    await expect(bypassBtn).toHaveAttribute('aria-pressed', 'true');

    // --- Post-toggle doc, fetched through the same contract
    let dryBytes: Uint8Array | null = null;
    for (let attempt = 0; attempt < 40 && !dryBytes; attempt++) {
      const bytes = await fetchServerDoc();
      const d = Automerge.load(bytes);
      if (d.tracks[0]?.chain[0]?.bypass === true) dryBytes = bytes;
      else await new Promise((r) => setTimeout(r, 250));
    }
    expect(dryBytes, 'server never converged to bypass=true').not.toBeNull();
    fs.writeFileSync(path.join(dir, 'dry.am'), Buffer.from(dryBytes as Uint8Array));

    // --- Render both states through the real out-of-process AGain
    const render = (doc: string, wav: string) =>
      execFileSync(
        engineExe,
        ['--doc', path.join(dir, doc), '--render', path.join(dir, wav),
         '--assets', dir, '--bit-depth', '16',
         '--vst3-module', `${AGAIN_UID}=${again}`],
        { stdio: 'pipe' }
      );
    render('wet.am', 'wet.wav');
    render('dry.am', 'dry.wav');

    const wet = readWav16(path.join(dir, 'wet.wav'));
    const dry = readWav16(path.join(dir, 'dry.wav'));
    expect(dry.length).toBe(wet.length);
    let peak = 0;
    let maxErr = 0;
    for (let i = 0; i < dry.length; i++) {
      const abs = Math.abs(dry[i]);
      if (abs > peak) peak = abs;
      const err = Math.abs(wet[i] - 0.5 * dry[i]);
      if (err > maxErr) maxErr = err;
    }
    expect(peak, 'bypassed render is silent - the tone is missing').toBeGreaterThan(0.05);
    expect(maxErr, 'wet render is not half the bypassed render').toBeLessThan(4 / 32768);
  });
});

test.describe('Engine connection status', () => {
  test('page shows engine connection status', async ({ page }) => {
    await page.goto('/');

    const serverStatus = await page.locator('#server-status').isVisible().catch(() => false);
    const engineStatus = await page.locator('#engine-status').isVisible().catch(() => false);

    expect(serverStatus).toBe(true);

    console.log(`Server status visible: ${serverStatus}`);
    console.log(`Engine status visible: ${engineStatus}`);
  });
});
