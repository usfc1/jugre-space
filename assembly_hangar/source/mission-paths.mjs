import { CubicBezierCurve3, MathUtils, Vector3 } from 'three';

// The simulation compresses mission time. The curves preserve the direction
// of travel at departure and arrival so each leg flows into the next one.
export function tangentAlong(radial, hint) {
  const tangent = hint.clone().addScaledVector(radial, -hint.dot(radial));
  if (tangent.lengthSq() > 1e-8) return tangent.normalize();
  const axis = Math.abs(radial.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  return tangent.crossVectors(axis, radial).normalize();
}

export function orbitArc(center, start, heading, sweep, endRadius = start.distanceTo(center)) {
  const radial = start.clone().sub(center);
  const radius = radial.length();
  radial.normalize();
  const tangent = tangentAlong(radial, heading);
  return {
    sample(progress, position, direction) {
      const angle = progress * sweep;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const r = MathUtils.lerp(radius, endRadius, MathUtils.smoothstep(progress, 0, 1));
      position.copy(center).addScaledVector(radial, cos * r).addScaledVector(tangent, sin * r);
      const climb = (endRadius - radius) * 6 * progress * (1 - progress);
      direction.copy(tangent).multiplyScalar(cos * r * sweep + sin * climb)
        .addScaledVector(radial, -sin * r * sweep + cos * climb).normalize();
    },
  };
}

export function departureSweep(start, heading, destination) {
  const radial = start.clone().normalize();
  const prograde = tangentAlong(radial, heading);
  const bearing = Math.atan2(destination.dot(prograde), destination.dot(radial));
  // End the parking orbit with the destination ahead and slightly above
  // the tangent so the transfer can leave without a turn back across Earth.
  const sweep = MathUtils.euclideanModulo(bearing - 1.28, 2 * Math.PI);
  return sweep >= .35 ? sweep : sweep + 2 * Math.PI;
}

export function transferRoute(start, heading, arrival, arrivalHeading, departureCenter) {
  const distance = start.distanceTo(arrival);
  const departureHeading = heading.clone();
  if (departureCenter) {
    const radial = start.clone().sub(departureCenter).normalize();
    const radialSpeed = departureHeading.dot(radial);
    if (radialSpeed < 0) departureHeading.copy(tangentAlong(radial, departureHeading));
  }
  const curve = new CubicBezierCurve3(start.clone(), start.clone().addScaledVector(departureHeading, distance * .24),
    arrival.clone().addScaledVector(arrivalHeading, -distance * .20), arrival.clone());
  return {
    sample(progress, position, direction) {
      curve.getPoint(progress, position);
      direction.copy(curve.getTangent(progress));
    },
  };
}

export function approachOrbit(start, heading, center, radius, departureCenter) {
  const facing = start.clone().sub(center).normalize();
  const sideways = tangentAlong(facing, heading);
  const angle = .82;
  const radial = facing.clone().multiplyScalar(Math.cos(angle)).addScaledVector(sideways, Math.sin(angle));
  const tangent = sideways.multiplyScalar(Math.cos(angle)).addScaledVector(facing, -Math.sin(angle));
  const arrival = center.clone().addScaledVector(radial, radius);
  return transferRoute(start, heading, arrival, tangent, departureCenter);
}
