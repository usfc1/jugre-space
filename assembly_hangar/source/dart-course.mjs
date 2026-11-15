import { Matrix4, Quaternion, Vector3 } from 'three';

export const DART_TARGET = new Vector3(-.31, .17, .935).normalize().multiplyScalar(650000);
export const DART_SPEED = 6100;
export const DART_RELEASE_RANGE = 2600;
export const DART_APPROACH_RANGE = 1080;
export const DART_APPROACH_TIME = 10.5;
export const DART_AFTERMATH_TIME = 7.5;
export const DART_NOMINAL_ORIGIN = new Vector3(-10, 8, -83);

export const dartHeading = DART_TARGET.clone().normalize();
const x = new Vector3().crossVectors(new Vector3(0, 1, 0), dartHeading).normalize();
const y = new Vector3().crossVectors(dartHeading, x).normalize();
const frame = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, dartHeading));

export function dartRange(progress) {
  return DART_APPROACH_RANGE * (1 - Math.max(0, Math.min(1, progress))) ** 2.3;
}

export function dartWorldPosition(impactOrigin, range, output = new Vector3()) {
  output.copy(impactOrigin);
  output.z -= range;
  return output.multiplyScalar(.001).applyQuaternion(frame).add(DART_TARGET);
}

export function isDartEncounter(kind) {
  return kind === 'dartApproach' || kind === 'dartAftermath';
}
