import { expect, test } from './game-test.mjs';

async function openStandard(page) {
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await expect(page.locator('#standard-mode')).toBeVisible();
}
const next = page => page.locator('#standard-next').click();

test('Standard preserves choices, prepares a real spacecraft and launches the shared mission', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openStandard(page);
  await expect(page.locator('#standard-title')).toHaveText('Destination');
  await expect(page.locator('[data-destination=earth] img')).toHaveJSProperty('complete', true);
  await expect.poll(() => page.locator('[data-destination=earth] img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/standard-destinations.png' });
  await expect(page.locator('[data-destination=mars]')).toHaveAttribute('aria-disabled', 'false');
  await next(page);
  await expect(page.locator('[data-goal=science]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-goal=docking]')).toHaveAttribute('aria-disabled', 'true');
  await next(page);
  await expect(page.locator('[data-crew=false]')).toHaveAttribute('aria-pressed', 'true');
  await next(page);
  await page.locator('[data-standard-instrument=mag]').click();
  await page.locator('#standard-back').click();
  await next(page);
  await expect(page.locator('[data-standard-instrument=mag]')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/standard-payload.png' });
  await next(page);
  await expect(page.locator('#standard-title')).toHaveText('Mission ready');
  await page.locator('#standard-flight-length').selectOption('short');
  await expect(page.locator('.standard-manifest')).toContainText('Magnetometer');
  await expect(page.locator('#standard-overview')).toContainText('Launcher price');
  await expect(page.locator('#standard-preview-caption')).toContainText('Falcon');
  await expect(page.locator('#standard-preview-error')).toHaveText('');
  await page.screenshot({ path: 'test-results/standard-overview.png' });
  await page.locator('#standard-mission-name').fill('Standard Earth Test');
  await next(page);
  await expect(page.locator('#mission-designer')).not.toBeVisible({ timeout: 90000 });
  await expect(page.locator('#flight-title')).toHaveText('Standard Earth Test');
  await expect(page.locator('#flight-wrapit')).toHaveCount(0);
  await page.locator('#design-flight > summary').click();
  await expect(page.locator('#design-flight-goals')).toContainText('Confirmed · Liftoff', { timeout: 35000 });
  await expect(page.locator('#flight-altitude-label')).toContainText('short route');
  await expect(page.locator('#flight-warp')).toHaveValue('1');
  await expect(page.locator('#flight-warp')).toBeDisabled();
  await page.screenshot({ path: 'test-results/short-flight-launch.png' });
  await page.locator('#flight-save').click();
  const saved = await page.evaluate(() => ({ flight: JSON.parse(localStorage.getItem('jugre.flight-save.v1')),
    library: JSON.parse(localStorage.getItem('jugre.mission-projects.v1')) }));
  expect(saved.flight.state.design.spec.spacecraft.instrumentIds).toEqual(['wide', 'mag']);
  expect(saved.flight.state.values.flightLength).toBe('short');
  expect(saved.flight.state.values.actualRate).toBe(1);
  expect(saved.library.projects.find(item => item.spec.name === 'Standard Earth Test').spec.flightLength).toBe('short');
  expect(errors).toEqual([]);
});

test('budget failure has a working correction and draft survives reload and Engineering mode', async ({ page }) => {
  await openStandard(page);
  await next(page); await next(page); await next(page);
  await page.locator('[data-standard-instrument=wide]').click();
  await page.locator('[data-standard-instrument=hires]').click();
  await page.getByRole('button', { name: 'Up to 10 M', exact: true }).click();
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await expect(page.locator('[data-standard-instrument=hires]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Up to 10 M', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await next(page);
  await expect(page.locator('#standard-title')).toHaveText('Review mission');
  await expect(page.locator('#standard-next')).toBeDisabled();
  await expect(page.locator('.standard-check[data-status=FAIL]')).toContainText('Budget');
  await page.getByRole('button', { name: 'Use default camera', exact: true }).click();
  await expect(page.locator('#standard-title')).toHaveText('Mission ready');
  await page.locator('[data-designer-mode=engineering]').click();
  await expect(page.locator('#design-form')).toBeVisible();
  await expect(page.locator('[name=type]')).toHaveValue('science');
  await expect(page.locator('[data-instrument=wide]')).toBeChecked();
  await expect(page.locator('[data-instrument=hires]')).not.toBeChecked();
  await page.locator('[data-designer-mode=standard]').click();
  await expect(page.locator('#standard-title')).toHaveText('Destination');
  await next(page); await next(page); await next(page);
  await expect(page.locator('[data-standard-instrument=wide]')).toHaveAttribute('aria-pressed', 'true');
});

test('lunar flow prepares four crew, resource checks and the actual SLS model', async ({ page }) => {
  await openStandard(page);
  await page.locator('[data-destination=moon]').click();
  await next(page);
  await expect(page.locator('[data-goal=landing]')).toHaveAttribute('aria-disabled', 'true');
  await next(page);
  await expect(page.getByRole('button', { name: '4 astronauts', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await next(page);
  await page.locator('[data-cargo=light]').click();
  await next(page);
  await expect(page.locator('#standard-title')).toHaveText('Mission ready');
  await expect(page.locator('.standard-manifest')).toContainText('4 astronauts');
  await expect(page.locator('.standard-manifest')).toContainText('50 kg');
  await expect(page.locator('#standard-overview')).toContainText('O₂');
  await expect(page.locator('#standard-preview-caption')).toContainText('SLS');
  await page.locator('[data-preview=craft]').click();
  await expect(page.locator('#standard-preview-caption')).toContainText('4 seats');
  await expect(page.locator('#standard-preview-error')).toHaveText('');
  await page.screenshot({ path: 'test-results/standard-lunar.png' });
});

test('mobile Standard keeps navigation and payload controls inside the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStandard(page);
  await page.screenshot({ path: 'test-results/standard-mobile.png' });
  await expect(page.locator('#standard-next')).toBeInViewport();
  await next(page); await next(page); await next(page);
  await page.getByRole('searchbox', { name: 'Search instruments' }).fill('Magnetometer');
  await expect(page.locator('[data-standard-instrument]')).toHaveCount(1);
  await page.locator('[data-standard-instrument=mag]').click();
  const size = await page.locator('#mission-designer').evaluate(dialog => ({ client: dialog.clientWidth, scroll: dialog.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  await expect(page.locator('#standard-next')).toBeInViewport();
});
