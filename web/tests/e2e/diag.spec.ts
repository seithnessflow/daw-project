// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Quick diagnostic test to see browser console.
 */
import { test, expect } from '@playwright/test';

test('diagnostic - check sync flow', async ({ page }) => {
  const logs: string[] = [];

  // Capture all console output
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Navigate
  await page.goto('/');

  // Wait for server connection
  await page.waitForFunction(
    () => document.querySelector('#server-status')?.classList.contains('connected'),
    { timeout: 5000 }
  );

  console.log('Server connected, finding track...');

  // Find a track and change its gain
  const track = await page.waitForSelector('[data-track-id]', { timeout: 5000 });
  const trackId = await track.getAttribute('data-track-id');
  console.log('Found track:', trackId);

  // Get initial gain
  const initialGain = await page.evaluate((id) => {
    const track = document.querySelector(`[data-track-id="${id}"]`);
    const input = track?.querySelector('input[type="range"]') as HTMLInputElement;
    return input ? parseFloat(input.value) : -1;
  }, trackId);
  console.log('Initial gain:', initialGain);

  // Change gain
  const newGain = initialGain === 0.5 ? 0.75 : 0.5;
  console.log('Setting gain to:', newGain);

  await page.evaluate(({ id, g }) => {
    console.log('Browser: Setting gain for', id, 'to', g);
    const track = document.querySelector(`[data-track-id="${id}"]`);
    const input = track?.querySelector('input[type="range"]') as HTMLInputElement;
    if (input) {
      input.value = g.toString();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('Browser: Event dispatched');
    } else {
      console.error('Browser: Input not found!');
    }
  }, { id: trackId, g: newGain });

  // Wait for sync
  await page.waitForTimeout(1000);

  // Print all console logs
  console.log('\n=== BROWSER CONSOLE ===');
  logs.forEach(log => console.log(log));
  console.log('=== END CONSOLE ===\n');

  expect(true).toBe(true);
});
