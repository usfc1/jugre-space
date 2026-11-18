// Multi-camera Saturn V launch take at dusk.
// One simulation run; each frame is rendered from every camera whose window covers it.
const h = require('./harness.cjs');
const fs = require('fs');
const OUT = 'clips';
const FPS = 30;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
// windows in game seconds relative to T0; each cam returns a lock for progress p in [0,1]
const CAMS = {
  far:     { w: [-10.4, -6.4], lock: p => ({ p: lerp3([760, 34, 470], [700, 34, 430], ease(p)), look: [0, 52, 0], fov: lerp(15, 12.5, ease(p)) }) },
  tower:   { w: [-7.2, -3.2],  lock: p => ({ p: lerp3([-46, 22, 64], [-38, 36, 60], ease(p)), look: lerp3([0, 58, 0], [0, 74, 0], ease(p)), fov: 36 }) },
  low:     { w: [-4.6, -1.0],  lock: p => ({ p: lerp3([150, 3, 70], [135, 3, 85], p), look: [0, 58, 0], fov: 30 }) },
  engines: { w: [-2.6, 7.0],   lock: p => ({ p: lerp3([30, 7, 24], [27, 9, 27], p), look: lerp3([0, 15, 0], [0, 19, 0], p), fov: 42 }) },
  deck:    { w: [-1.0, 6.5],   lock: p => ({ p: lerp3([-22, 26, -30], [-20, 30, -26], p), look: [0, 17, 0], fov: 46 }) },
  engines2: { w: [2.0, 5.0], lock: p => CAMS.engines.lock(((2.0 + p * 3.0) + 2.6) / 9.6) },
  lowlift: { w: [8.5, 11.0],   lock: p => ({ p: [150, 3, 70], look: 'target', fov: lerp(30, 26, p) }) },
  track:   { w: [7.5, 12.5],   lock: p => ({ p: lerp3([620, 30, -380], [600, 30, -400], p), look: 'target', fov: lerp(13, 11, p) }) },
};
const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(CAMS);
(async () => {
  const env = await h.open();
  const { page, cdp } = env;
  await h.enterGame(page);
  await h.launchVirtual(page, 'apollo_11', { dusk: true });
  await h.cinema(page, true, false);
  await h.lock(page);
  // sync to the moment the countdown first shows T − 10
  const b = await h.stepUntilFast(page, 'T\\s*−\\s*10', { stepMs: 10, batch: 1 });
  let g = -10.0;
  console.log('synced at', b);
  const start = Math.min(...only.map(k => CAMS[k].w[0]));
  const end = Math.max(...only.map(k => CAMS[k].w[1]));
  if (start > g) { const n = Math.round((start - g) * 100); await h.fastSteps(page, n, 10); g = start; }
  const counters = {};
  for (const k of only) { fs.mkdirSync(`${OUT}/launch_${k}`, { recursive: true }); counters[k] = 0; }
  const t0 = Date.now(); let frame = 0;
  while (g <= end) {
    // advance one frame of simulation (render happens with whatever lock is set; harmless)
    await h.fastSteps(page, 1, 1000 / FPS);
    g += 1 / FPS; frame++;
    for (const k of only) {
      const c = CAMS[k];
      if (g < c.w[0] || g > c.w[1]) continue;
      const p = (g - c.w[0]) / (c.w[1] - c.w[0]);
      await h.setLock(page, c.lock(p));
      await page.evaluate(() => window.__virt.step(0));
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
      fs.writeFileSync(`${OUT}/launch_${k}/f${String(counters[k]++).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'));
    }
    if (frame % 30 === 0) {
      const st = await page.evaluate(() => document.querySelector('#flight-banner')?.textContent);
      console.log(`g=${g.toFixed(2)} ${st} ${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(counters));
    }
  }
  for (const k of only) fs.writeFileSync(`${OUT}/launch_${k}/meta.json`, JSON.stringify({ frames: counters[k], fps: FPS, g0: CAMS[k].w[0] }));
  await env.browser.close();
})();
