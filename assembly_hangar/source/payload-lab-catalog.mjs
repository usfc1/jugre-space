import { instruments, spacecraftParts } from './spacecraft-design.mjs';

const names = {
  hires: ['High-resolution camera', 'Detailed surface imaging'],
  wide: ['Wide-angle camera', 'Wide-area surface imaging'],
  telescope: ['Orbital telescope', 'Astronomical observations'],
  multi: ['Multispectral camera', 'Vegetation and surface mapping'],
  ir: ['Infrared spectrometer', 'Thermal spectrum measurements'],
  uv: ['Ultraviolet spectrometer', 'Atmospheric UV measurements'],
  mass: ['Mass spectrometer', 'Sample composition analysis'],
  xray: ['X-ray spectrometer', 'X-ray observations'],
  mag: ['Magnetometer', 'Local magnetic field measurements'],
  radiation: ['Radiation detector', 'Particle flux measurements'],
  plasma: ['Plasma sensor', 'Local plasma measurements'],
  thermal: ['Thermal radiometer', 'Surface temperature mapping'],
  radar: ['Ground-penetrating radar', 'Subsurface observations'],
  lidar: ['Laser altimeter', 'Surface height measurements'],
  soil: ['Soil analyser', 'Mineral composition of samples'],
  atmosphere: ['Atmospheric analyser', 'Local atmospheric measurements'],
};
export const systemNames = { panels: 'Solar array', battery: 'Battery', radio: 'Radio', computer: 'Flight computer', attitude: 'Attitude control' };
const variants = {
  panels: { compact: 'Compact · 0.45 m²', standard: 'Standard · 1.8 m²', extended: 'Folding · 3 m²' },
  battery: { trial: 'Trial · 8 Wh', standard: 'Standard · 160 Wh', extended: 'Extended · 420 Wh' },
  radio: { low: 'S-band · 0.4 MB/s', high: 'X-band · 3 MB/s' },
  computer: { basic: 'Basic · 64 MB', plus: 'Extended · 1,024 MB' },
  attitude: { basic: 'Basic · 0.5°', precision: 'Precision · 0.05°' },
};
export const labInstruments = Object.entries(instruments).map(([id, spec]) => ({
  ...spec, id, kind: 'instrument', title: names[id][0], purpose: names[id][1], key: 'instrument:' + id,
}));
export const labSystems = Object.entries(spacecraftParts).flatMap(([id, options]) => Object.entries(options).map(([variant, spec]) => ({
  ...spec, id, variant, kind: 'system', key: 'system:' + id, title: systemNames[id] + ' · ' + variants[id][variant],
  purpose: ({ panels: 'Generates electrical power', battery: 'Stores energy for eclipse', radio: 'Transmits science data',
    computer: 'Controls instruments and stores data', attitude: 'Keeps instruments pointed at their targets' })[id],
  dimensionsM: id === 'panels' ? [.42, .65, .12] : id === 'radio' ? [.3, .3, .24] :
    id === 'battery' ? [.27, .23, .19] : [.22, .2, .14],
})));
export function labItem(kind, id, variant) {
  return kind === 'instrument' ? labInstruments.find(item => item.id === id)
    : labSystems.find(item => item.id === id && item.variant === variant);
}
export const labBodyNames = { mayak_k: 'Mayak-K satellite bus', mayak_s: 'Mayak-S satellite bus', barkhan_4: 'Barkhan-4 rover', barkhan_6: 'Barkhan-6 rover', eagle: 'Eagle lunar module' };
