import { expect, test } from './game-test.mjs';

async function open(page) {
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
}
async function prepare(page, destination, goal) {
  await open(page);
  await page.locator(`[data-destination=${destination}]`).click();
  await page.locator('#standard-next').click();
  await page.locator(`[data-goal=${goal}]`).click();
  await page.locator('#standard-next').click();
  await expect(page.locator('[data-crew=false]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#standard-next').click();
  await page.locator('[data-cargo=none]').click();
  await page.locator('#standard-next').click();
  await expect(page.locator('#standard-title')).toHaveText('Mission ready');
  await expect(page.locator('#standard-overview')).toContainText('Probe fuel');
}

test('all planets have usable previews; Engineering exposes the probe and checks insufficient fuel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await expect(page.locator('[data-destination]')).toHaveCount(9);
  for (const destination of ['mars', 'mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const card = page.locator(`[data-destination=${destination}]`);
    await expect(card).toHaveAttribute('aria-disabled', 'false');
    await card.click();
    await expect.poll(() => card.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#standard-preview-error')).toHaveText('');
  }
  await page.screenshot({ path: 'test-results/planet-destinations.png' });
  await page.locator('[data-designer-mode=engineering]').click();
  await expect(page.locator('[name=destination]')).toHaveValue('neptune');
  await page.locator('#engineering-steps').getByRole('button', { name: 'Нагрузка', exact: true }).click();
  await page.locator('#design-interplanetary > summary').click();
  await page.locator('[name=probeFuelKg]').fill('0');
  await page.locator('#engineering-steps').getByRole('button', { name: 'Проверка', exact: true }).click();
  await page.locator('#engineering-calculate').click();
  await expect(page.locator('#design-status')).toContainText('No matching configurations.');
  await expect(page.locator('#design-report')).toContainText('Probe Δv');
  await expect(page.locator('#design-apply')).toBeDisabled();
  expect(errors).toEqual([]);
});

for (const [destination, name, goal] of [['mars', 'Марс', 'flyby'], ['neptune', 'Нептун', 'orbit']]) {
  test(`${destination} ${goal} flies through the shared mission and restores the completed planetary checkpoint`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page, destination, goal);
    await expect(page.locator('#standard-overview .standard-route')).toContainText(name);
    await page.screenshot({ path: `test-results/${destination}-mission.png` });
    await page.locator('#standard-next').click();
    await page.locator('#flight-warp').selectOption('1000000000');
    await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete', { timeout: 120000 });
    await expect(page.locator('#design-flight-goals')).toContainText(`Arrival: ${name}`);
    await page.locator('#flight-planet').selectOption(name);
    await page.screenshot({ path: `test-results/${destination}-encounter.png` });
    await page.locator('#flight-save').click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')).state);
    expect(saved.design.spec.destination).toBe(destination);
    expect(saved.design.interplanetary.fuelKg).toBeGreaterThan(0);
    if (goal === 'orbit') expect(saved.design.execution.objectives.find(item => item.id === 'planet-orbit').evidence.energy).toBeLessThan(0);
    await page.locator('#flight-load').click();
    await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete');
    expect(errors).toEqual([]);
  });
}
