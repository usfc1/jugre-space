import { expect, test } from './game-test.mjs';

const openBuildSetup = async page => {
  if (!await page.locator('#assembly-settings').evaluate(panel => panel.open)) {
    await page.locator('#assembly-settings > summary').click();
  }
};

test('vertical VAB frames small and large vehicles, clears structures and transfers saved payloads', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/index.html?vabDebug');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  const inspect = () => page.evaluate(() => {
    const { camera, bounds, renderer, scene } = window.vabDebug;
    const projected = [];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          projected.push(camera.position.clone().set(x, y, z).project(camera).toArray());
        }
      }
    }
    const model = scene.getObjectByName('vab_ready_rocket') ?? scene.getObjectByName('vab_custom_rocket');
    let hidden = 0;
    scene.traverse((object) => { if (object.userData.occluder && !object.visible) hidden++; });
    return { projected, height: bounds.max.y - bounds.min.y, min: bounds.min.y,
      rotation: model.rotation.toArray().slice(0, 3), scale: model.scale.toArray(), hidden,
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  });
  const framed = async () => {
    await page.waitForTimeout(800);
    await expect.poll(async () => (await inspect()).projected.every(([x, y, z]) =>
      Math.abs(x) < .98 && Math.abs(y) < .98 && z > -1 && z < 1)).toBe(true);
    const result = await inspect();
    expect(result.min).toBeCloseTo(.8, 4);
    expect(result.rotation).toEqual([0, 0, 0]);
    expect(result.scale).toEqual([1, 1, 1]);
    return result;
  };
  await framed();
  await page.screenshot({ path: '../vab_small_preview.png' });
  await page.locator('[data-view=ready]').click();
  await expect(page.locator('#ready-status')).toHaveText('On the stand');
  let tall = await framed();
  expect(tall.height).toBeGreaterThan(100);
  expect(tall.hidden).toBeGreaterThan(0);
  console.log('Saturn V', tall);
  await page.screenshot({ path: '../vab_saturn_preview.png' });
  for (const view of ['engines', 'stages', 'payload', 'whole']) {
    await page.locator('[data-vab-view=' + view + ']').click();
    await expect(page.locator('[data-vab-view=' + view + ']')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('[data-rocket=artemis_ii]').click();
  await expect(page.locator('#ready-vehicle')).toHaveText('SLS Block 1');
  await expect(page.locator('#ready-status')).toHaveText('On the stand');
  expect((await framed()).height).toBeGreaterThan(90);
  await page.screenshot({ path: '../vab_sls_preview.png' });
  await page.locator('[data-view=rocket]').click();
  await openBuildSetup(page);
  await page.locator('#assembly-cargo-example').click();
  await openBuildSetup(page);
  await page.locator('#systems-unload').click();
  await page.locator('[data-view=equipment]').click();
  await expect(page.locator('#vab-equipment-install')).toBeEnabled();
  await page.locator('#vab-equipment-test').click();
  await expect(page.locator('#vab-equipment-install')).toBeDisabled();
  await page.locator('#vab-equipment-test').click();
  await expect(page.locator('#vab-equipment-install')).toBeEnabled();
  await page.screenshot({ path: '../vab_equipment_preview.png' });
  await page.locator('#vab-equipment-install').click();
  await expect(page.locator('.mount-point:not([hidden])').first()).toBeVisible();
  await page.locator('.mount-point:not([hidden])').first().click();
  expect(await page.evaluate(() => window.vabDebug.builder.getLayout().some((entry) => entry.part === 'mayak_k'))).toBe(true);
  const saved = await page.evaluate(() => window.vabDebug.builder.getLayout());
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  expect(await page.evaluate(() => window.vabDebug.builder.getLayout())).toEqual(saved);
  await page.locator('[data-vab-view=whole]').click();
  await framed();
  // A full orbit crosses walls and service bays without camera collision locks.
  await page.evaluate(() => {
    const { camera, controls } = window.vabDebug;
    controls.dispatchEvent({ type: 'start' });
    camera.position.copy(controls.target).add(camera.position.clone().set(-18, 4, -40));
    controls.update();
  });
  await expect.poll(async () => (await inspect()).hidden).toBeGreaterThan(0);
  await page.locator('#vab-gate').click();
  await expect(page.locator('#vab-gate')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-view=equipment]').click();
  await page.locator('#vab-equipment-model').selectOption('eagle');
  await expect(page.locator('#vab-equipment-status')).toContainText('Eagle uses the Apollo 11');
  await page.locator('#vab-equipment-apollo').click();
  await expect(page.locator('#ready-vehicle')).toHaveText('Saturn V');
  await expect(page.locator('#ready-status')).toHaveText('On the stand');
  await framed();
  await page.setViewportSize({ width: 390, height: 844 });
  await framed();
  expect(errors).toEqual([]);
});
