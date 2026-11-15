import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function buildTimelinePreview() {
  const template = await readFile(new URL('./viewer.html', import.meta.url), 'utf8');
  const css = template.split('/* BROADCAST_HUD_START */')[1].split('/* BROADCAST_HUD_END */')[0];
  const result = await build({ entryPoints: [fileURLToPath(new URL('./timeline-preview.mjs', import.meta.url))], bundle: true,
    write: false, minify: true, format: 'iife', target: 'es2022' });
  const license = await readFile(new URL('../LICENSE', import.meta.resolve('three')), 'utf8');
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JUGRE · Broadcast HUD test mode</title>
<style>*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#080d13;color:white;font:14px "Segoe UI",sans-serif}#viewport{position:relative;width:100vw;height:100svh;overflow:hidden;background:radial-gradient(ellipse at 45% 35%,#283b49,#05090e 85%)}.qa-label{position:absolute;top:24px;left:24px;font-size:11px;letter-spacing:.15em;color:#c1cad3}.qa-controls{position:absolute;top:60px;right:24px;display:flex;gap:8px;flex-wrap:wrap;width:300px;padding:14px;background:#0a111bd9;border:1px solid #33404e;border-radius:5px}.qa-controls label{width:100%}.qa-controls select,.qa-controls button{background:#17232e;color:white;border:1px solid #506070;padding:6px;font:inherit}.qa-controls select{width:100%;margin:4px 0}.qa-controls pre{font:11px/1.6 "Segoe UI",sans-serif;white-space:pre-wrap;color:#a9b8c7;width:100%}${css}</style>
<body><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script><!-- Three.js\n${license}\n--></body></html>`;
  await writeFile(new URL('../timeline-preview.html', import.meta.url), html);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildTimelinePreview();
