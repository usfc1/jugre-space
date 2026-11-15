const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { _electron: electron } = require('../assembly_hangar/source/node_modules/playwright');

async function main() {
  const report = path.resolve(__dirname, '..', 'release', 'menu-verification', String(Date.now()));
  fs.mkdirSync(report, { recursive: true });
  const executablePath = process.env.JUGRE_ELECTRON_EXE || path.join(__dirname, '.cache', 'physx-runtime', 'electron.exe');
  if (!fs.existsSync(executablePath)) throw new Error('Set JUGRE_ELECTRON_EXE to the installed Electron executable.');
  const args = process.env.JUGRE_PACKAGED_TEST ? ['--menu-test'] : [path.join(__dirname, 'main.cjs'), '--menu-test'];
  const app = await electron.launch({ executablePath, args,
    env: { ...process.env, JUGRE_SMOKE_REPORT_DIR: report } });
  const child = app.process();
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelector('#loading')?.hidden && !document.querySelector('[data-menu-action="exit"]')?.disabled, null, { timeout: 120000 });
    const state = await page.evaluate(() => ({ menu: !document.querySelector('#main-menu').hidden,
      bridge: typeof window.jugreDesktop?.exit, node: typeof process, require: typeof require }));
    assert.deepEqual(state, { menu: true, bridge: 'function', node: 'undefined', require: 'undefined' });
    const closed = new Promise(resolve => child.once('exit', resolve));
    await page.evaluate(() => document.querySelector('[data-menu-action="exit"]').click());
    let timeout;
    try { await Promise.race([closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Exit did not close Electron')), 15000); })]); }
    finally { clearTimeout(timeout); }
    console.log('PASS: Electron opens the startup menu, keeps Node isolated and exits from the menu.');
  } finally { if (child.exitCode === null && child.signalCode === null) await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
