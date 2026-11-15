// SI throughout: metres, kilograms, seconds, radians. Balance values, not certification data.
export const rigidConfig = {
  step: 1 / 120, maxDebris: 32, debrisLifetime: 18,
  material: { staticFriction: .45, dynamicFriction: .30, restitution: .22 },
  docking: { distanceM: .22, speedMps: .35, angleRad: 8 * Math.PI / 180, breakForceN: 2e6 },
  damage: { minimumSpeedMps: 1.5, specificEnergyJkg: 12, breachEnergyJkg: 35, cooldownS: .75 },
  interior: { looseMassKg: .35, looseHalfM: .065, pushMps: .65 },
  maneuverProperMps2: { trim: .12, lunarBurn: 1.9, marsBurn: 4.5, reentry: 4 },
};

export const moduleMasses = {
  apollo_cm: 5560, apollo_sm: 18410, eagle_ascent: 4700, eagle_descent: 10300,
  orion_cm: 10400, orion_esm: 15461, dragon_capsule: 12500, dragon_dock: 200, dragon_trunk: 1800,
};
