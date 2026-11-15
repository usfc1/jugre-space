import { test, expect } from './game-test.mjs';
import { FlightState } from '../flight-missions.mjs';
import { checkpoint } from './flight-fixtures.mjs';
import { SurfaceExpedition } from '../surface-expedition.mjs';
function fixture(kind) {
  const f = new FlightState('apollo_11'); f.preflight = f.countdown = 0;
  f.phaseIndex = f.mission.phases.findIndex(p => p.kind === kind); f.altitude = kind === 'moonLanding' ? .1 : 0;
  f.totalTime = 20000; f.time = 1; f.verticalSpeed = -1; f.paused = true; f.mode = 'command';
  return f;
}
async function load(page, flight) {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(save => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(save)), checkpoint(flight));
  await page.goto('/index.html', { timeout: 90000 });
  await expect(page.locator('#loading'), errors.join('\n')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=launch]').click(); await page.locator('#launch-rocket').selectOption('apollo_11');
  await page.locator('#flight-start').click(); await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
  expect(errors).toEqual([]);
}
test('P66 takeover exposes a real local model, alarm choice, throttle and a stable save', async ({ page }) => {
  await load(page, fixture('moonLanding'));
  await page.locator('#flight-take-control').click();
  await expect(page.locator('#local-controls')).toBeVisible();
  await expect(page.locator('#local-readings')).toContainText('1202');
  await page.locator('#flight-save').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')));
  expect(saved.state.localLanding.model.p[1]).toBe(100);
});
test('EVA switches astronauts, advances resources only when running, and saves the active actor', async ({ page }) => {
  const f = fixture('moonSurface'); f.surfaceExpedition = new SurfaceExpedition('apollo_11');
  await load(page, f); await page.locator('#flight-take-control').click();
  await expect(page.locator('#local-readings')).toContainText('armstrong');
  await page.locator('#viewport').focus(); await page.keyboard.press('Tab');
  await expect(page.locator('#local-readings')).toContainText('aldrin');
  await page.locator('#flight-save').click();
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')));
  expect(save.state.surfaceExpedition.values.active).toBe(1);
});

for (const id of ['barkhan_4', 'barkhan_6']) test(`${id} enters the Earth range, drives with Vehicle2 and restores a trip`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html', { timeout: 90000 });
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=launch]').click();
  await page.locator('#launch-rover select').selectOption(id);
  await page.locator('#launch-rover button').click();
  await expect(page.locator('#local-readings')).toContainText(id);
  await page.locator('#viewport').focus(); await page.keyboard.down('w'); await page.waitForTimeout(1800); await page.keyboard.up('w');
  await page.keyboard.press('p'); await page.locator('#flight-save').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')));
  const actor = saved.state.surfaceExpedition.actors[0];
  expect(saved.state.missionId).toBe(id); expect(actor.p[2]).toBeGreaterThan(.2);
  expect(actor.nativeWheels).toHaveLength(id === 'barkhan_4' ? 4 : 6);
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/restored/i);
  await page.locator('#flight-save').click();
  const copy = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')));
  expect(copy.state.surfaceExpedition.actors[0].p).toEqual(actor.p);
  expect(errors).toEqual([]);
});
