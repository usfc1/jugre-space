import { test, expect } from './game-test.mjs';
import { FlightState } from '../flight-missions.mjs';

for (const [width, height] of [[1920, 1080], [2560, 1440], [1366, 768], [390, 844]]) {
  test(`HUD layout and fixtures at ${width}×${height}`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto('/timeline-preview.html');
    await expect(page.locator('[data-broadcast=clock]')).toHaveText('T− 00:00:10');
    for (const id of ['apollo_11','artemis_ii','mars_2020','mars_science_laboratory','dart','voyager_2','iss_resupply','custom']) {
      await page.selectOption('#qa-mission', id);
      for (const state of ['COUNTDOWN','HOLD','LIVE','PAUSED','STAGING','DOCKING','LANDING','FAILED','ABORTED','SKIPPED','COMPLETE','MULTIDAY']) {
        await page.selectOption('#qa-state', state);
        await expect(page.locator('#broadcast-hud')).toBeVisible();
        const box = await page.locator('#broadcast-hud').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(Math.round(box.y + box.height)).toBe(height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
    }
    await page.selectOption('#qa-state', 'LIVE');
    await page.selectOption('#qa-mission', 'apollo_11');
    await page.screenshot({ path: info.outputPath(`hud-${width}x${height}.png`) });
    await page.locator('[data-timeline-event=max-q]').click();
    await expect(page.locator('#qa-details')).toContainText('Actual');
    await page.click('#qa-next');
    await expect(page.locator('.broadcast-markers')).not.toContainText('LIFTOFF');
    await page.click('#qa-auto');
    await page.click('#qa-toggle'); await expect(page.locator('#broadcast-hud')).toBeHidden();
    await page.click('#qa-toggle'); await expect(page.locator('#broadcast-hud')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('live game: countdown, hold, save/load, abort, restart, liftoff and staging', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html', { timeout: 90000 });
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.click('[data-view=launch]');
  await page.selectOption('#launch-rocket', 'apollo_11');
  await expect(page.locator('#flight-start')).toBeEnabled();
  await page.click('#flight-start');
  await expect(page.locator('#broadcast-hud')).toBeVisible();
  await page.click('#flight-hold');
  await expect(page.locator('[data-broadcast=status]')).toHaveText('HOLD');
  const held = await page.locator('[data-broadcast=clock]').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('[data-broadcast=clock]')).toHaveText(held);
  await page.click('#flight-save');
  await page.click('#flight-hold');
  await page.click('#flight-load');
  await expect(page.locator('[data-broadcast=status]')).toHaveText('HOLD');
  await expect(page.locator('[data-broadcast=clock]')).toHaveText(held);
  await page.click('#flight-stop');
  await expect(page.locator('[data-broadcast=status]')).toHaveText('LAUNCH ABORTED');
  await page.click('#flight-stop');
  await page.click('#flight-start');
  await expect(page.locator('[data-broadcast=clock]')).toContainText('T−');
  await expect(page.locator('[data-broadcast=clock]')).toContainText('T+', { timeout: 30000 });
  await page.selectOption('#flight-warp', '100');
  // Software WebGL under load can advance the simulation more slowly than wall time.
  await expect(page.locator('#flight-stages')).toContainText('S-IC SEP · COMPLETE', { timeout: 40000 });
  await page.click('#flight-pause');
  await page.click('#flight-save');
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')));
  expect(save.state.timeline.events.find(e => e.id === 'stage-1').status).toBe('COMPLETE');
  expect(save.state.timeline.events.find(e => e.id === 'max-q').status).toBe('COMPLETE');
  const pausedTime = await page.locator('[data-broadcast=clock]').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('[data-broadcast=clock]')).toHaveText(pausedTime);
  await page.screenshot({ path: info.outputPath('live-apollo-launch.png') });
  for (const [width, height] of [[1366,768], [2560,1440]]) {
    await page.setViewportSize({ width, height });
    const hud = await page.locator('#broadcast-hud').boundingBox();
    const viewport = await page.locator('#viewport').boundingBox();
    expect(hud.x + hud.width).toBeLessThanOrEqual(viewport.x + viewport.width);
    expect(Math.abs(hud.y + hud.height - viewport.y - viewport.height)).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath(`live-apollo-${width}x${height}.png`) });
  }
  await page.click('#broadcast-toggle'); await expect(page.locator('#broadcast-hud')).toBeHidden();
  await page.click('#broadcast-toggle'); await expect(page.locator('#broadcast-hud')).toBeVisible();
  expect(errors).toEqual([]);
});

