// Hangar / build / payload / fleet / Kennedy shots.  node shot_hangar.cjs hangar,build,payload,fleet,kennedy
const h = require('./harness.cjs');
const fs = require('fs');
const which = (process.argv[2] || 'hangar,build,payload,fleet,kennedy').split(',');
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

async function setup(view) {
  const env = await h.open();
  const { page } = env;
  await h.enterGame(page);
  await h.cam(page); await h.lock(page);
  await page.evaluate(() => window.__virt.enable());
  if (view) { await page.locator(`[data-view=${view}]`).first().click(); await h.advance(page, 40); }
  return env;
}

const SHOTS = {
  async hangar() {
    const env = await setup('overview'); const { page } = env;
    await h.cinema(page, true, false); await h.advance(page, 10);
    await page.evaluate(() => __cam.orbit(-.5, .05, 1.0)); await h.advance(page, 4);
    await h.record(env, 'clips/hangar', 165, { perFrame: (i, pg) => pg.evaluate(i => __cam.orbit(.0028, -.0006, .9988), i) });
    return env;
  },
  async build() {
    const env = await setup('rocket'); const { page } = env;
    // fresh assembly, then attach the training layout part by part
    await page.evaluate(() => { const d = document.querySelector('#assembly-settings'); if (d && !d.open) d.open = true; });
    await h.jsClick(page, '#assembly-new'); await h.advance(page, 20);
    await h.cinema(page, true, true); await h.advance(page, 10);
    await page.evaluate(() => __cam.orbit(-.35, .06, 1.05)); await h.advance(page, 4);
    const parts = ['b_240_rezerv', 'k_420_kedr', 'p_2512_konus', 'is_125', 'k_155v_dalniy', 'b_32_stvol', 'b_32_stvol', 'pb_1_strizh', 'p_2512_konus', 'go_34_cargo_bay', 'mayak_k'];
    const cats = { b_240_rezerv:'tanks',b_32_stvol:'tanks',k_420_kedr:'propulsion',k_155v_dalniy:'propulsion',p_2512_konus:'structure',is_125:'structure',pb_1_strizh:'command',go_34_cargo_bay:'payload',mayak_k:'vehicles',r_253_triada:'structure',k_125_klen:'propulsion' };
    let k = 0;
    await h.record(env, 'clips/build', 215, { perFrame: async (i, pg) => {
      await pg.evaluate(() => __cam.orbit(.0026, 0, .9994));
      if (i >= 6 && (i - 6) % 16 === 0 && k < parts.length) {
        const part = parts[k++];
        await pg.evaluate(([part, cat]) => { const b = window.vabDebug.builder; b.showCategory(cat); b.choose(part); }, [part, cats[part]]);
      }
      if (i >= 6 && (i - 6) % 16 === 10 && k > 0) {
        const ok = await pg.evaluate(() => { const m = [...document.querySelectorAll('.mount-point')].find(e => !e.hidden); if (m) { m.click(); return true; } return false; });
        if (!ok) console.log('no mount for part', k);
      }
    } });
    console.log('layout', JSON.stringify(await page.evaluate(() => window.vabDebug.builder.getLayout().map(e => e.part))));
    return env;
  },
  async payload() {
    const env = await setup('equipment'); const { page } = env;
    await page.evaluate(() => window.__virt.disable());
    await page.locator('[data-lab-item="instrument:wide"]').click();
    await page.locator('.lab-mount[data-valid=true]:visible').first().click();
    for (const [id, variant, face] of [['battery', 'standard', 'rear'], ['radio', 'low', 'left'], ['computer', 'plus', 'rear'], ['attitude', 'basic', 'top'], ['panels', 'standard', 'right']]) {
      await page.locator('#lab-category').selectOption('systems');
      await page.locator('[data-lab-item="system:' + id + ':' + variant + '"]').click();
      await page.locator('#lab-face').selectOption(face);
      await page.locator('.lab-mount[data-valid=true]:visible').first().click();
    }
    await page.locator('#lab-category').selectOption('instruments').catch(() => {});
    console.log('installed', await page.locator('#lab-installed button').count());
    await page.evaluate(() => window.__virt.enable());
    await h.cinema(page, true, false); await h.advance(page, 10);
    await page.evaluate(() => __cam.orbit(.9, .12, .82)); await h.advance(page, 6);
    await h.record(env, 'clips/payload', 210, { perFrame: async (i, pg) => {
      await pg.evaluate(() => __cam.orbit(-.0032, -.0004, .9993));
      if (i === 24) await h.jsClick(pg, '#vab-equipment-test');
    } });
    return env;
  },
  async fleet() {
    const env = await setup('ready'); const { page } = env;
    const n = await page.evaluate(() => document.querySelectorAll('#ready-list button').length);
    console.log('fleet buttons', n);
    await h.cinema(page, true, false);
    for (const idx of [0, 1, 2, 4, 5]) {
      await page.evaluate(i => document.querySelectorAll('#ready-list button')[i].click(), idx);
      await h.advance(page, 45);
      const H = await page.evaluate(() => window.vabDebug.bounds.max.y);
      const az = [0.55, -0.4, 0.75, -0.6, 0.35][[0, 1, 2, 4, 5].indexOf(idx)];
      const R = Math.max(H * 0.42, 14);
      await h.setLock(page, null);
      await h.record(env, `clips/fleet_${idx}`, 42, { perFrame: (i, pg) => {
        const p = ease(i / 41);
        const ang = az + p * .18;
        return h.setLock(pg, { p: [Math.sin(ang) * R, lerp(H * .06, H * .42, p), Math.cos(ang) * R], look: [0, lerp(H * .32, H * .78, p), 0], fov: 50 });
      } });
    }
    return env;
  },
  async kennedy() {
    const env = await setup(null); const { page } = env;
    await page.evaluate(() => window.__virt.disable());
    await page.locator('[data-view=launch]').first().click();
    await page.waitForTimeout(1500);
    await page.locator('#launch-rocket').selectOption('apollo_11');
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__virt.enable());
    await h.advance(page, 30);
    await h.cinema(page, true, false); await h.advance(page, 10);
    await h.record(env, 'clips/kennedy', 165, { perFrame: (i, pg) => {
      const p = ease(i / 164);
      const ang = lerp(-.95, -.55, p), R = lerp(980, 560, p);
      return h.setLock(pg, { p: [Math.sin(ang) * R, lerp(520, 190, p), Math.cos(ang) * R], look: [0, lerp(30, 55, p), 0], fov: 32 });
    } });
    await h.record(env, 'clips/kennedy_top', 120, { perFrame: (i, pg) => {
      const p = i / 119;
      return h.setLock(pg, { p: [lerp(-60, 60, p), 1400, lerp(250, 200, p)], look: [lerp(-60, 60, p) * .5, 0, -150], fov: 40 });
    } });
    return env;
  },
};

(async () => {
  for (const name of which) {
    const t0 = Date.now();
    try { const env = await SHOTS[name](); await env.browser.close(); }
    catch (e) { console.log('ERR', name, e.message.slice(0, 300)); }
    finally { await h.closeAll(); }
    console.log('done', name, ((Date.now() - t0) / 1000).toFixed(0), 's');
  }
})();
