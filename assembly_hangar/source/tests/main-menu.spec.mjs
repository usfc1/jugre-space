import { expect, test } from '@playwright/test';
import { FlightState } from '../flight-missions.mjs';
import { checkpoint, coastFixture } from './flight-fixtures.mjs';

const ready = async page => {
  await page.goto(new URL('../../index.html', import.meta.url).href + '?vabDebug');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('[data-menu-action="settings"]')).toBeEnabled();
};

test('startup menu, real settings, persistence, keyboard and existing navigation', async ({ page }) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await ready(page);
  await expect(page.locator('#main-menu')).toBeVisible();
  await expect(page.locator('[data-menu-action="continue"]')).toBeDisabled();
  await page.screenshot({ path: 'menu-test-results/main-menu.png' });
  await page.locator('[data-menu-action="settings"]').click();
  await expect(page.locator('#game-settings')).toBeVisible();
  await page.locator('[data-setting="scale"]').fill('115');
  await page.keyboard.press('Escape');
  await page.locator('[data-menu-action="settings"]').click();
  await expect(page.locator('[data-setting="scale"]')).toHaveValue('100');
  for (const tab of ['graphics','audio','controls','gameplay','general']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator(`[data-panel="${tab}"]`)).toBeVisible();
  }
  await page.locator('[data-setting="language"]').selectOption('ru');
  await page.locator('[data-setting="scale"]').fill('110');
  await page.locator('[data-tab="graphics"]').click();
  await page.locator('[data-setting="quality"]').selectOption('low');
  await page.locator('[data-setting="antialias"]').uncheck();
  await page.locator('[data-tab="audio"]').click();
  await page.locator('[data-audio="master"]').fill('33');
  await page.locator('[data-setting="mute"]').check();
  await page.locator('[data-tab="controls"]').click();
  await page.locator('#settings-profile').selectOption('rocket');
  await page.locator('#settings-action').selectOption('pause');
  await page.locator('#settings-key').click();
  await page.keyboard.press('O');
  await expect(page.locator('#settings-key')).toContainText('O');
  await page.locator('[data-tab="gameplay"]').click();
  await page.locator('[data-setting="sensitivity"]').fill('150');
  await page.locator('[data-setting="telemetry"]').uncheck();
  await page.locator('#settings-apply').click();
  const runtime = await page.evaluate(() => ({ ratio: window.vabDebug.renderer.getPixelRatio(), shadows: window.vabDebug.renderer.shadowMap.enabled,
    rotate: window.vabDebug.controls.rotateSpeed, master: window.vabDebug.audio.settings.master, muted: window.vabDebug.audio.muted }));
  expect(runtime).toEqual({ ratio: .75, shadows: false, rotate: 1.5, master: .33, muted: true });
  await page.locator('#settings-save').click();
  await expect(page.locator('#game-settings')).toBeHidden();
  await page.reload(); await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('[data-menu-action="settings"]')).toContainText('Настройки');
  expect(await page.evaluate(() => ({ settings: JSON.parse(localStorage.getItem('jugre.settings.v1')), audio: JSON.parse(localStorage.getItem('jugre.audio.v1')) })))
    .toMatchObject({ settings: { language:'ru', scale:110, quality:'low', shadows:false, antialias:false, sensitivity:150, telemetry:false, mute:true }, audio:{ master:.33 } });
  expect(await page.evaluate(() => window.vabDebug.renderer.getContext().getContextAttributes().antialias)).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.controls.v1')).profiles.rocket.pause)).toBe('KeyO');
  await page.locator('[data-menu-action="new"]').click();
  await expect(page.locator('#mission-designer')).toBeVisible();
  await page.locator('#design-close').click();
  await page.locator('#open-main-menu').click();
  await page.locator('[data-menu-action="projects"]').click();
  await expect(page.locator('#mission-designer')).toBeVisible();
  await expect(page.locator('#design-library')).toHaveJSProperty('open', true);
  await page.locator('#design-close').click();
  await page.locator('#open-main-menu').click();
  await page.locator('[data-menu-action="missions"]').click();
  await expect(page.locator('#game-missions')).toBeVisible();
  await page.locator('#mission-custom').click();
  await expect(page.locator('#design-library')).toHaveJSProperty('open', true);
  await page.locator('#design-close').click();
  await page.locator('#open-main-menu').click();
  await page.locator('[data-menu-action="missions"]').click();
  await page.locator('#mission-historical').click();
  await expect(page.locator('#launch-panel')).toBeVisible();
  await expect(page.locator('#mission-details')).toHaveJSProperty('open', true);
  await page.locator('#open-main-menu').click();
  await page.locator('[data-menu-action="assembly"]').click();
  await expect(page.locator('#work-area')).toHaveClass(/building/);
  await page.locator('#open-main-menu').click();
  await page.locator('[data-menu-action="credits"]').click();
  await expect(page.locator('#game-credits')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-menu-action="exit"]').click();
  await expect(page.locator('#menu-save-status')).toContainText('Закройте вкладку');
  expect(errors).toEqual([]);
});

