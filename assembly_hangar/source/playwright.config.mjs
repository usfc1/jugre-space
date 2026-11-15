import { defineConfig } from '@playwright/test';
const port = Number(process.env.JUGRE_TEST_PORT) || 4179;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1,
  timeout: 120000, expect: { timeout: 15000 }, reporter: 'list',
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true, viewport: { width: 1920, height: 1080 }, screenshot: 'only-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] } },
  webServer: { command: 'node tests/serve.mjs', url: `${baseURL}/timeline-preview.html`, reuseExistingServer: true },
});
