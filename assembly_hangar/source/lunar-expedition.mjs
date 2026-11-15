import { DAY_S, finite } from './mission-units.mjs';
import { G0 } from './flight-coordinates.mjs';

export const lunarHardware = {
  workshop: { name: 'Expedition spacecraft', model: 'orion', dryKg: 10300, serviceDryKg: 2200,
    fuelKg: 8700, ispS: 320, maxOxygenKg: 65, batteryKWh: 28, maxGenerationW: 1600, seats: 4 },
};

export const lunarParking = { periapsisM: 200000, apoapsisM: 210000, toleranceM: 55000 };
export const entryDurationS = 25 * 60;
export const lunarCarriers = ['apollo_11', 'artemis_ii'];
export const expeditionCabin = {
  volumeM3: 19, equipmentKg: 310, oxygenKg: 47, reserveKg: 5, oxygenDeliveryKgH: .30, waterKg: 140, foodKg: 26,
  ventilationW: 95, busW: 160, generationW: 1450, scrubberKgH: .23, scrubberCapacityKg: 52, scrubberW: 115,
  thermalJK: 225000, thermalW: 115, heatRejectionW: 2400,
};

export function readLunarExpedition(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || !Object.hasOwn(lunarHardware, input.hardware)) throw new Error('Unknown expedition spacecraft');
  return { hardware: input.hardware, serviceFuelFraction: finite(input.serviceFuelFraction, 'Service module fuel', 0, 1),
    operationsS: finite(input.operationsS, 'Lunar operations, s', 3600, 3 * DAY_S),
    returnS: finite(input.returnS, 'Earth return, s', 2 * DAY_S, 6 * DAY_S) };
}

export function burnPropellantKg(massKg, deltaVMps, ispS) {
  return -massKg * Math.expm1(-deltaVMps / (G0 * ispS));
}
