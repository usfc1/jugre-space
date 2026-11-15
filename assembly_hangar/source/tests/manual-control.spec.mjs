import { expect, test } from './game-test.mjs';
import { FlightState } from '../flight-missions.mjs';
import { checkpoint } from './flight-fixtures.mjs';

async function openFlight(page) {
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=launch]').click();
  await page.locator('#launch-rocket').selectOption('apollo_11');
  await page.locator('#flight-start').click();
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
}

test('manual controls load a legacy flight, remap cutoff, block time warp, and survive a reload', async ({ page }) => {
  const flight = new FlightState('apollo_11');
  flight.update(40);
  flight.paused = true;
  const old = checkpoint(flight);
  old.visual = { staged: false, upperStaged: false, boostersReleased: false, recoverySeconds: 0 };
  delete old.state.manualControl;
  await page.addInitScript(save => {
    if (!localStorage.getItem('jugre.flight-save.v1')) localStorage.setItem('jugre.flight-save.v1', JSON.stringify(save));
  }, old);
  await page.goto('/index.html', { timeout: 90000 });
  await openFlight(page);

  const toggle = page.locator('#flight-take-control');
  const assistance = page.locator('#flight-assistance');
  const throttle = page.locator('#flight-throttle');
  const tempo = page.locator('#flight-warp');
  const pause = page.locator('#flight-pause');
  await expect(assistance).toHaveValue('standard');
  await expect(page.locator('#flight-control-profile')).toContainText(/Ракета|Rocket/i);
  await expect(toggle).toHaveText(/Взять управление|Take control/i);
  await toggle.click();
  await expect(toggle).toHaveText(/Вернуть автопилоту|Use autopilot/i);
  await expect(page.locator('#flight-control-reason')).toContainText(/Пауза|paused/i);
  await assistance.selectOption('arcade');
  await expect(page.locator('#flight-control-switches')).toContainText(/SAS вкл.|SAS on/i);
  await page.locator('#flight-bindings summary').click();
  await page.locator('#flight-bind-action').selectOption('cutoff');
  await page.locator('#flight-bind-key').click();
  await page.keyboard.press('z');
  await expect(page.locator('#flight-bind-feedback')).toContainText(/уже используется|already assigned/i);
  await page.locator('#flight-bind-key').click();
  await page.keyboard.press('c');
  await expect(page.locator('#flight-bind-feedback')).toContainText(/сохранена|saved/i);
  await expect(page.locator('#flight-control-help')).toContainText('Z/C');
  await page.locator('#flight-bindings summary').click();
  await page.locator('#viewport').focus();
  await page.keyboard.press('p');
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('c');
  await expect(throttle).toHaveValue('0');
  await tempo.selectOption('10');
  await page.locator('#viewport').focus();
  await expect(page.locator('#flight-control-reason')).toContainText(/темп ×1|time warp to ×1/i);
  await page.keyboard.press('z');
  await expect(throttle).toHaveValue('0');
  await page.keyboard.press('p');
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#flight-save').click();

  await page.reload({ timeout: 90000 });
  await openFlight(page);
  await expect(toggle).toHaveText(/Вернуть автопилоту|Use autopilot/i);
  await expect(assistance).toHaveValue('arcade');
  await expect(page.locator('#flight-control-help')).toContainText('Z/C');
  await page.locator('#viewport').focus();
  await page.keyboard.press('p');
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('z');
  await expect(throttle).toHaveValue('100');
  await page.keyboard.press('c');
  await expect(throttle).toHaveValue('0');
});

test('orbital takeover suspends automatic warp and the Moon landing explains the manual control lock', async ({ page }) => {
  const flight = new FlightState('apollo_11', 'command');
  for (let i = 0; i < 30 && flight.kind === 'ascent'; i++) flight.update(10, undefined, 100, () => false);
  expect(flight.kind).toBe('orbit');
  flight.flightLength = 'short';
  flight.paused = true;
  await page.addInitScript(save => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(save)), checkpoint(flight));
  await page.goto('/index.html', { timeout: 90000 });
  await openFlight(page);
  const toggle = page.locator('#flight-take-control');
  await expect(page.locator('#flight-control-profile')).toContainText(/Космический аппарат|Spacecraft/i);
  await toggle.click();
  await expect(toggle).toHaveText(/Вернуть автопилоту|Use autopilot/i);
  await page.keyboard.press('p');
  await expect(page.locator('[data-broadcast=status]')).toHaveText('LIVE');
  await page.keyboard.press('p');
  await expect(page.locator('#flight-pause')).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveText(/Взять управление|Take control/i);

  const guided = checkpoint(flight);
  guided.state.values.phaseIndex = flight.mission.phases.findIndex(phase => phase.kind === 'moonLanding');
  guided.state.values.time = 0;
  guided.state.values.progress = 0;
  guided.state.values.altitude = 10;
  await page.evaluate(save => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(save)), guided);
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-control-profile')).toContainText(/Посадочный модуль|Lander/i);
  await expect(toggle).toBeDisabled();
  await expect(page.locator('#flight-control-reason')).toContainText(/GUIDED SEGMENT/i);
});
