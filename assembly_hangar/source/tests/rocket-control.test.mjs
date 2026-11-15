import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { LaunchDynamics } from '../launch-dynamics.mjs';
import { launchVehicles } from '../launch-vehicles.mjs';
import { EARTH_MU, EARTH_OMEGA, surfaceToInertialVelocity } from '../flight-coordinates.mjs';
import { planRocketManeuver, rocketDirection, rocketReadings } from '../rocket-control.mjs';

function upperStage() {
  const vehicle = structuredClone(launchVehicles.apollo_11);
  vehicle.stages = [vehicle.stages.at(-1)];
  const engine = new LaunchDynamics(vehicle);
  const radius = 6371000 + 300000, a = 6371000 + 240000;
  const speed = Math.sqrt(EARTH_MU * (2 / radius - 1 / a));
  engine.positionM.set(radius, 0, 0);
  engine.velocityMps.set(0, 0, -speed + EARTH_OMEGA * radius);
  engine.thrustDirection.set(0, 0, -1);
  engine.rocketControl.hold = engine.thrustDirection.toArray();
  engine.pitch = 90; engine.yaw = 0; engine.onPad = false;
  engine.stages[0].fuelKg = 12000;
  engine.measure();
  return engine;
}
const controls = { mode: 'manual', rocketTest: true, sas: true, throttle: 1 };

test('measured circularization consumes stage fuel and resumes the same mid-burn trajectory', () => {
  const e = upperStage();
  const dv = Math.sqrt(EARTH_MU / e.positionM.length()) - surfaceToInertialVelocity(e.positionM, e.velocityMps).length();
  planRocketManeuver(e, 0, dv, 'prograde');
  e.rocketControl.maneuver.status = 'armed';
  const fuel = e.fuelMassKg;
  e.advance(2, controls);
  const resumed = LaunchDynamics.restore(e.snapshot());
  assert.ok(e.rocketControl.maneuver.deliveredMps > 0);
  for (let i = 0; i < 1000 && e.rocketControl.maneuver.status !== 'complete'; i++) {
    e.advance(.1, controls); resumed.advance(.1, controls);
  }
  assert.equal(e.rocketControl.maneuver.status, 'complete');
  assert.ok(e.fuelMassKg < fuel);
  assert.ok(e.positionM.distanceTo(resumed.positionM) < 1e-5);
  assert.ok(e.velocityMps.distanceTo(resumed.velocityMps) < 1e-6);
  assert.ok(Math.abs(e.orbit.apoapsisM - e.orbit.periapsisM) < 5000);
  e.advance(1, controls);
  assert.equal(e.thrustN, 0);
});
test('SAS directions slew with the vehicle rate limit and reach their educational tolerance', () => {
  for (const mode of ['prograde', 'retrograde', 'normal', 'radial', 'antiradial']) {
    const e = upperStage();
    e.rocketControl.sasMode = mode;
    const before = e.thrustDirection.clone();
    e.advance(1 / 120, { ...controls, throttle: 0 });
    assert.ok(before.angleTo(e.thrustDirection) < .001);
    for (let i = 0; i < 300; i++) e.advance(1, { ...controls, throttle: 0 });
    assert.ok(e.thrustDirection.angleTo(rocketDirection(e, mode)) < .04, mode);
  }
});
test('unflyable stages retain a failed trajectory and empty stage has zero available delta-v', () => {
  const e = new LaunchDynamics(launchVehicles.apollo_11);
  e.vehicle.stages[0].seaThrustN = 1;
  e.advance(30, controls);
  assert.equal(e.onPad, true);
  assert.equal(e.orbitAchieved, false);
  e.stages[0].fuelKg = 0;
  e.measure();
  assert.equal(rocketReadings(e).deltaVMps, 0);
  assert.throws(() => planRocketManeuver(e, 0, 100, 'prograde'));
});
