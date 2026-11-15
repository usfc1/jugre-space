import { inspectRocket } from './rocket-assembly.mjs';
import { payloadMass } from './payload-configuration.mjs';

// SI throughout: kg, N, m, s. Published engine ratings are nominal; vehicle
// dry masses and guidance below are engineering approximations, not flown data.
export const launchSources = {
  saturn: 'https://www.nasa.gov/wp-content/uploads/static/history/afj/ap08fj/pdf/sa503-flightmanual.pdf',
  apolloFlight: 'https://www.nasa.gov/wp-content/uploads/static/history/SP-4029/Apollo_11d_Ascent_Phase.htm',
  sls: 'https://www.nasa.gov/wp-content/uploads/2022/03/sls-reference-guide-2022-v2-508-0.pdf',
  atlas: 'https://www.ulalaunch.com/docs/default-source/news-items/av_msl_mob.pdf',
  atlas2020: 'https://www.ulalaunch.com/docs/default-source/launch-booklets/mars2020_mobrochure_200717.pdf',
  falcon: 'https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf',
  voyager: 'https://www1.grc.nasa.gov/wp-content/uploads/Centaur-D-1A-pamphlet-1973.pdf',
};
const stage = (id, dryMassKg, propellantKg, seaThrustN, vacuumThrustN, seaIspS, vacuumIspS, parts, extra = {}) => ({
  id, dryMassKg, propellantKg, seaThrustN, vacuumThrustN, seaIspS, vacuumIspS, parts, ignitionDelayS: 1.5, ...extra,
});
const guidance = (verticalSeconds, azimuthDeg, targetAltitudeM, loftAltitudeM, pitchAltitudes) => ({
  verticalSeconds, azimuthDeg, targetAltitudeM, loftAltitudeM, pitchAltitudes,
  maxPitchRateDegS: 1.5, maxG: 4, maxDynamicPressurePa: 38000,
});
const saturn = {
  id: 'saturn-v', name: 'Saturn V / SA-506', source: launchSources.saturn, estimates: 'Nominal mass model and approximate closed-loop guidance',
  payloadMassKg: 45000, diameterM: 10.1, dragCoefficient: .3, fairingMassKg: 0, expectedAscentS: 710,
  stages: [
    stage('S-IC', 130000, 2150000, 33850000, 38600000, 263, 304, ['s_ic', 'interstage_1_2']),
    stage('S-II', 36000, 443000, 4400000, 5070000, 395, 425, ['s_ii', 'interstage_2_3'], { ignitionDelayS: 1.6 }),
    stage('S-IVB', 12000, 107000, 800000, 1033000, 380, 421, ['s_ivb'], { ignitionDelayS: 3.1 }),
  ],
  guidance: guidance(12, 73, 185000, 190000, [[0,0],[1000,3],[10000,20],[30000,43],[65000,65]]),
};
const atlas = (modern = true) => ({
  id: modern ? 'atlas-v-541-mars2020' : 'atlas-v-541-msl', name: `Atlas V 541 / ${modern ? 'RL10C-1' : 'RL10A-4-2'}`,
  source: modern ? launchSources.atlas2020 : launchSources.atlas, estimates: 'Nominal engine ratings; approximate dry masses and guidance',
  payloadMassKg: modern ? 3839 : 3893, diameterM: 5.4, dragCoefficient: .32, fairingMassKg: 3500, expectedAscentS: modern ? 720 : 740,
  stages: [
    stage('CCB / RD-180', 21000, 284450, 3827000, 4152000, 311, 338, ['atlas_v_core', 'atlas_v_interstage', 'atlas_v_boattail']),
    stage('Centaur', 2247, 20830, 85000, modern ? 101900 : 99200, 400, modern ? 450.5 : 451, ['atlas_v_centaur'], { ignitionDelayS: 10 }),
  ],
  boosters: stage('AJ-60A ×4', 4 * 5900, 4 * 40700, 4 * 1550000, 4 * 1688000, 269, 279, ['atlas_v_srb_01','atlas_v_srb_02','atlas_v_srb_03','atlas_v_srb_04'], { solid: true, curve: [[0,.72],[.2,1],[.65,.85],[.9,.55],[1,.12]] }),
  guidance: guidance(modern ? 8 : 9, modern ? 90 : 95, 200000, 310000, [[0,0],[1000,3],[10000,14],[30000,32],[80000,56]]),
});
const falcon = (dragon = false) => ({
  id: dragon ? 'falcon-9-dragon' : 'falcon-9-dart', name: `Falcon 9 Block 5 / ${dragon ? 'Cargo Dragon' : 'DART'}`,
  source: launchSources.falcon, estimates: 'Published thrust; approximate stage dry/propellant masses and guidance',
  payloadMassKg: dragon ? 12500 : 610, diameterM: 3.66, dragCoefficient: .3, fairingMassKg: dragon ? 0 : 1900, expectedAscentS: dragon ? 570 : 540,
  stages: [
    stage('Merlin 1D ×9', 25600, 411000, 7607000, 8227000, 282, 311, ['falcon9_stage_1','falcon9_interstage']),
    stage('Merlin Vacuum', 4000, 107500, 800000, 981000, 300, 348, ['falcon9_stage_2'], { ignitionDelayS: 3 }),
  ],
  // Dragon first enters a parking orbit; rendezvous raises it to station height.
  guidance: guidance(dragon ? 9 : 7, dragon ? 44 : 90, 210000, dragon ? 225000 : 220000, [[0,0],[1000,4],[10000,24],[30000,48],[65000,70]]),
});
export const launchVehicles = {
  apollo_11: saturn,
  artemis_ii: {
    id: 'sls-block-1', name: 'SLS Block 1 / Orion', source: launchSources.sls, estimates: 'Nominal ratings and approximate solid thrust curve/guidance',
    payloadMassKg: 26000, diameterM: 8.4, dragCoefficient: .34, fairingMassKg: 2600, expectedAscentS: 500,
    stages: [
      stage('Core / RS-25 ×4', 85275, 987000, 7440000, 9116000, 366, 452, ['sls_core', 'lvsa']),
      stage('ICPS / RL10B-2', 3490, 27220, 85000, 110100, 410, 462, ['icps'], { ignitionDelayS: 10 }),
    ],
    boosters: stage('Five-segment SRB ×2', 2 * 99000, 2 * 626000, 2 * 15000000, 2 * 16000000, 242, 269, ['sls_srb_l', 'sls_srb_r'], { solid: true, curve: [[0,.93],[.15,1],[.55,.78],[.85,.85],[1,.12]] }),
    guidance: guidance(10, 90, 185000, 210000, [[0,0],[1000,3],[10000,18],[30000,40],[65000,64]]),
  },
  mars_2020: atlas(true), mars_science_laboratory: atlas(false), dart: falcon(false), iss_resupply: falcon(true),
  voyager_2: {
    id: 'titan-iiie-centaur', name: 'Titan IIIE / Centaur', source: launchSources.voyager,
    estimates: 'Approximate Titan/Centaur mass and propulsion model; no claim of a reconstructed flown trajectory',
    payloadMassKg: 2010, diameterM: 4.27, dragCoefficient: .34, fairingMassKg: 2500, expectedAscentS: 600,
    stages: [
      stage('Titan I / LR87', 6500, 117000, 2400000, 2580000, 296, 316, ['titan_stage_1'], { igniteAfterS: 112 }),
      stage('Titan II / LR91', 2800, 29000, 380000, 445000, 290, 318, ['titan_stage_2'], { ignitionDelayS: 1 }),
      stage('Centaur / RL10 ×2', 2200, 15000, 120000, 147000, 400, 444, ['titan_centaur'], { ignitionDelayS: 8 }),
    ],
    boosters: stage('UA1205 ×2', 2 * 33000, 2 * 197000, 2 * 5300000, 2 * 6000000, 250, 265, ['titan_srb_l','titan_srb_r'], { solid: true, curve: [[0,.85],[.2,1],[.65,.9],[1,.3]] }),
    guidance: guidance(11, 90, 190000, 260000, [[0,0],[1000,3],[10000,15],[30000,35],[80000,60]]),
  },
};

