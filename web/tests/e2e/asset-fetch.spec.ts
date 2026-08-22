// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 2.3b - the HTTP side of the engine<->server triangle, end to end:
 * an asset that exists ONLY in the server's content-addressed store is
 * pulled by the engine on a local miss during buildGraph, written under
 * its hash name, and the graph builds. The upload goes through the
 * verifying PUT (the server refuses content that does not match its
 * claimed hash - that verification caught a real FNV twin in
 * create_test_doc the very first time it ran).
 */

import { test, expect } from '@playwright/test';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { REPO_ROOT, resolveBinary, waitUntil, countInFile } from './helpers';

test('engine pulls a missing asset from the server store', async () => {
  test.setTimeout(60000);
  const engineExe = resolveBinary('ENGINE_EXE', 'daw_engine');
  const createTestDoc = resolveBinary('CREATE_TEST_DOC', 'create_test_doc');
  const projectId = `e2e-asset-fetch-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daw-e2e-asset-'));
  const emptyAssets = path.join(dir, 'empty-assets');
  fs.mkdirSync(emptyAssets);

  // Tone + doc from the engine's own generator; the printed hash is the
  // pipeline's sha256 (64 chars since 2.3a)
  const out = execFileSync(createTestDoc, [path.join(dir, 'base.am'), dir, '2'], {
    encoding: 'utf-8',
  });
  const hash = /Asset hash: ([0-9a-f]+)/.exec(out)?.[1];
  expect(hash, `no hash in create_test_doc output:\n${out}`).toBeTruthy();
  expect(hash!.length, 'assetHash must be sha256 (64 hex chars)').toBe(64);

  // The asset goes to the SERVER ONLY - the engine's dir stays empty
  const put = await fetch(`http://localhost:3000/assets/${hash}`, {
    method: 'PUT',
    body: fs.readFileSync(path.join(dir, 'test_tone.wav')),
  });
  expect(put.status, 'verifying PUT refused a truthful upload').toBe(201);

  // Seed the project with a clip referencing that hash (server contract)
  execFileSync(
    'node',
    ['scripts/seed-again.mjs', '--base', path.join(dir, 'base.am'),
     '--assets', dir, '--project', projectId],
    { cwd: path.join(REPO_ROOT, 'web'), stdio: 'pipe' }
  );

  // Engine with an EMPTY assets dir: the only way to sound is the store
  const logPath = path.join(dir, 'engine.log');
  const logFd = fs.openSync(logPath, 'w');
  const engine: ChildProcess = spawn(
    engineExe,
    ['--server', 'ws://localhost:3000', '--project', projectId,
     '--play', '--mute', '--assets', emptyAssets, '--ws-port', '47904'],
    { stdio: ['ignore', logFd, logFd] }
  );
  fs.closeSync(logFd);

  try {
    expect(
      await waitUntil(
        () => countInFile(logPath, `Asset fetched from server: ${hash}`) >= 1,
        20000
      ),
      `engine never fetched the asset (log: ${logPath})`
    ).toBe(true);
    expect(
      fs.existsSync(path.join(emptyAssets, `${hash}.wav`)),
      'fetched asset not written under its hash name'
    ).toBe(true);
    expect(
      await waitUntil(() => countInFile(logPath, 'Graph updated') >= 1, 10000),
      'graph never built after the fetch'
    ).toBe(true);
    expect(engine.exitCode, 'engine died').toBeNull();
  } finally {
    engine.kill();
  }
});
