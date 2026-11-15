import { Quaternion, Vector3 } from 'three';
import { EARTH_GM, keplerState } from './orbital-propagator.mjs';

// Join a local Earth escape from the actual parking position to the
// prescribed solar transfer. The blend stays outside the parking radius,
// including when the nominal Lambert leg initially points through Earth.
export function earthDeparture(parking, excess, duration, earth, solar, parkingVelocity = excess) {
  const radius = parking.length();
  const radial = parking.clone().divideScalar(radius);
  const tangent = parkingVelocity.clone().projectOnPlane(radial);
  if (tangent.lengthSq() < 1e-12) {
    const axis = Math.abs(radial.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    tangent.crossVectors(axis, radial);
  }
  const launchVelocity = tangent.setLength(Math.sqrt(excess.lengthSq() + 2 * EARTH_GM / radius));
  const localEnd = Math.min(1800, duration / 8);
  const joinEnd = Math.min(86400, duration / 2);
  const local = time => keplerState(parking, launchVelocity, time, EARTH_GM);
  const earthVelocity = time => earth(time + .5).sub(earth(time - .5));
  const first = local(localEnd);
  const last = solar(joinEnd);
  const lastRadial = last.position.sub(earth(joinEnd));
  const firstRange = first.position.length();
  const distance = lastRadial.length() - firstRange;
  const startSpeed = first.velocity.dot(first.position.normalize());
  const endSpeed = last.velocity.sub(earthVelocity(joinEnd)).dot(lastRadial.normalize());
  const span = joinEnd - localEnd;
  // Integrate a positive radial speed profile across the blend. A straight
  // blend of ranges would decelerate past zero on lower-energy transfers.
  const ramp = Math.min(span / 4, distance / Math.max(1e-9, startSpeed + endSpeed));
  const middleSpeed = (distance - ramp * (startSpeed + endSpeed) / 2) / (span - ramp);
  const integral = time => {
    const u = Math.min(1, time / ramp);
    return ramp * u * (1 - u / 2);
  };
  const position = time => {
    const center = earth(time);
    const outbound = local(time).position;
    if (time <= localEnd) return outbound.add(center);
    if (time >= joinEnd) return solar(time).position;
    const nominal = solar(time).position.sub(center);
    const elapsed = time - localEnd;
    const u = elapsed / span;
    const weight = u * u * u * (10 + u * (-15 + 6 * u));
    const range = firstRange + middleSpeed * elapsed + (startSpeed - middleSpeed) * integral(elapsed)
      + (endSpeed - middleSpeed) * (ramp / 2 - integral(span - elapsed));
    const from = outbound.normalize();
    const rotation = new Quaternion().setFromUnitVectors(from, nominal.normalize());
    return from.applyQuaternion(new Quaternion().slerp(rotation, weight)).multiplyScalar(range).add(center);
  };
  return time => {
    if (time >= joinEnd) return solar(time);
    if (time <= localEnd) {
      const sample = local(time);
      const center = earth(time);
      const centerVelocity = earthVelocity(time);
      return { position: sample.position.add(center), velocity: sample.velocity.add(centerVelocity), center, centerVelocity };
    }
    const dt = Math.min(.5, time / 2, (duration - time) / 2);
    return { position: position(time), velocity: position(time + dt).sub(position(time - dt)).divideScalar(2 * dt) };
  };
}
