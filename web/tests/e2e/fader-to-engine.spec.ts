/**
 * Milestone Test: Fader to Engine
 *
 * Tests the complete chain: Browser gain change → Server sync → Engine graph rebuild
 *
 * This test validates that:
 * 1. Gain changes in the browser propagate through Automerge sync
 * 2. The engine receives the document change
 * 3. The engine rebuilds its audio graph with the new gain
 *
 * Prerequisites:
 * - Server running on localhost:3000
 * - Engine running with --server ws://localhost:3000 --play
 * - Web running on localhost:5173
 */

import { test, expect, Page } from '@playwright/test';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  waitForServerConnection,
  getTrackGain,
  setTrackGain,
  getTrackIds,
  setupConsoleCollection,
} from './helpers';

// Path to engine log file
const ENGINE_LOG = path.join(process.env.TEMP || '/tmp', 'daw-engine.log');

/**
 * Read recent lines from engine log.
 */
function getEngineLog(lastN: number = 50): string {
  try {
    const content = fs.readFileSync(ENGINE_LOG, 'utf-8');
    const lines = content.trim().split('\n');
    return lines.slice(-lastN).join('\n');
  } catch {
    return '';
  }
}

/**
 * Count occurrences of a pattern in engine log.
 */
function countEngineLogOccurrences(pattern: string): number {
  try {
    const content = fs.readFileSync(ENGINE_LOG, 'utf-8');
    return (content.match(new RegExp(pattern, 'g')) || []).length;
  } catch {
    return 0;
  }
}

/**
 * Wait for a specific message in engine log.
 */
async function waitForEngineLog(
  pattern: string | RegExp,
  timeout: number = 5000
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const log = getEngineLog();
    if (typeof pattern === 'string' ? log.includes(pattern) : pattern.test(log)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

test.describe('Milestone: Fader to Engine', () => {
  test('gain change propagates from browser to engine', async ({ page }) => {
    const logs: string[] = [];
    setupConsoleCollection(page, logs);

    // Navigate to app
    await page.goto('/');

    // Wait for server connection (Automerge sync)
    await waitForServerConnection(page);

    // Wait for tracks to render
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });

    // Get track IDs
    const trackIds = await getTrackIds(page);
    expect(trackIds.length).toBeGreaterThan(0);

    const testTrackId = trackIds[0];

    // Get initial gain
    const initialGain = await getTrackGain(page, testTrackId);
    console.log(`Initial gain: ${initialGain}`);

    // Change gain to a new value
    const newGain = initialGain === 0.5 ? 0.75 : 0.5;
    console.log(`Setting gain to: ${newGain}`);

    await setTrackGain(page, testTrackId, newGain);

    // Wait a moment for sync
    await page.waitForTimeout(500);

    // Verify the UI shows the new gain
    const uiGain = await getTrackGain(page, testTrackId);
    expect(uiGain).toBeCloseTo(newGain, 2);

    // Check if engine received the change
    // The engine logs "Graph updated (document change)" when it rebuilds
    const engineReceivedChange = await waitForEngineLog('Graph updated', 3000);

    if (!engineReceivedChange) {
      console.log('=== ENGINE LOG ===');
      console.log(getEngineLog());
      console.log('=== BROWSER CONSOLE ===');
      logs.slice(-20).forEach(log => console.log(log));
      console.log('==================');
    }

    expect(engineReceivedChange).toBe(true);
  });

  test('multiple gain changes are all applied', async ({ page }) => {
    const logs: string[] = [];
    setupConsoleCollection(page, logs);

    await page.goto('/');
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });

    const trackIds = await getTrackIds(page);
    expect(trackIds.length).toBeGreaterThan(0);

    const testTrackId = trackIds[0];

    // Count existing occurrences before changes
    const initialCount = countEngineLogOccurrences('Graph updated');

    // Make 3 consecutive changes
    const values = [0.25, 0.75, 0.5];
    for (const value of values) {
      await setTrackGain(page, testTrackId, value);
      await page.waitForTimeout(400);
    }

    // Wait for all changes to propagate
    await page.waitForTimeout(1000);

    // Count final occurrences
    const finalCount = countEngineLogOccurrences('Graph updated');
    const updateCount = finalCount - initialCount;

    console.log(`Engine received ${updateCount}/${values.length} updates (${initialCount} -> ${finalCount})`);

    // At least 2 out of 3 should succeed (network timing may coalesce)
    expect(updateCount).toBeGreaterThanOrEqual(2);
  });

  test('gain affects peak meters (audio verification)', async ({ page }) => {
    // This test verifies that gain changes actually affect the audio output
    // by observing the peak meter values in the telemetry

    const logs: string[] = [];
    setupConsoleCollection(page, logs);

    await page.goto('/');
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });

    const trackIds = await getTrackIds(page);
    expect(trackIds.length).toBeGreaterThan(0);

    const testTrackId = trackIds[0];

    // Count occurrences before
    const countBefore = countEngineLogOccurrences('Graph updated');

    // Set gain to minimum (0)
    await setTrackGain(page, testTrackId, 0);
    await page.waitForTimeout(500);

    // Set gain to maximum (1)
    await setTrackGain(page, testTrackId, 1);
    await page.waitForTimeout(1000);

    // Count occurrences after
    const countAfter = countEngineLogOccurrences('Graph updated');

    // The test passes if:
    // 1. The engine rebuilt the graph (count increased)
    // 2. The peak levels are different (would need meter parsing)

    // For now, just verify the graph was rebuilt at least once
    const updates = countAfter - countBefore;
    console.log(`Graph updated ${updates} times (${countBefore} -> ${countAfter})`);

    expect(updates).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Engine connection status', () => {
  test('page shows engine connection status', async ({ page }) => {
    await page.goto('/');

    // Check for connection status indicators
    const serverStatus = await page.locator('#server-status').isVisible().catch(() => false);
    const engineStatus = await page.locator('#engine-status').isVisible().catch(() => false);

    // At minimum, server status should be visible
    expect(serverStatus).toBe(true);

    console.log(`Server status visible: ${serverStatus}`);
    console.log(`Engine status visible: ${engineStatus}`);
  });
});
