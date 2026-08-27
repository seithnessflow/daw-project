// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Criterion 3: CRDT Convergence Test
 *
 * Tests that two browser tabs converge to the same state after modifications.
 * Includes both online sync and offline reconciliation scenarios.
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import {
  collectDiagnostics,
  printDiagnostics,
  waitForServerConnection,
  getTrackGain,
  setTrackGain,
  getTrackIds,
  waitForGain,
  waitForTrackCount,
  setupConsoleCollection,
  CRDTDiagnostics,
} from './helpers';

// Extend test to expose project globally for diagnostics
test.beforeEach(async ({ page }) => {
  // Inject hook to expose project instance
  await page.addInitScript(() => {
    const originalInit = (window as any).init;
    if (originalInit) {
      (window as any).init = async function() {
        const result = await originalInit();
        return result;
      };
    }
  });
});

// Le menu (2026-08-26) a change la semantique de `/` (racine = selecteur de
// projets, plus l'app sur 'default'). Ces specs nomment desormais un projet
// FRAIS (le 'default' local etait pollue par les runs -> count faux).
const projectId = `crit3-${Date.now()}`;

test.describe('Criterion 3: Two-tab convergence', () => {
  test('online sync - gain change in tab1 appears in tab2', async ({ browser }) => {
    // Create two independent browser contexts (like two users)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const logs1: string[] = [];
    const logs2: string[] = [];
    setupConsoleCollection(page1, logs1);
    setupConsoleCollection(page2, logs2);

    try {
      // Navigate both tabs
      await page1.goto(`/?project=${projectId}`);
      await page2.goto(`/?project=${projectId}`);

      // Wait for server connection
      await waitForServerConnection(page1);
      await waitForServerConnection(page2);

      // Wait for tracks to render
      await page1.waitForSelector('[data-track-id]', { timeout: 10000 });
      await page2.waitForSelector('[data-track-id]', { timeout: 10000 });

      // Get track IDs
      const trackIds = await getTrackIds(page1);
      expect(trackIds.length).toBeGreaterThan(0);

      const testTrackId = trackIds[0];

      // Get initial gain in both tabs
      const initialGain1 = await getTrackGain(page1, testTrackId);
      const initialGain2 = await getTrackGain(page2, testTrackId);
      expect(initialGain1).toBe(initialGain2);

      // Change gain in tab 1
      const newGain = 0.42;
      await setTrackGain(page1, testTrackId, newGain);

      // Wait for sync on a real condition (no blind sleep)
      const finalGain2 = await waitForGain(page2, testTrackId, newGain);

      if (Math.abs(finalGain2 - newGain) > 0.01) {
        // Collect diagnostics on failure
        const diag1 = await collectDiagnostics(page1, 'tab1');
        const diag2 = await collectDiagnostics(page2, 'tab2');
        diag1.consoleLogs = logs1;
        diag2.consoleLogs = logs2;
        printDiagnostics(diag1, diag2);
      }

      expect(finalGain2).toBeCloseTo(newGain, 2);

    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('bidirectional sync - changes from both tabs converge', async ({ browser }) => {
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

      const trackIds = await getTrackIds(page1);
      expect(trackIds.length).toBeGreaterThanOrEqual(2);

      // Tab 1 modifies track 1
      await setTrackGain(page1, trackIds[0], 0.3);

      // Tab 2 modifies track 2
      await setTrackGain(page2, trackIds[1], 0.7);

      // Wait for bidirectional sync on real conditions (no blind sleep)
      await waitForGain(page1, trackIds[1], 0.7);
      await waitForGain(page2, trackIds[0], 0.3);

      // Both tabs should have both changes
      const gain1_tab1 = await getTrackGain(page1, trackIds[0]);
      const gain2_tab1 = await getTrackGain(page1, trackIds[1]);
      const gain1_tab2 = await getTrackGain(page2, trackIds[0]);
      const gain2_tab2 = await getTrackGain(page2, trackIds[1]);

      const converged = (
        Math.abs(gain1_tab1 - gain1_tab2) < 0.01 &&
        Math.abs(gain2_tab1 - gain2_tab2) < 0.01
      );

      if (!converged) {
        const diag1 = await collectDiagnostics(page1, 'tab1');
        const diag2 = await collectDiagnostics(page2, 'tab2');
        diag1.consoleLogs = logs1;
        diag2.consoleLogs = logs2;
        printDiagnostics(diag1, diag2);
      }

      expect(gain1_tab1).toBeCloseTo(gain1_tab2, 2);
      expect(gain2_tab1).toBeCloseTo(gain2_tab2, 2);

    } finally {
      await context1.close();
      await context2.close();
    }
  });

  // Offline reconciliation lives in criterion3-offline.spec.ts: it stops
  // and restarts the real server (start-stack.ps1 -Component server)
  // instead of simulating the outage, and keeps the tabs alive across the
  // outage (no reload).
});

test.describe('Add track sync', () => {
  test('new track added in tab1 appears in tab2', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await page1.goto(`/?project=${projectId}`);
      await page2.goto(`/?project=${projectId}`);

      await waitForServerConnection(page1);
      await waitForServerConnection(page2);

      await page1.waitForSelector('[data-track-id]', { timeout: 10000 });
      await page2.waitForSelector('[data-track-id]', { timeout: 10000 });

      const initialCount1 = (await getTrackIds(page1)).length;
      const initialCount2 = (await getTrackIds(page2)).length;
      expect(initialCount1).toBe(initialCount2);

      // Add track in tab 1
      // MODIF SIGNALEE (pistes typees 2026-08-27) : + add track ouvre
      // desormais le menu Audio/MIDI - on choisit Piste audio.
      await page1.click('#add-track-btn');
      await page1.locator('.ctx-menu >> text=+ Piste audio').click();

      // Wait for sync on a real condition (no blind sleep)
      const finalCount2 = await waitForTrackCount(page2, initialCount1 + 1);
      const finalCount1 = (await getTrackIds(page1)).length;

      expect(finalCount1).toBe(initialCount1 + 1);
      expect(finalCount2).toBe(finalCount1);

    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
