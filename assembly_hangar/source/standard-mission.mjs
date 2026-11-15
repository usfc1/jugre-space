import { assessVehicle, searchVehicles } from './mission-engineering.mjs';
import { planMission } from './mission-plan.mjs';
import { newMission, planetaryMission, playableLunarExpedition, readMission } from './mission-specification.mjs';
import { isPlanetaryDestination, planets } from './mission-planets.mjs';
import { defaultSpacecraft, instruments } from './spacecraft-design.mjs';

export const STANDARD_DRAFT_KEY = 'jugre.standard-mission.v1';
export const standardDestinations = [
  { id: 'earth', title: 'Earth orbit', description: 'Satellites and test flights', image: 'earth', available: true },
  { id: 'moon', title: 'Moon', description: 'Orbital expedition and return', image: 'moon', available: true },
  ...['mars', 'mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'].map(id => ({ id, title: planets[id].name,
    description: planets[id].description, image: id, available: true })),
];
export const standardGoals = {
  earth: [
    { id: 'science', title: 'Observe Earth', description: 'Collect and downlink science data', image: 'science_satellite', available: true },
    { id: 'deployment', title: 'Deploy a satellite', description: 'Release a satellite in orbit', image: 'science_satellite', available: true },
    { id: 'orbit', title: 'Test a rocket', description: 'Reach Earth orbit', image: 'dart', available: true },
    { id: 'docking', title: 'Dock with the ISS', description: 'Unavailable in custom missions', image: 'dragon', available: false },
  ],
  moon: [
    { id: 'expedition', title: 'Orbit the Moon', description: 'Lunar orbit and Earth return', image: 'orion', available: true },
    { id: 'landing', title: 'Land on the Moon', description: 'Unavailable in custom missions', image: 'eagle', available: false },
  ],
};
export const standardCargo = [
  { id: 'expedition', name: 'Expedition cargo', description: 'Orbital expedition hardware', massKg: 232 },
  { id: 'light', name: 'Light cargo', description: 'Compact test payload', massKg: 50 },
  { id: 'none', name: 'No extra cargo', description: 'Vehicle and supplies', massKg: 0 },
];
for (const [id, body] of Object.entries(planets)) standardGoals[id] = [
  { id: 'flyby', title: 'Planetary flyby', description: `Fly past ${body.name}`, image: 'voyager', available: true },
  { id: 'orbit', title: 'Enter orbit', description: 'Brake into a bound orbit', image: 'voyager', available: true },
];

export function newStandardDraft(id = crypto.randomUUID()) {
  return { version: 1, id, name: '', destination: 'earth', goal: 'science', crewCount: 0,
    instrumentIds: ['wide'], cargoId: 'expedition', budgetM: null, flightLength: 'full', step: 0 };
}

export function readStandardDraft(input) {
  if (!input || input.version !== 1 || typeof input.id !== 'string' || !input.id || input.id.length > 100
    || typeof input.name !== 'string' || input.name.length > 100
    || !standardDestinations.some(item => item.id === input.destination && item.available)
    || !standardGoals[input.destination].some(goal => goal.id === input.goal && goal.available)
    || input.crewCount !== (input.destination === 'moon' ? 4 : 0)
    || !Array.isArray(input.instrumentIds) || input.instrumentIds.length > 16
    || new Set(input.instrumentIds).size !== input.instrumentIds.length
    || input.instrumentIds.some(id => !Object.hasOwn(instruments, id))
    || !standardCargo.some(item => item.id === input.cargoId)
    || ![null, 10, 20, 40].includes(input.budgetM)
    || !['full', 'short'].includes(input.flightLength ?? 'full')
    || !Number.isInteger(input.step) || input.step < 0 || input.step > 4) throw new Error('Invalid mission draft');
  return { version: 1, id: input.id, name: input.name.trim(), destination: input.destination, goal: input.goal,
    crewCount: input.crewCount, instrumentIds: [...input.instrumentIds], cargoId: input.cargoId, budgetM: input.budgetM,
    flightLength: input.flightLength ?? 'full', step: input.step };
}

export function standardMissionSpecification(input) {
  const draft = readStandardDraft(input);
  if (isPlanetaryDestination(draft.destination)) {
    const template = planetaryMission(draft.destination, draft.goal, draft.id);
    return readMission({ ...template, name: draft.name || template.name, flightLength: draft.flightLength,
      payloadMassKg: standardCargo.find(item => item.id === draft.cargoId).massKg });
  }
  if (draft.destination === 'moon') {
    const template = playableLunarExpedition(draft.id);
    return readMission({ ...template, name: draft.name || template.name, flightLength: draft.flightLength,
      payloadMassKg: standardCargo.find(item => item.id === draft.cargoId).massKg });
  }
  const base = newMission(draft.id);
  const title = standardGoals.earth.find(item => item.id === draft.goal).title;
  return readMission({ ...base, name: draft.name || title, type: draft.goal, flightLength: draft.flightLength,
    durationS: draft.goal === 'science' ? 4 * 3600 : null,
    spacecraft: draft.goal === 'orbit' ? null : { ...defaultSpacecraft,
      instrumentIds: draft.instrumentIds, budgetM: draft.budgetM } });
}

export function standardDraftFromMission(spec) {
  const draft = newStandardDraft(spec.id);
  draft.name = spec.name;
  draft.flightLength = spec.flightLength ?? 'full';
  if (isPlanetaryDestination(spec.destination) && ['orbit', 'flyby'].includes(spec.type) && !spec.crewCount) {
    return readStandardDraft({ ...draft, destination: spec.destination, goal: spec.type,
      cargoId: standardCargo.find(item => item.massKg === spec.payloadMassKg)?.id ?? 'none' });
  }
  if (spec.expedition && spec.destination === 'moon') {
    return readStandardDraft({ ...draft, destination: 'moon', goal: 'expedition', crewCount: 4,
      cargoId: standardCargo.find(item => item.massKg === spec.payloadMassKg)?.id ?? 'expedition' });
  }
  if (spec.destination !== 'earth' || !standardGoals.earth.some(item => item.available && item.id === spec.type) || spec.crewCount) return null;
  return readStandardDraft({ ...draft, goal: spec.type, instrumentIds: spec.spacecraft?.instrumentIds ?? ['wide'],
    budgetM: [10, 20, 40].includes(spec.spacecraft?.budgetM) ? spec.spacecraft.budgetM : null });
}

export async function prepareStandardMission(input, specs, { signal, progress = () => {} } = {}) {
  let spec = standardMissionSpecification(input);
  signal?.throwIfAborted();
  if (spec.spacecraft) {
    const configurations = [];
    for (const panels of ['standard', 'extended']) {
      for (const battery of ['standard', 'extended']) {
        for (const attitude of ['basic', 'precision']) {
          const candidate = readMission({ ...spec, spacecraft: { ...spec.spacecraft, panels, battery, attitude } });
          const report = assessVehicle(planMission(candidate), 'dart', specs);
          configurations.push({ spec: candidate, report, failures: report.checks.filter(item => item.status === 'FAIL').length });
        }
      }
    }
    configurations.sort((a, b) => a.failures - b.failures || a.report.spacecraft.costM - b.report.spacecraft.costM);
    spec = configurations[0].spec;
  }
  const plan = planMission(spec);
  const candidates = await searchVehicles(plan, specs, { signal, progress });
  signal?.throwIfAborted();
  const candidate = candidates.find(item => item.ready) ?? candidates.find(item => item.executable) ?? candidates[0] ?? null;
  if (candidate) spec = readMission({ ...spec, blueprintId: candidate.blueprint.id });
  return { spec, plan, candidate, candidates };
}