export function vehicleForMission(id, custom = null) {
  if (launchVehicles[id]) return structuredClone(launchVehicles[id]);
  if (custom) return structuredClone(custom);
  // A diagnostic engineering vehicle only. The game's custom craft supplies
  // its own component-derived configuration instead of borrowing Saturn V.
  return {
    id: 'jugre-engineering', name: 'JUGRE engineering vehicle', estimates: 'Hypothetical engineering example',
    payloadMassKg: 600, diameterM: 2.5, dragCoefficient: .35, fairingMassKg: 0, expectedAscentS: 600,
    stages: [stage('JUGRE lower', 1800, 34000, 620000, 680000, 285, 315, []), stage('JUGRE upper', 500, 6500, 65000, 80000, 320, 350, [])],
    guidance: guidance(8, 90, 200000, 240000, [[0,0],[1000,4],[10000,22],[30000,45],[70000,66]]),
  };
}

export function launchEventForecasts(vehicle) {
  const burn = stage => stage.propellantKg * stage.vacuumIspS * 9.80665 / Math.max(1, stage.vacuumThrustN);
  const times = { liftoff: 0, 'max-q': Math.min(90, vehicle.expectedAscentS * .14), seco: vehicle.expectedAscentS, orbit: vehicle.expectedAscentS };
  let cursor = vehicle.stages[0].igniteAfterS ?? 0;
  vehicle.stages.forEach((s, i) => {
    cursor += burn(s);
    if (i < vehicle.stages.length - 1) { times[`stage-${i+1}`] = cursor; if (i === 0) times.meco = cursor; cursor += vehicle.stages[i+1].ignitionDelayS; }
  });
  if (vehicle.boosters) {
    const b = vehicle.boosters;
    const mean = b.curve ? b.curve.reduce((sum,p)=>sum+p[1],0)/b.curve.length : 1;
    times.boosters = burn(b) / Math.max(.3, mean);
  }
  times.fairing = vehicle.expectedAscentS * .25;
  return times;
}

