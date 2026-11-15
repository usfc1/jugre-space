import { DAY_S, finite } from './mission-units.mjs';

export const crewSources = {
  baseline: 'https://ntrs.nasa.gov/api/citations/20210024855/downloads/BVAD_2.15.22-final.pdf',
  consumables: 'https://ntrs.nasa.gov/api/citations/20160005782/downloads/20160005782.pdf',
  environment: 'https://www.nasa.gov/reference/6-0-natural-and-induced-environments-vol-2/',
};

// BVAD Rev 2 table 3-23: oxygen, CO₂ and vapor in g/min, sensible heat in kJ/h.
const rates = (o2, co2, vapor, heat) => ({
  o2: o2 / 60000, co2: co2 / 60000, vapor: vapor / 60000, heatW: heat / 3.6,
});
export const metabolism = Object.freeze({
  sleep: rates(.37, .44, 1.08, 160),
  nominal: rates(.59, .69, 1.33, 306),
  exercise: rates(3.99, 5.22, 6.72, 479),
});
export const waterKgS = 3.52 / DAY_S;
export const foodKgS = .62 / DAY_S;

export const cabinFields = [
  ['volumeM3', 'Free volume, m³', .1, 1000],
  ['equipmentKg', 'Additional equipment mass, kg', 0, 1e5],
  ['oxygenKg', 'O₂ supply, kg', 0, 1e4],
  ['reserveKg', 'O₂ reserve from total supply, kg', 0, 1e4],
  ['oxygenDeliveryKgH', 'O₂ delivery, kg/h', 0, 1e3],
  ['waterKg', 'Drinking water, kg', 0, 1e4],
  ['foodKg', 'Dry food, kg', 0, 1e4],
  ['scrubberKgH', 'CO₂ removal, kg/h', 0, 1e3],
  ['scrubberCapacityKg', 'Scrubber capacity, kg CO₂', 0, 1e4],
  ['scrubberW', 'Scrubber power, W', 0, 1e5],
  ['ventilationW', 'Ventilation power, W', .1, 1e5],
  ['busW', 'Other loads, W', 0, 1e5],
  ['generationW', 'Guaranteed power, W', 0, 1e5],
  ['electrolysisKgH', 'O₂ generation, kg/h', 0, 1e3],
  ['electrolysisW', 'O₂ generator power, W', 0, 1e5],
  ['recoveryKgH', 'Wastewater processing, kg/h', 0, 1e3],
  ['recoveryFraction', 'Water recovery fraction (0–1)', 0, 1],
  ['recoveryW', 'Water recovery power, W', 0, 1e5],
  ['thermalJK', 'Cabin heat capacity, J/K', 1000, 1e9],
  ['thermalW', 'Thermal control power, W', 0, 1e5],
  ['heatRejectionW', 'Heat rejection, W', 0, 1e6],
];
export const requiredCabinFields = new Set(['volumeM3', 'equipmentKg', 'oxygenKg', 'oxygenDeliveryKgH', 'waterKg',
  'foodKg', 'ventilationW', 'busW', 'thermalJK']);

export function readCabinProfile(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cabin profile');
  const profile = Object.fromEntries(cabinFields.map(([id, label, min, max]) => [id,
    finite(value[id] ?? (requiredCabinFields.has(id) ? null : 0), label, min, max)]));
  if (profile.reserveKg > profile.oxygenKg) throw new Error('O₂ reserve exceeds total supply');
  for (const [rate, draw] of [['electrolysisKgH', 'electrolysisW'], ['recoveryKgH', 'recoveryW'], ['heatRejectionW', 'thermalW']]) {
    if (profile[rate] > 0 && profile[draw] <= 0) throw new Error('Set power demand for installed equipment');
  }
  // Reversible water electrolysis at standard conditions needs about 237.13 kJ per mol of water.
  const oxygenKgPerMoleWater = .0319988 / 2;
  if (profile.electrolysisW * 3600 < profile.electrolysisKgH * 237130 / oxygenKgPerMoleWater) throw new Error('Power below the electrolysis minimum');
  return profile;
}
