import { MathUtils, Vector3 } from 'three';
import { EARTH_MU, EARTH_OMEGA, G0, surfaceToInertialVelocity } from './flight-coordinates.mjs';

export const sasDirections = {
  hold: 'Hold', prograde: 'Prograde', retrograde: 'Retrograde',
  normal: 'Normal', antinormal: 'Antinormal', radial: 'Radial out', antiradial: 'Radial in',
};
export function rocketDirection(engine, mode) {
  const radial = engine.positionM.clone().normalize();
  const velocity = surfaceToInertialVelocity(engine.positionM, engine.velocityMps);
  const normal = engine.positionM.clone().cross(velocity).normalize();
  switch (mode) {
    case 'prograde': return velocity.normalize();
    case 'retrograde': return velocity.normalize().negate();
    case 'normal': return normal;
    case 'antinormal': return normal.negate();
    case 'radial': return radial;
    case 'antiradial': return radial.negate();
    default: return new Vector3().fromArray(engine.rocketControl.hold);
  }
}
export function rocketControlDefaults(saved) {
  const value = { version: 1, sasMode: 'hold', hold: [0, 1, 0], maneuver: null };
  if (!saved) return value;
  if (saved.version !== 1 || !Object.hasOwn(sasDirections, saved.sasMode)
    || !Array.isArray(saved.hold) || saved.hold.length !== 3 || !saved.hold.every(Number.isFinite)
    || Math.abs(Math.hypot(...saved.hold) - 1) > .01) throw new Error('Invalid rocket control state');
  value.sasMode = saved.sasMode;
  value.hold = [...saved.hold];
  if (saved.maneuver) {
    const m = saved.maneuver;
    if (!['planned', 'armed', 'complete', 'cancelled', 'failed'].includes(m.status)
      || !Object.hasOwn(sasDirections, m.direction) || m.direction === 'hold'
      || !['startS','deltaVMps','deliveredMps'].every(k => Number.isFinite(m[k]) && m[k] >= 0)
      || m.deltaVMps <= 0 || m.deltaVMps > 20000) throw new Error('Invalid maneuver node');
    value.maneuver = { ...m };
  }
  return value;
}
export function planRocketManeuver(engine, delayS, deltaVMps, direction) {
  if (![delayS, deltaVMps].every(Number.isFinite) || delayS < 0 || delayS > 86400
    || deltaVMps <= 0 || deltaVMps > 20000 || !Object.hasOwn(sasDirections, direction) || direction === 'hold') {
    throw new Error('Set a delay of 0–86400 s, Δv of 0–20000 m/s, and a direction.');
  }
  if (engine.onPad || engine.crashed || engine.stages[engine.stageIndex].fuelKg <= 0) throw new Error('Maneuver requires an airborne stage with fuel.');
  engine.rocketControl.maneuver = { startS: engine.time + delayS, deltaVMps, direction, deliveredMps: 0, status: 'planned' };
}
export function steerRocket(engine, dt, controls) {
  const attitude = engine.rocketControl;
  const input = controls.pitch || controls.yaw || controls.roll;
  if (!controls.sas || input) {
    attitude.hold = engine.thrustDirection.toArray();
    return;
  }
  const target = rocketDirection(engine, attitude.sasMode);
  if (target.lengthSq() < .5) return;
  const angle = engine.thrustDirection.angleTo(target);
  if (angle > 1e-10) {
    const axis = engine.thrustDirection.clone().cross(target);
    if (axis.lengthSq() < 1e-12) axis.crossVectors(engine.thrustDirection, new Vector3(1, 0, 0));
    if (axis.lengthSq() < 1e-12) axis.crossVectors(engine.thrustDirection, new Vector3(0, 0, 1));
    engine.thrustDirection.applyAxisAngle(axis.normalize(), Math.min(angle, dt * MathUtils.degToRad(engine.vehicle.guidance.maxPitchRateDegS)));
  }
}
export function rocketReadings(engine) {
  const stage = engine.vehicle.stages[engine.stageIndex];
  const fuel = engine.stages[engine.stageIndex].fuelKg;
  const localG = EARTH_MU / engine.positionM.lengthSq();
  return { altitudeM: engine.altitudeM, verticalMps: engine.verticalSpeedMps, horizontalMps: engine.horizontalSpeedMps,
    qPa: engine.dynamicPressurePa, properG: engine.properG, accelerationMps2: engine.accelerationMps2.length(),
    apoapsisM: engine.orbit.apoapsisM, periapsisM: engine.orbit.periapsisM,
    twr: engine.thrustN / (engine.massKg * localG),
    deltaVMps: stage.vacuumIspS * G0 * Math.log(engine.massKg / Math.max(1, engine.massKg - fuel)),
    warnings: [engine.dynamicPressurePa > engine.vehicle.guidance.maxDynamicPressurePa && 'Dynamic pressure exceeded',
      engine.properG > engine.vehicle.guidance.maxG && 'G limit exceeded',
      fuel < stage.propellantKg * .12 && 'Low fuel'].filter(Boolean) };
}
export function rotateHoldWithEarth(engine, dt) {
  if (engine.rocketControl.sasMode === 'hold') {
    engine.rocketControl.hold = new Vector3().fromArray(engine.rocketControl.hold)
      .applyAxisAngle(new Vector3(0, 1, 0), -EARTH_OMEGA * dt).toArray();
  }
}
