const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async function smokeTest(window, folder, build) {
  const run = js => window.webContents.executeJavaScript(js, true);
  async function waitFor(js, timeout = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await run(js)) return;
      await delay(200);
    }
    throw new Error(`Timeout waiting for ${js}`);
  }
  fs.mkdirSync(folder, { recursive: true });
  window.setContentSize(1440, 900);
  await waitFor(`document.querySelector('#loading')?.hidden === true`);
  const security = await run(`({ node:typeof process, require:typeof require, title:document.title, canvasCount:document.querySelectorAll('canvas').length })`);
  if (security.node !== 'undefined' || security.require !== 'undefined') throw new Error('Renderer Node isolation failed');
  const persistedSave = await run(`Boolean(JSON.parse(localStorage.getItem('jugre.flight-save.v1'))?.state?.launchPhysics)`);
  if (process.env.JUGRE_SMOKE_EXPECT_SAVE === '1' && !persistedSave) throw new Error('Save was lost between portable app launches');
  await run(`document.querySelector('[data-view="launch"]').click()`);
  await run(`const select = document.querySelector('#launch-rocket'); select.value = 'apollo_11'; select.dispatchEvent(new Event('change', { bubbles:true }));`);
  await waitFor(`document.querySelector('#flight-start')?.disabled === false`);
  await run(`document.querySelector('#flight-start').click()`);
  await waitFor(`document.querySelector('#broadcast-hud')?.hidden === false`);
  await run(`document.querySelector('#flight-hold').click()`);
  await waitFor(`document.querySelector('[data-broadcast="status"]')?.textContent === 'HOLD'`);
  await run(`document.querySelector('#flight-save').click()`);
  const state = await run(`JSON.parse(localStorage.getItem('jugre.flight-save.v1'))`);
  if (!state?.state?.launchPhysics || !state.state.values.holding) throw new Error('Packaged save/physics state failed');
  await run(`document.querySelector('#flight-hold').click(); document.querySelector('#flight-load').click()`);
  await waitFor(`document.querySelector('[data-broadcast="status"]')?.textContent === 'HOLD'`);
  const timer = await run(`document.querySelector('[data-broadcast="clock"]').textContent`);
  fs.writeFileSync(path.join(folder, 'packaged-flight.png'), (await window.webContents.capturePage()).toPNG());
  await run(`document.querySelector('#flight-stop').click()`);
  await waitFor(`document.querySelector('[data-broadcast="status"]')?.textContent === 'LAUNCH ABORTED'`);
  await run(`document.querySelector('#flight-stop').click()`);
  await waitFor(`document.querySelector('#broadcast-hud')?.hidden === true`);
  fs.writeFileSync(path.join(folder, 'packaged-app.png'), (await window.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(folder, 'result.json'), JSON.stringify({ passed:true, packaged:require('electron').app.isPackaged,
    build, security, timer, persistedSave, checks:['offline WebGL scene','sandboxed renderer','launch view','broadcast HUD','HOLD','save','restore','abort','return to launchpad', ...(process.env.JUGRE_SMOKE_EXPECT_SAVE === '1' ? ['save survives application restart'] : [])] }, null, 2));
};
