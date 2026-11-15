import { Box3, MathUtils, Vector3 } from 'three';

export const deckY = .8;
export const equipmentStand = [19, 1.06, 8];

export function placeOnDeck(model, bounds, [x, y, z] = [0, deckY, 0], center = false) {
  const middle = bounds.getCenter(new Vector3());
  model.position.set(x - (center ? middle.x : 0), y - bounds.min.y, z - (center ? middle.z : 0));
  model.updateMatrixWorld(true);
  return bounds.clone().translate(model.position);
}

export function rocketView(bounds, view) {
  const result = bounds.clone();
  const height = bounds.max.y - bounds.min.y;
  if (view === 'engines') result.max.y = bounds.min.y + Math.min(height, Math.max(1.4, height * .14));
  if (view === 'stages') {
    result.min.y += height * .18;
    result.max.y -= height * .18;
  }
  if (view === 'payload') result.min.y = bounds.max.y - Math.min(height, Math.max(1.4, height * .20));
  return result;
}

export function boundsCorners(bounds) {
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) points.push(new Vector3(x, y, z));
    }
  }
  return points;
}

export function frameBounds(bounds, direction, fov, aspect, fill = .77) {
  const target = bounds.getCenter(new Vector3());
  const back = direction.clone().normalize();
  const right = new Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right);
  const vertical = Math.tan(MathUtils.degToRad(fov * .5)) * fill;
  const horizontal = vertical * aspect * .9;
  let distance = 2;
  for (const corner of boundsCorners(bounds)) {
    const offset = corner.sub(target);
    distance = Math.max(distance, offset.dot(back) + Math.max(Math.abs(offset.dot(up)) / vertical,
      Math.abs(offset.dot(right)) / horizontal));
  }
  return { target, position: target.clone().addScaledVector(back, distance) };
}

export function bridgeClearance(bounds, y, z, side) {
  const overlap = y > bounds.min.y - 1.3 && y < bounds.max.y + .6 &&
    z + 1.2 > bounds.min.z && z - 1.2 < bounds.max.z;
  if (!overlap) return 0;
  const edge = side > 0 ? bounds.max.x : -bounds.min.x;
  return MathUtils.clamp((edge + 1.1 - 4.88) / 6.1, 0, 1);
}

export function defaultRocketBounds() {
  return new Box3(new Vector3(-1.65, deckY, -1.65), new Vector3(1.65, deckY + 4, 1.65));
}
