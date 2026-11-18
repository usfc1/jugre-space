// Flight shots. node shot_flight.cjs ascent,moon,lm,...
const h = require('./harness.cjs');
const which = process.argv[2].split(',');
const orbitPF = (az, el = 0, z = 1) => (i, pg) => pg.evaluate(([a, e, z]) => __cam.orbit(a, e, z), [az, el, z]);

async function fromCkpt(file, { cam = 'ship', hud = false, settle = 20, prep } = {}) {
  const env = await h.openCkpt(`ckpt/${file}.json`, { unpause: false });
  const { page } = env;
  await page.evaluate(() => window.__virt.enable());
  await h.cam(page); await h.lock(page);
  await h.cinema(page, true, hud);
  // unpause in virtual time
  const paused = await page.locator('#flight-pause').getAttribute('aria-pressed');
  if (paused === 'true') await h.jsClick(page, '#flight-pause');
  if (cam !== 'ship') { await h.jsClick(page, `[data-flight-camera="${cam}"]`); }
  await h.advance(page, settle);
  if (prep) await prep(page);
  return env;
}
const radio = page => page.evaluate(() => [document.querySelector('#flight-banner')?.textContent, document.querySelector('#flight-event')?.textContent, document.querySelector('#radio-text')?.textContent].join(' | '));

const SHOTS = {
  // Day launch: ascent with broadcast HUD, staging, orbit, Earth opener.
  async ascent() {
    const env = await h.open(); const { page } = env;
    await h.enterGame(page);
    await h.launchVirtual(page, 'apollo_11');
    await h.cam(page); await h.lock(page);
    await h.stepUntilFast(page, 'Liftoff', { stepMs: 50, batch: 20 });
    await h.fastSteps(page, 38 * 20, 50);
    await h.cinema(page, true, true); await h.advance(page, 3);
    await page.evaluate(() => __cam.orbit(.25, .02, .9)); await h.advance(page, 3);
    await h.record(env, 'clips/ascent_hud', 150, { perFrame: orbitPF(.0012, 0, .9995) });
    // staging: run until the separation is reported, then film the S-IC falling away
    await h.cinema(page, true, false);
    for (let i = 0; i < 400; i++) {
      await h.fastSteps(page, 10, 50);
      const r = await radio(page);
      if (/separation/i.test(r)) { console.log('sep at', r); break; }
    }
    await page.evaluate(() => __cam.orbit(1.1, .12, .75)); await h.advance(page, 2);
    await h.record(env, 'clips/staging', 180, { perFrame: orbitPF(.0018, 0, .9992) });
    // orbit insertion
    for (let i = 0; i < 2000; i++) {
      await h.fastSteps(page, 20, 50);
      const r = await radio(page);
      if (/Earth orbit|orbit/i.test(r) && !/Launch/.test(r.split('|')[0])) { console.log('orbit at', r); break; }
    }
    await page.evaluate(() => __cam.orbit(-.6, .25, 1.2)); await h.advance(page, 2);
    await h.record(env, 'clips/orbit', 165, { perFrame: orbitPF(.0016, 0, .9995) });
    await h.jsClick(page, '[data-flight-camera="earth"]'); await h.advance(page, 20);
    await h.record(env, 'clips/earth', 240, { perFrame: orbitPF(.0011, .0002, .9994) });
    return env;
  },
  async moon() { const env = await fromCkpt('apollo_11-moonOrbit-short', { cam: 'moon' }); await h.record(env, 'clips/moon', 130, { perFrame: orbitPF(.0016, 0, .9992) }); return env; },
  async moonship() { const env = await fromCkpt('apollo_11-moonOrbit-short', { prep: p => p.evaluate(() => __cam.orbit(2.2, .3, 1.0)) }); await h.record(env, 'clips/moonship', 120, { perFrame: orbitPF(.002) }); return env; },
  async lm() { const env = await fromCkpt('lm_600m', { settle: 10 }); await h.record(env, 'clips/lm', 210, { perFrame: orbitPF(.0015) }); return env; },
  async eva() { const env = await fromCkpt('apollo_11-moonSurface-short', { prep: p => p.evaluate(() => __cam.orbit(-.3, -.05, .8)) }); await h.record(env, 'clips/eva', 150, { perFrame: orbitPF(.0022, 0, .9993) }); return env; },
  async lmascent() { const env = await fromCkpt('apollo_11-rendezvous-short', { settle: 5 }); await h.record(env, 'clips/lmascent', 120, { perFrame: orbitPF(.002) }); return env; },
  async cabin() { const env = await fromCkpt('artemis_ii-lunarFlyby-short', { cam: 'cabin', settle: 30 }); await h.record(env, 'clips/cabin', 130); return env; },
  async orion() { const env = await fromCkpt('artemis_ii-lunarFlyby-short', { prep: p => p.evaluate(() => __cam.orbit(.8, .1, .9)) }); await h.record(env, 'clips/orion', 120, { perFrame: orbitPF(.0025) }); return env; },
  async edl() { const env = await fromCkpt('mars_science_laboratory-marsLanding-short', { prep: p => p.evaluate(() => __cam.orbit(.4, .05, 1.0)) }); await h.record(env, 'clips/edl', 120, { perFrame: orbitPF(.002) }); return env; },
  async marslow() { const env = await fromCkpt('mars_6km', { settle: 10 }); await h.record(env, 'clips/marslow', 150, { perFrame: orbitPF(.002) }); return env; },
  async rover() { const env = await fromCkpt('mars_2020-marsSurface-short', { prep: p => p.evaluate(() => __cam.orbit(-.5, .02, .85)) }); await h.record(env, 'clips/rover', 150, { perFrame: orbitPF(.0025, 0, .9993) }); return env; },
  async dart() { const env = await fromCkpt('dart-dartApproach-short', { settle: 2 }); await h.record(env, 'clips/dart', 420); return env; },
  async draco() { const env = await fromCkpt('dart-dartApproach-short', { cam: 'cabin', settle: 2 }); await h.record(env, 'clips/draco', 230); return env; },
  async iss() { const env = await fromCkpt('iss_resupply-docking-short', { prep: p => p.evaluate(() => __cam.orbit(.9, .2, 1.6)) }); await h.record(env, 'clips/iss', 180, { perFrame: orbitPF(.0018) }); return env; },
  async reentry() { const env = await fromCkpt('apollo_11-reentry-short', { prep: p => p.evaluate(() => __cam.orbit(.5, .05, .9)) }); await h.record(env, 'clips/reentry', 120, { perFrame: orbitPF(.002) }); return env; },
  async splash() { const env = await fromCkpt('reentry_900', { settle: 5 }); await h.record(env, 'clips/splash', 150, { perFrame: orbitPF(.0018) }); return env; },
  async splash8() { const env = await fromCkpt('reentry_800', { settle: 5 }); await h.record(env, 'clips/splash8', 120, { perFrame: orbitPF(.0018) }); return env; },
};

(async () => {
  for (const name of which) {
    const t0 = Date.now();
    try { const env = await SHOTS[name](); console.log(name, 'status', await radio(env.page)); await env.browser.close(); }
    catch (e) { console.log('ERR', name, e.message.slice(0, 300)); }
    finally { await h.closeAll(); }
    console.log('done', name, ((Date.now() - t0) / 1000).toFixed(0), 's');
  }
})();
