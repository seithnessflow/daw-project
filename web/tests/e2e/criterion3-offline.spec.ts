/**
 * Criterion 3 (offline part): CRDT reconciliation across a REAL server outage.
 *
 * This is what distinguishes a CRDT from a plain WebSocket broadcast:
 * 1. Two tabs converge on the same project.
 * 2. The sync server is actually stopped (scripts/start-stack.ps1
 *    -Stop -Component server).
 * 3. Each tab makes a DISTINCT offline edit (different tracks), and both
 *    tabs make a CONFLICTING offline edit (same track, different values) -
 *    proving merge, not just resumption.
 * 4. The server is restarted; the tabs auto-reconnect (no reload: a reload
 *    would throw the offline state away by construction).
 * 5. Both tabs must converge: both distinct edits preserved on both sides,
 *    and the same-track conflict resolved to the SAME value on both sides.
 *
 * The test fails if offline edits are lost or if one tab silently
 * overwrites the other.
 *
 * The whole test runs against a script-managed server (initial
 * stop+start): the file store is relative to the server's CWD, so the
 * mid-test stop/restart must reuse the same store (server/projects/).
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForServerConnection,
  waitForServerDisconnected,
  getTrackIds,
  getTrackGain,
  setTrackGain,
  waitForGain,
  waitForTrackCount,
  collectDiagnostics,
  printDiagnostics,
  setupConsoleCollection,
} from './helpers';

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
  // stdio must be fully ignored: the started server inherits the shell's
  // handles, and an inherited stdout pipe would keep spawnSync blocked
  // long after PowerShell itself exits
  execFileSync(SHELL, args, { stdio: 'ignore', timeout: 60000 });
}

test.describe('Criterion 3: offline reconciliation', () => {
  test('offline edits from both tabs merge after a server restart', async ({ browser }) => {
    test.setTimeout(120000);

    // KNOWN FAILURE (2026-08-21): the web client cannot reconcile offline
    // edits. ServerClient.sendChange() silently DROPS changes while
    // disconnected (no outbox), and after reconnect the server's full
    // document lands in the change handler (onDocument was consumed by the
    // first connect) where applyChange() cannot parse it - no merge path
    // exists. Verified by this test's diagnostics: divergent heads, no
    // cross-tab propagation. See STATUS.md, criterion 3.
    // test.fail() documents the defect without hiding it: the day
    // reconciliation works, this run fails loudly ("passed unexpectedly")
    // and forces the annotation - and the STATUS entry - to be removed.
    test.fail(true, 'Offline reconciliation not implemented in the web client (STATUS.md, critere 3)');

    // Run against a script-managed server so the mid-test restart reuses
    // the same file store (CWD server/)
    serverControl('stop');
    serverControl('start');

    const projectId = `e2e-offline-${Date.now()}`;
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const logs1: string[] = [];
    const logs2: string[] = [];
    setupConsoleCollection(page1, logs1);
    setupConsoleCollection(page2, logs2);

    try {
      await page1.goto(`/?project=${projectId}`);
      await page2.goto(`/?project=${projectId}`);
      await waitForServerConnection(page1);
      await waitForServerConnection(page2);
      await page1.waitForSelector('[data-track-id]', { timeout: 10000 });
      await page2.waitForSelector('[data-track-id]', { timeout: 10000 });

      // Third track: the conflict target (distinct edits use the first two)
      await page1.click('#add-track-btn');
      expect(await waitForTrackCount(page1, 3)).toBe(3);
      expect(await waitForTrackCount(page2, 3)).toBe(3);

      const ids = await getTrackIds(page1);
      const [trackA, trackB, trackC] = ids;

      // Initial convergence, verified
      await setTrackGain(page1, trackA, 0.6);
      expect(await waitForGain(page2, trackA, 0.6)).toBeCloseTo(0.6, 2);

      // ---- Real outage ----
      serverControl('stop');
      await waitForServerDisconnected(page1);
      await waitForServerDisconnected(page2);

      // Distinct offline edits (one per tab, different tracks)
      await setTrackGain(page1, trackA, 0.2);
      await setTrackGain(page2, trackB, 0.9);

      // Conflicting offline edits (same track, different values)
      await setTrackGain(page1, trackC, 0.35);
      await setTrackGain(page2, trackC, 0.65);

      // ---- Server back up; tabs reconnect on their own (3s retry) ----
      serverControl('start');
      await waitForServerConnection(page1, 30000);
      await waitForServerConnection(page2, 30000);

      // Wait for full convergence on a real condition (no blind sleep)
      const converged = async () => {
        const a2 = await getTrackGain(page2, trackA);
        const b1 = await getTrackGain(page1, trackB);
        const c1 = await getTrackGain(page1, trackC);
        const c2 = await getTrackGain(page2, trackC);
        return (
          Math.abs(a2 - 0.2) <= 0.005 &&
          Math.abs(b1 - 0.9) <= 0.005 &&
          Math.abs(c1 - c2) <= 0.005 &&
          (Math.abs(c1 - 0.35) <= 0.005 || Math.abs(c1 - 0.65) <= 0.005)
        );
      };
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !(await converged())) {
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!(await converged())) {
        const diag1 = await collectDiagnostics(page1, 'tab1');
        const diag2 = await collectDiagnostics(page2, 'tab2');
        diag1.consoleLogs = logs1;
        diag2.consoleLogs = logs2;
        printDiagnostics(diag1, diag2);
      }

      // Distinct edit from tab1: kept locally AND visible in tab2
      expect(await getTrackGain(page1, trackA), 'tab1 kept its own offline edit').toBeCloseTo(0.2, 2);
      expect(await getTrackGain(page2, trackA), 'tab1 offline edit reached tab2').toBeCloseTo(0.2, 2);

      // Distinct edit from tab2: kept locally AND visible in tab1
      expect(await getTrackGain(page2, trackB), 'tab2 kept its own offline edit').toBeCloseTo(0.9, 2);
      expect(await getTrackGain(page1, trackB), 'tab2 offline edit reached tab1').toBeCloseTo(0.9, 2);

      // Same-track conflict: both tabs resolve to the SAME value, and that
      // value is one of the two competing edits
      const c1 = await getTrackGain(page1, trackC);
      const c2 = await getTrackGain(page2, trackC);
      expect(c1, 'conflict resolved identically in both tabs').toBeCloseTo(c2, 2);
      const winner = Math.round(c1 * 100) / 100;
      expect([0.35, 0.65], 'conflict winner is one of the two edits').toContain(winner);
    } finally {
      await context1.close();
      await context2.close();
      // Leave a healthy server for the rest of the suite
      try { serverControl('stop'); } catch { /* best effort */ }
      try { serverControl('start'); } catch { /* best effort */ }
    }
  });
});
