// Historical metadata is deliberately independent of the educational flight clock.
import { vehicleForMission, launchEventForecasts } from './launch-vehicles.mjs';
import { LUNAR_TIMING } from './lunar-trajectory.mjs';
import { historicalEvent } from './historical-mission-time.mjs';
// null means that no verified historical timestamp has been supplied.
export const missionSources = {
  apollo: 'https://www.nasa.gov/history/apollo-11-mission-overview/',
  artemis: 'https://www.nasa.gov/artemis-ii-press-kit/',
  perseverance: 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/',
  curiosity: 'https://mars.nasa.gov/multimedia/interactives/edlcuriosity/indexV2-2.html',
  dart: 'https://science.nasa.gov/mission/dart/',
  voyager: 'https://science.nasa.gov/mission/voyager/planetary-voyage/',
  docking: 'https://www.nasa.gov/international-space-station/space-station-visiting-vehicles/',
};

const event = (id, label, phase, signal, description, extra = {}) => ({
  id, label, phase, signal, description, historicalTime: null, historicalDate: null,
  expectedFraction: 0, condition: 'healthy', ...extra,
});
const launch = (name, boosters = false, first = 'STAGE SEP', second = null) => [
  event('liftoff', name, 'ascent', 'liftoff', 'Liftoff confirmed by thrust and release from the pad.', { condition: 'liftoff' }),
  event('max-q', 'MAX Q', 'ascent', 'maxQ', 'Peak dynamic pressure passed with the vehicle intact.', { expectedFraction: .37 }),
  ...(boosters ? [event('boosters', 'BOOSTER SEP', 'ascent', 'boostersSeparated', 'Boosters separated.', { expectedFraction: .46 })] : []),
  event('meco', 'MECO', 'ascent', 'engineCutoff', 'First-stage engine cutoff.', { filter: { stage: 1 }, expectedFraction: .58 }),
  event('stage-1', first, 'ascent', 'stage', 'Stage separation confirmed.', { filter: { stage: 1 }, expectedFraction: .60 }),
  ...(second ? [event('stage-2', second, 'ascent', 'stage', 'Second-stage separation confirmed.', { filter: { stage: 2 }, expectedFraction: .83 })] : []),
  event('seco', 'SECO', 'ascent', 'engineCutoff', 'Upper-stage cutoff at insertion.', { filter: { final: true }, expectedFraction: 1, through: 'orbit' }),
  event('orbit', 'EARTH ORBIT', 'orbit', 'tick', 'Bound Earth orbit with periapsis above 100 km.', { condition: 'earthOrbit' }),
];
const payload = (phase = 'orbit', hasFairing = true) => [
  ...(hasFairing ? [event('fairing', 'FAIRING SEP', phase === 'orbit' ? 'ascent' : phase, 'fairingSeparated', 'Fairing separated.', { expectedFraction: phase === 'orbit' ? .54 : 0, through: phase })] : []),
  event('payload', 'SPACECRAFT SEP', phase, 'payloadSeparated', 'Spacecraft separated from the launcher.', { expectedFraction: phase === 'orbit' ? .3 : 0 }),
];
const transfer = (phase, injection, cruise) => [
  event(`${phase}-injection`, injection, phase, 'tick', 'Earth departure confirmed.', { condition: 'departure' }),
  event(`${phase}-cruise`, cruise, phase, 'tick', 'Interplanetary coast in progress.', { condition: 'cruise', expectedFraction: .10 }),
  event(`${phase}-correction`, 'TRAJECTORY CORR', phase, 'correction', 'Correction burn confirmed.', { expectedFraction: .35 }),
];
const recovery = () => [
  event('earth-return', 'RETURN TRAJECTORY', 'earthReturn', 'tick', 'Following the Earth-return trajectory.', { condition: 'return' }),
  event('reentry', 'EARTH REENTRY', 'reentry', 'tick', 'Atmospheric entry confirmed.', { condition: 'reentry', expectedFraction: .10 }),
  event('parachutes', 'PARACHUTES', 'reentry', 'parachutes', 'Parachutes deployed.', { expectedFraction: .65 }),
  event('splashdown', 'SPLASHDOWN', 'reentry', 'splash', 'Safe splashdown confirmed.', { condition: 'splash', expectedFraction: .90 }),
];
const edl = rover => [
  event('mars-approach', 'MARS APPROACH', 'marsTransfer', 'tick', 'Mars range below 20,000 km.', { condition: 'marsApproach', expectedFraction: .95 }),
  event('entry', 'ATMOSPHERIC ENTRY', 'marsLanding', 'tick', 'Martian atmospheric entry.', { condition: 'marsEntry', expectedFraction: .15 }),
  event('chute', 'PARACHUTE', 'marsLanding', 'marsParachute', 'Descent parachute deployed.', { expectedFraction: .45 }),
  event('heatshield', 'HEAT SHIELD SEP', 'marsLanding', 'heatshieldSeparated', 'Heat shield separated.', { expectedFraction: .55 }),
  event('powered-descent', 'POWERED DESCENT', 'marsLanding', 'poweredDescent', 'Backshell separated and descent engines active.', { expectedFraction: .76 }),
  event('sky-crane', 'SKY CRANE', 'marsSurface', 'skyCrane', 'Rover lowering on sky-crane cables.'),
  event('touchdown', 'TOUCHDOWN', 'marsSurface', 'marsTouch', 'Safe rover touchdown.', { condition: 'marsTouch' }),
  event('surface', 'ROVER OPERATIONS', 'marsSurface', 'tick', `${rover} · Surface operations confirmed.`, { condition: 'roverOperations', expectedFraction: .2 }),
];
const unavailable = (id, label, phase, description, extra = {}) => event(id, label, phase, null, description, { unsupported: true, ...extra });

