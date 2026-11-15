import { compatible } from './assembly.mjs';
import { inspectRocket } from './rocket-assembly.mjs';
import { EARTH_MU, EARTH_OMEGA, EARTH_RADIUS_M, G0 } from './flight-coordinates.mjs';
import { launchVehicles, vehicleFromAssembly } from './launch-vehicles.mjs';
import { assessCabin } from './crew-life-support.mjs';
import { burnPropellantKg, lunarCarriers } from './lunar-expedition.mjs';
import { readSpacecraft } from './spacecraft-design.mjs';

const rocketEquationSource = 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ideal-rocket-equation/';
const catalogSource = 'original_parts/manifest.json + assembly_hangar/manifest.json (JUGRE fictional catalog)';
const launchGravity = EARTH_MU / EARTH_RADIUS_M ** 2;
const maxParts = 64;

export function idealDeltaV(ispS, startKg, endKg) {
  if (![ispS, startKg, endKg].every(Number.isFinite) || ispS < 0 || endKg <= 0 || endKg > startKg) throw new Error('Invalid rocket equation inputs');
  return ispS * G0 * Math.log(startKg / endKg);
}

export function propulsionAnalysis(vehicle) {
  const stack = [...vehicle.stages, ...(vehicle.boosters ? [vehicle.boosters] : [])];
  const wetMassKg = vehicle.payloadMassKg + vehicle.fairingMassKg + stack.reduce((total, stage) => total + stage.dryMassKg + stage.propellantKg, 0);
  const thrustN = (vehicle.stages[0].igniteAfterS ? 0 : vehicle.stages[0].seaThrustN)
    + (vehicle.boosters ? vehicle.boosters.seaThrustN * (vehicle.boosters.curve?.[0]?.[1] ?? 1) : 0);
  let mass = wetMassKg;
  const stages = vehicle.stages.map((stage, index) => {
    const coupled = Boolean(vehicle.boosters && index === 0);
    const endKg = mass - stage.propellantKg;
    const idealMps = coupled || endKg <= 0 ? null : idealDeltaV(stage.vacuumIspS, mass, endKg);
    const result = { id: stage.id, startKg: mass, endKg, dryKg: stage.dryMassKg, propellantKg: stage.propellantKg, idealMps,
      vacuumFlowKgS: stage.vacuumIspS > 0 ? stage.vacuumThrustN / (G0 * stage.vacuumIspS) : 0 };
    mass = endKg - stage.dryMassKg;
    if (coupled) mass -= vehicle.boosters.dryMassKg + vehicle.boosters.propellantKg;
    return result;
  });
  return { wetMassKg, thrustN, twr: wetMassKg > 0 ? thrustN / (wetMassKg * launchGravity) : 0, stages,
    idealMps: stages.some(stage => stage.idealMps == null) ? null : stages.reduce((sum, stage) => sum + stage.idealMps, 0) };
}

export function check(id, label, status, reason, actual = null, required = null, unit = null, phase = 'liftoff', source = catalogSource, action = null) {
  return { id, label, status, reason, actual, required, unit, phase, source, action };
}

function threshold(id, label, actual, required, unit, phase, reason, action, source = catalogSource) {
  return check(id, label, actual >= required ? 'PASS' : 'FAIL', reason, actual, required, unit, phase, source, action);
}

