// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Quick diagnostic test to see browser console.
 *
 * Twin fused (refonte prep, section 3): this spec used to carry its own
 * copies of the gain helpers - it now imports the shared ones, so the
 * selection contract lives in exactly one place.
 */
import { test, expect } from '@playwright/test';
import {
  waitForServerConnection,
  getTrackGain,
  setTrackGain,
} from './helpers';

test('diagnostic - check sync flow', async ({ page }) => {
  const logs: string[] = [];

  // Capture all console output
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Navigate
  await page.goto('/?project=default');

  // Wait for server connection
  await waitForServerConnection(page, 5000);

  console.log('Server connected, finding track...');

  // Find a track and change its gain
  const track = await page.waitForSelector('[data-track-id]', { timeout: 5000 });
  const trackId = (await track.getAttribute('data-track-id'))!;
  console.log('Found track:', trackId);

  // Get initial gain
  const initialGain = await getTrackGain(page, trackId);
  console.log('Initial gain:', initialGain);

  // Change gain
  const newGain = initialGain === 0.5 ? 0.75 : 0.5;
  console.log('Setting gain to:', newGain);
  await setTrackGain(page, trackId, newGain);

  // Wait for sync
  await page.waitForTimeout(1000);

  // Print all console logs
  console.log('\n=== BROWSER CONSOLE ===');
  logs.forEach(log => console.log(log));
  console.log('=== END CONSOLE ===\n');

  expect(true).toBe(true);
});
