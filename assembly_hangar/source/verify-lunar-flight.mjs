import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { FlightState } from './flight-missions.mjs';
import { LUNAR_TIMING } from './lunar-trajectory.mjs';

const output=new URL('../diagnostics/lunar-flight/',import.meta.url);await mkdir(output,{recursive:true});
const gameSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');
const s=new FlightState('apollo_11');while(s.kind!=='moonTransfer')s.update(60,{},500,()=>false);
const at=seconds=>{const t=FlightState.fromSave(s.serialize());t.time=seconds;t.totalTime=t.phaseStartTime+seconds;t.progress=seconds/t.phase.duration;t.navigatePhysical();t.timeline.update();return t;};
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader','--allow-file-access-from-files']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(90000);
const errors=[],results=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
async function snap(){return JSON.parse(await page.locator('.physics-values').getAttribute('data-snapshot'));}
async function load(state){
  state.paused=true;
  await page.evaluate(state=>localStorage.setItem('jugre.flight-save.v1',JSON.stringify({version:1,state,visual:{staged:false,upperStaged:false,boostersReleased:false,recoverySeconds:0}})),state.serialize());
  await page.click('#flight-load');await page.waitForTimeout(500);
}
try{
  await page.goto(new URL('../index.html',import.meta.url).href);await page.locator('#loading').waitFor({state:'hidden'});
  if(await page.locator('#main-menu').isVisible()) await page.locator('[data-menu-action=missions]').click();
  await page.click('[data-view=launch]');await page.selectOption('#launch-rocket','apollo_11');await page.click('#flight-start');
  await page.locator('#flight-panel').waitFor({state:'visible'});await page.locator('#flight-stage-detail').evaluate(el=>el.open=true); await page.locator('#flight-diagnostics').evaluate(el=>el.open=true);
  assert.deepEqual(await page.locator('#flight-warp option').evaluateAll(items=>items.map(i=>i.value)),['1','10','50','100','300','500']);
  await load(at(LUNAR_TIMING.apollo_11.tliBurn+LUNAR_TIMING.apollo_11.extractionDelay-5));
  await page.selectOption('#flight-warp','500');await page.click('#flight-pause');
  let captured=false;const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    await page.waitForTimeout(350);const r=await snap();
    if(r.rendering.rigid.assemblyCaptured){captured=true;break;}
  }
  assert.ok(captured,'Real-time transposition did not capture Eagle');
  await page.waitForTimeout(2000);
  const extraction=await snap();console.log('extraction',JSON.stringify(extraction.rendering));
  assert.ok(extraction.rendering.cameraTargetErrorM<.1,'Camera lost the CSM/LM center');
  assert.ok(extraction.rendering.cameraDistanceM<200);
  results.push({scenario:'LM extraction, moving camera center, ×500',snapshot:extraction});
  await page.screenshot({path:fileURLToPath(new URL('after-lm-extraction.png',output))});
  for(const rate of ['300','500']){
    await page.selectOption('#flight-warp',rate);await page.waitForTimeout(800);
    const before=await snap();await page.waitForTimeout(1500);const after=await snap();
    assert.equal(after.rendering.actualRate,Number(rate));assert.equal(after.rendering.rails,true);
    assert.ok(after.rendering.missionTimeS-before.rendering.missionTimeS>20,'Warp did not move the mission clock');
    const physical=at(after.rendering.phaseTimeS);
    assert.ok(Math.hypot(...after.rendering.velocityKmS.map((v,i)=>v-physical.velocity.toArray()[i]))<1e-7);
    results.push({scenario:`physical time ×${rate}`,before:before.rendering.missionTimeS,after:after.rendering.missionTimeS,snapshot:after});
  }
  const day=at(86400);day.reported.add('apolloTransposition');await load(day);
  await page.waitForTimeout(700);
  assert.match(await page.locator('[data-broadcast=clock]').innerText(),/1d/);
  results.push({scenario:'multi-day HUD and save/load',snapshot:await snap()});
  await page.screenshot({path:fileURLToPath(new URL('one-day-coast.png',output))});
  assert.deepEqual(errors,[]);
}finally{
  await writeFile(new URL('verification.json',output),JSON.stringify({gameSHA256,results,errors},null,2));await browser.close();
}
console.log('Lunar physical time and camera verification passed.');
