import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { alignDockingPorts, dockingPort } from '../flight-layout.mjs';
import { FlightState } from '../flight-missions.mjs';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { findPart } from '../flight-layout.mjs';
import { hullBoxes } from '../flight-rigid.mjs';

test('Apollo solid hull excludes the probe beyond its capture plane',async()=>{
  const data=await readFile(new URL('../../models/flight/columbia.glb',import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
  const cm=findPart(scene,'apollo_cm'),port=findPart(cm,'dock_port');scene.updateWorldMatrix(true,true);
  const plane=cm.worldToLocal(port.getWorldPosition(new Vector3())).y;
  for(const box of hullBoxes(cm,cm,['apollo_cm']))assert.ok(box.center[1]+box.half[1]<plane-.19,'Collider obstructs the capture mechanism');
});

test('port alignment measures both anchors before translating the moving model', () => {
  const parent = new Group(), a = new Group(), b = new Group(); parent.add(a,b);
  for (const root of [a,b]) { const p = new Object3D(); p.userData.partId='dock_port'; p.position.set(0,3,.3); root.add(p); }
  a.position.set(10,20,30); b.quaternion.setFromAxisAngle(new Vector3(1,0,0),Math.PI);
  const offset = new Vector3(0,2.6,0);
  alignDockingPorts(b,a,offset);
  assert.ok(dockingPort(b).distanceTo(dockingPort(a).add(offset)) < 1e-10);
  // It also works beneath a transformed parent, after an earlier alignment.
  parent.position.set(70,-14,8); parent.quaternion.setFromAxisAngle(new Vector3(0,1,0),.4);
  alignDockingPorts(b,a);
  assert.ok(dockingPort(b).distanceTo(dockingPort(a))<1e-10);
});

test('light contact is harmless; a localized heavy impact breaches the crew module and survives a save', () => {
  const s = new FlightState('artemis_ii');
  const event = { zone:'orion_cm', speedMps:.2, impulseNs:50, otherMassKg:8000, hostMassKg:10400 };
  s.systems.impact(s,event); assert.deepEqual(s.systems.moduleDamage,{});
  s.systems.impact(s,{...event,speedMps:50,impulseNs:250000});
  assert.ok(s.systems.moduleDamage.orion_cm>0); assert.ok(s.systems.leakKgPerS>0);
  assert.equal(s.systems.moduleDamage.orion_esm,undefined);
  s.systems.tick(s,2,0); assert.ok(s.systems.cabinPressureKPa<101.3);
  const restored = FlightState.fromSave(s.serialize());
  assert.deepEqual(restored.systems.moduleDamage,s.systems.moduleDamage);
  assert.equal(restored.systems.cabinPressureKPa,s.systems.cabinPressureKPa);
  const fresh = new FlightState('artemis_ii'); assert.deepEqual(fresh.systems.moduleDamage,{}); assert.equal(fresh.systems.leakKgPerS,0);
});

test('scheduled docking phase cannot complete without physical capture or spin forever at its end', () => {
  const s = new FlightState('iss_resupply'); s.preflight=s.countdown=0;
  s.phaseIndex=3; s.time=s.phase.duration-.05; s.physicalDockingRequired=true;
  s.update(1); assert.equal(s.kind,'docking'); assert.ok(Number.isFinite(s.totalTime));
  s.dockingLocked=true; s.dockingCaptureTime=s.totalTime; s.update(1);
  assert.equal(s.kind,'docking'); s.update(2); assert.equal(s.kind,'earthReturn');
});
