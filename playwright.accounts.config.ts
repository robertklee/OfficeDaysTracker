import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:8789';
const persistence = '.wrangler/test-accounts';
const lifecycleRun = (process.env.RTO_ACCOUNT_TEST_RUN ??= randomUUID());
if (!/^[a-f0-9-]{36}$/.test(lifecycleRun)) throw new Error('Invalid account test run ID.');
const lifecyclePersistence = `.wrangler/test-accounts-lifecycle/${lifecycleRun}`;
const lifecycleOrigin = 'http://127.0.0.1:8790';

export default defineConfig({
  testDir: './tests/accounts',
  outputDir: './test-results/accounts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  metadata: { lifecyclePersistence, lifecycleOrigin },
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    timezoneId: 'America/Los_Angeles',
  },
  projects: [
    { name: 'accounts-api', testMatch: '**/*.api.spec.ts' },
    {
      name: 'accounts-chromium',
      testMatch: '**/*.browser.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `npm run db:local -- --persist-to ${persistence} && npm run build && npx wrangler pages dev dist --ip 127.0.0.1 --port 8789 --persist-to ${persistence}`,
      url: `${origin}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npx wrangler pages dev dist --ip 127.0.0.1 --port 8790 --persist-to ${lifecyclePersistence}`,
      url: lifecycleOrigin,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
