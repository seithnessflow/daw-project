/**
 * E2E test helpers for CRDT diagnostics
 */

import { Page, BrowserContext } from '@playwright/test';

export interface CRDTDiagnostics {
  actorId: string;
  heads: string[];
  trackCount: number;
  gains: Record<string, number>;
  consoleLogs: string[];
}

/**
 * Collect CRDT diagnostics from a page for debugging failures.
 */
export async function collectDiagnostics(page: Page, label: string): Promise<CRDTDiagnostics> {
  const diagnostics = await page.evaluate(() => {
    // Access the global project instance
    const project = (window as any).__dawProject;
    if (!project) {
      return {
        actorId: 'unknown',
        heads: [],
        trackCount: 0,
        gains: {},
      };
    }

    const doc = project.getDocument();
    const heads = project.getHeads ? project.getHeads() : [];

    const gains: Record<string, number> = {};
    for (const track of doc.tracks || []) {
      gains[track.id] = track.gain;
    }

    return {
      actorId: project.doc?.getActorId?.() || 'unknown',
      heads: Array.isArray(heads) ? heads.map(String) : [],
      trackCount: doc.tracks?.length || 0,
      gains,
    };
  });

  return {
    ...diagnostics,
    consoleLogs: [], // Collected separately via page.on('console')
  };
}

/**
 * Print diagnostics for both tabs on test failure.
 */
export function printDiagnostics(
  tab1: CRDTDiagnostics,
  tab2: CRDTDiagnostics
): void {
  console.log('\n=== CRDT DIAGNOSTICS ===\n');

  console.log('Tab 1:');
  console.log(`  Actor ID: ${tab1.actorId}`);
  console.log(`  Heads: ${tab1.heads.join(', ') || 'none'}`);
  console.log(`  Tracks: ${tab1.trackCount}`);
  console.log(`  Gains: ${JSON.stringify(tab1.gains)}`);
  if (tab1.consoleLogs.length > 0) {
    console.log('  Console:');
    tab1.consoleLogs.slice(-10).forEach(log => console.log(`    ${log}`));
  }

  console.log('\nTab 2:');
  console.log(`  Actor ID: ${tab2.actorId}`);
  console.log(`  Heads: ${tab2.heads.join(', ') || 'none'}`);
  console.log(`  Tracks: ${tab2.trackCount}`);
  console.log(`  Gains: ${JSON.stringify(tab2.gains)}`);
  if (tab2.consoleLogs.length > 0) {
    console.log('  Console:');
    tab2.consoleLogs.slice(-10).forEach(log => console.log(`    ${log}`));
  }

  console.log('\n=== END DIAGNOSTICS ===\n');
}

/**
 * Wait for WebSocket connection to server.
 */
export async function waitForServerConnection(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('#server-status')?.classList.contains('connected'),
    { timeout }
  );
}

/**
 * Get track gain value from UI.
 */
export async function getTrackGain(page: Page, trackId: string): Promise<number> {
  const value = await page.evaluate((id) => {
    const track = document.querySelector(`[data-track-id="${id}"]`);
    const input = track?.querySelector('input[type="range"]') as HTMLInputElement;
    return input ? parseFloat(input.value) : -1;
  }, trackId);
  return value;
}

/**
 * Set track gain value via UI.
 */
export async function setTrackGain(page: Page, trackId: string, gain: number): Promise<void> {
  await page.evaluate(({ id, g }) => {
    const track = document.querySelector(`[data-track-id="${id}"]`);
    const input = track?.querySelector('input[type="range"]') as HTMLInputElement;
    if (input) {
      input.value = g.toString();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { id: trackId, g: gain });
}

/**
 * Get all track IDs from the page.
 */
export async function getTrackIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const tracks = document.querySelectorAll('[data-track-id]');
    return Array.from(tracks).map(t => t.getAttribute('data-track-id') || '');
  });
}

/**
 * Setup console log collection for a page.
 */
export function setupConsoleCollection(page: Page, logs: string[]): void {
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });
}
