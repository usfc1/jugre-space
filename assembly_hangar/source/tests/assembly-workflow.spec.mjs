import { expect, test } from './game-test.mjs';
import { trainingLayout } from '../assembly-workflow.mjs';
import { defaultSpacecraft } from '../spacecraft-design.mjs';

const openBuildSetup = async page => {
  if (!await page.locator('#assembly-settings').evaluate(panel => panel.open)) {
    await page.locator('#assembly-settings > summary').click();
  }
};

const ready = async page => {
  await page.goto('/index.html?vabDebug');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
};
const choose = async (page, part) => {
  await page.evaluate(part => {
    const { builder } = window.vabDebug;
    const categories = { b_240_rezerv:'tanks',b_32_stvol:'tanks',k_420_kedr:'propulsion',k_155v_dalniy:'propulsion',
      p_2512_konus:'structure',is_125:'structure',pb_1_strizh:'command',go_34_cargo_bay:'payload',mayak_k:'vehicles',
      r_253_triada:'structure',k_125_klen:'propulsion' };
    builder.showCategory(categories[part]);
  }, part);
  await page.locator('[data-part="' + part + '"]').click();
  await expect(page.locator('.mount-point:not([hidden])').first()).toBeVisible();
  await page.locator('.mount-point:not([hidden])').first().click();
};
const layout = page => page.evaluate(() => window.vabDebug.builder.getLayout());

test('lesson is isolated, resumes, checks actual assembly, repairs a fault and restores user project', async ({ page }) => {
  test.setTimeout(180000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await ready(page);
  const original = await layout(page);
  await openBuildSetup(page);
  await page.locator('#assembly-learn').click();
  await expect(page.locator('#assembly-tutorial-title')).toContainText('Camera controls');
  await page.locator('#tutorial-skip').click();
  for (const entry of trainingLayout) await choose(page, entry.part);
  await expect(page.locator('#assembly-tutorial-title')).toContainText('Staging');
  await page.locator('#assembly-verify').click();
  await expect(page.locator('#assembly-tutorial-title')).toContainText('Resolve a fault');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await expect(page.locator('#assembly-fuel')).toHaveValue('5');
  await openBuildSetup(page);
  await page.locator('#assembly-fuel').fill('100');
  await expect(page.locator('#assembly-tutorial-title')).toContainText('Preflight');
  await page.locator('#assembly-verify').click();
  await expect(page.locator('#assembly-tutorial-title')).toContainText('complete');
  await page.locator('#tutorial-keep').click();
  expect(await layout(page)).toEqual(original);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.mission-projects.v1')).projects.some(item=>item.spec.name.startsWith('Tutorial Rocket')))).toBe(true);
  await openBuildSetup(page);
  await page.locator('#assembly-learn').click();
  await page.locator('#tutorial-exit').click();
  expect(await layout(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test('symmetry, undo, redo, dependent removal and live payload configuration share the flight layout', async ({ page }) => {
  test.setTimeout(150000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await ready(page);
  await openBuildSetup(page);
  await page.locator('#assembly-new').click();
  await choose(page,'b_240_rezerv');
  await choose(page,'r_253_triada');
  await openBuildSetup(page);
  await page.locator('#assembly-symmetry').selectOption('3');
  await choose(page,'k_125_klen');
  expect((await layout(page)).filter(entry=>entry.part==='k_125_klen')).toHaveLength(3);
  await page.locator('#assembly-undo').click();
  expect((await layout(page)).filter(entry=>entry.part==='k_125_klen')).toHaveLength(0);
  await page.locator('#assembly-redo').click();
  expect((await layout(page)).filter(entry=>entry.part==='k_125_klen')).toHaveLength(3);
  await page.evaluate(() => { const b=window.vabDebug.builder;b.focusPart(b.getLayout()[0].key); });
  await openBuildSetup(page);
  await page.locator('#assembly-selected-remove').click();
  await expect(page.locator('#assembly-confirm')).toBeVisible();
  await expect(page.locator('#assembly-confirm-message')).toContainText('5');
  await page.locator('#assembly-confirm-cancel').click();
  expect(await layout(page)).toHaveLength(5);
  await page.evaluate(({layout, spacecraft}) => window.vabDebug.builder.applyBlueprint({
    layout: layout.map(entry => entry.key === 'satellite' ? { ...entry, spacecraft } : entry),
  }), { layout: trainingLayout, spacecraft: defaultSpacecraft });
  await openBuildSetup(page);
  await page.locator('#assembly-symmetry').selectOption('1');
  await page.evaluate(() => window.vabDebug.builder.focusPart('satellite'));
  await openBuildSetup(page);
  await page.locator('#assembly-edit-payload').click();
  await page.locator('#lab-category').selectOption('science');
  await page.locator('[data-lab-item="instrument:mag"]').click();
  await page.locator('#lab-face').selectOption('rear');
  await page.locator('.lab-mount[data-valid=true]:visible').first().click();
  await page.locator('#equipment-save').click();
  let payload=(await layout(page)).find(entry=>entry.key==='satellite');
  expect(payload.spacecraft.instrumentIds).toContain('mag');
  await page.locator('#vab-zone').click();
  await openBuildSetup(page);
  await page.locator('#assembly-purpose').selectOption('deployment');
  await page.locator('#assembly-verify').click();
  await expect(page.locator('#assembly-to-pad')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  expect((await layout(page)).find(entry=>entry.key==='satellite')).toEqual(payload);
  await page.locator('#assembly-verify').click();
  await page.locator('#assembly-to-pad').click();
  await expect(page.locator('#flight-start')).toBeEnabled();
  expect(await page.locator('#launch-rocket').inputValue()).toBe('designed');
  expect(errors).toEqual([]);
});
