import { test as base, expect } from '@playwright/test';

// Feature scenarios enter the game through the startup menu. Menu-specific
// scenarios keep importing Playwright directly so they exercise that screen.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addLocatorHandler(page.locator('body:has(#loading[hidden]) #main-menu'), async () => {
      await page.locator('[data-menu-action="assembly"]').click();
    });
    await page.addLocatorHandler(page.locator('#flight-stage-detail:not([open])'), async () => {
      await page.locator('#flight-stage-detail > summary').click();
    });
    await use(page);
  },
});
export { expect };
