// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Tests need sequential server access
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60000,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Servers are managed EXTERNALLY everywhere - locally by the developer
  // (npm run dev + start-stack.ps1), in CI by explicit workflow steps.
  // The old CI-only webServer block started `npm run preview` (port 4173)
  // without any dist/ build in that job: Playwright waited 60s for a
  // stillborn server and every CI e2e run died there.
});
