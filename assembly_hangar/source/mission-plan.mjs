import { Vector3 } from 'three';
import { EARTH_MU, EARTH_RADIUS_M } from './flight-coordinates.mjs';
import { keplerState, lambertState, orbitShape } from './orbital-propagator.mjs';
import { readMission } from './mission-specification.mjs';
import { spacecraftTotals } from './spacecraft-design.mjs';
import { entryDurationS, lunarHardware, lunarParking } from './lunar-expedition.mjs';
import { DAY_S } from './mission-units.mjs';
import { defaultProbe, interplanetaryRoute, isPlanetaryDestination, nominalTransferS, planets } from './mission-planets.mjs';

const moonMu = 4.902800118e12;
const moonRadiusM = 1737400;
const radians = Math.PI / 180;
const lunarSource = 'https://www.aa.quae.nl/en/reken/hemelpositie.html';
const phase = (id, name, dependencies = []) => ({ id, name, dependencies });

// Leading lunar ecliptic terms of date. UTC approximates TT in this low-precision model.
export function approximateMoon(utcMs) {
  const days = (utcMs - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const anomaly = (134.963 + 13.064993 * days) * radians;
  const longitude = (218.316 + 13.176396 * days + 6.289 * Math.sin(anomaly)) * radians;
  const latitude = 5.128 * radians * Math.sin((93.272 + 13.229350 * days) * radians);
  const radiusM = 385001000 - 20905000 * Math.cos(anomaly);
  return new Vector3(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), -Math.cos(latitude) * Math.sin(longitude)).multiplyScalar(radiusM);
}

function lunarEstimate(spec) {
  if (!spec.orbit || !spec.launchUtc || !spec.transferS) return null;
  // User-specified epoch is treated as the departure epoch for this preliminary
  // screen. Optimize over free parking-orbit departure longitude in the ecliptic.
  const arrivalTime = Date.parse(spec.launchUtc) + spec.transferS * 1000;
  const arrival = approximateMoon(arrivalTime);
  const moonVelocity = approximateMoon(arrivalTime + 60000).sub(approximateMoon(arrivalTime - 60000)).divideScalar(120);
  const parkingRadius = EARTH_RADIUS_M + 200000;
  const circularMps = Math.sqrt(EARTH_MU / parkingRadius);
  const rp = moonRadiusM + spec.orbit.periapsisM;
  const ra = moonRadiusM + spec.orbit.apoapsisM;
  let best = null;
  for (let i = 0; i < 36; i++) {
    const angle = i * Math.PI / 18;
    const start = new Vector3(Math.cos(angle), 0, -Math.sin(angle)).multiplyScalar(parkingRadius);
    const parkingVelocity = new Vector3(-Math.sin(angle), 0, -Math.cos(angle)).multiplyScalar(circularMps);
    try {
      const { departureVelocity, arrivalVelocity } = lambertState(start.multiplyScalar(.001), arrival.clone().multiplyScalar(.001), spec.transferS, EARTH_MU / 1e9);
      const muKm = EARTH_MU / 1e9;
      const exitOrbit = orbitShape(start, departureVelocity, muKm);
      if (start.dot(departureVelocity) < 0 && exitOrbit.periapsis * 1000 < EARTH_RADIUS_M + 100000) continue;
      const propagated = keplerState(start, departureVelocity, spec.transferS, muKm);
      if (propagated.position.distanceTo(arrival.clone().multiplyScalar(.001)) > 1) continue;
      const departureMps = departureVelocity.multiplyScalar(1000).sub(parkingVelocity).length();
      const excessMps = arrivalVelocity.multiplyScalar(1000).sub(moonVelocity).length();
      const captureMps = Math.sqrt(excessMps ** 2 + 2 * moonMu / rp) - Math.sqrt(moonMu * (2 / rp - 2 / (rp + ra)));
      if (Number.isFinite(departureMps + captureMps) && (!best || departureMps + captureMps < best.departureMps + best.captureMps)) {
        best = { departureMps, captureMps, excessMps, transferS: spec.transferS,
          moonArrivalM: arrival.toArray(), parkingRadiusM: parkingRadius, source: lunarSource };
      }
    } catch { /* This departure longitude has no supported Lambert solution. */ }
  }
  return best;
}

