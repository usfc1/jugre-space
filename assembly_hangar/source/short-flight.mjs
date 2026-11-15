import { LUNAR_TIMING } from './lunar-trajectory.mjs';

const localPhases = new Set(['ascent', 'reentry', 'moonLanding', 'marsLanding', 'moonSurface', 'marsSurface',
  'rendezvous', 'docking', 'separate', 'dartRelease', 'dartApproach', 'dartAftermath']);
const criticalCrewAlerts = new Set(['low-oxygen', 'high-co2', 'cabin-pressure', 'power', 'oxygen-reserve', 'consumables']);

export function apolloExtractionDuration(state) {
  const seconds = state.realTimeLunar ? LUNAR_TIMING.apollo_11.extractionDuration : 6.2;
  return seconds * (state.flightLength === 'short' ? .35 : 1);
}

export function coastFault(state) {
  if (state.failed || state.aborted || state.complete) return 'Flight stopped';
  if (state.systems.integrity < .7 || state.systems.leakKgPerS > 0) return 'Damage or leak';
  if (state.lifeSupport?.alerts.some(id => criticalCrewAlerts.has(id))) return 'Critical life support conditions';
  if (state.satellite?.safe || state.systems.powerFailure) return 'Spacecraft power unavailable';
  return null;
}

export function shortenedSpaceScale(state) {
  if (state.flightLength !== 'short') return 1;
  // Launch and staging retain 60% of the route; distant coasts stay compact.
  if (state.kind === 'ascent') return .6;
  if (localPhases.has(state.kind)) return 1;
  // Deep-space short flights accelerate the route clock. Their planets still
  // render at ephemeris distances so the globes cannot crowd the spacecraft.
  return state.solarFlight || state.interplanetary?.departed ? 1e-6 : 1e-3;
}

export function displayedSpaceScale(state) {
  return state.solarFlight || state.interplanetary?.departed ? 1 : shortenedSpaceScale(state);
}

export function hasShortRoute(state) {
  // Powered launch keeps the fixed-step engine, staging and guidance solver.
  if (localPhases.has(state.kind) || shortenedSpaceScale(state) === 1 || state.preflight > 0 || state.countdown > 0 || coastFault(state)) return false;
  if (state.time >= state.phase.duration - 1e-7) return false;
  if (state.kind === 'orbit') return state.launch.canCoast;
  if (state.id === 'apollo_11' && state.kind === 'moonTransfer' && !state.reported.has('apolloTransposition')) {
    return state.time < (state.path?.burnDuration ?? 0) + LUNAR_TIMING.apollo_11.extractionDelay;
  }
  return Boolean(state.interplanetary?.departed || state.path);
}

export function shortRouteEnd(state) {
  if (state.id === 'apollo_11' && state.kind === 'moonTransfer' && !state.reported.has('apolloTransposition')) {
    return Math.min(state.phase.duration, (state.path?.burnDuration ?? 0) + LUNAR_TIMING.apollo_11.extractionDelay);
  }
  return state.phase.duration;
}

