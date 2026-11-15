import { test, expect } from './game-test.mjs';
import { FlightState, MOON, MOON_RADIUS, moonUp, MARS, geoVector } from '../flight-missions.mjs';

function checkpoint(id, altitude, surface = false, ascent = false) {
  const state = new FlightState(id);
  const lunar = id === 'apollo_11';
  const kind = ascent ? 'rendezvous' : (lunar ? 'moon' : 'mars') + (surface ? 'Surface' : 'Landing');
  state.phaseIndex = state.mission.phases.findIndex(p => p.kind === kind);
  const up = lunar ? moonUp : id === 'mars_2020' ? geoVector(18.44, 77.45) : geoVector(-4.59, 137.44);
  const center = lunar ? MOON : MARS, radius = lunar ? MOON_RADIUS : 3389.5;
  state.position.copy(center).addScaledVector(up, radius + Math.max(.004, altitude));
  state.segmentStart.copy(center).addScaledVector(up, radius + (lunar ? 120 : 800));
  state.altitude = altitude;
  state.heading.set(1, 0, 0);
  state.segmentHeading.copy(state.heading);
  state.countdown = 0;
  state.totalTime = 1000;
  state.progress = surface ? .25 : 1 - Math.sqrt(altitude / (lunar ? 120 : 800));
  state.time = state.progress * state.phase.duration;
  state.paused = true;
  state.surface = surface ? (lunar ? 'moon' : 'mars') : null;
  return { version: 1, state: state.serialize(), visual: { staged: true, upperStaged: true, boostersReleased: true, recoverySeconds: surface ? 7 : 0 } };
}

for (const id of ['apollo_11', 'mars_2020', 'mars_science_laboratory']) {
  test(`${id}: continuous approach, touchdown and surface shaders render`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) errors.push(m.text()); });
    await page.goto(process.env.JUGRE_TEST_GAME_URL || '/index.html', { timeout: 90000 });
    await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
    await page.click('[data-view=launch]');
    await page.selectOption('#launch-rocket', id);
    await expect(page.locator('#flight-start')).toBeEnabled();
    await page.click('#flight-start');
    await expect(page.locator('#broadcast-hud')).toBeVisible();
    for (const altitude of [60, 10, 2.01, 1.99, .08, 0]) {
      await page.evaluate(save => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(save)), checkpoint(id, altitude, altitude === 0));
      await page.click('#flight-load');
      await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
      // Wait for the first compiled frame, including procedural terrain shaders.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (id === 'apollo_11' && altitude <= 1.99) {
        await page.locator('#flight-diagnostics').evaluate(element => { element.open = true; });
        await expect.poll(async () => {
          const value = await page.locator('.physics-values').getAttribute('data-snapshot');
          if (!value) return false;
          const { rendering: r } = JSON.parse(value);
          const offset = r.cameraLocalM.map((v, i) => v - r.cameraTargetM[i]);
          return r.cameraDistanceM < 80 && r.cameraLocalM[1] > r.groundY
            && offset[1] / Math.hypot(...offset) < .7;
        }).toBe(true);
        await page.locator('#flight-diagnostics').evaluate(element => { element.open = false; });
        await expect(page.locator('#flight-pause')).toHaveAttribute('aria-pressed', 'true');
      }
      await page.screenshot({ path: info.outputPath(`${id}-${altitude}km.png`) });
      expect(errors).toEqual([]);
    }
    if (id === 'apollo_11') {
      await page.evaluate(save => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(save)), checkpoint(id, 2.01, false, true));
      await page.click('#flight-load');
      await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
      await page.screenshot({ path: info.outputPath('lunar-ascent-2km.png') });
    }
    expect(errors).toEqual([]);
  });
}
