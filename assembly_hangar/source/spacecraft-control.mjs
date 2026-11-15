import { Vector3 } from 'three';

// Educational RCS budget; individual thruster plumbing is not simulated.
export const rcsConfig = Object.freeze({ educational: true, initialFuelKg: 120, ispS: 220,
  forceN: 220, angularAcceleration: .025, maxRate: Math.PI / 12 });
export function restoreRcs(saved) {
  const fuelKg = saved?.fuelKg ?? rcsConfig.initialFuelKg;
  if (!Number.isFinite(fuelKg) || fuelKg < 0 || fuelKg > rcsConfig.initialFuelKg) throw new Error('Invalid RCS fuel');
  return { version: 1, fuelKg, usedKg: rcsConfig.initialFuelKg - fuelKg };
}
export function rcsCommand(resource, axes, control, massKg, dt, angularVelocity = new Vector3()) {
  const scale = control.precision ? .25 : 1;
  const force = new Vector3(axes.lateral ?? 0, axes.vertical ?? 0, -(axes.longitudinal ?? 0)).clampLength(0, 1).multiplyScalar(rcsConfig.forceN * scale);
  const angular = new Vector3(-(axes.pitch ?? 0), axes.yaw ?? 0, axes.roll ?? 0).clampLength(0, 1).multiplyScalar(rcsConfig.angularAcceleration * scale);
  if (control.sas || control.assistance === 'arcade') angular.addScaledVector(angularVelocity, -2).clampLength(0, rcsConfig.angularAcceleration);
  if (!control.rcs || resource.fuelKg <= 0 || dt <= 0) return { acceleration: new Vector3(), angular: new Vector3(), usedKg: 0 };
  const demand = (force.length() + angular.length() / rcsConfig.angularAcceleration * rcsConfig.forceN) * dt / (rcsConfig.ispS * 9.80665);
  const usedKg = Math.min(resource.fuelKg, demand), fraction = demand ? usedKg / demand : 1;
  resource.fuelKg -= usedKg; resource.usedKg = rcsConfig.initialFuelKg - resource.fuelKg;
  return { acceleration: force.multiplyScalar(fraction / Math.max(1, massKg)), angular: angular.multiplyScalar(fraction), usedKg };
}
export function targetInFov(origin, attitude, target, halfAngleDeg = 15, axis = new Vector3(0, 0, -1)) {
  const delta = target.clone().sub(origin);
  return delta.lengthSq() > 1e-10 && axis.clone().applyQuaternion(attitude).angleTo(delta) <= halfAngleDeg * Math.PI / 180;
}
