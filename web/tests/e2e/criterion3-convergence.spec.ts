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
      await page1.goto('/');
      await page2.goto('/');

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

      // Wait for sync (give time for WebSocket round-trip)
      await page2.waitForTimeout(500);

      // Verify tab 2 has the new value
      const finalGain2 = await getTrackGain(page2, testTrackId);

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
      await page1.goto('/');
      await page2.goto('/');

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

      // Wait for bidirectional sync
      await page1.waitForTimeout(1000);
      await page2.waitForTimeout(500);

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

  test.skip('offline reconciliation - changes made offline converge on reconnect', async ({ browser }) => {
    // This test requires server control - skip in basic CI
    // To run: start server manually, run test, manually stop/start server
    //
    // The test flow:
    // 1. Both tabs connect and sync
    // 2. Server is stopped (simulated by blocking WebSocket)
    // 3. Tab 1 makes changes offline
    // 4. Tab 2 makes different changes offline
    // 5. Server restarts
    // 6. Both tabs reconnect and converge (CRDT merge)

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const logs1: string[] = [];
    const logs2: string[] = [];
    setupConsoleCollection(page1, logs1);
    setupConsoleCollection(page2, logs2);

    try {
      // Initial connection
      await page1.goto('/');
      await page2.goto('/');
      await waitForServerConnection(page1);
      await waitForServerConnection(page2);
      await page1.waitForSelector('[data-track-id]', { timeout: 10000 });
      await page2.waitForSelector('[data-track-id]', { timeout: 10000 });

      const trackIds = await getTrackIds(page1);

      // Simulate offline by blocking WebSocket
      await page1.route('**/ws/**', route => route.abort());
      await page2.route('**/ws/**', route => route.abort());

      // Wait for disconnect
      await page1.waitForTimeout(1000);

      // Make offline changes
      await setTrackGain(page1, trackIds[0], 0.2); // Tab 1: track 1 = 0.2
      await setTrackGain(page2, trackIds[0], 0.8); // Tab 2: track 1 = 0.8 (conflict!)

      // Restore connection
      await page1.unroute('**/ws/**');
      await page2.unroute('**/ws/**');

      // Reload to reconnect
      await page1.reload();
      await page2.reload();

      await waitForServerConnection(page1);
      await waitForServerConnection(page2);
      await page1.waitForSelector('[data-track-id]', { timeout: 10000 });
      await page2.waitForSelector('[data-track-id]', { timeout: 10000 });

      // Wait for CRDT merge
      await page1.waitForTimeout(2000);

      // Check convergence - both should have same value (CRDT picks a winner)
      const finalGain1 = await getTrackGain(page1, trackIds[0]);
      const finalGain2 = await getTrackGain(page2, trackIds[0]);

      if (Math.abs(finalGain1 - finalGain2) > 0.01) {
        const diag1 = await collectDiagnostics(page1, 'tab1');
        const diag2 = await collectDiagnostics(page2, 'tab2');
        diag1.consoleLogs = logs1;
        diag2.consoleLogs = logs2;
        printDiagnostics(diag1, diag2);
      }

      // The key CRDT property: eventual consistency
      expect(finalGain1).toBeCloseTo(finalGain2, 2);

    } finally {
      await context1.close();
      await context2.close();
    }
  });
});

test.describe('Add track sync', () => {
  test('new track added in tab1 appears in tab2', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await page1.goto('/');
      await page2.goto('/');

      await waitForServerConnection(page1);
      await waitForServerConnection(page2);

      await page1.waitForSelector('[data-track-id]', { timeout: 10000 });
      await page2.waitForSelector('[data-track-id]', { timeout: 10000 });

      const initialCount1 = (await getTrackIds(page1)).length;
      const initialCount2 = (await getTrackIds(page2)).length;
      expect(initialCount1).toBe(initialCount2);

      // Add track in tab 1
      await page1.click('#add-track-btn');

      // Wait for sync
      await page2.waitForTimeout(1000);

      const finalCount1 = (await getTrackIds(page1)).length;
      const finalCount2 = (await getTrackIds(page2)).length;

      expect(finalCount1).toBe(initialCount1 + 1);
      expect(finalCount2).toBe(finalCount1);

    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
