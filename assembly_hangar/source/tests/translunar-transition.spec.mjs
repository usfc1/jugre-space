import { test, expect } from './game-test.mjs';
import { FlightState } from '../flight-missions.mjs';
import { LUNAR_TIMING } from '../lunar-trajectory.mjs';
import { checkpoint } from './flight-fixtures.mjs';

async function openFlight(page,s) {
  s.paused=true;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))errors.push(message.text());
  });
  await page.addInitScript(data=>localStorage.setItem('jugre.flight-save.v1',JSON.stringify(data)),checkpoint(s));
  await page.goto('/index.html');
  await expect(page.locator('#loading')).toBeHidden({timeout:90000});
  await page.locator('[data-view=launch]').click();
  await page.locator('#launch-rocket').selectOption('apollo_11');
  await page.locator('#flight-start').click();
  await page.locator('#flight-load').click();
  await expect(page.locator('#flight-event')).toContainText(/восстановлены|restored/i);
  await page.locator('#flight-diagnostics').evaluate(el=>el.open=true);
  await page.waitForTimeout(500);
  return errors;
}
const snapshot=async page=>JSON.parse(await page.locator('.physics-values').getAttribute('data-snapshot'));

test('Apollo parking orbit crosses translunar injection without a visual teleport',async({page})=>{
  test.setTimeout(120000);
  const s=new FlightState('apollo_11');s.preflight=s.countdown=0;
  for(let i=0;i<500&&s.kind!=='orbit'&&!s.failed;i++)s.update(10,{},100,()=>false);
  s.update((LUNAR_TIMING.apollo_11.tliGET-s.totalTime-2)/500,{},500,()=>false);
  const errors=await openFlight(page,s);
  await page.screenshot({path:'test-results/translunar-before.png'});
  const before=await snapshot(page);
  await page.locator('#flight-pause').click();
  await page.waitForTimeout(3500);
  await page.locator('#flight-pause').click();
  await page.waitForTimeout(300);
  const after=await snapshot(page);
  await page.screenshot({path:'test-results/translunar-after.png'});
  expect(before.rendering.phase).toBe('orbit');
  expect(after.rendering.phase).toBe('moonTransfer');
  expect(after.rendering.modelId).toBe(before.rendering.modelId);
  expect(before.rendering.earthBackdropBlend).toBe(1);
  expect(after.rendering.earthBackdropBlend).toBe(1);
  const sunlightChange=Math.hypot(...after.rendering.sunlightWorld.map((v,i)=>v-before.rendering.sunlightWorld[i]));
  expect(sunlightChange).toBeLessThan(.001);
  expect(after.rendering.cameraDistanceM/before.rendering.cameraDistanceM).toBeGreaterThan(.95);
  expect(after.rendering.cameraDistanceM/before.rendering.cameraDistanceM).toBeLessThan(1.05);
  expect(after.rendering.cameraTargetErrorM).toBeLessThan(.1);
  expect(after.rendering.rigid.hostOffsetM.every(v=>Math.abs(v)<.1)).toBe(true);
  expect(errors).toEqual([]);
});

test('Apollo changes to the CSM/LM model only at separation and keeps the camera on the vessel',async({page})=>{
  test.setTimeout(120000);
  const s=new FlightState('apollo_11');s.preflight=s.countdown=0;
  for(let i=0;i<500&&s.kind!=='moonTransfer'&&!s.failed;i++)s.update(60,{},500,()=>false);
  const timing=LUNAR_TIMING.apollo_11;
  s.update(timing.tliBurn/20,{},20);
  s.advanceCoast(timing.extractionDelay-2);
  const errors=await openFlight(page,s),before=await snapshot(page);
  expect(before.rendering.asset).not.toBe('apollo_docked');
  await expect(page.locator('#flight-save')).toBeEnabled();
  await page.locator('#flight-pause').click();
  await expect(page.locator('#flight-save')).toBeDisabled({timeout:15000});
  // Allow the existing 1.65 s camera framing animation to settle.
  await page.waitForTimeout(2300);
  const after=await snapshot(page),dt=after.rendering.missionTimeS-before.rendering.missionTimeS;
  const distance=Math.hypot(...after.rendering.positionKm.map((v,i)=>v-before.rendering.positionKm[i]));
  expect(after.rendering.asset).toBe('apollo_docked');
  expect(after.rendering.modelId).not.toBe(before.rendering.modelId);
  expect(distance).toBeLessThan(dt*Math.hypot(...before.rendering.velocityKmS)*1.5+1);
  expect(after.rendering.cameraTargetErrorM).toBeLessThan(.1);
  expect(after.rendering.cameraDistanceM).toBeGreaterThan(9);
  expect(after.rendering.cameraDistanceM).toBeLessThan(420);
  await page.screenshot({path:'test-results/translunar-separation.png'});
  expect(errors).toEqual([]);
});
