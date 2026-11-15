import { Quaternion, Vector3 } from 'three';
import { targetInFov } from './spacecraft-control.mjs';
import { MOON_GM, orbitShape } from './orbital-propagator.mjs';
import { DartNavigation } from './dart-navigation.mjs';
import { distanceLimitedDownlink } from './spacecraft-operations.mjs';
import { EARTH_MU, surfaceToInertialVelocity } from './flight-coordinates.mjs';
import { ephemerisVelocity } from './planet-ephemeris.mjs';
import { planRocketManeuver } from './rocket-control.mjs';

const motorProfiles = { apollo_11: { educational: true, fuelKg: 18000, dryKg: 12000, ispS: 314, thrustN: 91000 },
  artemis_ii: { educational: true, fuelKg: 8600, dryKg: 18000, ispS: 316, thrustN: 26700 } };
const cruiseWindows = { marsTransfer: { limitKm: 35, signal: 'marsEntryWindow' },
  jupiterTransfer: { limitKm: 250, signal: 'jupiterBPlane' }, saturnTransfer: { limitKm: 180, signal: 'saturnCorridor' } };
// The existing Titan payload budget (2010 kg) includes an unmodelled kick motor.
// Split that budget explicitly for the teaching departure calculation; these
// values are gameplay estimates, not a reconstruction of the flown Star motor.
export const voyagerKick = { educational: true, dryKg: 80, fuelKg: 1105, spacecraftMassKg: 825, ispS: 285 };
export class HistoricalFlightOperations {
  constructor(id, saved = null) {
    this.id = id; this.throttle = 1; this.manualMotor = false;
    this.massKg = 0; this.fuelKg = 0; this.burn = null; this.burns = [];
    this.offsetM = new Vector3(); this.offsetVelocityMps = new Vector3(); this.lastPhase = -1;
    this.images = []; this.memoryMB = 0; this.downlinkedMB = 0; this.antenna = false; this.instrumentYaw = 0;
    this.flags = {}; this.exerciseSeconds = 0; this.platformRate = 1;
    this.cruise = null;
    this.dart = id === 'dart' ? new DartNavigation() : null;
    this.thermal = { packed: false, unloadedKg: 0, returnKg: 0, sampleC: 4 };
    this.pointingErrorDeg = null; this.sciencePowerW = 0;
    if (saved) {
      if (saved.version !== 1 || saved.id !== id || ![saved.fuelKg, saved.massKg, saved.memoryMB].every(Number.isFinite)) throw new Error('Invalid mission operations');
      for (const k of Object.keys(this)) if (k !== 'id' && Object.hasOwn(saved, k)) this[k] = structuredClone(saved[k]);
      this.offsetM = new Vector3(...saved.offsetM); this.offsetVelocityMps = new Vector3(...saved.offsetVelocityMps);
      this.dart = id === 'dart' ? new DartNavigation(saved.dart) : null;
    }
  }
  evidence(flight, signal, measurement) { flight.report('objectiveEvidence', { signal, measurement, verified: true }, 'evidence:' + signal); }
  step(flight, dt) {
    if (!this.flags.enabled) return;
    if (this.id === 'artemis_ii') this.orionChecks(flight, dt);
    if (this.id === 'voyager_2') this.voyagerStep(flight, dt);
    if (this.id === 'iss_resupply' && this.thermal.packed && flight.kind === 'earthReturn') {
      const goal = flight.systems.powerFailure ? 24 : 4;
      this.thermal.sampleC = goal + (this.thermal.sampleC - goal) * Math.exp(-dt / 4800);
    }
    if (['marsTransfer', 'jupiterTransfer'].includes(flight.kind) && flight.path?.physical && !this.flags.centaurDone) this.centaurDeparture(flight);
    if (this.id === 'iss_resupply') this.dragonStep(flight, dt);
    if (cruiseWindows[flight.kind] && flight.path?.physical) this.cruiseStep(flight);
    if (this.dart) this.dartStep(flight);
    if (flight.kind === 'moonLanding' && flight.reported.has('eagleSeparate') && flight.engine && flight.altitude > 0) {
      this.evidence(flight, 'descentBurn', { altitudeM: flight.altitude * 1000, throttle: flight.enginePower });
    }
    if (!motorProfiles[this.id] || !flight.path?.physical || !['moonTransfer', 'moonOrbit', 'earthReturn'].includes(flight.kind)) return;
    const upper = flight.kind === 'moonTransfer' && this.id === 'apollo_11';
    const stage = flight.launch.vehicle.stages.at(-1);
    const cfg = upper ? { thrustN: stage.vacuumThrustN, ispS: stage.vacuumIspS, fuelKg: flight.launch.stages.at(-1).fuelKg, dryKg: flight.massKg - flight.launch.stages.at(-1).fuelKg } : motorProfiles[this.id], path = flight.path;
    const midpoint = Math.max(0, flight.time - dt / 2), reference = path.sample(midpoint).proper.clone().multiplyScalar(1000);
    if (this.lastPhase !== flight.phaseIndex) {
      this.lastPhase = flight.phaseIndex; this.offsetM.set(0, 0, 0); this.offsetVelocityMps.set(0, 0, 0);
      if (!this.massKg || !upper && !this.flags.serviceTank) { this.massKg = cfg.dryKg + cfg.fuelKg; this.fuelKg = cfg.fuelKg; }
      if (!upper) this.flags.serviceTank = true;
      this.burn = { phase: flight.kind, nominal: [0, 0, 0], delivered: [0, 0, 0], startS: flight.totalTime - flight.time, complete: false, usedKg: 0 };
    }
    const b = this.burn;
    if (reference.lengthSq() && !b.complete) {
      const direction = flight.mode === 'manual' && this.manualMotor && flight.manualControl.attitude
        ? new Vector3(0, 1, 0).applyQuaternion(flight.manualControl.attitude) : reference.clone().normalize();
      const throttle = flight.mode === 'manual' && this.manualMotor ? this.throttle : 1;
      const automatic = flight.mode !== 'manual' || !this.manualMotor;
      const exhaustMps = cfg.ispS * 9.80665;
      const nominal = reference.clone().multiplyScalar(dt);
      // Reference guidance follows the precomputed trajectory. In manual mode the
      // motor has a finite thrust limit and any error changes the actual state.
      const requestedKg = automatic ? -this.massKg * Math.expm1(-nominal.length() / exhaustMps)
        : cfg.thrustN * throttle * dt / exhaustMps;
      const usedKg = Math.min(this.fuelKg, requestedKg);
      const requestedN = usedKg * exhaustMps / dt;
      const delivered = direction.multiplyScalar(-exhaustMps * Math.log1p(-usedKg / this.massKg));
      this.massKg -= usedKg; this.fuelKg -= usedKg; b.usedKg += usedKg;
      if (upper) flight.launch.stages.at(-1).fuelKg = this.fuelKg;
      b.nominal = new Vector3(...b.nominal).add(nominal).toArray(); b.delivered = new Vector3(...b.delivered).add(delivered).toArray();
      this.offsetVelocityMps.add(delivered.sub(nominal));
      flight.throttle = throttle; flight.engine = requestedN > 0; flight.thrustN = requestedN;
    }
    this.offsetM.addScaledVector(this.offsetVelocityMps, dt);
    flight.position.addScaledVector(this.offsetM, .001); flight.velocity.addScaledVector(this.offsetVelocityMps, .001);
    flight.massKg = this.massKg; flight.fuelMassKg = this.fuelKg;
    if (!b.complete && flight.time >= path.burnDuration && new Vector3(...b.nominal).length() > 0) {
      b.complete = true; this.throttle = 0;
      const expected = new Vector3(...b.nominal), actual = new Vector3(...b.delivered);
      b.errorFraction = actual.distanceTo(expected) / expected.length(); this.burns.push(structuredClone(b));
      if (b.errorFraction <= .01) {
        const measurement = { deltaVMps: actual.length(), errorFraction: b.errorFraction, fuelKg: b.usedKg };
        if (b.phase === 'moonOrbit') {
          const radiusKm = flight.position.clone().sub(flight.moonCenter);
          const orbit = orbitShape(radiusKm, flight.velocity, MOON_GM);
          const periapsisKm = orbit.periapsis - 1737.4;
          if (orbit.energy < 0 && Math.abs(periapsisKm - 110) <= 30) this.evidence(flight, 'lunarOrbitMeasured', { ...measurement, periapsisKm });
          this.evidence(flight, 'burnWindow', { errorS: 0, deltaVMps: actual.length() });
        } else this.evidence(flight, b.phase === 'moonTransfer' ? 'tliBurn' : 'teiBurn', measurement);
        if (b.errorFraction <= .005 && b.phase === 'moonTransfer') this.evidence(flight, 'preciseTliBurn', { errorFraction: b.errorFraction });
      }
    }
  }
  centaurDeparture(flight) {
    const stage = flight.launch.vehicle.stages.at(-1), tank = flight.launch.stages.at(-1);
    const spacecraftMassKg = flight.launch.vehicle.payloadMassKg;
    const exitVelocity = flight.path.sample(0).velocity;
    const epoch = Date.parse(flight.mission.history.launchUtc) + flight.phaseStartTime * 1000;
    if (!Number.isFinite(epoch)) return;
    const excessMps = flight.path.departureExcessMps ?? exitVelocity.distanceTo(ephemerisVelocity('earth', epoch)) * 1000;
    const r = flight.launch.positionM.length();
    const parkingSpeed = surfaceToInertialVelocity(flight.launch.positionM, flight.launch.velocityMps).length();
    const deltaVMps = Math.max(0, Math.sqrt(excessMps ** 2 + 2 * EARTH_MU / r) - parkingSpeed);
    const massKg = spacecraftMassKg + stage.dryMassKg + tank.fuelKg;
    const kick = this.id === 'voyager_2' ? voyagerKick : null;
    const kickDeltaVMps = kick ? kick.ispS * 9.80665 * Math.log((kick.dryKg + kick.fuelKg + kick.spacecraftMassKg) / (kick.dryKg + kick.spacecraftMassKg)) : 0;
    const centaurDeltaVMps = Math.max(0, deltaVMps - kickDeltaVMps);
    const usedKg = massKg * -Math.expm1(-centaurDeltaVMps / (stage.vacuumIspS * 9.80665));
    this.flags.centaurDone = true;
    if (deltaVMps <= 0 || usedKg > tank.fuelKg) { flight.report('departureFuel', { requiredKg: usedKg, availableKg: tank.fuelKg }); return; }
    tank.fuelKg -= usedKg;
    if (kick) this.flags.kickStage = { initialFuelKg: kick.fuelKg, fuelKg: 0, deltaVMps: kickDeltaVMps };
    this.evidence(flight, 'centaurDeparture', { deltaVMps, centaurDeltaVMps, usedKg, excessMps, kickDeltaVMps });
  }
  dragonStep(flight, dt) {
    if (flight.kind === 'docking' && flight.dockingLocked) {
      const c = this.thermal;
      if (!c.pending && flight.mode !== 'manual') this.transferCargo(flight, c.unloadedKg >= 420);
      if (c.pending) {
        c.pending.remainingS -= dt;
        if (c.pending.remainingS <= 0) {
          if (c.pending.returning) {
            c.returnKg += 12; c.packed = c.returnKg >= 36; c.sampleC = 4;
            if (c.packed) this.evidence(flight, 'coldSamplesLoaded', { massKg: c.returnKg, temperatureC: c.sampleC });
          } else {
            c.unloadedKg += 140;
            if (c.unloadedKg >= 420) this.evidence(flight, 'cargoUnloaded', { massKg: c.unloadedKg, manifestComplete: true });
          }
          c.pending = null;
        }
      }
    }
    if (flight.kind === 'orbit' && flight.mode !== 'manual' && !this.flags.phasing) this.dragonPhasing(flight, 12);
    if (flight.surface === 'ocean' && this.thermal.packed && this.thermal.sampleC >= 2 && this.thermal.sampleC <= 8) {
      this.evidence(flight, 'coldSamplesDelivered', { massKg: this.thermal.returnKg, temperatureC: this.thermal.sampleC });
    }
  }
  dragonPhasing(flight, deltaVMps) {
    if (this.id !== 'iss_resupply' || flight.kind !== 'orbit' || this.flags.phasing || !Number.isFinite(deltaVMps) || deltaVMps < 4 || deltaVMps > 24) return false;
    const massKg = 10000, usedKg = massKg * -Math.expm1(-deltaVMps / 2650);
    this.fuelKg = 850 - usedKg;
    const launch = flight.launch;
    const direction = surfaceToInertialVelocity(launch.positionM, launch.velocityMps).normalize();
    launch.velocityMps.addScaledVector(direction, deltaVMps); launch.measure();
    this.flags.phasing = true;
    this.evidence(flight, 'phasingBurn', { deltaVMps, usedKg, periodS: launch.orbit.periodS }); return true;
  }
  icpsBurn(flight, dt) {
    if (this.id !== 'artemis_ii' || flight.kind !== 'orbit' || this.flags.icpsBurnDone) return false;
    const stage = flight.launch;
    if (!this.flags.icpsArmed) {
      const r = stage.positionM.length(), periodS = 86400;
      const a = Math.cbrt(EARTH_MU * (periodS / (2 * Math.PI)) ** 2);
      const target = Math.sqrt(EARTH_MU * (2 / r - 1 / a));
      const speed = surfaceToInertialVelocity(stage.positionM, stage.velocityMps).length();
      try {
        planRocketManeuver(stage, 0, target - speed + 85, 'prograde');
        stage.rocketControl.maneuver.status = 'armed'; this.flags.icpsArmed = true;
      } catch { this.flags.icpsBurnDone = true; return false; }
    }
    const maneuver = stage.rocketControl.maneuver;
    if (maneuver.status !== 'armed') { this.flags.icpsBurnDone = true; return false; }
    stage.advance(dt, { mode: 'manual', rocketTest: true, sas: true, throttle: 1 });
    if (maneuver.status !== 'armed') {
      this.flags.icpsBurnDone = true;
      const periodS = stage.orbit.periodS;
      if (Math.abs(periodS - 86400) < 8640) this.evidence(flight, 'highEllipseMeasured', { periodS, deltaVMps: maneuver.deliveredMps });
    }
    return true;
  }
  voyagerStep(flight, dt) {
    if (!['jupiterTransfer', 'jupiterFlyby', 'saturnTransfer', 'saturnFlyby', 'escape'].includes(flight.kind)) return;
    const earth = flight.bodyCenter('earth'), rangeKm = earth.distanceTo(flight.position);
    const automatic = flight.mode !== 'manual';
    const axis = new Vector3(0, 1, 0);
    const earthDirection = earth.clone().sub(flight.position).normalize();
    const attitude = automatic ? new Quaternion().setFromUnitVectors(axis, earthDirection) : flight.manualControl.attitude;
    this.pointingErrorDeg = attitude ? axis.clone().applyQuaternion(attitude).angleTo(earthDirection) * 180 / Math.PI : null;
    this.antenna = this.pointingErrorDeg !== null && this.pointingErrorDeg <= 8;
    if (this.antenna) this.evidence(flight, 'antennaEarth', { pointingDeg: this.pointingErrorDeg, rangeKm });
    this.sciencePowerW = 470 * 2 ** (-flight.totalTime / (87.7 * 365.25 * 86400));
    if (flight.kind === 'saturnFlyby' && flight.progress >= .5 && !this.flags.platformJammed) {
      this.flags.platformJammed = true; this.platformRate = 1;
      flight.report('platformJam', { commandedRate: this.platformRate }, 'platformJam');
    }
    const targets = this.getInstrumentTargets(flight);
    if (automatic && this.flags.platformJammed) this.platformRate = .2;
    if (automatic && targets.length) {
      const next = targets.find(t => !this.images.some(i => i.target === t.id));
      if (next) this.captureInstrument(flight, next.id, true);
      else if (this.flags.platformJammed && !this.flags.recoveredFrame) {
        this.captureInstrument(flight, targets.at(-1).id, true); this.flags.recoveredFrame = true;
      }
    }
    const rate = this.antenna && this.sciencePowerW > 350 && flight.systems.link ? distanceLimitedDownlink(rangeKm, 5e8, .002) : 0;
    const sent = Math.min(this.memoryMB, rate * dt);
    this.memoryMB -= sent; this.downlinkedMB += sent;
    if (this.downlinkedMB >= 5) this.evidence(flight, 'tapeDownlinked', { downlinkedMB: this.downlinkedMB, rateMBs: rate });
    if (flight.kind === 'saturnFlyby' && this.antenna) {
      const delta = flight.bodyCenter('saturn').clone().sub(flight.position);
      const along = delta.dot(earthDirection);
      if (along > 0 && along < rangeKm && delta.clone().addScaledVector(earthDirection, -along).length() < 60300) {
        this.evidence(flight, 'radioOccultation', { rangeKm, pointingDeg: this.pointingErrorDeg });
      }
    }
  }
  transferCargo(flight, returning) {
    if (this.id !== 'iss_resupply' || !flight.dockingLocked || flight.kind !== 'docking') return false;
    const c = this.thermal;
    if (c.pending || (returning ? c.unloadedKg < 420 || c.returnKg >= 36 : c.unloadedKg >= 420)) return false;
    c.pending = { returning, remainingS: returning ? 12 : 20 };
    return true;
  }
  dartStep(flight) {
    if (flight.kind !== 'dartCruise') return;
    const seconds = this.dartSeconds(flight);
    if (flight.mode !== 'manual') this.dart.solveAutomatically(seconds);
    if (this.dart.target === 'dimorphos') this.evidence(flight, 'dimorphosSelected', { resolved: true, secondsToImpact: seconds });
    if (seconds < 150) {
      this.dart.locked = true;
      if (this.dart.corrections > 0) this.evidence(flight, 'dartCorrections', { deltaVMps: this.dart.deltaVMps, correctionCount: this.dart.corrections });
    }
  }
  dartSeconds(flight) { return flight.kind === 'dartCruise' ? Math.max(0, flight.phase.duration - flight.time) : 0; }
  cruiseStep(flight) {
    const window = cruiseWindows[flight.kind];
    if (this.cruise?.kind !== flight.kind) {
      const velocity = flight.path.sample(flight.time).velocity.normalize();
      const cross = new Vector3(0, 1, 0).cross(velocity).normalize();
      this.cruise = { kind: flight.kind, cross: cross.toArray(), offsetKm: window.limitKm * 5,
        dvMps: 0, burns: [], fuelKg: 25, budgetMps: 28, epoch: 0, correctionKmS: 0 };
    }
    const c = this.cruise;
    const offset = c.offsetKm + (flight.time - c.epoch) * c.correctionKmS;
    flight.position.addScaledVector(new Vector3(...c.cross), offset);
    flight.velocity.addScaledVector(new Vector3(...c.cross), c.correctionKmS);
    if (flight.mode !== 'manual' && c.burns.length < 3 && flight.progress >= [.12, .48, .78][c.burns.length]) {
      const remaining = Math.max(1, flight.phase.duration - flight.time);
      const miss = offset + remaining * c.correctionKmS;
      this.cruiseBurn(flight, -miss * 1000 / remaining * (c.burns.length < 2 ? .8 : 1));
    }
    const missKm = Math.abs(c.offsetKm + (flight.phase.duration - c.epoch) * c.correctionKmS);
    if (c.burns.length >= 2 && missKm < window.limitKm) {
      const detail = { missKm, correctionCount: c.burns.length, deltaVMps: c.dvMps, fuelKg: c.fuelKg };
      this.evidence(flight, window.signal, detail);
      if (c.dvMps <= 12) this.evidence(flight, 'correctionBudget', detail);
      if (c.fuelKg > 16) this.evidence(flight, 'hydrazineReserve', detail);
    }
  }
  cruiseBurn(flight, deltaVMps) {
    const c = this.cruise;
    if (!c || c.kind !== flight.kind || !Number.isFinite(deltaVMps) || Math.abs(deltaVMps) < 1e-5
      || Math.abs(deltaVMps) + c.dvMps > c.budgetMps || c.burns.length >= 3) return false;
    const usedKg = (this.id.startsWith('mars') ? 750 : 570) * -Math.expm1(-Math.abs(deltaVMps) / 2100);
    if (usedKg > c.fuelKg) return false;
    c.offsetKm += (flight.time - c.epoch) * c.correctionKmS; c.epoch = flight.time;
    c.correctionKmS += deltaVMps / 1000; c.dvMps += Math.abs(deltaVMps); c.fuelKg -= usedKg;
    c.burns.push({ seconds: flight.time, deltaVMps, usedKg }); return true;
  }
  getInstrumentTargets(flight) {
    const names = {
      "Восточное море": "Mare Orientale",
      "Кратер Циолковский": "Tsiolkovskiy Crater",
      "Бассейн Южный полюс — Эйткен": "South Pole–Aitken Basin",
      "Восход Земли": "Earthrise",
      "Большое Красное Пятно": "Great Red Spot",
      "Европа": "Europa",
      "Ганимед": "Ganymede",
      "Каллисто": "Callisto",
      "Кольца Юпитера": "Jupiter rings",
      "Кольца Сатурна": "Saturn rings",
      "Энцелад": "Enceladus",
      "Тефия": "Tethys"
    };
    const target = (id, body, offset = [0, 0, 0]) => ({ id, label: names[id] ?? id, p: flight.bodyCenter(body).clone().add(new Vector3(...offset)) });
    if (this.id === 'artemis_ii' && flight.kind === 'lunarFlyby') return [
      target('Восточное море', 'moon', [1100, 500, 1000]), target('Кратер Циолковский', 'moon', [1000, -900, 900]),
      target('Бассейн Южный полюс — Эйткен', 'moon', [650, -1400, 650]), target('Восход Земли', 'earth'),
    ].filter(t => t.id !== 'Восход Земли' || flight.systems.link && this.flags.blackout);
    if (this.id === 'voyager_2' && flight.kind === 'jupiterFlyby') return [
      target('Большое Красное Пятно', 'jupiter', [65000, -18000, 18000]), target('Европа', 'jupiter', [660000, 0, 110000]),
      target('Ганимед', 'jupiter', [-1020000, 0, -300000]), target('Каллисто', 'jupiter', [700000, 0, -1750000]),
      target('Кольца Юпитера', 'jupiter', [120000, 0, 0]),
    ];
    if (this.id === 'voyager_2' && flight.kind === 'saturnFlyby') return [
      target('Кольца Сатурна', 'saturn', [120000, 0, 0]), target('Энцелад', 'saturn', [230000, 0, 67000]), target('Тефия', 'saturn', [-285000, 0, -62000]),
    ];
    return [];
  }
  captureInstrument(flight, id, automatic = false) {
    const target = this.getInstrumentTargets(flight).find(t => t.id === id);
    if (!target || this.flags.platformJammed && this.platformRate > .25 || !flight.position.distanceTo(target.p)) return false;
    const axis = new Vector3(0, 1, 0);
    const attitude = automatic ? new Quaternion().setFromUnitVectors(axis, target.p.clone().sub(flight.position).normalize())
      : flight.manualControl.attitude;
    if (!attitude || !this.photograph(flight, id, target.p, flight.position, attitude, axis)) return false;
    const count = this.getInstrumentTargets(flight).filter(t => t.id !== 'Восход Земли' && this.images.some(image => image.target === t.id)).length;
    if (this.id === 'artemis_ii') {
      if (count >= 3) this.evidence(flight, 'farsidePhotos', { frames: count });
      if (id === 'Восход Земли') this.evidence(flight, 'earthrisePhoto', { frames: 1, linked: true });
    }
    if (this.id === 'voyager_2') {
      if (flight.kind === 'jupiterFlyby' && count === 5) this.evidence(flight, 'jupiterImages', { frames: count });
      if (flight.kind === 'saturnFlyby' && count === 3) this.evidence(flight, 'saturnImages', { frames: count });
      if (this.flags.platformJammed && this.platformRate <= .25) this.evidence(flight, 'platformRecovered', { rate: this.platformRate, image: true });
    }
    return true;
  }
  orionChecks(flight, dt) {
    const life = flight.lifeSupport;
    if (flight.kind === 'lunarFlyby' && flight.mode !== 'manual') {
      const next = this.getInstrumentTargets(flight).find(t => !this.images.some(i => i.target === t.id));
      if (next) this.captureInstrument(flight, next.id, true);
    }
    if (flight.kind === 'lunarFlyby' && !flight.systems.link) this.flags.blackout = true;
    if (this.flags.blackout && flight.systems.link) this.evidence(flight, 'lunarBlackout', { recovered: true });
    if (flight.kind !== 'orbit' || !life) return;
    if (flight.mode !== 'manual' && !this.flags.exerciseDone) life.setActivity(life.crew[0].id, 'exercise');
    if (life.crew.some(member => member.activity === 'exercise') && life.powered.scrubber) {
      this.exerciseSeconds += dt;
      const co2Pa = life.reading().partialPa.co2;
      if (this.exerciseSeconds >= 60 && co2Pa <= 400) {
        this.evidence(flight, 'co2Exercise', { co2Pa, scrubberPowered: true, exerciseS: this.exerciseSeconds });
        this.flags.exerciseDone = true;
        if (flight.mode !== 'manual') life.setActivity(life.crew[0].id, 'nominal');
      }
    }
    if (life.controls.scrubber === false) this.flags.scrubberOff = true;
    if (this.flags.scrubberOff && life.powered.scrubber) this.evidence(flight, 'lifeSupportRestored', { powered: true, co2Pa: life.reading().partialPa.co2 });
    if (flight.systems.link && flight.launch.orbit.energy < 0) this.evidence(flight, 'navigationChecked', { link: true, periapsisM: flight.launch.orbit.periapsisM });
  }
  photograph(flight, target, position, origin, attitude, instrumentAxis = new Vector3(0, 1, 0)) {
    if (this.memoryMB + 1 > 32 || !targetInFov(origin, attitude, position, 12, instrumentAxis)) return false;
    if (!this.images.some(i => i.target === target)) { this.images.push({ target, seconds: flight.totalTime, position: position.toArray() }); this.memoryMB++; }
    return true;
  }
  serialize() { return { version: 1, ...this, dart: this.dart?.serialize(), offsetM: this.offsetM.toArray(), offsetVelocityMps: this.offsetVelocityMps.toArray() }; }
}
