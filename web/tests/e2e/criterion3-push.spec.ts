// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Criterion 3 TRUE (A3-4): the push half of anti-entropy.
 *
 * The hole this guards: a socket dying DURING an outbox flush silently
 * discards sends (the browser drops data on a closing socket), leaving
 * a change in the LOCAL document that the server never received - and
 * pull-only resync could never bring it back.
 *
 * Deterministic reproduction of the lost-flush state: make a UI-less
 * document change and CONSUME getLastChange() without sending it -
 * byte-for-byte the state a swallowed flush leaves behind. Then restart
 * the server; on reconnection the client must DIFF and PUSH the change
 * the server lacks. The server document is read back through its own
 * contract (first WS message = full doc).
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { waitForServerConnection, waitForServerDisconnected } from './helpers';

const require = createRequire(import.meta.url);
const Automerge = require('@automerge/automerge');
const WsWebSocket = require('ws').WebSocket;

const specDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(specDir, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'start-stack.ps1');
const SHELL = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

function serverControl(action: 'stop' | 'start'): void {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    ...(action === 'stop' ? ['-Stop'] : []),
    '-Component', 'server',
  ];
  execFileSync(SHELL, args, { stdio: 'ignore', timeout: 60000 });
}

async function fetchServerDoc(projectId: string): Promise<any> {
  const bytes: Uint8Array = await new Promise((resolve, reject) => {
    const sock = new WsWebSocket(`ws://localhost:3000/ws/${projectId}`);
    sock.binaryType = 'arraybuffer';
    sock.onmessage = (ev: any) => {
      sock.close();
      resolve(new Uint8Array(ev.data));
    };
    sock.onerror = () => reject(new Error('server unreachable'));
  });
  return Automerge.load(bytes);
}

test.describe('Criterion 3 push anti-entropy', () => {
  test('a swallowed flush reaches the server through the reconnection push', async ({ page }) => {
    test.setTimeout(120000);

    serverControl('stop');
    serverControl('start');

    const projectId = `e2e-push-${Date.now()}`;
    await page.goto(`/?project=${projectId}`);
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });

    // The lost-flush state, reproduced exactly: change the doc, consume
    // the change WITHOUT sending (what a dying socket does to a flush)
    const trackId = await page.evaluate(() => {
      const p = (window as any).__dawProject;
      const id = p.getDocument().tracks[0].id;
      p.setTrackGain(id, 0.123);
      p.getLastChange();          // swallowed - never reaches the wire
      return id;
    });

    // Server never saw it (poll a few reads to be fair)
    await page.waitForTimeout(700);
    const before = await fetchServerDoc(projectId);
    expect(before.tracks.find((t: any) => t.id === trackId).gain,
      'precondition: the server must NOT have the swallowed change')
      .not.toBeCloseTo(0.123, 3);

    // Reconnection: the push half must send what the server lacks
    serverControl('stop');
    await waitForServerDisconnected(page);
    serverControl('start');
    await waitForServerConnection(page, 30000);

    await expect.poll(async () => {
      const d = await fetchServerDoc(projectId);
      return d.tracks.find((t: any) => t.id === trackId)?.gain;
    }, {
      timeout: 20000,
      message: 'the reconnection push never delivered the swallowed change',
    }).toBeCloseTo(0.123, 3);
  });
});
