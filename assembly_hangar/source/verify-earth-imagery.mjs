import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { FlightState } from './flight-missions.mjs';
import { earthImageryRegions } from './earth-imagery-config.mjs';

const before=process.argv.includes('--before');
const output=new URL('../diagnostics/earth-imagery/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader','--allow-file-access-from-files']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(90000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))errors.push(m.text());});
const results=[];
try {
  await page.goto(new URL('../index.html',import.meta.url).href,{timeout:90000});
  await page.locator('#loading').waitFor({state:'hidden'});await page.click('[data-view=launch]');
  await page.selectOption('#launch-rocket','apollo_11');await page.click('#flight-start');
  await page.locator('#flight-panel').waitFor({state:'visible'});
  for(const time of before?[128]:[60,128,200]) {
    const state=new FlightState('apollo_11');state.update(15.5+time);state.paused=true;
    const save={version:1,state:state.serialize(),visual:{staged:false,upperStaged:false,boostersReleased:false,recoverySeconds:0}};
    await page.evaluate(v=>localStorage.setItem('jugre.flight-save.v1',JSON.stringify(v)),save);await page.click('#flight-load');
    await page.waitForTimeout(500);
    if(!before) await page.screenshot({path:fileURLToPath(new URL(`after-t${time}-oblique.png`,output))});
    const area=await page.locator('#work-area').boundingBox();
    await page.mouse.move(area.x+area.width*.5,area.y+area.height*.4);
    await page.mouse.down();await page.mouse.move(area.x+area.width*.5,area.y+area.height*.4+105,{steps:15});await page.mouse.up();
    await page.mouse.wheel(0,180);await page.waitForTimeout(400);
    await page.screenshot({path:fileURLToPath(new URL(`${before?'before':'after'}-t${time}.png`,output))});
    await page.locator('#flight-diagnostics').evaluate(el=>el.open=true);await page.waitForTimeout(250);
    const diagnostic=JSON.parse(await page.locator('.physics-values').getAttribute('data-snapshot'));
    if(!before){assert.equal(diagnostic.rendering.earthImagery.regions.length,3);assert.ok(diagnostic.rendering.earthImagery.regions.every(r=>{const spec=earthImageryRegions.find(s=>s.id===r.id);return r.width===spec.width&&r.height===spec.height;}));}
    results.push({time,altitudeM:state.launch.altitudeM,imagery:diagnostic.rendering.earthImagery});
    await page.locator('#flight-diagnostics').evaluate(el=>el.open=false);
  }
  if(!before){await page.click('[data-flight-camera=earth]');await page.waitForTimeout(500);await page.screenshot({path:fileURLToPath(new URL('after-earth-globe.png',output))});}
  assert.deepEqual(errors,[]);
} finally {
  await writeFile(new URL(`${before?'before':'after'}-verification.json`,output),JSON.stringify({results,errors},null,2));
  await browser.close();
}
console.log(JSON.stringify({before,results,errors}));