function assemblyStage(entries, specs, id, partIds = [], engineKeys = []) {
  let dry = 0, fuel = 0, thrustSea = 0, thrustVac = 0, weightedSea = 0, weightedVac = 0, diameter = 0;
  for (const entry of entries) {
    const p = specs.get(entry.part);
    dry += payloadMass(p, entry.spacecraft) ?? 0;
    const mainPropellant = p.stats?.propellant === 'kerolox';
    if (mainPropellant) fuel += p.stats?.capacityKg ?? 0;
    else dry += p.stats?.capacityKg ?? 0;
    const sea = mainPropellant ? (p.stats?.thrustKN?.seaLevel ?? 0) * 1000 : 0, vac = mainPropellant ? (p.stats?.thrustKN?.vacuum ?? 0) * 1000 : 0;
    thrustSea += sea; thrustVac += vac;
    weightedSea += sea / (p.stats?.specificImpulseS?.seaLevel || 1);
    weightedVac += vac / (p.stats?.specificImpulseS?.vacuum || 1);
    diameter = Math.max(diameter, p.stats?.diameterM ?? 0, p.stats?.mountDiameterM ?? 0);
  }
  return { diameter, ...stage(id, dry, fuel, thrustSea, thrustVac, thrustSea / (weightedSea || 1), thrustVac / (weightedVac || 1), partIds, { engineKeys }) };
}

export function vehicleFromAssembly(layout, specs, rocket = null) {
  const config = vehicleForMission('custom');
  const hasInterstages = layout.some(entry => specs.get(entry.part).stats?.staging === 'integratedInterstage');
  const topology = hasInterstages ? rocket ?? inspectRocket(layout, specs) : null;
  if (topology?.problems.length && !rocket) throw new Error(topology.problems[0]);
  const indexed = new Map(layout.map(entry => [entry.key, entry]));
  const bands = topology?.stages.map(({ index, components, engines }) => assemblyStage(components.map(key => indexed.get(key)), specs,
    `Stage ${index + 1}`, components, engines)) ?? [assemblyStage(layout, specs, 'Assembled propulsion')];
  const diameterM = Math.max(...bands.map(band => band.diameter)) || 2.5;
  Object.assign(config, { id: 'jugre-custom', name: 'JUGRE / assembled components', payloadMassKg: 0, diameterM,
    stages: bands.map(({ diameter, ...band }) => ({ ...band, ...(hasInterstages ? { diameterM: diameter || diameterM, assemblyKeys: true } : {}) })),
    estimates: hasInterstages ? 'Isolated kerolox stages and integrated interstages' : 'Mass, tank capacity and engine ratings from assembled parts; single connected propellant system' });
  return config;
}
