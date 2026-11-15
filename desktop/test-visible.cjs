const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
// Reuse the browser test tools installed by the game's existing test suite.
const { chromium } = require('../assembly_hangar/source/node_modules/playwright');
const pkg = require('./package.json');
const folder = path.resolve(__dirname, '..', 'release', 'verification');
const executable = path.resolve(folder, '..', `JUGRE-Space-Project-${pkg.version}-win-x64.exe`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  fs.mkdirSync(folder, { recursive:true });
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { env, windowsHide:true, stdio:'ignore' });
  const exited = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  const timeout = setTimeout(() => {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
  }, 180000);
  let browser;
  try {
    let available = false;
    for (let i = 0; i < 180; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { available=true; break; } } catch { /* Wait for portable extraction. */ }
      await delay(500);
    }
    assert(available, 'Portable app did not start its browser');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith('jugre:')) || browser.contexts()[0].pages()[0];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#viewport', { state:'attached', timeout:90000 });
    await page.waitForSelector('#loading', { state:'hidden', timeout:90000 });
    await page.click('[data-view=launch]');
    await page.selectOption('#launch-rocket', 'apollo_11');
    await page.locator('#flight-start').waitFor({ state:'visible' });
    await page.click('#flight-start');
    await page.locator('#broadcast-hud').waitFor({ state:'visible' });
    await page.click('#flight-hold');
    await page.waitForFunction(() => document.querySelector('[data-broadcast=status]').textContent === 'HOLD');
    await delay(1000);
    const held = await page.locator('[data-broadcast=clock]').textContent();
    const render = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      const canvas = document.querySelector('#viewport > canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl || gl.isContextLost()) { resolve({ colors:0 }); return; }
      const width=gl.drawingBufferWidth, height=gl.drawingBufferHeight;
      const pixels = new Uint8Array(width*height*4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const colors = new Set();
      for (let y=0; y<height; y+=Math.max(1, Math.floor(height/64))) {
        for (let x=0; x<width; x+=Math.max(1, Math.floor(width/64))) {
          const i=(y*width+x)*4;
          colors.add((pixels[i]>>3)*1024+(pixels[i+1]>>3)*32+(pixels[i+2]>>3));
        }
      }
      resolve({ colors:colors.size, width, height, visible:document.visibilityState });
    })));
    await page.screenshot({ path:path.join(folder, 'visible-flight.png') });
    assert(render.colors > 12, `3D canvas did not render: ${JSON.stringify(render)}`);
    assert.equal(render.visible, 'visible');
    assert.equal(await page.locator('[data-broadcast=clock]').textContent(), held);
    await page.click('#flight-save');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jugre.flight-save.v1')));
    assert(saved.state.values.holding && saved.state.launchPhysics);
    await page.click('#flight-hold');
    await page.click('#flight-load');
    await page.waitForFunction(() => document.querySelector('[data-broadcast=status]').textContent === 'HOLD');
    await delay(500);
    assert.equal(await page.locator('[data-broadcast=clock]').textContent(), held);
    await page.screenshot({ path:path.join(folder, 'visible-flight.png') });
    await page.click('#flight-stop');
    await page.waitForFunction(() => document.querySelector('[data-broadcast=status]').textContent === 'LAUNCH ABORTED');
    await page.click('#flight-stop');
    await page.locator('#broadcast-hud').waitFor({ state:'hidden' });
    assert.deepEqual(errors, []);
    const result = { passed:true, normalPortableLaunch:true, render, errors, checks:['visible WebGL geometry','HOLD stops the rendered clock','physics save/restore','abort','return to pad'] };
    fs.writeFileSync(path.join(folder,'visible-result.json'), JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally {
    if (browser) {
      try { const cdp = await browser.newBrowserCDPSession(); await cdp.send('Browser.close'); } catch { /* The app may already be closed. */ }
    }
    else child.kill();
    await exited;
    clearTimeout(timeout);
  }
})().catch(error => { console.error(error); process.exitCode=1; });
