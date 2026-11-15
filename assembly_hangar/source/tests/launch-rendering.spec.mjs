import { test, expect } from './game-test.mjs';
import { FlightState } from '../flight-missions.mjs';

const expectedNozzles = { apollo_11:5, artemis_ii:6, mars_2020:6, mars_science_laboratory:6, dart:9, iss_resupply:9, voyager_2:2 };
for (const [id, nozzleCount] of Object.entries(expectedNozzles)) {
  test(`${id}: actual renderer and HUD match physical launch at T+12`, async ({ page }, info) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/index.html', { timeout:90000 });
    await expect(page.locator('#loading')).toBeHidden({ timeout:90000 });
    await page.click('[data-view=launch]'); await page.selectOption('#launch-rocket',id);
    await expect(page.locator('#flight-start')).toBeEnabled(); await page.click('#flight-start');
    await expect(page.locator('#broadcast-hud')).toBeVisible();
    for (const seconds of [12,60]) {
      const state = new FlightState(id); state.update(15.5+seconds); state.paused = true;
      const save = {version:1,state:state.serialize(),visual:{staged:false,upperStaged:false,boostersReleased:false,recoverySeconds:0}};
      await page.evaluate(value=>localStorage.setItem('jugre.flight-save.v1',JSON.stringify(value)),save);
      await page.click('#flight-load');
      await expect(page.locator('[data-broadcast=clock]')).toHaveText(seconds === 12 ? 'T+ 00:00:12' : 'T+ 00:01:00');
      if (seconds === 12) await page.locator('#flight-diagnostics > summary').click();
      await expect.poll(async()=>JSON.parse(await page.locator('.physics-values').getAttribute('data-snapshot') || '{}').physics?.simulationTimeS).toBeCloseTo(seconds,4);
      const snapshot = JSON.parse(await page.locator('.physics-values').getAttribute('data-snapshot'));
      expect(snapshot.physics.altitudeM).toBeCloseTo(state.launch.altitudeM,4);
      expect(snapshot.physics.surfaceSpeedMps).toBeCloseTo(state.speed,4);
      if (seconds === 12) expect(snapshot.physics.groundDistanceM).toBeLessThan(10);
      expect(snapshot.rendering.frame).toBe(seconds === 12 ? 'launchpad' : 'floating-origin');
      expect(snapshot.rendering.attitudeErrorDeg).toBeLessThan(.01);
      expect(snapshot.rendering.activeNozzles).toBe(nozzleCount);
      expect(await page.locator('[data-broadcast=velocity]').textContent()).toBe(Math.round(state.speed*3.6).toLocaleString('en-US'));
      await page.screenshot({path:info.outputPath(`${id}-physical-t${seconds}.png`)});
    }
    expect(errors).toEqual([]);
  });
}
