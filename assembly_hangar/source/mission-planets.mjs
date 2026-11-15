import { Vector3 } from 'three';
import { finite, DAY_S } from './mission-units.mjs';
import { keplerState, lambertState, orbitShape } from './orbital-propagator.mjs';
import { ephemerisPosition, ephemerisVelocity } from './planet-ephemeris.mjs';
import { earthDeparture } from './earth-departure.mjs';

// NASA NSSDCA mean orbital distances / diameters; JPL DE440 system GMs.
// New routes use dated approximate JPL elements; circular geometry is retained
// only when reading legacy saved routes without a departure epoch.
export const PLANET_SOURCES = ['https://nssdc.gsfc.nasa.gov/planetary/factsheet/index.html', 'https://ssd.jpl.nasa.gov/astro_par.html', 'https://ssd.jpl.nasa.gov/planets/approx_pos.html'];
export const AU_KM = 149597870.7;
export const SUN_GM = 1.3271244004127942e11;
export const YEAR_S = 365.25 * DAY_S;
export const planets = {
  mercury: { name: 'Mercury', distanceKm: 57.9e6, radiusKm: 2439.5, mu: 22031.868551, color: '#a49b90', description: 'Rocky planet nearest the Sun' },
  venus: { name: 'Venus', distanceKm: 108.2e6, radiusKm: 6052, mu: 324858.592, color: '#d8ba7a', description: 'Cloud-covered inner planet' },
  mars: { name: 'Mars', distanceKm: 228e6, radiusKm: 3396, mu: 42828.375816, color: '#c37550', description: 'Flyby or orbital survey' },
  jupiter: { name: 'Jupiter', distanceKm: 778.5e6, radiusKm: 71492, mu: 126712764.1, color: '#c7aa8a', giant: true, description: 'Gas giant' },
  saturn: { name: 'Saturn', distanceKm: 1432e6, radiusKm: 60268, mu: 37940584.8418, color: '#d6c492', giant: true, description: 'Ringed gas giant' },
  uranus: { name: 'Uranus', distanceKm: 2867e6, radiusKm: 25559, mu: 5794556.4, color: '#91d0d4', giant: true, description: 'Outer ice giant' },
  neptune: { name: 'Neptune', distanceKm: 4515e6, radiusKm: 24764, mu: 6836527.10058, color: '#537cd6', giant: true, description: 'Outermost planet' },
};
export const bodyNames = { earth: 'Earth', moon: 'Moon', ...Object.fromEntries(Object.entries(planets).map(([id, body]) => [id, body.name])) };
export const isPlanetaryDestination = id => Object.hasOwn(planets, id);
export const defaultProbe = { dryKg: 450, fuelKg: 12000, ispS: 450 };
export function readProbe(input) {
  if (input == null) return null;
  return { dryKg: finite(input.dryKg, 'Probe dry mass, kg', 1, 1e6),
    fuelKg: finite(input.fuelKg, 'Probe fuel, kg', 0, 1e6),
    ispS: finite(input.ispS, 'Probe specific impulse, s', 50, 1000) };
}
export function planetaryOrbit(id) {
  const body = planets[id];
  const low = body.giant ? body.radiusKm * 2 : 400;
  return { periapsisM: low * 1000, apoapsisM: (body.giant ? body.radiusKm * 8 : 20000) * 1000,
    toleranceM: Math.min(low * 100, 50000), inclinationDeg: null };
}
export function nominalTransferS(id) {
  const a = (AU_KM + planets[id].distanceKm) / 2;
  return Math.PI * Math.sqrt(a ** 3 / SUN_GM);
}
export function planetPosition(id, elapsed, transferS, route = null) {
  if (route?.departureUtc) return ephemerisPosition(id, Date.parse(route.departureUtc) + elapsed * 1000).sub(new Vector3().fromArray(route.sunOffset));
  const r = id === 'earth' ? AU_KM : planets[id].distanceKm;
  const n = Math.sqrt(SUN_GM / r ** 3);
  const angle = id === 'earth' ? n * elapsed : Math.PI - .04 + n * (elapsed - transferS);
  return new Vector3(Math.cos(angle) * r - AU_KM, 0, -Math.sin(angle) * r);
}
export function planetVelocity(id, elapsed, transferS, route = null) {
  if (route?.departureUtc) return ephemerisVelocity(id, Date.parse(route.departureUtc) + elapsed * 1000);
  const position = planetPosition(id, elapsed, transferS).add(new Vector3(AU_KM, 0, 0));
  return new Vector3(position.z, 0, -position.x).multiplyScalar(Math.sqrt(SUN_GM / position.length() ** 3));
}
export function interplanetaryRoute(spec, parking = new Vector3(6571, 0, 0)) {
  const body = planets[spec.destination];
  const orbit = spec.orbit ?? planetaryOrbit(spec.destination);
  const radiusKm = body.radiusKm + orbit.periapsisM / 1000;
  const nominal = nominalTransferS(spec.destination);
  const reference = Date.parse(spec.launchUtc ?? '2026-11-14T00:00:00.000Z');
  const period = 2*Math.PI*Math.sqrt(body.distanceKm**3/SUN_GM);
  const synodic = 1/Math.abs(1/YEAR_S-1/period);
  const probe=spec.interplanetary??defaultProbe;
  const available=probe.ispS*9.80665*Math.log((probe.dryKg+probe.fuelKg+spec.payloadMassKg)/(probe.dryKg+spec.payloadMassKg));
  let best=null;
  for(let window=0;window<=(spec.launchUtc?0:24);window++) for(const ratio of (spec.transferS?[1]:[.7,.85,1,1.15,1.3])) {
    const epoch=reference+window*synodic/24*1000, transferS=spec.transferS??nominal*ratio;
    const offset=ephemerisPosition('earth',epoch),center=ephemerisPosition(spec.destination,epoch+transferS*1000);
    const arrival=center.clone().addScaledVector(center.clone().normalize(),radiusKm),start=offset.clone().add(parking);
    try {
      const solution=lambertState(start,arrival,transferS,SUN_GM,start.clone().cross(arrival).y<0);
      const residual=keplerState(start,solution.departureVelocity,transferS,SUN_GM).position.distanceTo(arrival);
      if(residual>1)continue;
      const excess=solution.departureVelocity.clone().sub(ephemerisVelocity('earth',epoch)).length();
      const arrivalExcess=solution.arrivalVelocity.clone().sub(ephemerisVelocity(spec.destination,epoch+transferS*1000)).length();
      const departureMps=(Math.sqrt(excess**2+2*398600.4418/parking.length())-Math.sqrt(398600.4418/parking.length()))*1000;
      const captureMps=spec.type==='flyby'?0:(Math.sqrt(arrivalExcess**2+2*body.mu/radiusKm)-Math.sqrt(body.mu*(2/radiusKm-2/(2*body.radiusKm+(orbit.periapsisM+orbit.apoapsisM)/1000))))*1000;
      const budget=departureMps+captureMps;
      const feasible=budget*(1+spec.safetyMargin)<=available;
      if(!best || Number(feasible)>Number(best.feasible) || feasible===best.feasible && budget<best.budget) best={
        feasible,budget,departureUtc:new Date(epoch).toISOString(),sunOffset:offset.toArray(),transferS,departureMps,captureMps,radiusKm,
        center:center.clone().sub(offset).toArray(),arrival:arrival.clone().sub(offset).toArray(),start:start.toArray(),
        velocity:solution.departureVelocity.toArray(),arrivalVelocity:solution.arrivalVelocity.toArray(),positionPrecision:'approximate-JPL'};
    } catch { /* A given date/time can have no supported zero-revolution solution. */ }
  }
  if(!best)throw new Error('No Lambert trajectory for the selected date and duration');
  return best;
}
const planetRouteSamplers = new WeakMap();
export function sampleInterplanetary(route, seconds) {
  let sample = planetRouteSamplers.get(route);
  if (!sample) {
    const start = new Vector3().fromArray(route.start);
    const velocity = new Vector3().fromArray(route.velocity);
    const origin = new Vector3().fromArray(route.sunOffset ?? [AU_KM, 0, 0]);
    const solar = time => {
      const state = keplerState(start, velocity, time, SUN_GM);
      state.position.sub(origin);
      return state;
    };
    const earth = time => planetPosition('earth', time, route.transferS, route);
    sample = earthDeparture(start.clone().sub(origin).sub(earth(0)),
      velocity.clone().sub(planetVelocity('earth', 0, route.transferS, route)), route.transferS, earth, solar,
      route.departureDirection && new Vector3().fromArray(route.departureDirection));
    planetRouteSamplers.set(route, sample);
  }
  return sample(seconds);
}
export function destinationSoiEntry(route, id, startS, endS) {
  const body = planets[id];
  const radiusKm = body.distanceKm * (body.mu / SUN_GM) ** (2 / 5);
  const distance = seconds => sampleInterplanetary(route, seconds).position
    .distanceTo(planetPosition(id, seconds, route.transferS, route)) - radiusKm;
  if (distance(startS) <= 0 || distance(endS) > 0) return null;
  // Search backwards from the known Lambert encounter. Bracket the approach
  // associated with this destination, evaluating the moving body at each epoch.
  const step = (endS - startS) / 128;
  let high = endS, low;
  for (let i = 1; i <= 128; i++) {
    low = i === 128 ? startS : endS - i * step;
    if (distance(low) > 0) break;
    high = low;
  }
  while (high - low > 1e-6) {
    const mid = (low + high) / 2;
    if (distance(mid) > 0) low = mid;
    else high = mid;
  }
  return high;
}
export function samplePlanetOrbit(spec, elapsed, route = null) {
  const body = planets[spec.destination];
  const orbit = spec.orbit;
  const radius = body.radiusKm + orbit.periapsisM / 1000;
  const speed = Math.sqrt(body.mu * (2 / radius - 2 / (2 * body.radiusKm + (orbit.periapsisM + orbit.apoapsisM) / 1000)));
  const radial = route ? new Vector3().fromArray(route.arrival).sub(new Vector3().fromArray(route.center)).normalize()
    : planetPosition(spec.destination, 0, 0).add(new Vector3(AU_KM, 0, 0)).normalize();
  const tangent = new Vector3(radial.z, 0, -radial.x).normalize();
  return keplerState(radial.multiplyScalar(radius), tangent.multiplyScalar(speed), elapsed, body.mu);
}
export function measuredPlanetOrbit(spec, position, velocity, center, centerVelocity) {
  const body = planets[spec.destination];
  const shape = orbitShape(position.clone().sub(center), velocity.clone().sub(centerVelocity), body.mu);
  return { energy: shape.energy, periapsisM: (shape.periapsis - body.radiusKm) * 1000,
    apoapsisM: (shape.a * (1 + shape.eccentricity) - body.radiusKm) * 1000 };
}