export function planMission(input) {
  const spec = readMission(input);
  const satelliteType = ['science', 'deployment'].includes(spec.type);
  const orbitType = ['orbit', 'exploration'].includes(spec.type);
  const earthLaunch = spec.origin === 'earth' && spec.start === 'surface' && spec.site === 'lc39a';
  const lunar = earthLaunch && spec.destination === 'moon' && orbitType;
  const earthOrbit = earthLaunch && spec.destination === 'earth' && (orbitType || satelliteType);
  const planetary = earthLaunch && isPlanetaryDestination(spec.destination) && ['orbit', 'flyby'].includes(spec.type);
  let interplanetary = null;
  const spacecraft = spacecraftTotals(spec.spacecraft);
  const expedition = lunar && spec.expedition ? { ...spec.expedition, ...lunarHardware[spec.expedition.hardware] } : null;
  const phases = [phase('liftoff', 'Liftoff'), phase('earth-orbit', 'Confirm Earth orbit', ['liftoff'])];
  const unavailable = [];
  if (!earthLaunch) unavailable.push('Launch requires Earth surface at LC-39A.');
  if (!earthOrbit && !lunar && !planetary) unavailable.push('Choose an uncrewed flyby or orbit for planetary missions.');
  if ((earthOrbit || lunar) && !spec.orbit) unavailable.push('Set the target orbit and tolerance.');
  if (earthOrbit && spec.orbit && spec.orbit.periapsisM - spec.orbit.toleranceM < 100000) unavailable.push('Minimum periapsis must be at least 100 km.');
  if (earthOrbit && spec.orbit?.periapsisM > 2000000) unavailable.push('Direct ascent supports low Earth orbit.');
  if (spec.orbit?.inclinationDeg != null) unavailable.push('Target inclination guidance unavailable.');
  if (spec.payloadType === 'equipment' || spec.equipment) unavailable.push('Link equipment to catalog entries.');
  if (satelliteType && !spacecraft) unavailable.push('Select spacecraft hardware.');
  if (spacecraft && (!satelliteType || spec.crewCount)) unavailable.push('Satellite hardware supports uncrewed deployment and science.');
  if (spacecraft && satelliteType) {
    phases.push(phase('deployment', 'Deploy payload', ['earth-orbit']));
    if (spec.type === 'science') {
      phases.push(phase('observation', 'Collect science data', ['deployment']), phase('downlink', 'Downlink target data', ['observation']));
      if (!spec.durationS) unavailable.push('Set the science mission duration.');
    }
  }
  if (spec.expedition && !lunar) unavailable.push('Expedition spacecraft requires an Earth–Moon orbital mission.');
  if (lunar) {
    phases.push(phase('tli', 'Translunar injection', ['earth-orbit']), phase('lunar-coast', 'Transfer and corrections', ['tli']),
      phase('lunar-orbit', 'Lunar capture and orbit check', ['lunar-coast']));
    if (expedition) {
      phases.push(phase('lunar-operations', 'Lunar orbit operations', ['lunar-orbit']));
      if (spec.crewCount !== 4 || !spec.returnRequired) unavailable.push('Profile requires four astronauts and Earth return.');
      if (!spec.transferS || spec.transferS < 2 * DAY_S || spec.transferS > 6 * DAY_S) unavailable.push('Set lunar transfer to two through six days.');
      if (spec.orbit && (spec.orbit.periapsisM < 80000 || spec.orbit.apoapsisM > 250000)) unavailable.push('Lunar capture supports altitudes of 80–250 km.');
      if (spec.orbit && spec.orbit.apoapsisM !== spec.orbit.periapsisM) unavailable.push('Set a circular lunar orbit to calculate the return window.');
      if (spec.durationS && spec.transferS && spec.durationS < spec.transferS + expedition.operationsS + expedition.returnS + entryDurationS + 2 * 3600) unavailable.push('Allow time for transfers, operations, landing, and two hours of reserve.');
    } else {
      unavailable.push('Select expedition hardware with recovery equipment.');
      if (!spec.launchUtc || !spec.transferS) unavailable.push('Set a UTC departure and transfer duration.');
    }
    if (spec.durationS && spec.transferS && spec.durationS < spec.transferS) unavailable.push('Mission duration is shorter than the transfer.');
  }
  if (!expedition && !planetary && spec.durationS != null) phases.push(phase('duration', 'Complete mission duration', [lunar ? 'lunar-orbit' : spacecraft ? 'deployment' : 'earth-orbit']));
  if (spec.returnRequired) {
    phases.push(phase('return-burn', 'Return burn', [phases.at(-1).id]), phase('entry', 'Atmospheric entry', ['return-burn']),
      phase('recovery', 'Landing and recovery', ['entry']));
    if (!expedition) unavailable.push('Recovery model unavailable for this custom build.');
  }
  if (spec.crewCount && spec.durationS == null) unavailable.push('Set mission duration for life support.');
  if (spec.crewCount && spec.crewMassKgEach == null) unavailable.push('Set the mass per astronaut.');
  if (planetary) {
    if (!spec.orbit) unavailable.push('Set flyby altitude or a planetary orbit.');
    if (spec.crewCount) unavailable.push('Interplanetary profiles require an uncrewed probe.');
    if (spec.spacecraft) unavailable.push('Use an interplanetary module for this mission.');
    const nominal = nominalTransferS(spec.destination);
    if (spec.transferS && (spec.transferS < nominal * .5 || spec.transferS > nominal * 1.5)) unavailable.push('Set transfer time to 50–150% of nominal, or leave blank.');
    if (spec.orbit && spec.orbit.periapsisM < (planets[spec.destination].giant ? 1000000 : 200000)) unavailable.push('Minimum altitude is 200 km for rocky planets and 1,000 km for giants.');
    if (!unavailable.length) {
      try {
        const route = interplanetaryRoute(spec);
        const probe = spec.interplanetary ?? defaultProbe;
        const operationS = spec.type === 'orbit' ? 86400 : 1;
        if (spec.durationS != null && spec.durationS < route.transferS + operationS + 7200) unavailable.push('Allow time for the transfer, planetary operations, and two hours for launch.');
        interplanetary = { ...probe, route, wetKg: probe.dryKg + probe.fuelKg + spec.payloadMassKg, operationS };
      } catch { unavailable.push('Transfer calculation failed. Check altitude and time.'); }
    }
    phases.push(phase('planet-departure', 'Probe injection and separation', ['earth-orbit']),
      phase('planet-arrival', `Arrival · ${planets[spec.destination].name}`, ['planet-departure']));
    if (spec.type === 'orbit') phases.push(phase('planet-orbit', 'Planetary capture and orbit check', ['planet-arrival']));
  }
  const trajectory = lunar && !expedition ? lunarEstimate(spec) : null;
  const target = earthOrbit ? spec.orbit : lunar || planetary ? lunarParking : null;
  const requirements = [];
  if (target) requirements.push({
    id: 'orbital-speed', phase: 'earth-orbit', unit: 'm/s',
    value: Math.sqrt(EARTH_MU / (EARTH_RADIUS_M + target.periapsisM)),
    method: 'Circular velocity at periapsis', source: 'flight-coordinates.mjs',
  });
  if (trajectory) requirements.push(
    { id: 'tli-dv', phase: 'tli', unit: 'm/s', value: trajectory.departureMps, method: 'Lambert estimate', source: lunarSource },
    { id: 'capture-dv', phase: 'lunar-orbit', unit: 'm/s', value: trajectory.captureMps, method: 'Impulsive capture estimate', source: lunarSource },
  );
  if (interplanetary) requirements.push(
    { id: 'planet-departure-dv', phase: 'planet-departure', unit: 'm/s', value: interplanetary.route.departureMps, method: 'Impulsive departure from parking orbit', source: 'https://ssd.jpl.nasa.gov/astro_par.html' },
    { id: 'planet-capture-dv', phase: 'planet-orbit', unit: 'm/s', value: interplanetary.route.captureMps, method: 'Impulsive capture estimate', source: 'https://ssd.jpl.nasa.gov/astro_par.html' },
    { id: 'planet-transfer', phase: 'planet-arrival', unit: 's', value: interplanetary.route.transferS, method: 'Lambert transfer using approximate JPL positions', source: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html' },
  );
  return { spec, phases, requirements, trajectory, unavailable, earthLaunch, lunar, spacecraft, expedition, interplanetary, target,
    executable: (earthOrbit || !!expedition || !!interplanetary) && unavailable.length === 0, durationS: spec.durationS };
}
