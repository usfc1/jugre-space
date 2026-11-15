import { finite } from './mission-units.mjs';

export const instrumentCategories = { optical: 'Optics', spectra: 'Spectrometry', environment: 'Environment', planetary: 'Planetary science' };

// Fictional JUGRE equipment. Dimensions are stowed, electrical figures are DC,
// and MB is decimal throughout the simulation.
const instrumentRows = [
  ['hires', 'High-resolution camera', 'optical', 'Detailed surface imaging', 24, [.42, .34, .32], 3.2, 105, 70, 4, 3, 7, .08, 'sunlit'],
  ['wide', 'Wide-angle camera', 'optical', 'Wide-area surface imaging', 9, [.23, .19, .18], 1.1, 45, 30, 2, .8, 3, .8, 'sunlit'],
  ['telescope', 'Orbital telescope', 'optical', 'Astronomical observations', 66, [.78, .64, .60], 9, 160, 120, 8, 4, 10, .01, 'sky'],
  ['multi', 'Multispectral camera', 'optical', 'Vegetation mapping', 17, [.31, .27, .26], 2.6, 83, 55, 4, 1.6, 6, .2, 'sunlit'],
  ['ir', 'Infrared spectrometer', 'spectra', 'Thermal spectra', 15, [.30, .22, .22], 2.2, 64, 46, 3, .45, 5, .3, 'ground'],
  ['uv', 'Ultraviolet spectrometer', 'spectra', 'Atmospheric UV spectra', 11, [.25, .20, .20], 1.8, 51, 35, 3, .25, 4, .35, 'sunlit'],
  ['mass', 'Mass spectrometer', 'spectra', 'Sample composition', 19, [.34, .25, .25], 2.5, 84, 62, 5, .08, 6, 2, 'surface'],
  ['xray', 'X-ray spectrometer', 'spectra', 'X-ray astronomy', 22, [.40, .34, .31], 3.5, 85, 63, 4, .35, 6, .12, 'sky'],
  ['mag', 'Magnetometer', 'environment', 'Magnetic field measurements', 4, [.22, .12, .11], .7, 13, 8, 1, .02, 3, 4, 'local'],
  ['radiation', 'Radiation sensor', 'environment', 'Particle flux measurements', 3, [.15, .12, .11], .5, 14, 9, 1, .015, 3, 6, 'local'],
  ['plasma', 'Plasma sensor', 'environment', 'Plasma measurements', 7, [.21, .19, .15], 1.2, 26, 17, 2, .04, 4, 4, 'local'],
  ['thermal', 'Thermal radiometer', 'environment', 'Surface temperature mapping', 10, [.25, .20, .18], 1.5, 49, 34, 2, .3, 4, .6, 'ground'],
  ['radar', 'Ground-penetrating radar', 'planetary', 'Subsurface survey', 30, [.71, .34, .33], 4.6, 220, 155, 7, 2.4, 8, .4, 'surface'],
  ['lidar', 'Laser altimeter', 'planetary', 'Terrain measurements', 16, [.32, .25, .25], 2.9, 103, 75, 4, .4, 6, .15, 'ground'],
  ['soil', 'Soil analyzer', 'planetary', 'Sample mineralogy', 12, [.28, .24, .21], 1.9, 55, 39, 3, .11, 5, 3, 'surface'],
  ['atmosphere', 'Atmosphere analyzer', 'planetary', 'Upper atmosphere density', 8, [.26, .22, .17], 1.4, 31, 19, 2, .1, 4, 3, 'local'],
];

export const instruments = Object.fromEntries(instrumentRows.map(([id, name, category, purpose, massKg, dimensionsM, costM,
  peakW, activeW, standbyW, rateMBs, scienceValue, pointingDeg, geometry]) => [id, {
  id, name, category, purpose, massKg, dimensionsM, costM, peakW, activeW, standbyW, rateMBs, scienceValue, pointingDeg, geometry,
  orbitSupported: !['sky', 'surface'].includes(geometry),
}]));

export const spacecraftParts = {
  panels: {
    compact: { name: 'Compact · 0.45 m²', massKg: 4, costM: .6, areaM2: .45, efficiency: .24 },
    standard: { name: 'Standard · 1.8 m²', massKg: 11, costM: 1.6, areaM2: 1.8, efficiency: .27 },
    extended: { name: 'Deployable · 3 m²', massKg: 22, costM: 3.4, areaM2: 3, efficiency: .28 },
  },
  battery: {
    trial: { name: 'Test · 8 Wh', massKg: 1, costM: .1, capacityWh: 8, chargeW: 30, dischargeW: 35 },
    standard: { name: 'Standard · 160 Wh', massKg: 6, costM: 1.1, capacityWh: 160, chargeW: 130, dischargeW: 180 },
    extended: { name: 'Extended · 420 Wh', massKg: 15, costM: 2.6, capacityWh: 420, chargeW: 240, dischargeW: 350 },
  },
  radio: {
    low: { name: 'S-band · 0.4 MB/s', massKg: 3, costM: .7, drawW: 24, rateMBs: .4, band: 'S', pointingDeg: 85 },
    high: { name: 'X-band · 3 MB/s', massKg: 8, costM: 2.3, drawW: 76, rateMBs: 3, band: 'X', pointingDeg: 55 },
  },
  computer: {
    basic: { name: 'Basic · 64 MB', massKg: 2, costM: .4, drawW: 6, storageMB: 64 },
    plus: { name: 'Extended · 1,024 MB', massKg: 5, costM: 1.2, drawW: 13, storageMB: 1024 },
  },
  attitude: {
    basic: { name: 'Basic · 0.5°', massKg: 4, costM: .7, drawW: 8, accuracyDeg: .5 },
    precision: { name: 'Precision · 0.05°', massKg: 11, costM: 2.1, drawW: 18, accuracyDeg: .05 },
  },
};

