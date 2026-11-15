import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3, Group, Mesh, CylinderGeometry, MeshBasicMaterial } from 'three';
import { LaunchDynamics, PHYSICS_STEP_S } from '../launch-dynamics.mjs';
import { launchVehicles, vehicleForMission, vehicleFromAssembly } from '../launch-vehicles.mjs';
import { FlightState } from '../flight-missions.mjs';
import { EARTH_RADIUS_M, PAD_POSITION_M, PAD_UP, PAD_EAST, PAD_NORTH, padLocalPosition, G0 } from '../flight-coordinates.mjs';
import { WorldSmokeTrail } from '../ascent-trail.mjs';
import { activeNozzles } from '../engine-nozzles.mjs';
import { physicsSample, trajectoryCSV } from '../flight-diagnostics.mjs';

for (const [id, config] of Object.entries(launchVehicles)) {
  test(`${id}: physical initial climb stays near the pad and reaches a bound orbit`, () => {
    const p = new LaunchDynamics(config);
    const initialMass = p.massKg;
    p.advance(12);
    assert.ok(p.altitudeM > 50 && p.altitudeM < 1000, `${id}: ${p.altitudeM} m`);
    assert.ok(p.groundDistanceM < 10, `${id}: premature downrange motion`);
    assert.ok(p.surfaceSpeedMps > 10 && p.surfaceSpeedMps < 150);
    assert.ok(p.massKg < initialMass);
    for (let i = 0; i < 1400 && !p.orbitAchieved && !p.crashed; i++) p.advance(1);
    assert.equal(p.crashed, false, id);
    assert.equal(p.orbitAchieved, true, `${id}: periapsis ${p.orbit.periapsisM}`);
    assert.ok(p.orbit.periapsisM > 100000);
    assert.ok(p.orbit.apoapsisM < 500000);
    assert.ok(p.orbit.energy < 0);
    assert.equal(p.thrustN, 0);
    assert.ok(p.trajectory.every(row => Object.values(row).every(v => v === null || Number.isFinite(v))));
  });
}

test('engines off: ground support prevents motion and fuel consumption', () => {
  const p = new LaunchDynamics(launchVehicles.apollo_11);
  const mass = p.massKg;
  p.advance(60, { throttle: 0 });
  assert.ok(p.positionM.distanceTo(PAD_POSITION_M) < 1e-8);
  assert.equal(p.surfaceSpeedMps, 0); assert.equal(p.massKg, mass);
  assert.ok(p.orbit.inertialSpeedMps > 400 && p.orbit.inertialSpeedMps < 420);
  assert.ok(p.properG > .98 && p.properG < 1.01);
});

test('a vehicle below liftoff thrust-to-weight remains supported on the pad', () => {
  const config = vehicleForMission('apollo_11'); config.stages[0].seaThrustN *= .2;
  const p = new LaunchDynamics(config); p.advance(10);
  assert.equal(p.onPad, true); assert.equal(p.altitudeM, 0);
});

test('coordinates integrate the same measured velocity and altitude integrates radial speed', () => {
  const p = new LaunchDynamics(launchVehicles.dart); p.advance(20);
  for (let i = 0; i < 120; i++) {
    const position = p.positionM.clone(), velocity = p.velocityMps.clone(), altitude = p.altitudeM, vr = p.verticalSpeedMps;
    p.advance(PHYSICS_STEP_S);
    const integral = velocity.add(p.velocityMps).multiplyScalar(PHYSICS_STEP_S / 2);
    assert.ok(p.positionM.clone().sub(position).distanceTo(integral) < .0001);
    assert.ok(Math.abs(p.altitudeM - altitude - (p.verticalSpeedMps + vr) * PHYSICS_STEP_S / 2) < .0001);
  }
});

test('manual and automatic flight use identical forces when both point vertically', () => {
  const a = new LaunchDynamics(launchVehicles.dart), b = new LaunchDynamics(launchVehicles.dart);
  a.advance(5, { mode: 'command' }); b.advance(5, { mode: 'manual' });
  assert.ok(a.positionM.distanceTo(b.positionM) < 1e-8);
  assert.ok(a.velocityMps.distanceTo(b.velocityMps) < 1e-8);
});

