import { DAY_S, finite } from './mission-units.mjs';
import { readCabinProfile } from './cabin-profile.mjs';
import { readSpacecraft } from './spacecraft-design.mjs';
import { expeditionCabin, readLunarExpedition } from './lunar-expedition.mjs';
import { bodyNames, defaultProbe, planetaryOrbit, readProbe, YEAR_S } from './mission-planets.mjs';

export { finite } from './mission-units.mjs';
export const MISSION_DATA_VERSION = 'jugre-engineering-1';
export const MISSION_STORAGE_KEY = 'jugre.mission-designer.v1';

export const missionTypes = {
  orbit: 'Orbital insertion', rendezvous: 'Orbital rendezvous', flyby: 'Flyby',
  landing: 'Landing', deployment: 'Satellite deployment', cargo: 'Cargo delivery',
  science: 'Science observations', exploration: 'Expedition', return: 'Earth return',
};

function choice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function string(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function timestamp(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Enter a valid UTC date and time');
  return value;
}

// All persisted quantities use SI, except angles (degrees) and timestamps (UTC).
export function readMission(input) {
  if (!input || typeof input !== 'object') throw new Error('Mission not found');
  const data = input.schemaVersion === 0 ? {
    ...input, schemaVersion: 1, referenceData: MISSION_DATA_VERSION,
    durationS: input.durationHours == null ? null : finite(input.durationHours, 'Hours', 0, 24 * 365) * 3600,
  } : input;
  if (data.schemaVersion !== 1 || data.referenceData !== MISSION_DATA_VERSION) throw new Error('Unsupported mission or physics version');
  const orbit = data.orbit == null ? null : {
    periapsisM: finite(data.orbit.periapsisM, 'Periapsis, m', 1, 1e9),
    apoapsisM: finite(data.orbit.apoapsisM, 'Apoapsis, m', 1, 1e9),
    toleranceM: finite(data.orbit.toleranceM, 'Orbit tolerance, m', 1, 1e8),
    inclinationDeg: finite(data.orbit.inclinationDeg, 'Inclination, °', 0, 180, true),
  };
  if (orbit && (orbit.apoapsisM < orbit.periapsisM || orbit.toleranceM >= orbit.periapsisM)) throw new Error('Check the orbit altitudes and tolerance');
  const crewCount = finite(data.crewCount, 'Crew', 0, 64);
  if (!Number.isInteger(crewCount)) throw new Error('Crew count must be a whole number');
  if (typeof data.returnRequired !== 'boolean') throw new Error('Specify whether return is required');
  const allowed = data.availableParts ?? [];
  if (!Array.isArray(allowed) || allowed.length > 128 || new Set(allowed).size !== allowed.length) throw new Error('Invalid part list');
  return {
    schemaVersion: 1, referenceData: MISSION_DATA_VERSION,
    id: string(data.id, 'ID', 100), name: string(data.name, 'Name', 100),
    description: string(data.description ?? '', 'Description', 1000, true),
    category: choice(data.category, ['custom', 'predefined'], 'Category'),
    fidelity: choice(data.fidelity, ['educational'], 'Model'),
    flightLength: choice(data.flightLength ?? 'full', ['full', 'short'], 'Flight length'),
    origin: choice(data.origin, Object.keys(bodyNames), 'Origin'),
    destination: choice(data.destination, Object.keys(bodyNames), 'Destination'),
    start: choice(data.start, ['surface', 'orbit'], 'Departure'),
    site: data.site == null ? null : choice(data.site, ['lc39a'], 'Launch site'),
    launchUtc: timestamp(data.launchUtc),
    transferS: finite(data.transferS, 'Transfer duration, s', 1, 100 * YEAR_S, true),
    type: choice(data.type, Object.keys(missionTypes), 'Type'),
    crewCount, crewMassKgEach: finite(data.crewMassKgEach, 'Mass per crew member, kg', 1, 500, true),
    payloadMassKg: finite(data.payloadMassKg, 'Payload mass, kg', 0, 1e6),
    payloadType: choice(data.payloadType, ['ballast', 'equipment'], 'Payload type'),
    equipment: string(data.equipment ?? '', 'Equipment', 300, true),
    durationS: finite(data.durationS, 'Duration, s', 1, 100 * YEAR_S, true),
    returnRequired: data.returnRequired, orbit,
    assembly: choice(data.assembly, ['auto', 'assisted', 'manual'], 'Assembly'),
    optimization: choice(data.optimization, ['mass', 'delta-v'], 'Optimization'),
    availableParts: allowed.map(value => string(value, 'Part ID', 80)),
    maxMassKg: finite(data.maxMassKg, 'Mass limit, kg', 1, 1e8, true),
    propellantFraction: finite(data.propellantFraction ?? 1, 'Fuel load', 0, 1),
    upperThrottle: finite(data.upperThrottle ?? 1, 'Upper-stage throttle limit', .1, 1),
    safetyMargin: finite(data.safetyMargin ?? 0, 'Margin', 0, 1),
    blueprintId: data.blueprintId == null ? null : string(data.blueprintId, 'Build ID', 5000),
    cabin: readCabinProfile(data.cabin),
    spacecraft: readSpacecraft(data.spacecraft),
    expedition: readLunarExpedition(data.expedition),
    interplanetary: readProbe(data.interplanetary),
  };
}

export function newMission(id = globalThis.crypto.randomUUID()) {
  return readMission({
    id, schemaVersion: 1, referenceData: MISSION_DATA_VERSION, name: 'Earth Orbit Test',
    category: 'custom', fidelity: 'educational', origin: 'earth', destination: 'earth',
    start: 'surface', site: 'lc39a', type: 'orbit', crewCount: 0, payloadMassKg: 0, payloadType: 'ballast',
    returnRequired: false, orbit: { periapsisM: 200000, apoapsisM: 220000, toleranceM: 50000 },
    assembly: 'auto', optimization: 'mass',
  });
}

export function planetaryMission(destination, type = 'flyby', id = globalThis.crypto.randomUUID()) {
  return readMission({ ...newMission(id), name: `${bodyNames[destination]} · ${type === 'flyby' ? 'probe flyby' : 'orbital probe'}`,
    destination, type, orbit: planetaryOrbit(destination), interplanetary: destination==='mercury'&&type==='orbit'?{...defaultProbe,fuelKg:24000}:defaultProbe });
}

export const lunarExpedition = () => readMission({
  ...newMission('jugre-lunar-orbital-expedition'), category: 'predefined', name: 'JUGRE Lunar Orbital Expedition',
  description: 'Four astronauts and 232 kg of cargo. Lunar orbit and Earth return.',
  destination: 'moon', type: 'exploration', crewCount: 4, payloadMassKg: 232, returnRequired: true, orbit: null,
});

export function playableLunarExpedition(id = globalThis.crypto.randomUUID()) {
  return readMission({ ...lunarExpedition(), id, name: 'Lunar Expedition', crewMassKgEach: 83,
    transferS: 72 * 3600, durationS: 175 * 3600, orbit: { periapsisM: 120000, apoapsisM: 120000, toleranceM: 15000 },
    expedition: { hardware: 'workshop', serviceFuelFraction: 1, operationsS: 24 * 3600, returnS: 70 * 3600 }, cabin: expeditionCabin });
}

export function loadMission(storage) {
  const saved = storage.getItem(MISSION_STORAGE_KEY);
  return saved == null ? null : readMission(JSON.parse(saved));
}

export function saveMission(storage, mission) {
  storage.setItem(MISSION_STORAGE_KEY, JSON.stringify(readMission(mission)));
}
