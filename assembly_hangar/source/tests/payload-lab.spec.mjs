import { expect, test } from './game-test.mjs';
const game = new URL('../../index.html?vabDebug', import.meta.url).href;

test('manual payload mounting preserves user positions, systems and saved loadouts', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(game);
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=equipment]').click();
  await expect(page.locator('[data-lab-item="instrument:wide"]')).toBeVisible();
  await expect(page.locator('#lab-installed button')).toHaveCount(0);
  await page.locator('[data-lab-item="instrument:wide"]').click();
  await expect(page.locator('#lab-installed button')).toHaveCount(0);
  await page.locator('.lab-mount[data-valid=true]:visible').first().click();
  await expect(page.locator('#lab-installed button')).toHaveCount(1);
  await page.locator('#lab-undo').click();
  await expect(page.locator('#lab-installed button')).toHaveCount(0);
  await page.locator('#lab-redo').click();
  await expect(page.locator('#lab-installed button')).toHaveCount(1);
  const first = await page.evaluate(() => window.vabDebug.bench.getConfiguration().mounting[0]);
  await page.locator('#lab-move').click();
  await page.locator('#lab-rotate').click();
  await page.locator('.lab-mount[data-slot=front_8]').click();
  let config = await page.evaluate(() => window.vabDebug.bench.getConfiguration());
  expect(config.instrumentIds).toEqual(['wide']);
  expect(config.mounting[0].slot).not.toBe(first.slot);
  expect(config.mounting[0].turn).toBe(1);
  for (const [id, variant, face] of [['battery', 'standard', 'rear'], ['radio', 'low', 'left'],
    ['computer', 'plus', 'rear'], ['attitude', 'basic', 'top'], ['panels', 'standard', 'right']]) {
    await page.locator('#lab-category').selectOption('systems');
    await page.locator('[data-lab-item="system:' + id + ':' + variant + '"]').click();
    await page.locator('#lab-face').selectOption(face);
    await page.locator('.lab-mount[data-valid=true]:visible').first().click();
  }
  await expect(page.locator('#lab-installed button')).toHaveCount(6);
  await page.locator('#lab-name').fill('Hand-built survey bus');
  await page.locator('#equipment-save').click();
  config = await page.evaluate(() => window.vabDebug.bench.getConfiguration());
  await page.locator('#vab-equipment-model').selectOption('mayak_s');
  await expect(page.locator('#lab-installed button')).toHaveCount(0);
  await page.locator('#equipment-library').selectOption('0');
  expect(await page.evaluate(() => window.vabDebug.bench.getConfiguration())).toEqual(config);
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=equipment]').click();
  expect(await page.evaluate(() => window.vabDebug.bench.getConfiguration())).toEqual(config);
  await page.screenshot({ path: '../payload_lab_manual_preview.png' });
  expect(errors).toEqual([]);
});
