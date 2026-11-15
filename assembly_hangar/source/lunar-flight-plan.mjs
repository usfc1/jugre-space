import { Vector3 } from 'three';
import { EARTH_RADIUS_M, surfaceToInertialVelocity } from './flight-coordinates.mjs';
import { EARTH_GM, keplerState, lambertState, MOON_GM, orbitShape } from './orbital-propagator.mjs';
import { timedEncounter } from './lunar-trajectory.mjs';

export const entryAltitudeKm = 120;
const moonRadiusKm = 1737.4;
const degrees = 180 / Math.PI;

export function planLunarDeparture(launch, moon, spec) {
  const start = launch.positionM.clone().multiplyScalar(.001);
  const velocity = surfaceToInertialVelocity(launch.positionM, launch.velocityMps).multiplyScalar(.001);
  const normal = start.clone().cross(velocity).normalize();
  // Coplanar teaching geometry. Keep the reference longitude in the measured parking plane.
  const center = moon.clone().projectOnPlane(normal).setLength(moon.length());
  const periapsis = moonRadiusKm + spec.orbit.periapsisM / 1000;
  const candidates = [];
  for (let i = 0; i < 48; i++) {
    const waitS = launch.orbit.periodS * (i + 1) / 48;
    const sample = keplerState(start, velocity, waitS);
    for (const longWay of [false, true]) {
      try {
        const { departureVelocity } = lambertState(sample.position, center, spec.transferS, EARTH_GM, longWay);
        candidates.push({ waitS, sample, longWay, screening: departureVelocity.distanceTo(sample.velocity) });
      } catch { /* The Lambert solver excludes degenerate endpoints. */ }
    }
  }
  let solution;
  for (const { waitS, sample, longWay } of candidates.sort((a, b) => a.screening - b.screening).slice(0, 8)) {
    try {
      const leg = timedEncounter(sample.position, center, spec.transferS, periapsis, longWay);
      if (orbitShape(sample.position, leg.departureVelocity, EARTH_GM).periapsis < EARTH_RADIUS_M / 1000 + 100) continue;
      const dv = leg.departureVelocity.distanceTo(sample.velocity);
      if (!solution || dv < solution.dv) solution = { waitS, sample, leg, dv };
    } catch { /* Candidates may miss the lunar encounter constraint. */ }
  }
  if (!solution) throw new Error('No departure window in the current orbit plane');
  const { waitS, sample, leg, dv } = solution;
  return { waitS, center: center.toArray(), tliMps: dv * 1000, departure: sample.position.toArray(),
    departureVelocity: leg.departureVelocity.toArray(), patchPosition: leg.local.toArray(), patchVelocity: leg.arrivalVelocity.toArray(),
    earthS: leg.earthTime, moonS: leg.moonTime };
}

const vector = value => new Vector3().fromArray(value);

export function lunarOutbound(plan) {
  const { earthS, moonS } = plan;
  const center = vector(plan.center);
  const start = vector(plan.departure), velocity = vector(plan.departureVelocity);
  const patch = vector(plan.patchPosition), lunarVelocity = vector(plan.patchVelocity);
  return { physical: true, model: 'lunar-outbound', soiEntryS: earthS, isPowered: () => false, sample(time) {
    if (time < earthS) return { ...keplerState(start, velocity, time), proper: new Vector3(), reference: 'earth' };
    const state = keplerState(patch, lunarVelocity, Math.min(moonS, time - earthS), MOON_GM);
    return { ...state, position: state.position.add(center), proper: new Vector3(), reference: 'moon' };
  } };
}

export function captureVelocity(relativePosition, approachVelocity, apoapsisM) {
  const radius = relativePosition.length();
  const semimajor = (radius + moonRadiusKm + apoapsisM / 1000) / 2;
  const tangent = relativePosition.clone().cross(approachVelocity).normalize().cross(relativePosition).normalize();
  return tangent.multiplyScalar(Math.sqrt(MOON_GM * (2 / radius - 1 / semimajor)));
}

export function lunarCoast(center, localStart, velocity) {
  return { physical: true, model: 'lunar-orbit', isPowered: () => false, sample(time) {
    const state = keplerState(localStart, velocity, time, MOON_GM);
    return { ...state, position: state.position.add(center), proper: new Vector3(), reference: 'moon' };
  } };
}

export function returnOpportunity(center, localStart, velocity, orbitS, returnS) {
  const radius = localStart.length();
  const shape = orbitShape(localStart, velocity, MOON_GM);
  const period = 2 * Math.PI * Math.sqrt(shape.a ** 3 / MOON_GM);
  const normal = shape.h.clone().normalize();
  // Solve a reversed patch from the 120 km entry boundary to lunar periapsis.
  // A scalar root targets a direct entry angle in the orbital plane.
  function target(angle) {
    const start = center.clone().normalize().applyAxisAngle(normal, angle / degrees).multiplyScalar(EARTH_RADIUS_M / 1000 + entryAltitudeKm);
    const leg = timedEncounter(start, center, returnS, radius);
    const gamma = -Math.asin(leg.departureVelocity.dot(start.clone().normalize()) / leg.departureVelocity.length()) * degrees;
    return { leg, start, gamma };
  }
  let lo = -179.8, hi = -150;
  for (let i = 0; i < 15; i++) {
    const angle = (lo + hi) / 2;
    if (target(angle).gamma > -5.9) lo = angle;
    else hi = angle;
  }
  const { leg, start, gamma } = target((lo + hi) / 2);
  if (Math.abs(gamma + 5.9) > .05) throw new Error('Return trajectory outside entry corridor');
  const lunar = keplerState(leg.local, leg.arrivalVelocity, leg.moonTime, MOON_GM);
  // Circular parking orbit makes the arrival point reachable by coasting.
  const angle = Math.atan2(localStart.clone().cross(lunar.position).dot(normal), localStart.dot(lunar.position));
  const firstS = (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI) * period;
  const departureS = firstS + Math.max(0, Math.ceil((orbitS - firstS) / period)) * period;
  const actual = keplerState(localStart, velocity, departureS, MOON_GM);
  if (actual.position.distanceTo(lunar.position) > .5) throw new Error('Injection point unavailable in the selected lunar orbit');
  return { departureS, teiMps: actual.velocity.distanceTo(lunar.velocity.clone().negate()) * 1000,
    lunarPosition: lunar.position.toArray(), lunarVelocity: lunar.velocity.negate().toArray(),
    entryPosition: start.toArray(), reverseVelocity: leg.departureVelocity.toArray(), earthS: returnS - leg.moonTime, moonS: leg.moonTime };
}

export function lunarReturn(center, plan) {
  const lunarPosition = vector(plan.lunarPosition), lunarVelocity = vector(plan.lunarVelocity);
  const entry = vector(plan.entryPosition), reverseVelocity = vector(plan.reverseVelocity);
  return { physical: true, model: 'lunar-return', isPowered: () => false, sample(time) {
    if (time < plan.moonS) {
      const state = keplerState(lunarPosition, lunarVelocity, time, MOON_GM);
      return { ...state, position: state.position.add(center), proper: new Vector3(), reference: 'moon' };
    }
    const state = keplerState(entry, reverseVelocity, Math.max(0, plan.earthS + plan.moonS - time), EARTH_GM);
    return { ...state, velocity: state.velocity.negate(), proper: new Vector3(), reference: 'earth' };
  } };
}
