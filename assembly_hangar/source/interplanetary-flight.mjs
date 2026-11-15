import { Vector3 } from 'three';
import { burnPropellantKg } from './lunar-expedition.mjs';
import { AU_KM, interplanetaryRoute, measuredPlanetOrbit, planetPosition, planets, planetVelocity, sampleInterplanetary, samplePlanetOrbit } from './mission-planets.mjs';
import { surfaceToInertialVelocity } from './flight-coordinates.mjs';

export function createPlanetFlight(plan, saved) {
  if (!saved) return { fuelKg: plan.interplanetary.fuelKg, departed: false, parking: null, epoch: null, route: null };
  if (!Number.isFinite(saved.fuelKg) || saved.fuelKg < 0 || saved.fuelKg > plan.interplanetary.fuelKg || typeof saved.departed !== 'boolean'
    || saved.departed && (!Array.isArray(saved.parking) || saved.parking.length !== 3 || !saved.parking.every(Number.isFinite)
      || !Number.isFinite(saved.epoch) || saved.epoch < 0 || new Vector3().fromArray(saved.parking).length() < 6471
      || new Vector3().fromArray(saved.parking).length() > 10000)) throw new Error('Invalid probe state');
  return { fuelKg: saved.fuelKg, departed: saved.departed, parking: saved.parking, epoch: saved.epoch,
    route: saved.departed ? saved.route && !saved.route.departureUtc && ['start','velocity','arrival','arrivalVelocity','center'].every(k=>Array.isArray(saved.route[k])&&saved.route[k].length===3&&saved.route[k].every(Number.isFinite))
      && Number.isFinite(saved.route.transferS)&&saved.route.transferS>0&&Number.isFinite(saved.route.radiusKm)&&saved.route.radiusKm>0
      ? structuredClone(saved.route)
      : interplanetaryRoute({ ...plan.spec, launchUtc: plan.interplanetary.route.departureUtc, transferS: plan.interplanetary.route.transferS }, new Vector3().fromArray(saved.parking)) : null };
}

function burn(state, deltaV) {
  const probe = state.execution.plan.interplanetary;
  const mass = probe.dryKg + state.design.spec.payloadMassKg + state.interplanetary.fuelKg;
  const usedKg = burnPropellantKg(mass, deltaV, probe.ispS);
  if (usedKg > state.interplanetary.fuelKg + 1e-8) throw new Error('Insufficient probe fuel');
  state.interplanetary.fuelKg = Math.max(0, state.interplanetary.fuelKg - usedKg);
  return usedKg;
}

export function alignPlanetDeparture(state) {
  const { positionM, velocityMps } = state.launch;
  state.interplanetary.route.departureDirection = surfaceToInertialVelocity(positionM, velocityMps).normalize().toArray();
}

export function beginPlanetPhase(state) {
  const spec = state.design.spec;
  const data = state.interplanetary;
  if (state.kind === 'planetTransfer') {
    data.parking = state.launch.positionM.clone().multiplyScalar(.001).toArray();
    data.route = interplanetaryRoute({ ...spec, launchUtc: state.execution.plan.interplanetary.route.departureUtc,
      transferS: state.execution.plan.interplanetary.route.transferS }, new Vector3().fromArray(data.parking));
    alignPlanetDeparture(state);
    const usedKg = burn(state, data.route.departureMps);
    data.epoch = state.totalTime;
    data.departed = true;
    state.phase.duration = data.route.transferS;
    state.launch.releasedPayloadKg = state.execution.plan.interplanetary.wetKg;
    state.launch.massKg = state.launch.mass();
    state.report('planetDeparture', { deltaVMps: data.route.departureMps, propellantKg: usedKg });
    samplePlanetFlight(state);
  } else if (state.kind === 'planetOrbit' || state.kind === 'planetFlyby') {
    const center = planetPosition(spec.destination, data.route.transferS, data.route.transferS, data.route);
    const distanceKm = state.position.distanceTo(center);
    if (Math.abs(distanceKm - data.route.radiusKm) * 1000 > spec.orbit.toleranceM) throw new Error('Planetary encounter point not reached');
    state.report('planetArrival', { rangeKm: distanceKm, altitudeM: (distanceKm - planets[spec.destination].radiusKm) * 1000 });
    if (state.kind === 'planetOrbit') {
      const usedKg = burn(state, data.route.captureMps);
      samplePlanetFlight(state);
      const elements = measuredPlanetOrbit(spec, state.position, state.velocity, center, planetVelocity(spec.destination, data.route.transferS, data.route.transferS, data.route));
      state.report('planetCapture', { ...elements, deltaVMps: data.route.captureMps, propellantKg: usedKg });
    }
  }
}

export function samplePlanetFlight(state) {
  const spec = state.design.spec;
  const data = state.interplanetary;
  const elapsed = state.kind === 'planetTransfer' ? state.time : data.route.transferS + state.time;
  const center = planetPosition(spec.destination, elapsed, data.route.transferS, data.route);
  const centerVelocity = planetVelocity(spec.destination, elapsed, data.route.transferS, data.route);
  if (state.kind === 'planetOrbit') {
    const local = samplePlanetOrbit(spec, state.time, data.route);
    state.position.copy(local.position).add(center);
    state.velocity.copy(local.velocity).add(centerVelocity);
  } else {
    const sample = sampleInterplanetary(data.route, elapsed);
    state.position.copy(sample.position);
    state.velocity.copy(sample.velocity);
  }
  const relative = state.velocity.clone().sub(centerVelocity);
  const radial = state.position.clone().sub(center);
  state.altitude = radial.length() - planets[spec.destination].radiusKm;
  state.speed = relative.length() * 1000;
  state.inertialSpeed = state.velocity.length() * 1000;
  state.verticalSpeed = relative.dot(radial.normalize()) * 1000;
  state.horizontalSpeed = Math.sqrt(Math.max(0, state.speed ** 2 - state.verticalSpeed ** 2));
  state.heading.copy(relative).normalize();
  state.speedReference = `${spec.destination}-relative`;
  state.massKg = state.execution.plan.interplanetary.dryKg + spec.payloadMassKg + data.fuelKg;
  state.fuelMassKg = data.fuelKg;
  state.fuel = 100 * data.fuelKg / Math.max(1, state.execution.plan.interplanetary.fuelKg);
  state.engine = false;
  state.gForce = 0;
  state.properAccelerationMps2.set(0, 0, 0);
  state.acceleration = state.kind === 'planetOrbit' ? planets[spec.destination].mu * 1000 / (state.altitude + planets[spec.destination].radiusKm) ** 2
    : 1.3271244004127942e14 / state.position.clone().add(new Vector3().fromArray(data.route.sunOffset ?? [AU_KM,0,0])).lengthSq();
  const acceleration = state.kind === 'planetOrbit' ? radial.clone()
    : state.position.clone().add(new Vector3().fromArray(data.route.sunOffset ?? [AU_KM, 0, 0])).normalize();
  state.recordNavigation(radial, relative, acceleration.multiplyScalar(-state.acceleration));
}
