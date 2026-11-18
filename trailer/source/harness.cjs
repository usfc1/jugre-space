// Capture harness for the JUGRE trailer.
// Virtual time: once enabled, requestAnimationFrame callbacks are queued and
// performance.now() is frozen; each step() advances the clock by exactly one
// video frame so footage is perfectly smooth no matter how slow SwiftShader is.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VIRT = `(() => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const state = { on: false, t: 0, queue: new Map(), id: 1e9 };
  window.__virt = state;
  performance.now = () => state.on ? state.t : realNow();
  window.requestAnimationFrame = (cb) => {
    if (!state.on) return realRaf(cb);
    const id = ++state.id; state.queue.set(id, cb); return id;
  };
  window.cancelAnimationFrame = (id) => { if (state.queue.has(id)) state.queue.delete(id); else realCancel(id); };
  state.enable = () => { if (state.on) return; state.t = realNow(); state.on = true; };
  state.disable = () => {
    state.on = false;
    const q = [...state.queue.values()]; state.queue.clear();
    for (const cb of q) realRaf(cb);
  };
  state.step = (ms) => {
    state.t += ms;
    const q = [...state.queue.values()]; state.queue.clear();
    for (const cb of q) { try { cb(state.t); } catch (e) { console.error('raf', e); } }
    return q.length;
  };
})();`;

const CINEMA_CSS = `
  body.cinema .shell > header, body.cinema #design-open, body.cinema aside,
  body.cinema #feedback, body.cinema .shell > footer, body.cinema .hint, body.cinema #activity,
  body.cinema #flight-scene-tools, body.cinema #flight-notices,
  body.cinema #assembly-hud, body.cinema #vab-cameras, body.cinema #vab-altitude,
  body.cinema #location-tag, body.cinema #current-view, body.cinema #kennedy-labels,
  body.cinema #pause, body.cinema #audio-settings, body.cinema #open-main-menu, body.cinema #vab-equipment-panel,
  body.cinema #edit-brand, body.cinema .scene-actions, body.cinema #assembly-workflow { display: none !important; }
  body.cinema #viewport { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
    border: 0 !important; border-radius: 0 !important; margin: 0 !important; z-index: 50 !important; }
  body.cinema.nohud #broadcast-hud, body.cinema.nohud #flight-banner, body.cinema.nohud #flight-event,
  body.cinema.nohud #radio-subtitle, body.cinema.nohud #cockpit-hud, body.cinema.nohud #flight-hold,
  body.cinema.nohud #timeline-live, body.cinema.nohud #mount-points, body.cinema.nohud .label { display: none !important; }