function checkpoint(id, target) {
  const state = new FlightState(id);
  for (let i = 0; i < 50000 && state.kind !== target && !state.complete && !state.failed && !state.paused; i++) {
    // Historical cruises now span months of MET. Prepare their checkpoints on
    // the real passive path and leave the phase change to the normal update.
    if (state.path?.physical && !state.path.isPowered(state.time) && state.phase.duration - state.time > 3600) {
      state.advanceCoast(3600);
    } else state.update(.05, {}, 100);
  }
  if (state.kind !== target) throw new Error(`${id}: checkpoint ${target} not reached (${state.kind}, ${state.failureReason ?? state.time})`);
  if (id === 'dart') state.flightLength = 'short';
  state.paused = true;
  return { version: 1, state: state.serialize(), visual: { staged: true, upperStaged: ['apollo_11','voyager_2'].includes(id), boostersReleased: true, recoverySeconds: 0 } };
}

for (const [id, phase, goal] of [
  ['mars_2020','marsLanding','touchdown'], ['mars_science_laboratory','marsLanding','touchdown'],
  ['iss_resupply','docking','docked'], ['dart','dartRelease','impact'],
  ['apollo_11','moonTransfer','lm-extraction'], ['artemis_ii','lunarFlyby','flyby'], ['voyager_2','jupiterFlyby','jupiter'],
]) {
  test(`live ${id}: restored hardware confirms ${goal}`, async ({ page }, info) => {
    if (id === 'dart') test.setTimeout(180000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/index.html', { timeout: 90000 });
    await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    await page.click('[data-view=launch]');
    await page.selectOption('#launch-rocket', id);
    await expect(page.locator('#flight-start')).toBeEnabled();
    await page.click('#flight-start');
    await expect(page.locator('#broadcast-hud')).toBeVisible();
    await page.evaluate(save => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(save)), checkpoint(id, phase));
    await page.click('#flight-load');
    await expect(page.locator('[data-broadcast=status]')).toHaveText('PAUSED');
    // Apollo's extraction is a one-hour simulation maneuver, with its own
    // insertion burn and coast before it. Use the supported coast warp.
    if (id === 'dart') await expect(page.locator('#flight-warp')).toBeDisabled();
    else await page.selectOption('#flight-warp', id === 'apollo_11' ? '500' : '100');
    await page.click('#flight-pause');
    if (id === 'dart') {
      await expect(page.getByText('Пассивный подлёт к Диморфу', { exact: true }).first()).toBeVisible({ timeout: 75000 });
      await expect(page.locator('#flight-pause')).toHaveAttribute('aria-pressed', 'false');
    }
    await expect.poll(async () => {
      if (await page.locator('#flight-save').isDisabled()) return false;
      await page.click('#flight-save');
      return page.evaluate(goal => JSON.parse(localStorage.getItem('jugre.flight-save.v1')).state.timeline.events.find(e => e.id === goal)?.status === 'COMPLETE', goal);
    }, { timeout: id === 'apollo_11' ? 85000 : 45000, intervals: [500, 1000] }).toBe(true);
    if (id !== 'dart') await page.click('#flight-pause');
    await page.screenshot({ path: info.outputPath(`${id}-${goal}.png`) });
    expect(errors).toEqual([]);
  });
}
