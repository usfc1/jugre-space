import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { FlightState } from './flight-missions.mjs';

const before = process.argv.includes('--before');
const output = new URL('../diagnostics/kennedy-imagery/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.context().setOffline(true);
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
});
const results = { before, errors };
await page.addInitScript(() => {
  let data;
  Object.defineProperty(window, 'hangarData', {
    configurable: true,
    get: () => data,
    set: value => { data = value; window.__kennedyVerificationGLB = value.launchComplex; },
  });
});
const capture = async name => {
  // Let OrbitControls damping settle before comparing the same camera.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: fileURLToPath(new URL(`${before ? 'before' : 'after'}-${name}.png`, output)) });
};
try {
  await page.goto(new URL('../index.html', import.meta.url).href, { timeout: 90000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  await page.click('[data-view=launch]');
  await page.locator('#flight-start').waitFor({ state: 'visible' });
  await capture('pad');
  const area = await page.locator('#work-area').boundingBox();
  // A fixed orbit gesture also gives the old viewer a comparable overhead view.
  await page.mouse.move(area.x + area.width * .53, area.y + area.height * .50);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * .53, area.y + area.height * .50 + 300, { steps: 20 });
  await page.mouse.up();
  await page.mouse.wheel(0, 1650);
  await capture('overhead');
  if (!before) {
    await page.click('[data-launch-view=padTop]');
    await capture('pad-top');
    await page.locator('#viewport').screenshot({ path: fileURLToPath(new URL('../launch_texture_preview.png', import.meta.url)) });
  }
  await page.click('#launch-evening');
  await capture('evening');
  await page.click('#launch-evening');
  await page.click('[data-launch-view=overview]');
  await capture('campus');
  results.images = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob(window.__kennedyVerificationGLB), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const jsonLength = view.getUint32(12, true);
    const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const binaryOffset = 28 + jsonLength;
    return Promise.all(document.images.filter(image => image.name?.startsWith('Kennedy aerial')).map(async image => {
      const buffer = document.bufferViews[image.bufferView];
      const bitmap = await createImageBitmap(new Blob([
        bytes.subarray(binaryOffset + buffer.byteOffset, binaryOffset + buffer.byteOffset + buffer.byteLength),
      ], { type: image.mimeType }));
      const size = { name: image.name, width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }));
  });
  if (!before) {
    const pad = results.images.find(image => image.name === 'Kennedy aerial pad39a');
    assert.ok(pad.width >= 4000 && pad.height >= 4000, 'Pad uses the detailed aerial raster in the offline bundle');
    const facilities = results.images.find(image => image.name === 'Kennedy aerial facilities');
    assert.ok(facilities.width >= 4000 && facilities.height >= 4000, 'VAB and 39B share the detailed facilities raster');
    await page.click('[data-launch-view=pad]');
    await page.click('#flight-start');
    await page.locator('#flight-panel').waitFor({ state: 'visible' });
    await capture('launch');
    const state = new FlightState('apollo_11');
    state.update(75.5);
    state.paused = true;
    const save = { version: 1, state: state.serialize(),
      visual: { staged: false, upperStaged: false, boostersReleased: false, recoverySeconds: 0 } };
    await page.evaluate(value => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(value)), save);
    await page.click('#flight-load');
    await capture('ascent');
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL(`${before ? 'before' : 'after'}-verification.json`, output), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results));
