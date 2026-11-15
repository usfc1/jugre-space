import { Vector3 } from 'three';
import { atmosphere, EARTH_MU, EARTH_OMEGA, EARTH_RADIUS_M, G0 } from './flight-coordinates.mjs';

const rotation = new Vector3(0, EARTH_OMEGA, 0);
const heatCoefficient = 1.74153e-4;
const heatLimitJm2 = 300e6;
const accelerationLimitG = 13;
const chuteAltitudeM = 8000;
const capsuleAreaM2 = 19;
const chuteAreaM2 = 2200;
const waterLimitMps = 13;

function forces(r, v, massKg, opening) {
  const altitude = r.length() - EARTH_RADIUS_M;
  const relative = v.clone().sub(new Vector3().crossVectors(rotation, r));
  const speed = relative.length();
  const density = atmosphere(altitude).density;
  const area = capsuleAreaM2 + (chuteAreaM2 - capsuleAreaM2) * opening;
  const drag = .5 * density * speed ** 2 * area / massKg;
  const proper = speed > 0 ? relative.clone().multiplyScalar(-drag / speed) : new Vector3();
  if (!opening && speed > 1000 && altitude < 110000) {
    const radial = r.clone().normalize();
    const axis = relative.clone().normalize();
    const lift = radial.addScaledVector(axis, -radial.dot(axis)).normalize();
    // Banked direct-entry guidance reduces radial lift near a skip trajectory.
    const descent = -relative.dot(r.clone().normalize());
    proper.addScaledVector(lift, .16 * drag * Math.max(0, Math.min(1, (descent - 120) / 200)));
  }
  const gravity = r.clone().multiplyScalar(-EARTH_MU / r.length() ** 3);
  return { acceleration: proper.clone().add(gravity), proper, properG: proper.length() / G0, speed, altitude,
    heat: opening ? 0 : heatCoefficient * Math.sqrt(density / 2.4) * speed ** 3 };
}

export function initialEntry(positionKm, velocityKms, profile = 'lunar') {
  const altitudeM = positionKm.length() * 1000 - EARTH_RADIUS_M;
  const gammaDeg = Math.asin(velocityKms.dot(positionKm.clone().normalize()) / velocityKms.length()) * 180 / Math.PI;
  const [min, max] = profile === 'dragon' ? [-4.5, -1.2] : [-6.7, -5.2];
  if (Math.abs(altitudeM - 120000) > 100 || !(gammaDeg >= min && gammaDeg <= max) || velocityKms.length() > 11.5) throw new Error('Capsule outside entry corridor');
  return { position: positionKm.clone().multiplyScalar(1000).toArray(), velocity: velocityKms.clone().multiplyScalar(1000).toArray(),
    gammaDeg, elapsedS: 0, heatJm2: 0, peakG: 0, chute: false, opening: 0, landed: false, landingSpeedMps: null,
    ...(profile === 'dragon' ? { drogue: false, profile } : {}) };
}

export function stepEntry(entry, dt, massKg) {
  if (entry.landed || dt <= 0) return null;
  const r = new Vector3().fromArray(entry.position), v = new Vector3().fromArray(entry.velocity);
  const start = forces(r, v, massKg, entry.opening);
  if (entry.profile === 'dragon' && !entry.drogue && start.altitude <= 5500 && start.speed <= 190) entry.drogue = true;
  if (!entry.chute && start.altitude <= (entry.profile === 'dragon' ? 2000 : chuteAltitudeM) && start.speed <= (entry.profile === 'dragon' ? 112 : 155)) {
    entry.chute = true;
  }
  // Explicit midpoint integration. Short parachute steps resolve deployment drag.
  let remaining = dt;
  let final = start;
  while (remaining > 1e-9) {
    const step = Math.min(remaining, entry.chute ? .025 : .1);
    const k1 = forces(r, v, massKg, entry.opening);
    const next = entry.chute ? Math.min(1, entry.opening + step / 12) : entry.drogue ? .045 : 0;
    const mid = forces(r.clone().addScaledVector(v, step / 2), v.clone().addScaledVector(k1.acceleration, step / 2), massKg, (entry.opening + next) / 2);
    entry.opening = next;
    r.addScaledVector(v.clone().addScaledVector(k1.acceleration, step / 2), step);
    v.addScaledVector(mid.acceleration, step);
    entry.heatJm2 += mid.heat * step;
    entry.peakG = Math.max(entry.peakG, mid.properG);
    entry.elapsedS += step;
    remaining -= step;
    final = forces(r, v, massKg, entry.opening);
    if (final.altitude <= 0) {
      entry.landingSpeedMps = final.speed;
      entry.landed = Boolean(entry.chute && final.speed <= waterLimitMps);
      r.setLength(EARTH_RADIUS_M);
      break;
    }
  }
  entry.position = r.toArray();
  entry.velocity = v.toArray();
  const reason = !entry.landed && final.altitude <= 0 ? 'Unsafe splashdown speed'
    : entry.heatJm2 > heatLimitJm2 ? 'Capsule heat limit exceeded'
    : entry.peakG > accelerationLimitG ? 'G limit exceeded'
    : final.altitude > 122000 ? 'Capsule skipped out of the atmosphere' : null;
  return { altitudeM: Math.max(0, final.altitude), speedMps: entry.landed ? 0 : final.speed, properG: final.properG, proper: final.proper, reason };
}
