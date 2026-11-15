import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightState, MOON, MOON_RADIUS } from '../flight-missions.mjs';
import { EARTH_GM, keplerState, lambertState } from '../orbital-propagator.mjs';
import { LUNAR_TIMING } from '../lunar-trajectory.mjs';

function phaseState(id,kind){
  const s=new FlightState(id);
  for(let i=0;i<500&&!s.failed&&s.kind!==kind;i++)s.update(60,{},500,()=>false);
  assert.equal(s.kind,kind);assert.equal(s.failed,false);return s;
}
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);

test('universal Kepler conserves energy, momentum and reverses a multi-day coast',()=>{
  const r=new Vector3(6670,0,0),v=new Vector3(0,10.8,0);
  const s=keplerState(r,v,200000),back=keplerState(s.position,s.velocity,-200000);
  near(s.velocity.lengthSq()/2-EARTH_GM/s.position.length(),v.lengthSq()/2-EARTH_GM/r.length(),1e-10);
  near(s.position.clone().cross(s.velocity).length(),r.clone().cross(v).length(),1e-6);
  assert.ok(back.position.distanceTo(r)<1e-5);assert.ok(back.velocity.distanceTo(v)<1e-8);
  const target=new Vector3(-310000,140000,30000),l=lambertState(r,target,250000),end=keplerState(r,l.departureVelocity,250000);
  assert.ok(end.position.distanceTo(target)<1e-5);
});

test('Apollo TLI and lunar arrival use hours/days with continuous physical state',()=>{
  const s=phaseState('apollo_11','moonTransfer'),p=s.path,t=LUNAR_TIMING.apollo_11;
  near(s.totalTime,t.tliGET);assert.ok(p.injectionDeltaV>3&&p.injectionDeltaV<3.4);
  near(p.sample(0).position.distanceTo(s.position),0);
  assert.ok(p.sample(0).velocity.distanceTo(s.segmentVelocity)<1e-10);
  assert.ok(p.sample(p.burnDuration).velocity.length()>10.7&&p.sample(p.burnDuration).velocity.length()<11);
  for(const time of [10,200,p.burnDuration+20,20000,100000,p.burnDuration+p.earthTime+100,260000]){
    const a=p.sample(time-.02),b=p.sample(time+.02),sample=p.sample(time);
    assert.ok(b.position.sub(a.position).divideScalar(.04).distanceTo(sample.velocity)<2e-5,`speed at ${time}`);
  }
  for(const time of [p.burnDuration,p.burnDuration+p.earthTime]){
    assert.ok(p.sample(time-1e-4).position.distanceTo(p.sample(time+1e-4).position)<.003);
    assert.ok(p.sample(time-1e-4).velocity.distanceTo(p.sample(time+1e-4).velocity)<1e-4);
  }
  const arrival=p.sample(s.phase.duration);
  near(arrival.position.distanceTo(MOON)-MOON_RADIUS,120,1e-5);
  while(s.kind==='moonTransfer')s.update(60,{},500,()=>false);
  near(s.totalTime,t.arrivalGET);assert.ok(s.position.distanceTo(arrival.position)<1e-6);
  assert.ok(s.path.sample(0).velocity.distanceTo(arrival.velocity)<1e-6);
  s.update(20,{},20);assert.ok(s.altitude>120&&s.altitude<200);assert.ok(s.speed>1500&&s.speed<1750);
  assert.equal(s.timeline.events.find(e=>e.id==='lunar-orbit').status,'COMPLETE');
});

test('×1, ×300 and ×500 advance one shared clock and identical states',()=>{
  const initial=phaseState('apollo_11','moonTransfer');initial.time=6000;initial.totalTime=initial.phaseStartTime+initial.time;initial.navigatePhysical();
  const copies=[1,300,500].map(rate=>{
    const s=FlightState.fromSave(initial.serialize()),clock=s.timeline.clock.seconds;
    const advanced=s.update(1500/rate,{},rate);
    near(advanced,1500,1e-6);near(s.totalTime-initial.totalTime,1500,1e-6);near(s.timeline.clock.seconds-clock,1500,1e-6);
    assert.equal(s.actualRate,rate);return s;
  });
  for(const s of copies.slice(1)){assert.ok(s.position.distanceTo(copies[0].position)<1e-6);assert.ok(s.velocity.distanceTo(copies[0].velocity)<1e-10);}
  const active=FlightState.fromSave(initial.serialize());active.update(1,{},500,undefined,()=>{},()=>false);near(active.actualRate,20);near(active.totalTime-initial.totalTime,20);
});

test('parking orbit at ×500 agrees with the rotating-frame force integrator',()=>{
  const slow=phaseState('apollo_11','orbit'),fast=FlightState.fromSave(slow.serialize()),start=slow.totalTime;
  slow.update(500,{},1);fast.update(1,{},500);
  near(slow.totalTime-start,500,1e-6);near(fast.totalTime-start,500,1e-6);
  assert.ok(slow.position.distanceTo(fast.position)<.01);
  assert.ok(slow.velocity.distanceTo(fast.velocity)<.001);
});

test('compressed Apollo save migrates to physical time and survives another save',()=>{
  const s=phaseState('apollo_11','moonTransfer'),save=s.serialize();
  delete save.values.timeModelVersion;delete save.phaseDurations;delete save.vectors.segmentVelocity;
  save.values.time=35;save.values.progress=35/128;save.values.totalTime=668;save.values.speed=9330;
  save.reported.push('apolloTransposition');
  const migrated=FlightState.fromSave(save);
  assert.equal(migrated.migratedTimeModel,true);assert.ok(migrated.totalTime>15000);
  assert.ok(migrated.altitude>10000);assert.ok(migrated.path.injectionDeltaV<3.4);
  const restored=FlightState.fromSave(migrated.serialize());migrated.update(1);restored.update(1);
  assert.ok(migrated.position.distanceTo(restored.position)<1e-7);near(migrated.totalTime,restored.totalTime);
});

test('Artemis physical transfer reaches the configured lunar flyby without discontinuity',()=>{
  const s=phaseState('artemis_ii','moonTransfer');assert.ok(s.path.velocityError<1e-5);
  const arrival=s.path.sample(s.phase.duration);
  while(s.kind==='moonTransfer')s.update(60,{},500,()=>false);
  near(s.totalTime,LUNAR_TIMING.artemis_ii.arrivalGET);
  near(s.position.distanceTo(MOON)-MOON_RADIUS,6400,1e-4);
  assert.ok(s.path.sample(0).position.distanceTo(arrival.position)<1e-6);
  assert.ok(s.path.sample(0).velocity.distanceTo(arrival.velocity)<1e-7);
});
