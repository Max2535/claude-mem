import { defineConfig, devices } from '@playwright/test';

/**
 * The viewer is served by the long-running worker, not by a server the test
 * run owns, so there is no `webServer` here — start it with
 * `npm run worker:start` (or `build-and-sync`) before running these.
 *
 * The specs live in e2e/ rather than tests/, because `bun test tests` picks up
 * *.spec.ts as well and would try to run them under the wrong runner.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.VIEWER_URL ?? 'http://localhost:37701',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