const profiles = {
  apollo_11: () => [
    ...launch('LIFTOFF', false, 'S-IC SEP', 'S-II SEP'),
    event('tli', 'TRANSLUNAR INJ', 'moonTransfer', 'tick', 'Translunar injection confirmed.', { condition: 'departure' }),
    ...payload('moonTransfer'),
    event('lm-extraction', 'LM EXTRACTION', 'moonTransfer', 'dock', 'Columbia docked and extracted Eagle.', { filter: { target: 'eagle' } }),
    event('lunar-orbit', 'LUNAR ORBIT', 'moonOrbit', 'tick', 'Bound lunar orbit confirmed.', { condition: 'moonOrbit' }),
    event('lm-separation', 'LM SEPARATION', 'separate', 'undock', 'Eagle separated from Columbia.'),
    event('descent', 'POWERED DESCENT', 'moonLanding', 'tick', 'Eagle descending under power.', { condition: 'descent' }),
    event('landing', 'LUNAR LANDING', 'moonLanding', 'moonTouch', 'Eagle touchdown confirmed.', { condition: 'moonTouch', expectedFraction: 1 }),
    event('eva', 'MOON EVA', 'moonSurface', 'eva', 'Lunar surface expedition started.'),
    event('ascent', 'LUNAR ASCENT', 'rendezvous', 'tick', 'Eagle ascent stage climbing.', { condition: 'lunarAscent' }),
    event('rendezvous', 'RENDEZVOUS / DOCK', 'rendezvous', 'dock', 'Eagle and Columbia docking confirmed.', { filter: { target: 'columbia' }, expectedFraction: .95 }),
    event('tei', 'TRANSEARTH INJ', 'earthReturn', 'tick', 'Earth-return departure confirmed.', { condition: 'return' }),
    ...recovery().filter(e => e.id !== 'earth-return'),
  ],
  artemis_ii: () => [
    ...launch('LIFTOFF', true, 'CORE STAGE SEP'),
    ...payload().filter(e => e.id === 'fairing'),
    unavailable('perigee', 'PERIGEE RAISE', 'orbit', 'Historical ICPS perigee maneuver is unavailable in this profile.', { expectedFraction: .05 }),
    unavailable('apogee', 'APOGEE RAISE', 'orbit', 'Historical ICPS apogee maneuver is unavailable in this profile.', { expectedFraction: .15 }),
    ...payload().filter(e => e.id === 'payload'),
    unavailable('prox-ops', 'PROXIMITY OPS', 'orbit', 'ICPS proximity demonstration is unavailable.', { expectedFraction: .45 }),
    event('checks', 'ORION CHECKS', 'orbit', 'tick', 'Orion vehicle, link, and fuel checks passed.', { condition: 'checks', expectedFraction: .6 }),
    unavailable('second-perigee', 'ORION PERIGEE RAISE', 'orbit', 'Historical Orion perigee maneuver is unavailable in this profile.', { expectedFraction: .85 }),
    ...transfer('moonTransfer', 'ORION TLI', 'LUNAR TRANSIT'),
    event('flyby', 'LUNAR FLYBY', 'lunarFlyby', 'tick', 'Orion lunar flyby.', { condition: 'flyby', expectedFraction: .5 }),
    ...recovery(),
  ],
  mars_2020: () => [...launch('ATLAS V LIFTOFF', true), ...payload(), ...transfer('marsTransfer', 'EARTH DEPARTURE', 'MARS CRUISE'), ...edl('Perseverance')],
  mars_science_laboratory: () => [...launch('ATLAS V LIFTOFF', true), ...payload(), ...transfer('marsTransfer', 'MSL INJECTION', 'MSL CRUISE'), ...edl('Curiosity')],
  dart: () => [
    ...launch('FALCON 9 LIFTOFF'), ...payload(), ...transfer('asteroidTransfer', 'EARTH ESCAPE', 'DIDYMOS CRUISE'),
    event('liciacube', 'LICIACUBE RELEASE', 'dartRelease', 'liciacubeReleased', 'LICIACube separated from DART.'),
    event('acquisition', 'TARGET ACQUISITION', 'dartApproach', 'tick', 'Target inside the DRACO approach corridor.', { condition: 'dartTarget' }),
    event('terminal', 'TERMINAL GUIDANCE', 'dartApproach', 'tick', 'Dimorphos final approach confirmed.', { condition: 'dartTerminal', expectedFraction: .5 }),
    event('impact', 'DIMORPHOS IMPACT', 'dartApproach', 'probeImpact', 'DART reached Dimorphos.', { condition: 'dartImpact', expectedFraction: 1, through: 'dartAftermath' }),
    event('success', 'MISSION SUCCESS', 'dartAftermath', 'success', 'Successful Dimorphos impact confirmed.', { condition: 'dartSuccess', expectedFraction: 1 }),
  ],
  voyager_2: () => [
    ...launch('TITAN IIIE LIFTOFF', true, 'TITAN I SEP', 'TITAN II SEP'), ...payload(),
    ...transfer('jupiterTransfer', 'EARTH DEPARTURE', 'JUPITER CRUISE'),
    event('jupiter', 'JUPITER ENCOUNTER', 'jupiterFlyby', 'tick', 'Jupiter flyby confirmed.', { condition: 'jupiter', historicalDate: '1979-07-09', expectedFraction: .5 }),
    event('jupiter-assist', 'GRAVITY ASSIST', 'saturnTransfer', 'tick', 'Gravity assist toward Saturn.', { condition: 'path' }),
    event('saturn', 'SATURN ENCOUNTER', 'saturnFlyby', 'tick', 'Saturn flyby confirmed.', { condition: 'saturn', historicalDate: '1981-08-25', expectedFraction: .5 }),
    unavailable('uranus', 'URANUS ENCOUNTER', 'escape', 'Historical Uranus encounter is unavailable in this route.', { historicalDate: '1986-01-24' }),
    unavailable('neptune', 'NEPTUNE ENCOUNTER', 'escape', 'Historical Neptune encounter is unavailable in this route.', { historicalDate: '1989-08-25' }),
    event('extended', 'EXTENDED MISSION', 'escape', 'tick', 'Departing the outer planetary system.', { condition: 'path' }),
  ],
  iss_resupply: () => [
    ...launch('FALCON 9 LIFTOFF'), ...payload('orbit', false),
    event('rendezvous', 'RENDEZVOUS', 'stationApproach', 'tick', 'Dragon approaching the ISS.', { condition: 'earthOrbit' }),
    event('alignment', 'ORBITAL ALIGNMENT', 'stationApproach', 'stationAlignment', 'Approach vector aligned with the docking port.', { expectedFraction: .8 }),
    event('approach', 'APPROACH', 'docking', 'stationApproach', 'Station range below 70 m.'),
    event('hold-point', 'HOLD POINT', 'docking', 'dockingHold', 'Dragon stopped at the final hold point.', { expectedFraction: .35 }),
    event('final', 'FINAL APPROACH', 'docking', 'finalApproach', 'Final approach clearance received.', { expectedFraction: .45 }),
    event('soft', 'SOFT CAPTURE', 'docking', 'dock', 'Soft capture confirmed.', { filter: { target: 'iss' }, expectedFraction: .82 }),
    event('hard', 'HARD CAPTURE', 'docking', 'hardCapture', 'Hard capture confirmed.', { expectedFraction: .9 }),
    event('docked', 'DOCKING COMPLETE', 'docking', 'dockingComplete', 'Stable docking confirmed.', { expectedFraction: .95 }),
    ...recovery(),
  ],
};