`;

const OPEN = [];
async function closeAll() { while (OPEN.length) await OPEN.pop().close().catch(() => {}); }
async function open({ width = 1920, height = 1080, url = 'http://127.0.0.1:4179/index.html?vabDebug', initScripts = [] } = {}) {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  OPEN.push(browser);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addInitScript(VIRT);
  for (const s of initScripts) await context.addInitScript(s.fn, s.arg);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERR', e.message.slice(0, 300)); });
  await page.goto(url, { timeout: 300000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 });
  await page.addStyleTag({ content: CINEMA_CSS });
  const cdp = await context.newCDPSession(page);
  return { browser, context, page, cdp, errors };
}

async function enterGame(page, action = 'assembly') {
  await page.locator(`[data-menu-action="${action}"]`).click();
  await page.waitForTimeout(800);
}

async function cinema(page, on = true, hud = true) {
  await page.evaluate(([on, hud]) => {
    document.body.classList.toggle('cinema', on);
    document.body.classList.toggle('nohud', on && !hud);
    window.dispatchEvent(new Event('resize'));
  }, [on, hud]);
  await page.waitForTimeout(400);
}

// Record `frames` frames at `fps` into dir. `perFrame(i, page)` may move the mouse etc.
async function record(env, dir, frames, { fps = 30, perFrame, substeps = 1, clip, quality = 92, release = false } = {}) {
  const { page, cdp } = env;
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => window.__virt.enable());
  const dt = 1000 / fps / substeps;
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    if (perFrame) await perFrame(i, page);
    for (let s = 0; s < substeps; s++) await page.evaluate(ms => window.__virt.step(ms), dt);
    const params = { format: 'jpeg', quality, captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const { data } = await cdp.send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (i % 60 === 0) console.log(`${path.basename(dir)} ${i}/${frames} ${((Date.now() - t0) / (i + 1)).toFixed(0)}ms/f`);
  }
  if (release) await page.evaluate(() => window.__virt.disable());
}

// Advance virtual time without capturing (e.g. to settle a camera).
async function advance(page, frames, fps = 30) {
  await page.evaluate(([n, ms]) => { const was = window.__virt.on; if (!was) window.__virt.enable(); for (let i = 0; i < n; i++) window.__virt.step(ms); if (!was) window.__virt.disable(); }, [frames, 1000 / fps]);
}

async function still(page, file) { await page.screenshot({ path: file }); }

module.exports = { open, enterGame, cinema, record, advance, still };

async function jsClick(page, sel) { await page.evaluate(s => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); e.click(); }, sel); }

async function startMission(page, id, { length } = {}) {
  await page.locator('[data-view=launch]').first().click();
  await page.waitForTimeout(800);
  await page.locator('#launch-rocket').selectOption(id);
  if (length) await page.locator('#launch-flight-length').selectOption(length).catch(() => {});
  await page.waitForTimeout(1200);
  await page.locator('#flight-start').click();
  await page.waitForSelector('#broadcast-hud', { state: 'visible', timeout: 120000 });
  await page.waitForTimeout(1000);
}

async function loadCkpt(page, file, { unpause = true } = {}) {
  const save = JSON.parse(fs.readFileSync(file, 'utf8'));
  await page.evaluate(s => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(s)), save);
  await jsClick(page, '#flight-load');
  await page.waitForFunction(() => /восстановлены|restored/i.test(document.querySelector('#flight-event')?.textContent || ''), null, { timeout: 120000 }).catch(e => console.log('restore wait', e.message.slice(0, 80)));
  await page.waitForTimeout(800);
  if (unpause) {
    const paused = await page.locator('#flight-pause').getAttribute('aria-pressed');
    if (paused === 'true') await jsClick(page, '#flight-pause');
  }
}

// Fast-forward simulated time in virtual mode with coarse steps.
async function ff(page, seconds, stepMs = 200) {
  await page.evaluate(([s, ms]) => { const was = window.__virt.on; if (!was) window.__virt.enable(); const n = Math.ceil(s * 1000 / ms); for (let i = 0; i < n; i++) window.__virt.step(ms); if (!was) window.__virt.disable(); }, [seconds, stepMs]);
}

async function camera(page, mode) { await jsClick(page, `[data-flight-camera="${mode}"]`); await page.waitForTimeout(300); }

async function status(page) {
  return page.evaluate(() => ({ banner: document.querySelector('#flight-banner')?.textContent.trim().slice(0, 60), event: document.querySelector('#flight-event')?.textContent.trim().slice(0, 80), paused: document.querySelector('#flight-pause')?.getAttribute('aria-pressed') }));
}

Object.assign(module.exports, { jsClick, startMission, loadCkpt, ff, camera, status });

// Open the game with a flight checkpoint pre-seeded, then resume via main menu "Continue".
async function openCkpt(file, { unpause = true, opts = {} } = {}) {
  const save = JSON.parse(fs.readFileSync(file, 'utf8'));
  const env = await open({ ...opts, initScripts: [{ fn: s => { try { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('jugre.flight-save.v1', JSON.stringify(s)); sessionStorage.setItem('__seeded', '1'); } } catch {} }, arg: save }] });
  const { page } = env;
  try { await page.waitForFunction(() => { const b = document.querySelector('[data-menu-action="continue"]'); return b && !b.disabled; }, null, { timeout: 240000 }); }
  catch (e) { console.log('continue disabled:', await page.evaluate(() => document.querySelector('#menu-save-status')?.textContent)); throw e; }
  await page.locator('[data-menu-action="continue"]').click({ timeout: 60000 });
  await page.waitForSelector('#broadcast-hud', { state: 'visible', timeout: 300000 });
  await page.waitForTimeout(1500);
  if (unpause) {
    const paused = await page.locator('#flight-pause').getAttribute('aria-pressed');
    if (paused === 'true') await jsClick(page, '#flight-pause');
  }
  return env;
}
module.exports.openCkpt = openCkpt;

const CAM = `window.__cam = (() => {
  const { camera, controls } = window.vabDebug;
  return {
    get() { return { p: camera.position.toArray().map(v => +v.toFixed(3)), t: controls.target.toArray().map(v => +v.toFixed(3)), up: camera.up.toArray(), fov: camera.fov }; },
    orbit(az = 0, el = 0, zoom = 1) {
      const up = camera.up.clone().normalize();
      const off = camera.position.clone().sub(controls.target);
      if (az) off.applyAxisAngle(up, az);
      if (el) { const right = off.clone().cross(up).normalize(); const n = off.clone().applyAxisAngle(right, el); const a = n.angleTo(up); if (a > .03 && a < Math.PI - .03) off.copy(n); }
      off.multiplyScalar(zoom);
      camera.position.copy(controls.target).add(off);
      camera.lookAt(controls.target);
    },
    // spherical placement around current target: az (rad), el (rad above horizon), dist
    place(az, el, dist) {
      const up = camera.up.clone().normalize();
      const off = camera.position.clone().sub(controls.target);
      const ref = off.clone().projectOnPlane(up).normalize();
      if (ref.lengthSq() < 1e-6) ref.set(1, 0, 0);
      const side = ref.clone().cross(up).normalize();
      const dir = ref.clone().multiplyScalar(Math.cos(az)).add(side.multiplyScalar(Math.sin(az))).multiplyScalar(Math.cos(el)).add(up.multiplyScalar(Math.sin(el)));
      camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
      camera.lookAt(controls.target);
    },
    set(p, t) { if (t) controls.target.set(...t); camera.position.set(...p); camera.lookAt(controls.target); },
    dist() { return camera.position.distanceTo(controls.target); },
  };
})();`;
async function cam(page) { await page.evaluate(CAM); }
module.exports.cam = cam;

// Camera lock: before every render, place the camera at __lock.p (world, scene units)
// and aim it at __lock.look (array) or at the live orbit target ('target').
const LOCK = `(() => {
  if (window.__lockInstalled) return; window.__lockInstalled = true;
  const { camera, controls, flight, renderer } = window.vabDebug;
  window.__lock = null;
  const apply = () => {
    const L = window.__lock; if (!L) return;
    if (L.p) camera.position.set(...L.p);
    if (L.rel) camera.position.copy(controls.target).add(camera.position.clone().set(...L.rel));
    const look = L.look === 'target' || !L.look ? controls.target : camera.position.clone().set(...L.look);
    if (L.lookOffset) look.add(camera.position.clone().set(...L.lookOffset));
    camera.lookAt(look);
    if (L.roll) camera.rotateZ(L.roll);
    if (L.fov && camera.fov !== L.fov) { window.__baseFov ??= camera.fov; camera.fov = L.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  };
  window.__applyLock = apply;
  const fr = flight.render.bind(flight);
  flight.render = (r) => { apply(); return fr(r); };
  const rr = renderer.render.bind(renderer);
  renderer.render = (s, c) => { if (window.__norender) return; if (c === camera && !flight.active) apply(); return rr(s, c); };
})();`;
async function lock(page) { await page.evaluate(LOCK); }
async function setLock(page, L) { await page.evaluate(L => { window.__lock = L; if (!L && window.__baseFov) { const c = window.vabDebug.camera; c.fov = window.__baseFov; c.updateProjectionMatrix(); window.__baseFov = undefined; } }, L); }

async function stepUntil(page, re, { stepMs = 100, max = 3000 } = {}) {
  for (let i = 0; i < max; i++) {
    const txt = await page.evaluate(([ms]) => { if (!window.__virt.on) window.__virt.enable(); window.__virt.step(ms); return (document.querySelector('#flight-banner')?.textContent || '') + ' | ' + (document.querySelector('#flight-status')?.textContent || ''); }, [stepMs]);
    if (new RegExp(re).test(txt)) return txt;
  }
  throw new Error('stepUntil timeout ' + re);
}
Object.assign(module.exports, { lock, setLock, stepUntil });

// Select a rocket on the pad and press Launch with virtual time already running.
async function launchVirtual(page, id, { dusk = false, length } = {}) {
  await page.locator('[data-view=launch]').first().click();
  await page.waitForTimeout(800);
  await page.locator('#launch-rocket').selectOption(id);
  if (length) await page.locator('#launch-flight-length').selectOption(length).catch(() => {});
  await page.waitForTimeout(1500);
  if (dusk) { await jsClick(page, '#launch-evening'); await page.waitForTimeout(1000); }
  await page.evaluate(() => window.__virt.enable());
  await jsClick(page, '#flight-start');
  for (let i = 0; i < 2000; i++) {
    const ok = await page.evaluate(() => { window.__virt.step(20); const hud = document.querySelector('#broadcast-hud'); return hud && !hud.hidden && getComputedStyle(hud).display !== 'none'; });
    if (ok) return i;
    if (i % 50 === 49) await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('flight did not start');
}
module.exports.launchVirtual = launchVirtual;

async function fastSteps(page, n, ms) {
  await page.evaluate(([n, ms]) => { window.__norender = true; try { for (let i = 0; i < n; i++) window.__virt.step(ms); } finally { window.__norender = false; } }, [n, ms]);
}
async function stepUntilFast(page, re, { stepMs = 10, max = 20000, batch = 10 } = {}) {
  for (let i = 0; i < max; i += batch) {
    const txt = await page.evaluate(([ms, batch, src]) => { window.__norender = true; const r = new RegExp(src); let t = '';
      try { for (let k = 0; k < batch; k++) { window.__virt.step(ms); t = (document.querySelector('#flight-banner')?.textContent || '') + ' | ' + (document.querySelector('#flight-status')?.textContent || ''); if (r.test(t)) return t; } } finally { window.__norender = false; } return null; }, [stepMs, batch, re]);
    if (txt) return txt;
  }
  throw new Error('stepUntilFast timeout ' + re);
}
module.exports.fastSteps = fastSteps; module.exports.stepUntilFast = stepUntilFast;

module.exports.closeAll = closeAll;
