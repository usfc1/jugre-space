import { searchVehicles } from './mission-engineering.mjs';
import { planMission } from './mission-plan.mjs';
import { newMission, planetaryMission, playableLunarExpedition, readMission } from './mission-specification.mjs';
import { isPlanetaryDestination } from './mission-planets.mjs';
import { defaultSpacecraft } from './spacecraft-design.mjs';

// A model proposal is untrusted. Keep this mapping explicit and let the existing
// mission engine decide whether the resulting mission can actually be flown.
export function missionFromSiProposal(proposal, id = globalThis.crypto.randomUUID()) {
  if (!proposal || typeof proposal !== 'object' || typeof proposal.name !== 'string' || !proposal.name.trim()
    || proposal.name.length > 100 || !Number.isInteger(proposal.crewCount) || proposal.crewCount < 0
    || !Number.isFinite(proposal.payloadMassKg) || proposal.payloadMassKg < 0 || proposal.payloadMassKg > 1e6
    || typeof proposal.returnRequired !== 'boolean') throw new Error('The proposal contains invalid mission details.');
  const common = { name: proposal.name.trim(), payloadMassKg: proposal.payloadMassKg };
  if (proposal.destination === 'moon') {
    if (proposal.goal !== 'expedition' || proposal.crewCount !== 4 || !proposal.returnRequired)
      throw new Error('The playable lunar profile requires four astronauts and a return to Earth.');
    return readMission({ ...playableLunarExpedition(id), ...common, category: 'custom' });
  }
  if (proposal.destination === 'earth') {
    if (!['orbit', 'science', 'deployment'].includes(proposal.goal) || proposal.crewCount !== 0 || proposal.returnRequired)
      throw new Error('This Earth profile supports uncrewed orbit, science, or deployment without return.');
    return readMission({ ...newMission(id), ...common, type: proposal.goal,
      durationS: proposal.goal === 'science' ? 4 * 3600 : null,
      spacecraft: proposal.goal === 'orbit' ? null : defaultSpacecraft });
  }
  if (isPlanetaryDestination(proposal.destination)) {
    if (!['flyby', 'orbit'].includes(proposal.goal) || proposal.crewCount !== 0 || proposal.returnRequired)
      throw new Error('Planetary missions currently support uncrewed flybys or orbital probes without return.');
    return readMission({ ...planetaryMission(proposal.destination, proposal.goal, id), ...common });
  }
  throw new Error('That destination is not available in the simulator.');
}

export async function prepareSiMission(proposal, specs, options = {}) {
  let spec = missionFromSiProposal(proposal);
  options.signal?.throwIfAborted();
  // Reuse the same mission plan and vehicle search as Standard/Engineering.
  const plan = planMission(spec);
  const candidates = await searchVehicles(plan, specs, options);
  options.signal?.throwIfAborted();
  const candidate = candidates.find(item => item.ready) ?? candidates.find(item => item.executable) ?? candidates[0] ?? null;
  if (candidate) spec = readMission({ ...spec, blueprintId: candidate.blueprint.id });
  return { spec, plan, candidate };
}
