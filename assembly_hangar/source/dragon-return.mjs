import { Vector3 } from 'three';
import { EARTH_GM, keplerState, orbitShape } from './orbital-propagator.mjs';

// Teaching corridor for a Dragon return from a circular parking orbit.
export function dragonDeorbit(position, heading) {
  const radiusKm = position.length();
  if (radiusKm < 6550 || radiusKm > 7200) throw new Error('No safe Dragon deorbit window');
  const tangent = heading.clone().projectOnPlane(position.clone().normalize()).normalize();
  if (!tangent.lengthSq()) throw new Error('Dragon orbit direction unavailable');
  const a = (radiusKm + 6351) / 2;
  const circular = Math.sqrt(EARTH_GM / radiusKm), after = Math.sqrt(EARTH_GM * (2 / radiusKm - 1 / a));
  const velocity = tangent.multiplyScalar(after), deltaVMps = (circular - after) * 1000;
  let lo = 0, hi = Math.PI * Math.sqrt(a ** 3 / EARTH_GM);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (keplerState(position, velocity, mid).position.length() > 6491) lo = mid;
    else hi = mid;
  }
  return { position: position.toArray(), velocity: velocity.toArray(), duration: hi, deltaVMps,
    periapsisM: (orbitShape(position, velocity, EARTH_GM).periapsis - 6371) * 1000 };
}
export function dragonReturnPath(state) {
  const position = new Vector3(...state.position), velocity = new Vector3(...state.velocity);
  return { physical: true, model: 'dragon-deorbit', isPowered: () => false, burnDuration: 0,
    sample: time => ({ ...keplerState(position, velocity, Math.min(time, state.duration)), reference: 'earth', proper: new Vector3() }) };
}
