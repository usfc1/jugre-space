import { expect, test } from './game-test.mjs';

const step = (page, name) => page.locator('#engineering-steps').getByRole('button', { name, exact: true }).click();
async function calculate(page) {
  await step(page, 'Проверка');
  await page.locator('#engineering-calculate').click();
}

test('designer saves a lunar scenario, then flies a generated Earth-orbit configuration', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=engineering]').click();
  await page.locator('#design-lunar').click();
  await expect(page.locator('[name=crewCount]')).toHaveValue('4');
  await expect(page.locator('[name=payloadMassKg]')).toHaveValue('232');
  await page.locator('[name=name]').fill('JUGRE Lunar Orbital Expedition');
  await step(page, 'Нагрузка');
  await page.locator('[name=expeditionHardware]').selectOption('');
  await calculate(page);
  await expect(page.locator('#design-status')).toContainText('No matching configurations.');
  await expect(page.locator('#design-report')).toContainText('FAIL · Seats');
  await expect(page.locator('#design-apply')).toBeDisabled();
  await page.reload();
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=engineering]').click();
  await expect(page.locator('[name=name]')).toHaveValue('JUGRE Lunar Orbital Expedition');
  await page.locator('#design-new').click();
  await page.locator('[name=name]').fill('Проверка орбиты');
  await calculate(page);
  await expect(page.locator('#design-status')).toContainText('Flight configuration available.');
  await page.locator('#design-apply').click();
  await expect(page.locator('#launch-rocket')).toHaveValue('designed');
  await page.locator('#flight-start').click();
  await expect(page.locator('#flight-title')).toHaveText('Проверка орбиты');
  await page.locator('#flight-warp').selectOption('500');
  await expect(page.locator('#design-flight-goals')).toContainText('Confirmed · Liftoff', { timeout: 35000 });
  await page.locator('#flight-save').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1'))?.state.design.spec.name)).toBe('Проверка орбиты');
  await page.locator('#flight-load').click();
  await expect(page.locator('#design-flight-goals')).toContainText('Confirmed · Liftoff');
  await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete', { timeout: 45000 });
  await page.locator('#flight-save').click();
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=launch]').click();
  await page.locator('#design-resume').click();
  await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete', { timeout: 30000 });
});

test('crewed assembly runs equipment and restores cabin state after a paused failure drill', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=engineering]').click();
  await step(page, 'Орбита');
  await page.locator('[name=durationHours]').fill('.5');
  await step(page, 'Нагрузка');
  await page.locator('[name=crewCount]').fill('2');
  await page.locator('[name=crewMassKgEach]').fill('82');
  await page.locator('#design-cabin > summary').click();
  const fixture = { volumeM3: 5, equipmentKg: 45, oxygenKg: .12, reserveKg: .01, oxygenDeliveryKgH: .15,
    waterKg: 1, foodKg: .2, ventilationW: 30, busW: 20, scrubberKgH: .2, scrubberCapacityKg: .1,
    scrubberW: 30, thermalJK: 120000, thermalW: 100, heatRejectionW: 500 };
  for (const [id, value] of Object.entries(fixture)) await page.locator(`[name=${id}]`).fill(String(value));
  await calculate(page);
  await expect(page.locator('#design-report')).toContainText('PASS · Seats');
  await expect(page.locator('#design-report')).toContainText('PASS · O₂ supply');
  await page.locator('.engineering-risk > summary').click();
  await page.locator('#design-risk').check();
  await page.locator('#design-apply').click();
  await page.locator('#flight-start').click();
  await page.locator('#crew-life-panel > summary').click();
  await page.getByText('Управление системами и испытания', { exact: true }).click();
  await page.locator('#flight-warp').selectOption('10');
  await expect(page.locator('#design-flight-goals')).toContainText('Confirmed · Liftoff', { timeout: 35000 });
  await page.locator('[data-equipment=power]').uncheck();
  await expect(page.locator('#crew-life-readings')).toContainText('Main power unavailable');
  await page.locator('#flight-pause').click();
  await page.locator('#flight-save').click();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1'))?.state.design.lifeSupport);
  const paused = await saved();
  expect(paused.controls.power).toBe(false);
  await page.locator('[data-equipment=power]').check();
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
  await expect(page.locator('[data-equipment=power]')).not.toBeChecked();
  await page.locator('#flight-save').click();
  expect(await saved()).toEqual(paused);
});

test('four crew orbit the Moon, save and complete the measured return', async ({ page }) => {
  test.setTimeout(260000);
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=engineering]').click();
  await page.locator('#design-lunar').click();
  await expect(page.locator('[name=crewCount]')).toHaveValue('4');
  await calculate(page);
  await expect(page.locator('#design-report')).toContainText('PASS · Seats');
  await expect(page.locator('#design-report')).toContainText('PASS · Service-module fuel');
  await page.locator('#design-apply').click();
  await page.locator('#flight-start').click();
  // Observe the public physical event inside its integration substep. One
  // delayed rendered frame can otherwise cross both lunar and return phases.
  await page.evaluate(() => {
    const pauseOnCapture = event => {
      if (event.detail.cue !== 'lunar-orbit' || event.detail.status !== 'COMPLETE') return;
      window.removeEventListener('mission-control', pauseOnCapture);
      document.querySelector('#flight-pause').click();
    };
    window.addEventListener('mission-control', pauseOnCapture);
  });
  await page.locator('#flight-warp').selectOption('20000');
  await expect(page.locator('#design-flight-goals')).toContainText('Confirmed · Capture and verify lunar orbit', { timeout: 140000 });
  await page.locator('#flight-warp').selectOption('1');
  await expect(page.locator('#flight-pause')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#flight-save')).toBeEnabled();
  await page.locator('#flight-save').click();
  await expect(page.locator('#flight-event')).toContainText('saved');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')).state);
  expect(saved.values.phaseIndex).toBe(3);
  expect(saved.design.lifeSupport.crew).toHaveLength(4);
  const capture = saved.design.execution.objectives.find(goal => goal.id === 'lunar-orbit');
  expect(capture.evidence.periapsisM).toBeCloseTo(120000, 1);
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
  await page.locator('#flight-warp').selectOption('20000');
  await page.locator('#flight-pause').click();
  await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete', { timeout: 140000 });
  await expect(page.locator('#design-flight-goals')).toContainText('crew4');
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.mission-projects.v1')).projects[0].result);
  expect(result).toMatchObject({ status: 'COMPLETED', completed: 9, total: 9 });
});
