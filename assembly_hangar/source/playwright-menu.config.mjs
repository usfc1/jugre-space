import { defineConfig } from '@playwright/test';

// The distributed game is an offline file; these checks deliberately run it
// without a web server so they cover the standalone entry point as well.
export default defineConfig({
  testDir: './tests', testMatch: 'main-menu.spec.mjs', workers: 1, outputDir: './menu-test-results',
  timeout: 180000, expect: { timeout: 15000 }, reporter: 'list',
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true,
    viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] } },
});
