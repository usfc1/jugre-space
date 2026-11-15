import { Euler, Quaternion, Vector3, MathUtils } from 'three';
import { terrainHeight, surfaceRocks } from './planet-terrain.mjs';

export const landerConfigs = {
  moon: { educational: true, gravity: 1.62, dryKg: 12400, initialFuelKg: 900, thrustN: 45000, ispS: 311, probeM: 2.2 },
  mars: { educational: true, gravity: 3.71, dryKg: 2000, initialFuelKg: 450, thrustN: 30000, ispS: 225, probeM: .6 },
};
export function landingQuality(vertical, horizontal, tiltDeg, safe = true) {
  if (!safe || vertical > 3 || horizontal > 1.2 || tiltDeg > 12) return 'crashed';
  return vertical <= 1 ? 'excellent' : 'hard';
}
export class LanderControl {
  constructor(body = 'moon', saved = null) {
    this.body = body; this.config = landerConfigs[body];
    this.p = new Vector3(0, 300, 0); this.v = new Vector3(0, -1, 0); this.q = new Quaternion();
    this.rate = new Vector3(); this.fuelKg = this.config.initialFuelKg; this.throttle = 0;
    this.descentMps = -1; this.velocityHold = true; this.contact = false; this.status = 'descending';
    this.alarm = body === 'moon' ? '1202 · GO / NO-GO' : null; this.alarms = new Set(); this.elapsed = 0;
    if (saved) this.restore(saved);
  }
  get massKg() { return this.config.dryKg + this.fuelKg; }
  get fuelSeconds() { return this.fuelKg * this.config.ispS * 9.80665 / Math.max(this.massKg * this.config.gravity, this.throttle * this.config.thrustN); }
  choose(go, emit) { this.alarm = null; emit('computerDecision', { go }); if (!go) this.abort(emit); }
  abort(emit) { this.status = 'failed'; emit('landingAbort', { reason: 'Ascent abort model unavailable' }); }
  safeAt(x, z) {
    const h = terrainHeight(this.body, x, z);
    const slope = Math.hypot(terrainHeight(this.body, x + 1, z) - h, terrainHeight(this.body, x, z + 1) - h);
    return slope <= Math.tan(12 * Math.PI / 180) && !surfaceRocks().some(r => r.radius > .3 && Math.hypot(r.x - x, r.z - z) < r.radius + 2);
  }
  advance(dt, axes = {}, actions = new Set(), automatic = false, emit = () => {}) {
    if (this.status !== 'descending') return;
    if (actions.has('descentUp')) this.descentMps -= .3;
    if (actions.has('descentDown')) this.descentMps = Math.min(0, this.descentMps + .3);
    while (dt > 1e-9 && this.status === 'descending') {
      const step = Math.min(.02, dt); dt -= step; this.elapsed += step;
      const c = this.config, h = terrainHeight(this.body, this.p.x, this.p.z);
      const altitude = this.p.y - h;
      if (automatic) { if (this.alarm) this.choose(true, emit); this.descentMps = altitude < 10 ? -.6 : -Math.min(5, Math.max(1, altitude / 35)); }
      const targetRate = new Vector3(-(axes.pitch ?? 0), axes.yaw ?? 0, -(axes.roll ?? 0)).multiplyScalar(.12);
      this.rate.lerp(targetRate, 1 - Math.exp(-4 * step));
      if (automatic) this.q.rotateTowards(new Quaternion(), step * .12);
      else this.q.multiply(new Quaternion().setFromEuler(new Euler(...this.rate.clone().multiplyScalar(step).toArray()))).normalize();
      const up = new Vector3(0, 1, 0).applyQuaternion(this.q);
      if (axes.throttle) { this.velocityHold = false; this.throttle = MathUtils.clamp(this.throttle + axes.throttle * step * .3, 0, 1); }
      if (automatic || this.velocityHold) this.throttle = MathUtils.clamp((c.gravity + (this.descentMps - this.v.y) * .8) * this.massKg / (c.thrustN * Math.max(.3, up.y)), 0, 1);
      if (automatic && this.contact) { this.throttle = 0; if (!this.alarms.has('shutdown')) { this.alarms.add('shutdown'); emit('contactShutdown', { contact: true, thrustN: 0 }); } }
      const fuel = Math.min(this.fuelKg, this.throttle * c.thrustN * step / (c.ispS * 9.80665));
      const force = fuel * c.ispS * 9.80665 / step;
      this.fuelKg -= fuel;
      this.v.addScaledVector(up, force / this.massKg * step); this.v.y -= c.gravity * step;
      this.p.addScaledVector(this.v, step);
      for (const [n, label] of [[60, '60 seconds'], [30, '30 seconds'], [10, 'Bingo']]) {
        if (this.fuelSeconds <= n && !this.alarms.has(label)) { this.alarms.add(label); emit('fuelCall', { label }); }
      }
      if (!this.contact && altitude <= c.probeM) { this.contact = true; emit('probeContact', { label: 'Contact light' }); }
      if (this.p.y <= h) {
        const tiltDeg = up.angleTo(new Vector3(0, 1, 0)) * 180 / Math.PI;
        this.status = landingQuality(Math.abs(this.v.y), Math.hypot(this.v.x, this.v.z), tiltDeg, this.safeAt(this.p.x, this.p.z));
        this.touchdown = { verticalMps: Math.abs(this.v.y), horizontalMps: Math.hypot(this.v.x, this.v.z), tiltDeg, status: this.status,
          rangeM: Math.hypot(this.p.x, this.p.z), reserveS: this.fuelSeconds };
        this.p.y = h; this.v.set(0, 0, 0); emit('landerTouchdown', this.touchdown);
      } else if (this.fuelKg <= 0) { this.status = 'failed'; emit('landingFuelExhausted', {}); }
    }
  }
  shutdown() { this.velocityHold = false; this.throttle = 0; }
  serialize() { return { version: 1, body: this.body, p: this.p.toArray(), v: this.v.toArray(), q: this.q.toArray(), rate: this.rate.toArray(),
    fuelKg: this.fuelKg, throttle: this.throttle, descentMps: this.descentMps, velocityHold: this.velocityHold, contact: this.contact,
    status: this.status, alarm: this.alarm, alarms: [...this.alarms], elapsed: this.elapsed, touchdown: this.touchdown }; }
  restore(s) {
    if (s.version !== 1 || ![s.fuelKg, s.throttle, s.descentMps, s.elapsed].every(Number.isFinite) || s.fuelKg < 0) throw new Error('Invalid lander state');
    for (const [key, n] of [['p', 3], ['v', 3], ['q', 4], ['rate', 3]]) {
      if (!Array.isArray(s[key]) || s[key].length !== n || !s[key].every(Number.isFinite)) throw new Error('Invalid lander pose');
      this[key].fromArray(s[key]);
    }
    for (const key of ['fuelKg', 'throttle', 'descentMps', 'velocityHold', 'contact', 'status', 'alarm', 'elapsed', 'touchdown']) this[key] = s[key];
    this.alarms = new Set(s.alarms);
  }
}
