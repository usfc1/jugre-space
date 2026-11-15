import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {FlightState} from './flight-missions.mjs';

const output=new URL('../diagnostics/lunar-cameras/',import.meta.url);await mkdir(output,{recursive:true});
function checkpoint(kind,seconds=0){
  const s=new FlightState('apollo_11');while(s.kind!==kind&&!s.failed)s.update(60,{},500,()=>false);
  if(seconds)s.update(seconds);s.paused=true;return s.serialize();
}
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader','--allow-file-access-from-files']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(90000);
const errors=[],results=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});
async function snap(label){
  const value=JSON.parse(await page.locator('.physics-values').getAttribute('data-snapshot'));
  results.push({label,...value});console.log(label,JSON.stringify({phase:value.rendering.phase,clock:value.rendering.missionTimeS,cameraError:value.rendering.cameraTargetErrorM,distance:value.rendering.cameraDistanceM}));
  return value;
}
async function load(kind,seconds=0){
  const state=checkpoint(kind,seconds);
  await page.evaluate(state=>localStorage.setItem('jugre.flight-save.v1',JSON.stringify({version:1,state,visual:{staged:false,upperStaged:false,boostersReleased:false,recoverySeconds:0}})),state);
  await page.click('#flight-load');await page.waitForTimeout(700);
}
try{
  await page.goto(new URL('../index.html',import.meta.url).href);await page.locator('#loading').waitFor({state:'hidden'});
  await page.click('[data-view=launch]');await page.selectOption('#launch-rocket','apollo_11');await page.click('#flight-start');
  await page.locator('#flight-panel').waitFor({state:'visible'});await page.locator('#flight-diagnostics').evaluate(e=>e.open=true);
  await load('moonSurface',12);await page.selectOption('#flight-warp','1');
  await page.click('[data-flight-camera=cabin]');await page.click('#flight-pause');
  await page.waitForTimeout(3100);await snap('ascent-board');
  await page.screenshot({path:fileURLToPath(new URL('before-ship-switch.png',output))});
  await page.click('[data-flight-camera=ship]');await page.waitForTimeout(1000);
  const a=await snap('ascent-ship');await page.waitForTimeout(1500);const b=await snap('ascent-ship-moving');
  await page.screenshot({path:fileURLToPath(new URL('after-ship-switch.png',output))});
  assert.ok(b.rendering.missionTimeS>a.rendering.missionTimeS+.3,'Mission froze after board → ship');
  assert.ok(Number.isFinite(b.rendering.cameraDistanceM)&&b.rendering.cameraDistanceM<200,'Invalid ship camera distance');
  for(const view of ['moon','ship','cabin','ship','earth','ship']){
    await page.click(`[data-flight-camera=${view}]`);await page.waitForTimeout(400);await snap(`ascent-${view}`);
  }
  await load('rendezvous',19);await page.selectOption('#flight-warp','10');
  await page.click('[data-flight-camera=cabin]');await page.click('#flight-pause');
  await page.waitForTimeout(1200);await page.click('[data-flight-camera=ship]');
  await page.waitForTimeout(15000);await snap('after-rendezvous');
  await page.screenshot({path:fileURLToPath(new URL('after-rendezvous.png',output))});
  assert.deepEqual(errors,[]);
}finally{await writeFile(new URL('verification.json',output),JSON.stringify({results,errors},null,2));await browser.close();}
