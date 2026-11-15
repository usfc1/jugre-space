import { test, expect } from './game-test.mjs';
import { FlightState } from '../flight-missions.mjs';
import { checkpoint } from './flight-fixtures.mjs';

test('permanent skip button advances launch through MECO and saves the resulting stage', async ({ page }) => {
  test.setTimeout(180000);
  const flight = new FlightState('apollo_11');
  flight.paused = true;
  flight.preflight = flight.countdown = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.JUGRE_TEST_GAME_URL || '/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=launch]').click();
  await page.locator('#launch-rocket').selectOption('apollo_11');
  await page.locator('#flight-start').click();
  await expect(page.locator('#broadcast-hud')).toBeVisible({ timeout: 90000 });
  const saved = checkpoint(flight);
  saved.visual = { staged: false, upperStaged: false, boostersReleased: false, recoverySeconds: 0 };
  await page.evaluate(saved => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(saved)), saved);
  await page.locator('#flight-load').click();
  const skip = page.locator('#flight-skip-maneuver');
  for (const id of ['liftoff', 'max-q', 'meco']) {
    await expect(skip).toBeVisible();
    await expect(skip).toBeEnabled();
    await skip.click();
    await expect(skip).toBeEnabled({ timeout: 45000 });
    await page.locator('#flight-save').click();
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')).state);
    expect(state.timeline.events.find(e => e.id === id).status).toBe('COMPLETE');
    expect(state.values.paused).toBe(true);
    expect(FlightState.fromSave(state).failed).toBe(false);
  }
  await page.screenshot({ path: 'test-results/skip-through-meco.png' });
  expect(errors).toEqual([]);
});

test('skipping the short Voyager cruise shows Saturn with Earth millions of kilometres away', async ({ page }) => {
  test.setTimeout(180000);
  const flight = new FlightState('voyager_2', 'command', { flightLength: 'short' });
  flight.preflight = flight.countdown = 0;
  for (let i = 0; i < 1000 && !flight.solarFlight && !flight.failed; i++) flight.update(30, {}, 20, () => false);
  flight.paused = true;
  for (let i = 0; i < 20 && flight.kind !== 'saturnTransfer'; i++) await flight.skipNextEvent();
  expect(flight.kind).toBe('saturnTransfer');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.JUGRE_TEST_GAME_URL || '/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=launch]').click();
  await page.locator('#launch-rocket').selectOption('voyager_2');
  await page.locator('#flight-start').click();
  await expect(page.locator('#broadcast-hud')).toBeVisible({ timeout: 90000 });
  await page.evaluate(saved => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(saved)), checkpoint(flight));
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
  const skip = page.locator('#flight-skip-maneuver');
  await skip.click();
  await expect(skip).toBeEnabled({ timeout: 45000 });
  await page.locator('#flight-diagnostics').evaluate(element => { element.open = true; });
  const reader = page.locator('.physics-values');
  await expect(reader).toHaveAttribute('data-snapshot', /saturnFlyby/);
  const { rendering } = JSON.parse(await reader.getAttribute('data-snapshot'));
  expect(Math.hypot(...rendering.spaceCamera.earthPosition)).toBeGreaterThan(1e7);
  expect(rendering.rigid.debris).toBe(0);
  expect(errors).toEqual([]);
});