function layoutId(layout) {
  let hash = 2166136261;
  for (const char of JSON.stringify(layout)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `assembly-${(hash >>> 0).toString(16)}`;
}

export function assemblyBlueprint(layout, specs) {
  if (!Array.isArray(layout) || !layout.length || layout.length > maxParts) throw new Error('Build must contain 1–64 parts.');
  const clean = layout.map(({ key, part, parent, socket, plug, spacecraft }) => ({
    ...(parent === undefined ? { key, part } : { key, part, parent, socket, plug }),
    ...(spacecraft ? { spacecraft: readSpacecraft(spacecraft) } : {}),
  }));
  if (clean.some(entry => entry.spacecraft && specs.get(entry.part)?.vehicle !== 'satellite')) throw new Error('Orbital instruments require a satellite bus.');
  const { components, stages, problems } = inspectRocket(clean, specs);
  return { id: layoutId(clean), layout: clean, components, stages, problems,
    fuelNetworks: stages.map(({ index, tanks, engines }) => ({ stage: index, propellant: 'kerolox', tanks, engines })),
    crewCompartments: components.filter(part => part.stats.crewSeats > 0).map(part => part.key),
    payloadLocations: components.filter(part => part.stats.maxPayloadMassKg > 0 || part.system === 'bay').map(part => part.key),
    electricalTopology: null };
}

export function assessVehicle(plan, selection, specs) {
  const { spec, spacecraft, expedition, interplanetary } = plan;
  const blueprint = typeof selection === 'string'
    ? { id: `carrier-${selection}`, carrier: selection, layout: null, components: [] }
    : assemblyBlueprint(selection, specs);
  const carrier = blueprint.carrier && Object.hasOwn(launchVehicles, blueprint.carrier) && launchVehicles[blueprint.carrier];
  if (blueprint.carrier && !carrier) throw new Error('Launcher not found');
  const vehicle = carrier ? structuredClone(carrier) : vehicleFromAssembly(blueprint.layout, specs, blueprint);
  const parts = blueprint.components;
  const checks = plan.unavailable.map((message, i) => check(`model-${i}`, 'Mission profile', 'UNKNOWN', message));
  const lunarStack = expedition && lunarCarriers.includes(blueprint.carrier);
  const cabins = lunarStack ? [{ part: expedition.hardware, stats: { ...expedition, crewSeats: expedition.seats } }]
    : parts.filter(part => part.stats.crewSeats > 0);
  const seats = cabins.reduce((sum, part) => sum + part.stats.crewSeats, 0);
  const capacityKg = Math.max(0, ...parts.map(part => {
    if (!part.stats.maxPayloadMassKg) return 0;
    const attachedMass = parts.filter(child => child.parent === part.key && child.socket?.startsWith('mount_payload'))
      .reduce((sum, child) => sum + (child.massKg ?? 0), 0);
    return part.stats.maxPayloadMassKg - attachedMass;
  }));
  const crewMass = spec.crewCount * (spec.crewMassKgEach ?? 0);
  let cabin = null;
  const installedSpacecraft = parts.find(part => part.spacecraft);
  const payloadKg = interplanetary?.wetKg ?? spec.payloadMassKg + (installedSpacecraft ? 0 : spacecraft?.massKg ?? 0);
  // Reuse a complete vehicle's demonstrated nominal payload mass as a fictional
  // integration allowance for the Earth parking-orbit teaching scenario.
  if (lunarStack) vehicle.payloadMassKg = expedition.dryKg + expedition.fuelKg * expedition.serviceFuelFraction + payloadKg + crewMass;
  else if (carrier && (spacecraft || interplanetary)) vehicle.payloadMassKg = payloadKg;
  else vehicle.payloadMassKg += payloadKg + crewMass;
  for (const stage of [...vehicle.stages, ...(vehicle.boosters ? [vehicle.boosters] : [])]) stage.propellantKg *= spec.propellantFraction;
  for (const stage of vehicle.stages.slice(1)) stage.throttleLimit = spec.upperThrottle;
  if (plan.executable) {
    vehicle.guidance.targetAltitudeM = plan.target.periapsisM;
    vehicle.guidance.loftAltitudeM = Math.max(plan.target.periapsisM, vehicle.guidance.loftAltitudeM);
  }
  if (parts.some(part => !Number.isFinite(part.massKg) || part.massKg < 0)) {
    checks.push(check('mass-data', 'Part mass', 'UNKNOWN', 'Catalog mass unavailable for some parts.'));
  }
  if (spec.availableParts.length && (carrier || parts.some(part => !spec.availableParts.includes(part.part)))) {
    checks.push(check('parts', 'Available parts', 'FAIL', 'Build uses excluded parts.'));
  }
  if (!carrier) {
    if (blueprint.problems.length) checks.push(check('topology', 'Fuel network and thrust', 'UNKNOWN', blueprint.problems.join(' ')));
    if (blueprint.stages.length > 1 && !blueprint.problems.length) checks.push(check('staging', 'Stage isolation', 'PASS',
      `Independent kerolox networks · ${blueprint.stages.length}. Interstage separates with the lower stage.`));
    const guidance = parts.some(part => ['pk_2_kontur', 'pb_1_strizh'].includes(part.part));
    checks.push(threshold('guidance', 'Flight control', Number(guidance), 1, null, 'liftoff', 'Control module required.', 'Add Swift or Contour.'));
  } else if (spec.propellantFraction !== 1 && vehicle.boosters) {
    checks.push(check('solid-fill', 'Solid boosters', 'UNKNOWN', 'Boosters require the standard fuel load.'));
  }
  if (payloadKg > 0 && !lunarStack) checks.push(threshold('payload', 'Payload mount', carrier && (spacecraft || interplanetary) ? carrier.payloadMassKg : capacityKg, payloadKg, 'kg', 'liftoff',
    carrier && (spacecraft || interplanetary) ? 'Standard payload replacement limit.' : 'Mount payload capacity required.',
    'Reduce payload mass or select a larger launcher.'));
  if (spacecraft) {
    if (spec.spacecraft.manualPlacement) {
      for (const field of ['panels', 'battery', 'radio', 'computer', 'attitude']) {
        if (spec.spacecraft[field] == null) checks.push(check('payload-system-' + field, 'Payload system', 'FAIL',
          'Install ' + ({panels:'a solar array',battery:'a battery',radio:'a radio',computer:'a flight computer',attitude:'attitude control'})[field] +
          ' in PAYLOAD LAB before launch.'));
      }
    }
    const source = 'JUGRE catalog';
    const add = (id, label, actual, required, unit, reason, action) => checks.push(threshold(id, label, actual, required, unit, 'deployment', reason, action, source));
    const { panels, battery, solarW, standbyW, peakW } = spacecraft;
    const eclipseS = spec.orbit ? 2 * Math.asin(EARTH_RADIUS_M / (EARTH_RADIUS_M + spec.orbit.periapsisM))
      * Math.sqrt((EARTH_RADIUS_M + spec.orbit.periapsisM) ** 3 / EARTH_MU) : 2400;
    const eclipseWh = standbyW * eclipseS / (3600 * .92);
    add('solar-power', 'Solar power', solarW, standbyW, 'W', `${panels.areaM2} m² · nominal pointing.`, 'Use larger solar arrays.');
    add('battery-power', 'Battery peak power', battery.dischargeW, peakW, 'W', 'Peak load in eclipse.', 'Use a stronger battery or reduce power demand.');
    add('eclipse-energy', 'Eclipse energy', battery.capacityWh, eclipseWh, 'Wh', 'Maximum eclipse estimate for the target circular orbit.', 'Increase battery capacity.');
    if (spec.spacecraft.budgetM != null) add('budget', 'Payload budget', spec.spacecraft.budgetM, spacecraft.costM, 'M', 'Component and instrument costs.', 'Increase budget or change hardware.');
    if (spec.type === 'science') add('science-payload', 'Science program', spacecraft.selected.length, 1, null, 'Select at least one instrument.', 'Add an instrument.');
    for (const item of spacecraft.selected) {
      add(`geometry-${item.id}`, item.name, Number(item.orbitSupported), 1, null, 'Orbital operations support.', 'Select an orbital instrument.');
      add(`pointing-${item.id}`, `Pointing · ${item.name}`, item.pointingDeg, spacecraft.attitude.accuracyDeg, '°', 'Instrument tolerance and attitude accuracy.', 'Use more precise attitude control.');
    }
  }
  if (interplanetary) {
    const requiredDv = (interplanetary.route.departureMps + interplanetary.route.captureMps) * (1 + spec.safetyMargin);
    const availableDv = idealDeltaV(interplanetary.ispS, interplanetary.wetKg, interplanetary.dryKg + spec.payloadMassKg);
    checks.push(threshold('planet-fuel', 'Probe Δv', availableDv, requiredDv, 'm/s', 'planet-departure',
      'Departure and capture Δv with finite propellant.', 'Increase fuel or specific impulse, reduce cargo, or choose a flyby.'));
    checks.push(check('planet-model', 'Interplanetary model', 'UNKNOWN', 'Approximate JPL positions with two-body transfers and impulsive maneuvers.'));
  }
  if (spec.crewCount > 0) {
    checks.push(threshold('seats', 'Seats', seats, spec.crewCount, 'seats', 'liftoff', 'Seats from the selected catalog vehicle.', 'Select a module with enough seats.'));
    const assessment = assessCabin(plan, cabins);
    checks.push(...assessment.checks);
    cabin = assessment.configuration;
    vehicle.payloadMassKg += assessment.addedMassKg;
  }
  if (expedition && !lunarStack) checks.push(check('expedition-carrier', 'Expedition mount', 'FAIL', 'Select SLS or Saturn V.'));
  if (lunarStack) {
    const fuel = expedition.fuelKg * expedition.serviceFuelFraction;
    const upper = vehicle.stages.at(-1);
    const fromParking = idealDeltaV(upper.vacuumIspS, upper.dryMassKg + upper.propellantKg + vehicle.payloadMassKg,
      upper.dryMassKg + vehicle.payloadMassKg);
    checks.push(threshold('payload', 'Expedition mount', carrier.payloadMassKg, vehicle.payloadMassKg, 'kg', 'liftoff', 'Total spacecraft mass including crew and supplies.', 'Reduce extra cargo.'));
    checks.push(threshold('tli-maximum', 'Upper-stage Δv limit', fromParking, 3150 * (1 + spec.safetyMargin), 'm/s', 'tli',
      'Full-tank estimate. Remaining fuel is checked in flight.', 'Increase fuel load or reduce spacecraft mass.'));
    checks.push(threshold('lunar-fuel', 'Service-module fuel', fuel,
      burnPropellantKg(vehicle.payloadMassKg, 1750 * (1 + spec.safetyMargin), expedition.ispS), 'kg', 'lunar-orbit',
      'Estimated fuel for lunar capture and departure.', 'Increase fuel or reduce mass.'));
    checks.push(threshold('generation-limit', 'Rated spacecraft power', expedition.maxGenerationW, spec.cabin?.generationW ?? 0, 'W', 'liftoff', 'Power system limit.'));
  } else if (spec.returnRequired) checks.push(check('return-hardware', 'Earth return', 'UNKNOWN', 'Restart thrust, heat shield, and recovery unconfirmed.', null, null, null, 'recovery'));
  const performance = propulsionAnalysis(vehicle);
  if (plan.earthLaunch) {
    const thrustReady = performance.twr > 1;
    checks.push(check('liftoff-twr', 'Launch TWR', thrustReady ? 'PASS' : 'FAIL', 'Thrust must exceed weight.',
      performance.twr, 1, null, 'liftoff', catalogSource, 'Reduce mass or increase launch thrust.'));
    if (spec.maxMassKg != null) checks.push(check('mass-limit', 'Launch mass limit', performance.wetMassKg <= spec.maxMassKg ? 'PASS' : 'FAIL',
      'Total mass against the configured limit.', performance.wetMassKg, spec.maxMassKg, 'kg'));
    const orbitalSpeed = plan.requirements.find(item => item.id === 'orbital-speed')?.value;
    if (orbitalSpeed != null) {
      // Screening estimate ignores drag and gravity losses and credits full
      // equatorial rotation. Guidance and measured orbital elements decide flight.
      const screeningMps = (orbitalSpeed - EARTH_OMEGA * EARTH_RADIUS_M
        + (plan.trajectory ? plan.trajectory.departureMps + plan.trajectory.captureMps : 0)) * (1 + spec.safetyMargin);
      const actual = performance.idealMps;
      checks.push(check('delta-v', 'Ideal Δv budget', actual == null ? 'UNKNOWN' : actual < screeningMps ? 'FAIL' : 'PASS',
        'Vacuum estimate. Orbital insertion is verified in flight.', actual, screeningMps, 'm/s',
        'earth-orbit', rocketEquationSource, 'Reduce mass or increase fuel or specific impulse.'));
    }
  }
  checks.push(check('structures', 'Structural stability', 'UNKNOWN', 'Full structural load model unavailable.'));
  const executable = plan.executable && !checks.some(item => ['mass-data', 'topology', 'solid-fill', 'crew-model'].includes(item.id) && item.status === 'UNKNOWN')
    && !checks.some(item => ['seats', 'payload', 'parts', 'oxygen-capacity', 'expedition-carrier', 'generation-limit'].includes(item.id) && item.status === 'FAIL');
  const ready = executable && !checks.some(item => item.status === 'FAIL');
  const feasibility = !executable ? 'Not Feasible' : !ready ? 'Requires Redesign'
    : checks.some(item => item.status !== 'PASS') ? 'Feasible with Warnings' : 'Feasible';
  return { blueprint, vehicle, cabin, performance, checks, executable, ready, feasibility, spacecraft };
}

// Search the catalog's mount-constrained axial stacks. All candidates use the
// same validator as the manual builder; historical complete stacks are optional.
export async function searchVehicles(plan, specs, { signal, progress = () => {} } = {}) {
  const { spec } = plan;
  signal?.throwIfAborted();
  if (plan.interplanetary && plan.spec.assembly !== 'manual') {
    const candidates = Object.keys(launchVehicles).map(carrier => assessVehicle(plan, carrier, specs));
    return candidates.sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.executable) - Number(a.executable) || a.performance.wetMassKg - b.performance.wetMassKg);
  }
  if (plan.expedition) return lunarCarriers.map(carrier => assessVehicle(plan, carrier, specs))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.executable) - Number(a.executable) || a.performance.wetMassKg - b.performance.wetMassKg);
  const candidates = [];
  const available = [...specs].filter(([id]) => !spec.availableParts.length || spec.availableParts.includes(id));
  const tanks = available.filter(([, part]) => part.stats?.propellant === 'kerolox' && part.stats.capacityKg > 0);
  const engines = available.filter(([, part]) => part.stats?.propellant === 'kerolox' && part.stats.thrustKN);
  const seen = new Set();
  async function evaluate(layout) {
    signal?.throwIfAborted();
    const report = assessVehicle(plan, layout, specs);
    if (seen.has(report.blueprint.id)) return;
    seen.add(report.blueprint.id);
    candidates.push(report);
    if (candidates.length % 16 === 0) {
      progress(candidates.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (!spec.availableParts.length && !spec.crewCount && (!spec.payloadMassKg || plan.spacecraft)) {
    for (const id of Object.keys(launchVehicles)) await evaluate(id);
  }
  const allowed = new Set(available.map(([id]) => id));
  const connect = (layout, key, part, parent, socket, plug) => {
    const host = layout.find(entry => entry.key === parent);
    const a = specs.get(host.part).mounts.get(socket), b = specs.get(part)?.mounts.get(plug);
    if (allowed.has(part) && a && b && compatible(a, host.part, b, part)) {
      layout.push({ key, part, parent, socket, plug });
      return true;
    }
    return false;
  };
  for (const [tank] of tanks) {
    for (const [engine] of engines) {
      for (const count of [1, 2, 3]) {
        for (const cluster of [false, true]) {
          const layout = [{ key: 'tank0', part: tank }];
          if (cluster) {
            if (engine !== 'k_125_klen' || !connect(layout, 'frame', 'r_253_triada', 'tank0', 'mount_aft', 'mount_forward')) continue;
            for (let i = 1; i <= 3; i++) connect(layout, `engine${i}`, engine, 'frame', `mount_engine_0${i}`, 'mount_engine');
          } else if (!connect(layout, 'engine', engine, 'tank0', 'mount_aft', 'mount_engine')) continue;
          for (let i = 1; i < count; i++) connect(layout, `tank${i}`, tank, `tank${i-1}`, 'mount_forward', 'mount_aft');
          let top = `tank${count - 1}`;
          if (spec.crewCount) {
            if (connect(layout, 'crew', 'pk_2_kontur', top, 'mount_forward', 'mount_aft')) top = 'crew';
          } else {
            if (connect(layout, 'adapter', 'p_2512_konus', top, 'mount_forward', 'mount_forward')) top = 'adapter';
            if (connect(layout, 'command', 'pb_1_strizh', top, top === 'adapter' ? 'mount_aft' : 'mount_forward', 'mount_aft')) top = 'command';
            if (spec.payloadMassKg || plan.spacecraft) connect(layout, 'payload', 'pn_1_polka', top, 'mount_forward', 'mount_aft');
          }
          await evaluate(layout);
        }
      }
    }
  }
  signal?.throwIfAborted();
  const failures = report => report.checks.filter(item => item.status === 'FAIL').length;
  const score = report => spec.optimization === 'mass' ? report.performance.wetMassKg : -(report.performance.idealMps ?? -Infinity);
  // When two configurations pass, prefer the smallest demonstrated payload
  // allowance for a satellite project before comparing launch mass.
  const payloadAllowance = report => plan.spacecraft && spec.optimization === 'mass'
    ? report.checks.find(item => item.id === 'payload')?.actual ?? 0 : 0;
  return candidates.sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.executable) - Number(a.executable) || failures(a) - failures(b)
    || payloadAllowance(a) - payloadAllowance(b)
    || Number(a.performance.idealMps == null) - Number(b.performance.idealMps == null) || score(a) - score(b)
    || a.blueprint.id.localeCompare(b.blueprint.id));
}