test('cutoff removes thrust acceleration and the vehicle continues ballistically', () => {
  const p = new LaunchDynamics(launchVehicles.apollo_11); p.advance(40);
  const before = p.accelerationMps2.clone(), altitude = p.altitudeM, fuel = p.fuelMassKg;
  p.advance(1, { throttle: 0 });
  assert.equal(p.thrustN, 0); assert.equal(p.fuelMassKg, fuel);
  assert.ok(p.accelerationMps2.dot(PAD_UP) < 0);
  assert.ok(before.distanceTo(p.accelerationMps2) > 10);
  assert.ok(p.altitudeM > altitude, 'the rocket must retain upward momentum after cutoff');
});

test('stage separation removes exactly the detached dry mass and remaining propellant', () => {
  const p = new LaunchDynamics(launchVehicles.apollo_11); p.advance(20);
  const oldMass = p.massKg, discarded = p.vehicle.stages[0].dryMassKg + p.stages[0].fuelKg, velocity = p.velocityMps.clone();
  assert.equal(p.separate(true), true);
  assert.ok(Math.abs(oldMass - p.massKg - discarded) < 1e-7);
  assert.equal(p.velocityMps.distanceTo(velocity), 0);
  assert.equal(p.stages[0].attached, false);
  assert.equal(p.thrustN, 0, 'the upper engine stays off during the physical separation coast');
});

test('orbital cutoff immediately reports free fall and coasting conserves orbital energy', () => {
  const p = new LaunchDynamics(launchVehicles.dart);
  while (!p.orbitAchieved && p.time < 1000) p.advance(.1);
  assert.equal(p.orbitAchieved, true);
  assert.ok(p.accelerationMps2.length() > 8 && p.accelerationMps2.length() < 10);
  assert.ok(p.properG < .01);
  const energy = p.orbit.energy;
  p.advance(1200, { throttle:0 });
  assert.ok(Math.abs((p.orbit.energy-energy)/energy) < .0001);
});

test('failed separation keeps attached mass, prevents upper-stage ignition and can be retried', () => {
  const p = new LaunchDynamics(launchVehicles.apollo_11); p.separationFaults.add(0); p.advance(200);
  assert.equal(p.stageIndex, 0); assert.equal(p.stages[0].attached, true);
  assert.equal(p.stages[1].fuelKg, p.vehicle.stages[1].propellantKg);
  assert.equal(p.events.filter(e => e.type === 'stageFailure').length, 1);
  p.separationFaults.clear(); p.advance(1);
  assert.equal(p.stageIndex, 1);
});

test('fixed stepping gives the same result at 30, 60, 144 FPS and ×100 warp', () => {
  const results = [];
  for (const [fps, warp] of [[30,1],[60,1],[144,1],[30,100]]) {
    const p = new LaunchDynamics(launchVehicles.mars_2020);
    const duration = 120, count = Math.round(duration * fps / warp);
    for (let i = 0; i < count; i++) p.advance(duration / count);
    results.push(p);
  }
  for (const p of results) {
    assert.ok(p.positionM.distanceTo(results[0].positionM) < .01);
    assert.ok(p.velocityMps.distanceTo(results[0].velocityMps) < .001);
    assert.ok(Math.abs(p.massKg - results[0].massKg) < .001);
  }
});

test('mode switches never teleport the rocket or rewrite its clock/velocity', () => {
  const s = new FlightState('dart'); s.update(45);
  const p = s.position.clone(), v = s.velocity.clone(), time = s.totalTime;
  s.setMode('manual'); s.setMode('command');
  assert.equal(s.position.distanceTo(p), 0); assert.equal(s.velocity.distanceTo(v), 0); assert.equal(s.totalTime, time);
});

test('engine failure changes the trajectory rather than preserving a scheduled animation', () => {
  const a = new LaunchDynamics(launchVehicles.apollo_11); a.advance(40);
  const b = LaunchDynamics.restore(a.snapshot()); b.failEngine();
  a.advance(30); b.advance(30);
  assert.equal(b.thrustN, 0); assert.ok(a.altitudeM > b.altitudeM + 5000);
  assert.ok(a.surfaceSpeedMps > b.surfaceSpeedMps);
});