// Available when a Voyager 1 flight is added to the registry; it never receives
// Voyager 2's Uranus/Neptune encounters.
profiles.voyager_1 = () => profiles.voyager_2().filter(e => !['uranus', 'neptune'].includes(e.id)).map(e => ({
  ...e, historicalDate: e.id === 'jupiter' ? '1979-03-05' : e.id === 'saturn' ? '1980-11-12' : e.historicalDate,
}));

export function registerMissionTimeline(id, factory) {
  if (typeof id !== 'string' || !id || typeof factory !== 'function') throw new TypeError('Mission ID and event factory are required');
  profiles[id] = factory;
}

const missionGoals = {
  apollo_11: ['lm-extraction', 'lunar-orbit', 'landing', 'eva', 'rendezvous', 'splashdown'],
  artemis_ii: ['checks', 'flyby', 'splashdown'],
  mars_2020: ['touchdown', 'surface'], mars_science_laboratory: ['touchdown', 'surface'],
  dart: ['impact', 'success'], voyager_1: ['jupiter', 'saturn', 'extended'],
  voyager_2: ['jupiter', 'saturn', 'extended'], iss_resupply: ['docked', 'splashdown'],
};

export function createMissionTimelineConfig(id, mission) {
  const expedition = mission.expedition;
  const definitions = mission.interplanetary ? [
    ...launch('LIFTOFF', Boolean(mission.launchVehicle?.boosters), 'STAGE SEP', mission.launchVehicle?.stages[2] ? 'STAGE 2 SEP' : null),
    event('planet-departure', 'PLANETARY INJECTION', 'planetTransfer', 'planetDeparture', 'Probe departure burn with finite propellant.', { required: true }),
    event('planet-arrival', 'PLANET ENCOUNTER', mission.phases.at(-1).kind, 'planetArrival', 'Planetary encounter point reached.', { required: true }),
    ...(mission.phases.at(-1).kind === 'planetOrbit' ? [event('planet-capture', 'ORBIT INSERTION', 'planetOrbit', 'planetCapture', 'Bound planetary orbit confirmed.', { required: true })] : []),
  ] : expedition ? [
    ...launch('LIFTOFF', Boolean(mission.launchVehicle?.boosters), 'STAGE SEP', mission.launchVehicle?.stages[2] ? 'STAGE 2 SEP' : null),
    event('tli', 'TRANSLUNAR INJ', 'moonTransfer', 'expeditionTli', 'Measured injection burn and propellant use.'),
    event('lunar-orbit', 'LUNAR ORBIT', 'moonOrbit', 'expeditionCapture', 'Bound lunar orbit confirmed.'),
    event('tei', 'TRANSEARTH INJ', 'earthReturn', 'expeditionReturn', 'Service-module return burn.'),
    event('reentry', 'EARTH REENTRY', 'reentry', 'expeditionEntry', 'Entry angle inside the corridor.'),
    ...recovery().filter(e => ['parachutes', 'splashdown'].includes(e.id)),
  ] : profiles[id]?.() ?? mission.phases.flatMap(p => {
    if (p.kind === 'ascent') return launch('LIFTOFF');
    if (p.kind === 'orbit') return [];
    if (p.kind === 'marsTransfer') return transfer(p.kind, 'TRANS-MARS INJ', 'MARS CRUISE');
    if (p.kind === 'marsLanding') return mission.crew ? [
      event('mars-descent', 'MARS DESCENT', p.kind, 'tick', 'Powered Mars descent.', { condition: 'marsDescent' }),
      event('mars-landing', 'MARS LANDING', p.kind, 'marsTouch', 'Safe Mars landing confirmed.', { condition: 'marsTouch', through: 'marsSurface', expectedFraction: 1 }),
    ] : edl('Mars expedition').filter(e => e.phase === 'marsLanding');
    if (p.kind === 'marsSurface') return mission.crew ? [event('surface-operations', 'SURFACE OPERATIONS', p.kind, 'tick', 'Surface expedition ready.', { condition: 'marsOperations' })] : edl('Mars expedition').filter(e => e.phase === 'marsSurface');
    if (p.kind === 'marsOrbit') return [event('mars-orbit', 'MARS ORBIT INSERT', p.kind, 'tick', 'Bound Mars orbit confirmed.', { condition: 'marsOrbit' })];
    if (p.kind === 'marsAscent') return [event('mars-ascent', 'MARS ASCENT', p.kind, 'tick', 'Mars ascent confirmed.', { condition: 'marsAscent' })];
    if (p.kind === 'earthReturn') return recovery().filter(e => e.phase === 'earthReturn');
    if (p.kind === 'reentry') return recovery().filter(e => e.phase === 'reentry');
    // Future missions receive a real phase condition, never fabricated milestones.
    return [event(p.kind, p.label.toUpperCase(), p.kind, 'tick', p.label, { condition: 'path' })];
  });
  const phases = new Map();
  const timing=LUNAR_TIMING[id];
  if(timing)for(const e of definitions)if(e.phase==='moonTransfer'){
    const seconds=e.id==='tli'||e.condition==='departure'?timing.tliBurn
      : ['fairing','payload'].includes(e.id)?timing.tliBurn+timing.extractionDelay
      : e.id==='lm-extraction'?timing.tliBurn+timing.extractionDelay+timing.extractionDuration:null;
    if(seconds!==null)e.expectedFraction=seconds/mission.phases.find(p=>p.kind==='moonTransfer').duration;
  }
  const vehicle = mission.launchVehicle ?? vehicleForMission(id);
  const launchForecasts = launchEventForecasts(vehicle);
  let offset = 0;
  for (const p of mission.phases) { phases.set(p.kind, { ...p, start: offset }); offset += p.duration; }
  return {
    id, title: mission.title.replace(/^\d+\s*·\s*/, ''), sources: { ...missionSources, ...(mission.history?{history:mission.history.source}:{}) },
    timeBasis: mission.history ? mission.history.precision : 'calculated-mission-time', launchUtc: mission.history?.launchUtc ?? null,
    events: definitions.filter(e => phases.has(e.phase)
      && !(e.id === 'stage-2' && vehicle.stages.length < 3)
      && !(['stage-1','meco'].includes(e.id) && vehicle.stages.length < 2)
      && !(e.id === 'boosters' && !vehicle.boosters)).map((e, index) => ({
      ...e, order: index, expectedFraction: e.phase === 'ascent' && launchForecasts[e.id] !== undefined ? launchForecasts[e.id] / phases.get(e.phase).duration : e.expectedFraction,
      ...(historicalEvent(id,e.id) ? {historicalTime:historicalEvent(id,e.id).seconds,historicalDate:historicalEvent(id,e.id).utc,
        timePrecision:historicalEvent(id,e.id).precision,timeSource:historicalEvent(id,e.id).source} : {}),
      expectedTime: e.phase === 'ascent' && launchForecasts[e.id] !== undefined ? launchForecasts[e.id] : phases.get(e.phase).start + phases.get(e.phase).duration * e.expectedFraction,
      required: e.required ?? (missionGoals[id] ?? ['orbit', 'mars-orbit', 'mars-landing', 'surface-operations', 'mars-ascent', 'splashdown']).includes(e.id),
      phaseIndex: mission.phases.findIndex(p => p.kind === e.phase),
      endPhaseIndex: mission.phases.findIndex(p => p.kind === (e.through ?? e.phase)),
    })).sort((a, b) => a.phaseIndex - b.phaseIndex || a.expectedTime - b.expectedTime || a.order - b.order),
  };
}
