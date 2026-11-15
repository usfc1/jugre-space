import { expect, test } from './game-test.mjs';

const step = (page, name) => page.locator('#engineering-steps').getByRole('button', { name, exact: true }).click();
async function openEngineering(page) {
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=engineering]').click();
}

test('Engineering guides manual editing, calculates, and invalidates a changed configuration', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openEngineering(page);
  await expect(page.locator('#engineering-title')).toHaveText('Mission setup');
  await expect(page.locator('[data-engineering-step]:visible')).toHaveCount(1);
  await expect(page.locator('#engineering-preview-slot canvas')).toBeVisible();
  await expect(page.locator('#standard-preview-caption')).toHaveText('Low Earth orbit');
  await page.locator('[name=name]').fill('Ручная орбитальная миссия');
  await expect(page.locator('#engineering-summary-name')).toHaveText('Ручная орбитальная миссия');
  await page.screenshot({ path: 'test-results/engineering-mission.png' });
  await page.locator('#engineering-next').click();
  await expect(page.locator('#engineering-title')).toHaveText('Target orbit');
  await page.locator('[name=inclinationDeg]').fill('35');
  await page.locator('#engineering-next').click();
  await page.locator('[name=payloadMassKg]').fill('25');
  await expect(page.locator('#engineering-summary-values')).toContainText('25 kg');
  await page.locator('#engineering-back').click();
  await expect(page.locator('[name=inclinationDeg]')).toHaveValue('35');
  await step(page, 'Носитель');
  await expect(page.locator('[name=maxMassKg]')).not.toBeVisible();
  await page.locator('#engineering-next').click();
  await expect(page.locator('#design-apply')).not.toBeVisible();
  await page.locator('#engineering-calculate').click();
  await expect(page.locator('#design-status')).toContainText('No matching configurations.');
  await expect(page.locator('#design-report')).toContainText('Target inclination guidance is not implemented.');
  await expect(page.locator('#design-apply')).toBeDisabled();
  await step(page, 'Орбита');
  await page.locator('[name=inclinationDeg]').fill('');
  await step(page, 'Нагрузка');
  await page.locator('[name=payloadMassKg]').fill('0');
  await step(page, 'Проверка');
  await page.locator('#engineering-calculate').click();
  await expect(page.locator('#design-status')).toContainText('Flight configuration available.');
  await expect(page.locator('#design-apply')).toBeEnabled();
  await page.locator('[name=flightLength]').selectOption('short');
  await expect(page.locator('#design-apply')).toBeEnabled();
  await expect(page.locator('#engineering-results')).toBeVisible();
  await expect(page.locator('#design-report .engineering-details')).not.toHaveAttribute('open', '');
  await expect(page.locator('#design-report .standard-metrics')).toBeVisible();
  await expect(page.locator('#standard-preview-caption')).not.toHaveText('Low Earth orbit');
  await page.screenshot({ path: 'test-results/engineering-review.png' });
  await step(page, 'Нагрузка');
  await page.locator('[name=payloadMassKg]').fill('40');
  await step(page, 'Проверка');
  await expect(page.locator('#design-apply')).not.toBeVisible();
  await expect(page.locator('#engineering-calculate')).toBeEnabled();
  await page.locator('#design-save').click();
  await expect(page.locator('#design-status')).toHaveText('Mission saved.');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=engineering]').click();
  await expect(page.locator('[name=name]')).toHaveValue('Ручная орбитальная миссия');
  await step(page, 'Нагрузка');
  await expect(page.locator('[name=payloadMassKg]')).toHaveValue('40');
  await page.locator('[data-designer-mode=standard]').click();
  await expect(page.locator('#standard-mode .standard-preview')).toBeVisible();
  await expect(page.locator('#standard-title')).toHaveText('Destination');
  expect(errors).toEqual([]);
});

test('mobile Engineering keeps each step and its navigation inside the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEngineering(page);
  expect(await page.locator('#engineering-steps').evaluate(nav => nav.getBoundingClientRect().height)).toBeLessThan(100);
  for (const name of ['Миссия', 'Орбита', 'Нагрузка', 'Носитель', 'Проверка']) {
    await step(page, name);
    await expect(page.locator('[data-engineering-step]:visible')).toHaveCount(1);
    await expect(page.locator('#engineering-title')).toBeInViewport();
    const size = await page.locator('#mission-designer').evaluate(dialog => ({ client: dialog.clientWidth, scroll: dialog.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
    await expect(page.locator('#engineering-back')).toBeInViewport();
    await expect(page.locator(name === 'Проверка' ? '#engineering-calculate' : '#engineering-next')).toBeInViewport();
  }
  await step(page, 'Миссия');
  await page.screenshot({ path: 'test-results/engineering-mobile.png' });
  await page.locator('#design-earth-science').click();
  await step(page, 'Нагрузка');
  await expect(page.locator('#design-spacecraft')).toHaveAttribute('open', '');
  await page.locator('#design-instrument-search').fill('Магнитометр');
  await expect(page.locator('#design-instruments label')).toHaveCount(1);
  await page.locator('[data-instrument=mag]').check();
  await step(page, 'Орбита');
  await step(page, 'Нагрузка');
  await expect(page.locator('[data-instrument=mag]')).toBeChecked();
  await page.screenshot({ path: 'test-results/engineering-mobile-payload.png' });
});
