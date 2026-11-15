import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { EARTH_RADIUS, FlightState, geoVector } from './flight-missions.mjs';

const output = new URL('../diagnostics/earth-clouds/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(90000);
const errors = [], frames = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
});
async function capture(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) });
  assert.deepEqual(errors, [], name);
  console.log(`Rendered ${name}`);
}
try {
  await page.goto(new URL('../index.html', import.meta.url).href, { timeout: 90000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.click('[data-view=launch]');
  await page.selectOption('#launch-rocket', 'apollo_11');
  await page.locator('#flight-start').waitFor({ state: 'visible' });
  await capture('pad-day');
  await page.click('#flight-start');
  await page.locator('#flight-panel').waitFor({ state: 'visible' });
  const recoveryOnly = process.argv.includes('--recovery-only');
  for (const time of recoveryOnly ? [] : [55, 128, 200]) {
    const state = new FlightState('apollo_11');
    state.update(15.5 + time); state.paused = true;
    const save = { version: 1, state: state.serialize(),
      visual: { staged: false, upperStaged: false, boostersReleased: false, recoverySeconds: 0 } };
    await page.evaluate(value => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(value)), save);
    await page.click('#flight-load');
    await page.locator('#flight-event').filter({ hasText: 'восстановлены' }).waitFor();
    await capture(`ascent-${time}s`);
    frames.push({ time, altitudeKm: state.altitude });
  }
  if (!recoveryOnly) {
    await page.click('[data-flight-camera=earth]');
    await capture('earth-globe');
    await page.setViewportSize({ width: 800, height: 900 });
    await capture('earth-resized');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-flight-camera=ship]');
  }
  const recovery = new FlightState('apollo_11');
  recovery.update(215.5);
  recovery.phaseIndex = recovery.mission.phases.findIndex(phase => phase.kind === 'reentry');
  recovery.progress = .91;
  recovery.time = recovery.progress * recovery.phase.duration;
  recovery.position.copy(geoVector(27.4, -72.1, EARTH_RADIUS));
  recovery.altitude = 0;
  recovery.countdown = 0;
  recovery.totalTime = 1000;
  recovery.paused = true;
  await page.evaluate(value => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(value)), {
    version: 1, state: recovery.serialize(), visual: { staged: true, upperStaged: true, boostersReleased: true, recoverySeconds: 3 },
  });
  await page.click('#flight-load');
  const event = page.locator('#flight-event').filter({ hasText: /восстановлены|Приводнение|Не удалось загрузить полёт/ });
  await event.waitFor({ timeout: 12000 });
  assert.match(await event.textContent(), /восстановлены|Приводнение/);
  await capture('splashdown');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('verification.json', output), JSON.stringify({ frames, errors }, null, 2));
  await browser.close();
}
