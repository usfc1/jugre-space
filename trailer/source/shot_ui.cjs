// Mission Planner UI shots (full UI, no cinema mode).
const h = require('./harness.cjs');
const which = (process.argv[2] || 'planner,si').split(',');
// Same stub the game's own Playwright test uses for the SI service (no network call).
const SI_STUB = { fn: () => {
  window.jugreDesktop = { si: { signIn: async () => {}, propose: async () => ({
    status: 'ready', message: 'This proposal needs engineering checks.', assumptions: [],
    mission: { name: 'Lunar science', destination: 'moon', goal: 'expedition', crewCount: 4, payloadMassKg: 232, returnRequired: true },
  }) } };
} };
const SHOTS = {
  async planner() {
    const env = await h.open(); const { page } = env;
    await h.enterGame(page);
    await page.locator('#design-open').click();
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__virt.enable());
    await h.advance(page, 10);
    const seq = ['moon', 'mars', 'jupiter', 'saturn', 'neptune'];
    let k = 0;
    await h.record(env, 'clips/planner', 140, { perFrame: async (i, pg) => {
      if (i % 24 === 8 && k < seq.length) {
        const id = seq[k++];
        await pg.evaluate(id => { const b = [...document.querySelectorAll('#mission-designer button')].find(b => b.textContent.trim().startsWith('✓' + id[0].toUpperCase() + id.slice(1)) || b.dataset.destination === id); b?.scrollIntoView({ block: 'nearest' }); b?.click(); }, id);
      }
    } });
    return env;
  },
  async si() {
    const env = await h.open({ initScripts: [SI_STUB] }); const { page } = env;
    await h.enterGame(page);
    await page.locator('#design-open').click();
    await page.waitForTimeout(1200);
    await page.locator('[data-designer-mode=si]').click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__virt.enable());
    await h.advance(page, 5);
    const text = 'Send four astronauts to the Moon with 232 kg of cargo and return them.';
    let n = 0, submitted = false, reviewed = false;
    await h.record(env, 'clips/si', 190, { perFrame: async (i, pg) => {
      if (i >= 4 && n < text.length) {
        n = Math.min(text.length, n + 2);
        await pg.evaluate(v => { const el = document.querySelector('#si-prompt'); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, text.slice(0, n));
      }
      if (n >= text.length && !submitted && i > 46) { submitted = true; await pg.evaluate(() => document.querySelector('#si-submit').click()); }
      if (submitted && !reviewed && i > 120) {
        const ok = await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /Review in Engineering/.test(b.textContent)); if (b) { b.click(); return true; } return false; });
        if (ok) reviewed = true;
      }
    } });
    return env;
  },
};
(async () => {
  for (const name of which) {
    const t0 = Date.now();
    try { const env = await SHOTS[name](); await env.browser.close(); } catch (e) { console.log('ERR', name, e.message.slice(0, 300)); } finally { await h.closeAll(); }
    console.log('done', name, ((Date.now() - t0) / 1000).toFixed(0), 's');
  }
})();
