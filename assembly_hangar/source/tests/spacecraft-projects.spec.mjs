import { expect, test } from './game-test.mjs';

const step = (page, name) => page.locator('#engineering-steps').getByRole('button', { name, exact: true }).click();
async function openDesigner(page) {
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('#design-open').click();
  await page.locator('[data-designer-mode=engineering]').click();
}

async function calculate(page) {
  await step(page, 'Проверка');
  await page.locator('#engineering-calculate').click();
  await expect(page.locator('#design-candidate option').first()).toBeAttached();
}

test('Earth observation runs from the catalog through separation, downlink and the saved report', async ({ page }) => {
  await openDesigner(page);
  await page.locator('#design-earth-science').click();
  await step(page, 'Нагрузка');
  await expect(page.locator('#design-instruments input')).toHaveCount(16);
  const totals = await page.locator('#design-spacecraft-total').textContent();
  await page.locator('#design-instrument-search').fill('магнитометр');
  await expect(page.locator('#design-instruments input')).toHaveCount(1);
  await page.locator('[data-instrument=mag]').check();
  await expect(page.locator('#design-spacecraft-total')).not.toHaveText(totals);
  await page.locator('[data-instrument=mag]').uncheck();
  await calculate(page);
  await expect(page.locator('#design-status')).toContainText('Flight configuration available.');
  await page.locator('#design-apply').click();
  await page.locator('#flight-start').click();
  await page.locator('#flight-warp').selectOption('500');
  await expect(page.locator('#design-flight-goals')).toContainText('Confirmed · Separate spacecraft', { timeout: 45000 });
  await page.locator('#satellite-panel > summary').click();
  await page.locator('#satellite-forecast > summary').click();
  await expect(page.locator('#satellite-windows li').first()).toBeVisible();
  await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete', { timeout: 55000 });
  await expect(page.locator('#satellite-readings')).toContainText('downlinked 12 / 12');
  await page.locator('#flight-save').click();
  await expect(page.locator('#flight-event')).toContainText('saved');
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.mission-projects.v1')).projects[0].result);
  expect(result).toMatchObject({ status: 'COMPLETED', completed: 6, total: 6 });
  expect(result.downlinkedMB).toBeCloseTo(12);
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
  await expect(page.locator('#satellite-readings')).toContainText('downlinked 12 / 12');
});

test('a weak power system is flagged before launch and explains the missed science goal', async ({ page }) => {
  await openDesigner(page);
  await page.locator('#design-earth-science').click();
  await step(page, 'Орбита');
  await page.locator('[name=durationHours]').fill('1');
  await step(page, 'Нагрузка');
  await page.locator('#design-spacecraft-hardware > summary').click();
  await page.locator('[name=panels]').selectOption('compact');
  await page.locator('[name=battery]').selectOption('trial');
  await page.locator('[name=attitude]').selectOption('precision');
  await page.locator('[name=radio]').selectOption('high');
  await page.locator('[data-instrument=wide]').uncheck();
  await page.locator('[data-instrument=hires]').check();
  await calculate(page);
  const candidates = await page.locator('#design-candidate option').allTextContents();
  const falcon = candidates.findIndex(text => text.includes('Falcon 9 Block 5 / DART'));
  expect(falcon).toBeGreaterThanOrEqual(0);
  await page.locator('#design-candidate').selectOption(String(falcon));
  await expect(page.locator('#design-report')).toContainText('FAIL · Eclipse energy');
  await expect(page.locator('#design-apply')).toBeDisabled();
  await page.locator('.engineering-risk > summary').click();
  await page.locator('#design-risk').check();
  await page.locator('#design-apply').click();
  await page.locator('#flight-start').click();
  await page.locator('#flight-warp').selectOption('500');
  await expect(page.locator('#design-flight-summary')).toHaveText('Objectives unconfirmed', { timeout: 65000 });
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.mission-projects.v1')).projects[0].result);
  expect(result.downlinkedMB).toBe(0);
  expect(result.reason).toContain('дефицит электропитания');
});

test('manual two-stage spacecraft separates, reaches orbit and restores after reload', async ({ page }) => {
  test.setTimeout(180000);
  await openDesigner(page);
  await page.locator('#design-staging-example').click();
  await expect(page.locator('[name=assembly]')).toHaveValue('manual');
  await expect(page.locator('[name=upperThrottlePercent]')).toHaveValue('70');
  await calculate(page);
  await expect(page.locator('#design-report')).toContainText('PASS · Stage isolation');
  await expect(page.locator('#design-report')).toContainText('Stage 2');
  await page.locator('#design-apply').click();
  await page.locator('#flight-start').click();
  await page.locator('#flight-warp').selectOption('500');
  await expect(page.locator('#design-flight-goals')).toContainText('Confirmed · Separate spacecraft', { timeout: 55000 });
  await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete', { timeout: 55000 });
  await page.locator('#flight-save').click();
  await expect(page.locator('#flight-event')).toContainText('saved');
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')).state);
  expect(state.launchPhysics.stages.map(stage => stage.attached)).toEqual([false, true]);
  expect(state.design.execution.events.map(event => event.type)).toEqual(expect.arrayContaining(['stage', 'stageIgnition', 'satelliteDeployed']));
  expect(state.design.satellite.downlinkedMB).toBeCloseTo(12);
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 });
  await page.locator('[data-view=launch]').click();
  await page.locator('#design-resume').click();
  await expect(page.locator('#design-flight-summary')).toHaveText('Objectives complete', { timeout: 30000 });
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
});

test('three projects reopen and compare, and export can be imported without replacing the original', async ({ page }) => {
  await openDesigner(page);
  for (const name of ['Орбита A', 'Орбита B', 'Орбита C']) {
    await page.locator('#design-new').click();
    await page.locator('[name=name]').fill(name);
    await page.locator('#design-save').click();
    await expect(page.locator('#design-status')).toHaveText('Mission saved.');
  }
  await openDesigner(page);
  await expect(page.locator('[name=name]')).toHaveValue('Орбита C');
  await page.locator('#design-library > summary').click();
  await page.locator('#design-project').selectOption({ label: 'Орбита A' });
  await page.locator('#design-project-open').click();
  await expect(page.locator('[name=name]')).toHaveValue('Орбита A');
  await page.getByText('Сравнить 2–4 проекта', { exact: true }).click();
  await page.locator('#design-compare').selectOption(['Орбита A', 'Орбита B', 'Орбита C'].map(label => ({ label })));
  await page.locator('#design-compare-run').click();
  await expect(page.locator('#design-compare-table thead th')).toHaveCount(4);
  const download = page.waitForEvent('download');
  await page.locator('#design-project-export').click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe('Орбита A.jugre.json');
  await page.locator('#design-project-file').setInputFiles(await exported.path());
  await expect(page.locator('#design-status')).toContainText('Project imported');
  await expect(page.locator('#design-project option')).toHaveCount(5);
});
