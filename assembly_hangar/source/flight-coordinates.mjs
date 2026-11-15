import { Vector3 } from 'three';
export const EARTH_RADIUS_M = 6371000;
export const EARTH_MU = 3.986004418e14;
export const EARTH_OMEGA = 7.292115e-5;
export const G0 = 9.80665;
export const LAUNCH_SITE = { latitude: 28.6084, longitude: -80.6042 };
export function geographicUp(latitude = LAUNCH_SITE.latitude, longitude = LAUNCH_SITE.longitude) {
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}
export const PAD_UP = geographicUp();
export const PAD_EAST = new Vector3(-Math.sin(LAUNCH_SITE.longitude * Math.PI / 180), 0, -Math.cos(LAUNCH_SITE.longitude * Math.PI / 180));
export const PAD_NORTH = new Vector3().crossVectors(PAD_UP, PAD_EAST).normalize();
export const PAD_POSITION_M = PAD_UP.clone().multiplyScalar(EARTH_RADIUS_M);
export function surfaceToInertialVelocity(positionM, surfaceVelocityMps) {
  return surfaceVelocityMps.clone().add(new Vector3(EARTH_OMEGA * positionM.z, 0, -EARTH_OMEGA * positionM.x));
}
export function groundDistanceM(positionM) {
  return Math.atan2(positionM.clone().cross(PAD_UP).length(), positionM.dot(PAD_UP)) * EARTH_RADIUS_M;
}
export function padLocalPosition(positionM, out = new Vector3()) {
  const relative = positionM.clone().sub(PAD_POSITION_M);
  return out.set(relative.dot(PAD_EAST), relative.dot(PAD_UP), -relative.dot(PAD_NORTH));
}
export function localBasis(positionM) {
  const up = positionM.clone().normalize();
  const east = new Vector3().crossVectors(new Vector3(0, 1, 0), up).normalize();
  return { up, east, north: new Vector3().crossVectors(up, east).normalize() };
}
export function orbitElements(positionM, surfaceVelocityMps) {
  const r = positionM.length(), v = surfaceToInertialVelocity(positionM, surfaceVelocityMps);
  const energy = v.lengthSq() / 2 - EARTH_MU / r;
  const angularMomentum = positionM.clone().cross(v);
  const h2 = angularMomentum.lengthSq();
  const eccentricity = Math.sqrt(Math.max(0, 1 + 2 * energy * h2 / (EARTH_MU * EARTH_MU)));
  const a = -EARTH_MU / (2 * energy);
  const periapsisM = h2 / (EARTH_MU * (1 + eccentricity)) - EARTH_RADIUS_M;
  const angularMomentumM2S = Math.sqrt(h2);
  return { periapsisM, apoapsisM: energy < 0 ? a * (1 + eccentricity) - EARTH_RADIUS_M : Infinity,
    eccentricity, energy, inertialSpeedMps: v.length(), angularMomentumM2S,
    inclinationDeg: angularMomentumM2S > 0 ? Math.acos(Math.max(-1, Math.min(1, angularMomentum.y / angularMomentumM2S))) * 180 / Math.PI : null,
    periodS: energy < 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / EARTH_MU) : null };
}
// Lower US Standard Atmosphere layers, continuous exponential extension above
// 86 km. Spherical Earth, still atmosphere in the rotating Earth-fixed frame.
export function atmosphere(altitudeM) {
  const h = Math.max(0, altitudeM);
  const layers = [[0,288.15,101325,-.0065],[11000,216.65,22632.06,0],[20000,216.65,5474.889,.001],[32000,228.65,868.0187,.0028],[47000,270.65,110.9063,0],[51000,270.65,66.93887,-.0028],[71000,214.65,3.95642,-.002]];
  let layer = layers[0];
  for (const candidate of layers) if (h >= candidate[0]) layer = candidate;
  const [base, t0, p0, lapse] = layer, dh = Math.min(h, 86000) - base;
  const temperatureK = t0 + lapse * dh;
  let pressurePa = lapse === 0 ? p0 * Math.exp(-G0 * dh / (287.05287 * t0)) : p0 * (temperatureK / t0) ** (-G0 / (lapse * 287.05287));
  if (h > 86000) pressurePa *= Math.exp(-(h - 86000) / 14000);
  return { density: pressurePa / (287.05287 * temperatureK), pressurePa, temperatureK };
}
