import { MathUtils } from 'three';

export const WATER_CONTACT = 0.9;

// Compressed educational flight, with a separate water-contact and settling
// interval. Never report mission completion while the capsule is descending.
export function reentryProfile(progress) {
  const p = MathUtils.clamp(progress, 0, 1);
  let altitude;
  if (p < 0.5) altitude = 3 + 217 * (1 - MathUtils.smoothstep(p, 0, 0.5));
  else if (p < 0.68) altitude = 0.3 + 2.7 * (1 - MathUtils.smoothstep(p, 0.5, 0.68));
  else if (p < 0.74) altitude = 0.045 + 0.255 * (1 - MathUtils.smoothstep(p, 0.68, 0.74));
  else altitude = Math.max(0, 0.045 * (WATER_CONTACT - p) / (WATER_CONTACT - 0.74));
  const landed = p >= WATER_CONTACT;
  const speed = p < 0.5 ? MathUtils.lerp(7800, 120, MathUtils.smoothstep(p, 0, 0.5))
    : p < 0.64 ? MathUtils.lerp(120, 7, MathUtils.smoothstep(p, 0.5, 0.64)) : landed ? 0 : 7;
  return { altitude, speed, landed, local: p >= 0.5, opening: MathUtils.smoothstep(p, 0.52, 0.63) };
}