test('continue restores a historical flight checkpoint', async ({ page }) => {
  test.setTimeout(180000);
  const flight = new FlightState('apollo_11'); flight.paused = true;
  await page.addInitScript(saved => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(saved)), checkpoint(flight));
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.locator('[data-menu-action="continue"]')).toBeEnabled();
  await page.locator('[data-menu-action="continue"]').click();
  await expect(page.locator('#flight-event')).toContainText('Flight restored', { timeout: 90000 });
  await expect(page.locator('#flight-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('continue restores a designed mission checkpoint', async ({ page }) => {
  test.setTimeout(180000);
  const state = coastFixture('moon'); state.paused = true;
  await page.addInitScript(saved => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(saved)), checkpoint(state));
  await ready(page);
  await expect(page.locator('[data-menu-action="continue"]')).toBeEnabled();
  await page.locator('[data-menu-action="continue"]').click();
  await expect(page.locator('#flight-event')).toContainText('Flight restored', { timeout: 90000 });
  await expect(page.locator('#flight-panel')).toBeVisible();
});

test('continue restores the saved custom rocket without replacing the current hangar', async ({ page }) => {
  test.setTimeout(210000); await ready(page);
  const { layout, vehicle } = await page.evaluate(() => ({ layout: window.vabDebug.builder.getLayout(), vehicle: window.vabDebug.builder.snapshotCraft().userData.launchVehicle }));
  const state = new FlightState('custom', 'command', { vehicle }); state.paused = true;
  const saved = checkpoint(state); saved.visual.customLayout = layout;
  await page.evaluate(value => {
    localStorage.setItem('jugre.flight-save.v1', JSON.stringify(value));
    window.vabDebug.builder.applyBlueprint({ layout: [] });
  }, saved);
  await page.reload(); await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('[data-menu-action="continue"]')).toBeEnabled();
  await page.locator('[data-menu-action="continue"]').click();
  await expect(page.locator('#flight-event')).toContainText('Flight restored', { timeout: 90000 });
  await page.locator('#flight-save').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')).visual.customLayout)).toEqual(layout);
  expect(await page.evaluate(() => window.vabDebug.builder.getLayout())).toEqual([]);
});

test('continue restores a saved rover test range', async ({ page }) => {
  test.setTimeout(180000);
  const state = new FlightState('barkhan_4'); state.paused = true;
  await page.addInitScript(saved => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(saved)), checkpoint(state));
  await ready(page);
  await expect(page.locator('[data-menu-action="continue"]')).toBeEnabled();
  await page.locator('[data-menu-action="continue"]').click();
  await expect(page.locator('#flight-event')).toContainText('Flight restored', { timeout: 90000 });
  await expect(page.locator('#flight-title')).toContainText('Barkhan-4');
});

test('menu and settings remain usable at compact resolutions', async ({ page }) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 800, height: 600 }); await ready(page);
  await page.locator('[data-menu-action="settings"]').click();
  await page.locator('[data-tab="audio"]').click();
  await expect(page.locator('[data-panel="audio"]')).toBeVisible();
  await expect(page.locator('#settings-save')).toBeInViewport();
  await page.screenshot({ path: 'menu-test-results/main-menu-compact-settings.png' });
});

test('fullscreen setting changes the actual display mode', async ({ page }) => {
  test.setTimeout(120000); await ready(page);
  await page.locator('[data-menu-action="settings"]').click();
  await page.locator('[data-setting="fullscreen"]').check();
  await page.locator('#settings-apply').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.locator('[data-setting="fullscreen"]').uncheck();
  await page.locator('#settings-apply').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});
