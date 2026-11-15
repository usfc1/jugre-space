import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
  page.on('pageerror', e => console.error(e));
  const wasm = await readFile(new URL('../node_modules/physx-js-webidl/physx-js-webidl.wasm', import.meta.url));
  const apollo = await readFile(new URL('../../models/flight/apollo_docked.glb', import.meta.url));
  await page.setContent('<script type="application/octet-stream" id="physx-wasm">'+wasm.toString('base64')+'</script><script type="application/octet-stream" id="apollo-fixture">'+apollo.toString('base64')+'</script>');
  const bundle = await build({stdin:{contents:`import {runRigidFixtures} from './tests/rigid-fixtures.mjs'; import {runSurfaceFixtures} from './tests/surface-physx-fixtures.mjs'; import {runAssemblyFixtures} from './tests/assembly-rcs-fixtures.mjs'; window.run=async()=>({rigid:await runRigidFixtures(),surface:await runSurfaceFixtures(),assembly:await runAssemblyFixtures()});`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',target:'es2022',logLevel:'silent'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const manualBundle = await build({stdin:{contents:`import {runManualNativeFixtures} from './tests/manual-native-fixtures.mjs'; window.manualNative=runManualNativeFixtures;`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',target:'es2022',logLevel:'silent'});
  await page.addScriptTag({content:manualBundle.outputFiles[0].text});
  const result=await page.evaluate(async()=>({ ...await window.run(), manual: await window.manualNative() }));
  await mkdir(new URL('../../diagnostics/physx/',import.meta.url),{recursive:true});
  await writeFile(new URL('../../diagnostics/physx/backend-verification.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
