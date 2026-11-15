import { expect, test } from './game-test.mjs';

test('SI proposes a lunar mission and opens it in the shared engineering planner', async ({ page }) => {
  test.setTimeout(300000);
  await page.addInitScript(() => {
    window.jugreDesktop = { si: { signIn: async () => {}, propose: async () => ({
      status: 'ready', message: 'This proposal needs engineering checks.', assumptions: [],
      mission: { name: 'Lunar science', destination: 'moon', goal: 'expedition', crewCount: 4, payloadMassKg: 232, returnRequired: true },
    }) } };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html', { timeout: 180000 });
  await expect(page.locator('#loading')).toBeHidden({ timeout: 180000 });
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=si]').click();
  await expect(page.locator('#si-mode')).toBeVisible();
  await page.locator('#si-prompt').fill('Send four astronauts to the Moon with 232 kg of cargo and return them.');
  await page.locator('#si-submit').click();
  await expect(page.locator('#si-result')).toContainText('232 kg', { timeout: 90000 });
  await page.getByRole('button', { name: 'Review in Engineering →' }).click();
  await expect(page.locator('#engineering-mode')).toBeVisible();
  await expect(page.locator('[name=destination]')).toHaveValue('moon');
  await expect(page.locator('[name=crewCount]')).toHaveValue('4');
  expect(errors).toEqual([]);
});
