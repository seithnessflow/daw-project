// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 1bis guard: the ?server= parameter routes BOTH channels (WS sync and
 * HTTP assets) to the given server. Exercised here against the same
 * local server - the two-machine smoke uses the identical code path
 * with a remote address. A regression here would only surface on two
 * machines, which CI does not have.
 */
import { test, expect } from '@playwright/test';
import { waitForServerConnection } from './helpers';

test.describe('Remote server parameter (1bis)', () => {
  test('?server= is honored by sync and assets alike', async ({ page }) => {
    const projectId = `e2e-serverparam-${Date.now()}`;
    await page.goto(`/?project=${projectId}&server=ws://127.0.0.1:3000`);
    await waitForServerConnection(page);
    await page.waitForSelector('[data-track-id]', { timeout: 10000 });

    const urls = await page.evaluate(async () => {
      const ctx = await import('/src/app/context.ts');
      return { ws: ctx.SERVER_URL, http: ctx.SERVER_HTTP };
    });
    expect(urls.ws).toBe('ws://127.0.0.1:3000');
    expect(urls.http).toBe('http://127.0.0.1:3000');
  });
});