export const defaultSpacecraft = {
  instrumentIds: ['wide'], panels: 'standard', battery: 'standard', radio: 'low', computer: 'plus', attitude: 'basic',
  budgetM: null, downlinkGoalMB: 12, targetLatDeg: null, targetLonDeg: null,
};

export function readSpacecraft(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || !Array.isArray(input.instrumentIds) || input.instrumentIds.length > Object.keys(instruments).length
    || new Set(input.instrumentIds).size !== input.instrumentIds.length
    || input.instrumentIds.some(id => typeof id !== 'string' || !Object.hasOwn(instruments, id))) throw new Error('Invalid instrument list');
  const read = { instrumentIds: [...input.instrumentIds] };
  if (input.manualPlacement === true) read.manualPlacement = true;
  for (const [field, options] of Object.entries(spacecraftParts)) {
    if (read.manualPlacement && input[field] == null) { read[field] = null; continue; }
    if (typeof input[field] !== 'string' || !Object.hasOwn(options, input[field])) throw new Error(`Unknown configuration ${field}`);
    read[field] = input[field];
  }
  if (read.manualPlacement) {
    const mounting = input.mounting ?? [];
    if (!Array.isArray(mounting) || mounting.length > 32) throw new Error('Invalid payload mounting data');
    const keys = new Set(), slots = new Set();
    read.mounting = mounting.map(item => {
      const key = item?.kind + ':' + item?.id;
      const installed = item?.kind === 'instrument' ? read.instrumentIds.includes(item.id)
        : item?.kind === 'system' && Object.hasOwn(spacecraftParts, item.id) && read[item.id] != null;
      if (!installed || typeof item.slot !== 'string' || !/^(top|front|rear|left|right)_[1-8]$/.test(item.slot) ||
        !Number.isInteger(item.turn ?? 0) || (item.turn ?? 0) < 0 || (item.turn ?? 0) > 3 || keys.has(key) || slots.has(item.slot)) {
        throw new Error('Invalid or overlapping payload attachment');
      }
      keys.add(key); slots.add(item.slot);
      return { kind: item.kind, id: item.id, slot: item.slot, turn: item.turn ?? 0 };
    });
    if (keys.size !== read.instrumentIds.length + Object.keys(spacecraftParts).filter(field => read[field] != null).length) {
      throw new Error('Every selected component needs an attachment point');
    }
  }
  read.budgetM = finite(input.budgetM, 'Payload budget, M', .1, 1e5, true);
  read.downlinkGoalMB = finite(input.downlinkGoalMB, 'Downlink goal, MB', .01, 1e5);
  read.targetLatDeg = finite(input.targetLatDeg, 'Target latitude, °', -90, 90, true);
  read.targetLonDeg = finite(input.targetLonDeg, 'Target longitude, °', -180, 180, true);
  if ((read.targetLatDeg == null) !== (read.targetLonDeg == null)) throw new Error('Enter both target coordinates.');
  return read;
}

export function spacecraftTotals(config) {
  if (!config) return null;
  const selected = config.instrumentIds.map(id => instruments[id]);
  const missing = { massKg: 0, costM: 0, drawW: 0, areaM2: 0, efficiency: 0, capacityWh: 0,
    chargeW: 0, dischargeW: 0, rateMBs: 0, storageMB: 0, accuracyDeg: 180, band: '', pointingDeg: 0 };
  const parts = Object.fromEntries(Object.entries(spacecraftParts).map(([field, options]) => [field, options[config[field]] ?? missing]));
  const { panels, battery, radio, computer, attitude } = parts;
  const busW = 16 + computer.drawW + attitude.drawW;
  const standbyW = busW + selected.reduce((sum, item) => sum + item.standbyW, 0);
  const additionalPeakW = Math.max(0, ...selected.map(item => item.peakW - item.standbyW));
  const peakW = standbyW + Math.max(additionalPeakW, radio.drawW);
  const solarW = 1361 * panels.areaM2 * panels.efficiency * .65;
  const hardware = [...Object.values(parts), ...selected];
  return { ...parts, selected, busW, standbyW, peakW, solarW,
    massKg: hardware.reduce((sum, item) => sum + item.massKg, 38),
    costM: hardware.reduce((sum, item) => sum + item.costM, 2.4),
    scienceValue: selected.reduce((sum, item) => sum + item.scienceValue, 0),
    peakDataMBs: Math.max(0, ...selected.map(item => item.rateMBs)) };
}