test('long flights keep checkpoints below browser quota and preserve the sampled history endpoints', () => {
  const flight = new LaunchDynamics(launchVehicles.dart);
  const row = physicsSample(flight);
  flight.trajectory = Array.from({ length: 7200 }, (_, simulationTimeS) => ({ ...row, simulationTimeS }));
  flight.lastRecordS = flight.trajectory.at(-1).simulationTimeS;
  const snapshot = flight.snapshot();
  assert.equal(flight.trajectory.length, 7200);
  assert.ok(JSON.stringify(snapshot).length < 1024 * 1024);
  assert.deepEqual(snapshot.trajectory[0], flight.trajectory[0]);
  assert.deepEqual(snapshot.trajectory.at(-1), flight.trajectory.at(-1));
  const restored = LaunchDynamics.restore(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(restored.snapshot(), snapshot);
});

test('HUD, diagnostics, pressure and simulation read one physical state', () => {
  const s = new FlightState('mars_2020'); s.update(60);
  assert.ok(s.position.clone().multiplyScalar(1000).distanceTo(s.launch.positionM) < 1e-7);
  assert.equal(s.speed, s.launch.velocityMps.length());
  assert.equal(s.altitude, Math.max(0, (s.launch.positionM.length() - EARTH_RADIUS_M) / 1000));
  assert.equal(s.systems.pressure, s.launch.dynamicPressurePa / 1000);
  assert.equal(s.totalTime, s.launch.time);
  const sample = physicsSample(s.launch);
  assert.equal(sample.surfaceSpeedMps, s.speed); assert.equal(sample.massKg, s.massKg);
  assert.match(trajectoryCSV([sample]), /simulationTimeS,xM,yM,zM/);
});

test('restart returns to the exact geographical pad without residual momentum', () => {
  const old = new FlightState('voyager_2'); old.update(80);
  const fresh = new FlightState('voyager_2');
  assert.equal(fresh.launch.positionM.distanceTo(PAD_POSITION_M), 0);
  assert.equal(fresh.launch.velocityMps.length(), 0); assert.equal(fresh.timeline.clock.seconds, -10);
  assert.equal(padLocalPosition(fresh.launch.positionM).length(), 0);
});

test('custom craft uses actual assembled mass, tanks and engine ratings', () => {
  const specs = new Map([
    ['tank',{ massKg: 500, stats: { propellant:'kerolox', capacityKg:10000, mountDiameterM:2.5 } }],
    ['engine',{ massKg:300, stats: { propellant:'kerolox', thrustKN:{ seaLevel:125, vacuum:145 }, specificImpulseS:{ seaLevel:275, vacuum:319 } } }],
    ['payload',{ massKg:700, stats:{} }],
  ]);
  const vehicle = vehicleFromAssembly(['tank','engine','payload'].map(part=>({part})), specs);
  const p = new LaunchDynamics(vehicle);
  assert.equal(p.massKg, 11500); assert.equal(p.fuelMassKg, 10000);
  assert.equal(vehicle.stages[0].seaThrustN, 125000);
  assert.notEqual(vehicle.stages[0].seaThrustN, launchVehicles.apollo_11.stages[0].seaThrustN);
});

test('rotating/floating rendering frame cannot move emission points in the physical world', () => {
  const trail = new WorldSmokeTrail();
  for (let i=0;i<20;i++) trail.sample(i, true, PAD_POSITION_M.clone().addScaledVector(PAD_UP, i*i*8).addScaledVector(PAD_EAST, i));
  const origin = PAD_POSITION_M.clone().addScaledVector(PAD_UP, 4000);
  for (const angle of [0,.2,1.5]) {
    const rotation = new Quaternion().setFromAxisAngle(PAD_NORTH, angle), inverse = rotation.clone().invert();
    for (const puff of trail.points) {
      const local = trail.renderPosition(puff, 20, origin, inverse);
      const reconstructed = local.applyQuaternion(rotation).add(origin).addScaledVector(trail.windMps, -(20-puff.time));
      assert.ok(reconstructed.distanceTo(puff.point) < 1e-7);
    }
  }
  const count = trail.points.length; trail.sample(19, true, PAD_POSITION_M);
  assert.equal(trail.points.length, count, 'paused time cannot duplicate smoke emissions');
});

test('exhaust selects every active engine including radial boosters, and ignores an unlit core', () => {
  const model = new Group();
  for (const [id,y] of [['core',0],['left-booster',4],['right-booster',4]]) {
    const owner = new Group(); owner.userData.partId=id; owner.position.y=y;
    const bell = new Mesh(new CylinderGeometry(1,2,3), new MeshBasicMaterial()); bell.userData.partId=`${id}.bell`; owner.add(bell); model.add(owner);
  }
  assert.equal(activeNozzles(model,['left-booster','right-booster']).length,2);
  assert.equal(activeNozzles(model,['core','left-booster','right-booster']).length,3);
});
