// Render the edit: node render.cjs edit.js outDir [from] [to] [step]
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const [editFile, outDir, from = '0', to = '1e9', every = '1'] = process.argv.slice(2);
  const edit = require(path.resolve(editFile));
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto('http://127.0.0.1:4190/comp/comp.html');
  await page.evaluate(`document.fonts.ready`);
  // functions inside the edit (shake/blur) are serialized as source
  const src = 'window.setEdit(' + require('util').inspect(edit, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity }) + ')';
  await page.evaluate(src);
  const cdp = await page.context().newCDPSession(page);
  const total = Math.round(edit.duration * edit.fps);
  const f0 = Math.max(0, Math.round(+from * edit.fps)), f1 = Math.min(total, Math.round(+to * edit.fps));
  const t0 = Date.now();
  for (let f = f0; f < f1; f += +every) {
    await page.evaluate(t => window.renderFrame(t), f / edit.fps);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94 });
    fs.writeFileSync(path.join(outDir, `o${String(f).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (f % 150 === 0) console.log('frame', f, '/', f1, ((Date.now() - t0) / (f - f0 + 1)).toFixed(0), 'ms/f');
  }
  await browser.close();
})();
