import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { FlightState } from './flight-missions.mjs';

const output = new URL('../diagnostics/physx/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const results = [];
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(90000);
page.on('pageerror', e => { errors.push(e.message); console.error('PAGE:', e.message); });
async function start(id) {
  await page.goto(new URL('../index.html', import.meta.url).href, { timeout: 90000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  if(await page.locator('#main-menu').isVisible()) await page.locator('[data-menu-action=missions]').click();
  await page.click('[data-view=launch]'); await page.selectOption('#launch-rocket', id);
  await page.click('#flight-start'); await page.locator('#flight-panel').waitFor({ state: 'visible' });
  await page.locator('#flight-stage-detail').evaluate(el=>el.open=true); await page.locator('#flight-diagnostics > summary').click();
}
async function snapshot() {
  return JSON.parse(await page.locator('.physics-values').getAttribute('data-snapshot'));
}
async function waitSnapshot(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const s = await snapshot(); if (predicate(s)) return s;
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for physics condition: '+JSON.stringify((await snapshot()).rendering));
}
async function load(state) {
  const saved = { version: 1, state: state.serialize(), visual: { staged: false, upperStaged: false, boostersReleased: false, recoverySeconds: 0 } };
  await page.evaluate(value => localStorage.setItem('jugre.flight-save.v1', JSON.stringify(value)), saved);
  await page.click('#flight-load');
  await page.waitForTimeout(700);
}
function atPhase(id, kind, progress = 0) {
  const state = new FlightState(id);
  while (state.kind !== kind && !state.complete && !state.failed) state.update(60,{},500,()=>false);
  assert.equal(state.kind, kind);
  const target=state.phase.duration*progress;
  while(state.time<target-1e-4)state.update(Math.min(60,Math.max(1e-6,(target-state.time)/500)),{},500,()=>false);
  return state;
}
try {
  for (const id of process.env.JUGRE_CHECK === 'dock' ? [] : ['apollo_11', 'artemis_ii']) {
    console.log('Checking launch', id);
    await start(id);
    for (const t of [12, 60, id === 'apollo_11' ? 165 : 135]) {
      const state = new FlightState(id); state.update(15.5 + t); state.paused = true;
      await load(state);
      const s = await snapshot(); console.log(id, t, JSON.stringify(s.rendering.rigid));
      assert.ok(s.rendering.rigid.loaded); assert.ok(s.rendering.attitudeErrorDeg < .05, `attitude ${s.rendering.attitudeErrorDeg}`);
      assert.ok(Math.abs(s.physics.altitudeM - state.launch.altitudeM) < .001);
      results.push({ scenario: 'launch-checkpoint', id, t, snapshot: s });
    }
    await page.click('#flight-pause');
    await page.selectOption('#flight-warp', '1');
    await page.waitForTimeout(500);
    const staged = await snapshot(); results.push({ scenario: 'live-staging', id, snapshot: staged });
    assert.ok(staged.rendering.rigid.steps > 0);
    await waitSnapshot(s=>s.rendering.rigid.separations.length>0);
    results.push({scenario:'separated-independent-body',id,snapshot:await snapshot()});
    await page.waitForTimeout(1800);
    await page.click('#flight-pause');
    await page.screenshot({ path: fileURLToPath(new URL(`${id}-staging.png`, output)) });
    const handoff = new FlightState(id);
    while(handoff.altitude < .61) handoff.update(.025);
    handoff.paused=true; await load(handoff);
    const before=await snapshot(); assert.equal(before.rendering.frame,'launchpad');
    await page.click('#flight-pause');
    const after=await waitSnapshot(s=>s.rendering.frame==='floating-origin');
    assert.ok(before.rendering.modelPositionErrorM<.001 && after.rendering.modelPositionErrorM<.001,'Model diverged from trajectory at handoff');
    const cameraDelta=Math.hypot(...after.rendering.cameraOffsetM.map((v,i)=>v-before.rendering.cameraOffsetM[i]));
    assert.ok(cameraDelta<20,`Camera jumped ${cameraDelta} m at handoff`);
    results.push({scenario:'live-pad-frame-handoff',id,cameraDeltaM:cameraDelta,snapshot:after});
  }
  console.log('Checking ISS capture');
  await start('iss_resupply');
  const docking = atPhase('iss_resupply', 'docking', .73); docking.paused = true;
  await load(docking); await page.click('#flight-pause');
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1000);
    const s = await snapshot(); console.log('dock', i, JSON.stringify({phase:s.rendering.phase, ports:s.rendering.ports, near:s.rendering.nearbyType, ...s.rendering.rigid}));
    if (s.rendering.rigid.joints > 0 || s.rendering.rigid.docking?.captured) { results.push({ scenario: 'iss-capture', snapshot: s }); break; }
  }
  assert.ok(results.some(r => r.scenario === 'iss-capture'), 'ISS joint was not created');
  await page.screenshot({path:fileURLToPath(new URL('iss-capture.png',output))});
  console.log('Checking Apollo lunar rendezvous');
  await start('apollo_11');
  const rendezvous=atPhase('apollo_11','rendezvous',.93); rendezvous.paused=true; await load(rendezvous);
  await page.click('#flight-pause');
  const lunar=await waitSnapshot(s=>s.rendering.rigid.docking?.captured,20000);
  results.push({scenario:'apollo-lunar-capture',snapshot:lunar});
  console.log('Checking Apollo transposition and free Eagle');
  await start('apollo_11');
  const transposition=atPhase('apollo_11','moonTransfer',.025);transposition.paused=true;await load(transposition);
  await page.selectOption('#flight-warp','500');
  await page.click('#flight-pause');
  const extraction=await waitSnapshot(s=>s.rendering.rigid.assemblyCaptured,20000);
  results.push({scenario:'apollo-transposition-port-gate',snapshot:extraction});
  await page.selectOption('#flight-warp','1');
  const separate=atPhase('apollo_11','separate',.1);separate.paused=true;await load(separate);
  const freeBefore=await snapshot();assert.ok(freeBefore.rendering.rigid.freeModule);
  await page.click('#flight-pause');
  const freeAfter=await waitSnapshot(s=>s.rendering.rigid.freeModule && Math.hypot(...s.rendering.rigid.freeModulePositionM.map((v,i)=>v-freeBefore.rendering.rigid.freeModulePositionM[i]))>1);
  assert.ok(Math.hypot(...freeAfter.rendering.rigid.freeModuleRenderedPositionM.map((v,i)=>v-freeBefore.rendering.rigid.freeModuleRenderedPositionM[i]))>.8,'Eagle model did not follow its independent PhysX body');
  results.push({scenario:'independent-eagle-module',snapshot:freeAfter});
  for (const fault of ['fast','angle']) {
    console.log('Checking rejected docking', fault);
    await start('iss_resupply');
    const s=atPhase('iss_resupply','docking',fault==='fast'?.60:.73); s.paused=true;
    await load(s); await page.click('#flight-pause');
    await page.click(fault==='fast'?'[data-dock-fast]':'[data-dock-angle]');
    const rejected=await waitSnapshot(s=>s.rendering.rigid.dockingRejected,20000);
    assert.equal(rejected.rendering.rigid.joints,0); assert.ok(rejected.rendering.rigid.contacts>0);
    results.push({scenario:`rejected-docking-${fault}`,snapshot:rejected});
  }
  console.log('Checking live cabin, damage and restart');
  await start('apollo_11');
  const orbit=atPhase('apollo_11','orbit',.05); orbit.paused=true; await load(orbit);
  await page.selectOption('#flight-warp','1');
  await page.click('[data-flight-camera=cabin]');
  await page.click('#flight-pause'); await page.click('[data-push-loose]');
  const drifting=await waitSnapshot(s=>Object.values(s.rendering.interior).some(c=>c.loose.some(b=>Math.hypot(...b.velocityMps)>.3)));
  results.push({scenario:'live-cabin-drift',snapshot:drifting});
  const wall=await waitSnapshot(s=>Object.values(s.rendering.interior).some(c=>c.contacts>0));
  results.push({scenario:'live-cabin-wall',snapshot:wall});
  await page.screenshot({path:fileURLToPath(new URL('apollo-cabin.png',output))});
  await page.click('[data-impact-test]');
  const damage=await waitSnapshot(s=>Object.keys(s.rendering.damage).length>0);
  assert.ok(damage.rendering.rigid.contacts>0); assert.ok(Object.keys(damage.rendering.damage).some(id=>id.includes('apollo_cm')));
  const leak=await waitSnapshot(s=>s.rendering.cabinPressureKPa<101.2);
  results.push({scenario:'localized-impact-and-pressure-loss',snapshot:leak});
  await page.click('#flight-save');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('jugre.flight-save.v1')));
  assert.ok(saved.rigid?.host&&saved.interior?.apollo_cm);
  saved.state.values.paused=true;
  await page.evaluate(value=>localStorage.setItem('jugre.flight-save.v1',JSON.stringify(value)),saved);
  await page.click('#flight-load'); await page.waitForTimeout(700);
  const restored=await snapshot();
  assert.deepEqual(restored.rendering.damage,saved.state.systems.moduleDamage);
  assert.ok(Math.hypot(...restored.rendering.rigid.hostOffsetM.map((v,i)=>v-saved.rigid.host.p[i]))<.001);
  results.push({scenario:'physical-state-save-load',snapshot:restored});
  await page.click('#flight-stop'); await page.click('#flight-start');
  await page.locator('#flight-panel').waitFor({state:'visible'});
  const fresh=await waitSnapshot(s=>s.rendering.rigid.steps===0&&s.physics.simulationTimeS===0);
  assert.equal(fresh.rendering.rigid.debris,0); assert.equal(fresh.rendering.rigid.contacts,0);
  assert.deepEqual(fresh.rendering.damage,{}); assert.equal(fresh.rendering.cabinPressureKPa,101.3);
  results.push({scenario:'mission-restart-cleared',snapshot:fresh});
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('game-verification.json', output), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
console.log('PhysX game verification passed.');
