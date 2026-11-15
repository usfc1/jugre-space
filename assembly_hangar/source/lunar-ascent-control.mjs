import { Quaternion, Vector3, Euler, MathUtils } from 'three';
import { orbitShape } from './orbital-propagator.mjs';
export const lunarAscentConfig = { educational: true, radiusM: 1737400, mu: 4.902800066e12,
  dryKg: 2150, fuelKg: 2350, thrustN: 15600, ispS: 311, windowToleranceS: 60 };
export class LunarAscentControl {
  constructor(sampleKg = 0, saved = null) {
    this.p = new Vector3(0, lunarAscentConfig.radiusM, 0); this.v = new Vector3(); this.q = new Quaternion();
    this.sampleKg = sampleKg; this.fuelKg = lunarAscentConfig.fuelKg; this.elapsed = 0; this.status = 'armed'; this.orbit = null;
    if (saved) {
      if (saved.version !== 1 || ![saved.sampleKg, saved.fuelKg, saved.elapsed].every(Number.isFinite)) throw new Error('Invalid lunar ascent state');
      for (const k of ['sampleKg', 'fuelKg', 'elapsed', 'status', 'orbit']) this[k] = structuredClone(saved[k]);
      for (const k of ['p', 'v', 'q']) { if (!saved[k]?.every(Number.isFinite)) throw new Error('Invalid ascent stage pose'); this[k].fromArray(saved[k]); }
    }
  }
  get massKg() { return lunarAscentConfig.dryKg + this.sampleKg + this.fuelKg; }
  ignite(windowErrorS = 0) {
    if (this.status !== 'armed' || Math.abs(windowErrorS) > lunarAscentConfig.windowToleranceS) return false;
    this.status = 'ascending'; return true;
  }
  advance(dt, axes = {}, automatic = true, emit = () => {}) {
    const c = lunarAscentConfig;
    if (this.status === 'armed' && automatic) { this.ignite(); emit('lunarAscentIgnition', { windowErrorS: 0, throttle: 1, massKg: this.massKg }); }
    while (dt > 1e-9 && !['armed', 'failed'].includes(this.status)) {
      const step = Math.min(.1, dt); dt -= step; this.elapsed += step;
      const radius = this.p.length(), up = this.p.clone().normalize(), g = c.mu / (radius * radius);
      const radialSpeed = this.v.dot(up), horizontal = this.v.clone().addScaledVector(up, -radialSpeed);
      const tangent = horizontal.lengthSq() > .01 ? horizontal.normalize() : new Vector3(1, 0, 0);
      const tangentialSpeed = this.v.dot(tangent), altitude = radius - c.radiusM;
      if (this.status === 'ascending') {
        if (automatic) {
          const desiredVr = MathUtils.clamp((70000 - altitude) * .005, -50, 180);
          const radialAccel = g - tangentialSpeed * tangentialSpeed / radius + (desiredVr - radialSpeed) * .035;
          const thrustAccel = c.thrustN / this.massKg;
          const fraction = MathUtils.clamp(radialAccel / thrustAccel, -.95, 1);
          const desired = up.multiplyScalar(fraction).addScaledVector(tangent, Math.sqrt(Math.max(0, 1 - fraction * fraction)));
          const target = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), desired);
          this.q.rotateTowards(target, .05 * step);
        } else this.q.multiply(new Quaternion().setFromEuler(new Euler(-(axes.pitch ?? 0) * .08 * step, (axes.yaw ?? 0) * .08 * step, -(axes.roll ?? 0) * .08 * step))).normalize();
        const consumed = Math.min(this.fuelKg, c.thrustN * step / (c.ispS * 9.80665));
        this.fuelKg -= consumed;
        this.v.addScaledVector(new Vector3(0, 1, 0).applyQuaternion(this.q), consumed * c.ispS * 9.80665 / this.massKg);
      }
      this.v.addScaledVector(this.p, -c.mu / radius ** 3 * step); this.p.addScaledVector(this.v, step);
      const shape = orbitShape(this.p.clone().multiplyScalar(.001), this.v.clone().multiplyScalar(.001), c.mu * 1e-9);
      this.orbit = { periapsisM: shape.periapsis * 1000 - c.radiusM, apoapsisM: shape.a * (1 + shape.eccentricity) * 1000 - c.radiusM, energy: shape.energy };
      if (this.status === 'ascending' && this.orbit.periapsisM >= 10000 && this.orbit.apoapsisM < 200000) { this.status = 'orbit'; emit('lunarAscentOrbit', { ...this.orbit, fuelKg: this.fuelKg, sampleKg: this.sampleKg }); }
      if (this.p.length() < c.radiusM - 1 || this.fuelKg <= 0 && this.status !== 'orbit') { this.status = 'failed'; emit('lunarAscentFailed', { fuelKg: this.fuelKg, altitudeM: this.p.length() - c.radiusM }); }
    }
  }
  serialize() { return { version: 1, p: this.p.toArray(), v: this.v.toArray(), q: this.q.toArray(), sampleKg: this.sampleKg,
    fuelKg: this.fuelKg, elapsed: this.elapsed, status: this.status, orbit: this.orbit }; }
}
