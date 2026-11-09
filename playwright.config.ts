import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://127.0.0.1:4173/article.html',
    reuseExistingServer: process.env.SAKUTTO_E2E_REUSE_SERVER === '1',
    timeout: 15_000,
  },
});
