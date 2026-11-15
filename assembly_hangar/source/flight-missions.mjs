import { MathUtils, Quaternion, Vector3 } from 'three';
import { assistanceLevels, controlProfiles } from './control-profiles.mjs';
import { LanderControl } from './lander-control.mjs';
import { SurfaceExpedition } from './surface-expedition.mjs';
import { HistoricalFlightOperations } from './historical-flight-operations.mjs';
import { LunarAscentControl, lunarAscentConfig } from './lunar-ascent-control.mjs';
import { MarsEdlControl } from './mars-edl-control.mjs';
import { dragonDeorbit, dragonReturnPath } from './dragon-return.mjs';
import { controlContext, restoreManualControl, routeFlightInput, serializeManualControl,
  stepOrbitalAttitude, updateControlSwitches } from './flight-controls.mjs';
import { reentryProfile } from './reentry-profile.mjs';
import { approachOrbit, departureSweep, orbitArc, tangentAlong, transferRoute } from './mission-paths.mjs';
import { FlightSystems } from './flight-systems.mjs';
import { MissionExecution } from './mission-execution.mjs';
import { SpacecraftOperations } from './spacecraft-operations.mjs';
import { CrewLifeSupport } from './crew-life-support.mjs';
import { MissionTimelineManager } from './mission-timeline.mjs';
import { LaunchDynamics } from './launch-dynamics.mjs';
import { launchVehicles, vehicleForMission } from './launch-vehicles.mjs';
import { EARTH_OMEGA, atmosphere, surfaceToInertialVelocity } from './flight-coordinates.mjs';
import { EARTH_GM, keplerState, MOON_GM, orbitShape } from './orbital-propagator.mjs';
import { createEarthReturn, createLunarEntryReturn, createLunarOrbit, createLunarTransfer, LUNAR_TIMING } from './lunar-trajectory.mjs';
import { burnPropellantKg, entryDurationS, lunarCarriers, expeditionCabin } from './lunar-expedition.mjs';
import { captureVelocity, lunarCoast, lunarOutbound, lunarReturn, planLunarDeparture, returnOpportunity } from './lunar-flight-plan.mjs';
import { initialEntry, stepEntry } from './lunar-entry.mjs';
import { alignPlanetDeparture, beginPlanetPhase, createPlanetFlight, samplePlanetFlight } from './interplanetary-flight.mjs';
import { destinationSoiEntry, planets } from './mission-planets.mjs';
import { coastFault, hasShortRoute, shortRouteEnd, shortenedSpaceScale } from './short-flight.mjs';
import { crewGenerationFactor } from './coast-lighting.mjs';
import { applyHistoricalTime } from './historical-mission-time.mjs';
import { historicalBody, historicalFlybyPath, historicalSolarPath, solarHistoricalKinds } from './historical-flight-path.mjs';
import { approximateMoon } from './mission-plan.mjs';
import {
  DART_AFTERMATH_TIME, DART_APPROACH_RANGE, DART_APPROACH_TIME, DART_NOMINAL_ORIGIN,
  DART_RELEASE_RANGE, DART_SPEED, DART_TARGET, dartHeading, dartRange, dartWorldPosition, isDartEncounter,
} from './dart-course.mjs';

export const PREIGNITION_SECONDS = 2.4;

export const EARTH_RADIUS = 6371;
export const MOON_RADIUS = 1737.4;
export const FLORIDA = { lat: 28.6084, lon: -80.6042 };
export function geoVector(lat, lon, radius = 1) {
  const a = MathUtils.degToRad(lat);
  const b = MathUtils.degToRad(lon);
  return new Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)).multiplyScalar(radius);
}
export const launchUp = geoVector(FLORIDA.lat, FLORIDA.lon);
export const east = new Vector3(-Math.sin(MathUtils.degToRad(FLORIDA.lon)), 0, -Math.cos(MathUtils.degToRad(FLORIDA.lon)));
// Reference Moon at mean range, aligned with the nominal Apollo parking plane.
// This is a patched-conic reference geometry, not a live/historical ephemeris.
export const MOON = new Vector3(382588.494521671,35386.96863744294,11711.802179593327);
export const moonUp = MOON.clone().normalize().negate();
const moonEast = tangentAlong(moonUp, east);
export const MARS = new Vector3(0.84, 0.13, -0.527).normalize().multiplyScalar(850000);
const marsSites = { mars_2020: geoVector(18.44, 77.45), mars_science_laboratory: geoVector(-4.59, 137.44) };
export const JUPITER = new Vector3(-0.48, 0.11, -0.87).normalize().multiplyScalar(1600000);
export const SATURN = new Vector3(-0.83, 0.18, -0.52).normalize().multiplyScalar(2600000);
export const ASTEROID = DART_TARGET;

const earthCenter = new Vector3();
const entryUp = geoVector(27.4, -77.4);
const recoveryUp = geoVector(27.4, -72.1);
const entryHeading = tangentAlong(entryUp, recoveryUp);
const entryArc = entryUp.angleTo(recoveryUp);
const transferTargets = {
  moonTransfer: { center: MOON, radius: MOON_RADIUS + 120, speed: [10.8, 1.1, 2.4] },
  marsTransfer: { center: MARS, radius: 4189.5, speed: [11.6, 24, 5.5] },
  jupiterTransfer: { center: JUPITER, radius: 110000, speed: [12.4, 13, 25] },
  saturnTransfer: { center: SATURN, radius: 105000, speed: [25, 15, 19] },
};
const minimumScreenTime = {
  ascent: 7, orbit: 2.4, moonOrbit: 1.8, lunarFlyby: 2.2, separate: 3.4, moonLanding: 4.0,
  moonSurface: 2, rendezvous: 5.8, reentry: 8.4, marsLanding: 6.0, marsSurface: 2,
  dartRelease: 6, stationApproach: 2.4, docking: 2.4, jupiterFlyby: 2.2, saturnFlyby: 2.2,
};
const phase = (label, kind, duration) => ({ label, kind, duration });
export const missions = {
  apollo_11: {
    title: '01 · Apollo 11', destination: 'Moon · Sea of Tranquility', payload: 'apollo_docked', capsule: 'columbia', crew: true,
    phases: [
      phase('Launch', 'ascent', 52),
      phase('Earth orbit', 'orbit', 16),
      phase('Translunar coast', 'moonTransfer', 128),
      phase('Lunar orbit', 'moonOrbit', 18),
      phase('Eagle separation', 'separate', 7),
      phase('Lunar landing', 'moonLanding', 24),
      phase('Surface operations', 'moonSurface', 14),
      phase('Ascent and Columbia rendezvous', 'rendezvous', 22),
      phase('Earth return', 'earthReturn', 118),
      phase('Entry and splashdown', 'reentry', 32),
    ],
  },
  artemis_ii: {
    title: '02 · Artemis II', destination: 'Lunar flyby → Earth', payload: 'orion', capsule: 'orion', crew: true,
    phases: [
      phase('Launch', 'ascent', 52),
      phase('Earth orbit', 'orbit', 16),
      phase('Translunar coast', 'moonTransfer', 128),
      phase('Lunar farside flyby', 'lunarFlyby', 26),
      phase('Earth return', 'earthReturn', 118),
      phase('Entry and splashdown', 'reentry', 32),
    ],
  },
  mars_2020: {
    title: '03 · Mars 2020', destination: 'Mars · Perseverance & Ingenuity', payload: 'mars2020_ship', rover: 'perseverance',
    phases: [
      phase('Launch', 'ascent', 52), phase('Earth orbit', 'orbit', 16),
      phase('Mars transfer', 'marsTransfer', 158), phase('Mars descent', 'marsLanding', 24),
      phase('Perseverance on Mars', 'marsSurface', 12),
    ],
  },
  mars_science_laboratory: {
    title: '04 · Mars Science Laboratory', destination: 'Mars · Curiosity', payload: 'msl_ship', rover: 'curiosity',
    phases: [
      phase('Launch', 'ascent', 52), phase('Earth orbit', 'orbit', 16),
      phase('Mars transfer', 'marsTransfer', 158), phase('Mars descent', 'marsLanding', 24),
      phase('Curiosity on Mars', 'marsSurface', 12),
    ],
  },
  dart: {
    title: '05 · DART', destination: 'Dimorphos · Didymos system', payload: 'dart', target: 'didymos',
    phases: [
      phase('Falcon 9 launch', 'ascent', 52), phase('Insertion and ROSA deployment', 'orbit', 16),
      phase('Didymos transfer', 'asteroidTransfer', 124),
      phase('LICIACube separation', 'dartRelease', 8),
      phase('Dimorphos coast', 'dartCruise', 15*86400),
      phase('Dimorphos final approach', 'dartApproach', DART_APPROACH_TIME),
      phase('Impact ejecta', 'dartAftermath', DART_AFTERMATH_TIME),
    ],
  },
  voyager_2: {
    title: '06 · Voyager 2', destination: 'Jupiter → Saturn → deep space', payload: 'voyager',
    phases: [
      phase('Launch', 'ascent', 52), phase('Earth orbit', 'orbit', 16),
      phase('Jupiter transfer', 'jupiterTransfer', 164),
      phase('Jupiter flyby', 'jupiterFlyby', 18),
      phase('Saturn transfer', 'saturnTransfer', 154),
      phase('Saturn flyby', 'saturnFlyby', 18),
      phase('Outer solar system', 'escape', 110),
    ],
  },
  iss_resupply: {
    title: '07 · ISS Resupply', destination: 'Earth orbit · ISS', payload: 'dragon', target: 'iss', capsule: 'dragon',
    phases: [
      phase('Launch', 'ascent', 52), phase('Earth orbit', 'orbit', 16),
      phase('ISS approach', 'stationApproach', 22),
      phase('Dragon docking', 'docking', 14),
      phase('Earth return', 'earthReturn', 118),
      phase('Entry and splashdown', 'reentry', 32),
    ],
  },
};
export const customMission = {
  title: '08 · Free flight', destination: 'Earth orbit', payload: null,
  phases: [phase('Launch', 'ascent', 52), phase('Earth orbit', 'orbit', 16),
    phase('Earth return', 'earthReturn', 118), phase('Entry and splashdown', 'reentry', 32)],
};
for (const [id, mission] of Object.entries(missions)) mission.phases[0].duration = launchVehicles[id].expectedAscentS;
customMission.phases[0].duration = vehicleForMission('custom').expectedAscentS;
for(const id of Object.keys(LUNAR_TIMING)) {
  const timing=LUNAR_TIMING[id],mission=missions[id];
  mission.phases.find(p=>p.kind==='orbit').duration=timing.tliGET-mission.phases[0].duration;
  mission.phases.find(p=>p.kind==='moonTransfer').duration=timing.arrivalGET-timing.tliGET;
  mission.phases.find(p=>p.kind==='earthReturn').duration=timing.returnCoast;
  if(id==='apollo_11')mission.phases.find(p=>p.kind==='moonOrbit').duration=24*3600+22*60;
  else mission.phases.find(p=>p.kind==='lunarFlyby').duration=18*3600;
}
for(const [id,mission] of Object.entries(missions))applyHistoricalTime(id,mission);

export class FlightState extends EventTarget {
  #soiRoute;
  #soiTime;

  constructor(id, mode = 'command', { crew = false, vehicle = null, design = null, crewLife = null, flightLength = design?.spec.flightLength,
    historicalTraining = false } = {}) {
    super();
    if (id === 'designed' && (!design || !vehicle)) throw new Error('Mission and launcher required');
    this.execution = design ? new MissionExecution(design.spec, design.execution) : null;
    this.mission = { ...(missions[id] ?? customMission), phases: (missions[id] ?? customMission).phases.map(p => ({ ...p })) };
    const roverTrial = ['barkhan_4', 'barkhan_6'].includes(id);
    this.launch = new LaunchDynamics(vehicleForMission(id, vehicle));
    this.mission.launchVehicle = this.launch.vehicle;
    this.mission.phases[0].duration = this.launch.vehicle.expectedAscentS;
    if (roverTrial) {
      this.mission.title = id === 'barkhan_4' ? 'Test range · Barkhan-4' : 'Test range · Barkhan-6';
      this.mission.destination = 'Earth · training course';
      this.mission.rover = id; this.mission.phases = [phase('Test range', 'marsSurface', 3600)];
    }
    this.crew = missions[id] ? this.mission.crew === true : crew;
    if(id==='apollo_11' || id === 'artemis_ii' && (historicalTraining || crewLife)) {
      const count = id === 'apollo_11' ? 3 : 4;
      this.lifeSupport=new CrewLifeSupport({profile:expeditionCabin,module:id === 'apollo_11' ? 'apollo-reference' : 'orion-reference',
        seats:count,crewCount:count,catalogOxygenKg:65,batteryJ:28*3600000},crewLife);
      this.mission.resourcesPrecision='approximate';
    }
    if (this.execution) {
      const { spec } = this.execution.plan;
      this.crew = spec.crewCount > 0;
      this.mission.title = spec.name;
      this.mission.phases = [this.mission.phases[0], { ...this.mission.phases[1], duration: spec.durationS ?? 1 }];
      this.design = { spec, layout: design.layout ?? null, carrier: design.carrier ?? null, checks: design.checks ?? [], cabin: design.cabin ?? null };
      if (this.crew && (!this.design.cabin || this.design.cabin.crewCount !== spec.crewCount)) throw new Error('Calculate a cabin profile first');
      if (this.crew) this.lifeSupport = new CrewLifeSupport(this.design.cabin, design.lifeSupport);
      const { expedition } = this.execution.plan;
      if (expedition) {
        if (!lunarCarriers.includes(design.carrier)) throw new Error('Expedition launcher unavailable');
        this.lunar = { outbound: null, capture: null, returning: null, entry: null,
          fuelKg: expedition.fuelKg * expedition.serviceFuelFraction, isolated: false, entryMassKg: null };
        if (design.lunar) this.restoreExpedition(design.lunar);
        this.mission.destination = 'Moon → Earth';
        this.mission.expedition = true;
        this.mission.capsule = expedition.model;
        this.mission.phases = [this.mission.phases[0], phase('Earth parking orbit', 'orbit', 5400),
          phase('Translunar coast', 'moonTransfer', spec.transferS), phase('Lunar orbit operations', 'moonOrbit', expedition.operationsS),
          phase('Earth return', 'earthReturn', expedition.returnS), phase('Entry and splashdown', 'reentry', entryDurationS)];
      }
      if (spec.spacecraft) {
        this.satellite = new SpacecraftOperations(spec.spacecraft, design.satellite);
        this.mission.satelliteModel = 'science_satellite';
      }
      if (this.execution.plan.interplanetary) {
        this.interplanetary = createPlanetFlight(this.execution.plan, design.interplanetary);
        const { route, operationS } = this.execution.plan.interplanetary;
        this.mission.destination = planets[spec.destination].name;
        this.mission.interplanetary = true;
        this.mission.payload = null;
        this.mission.probeModel = 'voyager';
        this.mission.phases = [this.mission.phases[0], phase('Earth parking orbit', 'orbit', 120),
          phase('Interplanetary transfer', 'planetTransfer', route.transferS),
          phase(spec.type === 'orbit' ? 'Planetary orbit' : 'Planetary flyby', spec.type === 'orbit' ? 'planetOrbit' : 'planetFlyby', operationS)];
      }
    }
    this.id = id;
    this.flightLength = flightLength === 'short' ? 'short' : 'full';
    this.mode = mode;
    this.manualControl = restoreManualControl();
    this.rocketTest = mode === 'manual';
    this.navigation = { phase: -1, radial: new Vector3(), motion: new Vector3(), acceleration: new Vector3() };
    this.timeModelVersion = 3;
    this.realTimeLunar = Boolean(LUNAR_TIMING[id] || this.lunar);
    this.earthRotationEpoch = null;
    this.speedReference = 'earth-fixed';
    this.actualRate = 1;
    this.rails = false;
    this.shortRoute = null;
    this.gameplaySeconds = 0;
    this.solarFlight = false;
    this.historicalCoast = null;
    this.phaseStartTime = 0;
    this.phaseIndex = 0;
    this.time = 0;
    this.totalTime = 0;
    this.preflight = 5.5;
    this.countdown = 10;
    this.paused = false;
    this.holding = false;
    this.holdReason = '';
    this.aborted = false;
    this.dockingHoldDone = false;
    this.dockingCaptured = false;
    this.dockingLocked = false;
    this.complete = false;
    this.failed = false;
    this.altitude = 0;
    this.speed = 0;
    this.verticalSpeed = 0;
    this.horizontalSpeed = 0;
    this.inertialSpeed = 0;
    this.acceleration = 0;
    this.gForce = 0;
    this.massKg = this.launch.massKg;
    this.fuelMassKg = this.launch.fuelMassKg;
    this.thrustN = 0;
    this.groundDistanceM = 0;
    this.pitch = 0;
    this.steeringPitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.throttle = 1;
    this.fuel = 100;
    this.position = launchUp.clone().multiplyScalar(EARTH_RADIUS);
    this.segmentStart = this.position.clone();
    this.velocity = new Vector3();
    this.heading = launchUp.clone();
    this.segmentHeading = this.heading.clone();
    this.segmentVelocity = new Vector3();
    this.properAccelerationMps2 = new Vector3();
    this.progress = 0;
    this.engine = false;
    this.trimBurn = false;
    this.stageCoast = 0;
    this.waitingStageIgnition = false;
    this.surface = null;
    this.path = null;
    this.orbitAngle = 0;
    this.systems = new FlightSystems(MOON, MOON_RADIUS);
    // Reference electrical budgets, explicitly approximate: shared systems,
    // not a second resource simulation or a historical hardware inventory.
    if(!this.lifeSupport && (this.interplanetary||['mars_2020','mars_science_laboratory','dart','voyager_2'].includes(id))) {
      this.mission.resourcesPrecision='approximate';
      this.systems.configurePower({batteryWh:2000,busW:id==='voyager_2'?350:100,generationW:id==='voyager_2'?470:this.interplanetary?350:600,
        solar:!this.interplanetary&&id!=='voyager_2'});
    }
    if (this.lunar) this.systems.moon = this.moonCenter;
    if (this.lifeSupport) this.systems.cabinPressureKPa = this.lifeSupport.reading().pressurePa / 1000;
    this.reported = new Set();
    this.loadedSampleKg = 0;
    this.objectivesEnabled = historicalTraining && Boolean(missions[id]);
    this.assemblyActive = false;
    if (missions[id]) {
      this.historicalExecution = new MissionExecution(id); this.historicalOperations = new HistoricalFlightOperations(id);
      this.historicalOperations.flags.enabled = this.objectivesEnabled;
    }
    if (id === 'dart') {
      this.dartImpactOrigin = DART_NOMINAL_ORIGIN.clone();
      this.dartRange = DART_RELEASE_RANGE;
    }
    if (roverTrial) {
      this.preflight = this.countdown = 0; this.sceneSurfaceTrial = true; this.surface = 'earth';
      this.mode = 'manual'; this.altitude = 0; this.surfaceExpedition = new SurfaceExpedition(id);
    }
    this.timeline = new MissionTimelineManager(this, { earth: earthCenter, moon: MOON, mars: MARS, jupiter: JUPITER, saturn: SATURN });
  }
  get phase() { return this.mission.phases[this.phaseIndex]; }
  get kind() { return this.phase.kind; }
  get destinationSoi() {
    if (this.kind === 'moonTransfer' && this.path?.soiEntryS != null) return { body: 'moon', time: this.path.soiEntryS };
    if (this.kind !== 'planetTransfer' || !this.interplanetary?.departed) return null;
    const route = this.interplanetary.route;
    const body = this.design.spec.destination;
    if (this.#soiRoute !== route) {
      this.#soiTime = destinationSoiEntry(route, body, 0, route.transferS);
      this.#soiRoute = route;
    }
    return this.#soiTime === null ? null : { body, time: this.#soiTime };
  }
  get moonCenter() { return this.lunar?.outbound ? new Vector3().fromArray(this.lunar.outbound.center)
    : this.lunar&&this.design.spec.launchUtc ? approximateMoon(Date.parse(this.design.spec.launchUtc)+(this.design.spec.transferS??0)*1000).multiplyScalar(.001) : MOON; }
  bodyCenter(id, seconds = this.totalTime) {
    return this.solarFlight ? historicalBody(this,id,seconds) : ({earth:earthCenter,moon:this.moonCenter,mars:MARS,jupiter:JUPITER,saturn:SATURN}[id] ?? earthCenter);
  }
  get enginePower() {
    if (this.failed || this.complete || this.aborted || this.holding) return 0;
    if (this.countdown > 0) return this.engine ? .16 + .18 * (1 - this.countdown / PREIGNITION_SECONDS) : 0;
    if (this.trimBurn) return .20;
    if (this.kind === 'ascent' || this.kind === 'orbit') {
      const stage = this.launch.vehicle.stages[this.launch.stageIndex];
      const nominal = stage.vacuumThrustN + (this.launch.boosters?.attached ? this.launch.vehicle.boosters.vacuumThrustN : 0);
      return this.engine ? MathUtils.clamp(this.launch.thrustN / Math.max(1, nominal), 0, 1) : 0;
    }
    return this.engine && this.stageCoast <= 0 ? this.throttle * this.systems.powerLimit : 0;
  }
  report(type, detail = {}, once, missionTime = this.totalTime) {
    if (once && this.reported.has(once)) return;
    if (once) this.reported.add(once);
    this.timeline.handle(type, detail);
    this.execution?.observe(this, type, detail, missionTime);
    if (this.objectivesEnabled) this.historicalExecution?.observe(this, type, detail, missionTime);
    const actualTime = missionTime === this.totalTime || !this.timeline.clock.launched ? this.timeline.clock.seconds
      : missionTime - this.timeline.clock.liftoffTime;
    this.dispatchEvent(new CustomEvent('mission', { detail: { type, detail, actualTime } }));
  }
  hold(reason = 'Launch control hold') {
    if (this.timeline.clock.launched || this.aborted || this.failed) return false;
    this.holding = !this.holding;
    this.holdReason = this.holding ? reason : '';
    this.timeline.update();
    return true;
  }
  abort() {
    if (this.complete || this.aborted) return;
    this.aborted = true;
    this.engine = false;
    this.report(this.timeline.clock.launched ? 'missionAbort' : 'launchAbort');
  }
  recover() {
    if (!this.failed || this.systems.integrity <= 0 || this.aborted) return false;
    this.failed = false;
    this.failureReason = '';
    this.report('recovery');
    return true;
  }
  fail(reason) {
    if (this.failed || this.complete) return;
    this.failed = true;
    this.failureReason = reason;
    this.engine = false;
    this.report('failure', { reason });
  }
  separateStage(delay, stage = 1) {
    if (this.kind !== 'ascent' || this.paused || this.failed || this.aborted) return false;
    const result = this.launch.separate(true);
    this.syncLaunch();
    return result;
  }
  // Presentations use the same simulation clock while phase motion is suspended.
  advancePresentation(dt) {
    if (!this.paused && !this.holding && !this.failed && !this.complete && !this.aborted) {
      const before = this.totalTime;
      this.totalTime += dt;
      if (this.kind === 'orbit') { this.launch.advance(dt, { throttle: 0 }); this.syncLaunch(); }
      this.advanceCrew(this.totalTime - before);
      this.timeline.update();
      return dt;
    }
    return 0;
  }
  async skipNextEvent({ onPhaseChange, onStep, canRail = () => !onStep, onCoastJump,
    shouldStop = () => false, yieldFrame = () => Promise.resolve() } = {}) {
    if (this.failed || this.aborted || this.complete) return null;
    const target = this.timeline.current;
    const phase = this.phaseIndex;
    const paused = this.paused, holding = this.holding;
    const before = this.totalTime;
    this.holding = false;
    this.mode = 'command';
    let batch = performance.now();
    try {
      for (let i = 0; i < 10000 && !this.failed && !this.aborted && !this.complete; i++) {
        if (shouldStop()) break;
        this.paused = false;
        const remaining = this.phase.duration - this.time;
        const apolloPending = this.id === 'apollo_11' && this.kind === 'moonTransfer' && !this.reported.has('apolloTransposition');
        if (!apolloPending && remaining > 120 && (this.interplanetary?.departed || this.path?.physical && !this.path.isPowered(this.time))) {
          const untilTarget = (target && this.timeline.expected(target)) - this.timeline.clock.seconds;
          onCoastJump?.();
          this.advanceCoast(Math.min(remaining, this.lifeSupport ? 3600 : remaining, Math.max(1, untilTarget || remaining)));
          if (this.time >= this.phase.duration - 1e-7) { this.advancePhase(); onPhaseChange?.(this); }
        } else this.update(1, undefined, 20, onPhaseChange, onStep, canRail);
        this.paused = true;
        if (this.phaseIndex !== phase || target && ['COMPLETE', 'SKIPPED', 'FAILED'].includes(target.status) || shouldStop()) break;
        // Surface activities and contact gates can require a user action. An
        // explicit skip records that objective as skipped instead of claiming it.
        if (this.time >= this.phase.duration && !['ascent', 'orbit'].includes(this.kind)) {
          if (target) this.timeline.set(target, 'SKIPPED', 'user-skip');
          this.advancePhase(); onPhaseChange?.(this); break;
        }
        if (performance.now() - batch > 12) { await yieldFrame(); batch = performance.now(); }
      }
      this.report('maneuverSkipped', { label: target?.label ?? this.phase.label, seconds: this.totalTime - before });
      return target?.label ?? this.phase.label;
    } finally { this.paused = paused; this.holding = holding && !this.timeline.clock.launched; this.actualRate = 1; this.rails = false; }
  }
  skipPresentation(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new Error('Invalid maneuver duration');
    if (this.failed || this.aborted || this.holding) return 0;
    const before = this.totalTime;
    let remaining = this.realTimeLunar ? Math.min(seconds, Math.max(0, this.phase.duration - this.time)) : seconds;
    this.shortRoute = null;
    while (remaining > 1e-8 && !this.failed && !this.aborted) {
      const step = Math.min(60, remaining);
      const previousPhaseTime = this.time;
      this.totalTime += step;
      if (this.realTimeLunar) {
        this.time += step;
        this.progress = Math.min(1, this.time / this.phase.duration);
        if (this.kind === 'orbit') {
          this.launch.canCoast ? this.launch.coast(step) : this.launch.advance(step, { throttle: 0 });
          this.syncLaunch();
        } else if (this.lunar && this.kind === 'reentry') this.navigateExpeditionEntry(step);
        else if (this.path?.physical) this.navigatePhysical();
        else this.navigate();
      } else if (this.kind === 'orbit') {
        this.launch.canCoast ? this.launch.coast(step) : this.launch.advance(step, { throttle: 0 });
        this.syncLaunch();
      }
      this.advanceCrew(step);
      this.systems.tick(this, step, this.enginePower);
      this.reportSoiBetween(previousPhaseTime);
      this.execution?.observe(this);
      this.timeline.update();
      if (this.flightLength === 'short') this.gameplaySeconds += step;
      remaining -= step;
    }
    this.actualRate = 1;
    this.rails = false;
    return this.totalTime - before;
  }
  serialize() {
    const values = {};
    for (const [key, value] of Object.entries(this)) {
      if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) values[key] = value;
    }
    const systems = { moduleDamage: structuredClone(this.systems.moduleDamage) };
    for (const [key, value] of Object.entries(this.systems)) if (['number', 'boolean', 'string'].includes(typeof value)) systems[key] = value;
    return { version: 1, missionId: this.id, values, manualControl: serializeManualControl(this),
      localLanding: this.localLanding && { model: this.localLanding.serialize(), anchor: this.landingAnchor },
      surfaceExpedition: this.surfaceExpedition?.serialize(),
      historicalObjectives: this.historicalExecution?.serialize(),
      historicalOperations: this.historicalOperations?.serialize(),
      localAscent: this.localAscent && { model: this.localAscent.serialize(), frame: this.ascentFrame },
      marsEdl: this.marsEdl?.serialize(),
      historicalEntry: this.historicalEntry && structuredClone(this.historicalEntry),
      dragonReturn: this.dragonReturn && structuredClone(this.dragonReturn),
      phaseDurations:this.mission.phases.map(p=>p.duration),phaseKinds:this.mission.phases.map(p=>p.kind),
      vectors: Object.fromEntries(['position', 'velocity', 'heading', 'segmentStart', 'segmentHeading', 'segmentVelocity', 'properAccelerationMps2', 'dartImpactOrigin'].filter(key => this[key]).map(key => [key, this[key].toArray()])),
      reported: [...this.reported], systems, warnings: [...this.systems.warnings], timeline: this.timeline.serialize(), launchPhysics: this.launch.snapshot(),
      ...(this.shortRoute ? { shortRoute: { ...this.shortRoute } } : {}),
      ...(this.historicalCoast ? { historicalCoast: structuredClone(this.historicalCoast) } : {}),
      ...(this.lifeSupport && !this.execution ? {crewLife:this.lifeSupport.serialize()} : {}),
      ...(this.execution ? { design: { ...this.design, execution: this.execution.serialize(),
        ...(this.lifeSupport ? { lifeSupport: this.lifeSupport.serialize() } : {}),
        ...(this.satellite ? { satellite: this.satellite.serialize() } : {}),
        ...(this.lunar ? { lunar: structuredClone(this.lunar) } : {}),
        ...(this.interplanetary ? { interplanetary: structuredClone(this.interplanetary) } : {}) } } : {}) };
  }
  static fromSave(data) {
    if (data?.version !== 1 || typeof data.missionId !== 'string' || !data.values || !data.timeline) throw new Error('Invalid save format');
    if(data.missionId==='dart' && data.phaseDurations?.length===6){
      data=structuredClone(data);
      data.phaseDurations.splice(4,0,.001);
      if(data.values.phaseIndex>=4)data.values.phaseIndex++;
    }
    const state = new FlightState(data.missionId, data.values.mode, { crew: data.values.crew, vehicle: data.launchPhysics?.vehicle, design: data.design, crewLife:data.crewLife });
    state.manualControl = restoreManualControl(data.manualControl);
    if (data.localLanding) { state.localLanding = new LanderControl(data.localLanding.model.body, data.localLanding.model); state.landingAnchor = data.localLanding.anchor; }
    if (data.surfaceExpedition) state.surfaceExpedition = new SurfaceExpedition(data.surfaceExpedition.id, data.surfaceExpedition);
    if (data.historicalObjectives && state.historicalExecution) state.historicalExecution.restore(data.historicalObjectives);
    if (data.historicalOperations) state.historicalOperations = new HistoricalFlightOperations(state.id, data.historicalOperations);
    if (data.localAscent) { state.localAscent = new LunarAscentControl(data.localAscent.model.sampleKg, data.localAscent.model); state.ascentFrame = data.localAscent.frame; }
    if (data.marsEdl) state.marsEdl = new MarsEdlControl(state.id === 'mars_2020', data.marsEdl);
    if (data.historicalEntry) state.historicalEntry = structuredClone(data.historicalEntry);
    if (data.dragonReturn) state.dragonReturn = structuredClone(data.dragonReturn);
    if (data.values.phaseIndex === 0 && data.values.time > 0 && !data.launchPhysics) throw new Error('Start a new attempt to use the current launch physics.');
    const values = data.values;
    if (values.id !== data.missionId || !['manual', 'command'].includes(values.mode)
      || !['full', 'short'].includes(values.flightLength ?? 'full')
      || !Number.isInteger(values.phaseIndex) || values.phaseIndex < 0 || values.phaseIndex >= state.mission.phases.length
      || !Number.isFinite(values.totalTime) || values.totalTime < 0 || !Number.isFinite(values.time) || values.time < 0
      || !Number.isFinite(values.countdown) || values.countdown < 0 || values.countdown > 10) throw new Error('Invalid mission clock or stage');
    for (const [key, value] of Object.entries(values)) {
      if (key !== 'failureReason' && !(Object.hasOwn(state, key) && (state[key] === null || ['number', 'string', 'boolean'].includes(typeof state[key])))) continue;
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid telemetry');
      if (value === null || ['number', 'string', 'boolean'].includes(typeof value)) state[key] = value;
    }
    if(data.phaseDurations){if(data.phaseDurations.length!==state.mission.phases.length||data.phaseDurations.some(t=>!Number.isFinite(t)||t<=0))throw new Error('Invalid phase durations');data.phaseDurations.forEach((duration,i)=>state.mission.phases[i].duration=duration);}
    for (const key of ['position', 'velocity', 'heading', 'segmentStart', 'segmentHeading', 'segmentVelocity', 'properAccelerationMps2', 'dartImpactOrigin']) {
      const vector = data.vectors?.[key];
      if (vector) {
        if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) throw new Error('Invalid saved vector');
        state[key] ??= new Vector3();
        state[key].fromArray(vector);
      }
    }
    state.reported = new Set(data.reported);
    if(data.historicalCoast){
      const h=data.historicalCoast;
      if(!['start','velocity'].every(k=>Array.isArray(h[k])&&h[k].length===3&&h[k].every(Number.isFinite))
        || !Number.isFinite(h.startGET)||h.startGET<0||!Number.isFinite(h.duration)||h.duration<=0)throw new Error('Invalid historical trajectory');
      state.historicalCoast=structuredClone(h);
    }
    for (const [key, value] of Object.entries(data.systems ?? {})) {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid systems state');
      if (Object.hasOwn(state.systems, key) && ['number', 'boolean', 'string'].includes(typeof state.systems[key]) && typeof value === typeof state.systems[key]) state.systems[key] = value;
    }
    state.systems.warnings = new Set(data.warnings);
    if (data.systems?.moduleDamage) {
      for (const [id, damage] of Object.entries(data.systems.moduleDamage)) {
        if (!Number.isFinite(damage) || damage < 0 || damage > 1) throw new Error('Invalid module damage');
        state.systems.moduleDamage[id] = damage;
      }
    }
    state.timeline.restore(data.timeline);
    if (data.shortRoute) {
      const route = data.shortRoute;
      if (state.flightLength !== 'short' || route.phaseIndex !== state.phaseIndex
        || !['start', 'end', 'epoch', 'elapsed', 'scale'].every(key => Number.isFinite(route[key]))
        || route.start < 0 || route.end <= route.start || route.epoch < 0 || route.elapsed < 0
        || route.scale <= 0 || route.scale > 1 || route.end > state.phase.duration + 1e-6
        || Math.abs(route.start + route.elapsed / route.scale - state.time) > 1e-5) throw new Error('Invalid short route');
      state.shortRoute = { ...route };
    }
    // Older cinematic checkpoints resume at their saved epoch with normal controls.
    if (data.wrapit?.active) state.paused = true;
    state.rails = false;
    if (data.launchPhysics) state.launch = LaunchDynamics.restore(data.launchPhysics);
    if (state.lifeSupport && state.execution && (!data.design.lifeSupport || Math.abs(state.lifeSupport.ventedKg - state.launch.ventedPayloadKg) > 1e-8)) throw new Error('Cabin mass and state disagree');
    if (state.satellite && (!data.design.satellite || (state.satellite.orbit ? state.satellite.design.massKg + state.design.spec.payloadMassKg : 0)
      !== state.launch.releasedPayloadKg)) throw new Error('Satellite mass and state disagree');
    if (state.lunar && (!data.design.lunar || (state.phaseIndex >= 1 && !state.lunar.outbound && !state.failed)
      || (state.phaseIndex >= 3 && !state.lunar.capture && !state.failed) || (state.phaseIndex >= 4 && !state.lunar.returning && !state.failed)
      || (state.phaseIndex >= 5 && !state.lunar.entry && !state.failed))) throw new Error('Invalid lunar expedition sequence');
    if (state.interplanetary && (!data.design.interplanetary || state.phaseIndex >= 2 && !state.interplanetary.departed && !state.failed
      || state.interplanetary.departed && (state.interplanetary.epoch > state.totalTime || state.phaseIndex < 2))) throw new Error('Invalid interplanetary sequence');
    if (state.interplanetary?.departed) alignPlanetDeparture(state);
    if(state.realTimeLunar && !data.values.timeModelVersion) {
      state.migrateLunarSave(data);
      state.restoreControlMode();
      return state;
    }
    const position = state.position.clone();
    const heading = state.heading.clone();
    state.position.copy(state.segmentStart);
    state.heading.copy(state.segmentHeading);
    state.path = state.createPath(state.kind);
    state.position.copy(position);
    state.heading.copy(heading);
    if (state.kind === 'planetTransfer' && state.interplanetary?.departed) samplePlanetFlight(state);
    else if (state.solarFlight && solarHistoricalKinds.has(state.kind)) state.navigatePhysical();
    state.restoreControlMode();
    return state;
  }
  migrateLunarSave(data) {
    const timing=LUNAR_TIMING[this.id];
    const reached=this.timeline.events.find(e=>e.id==='orbit')?.actualTime??this.launch.vehicle.expectedAscentS;
    this.mission.phases[1].duration=Math.max(1,timing.tliGET-reached);
    if(this.phaseIndex===1){this.time=Math.min(1,this.time/16)*this.phase.duration;this.launch.coast(Math.max(0,reached+this.time-this.launch.time));this.syncLaunch();}
    if(this.phaseIndex>=2){
      this.earthRotationEpoch=timing.tliGET;
      this.segmentVelocity.copy(this.velocity);
      if(this.kind==='moonTransfer'){
        this.launch.coast(Math.max(0,timing.tliGET-this.launch.time));
        this.segmentStart.copy(this.launch.positionM).multiplyScalar(.001);
        this.segmentVelocity.copy(surfaceToInertialVelocity(this.segmentStart.clone().multiplyScalar(1000),this.launch.velocityMps)).multiplyScalar(.001);
        this.path=this.createPath(this.kind);
        const radius=this.position.length();let low=0,high=this.phase.duration;
        for(let i=0;i<55;i++){const mid=(low+high)/2;if(this.path.sample(mid).position.length()<radius)low=mid;else high=mid;}
        this.time=(low+high)/2;
        if(this.reported.has('apolloTransposition'))this.time=Math.max(this.time,timing.tliBurn+timing.extractionDelay+timing.extractionDuration);
      }else {
        const oldMoon=new Vector3(.64,.18,.747).normalize().multiplyScalar(384400),shift=MOON.clone().sub(oldMoon);
        if(['moonOrbit','lunarFlyby','separate','moonLanding','moonSurface','rendezvous','earthReturn'].includes(this.kind)){
          this.position.add(shift);this.segmentStart.add(shift);
          this.segmentVelocity.copy(this.segmentHeading).multiplyScalar(this.speed/1000);
        }
        this.time=Math.min(1,this.progress)*this.phase.duration;
      }
      if(this.kind!=='moonTransfer'){
        const position=this.position.clone();this.position.copy(this.segmentStart);
        this.path=this.createPath(this.kind);this.position.copy(position);
      }
      this.totalTime=this.mission.phases.slice(0,this.phaseIndex).reduce((t,p)=>t+p.duration,0)+this.time;
      this.phaseStartTime=this.totalTime-this.time;this.progress=this.time/this.phase.duration;
      if(this.path?.physical)this.navigatePhysical();
      for(const e of this.timeline.events)if(e.actualTime!==null&&e.phaseIndex>=2)e.actualTime=Math.min(this.timeline.clock.seconds,timing.tliGET+(e.id==='tli'?timing.tliBurn:timing.tliBurn+timing.extractionDelay+timing.extractionDuration));
      if(this.timeline.clock.stoppedAt!==null)this.timeline.clock.stoppedAt=Math.max(0,this.totalTime-(this.timeline.clock.liftoffTime??0));
    }
    this.timeModelVersion=2;this.migratedTimeModel=true;this.timeline.update();
  }
  restoreControlMode() {
    // v1 checkpoints predate orbital control. Preserve their manual launch
    // selection and resume other phases under the existing autopilot.
    const context = controlContext(this);
    if (this.kind !== 'ascent' && (!context.owner || ['physx', 'trajectory'].includes(context.owner) && !this.manualControl.attitude)) {
      this.mode = 'command';
    }
  }
  setMode(mode, { attitude, presentation, rate = 1 } = {}) {
    if (!['manual', 'command'].includes(mode)) return false;
    if (this.mode === mode) return true;
    const context = controlContext(this, presentation);
    if (!context.owner || rate > 1) return false;
    if (mode === 'manual' && ['moonSurface', 'marsSurface'].includes(this.kind) && !this.surfaceExpedition) this.surfaceExpedition = new SurfaceExpedition(this.id);
    if (mode === 'manual' && context.profile === 'lander' && context.owner === 'surface' && !this.localLanding && !this.marsEdl) {
      this.localLanding = new LanderControl(this.kind === 'moonLanding' ? 'moon' : 'mars');
      this.localLanding.p.y = this.altitude * 1000;
      this.localLanding.v.y = this.verticalSpeed ?? 0;
      const center = this.kind === 'moonLanding' ? MOON : this.bodyCenter('mars');
      const up = this.position.clone().sub(center).normalize();
      const east = new Vector3(0, 1, 0).cross(up).normalize();
      if (east.lengthSq() < .1) east.set(1, 0, 0);
      this.landingAnchor = { origin: this.position.clone().addScaledVector(up, -this.altitude).toArray(), up: up.toArray(), east: east.toArray(), north: up.clone().cross(east).toArray() };
    }
    if (mode === 'manual' && this.kind === 'ascent') this.rocketTest = true;
    if (mode === 'command' && this.kind === 'ascent') {
      this.rocketTest = false;
      if (this.launch.rocketControl.maneuver?.status === 'armed') this.launch.rocketControl.maneuver.status = 'cancelled';
    }
    if (mode === 'manual' && ['trajectory', 'physx'].includes(context.owner)) {
      const forward = this.id === 'dart' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
      const heading = this.heading.lengthSq() ? this.heading.clone().normalize() : forward;
      this.manualControl.attitude = attitude?.clone() ?? new Quaternion().setFromUnitVectors(forward, heading);
      this.manualControl.angularRate.set(0, 0, 0);
    }
    this.mode = mode;
    return true;
  }
  routeManualInput(frame, requestedRate, dt, launchAxes = {}) {
    routeFlightInput(this, frame, requestedRate, {
      launch: ({ axes, actions, throttleTarget }) => {
        updateControlSwitches(this.manualControl, actions);
        const scale = this.manualControl.precision ? .25 : 1;
        for (const axis of ['pitch', 'yaw', 'roll']) launchAxes[axis] = (axes[axis] ?? 0) * scale;
        const change = (axes.throttle ?? 0) * dt * controlProfiles.rocket.limits.throttlePerSecond;
        this.throttle = MathUtils.clamp((throttleTarget ?? this.throttle) + change, 0, 1);
        if (actions.has('fullThrottle')) this.throttle = 1;
        if (actions.has('cutoff')) this.throttle = 0;
        if (actions.has('stage') && !this.launch.onPad) this.separateStage();
      },
      trajectory: ({ axes, actions }) => {
        updateControlSwitches(this.manualControl, actions);
        stepOrbitalAttitude(this.manualControl, axes, dt, this.id === 'dart');
      },
      physx: ({ axes, actions }) => {
        updateControlSwitches(this.manualControl, actions);
        this.localControlAxes = { ...axes };
      },
      assembly: ({ axes, actions }) => { updateControlSwitches(this.manualControl, actions); this.assemblyAxes = { ...axes }; },
      lunarAscent: ({ axes }) => { this.localControlAxes = { ...axes }; },
      surface: ({ axes, actions }) => { this.localControlAxes = { ...axes }; this.localControlActions = new Set(actions); },
    });
    return launchAxes;
  }
  reportSoiBetween(previousPhaseTime) {
    const soi = this.destinationSoi;
    if (soi && previousPhaseTime < soi.time && this.time >= soi.time) {
      this.report('soiEntry', { body: soi.body }, `soiEntry:${this.phaseIndex}`, this.phaseStartTime + soi.time);
    }
  }
  advanceCoast(step) {
    this.shortRoute = null;
    const before = this.totalTime;
    const previousPhaseTime = this.time;
    this.time += step;
    this.totalTime += step;
    this.progress = this.time / this.phase.duration;
    if (this.kind === 'orbit' && !this.interplanetary?.departed) {
      // Resource exhaustion can shorten this interval. Propagate the parking
      // orbit only through the time actually consumed by the cabin integrator.
      this.advanceCrew(step, true);
      this.sampleCoast(this.totalTime - before);
    } else {
      this.sampleCoast(step);
      this.advanceCrew(step, true);
    }
    this.systems.tick(this, this.totalTime - before, 0);
    this.historicalOperations?.step(this, this.totalTime - before);
    this.satellite?.advance(this.totalTime - before, (type, detail) => this.report(type, detail));
    this.reportSoiBetween(previousPhaseTime);
    this.execution?.observe(this);
    this.timeline.update();
  }
  sampleCoast(step) {
    if (this.kind === 'orbit' && !this.interplanetary?.departed) {
      this.launch.coast(step);
      this.syncLaunch();
    } else if (this.interplanetary?.departed) samplePlanetFlight(this);
    else if (this.kind === 'moonSurface') { this.engine = false; this.speed = this.altitude = 0; }
    else this.navigatePhysical();
  }
  updateShortRoute(seconds, frame, onStep) {
    if (!this.shortRoute || this.shortRoute.phaseIndex !== this.phaseIndex || this.shortRoute.end < shortRouteEnd(this)) {
      this.shortRoute = { phaseIndex: this.phaseIndex, start: this.time, end: shortRouteEnd(this),
        epoch: this.totalTime, elapsed: 0, scale: shortenedSpaceScale(this) };
    }
    const route = this.shortRoute;
    const duration = (route.end - route.start) * route.scale;
    const step = Math.min(seconds, .25, Math.max(0, duration - route.elapsed));
    const previousTime = this.time;
    route.elapsed = Math.min(duration, route.elapsed + step);
    this.time = route.elapsed >= duration - 1e-9 ? route.end : route.start + route.elapsed / route.scale;
    this.totalTime = route.epoch + (this.time - route.start);
    this.progress = this.time / this.phase.duration;
    this.actualRate = 1;
    this.rails = false;
    this.gameplaySeconds += step;
    if (this.mode === 'manual' && frame) this.routeManualInput(frame, 1, step);
    if (this.kind === 'orbit' || this.interplanetary?.departed || this.path?.physical) this.sampleCoast(this.time - previousTime);
    else this.navigate();
    this.advanceCrew(step);
    this.systems.tick(this, step, this.enginePower);
    this.satellite?.advance(step, (type, detail) => this.report(type, detail));
    this.reportSoiBetween(previousTime);
    this.execution?.observe(this);
    this.timeline.update();
    onStep?.(this, step);
    if (coastFault(this)) this.paused = true;
    return step;
  }
  advanceCrew(step, stopOnCritical = false) {
    if (!this.lifeSupport || step <= 0) return;
    const before = this.lifeSupport.alerts.join('|');
    const exteriorPa = this.kind === 'reentry' && this.lunar ? atmosphere(this.altitude * 1000).pressurePa
      : ['ascent', 'orbit'].includes(this.kind) ? this.launch.air.pressurePa : 0;
    let generationFactor = 1;
    if (this.lunar) {
      generationFactor = ['ascent', 'reentry'].includes(this.kind) ? 0
        : crewGenerationFactor(this.position, this.moonCenter, EARTH_RADIUS, MOON_RADIUS);
    }
    const advanced = this.lifeSupport.advance(step, { leakKgS: this.systems.leakKgPerS, exteriorPa, properG: this.gForce, generationFactor },
      stopOnCritical ? () => Boolean(coastFault(this)) : null);
    if (stopOnCritical && advanced < step) {
      this.time -= step - advanced;
      this.totalTime -= step - advanced;
      this.progress = this.time / this.phase.duration;
      if (this.path?.physical) this.navigatePhysical();
    }
    this.syncCrew(before);
  }
  syncCrew(before) {
    this.systems.cabinPressureKPa = this.lifeSupport.reading().pressurePa / 1000;
    this.launch.ventedPayloadKg = this.lifeSupport.ventedKg;
    this.launch.massKg = this.launch.mass();
    if (!(this.localLanding && ['moonLanding', 'marsLanding'].includes(this.kind))
      && !(this.localAscent && this.kind === 'rendezvous')
      && !(this.historicalOperations?.flags.enabled && this.historicalOperations.lastPhase === this.phaseIndex)) {
      this.massKg = this.lunar?.isolated ? this.expeditionMassKg() : this.launch.massKg;
    }
    if (before !== undefined && this.lifeSupport.alerts.join('|') !== before) this.report('crewAlert', { alerts: [...this.lifeSupport.alerts] });
  }

  commandCrew(action, id, value) {
    if (!this.lifeSupport || this.complete || this.failed || this.aborted) return;
    if (action === 'activity') this.lifeSupport.setActivity(id, value);
    else if (action === 'system') this.lifeSupport.setControl(id, value);
    else if (action === 'leak' && Number.isFinite(value) && value >= 0 && value <= 1) this.systems.leakKgPerS = value;
    else throw new Error('Unknown cabin command');
    this.report('crewControl', { action, id, value });
  }

  expeditionMassKg() {
    if (this.lunar.entryMassKg != null) return this.lunar.entryMassKg - this.lifeSupport.ventedKg;
    const hardware = this.execution.plan.expedition;
    return this.launch.vehicle.payloadMassKg - hardware.fuelKg * hardware.serviceFuelFraction + this.lunar.fuelKg - this.lifeSupport.ventedKg;
  }

  advanceExpedition(kind) {
    const { spec, expedition, target } = this.execution.plan;
    const state = this.lunar;
    if (kind === 'orbit') {
      const { periapsisM, apoapsisM, energy } = this.launch.orbit;
      if (energy >= 0 || Math.abs(periapsisM - target.periapsisM) > target.toleranceM || Math.abs(apoapsisM - target.apoapsisM) > target.toleranceM) {
        throw new Error('Earth parking orbit unconfirmed');
      }
      state.outbound = planLunarDeparture(this.launch, this.moonCenter, spec);
      this.systems.moon = this.moonCenter;
      this.phase.duration = state.outbound.waitS;
      return;
    }
    if (kind === 'moonTransfer') {
      const stage = this.launch.stages[this.launch.stageIndex];
      const engine = this.launch.vehicle.stages[this.launch.stageIndex];
      const fuelKg = burnPropellantKg(this.launch.massKg, state.outbound.tliMps, engine.vacuumIspS);
      if (stage.failed || fuelKg > stage.fuelKg) throw new Error('Lunar injection failed due to fuel or propulsion');
      stage.fuelKg -= fuelKg;
      stage.attached = false;
      this.launch.massKg = this.launch.mass();
      state.isolated = true;
      this.earthRotationEpoch = this.phaseStartTime - state.outbound.waitS;
      this.position.fromArray(state.outbound.departure);
      this.velocity.fromArray(state.outbound.departureVelocity);
      this.speed = this.velocity.length() * 1000;
      this.report('expeditionTli', { deltaVMps: state.outbound.tliMps, fuelKg });
    } else if (kind === 'moonOrbit') {
      const center = new Vector3().fromArray(state.outbound.center);
      const near = this.position.clone().sub(center);
      const periapsisM = (near.length() - MOON_RADIUS) * 1000;
      if (Math.abs(periapsisM - spec.orbit.periapsisM) > spec.orbit.toleranceM) throw new Error('Flyby outside lunar capture range');
      this.report('expeditionArrival', { periapsisM });
      const velocity = captureVelocity(near, this.velocity, spec.orbit.apoapsisM);
      const deltaVMps = velocity.distanceTo(this.velocity) * 1000;
      const fuelKg = burnPropellantKg(this.expeditionMassKg(), deltaVMps, expedition.ispS);
      if (fuelKg > state.fuelKg) throw new Error('Insufficient fuel for lunar capture');
      state.fuelKg -= fuelKg;
      state.capture = { position: near.toArray(), velocity: velocity.toArray() };
      this.velocity.copy(velocity);
      this.speed = this.velocity.length() * 1000;
      const shape = orbitShape(near, velocity, MOON_GM);
      const apoapsisM = (shape.a * (1 + shape.eccentricity) - MOON_RADIUS) * 1000;
      if (shape.energy >= 0 || Math.abs(apoapsisM - spec.orbit.apoapsisM) > spec.orbit.toleranceM) throw new Error('Lunar orbit outside tolerance');
      this.report('expeditionCapture', { deltaVMps, fuelKg, periapsisM, apoapsisM });
      state.returning = returnOpportunity(center, near, velocity, expedition.operationsS, expedition.returnS);
      this.phase.duration = state.returning.departureS;
    } else if (kind === 'earthReturn') {
      if (!this.execution.crewReady(this)) throw new Error('Critical cabin conditions after lunar orbit');
      this.report('expeditionOperations', { durationS: state.returning.departureS });
      const deltaVMps = state.returning.teiMps;
      const fuelKg = burnPropellantKg(this.expeditionMassKg(), deltaVMps, expedition.ispS);
      if (fuelKg > state.fuelKg) throw new Error('Insufficient service-module fuel for Earth return');
      state.fuelKg -= fuelKg;
      this.position.fromArray(state.returning.lunarPosition).add(new Vector3().fromArray(state.outbound.center));
      this.velocity.fromArray(state.returning.lunarVelocity);
      this.speed = this.velocity.length() * 1000;
      this.report('expeditionReturn', { deltaVMps, fuelKg });
    } else if (kind === 'reentry') {
      state.entry = initialEntry(this.position, this.velocity);
      state.entryMassKg = this.expeditionMassKg() + this.lifeSupport.ventedKg - state.fuelKg - expedition.serviceDryKg;
      this.report('expeditionEntry', { gammaDeg: state.entry.gammaDeg, speedMps: this.velocity.length() * 1000 });
    }
    this.refreshExpeditionMass();
  }

  refreshExpeditionMass() {
    this.massKg = this.expeditionMassKg();
    this.fuelMassKg = this.lunar.entry ? 0 : this.lunar.fuelKg;
    this.fuel = 100 * this.fuelMassKg / Math.max(1, this.execution.plan.expedition.fuelKg);
  }

  restoreExpedition(saved) {
    const { expedition } = this.execution.plan;
    const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
    const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
    const invalid = () => { throw new Error('Invalid lunar expedition state'); };
    if (!number(saved.fuelKg, 0, expedition.fuelKg * expedition.serviceFuelFraction) || typeof saved.isolated !== 'boolean') invalid();
    if (saved.outbound && (!['center', 'departure', 'departureVelocity', 'patchPosition', 'patchVelocity'].every(key => vector(saved.outbound[key]))
      || !['waitS', 'earthS', 'moonS', 'tliMps'].every(key => number(saved.outbound[key], 0, 1e6)))) invalid();
    if (saved.capture && (!vector(saved.capture.position) || !vector(saved.capture.velocity))) invalid();
    if (saved.returning && (!['lunarPosition', 'lunarVelocity', 'entryPosition', 'reverseVelocity'].every(key => vector(saved.returning[key]))
      || !['departureS', 'earthS', 'moonS', 'teiMps'].every(key => number(saved.returning[key], 0, 1e6)))) invalid();
    if (saved.entry && (!vector(saved.entry.position) || !vector(saved.entry.velocity) || !number(saved.entryMassKg, 1000, 1e6)
      || !number(saved.entry.elapsedS, 0, entryDurationS) || !number(saved.entry.heatJm2, 0, 1e9) || !number(saved.entry.peakG, 0, 1000)
      || !number(saved.entry.gammaDeg, -6.7, -5.2) || !number(saved.entry.opening, 0, 1) || typeof saved.entry.chute !== 'boolean' || typeof saved.entry.landed !== 'boolean'
      || (saved.entry.landingSpeedMps != null && !number(saved.entry.landingSpeedMps, 0, 1e5)))) invalid();
    this.lunar = structuredClone(saved);
  }

  navigateExpeditionEntry(step) {
    const entry = this.lunar.entry;
    const before = entry.chute;
    const state = stepEntry(entry, step, this.expeditionMassKg());
    if (!state) return;
    this.position.fromArray(entry.position).multiplyScalar(.001);
    this.velocity.fromArray(entry.velocity).multiplyScalar(.001);
    this.heading.copy(this.velocity).normalize();
    this.altitude = state.altitudeM / 1000;
    this.speed = state.speedMps;
    this.verticalSpeed = this.velocity.dot(this.position.clone().normalize()) * 1000;
    this.gForce = state.properG;
    this.acceleration = this.gForce * 9.80665;
    this.properAccelerationMps2.copy(state.proper);
    this.engine = false;
    if (!before && entry.chute) this.report('parachutes', {}, 'parachutes');
    if (state.reason) this.fail(state.reason);
    else if (entry.landed) {
      this.surface = 'ocean';
      this.progress = 1;
    }
  }

  commandSatellite(action, value) {
    if (!this.satellite || this.complete || this.failed || this.aborted) return;
    if (action === 'queue') this.satellite.queueTask(value);
    else if (['scienceEnabled', 'radioEnabled'].includes(action) && typeof value === 'boolean') this.satellite[action] = value;
    else throw new Error('Unknown spacecraft command');
    this.report('satelliteControl', { action, value });
  }
  advancePhase() {
    this.shortRoute = null;
    if (this.kind === 'dartApproach') this.report('probeImpact', { speedMps: DART_SPEED }, 'dartImpact');
    if (this.phaseIndex === this.mission.phases.length - 1) {
      this.complete = true;
      this.engine = false;
      const historicalIncomplete = this.objectivesEnabled && this.historicalExecution && !this.historicalExecution.complete;
      const incomplete = historicalIncomplete || this.execution && (!this.execution.complete || !this.execution.crewReady(this));
      const reason = historicalIncomplete ? 'Required training objectives remain incomplete'
        : this.lunar && !this.execution.crewReady(this) ? 'Cabin supplies or crew condition out of bounds'
        : !this.satellite ? '' : !this.satellite.orbit ? 'Orbit unconfirmed and payload still attached'
        : `${this.execution.events.some(event => event.type === 'satelliteSafeMode') ? 'Power shortfall logged. ' : ''}Downlinked ${this.satellite.downlinkedMB.toFixed(2)} of ${this.satellite.config.downlinkGoalMB} MB`;
      this.report(incomplete ? 'designIncomplete' : 'success', incomplete && reason ? { reason } : {});
      return;
    }
    this.phaseIndex++;
    this.mode = 'command';
    this.time = this.progress = 0;
    this.segmentStart = this.position.clone();
    if (this.objectivesEnabled && this.kind === 'marsLanding') {
      this.marsEdl = new MarsEdlControl(this.id === 'mars_2020');
      this.report('marsEntry', { altitudeM: this.marsEdl.heightM, speedMps: this.marsEdl.speedMps }, 'marsEdlInterface');
    }
    if (this.objectivesEnabled && this.id === 'iss_resupply' && this.kind === 'earthReturn') {
      try {
        this.dragonReturn = dragonDeorbit(this.position, this.heading);
        this.phase.duration = this.dragonReturn.duration;
        const ops = this.historicalOperations, dv = this.dragonReturn.deltaVMps;
        const usedKg = 9900 * -Math.expm1(-dv / 2650);
        if (ops.fuelKg < usedKg) this.fail('Insufficient fuel for Dragon braking');
        else {
          ops.fuelKg -= usedKg;
          ops.evidence(this, 'deorbitBurn', { deltaVMps: dv, fuelKg: usedKg, periapsisM: this.dragonReturn.periapsisM });
        }
      } catch (error) { this.fail(error.message); }
    }
    if (this.objectivesEnabled && (this.realTimeLunar && !this.lunar || this.dragonReturn) && this.kind === 'reentry') {
      try {
        this.historicalEntry = initialEntry(this.position, this.velocity, this.dragonReturn ? 'dragon' : 'lunar');
        this.phase.duration = entryDurationS;
        this.historicalOperations.evidence(this, 'entryCorridor', { gammaDeg: this.historicalEntry.gammaDeg, speedMps: this.velocity.length() * 1000 });
      } catch (error) { this.fail(error.message); }
    }
    if (this.kind === 'rendezvous' && this.id === 'apollo_11' && this.objectivesEnabled) {
      this.localAscent = new LunarAscentControl(this.surfaceExpedition?.loadedKg ?? 0);
      const up = this.position.clone().sub(MOON).normalize(), east = moonEast.clone().projectOnPlane(up).normalize();
      this.ascentFrame = { up: up.toArray(), east: east.toArray(), north: east.clone().cross(up).toArray() };
    }
    this.segmentVelocity.copy(this.velocity);
    this.phaseStartTime=this.totalTime;
    this.engine = false;
    this.trimBurn = false;
    this.stageCoast = 0;
    this.waitingStageIgnition = false;
    this.systems.newPhase();
    const kind = this.kind;
    if(this.mission.history?.launchUtc && solarHistoricalKinds.has(kind) && !this.solarFlight){
      this.solarFlight=true;
      this.position.add(this.bodyCenter('earth'));
      this.segmentStart.copy(this.position);
    }
    if(this.mission.history && this.phase.endGET) this.phase.duration=Math.max(.001,this.phase.endGET+(this.timeline.clock.liftoffTime??0)-this.totalTime);
    if(kind==='dartApproach' && this.solarFlight) this.dartImpactOrigin.copy(this.position).addScaledVector(dartHeading,DART_APPROACH_RANGE*.001);
    if (this.interplanetary) {
      try { beginPlanetPhase(this); }
      catch (error) { this.fail(error.message); return; }
    }
    if (kind === 'orbit' && this.satellite && this.execution.objectives.find(goal => goal.id === 'earth-orbit')?.state === 'COMPLETED'
      && this.satellite.deploy(this.launch.positionM, this.launch.velocityMps, this.timeline.clock.seconds)) {
      this.launch.releasedPayloadKg = this.satellite.design.massKg + this.design.spec.payloadMassKg;
      this.massKg = this.launch.massKg = this.launch.mass();
      this.report('satelliteDeployed', { massKg: this.launch.releasedPayloadKg });
    }
    if (this.lunar) {
      try { this.advanceExpedition(kind); }
      catch (error) { this.fail(error.message); return; }
      if (this.failed) return;
    }
    if(this.realTimeLunar && !this.lunar && kind==='orbit')this.phase.duration=Math.max(1,LUNAR_TIMING[this.id].tliGET-this.totalTime);
    if(this.realTimeLunar && !this.lunar && kind==='moonTransfer') {
      this.earthRotationEpoch=this.totalTime;
      this.segmentVelocity.copy(surfaceToInertialVelocity(this.launch.positionM,this.launch.velocityMps)).multiplyScalar(.001);
      this.velocity.copy(this.segmentVelocity);
    }
    if (['moonLanding', 'moonSurface', 'marsLanding', 'marsSurface', 'reentry'].includes(kind)) {
      this.pitch = this.roll = 0;
    }
    if (kind === 'dartAftermath') {
      if (this.objectivesEnabled) this.phase.duration = 24;
      this.speed = this.altitude = 0;
      this.systems.integrity = 0;
      this.systems.link = false;
    }
    this.segmentHeading.copy(this.heading);
    try { this.path = this.createPath(kind); }
    catch (error) { if (!this.objectivesEnabled) throw error; this.fail(error.message); this.path = null; }
    if (this.solarFlight && this.path?.physical) this.navigatePhysical();
    this.report('phase', { kind });
  }
  createPath(kind) {
    const start = this.position;
    const heading = this.heading;
    if(this.solarFlight && solarHistoricalKinds.has(kind))return historicalSolarPath(this,kind);
    if(this.solarFlight && (kind==='jupiterFlyby'||kind==='saturnFlyby'))return historicalFlybyPath(this,kind==='jupiterFlyby'?'jupiter':'saturn');
    if(this.solarFlight && kind==='escape'){
      const offset=historicalBody(this,'earth',0),r=start.clone().add(offset),v=this.segmentVelocity.clone();
      return {physical:true,model:'solar-kepler',burnDuration:0,isPowered:()=>false,sample:time=>{
        const s=keplerState(r,v,time,1.3271244004127942e11);s.position.sub(offset);return {...s,proper:new Vector3(),reference:'sun',solarOrigin:offset};}};
    }
    if (this.lunar && this.lunar.outbound) {
      const center = new Vector3().fromArray(this.lunar.outbound.center);
      if (kind === 'moonTransfer') return lunarOutbound(this.lunar.outbound);
      if (kind === 'moonOrbit' && this.lunar.capture) return lunarCoast(center, new Vector3().fromArray(this.lunar.capture.position), new Vector3().fromArray(this.lunar.capture.velocity));
      if (kind === 'earthReturn' && this.lunar.returning) return lunarReturn(center, this.lunar.returning);
      return null;
    }
    if (this.lunar) return null;
    if(this.realTimeLunar && kind==='moonTransfer')return createLunarTransfer(start,this.segmentVelocity.lengthSq()?this.segmentVelocity:this.velocity,MOON,this.phase.duration,LUNAR_TIMING[this.id].tliBurn,MOON_RADIUS+(this.id==='artemis_ii'?6400:120));
    if(this.realTimeLunar && kind==='moonOrbit'){
      const radial=start.clone().sub(MOON),v=this.segmentVelocity.lengthSq()?this.segmentVelocity:tangentAlong(radial.clone().normalize(),heading).multiplyScalar(Math.sqrt(MOON_GM/radial.length()));
      return createLunarOrbit(start,v,MOON,LUNAR_TIMING[this.id].captureBurn);
    }
    if(this.realTimeLunar && (kind==='lunarFlyby'||kind==='separate')){
      const local=start.clone().sub(MOON),v=this.segmentVelocity.clone();
      return {physical:true,model:'lunar-kepler',isPowered:()=>false,sample:time=>{const s=keplerState(local,v,time,MOON_GM);s.position.add(MOON);return {...s,proper:new Vector3(),reference:'moon'};}};
    }
    if(this.realTimeLunar && kind==='earthReturn') {
      return this.objectivesEnabled ? createLunarEntryReturn(start, this.segmentVelocity, this.phase.duration)
        : createEarthReturn(start,this.segmentVelocity,entryUp.clone().multiplyScalar(EARTH_RADIUS+220),this.phase.duration);
    }
    if (kind === 'earthReturn' && this.dragonReturn) return dragonReturnPath(this.dragonReturn);
    if (kind === 'asteroidTransfer') {
      const arrival = dartWorldPosition(this.dartImpactOrigin, DART_RELEASE_RANGE);
      return transferRoute(start, heading, arrival, dartHeading, earthCenter);
    }
    const target = transferTargets[kind];
    if (target) {
      const departure = kind === 'saturnTransfer' ? JUPITER : earthCenter;
      return approachOrbit(start, heading, target.center, target.radius, departure);
    }
    if (kind === 'earthReturn') {
      const arrival = entryUp.clone().multiplyScalar(EARTH_RADIUS + 220);
      if (start.length() < EARTH_RADIUS + 1000) {
        const radial = start.clone().normalize();
        const along = tangentAlong(radial, entryUp);
        const arc = radial.angleTo(entryUp);
        const prograde = along.dot(heading) >= 0;
        return orbitArc(earthCenter, start, prograde ? along : along.negate(),
          prograde ? arc : 2 * Math.PI - arc, EARTH_RADIUS + 220);
      }
      return transferRoute(start, heading, arrival, entryHeading, MOON);
    }
    if (kind === 'escape') {
      const outward = start.clone().sub(SATURN).normalize();
      const destination = start.clone().addScaledVector(heading, 850000).addScaledVector(outward, 800000);
      return transferRoute(start, heading, destination, destination.clone().sub(SATURN).normalize(), SATURN);
    }
    if (kind === 'orbit') return null;
    if (kind === 'stationApproach') return orbitArc(earthCenter, start, heading, .64, EARTH_RADIUS + 420);
    if (kind === 'docking') return orbitArc(earthCenter, start, heading, .28);
    if (kind === 'moonOrbit') return orbitArc(MOON, start, heading, 1.55);
    if (kind === 'lunarFlyby') return orbitArc(MOON, start, heading, 3.42);
    if (kind === 'separate') return orbitArc(MOON, start, heading, .23);
    if (kind === 'jupiterFlyby') {
      const sweep = departureSweep(start.clone().sub(JUPITER), heading, SATURN.clone().sub(JUPITER));
      return orbitArc(JUPITER, start, heading, sweep);
    }
    if (kind === 'saturnFlyby') return orbitArc(SATURN, start, heading, 2.2);
    return null;
  }
  playbackRate(requested) {
    if (isDartEncounter(this.kind)) return 1;
    if (this.countdown > 0 || this.kind === 'ascent' && this.totalTime < 1.45) return 1;
    if (this.kind === 'ascent' && this.mode === 'manual') return 1;
    if (this.lunar && this.kind === 'reentry') return Math.min(requested, 100);
    const minimum = minimumScreenTime[this.kind];
    return minimum ? Math.min(requested, this.phase.duration / minimum) : requested;
  }
  update(dt, input, requestedRate = 1, onPhaseChange, onStep, canRail = () => !onStep) {
    let elapsed = 0;
    let frame = input;
    this.timeline.update();
    while (dt > 1e-8 && !this.paused && !this.holding && !this.aborted && !this.failed && !this.complete) {
      if (hasShortRoute(this) && !frame?.presentation && !this.objectivesEnabled) {
        const step = this.updateShortRoute(dt, frame, onStep);
        elapsed += step;
        dt -= step;
        if (this.time >= this.phase.duration - 1e-7 && !this.paused && !this.failed
          && (!this.satellite || this.execution.complete)) {
          const phaseIndex = this.phaseIndex;
          this.advancePhase();
          if (phaseIndex !== this.phaseIndex && onPhaseChange?.(this) === false) break;
        }
        if (step <= 0) break;
        continue;
      }
      if (this.interplanetary?.departed && this.phaseIndex >= 2) {
        const rate = Math.max(1, Math.min(1e9, requestedRate));
        const step = Math.min(dt * rate, this.phase.duration - this.time);
        const localStep = Math.min(.08, step / rate);
        if (frame && this.mode === 'manual') this.routeManualInput(frame, requestedRate, localStep);
        if (frame?.actions?.size || frame?.throttleTarget !== undefined) {
          frame = { ...frame, actions: new Set(), throttleTarget: undefined };
        }
        this.actualRate = rate;
        const previousPhaseTime = this.time;
        this.time += step;
        this.totalTime += step;
        this.progress = this.time / this.phase.duration;
        elapsed += step;
        dt -= step / rate;
        samplePlanetFlight(this);
        this.systems.tick(this, step, 0);
        this.reportSoiBetween(previousPhaseTime);
        this.execution.observe(this);
        this.timeline.update();
        onStep?.(this, localStep);
        if (this.time >= this.phase.duration - 1e-7) {
          const index = this.phaseIndex;
          this.advancePhase();
          if (index !== this.phaseIndex && onPhaseChange?.(this) === false) break;
        }
        continue;
      }
      if (this.preflight > 0) {
        this.report('preflight', { prepSeconds: PREIGNITION_SECONDS }, 'preflight');
        const step = Math.min(dt, this.preflight);
        dt -= step;
        this.preflight -= step;
        elapsed += step;
        if (this.preflight <= 1e-8) {
          this.preflight = 0;
          this.report('count', { value: 10 }, 'count:10');
        }
        continue;
      }
      const shortAscent = this.flightLength === 'short' && this.kind === 'ascent';
      const rate = this.playbackRate(shortAscent ? 1 : requestedRate);
      if (this.countdown > 0) {
        const step = Math.min(this.countdown, dt * rate);
        const previous = this.countdown;
        this.countdown -= step;
        for (let value = Math.min(9, Math.ceil(previous) - 1); value > 0 && value >= this.countdown - 1e-8; value--) {
          this.report('count', { value }, `count:${value}`);
        }
        if (!this.engine && this.countdown <= PREIGNITION_SECONDS) {
          this.engine = true;
          this.report('enginePrep');
        }
        if (this.countdown <= 1e-8) {
          this.countdown = 0;
          this.report('launchCommit');
        }
        dt -= step / rate;
        elapsed += step;
        continue;
      }
      const physicalAscent = this.kind === 'ascent';
      if (this.objectivesEnabled && this.mode === 'command' && this.kind === 'moonLanding' && this.altitude <= .5 && !this.localLanding) {
        if (this.setMode('manual')) this.setMode('command');
      }
      if (this.objectivesEnabled && ['moonSurface', 'marsSurface'].includes(this.kind) && !this.surfaceExpedition) this.surfaceExpedition = new SurfaceExpedition(this.id);
      const coast=(this.realTimeLunar || this.execution)&&(this.kind==='orbit'||this.path?.physical&&!this.path.isPowered(this.time));
      this.rails=Boolean(coast && requestedRate>10 && canRail());
      const isolated = this.lunar?.isolated && coast && requestedRate > 500 && !this.rails;
      const effectiveRate=this.realTimeLunar&&!physicalAscent&&requestedRate>10&&!this.rails&&!(this.lunar && this.kind==='reentry')?Math.min(rate,isolated ? 100 : 20):rate;
      this.actualRate=effectiveRate;
      const untilBoundary = physicalAscent || this.time >= this.phase.duration ? .1 : Math.max(.001, this.phase.duration - this.time);
      const engineBoundary=this.path?.physical&&this.path.isPowered(this.time)?Math.max(.001,this.path.burnDuration-this.time):Infinity;
      const satelliteDeadline = this.satellite && this.flightLength !== 'short' && !physicalAscent && this.design.spec.durationS != null
        ? Math.max(0, this.design.spec.durationS - this.timeline.clock.seconds) : Infinity;
      const launchDistanceScale = shortAscent ? shortenedSpaceScale(this) : 1;
      const step = Math.min(dt * effectiveRate / launchDistanceScale, untilBoundary, engineBoundary, this.rails ? 60 : .25, satelliteDeadline);
      // Physics follows the original route epoch. The smaller launch route
      // takes 60% of that time at the same velocity and ordinary hardware rate.
      const gameplayStep = step * launchDistanceScale;
      if (this.mode === 'manual' && !controlContext(this).owner) this.mode = 'command';
      const launchAxes = this.mode === 'manual' && frame ? this.routeManualInput(frame, requestedRate, gameplayStep) : {};
      if (frame?.actions?.size || frame?.throttleTarget !== undefined) {
        frame = { ...frame, actions: new Set(), throttleTarget: undefined };
      }
      const before = this.totalTime;
      const previousPhaseTime = this.time;
      this.time += step;
      this.totalTime += step;
      elapsed += gameplayStep;
      dt -= gameplayStep / effectiveRate;
      if (shortAscent) this.gameplaySeconds += gameplayStep;
      this.progress = Math.min(1, this.time / this.phase.duration);
      const lastSurface = this.surface;
      this.stageCoast = Math.max(0, this.stageCoast - step);
      this.engine = ['ascent', 'moonLanding', 'rendezvous', 'marsLanding'].includes(this.kind);
      if (this.marsEdl && this.kind === 'marsLanding') {
        const lander = this.marsEdl;
        lander.advance(step, this.localControlAxes, this.mode !== 'manual', (type, detail) => this.report(type, detail, type));
        this.localControlAxes = {}; this.localControlActions = new Set();
        this.altitude = lander.heightM / 1000; this.speed = lander.speedMps;
        this.verticalSpeed = lander.verticalMps; this.horizontalSpeed = lander.horizontalMps;
        this.position.copy(this.bodyCenter('mars')).addScaledVector(marsSites[this.id], 3389.5 + this.altitude);
        this.roll = lander.bank * 180 / Math.PI; this.fuelMassKg = lander.fuelKg;
        this.engine = ['powered', 'crane', 'contact', 'flyaway'].includes(lander.phase);
        if (lander.phase === 'failed') this.fail(lander.reason);
        if (lander.phase === 'completed') this.surface = 'mars';
      }
      else if (this.localAscent && this.kind === 'rendezvous') {
        const a = this.localAscent;
        const emit = (type, detail) => this.report(type, detail, type);
        if (a.status === 'armed' && this.mode === 'command') {
          if (a.ignite(this.time - step)) { emit('lunarAscentIgnition', { windowErrorS: this.time - step, throttle: 1, massKg: a.massKg }); emit('flagFell', { exhaustN: lunarAscentConfig.thrustN }); }
          else { a.status = 'failed'; this.fail('Eagle ascent window missed'); }
        }
        a.advance(step, this.localControlAxes, this.mode !== 'manual', emit); this.localControlAxes = {};
        const f = this.ascentFrame, vector = v => new Vector3(...f.east).multiplyScalar(v.x).addScaledVector(new Vector3(...f.up), v.y).addScaledVector(new Vector3(...f.north), v.z);
        this.position.copy(MOON).addScaledVector(vector(a.p), .001); this.velocity.copy(vector(a.v)).multiplyScalar(.001);
        this.heading.copy(this.velocity).normalize(); this.altitude = Math.max(0, (a.p.length() - lunarAscentConfig.radiusM) / 1000);
        this.speed = a.v.length(); this.verticalSpeed = a.v.dot(a.p.clone().normalize()); this.horizontalSpeed = Math.sqrt(Math.max(0, this.speed ** 2 - this.verticalSpeed ** 2));
        this.massKg = a.massKg; this.fuelMassKg = a.fuelKg; this.throttle = a.status === 'ascending' ? 1 : 0; this.engine = this.throttle > 0; this.surface = null;
        if (a.status === 'failed') this.fail('Eagle ran out of fuel or struck the surface');
      }
      else if (this.surfaceExpedition && ['moonSurface', 'marsSurface'].includes(this.kind)) {
        const e = this.surfaceExpedition;
        const emit = (type, detail) => this.report(type, detail, type + ':' + (detail.id ?? detail.target ?? detail.count ?? this.totalTime));
        if (this.mode === 'command') {
          e.autopilot(step, emit);
          if (e.operations.stage === 14 && !e.nightComplete) this.waitSurfaceDawn(emit);
        }
        else e.advance(step, this.mode === 'manual' ? this.localControlAxes : {}, this.localControlActions, this.manualControl.assistance, emit);
        this.localControlAxes = {}; this.localControlActions = new Set();
        this.speed = e.current.v.length(); this.altitude = 0; this.throttle = 0; this.engine = false;
        this.surface = e.body; this.massKg += Math.max(0, e.loadedKg - (this.loadedSampleKg ?? 0)); this.loadedSampleKg = e.loadedKg;
        if (e.actors.some(a => a.status === 'failed')) this.fail('Expedition failed due to supplies, rollover, or hard landing');
      }
      else if (this.localLanding && ['moonLanding', 'marsLanding'].includes(this.kind)) {
        const l = this.localLanding;
        l.advance(step, this.localControlAxes, this.localControlActions, this.mode !== 'manual', (type, detail) => this.report(type, detail, type + ':' + (detail.label ?? '')));
        this.localControlAxes = {}; this.localControlActions = new Set();
        const a = this.landingAnchor;
        this.position.fromArray(a.origin).addScaledVector(new Vector3(...a.up), l.p.y / 1000).addScaledVector(new Vector3(...a.east), l.p.x / 1000).addScaledVector(new Vector3(...a.north), l.p.z / 1000);
        this.altitude = Math.max(0, l.p.y / 1000); this.verticalSpeed = l.v.y; this.horizontalSpeed = Math.hypot(l.v.x, l.v.z); this.speed = l.v.length();
        this.massKg = l.massKg; this.fuelMassKg = l.fuelKg; this.throttle = l.throttle; this.engine = l.throttle > 0;
        if (['crashed', 'failed'].includes(l.status)) this.fail('Landing · ' + l.status);
        if (['excellent', 'hard'].includes(l.status)) this.surface = l.body;
      }
      else if (this.kind === 'ascent') this.ascent(step, launchAxes, requestedRate <= 1);
      else if (this.kind === 'orbit') {
        if (!this.objectivesEnabled || !this.historicalOperations?.icpsBurn(this, step)) {
          this.rails ? this.launch.coast(step) : this.launch.advance(step, { throttle: 0 });
        }
        this.syncLaunch();
      }
      else if (this.lunar && this.kind === 'reentry') this.navigateExpeditionEntry(step);
      else if (this.historicalEntry && this.kind === 'reentry') {
        const entry = this.historicalEntry;
        const hadChute = entry.chute, hadDrogue = entry.drogue;
        const sample = stepEntry(entry, step, this.id === 'artemis_ii' ? 10300 : this.id === 'iss_resupply' ? 9900 : 5500);
        if (sample) {
          this.position.fromArray(entry.position).multiplyScalar(.001); this.velocity.fromArray(entry.velocity).multiplyScalar(.001);
          this.heading.copy(this.velocity).normalize();
          this.altitude = sample.altitudeM / 1000; this.speed = sample.speedMps; this.gForce = sample.properG;
          this.verticalSpeed = this.velocity.dot(this.position.clone().normalize()) * 1000;
          if (!hadChute && entry.chute) this.report('parachutes', { deployed: true, altitudeM: sample.altitudeM }, 'parachutes');
          if (!hadDrogue && entry.drogue) this.report('dragonDrogue', { drogue: 2, altitudeM: sample.altitudeM }, 'dragonDrogue');
          if (!hadChute && entry.chute && entry.drogue) this.report('dragonParachutes', { drogue: 2, main: 4, altitudeM: sample.altitudeM }, 'dragonMain');
          if (entry.landed) this.surface = 'ocean';
          if (sample.reason) this.fail(sample.reason);
        }
      }
      else if(this.path?.physical)this.navigatePhysical();
      else this.navigate();
      this.historicalOperations?.step(this, step);
      this.trimBurn = false;
      if(!this.path?.physical)this.systems.navigate(this, gameplayStep, {});
      this.systems.tick(this, gameplayStep, this.enginePower);
      this.advanceCrew(shortAscent ? gameplayStep : this.totalTime - before);
      this.reportSoiBetween(previousPhaseTime);
      if (!physicalAscent) this.satellite?.advance(step, (type, detail) => this.report(type, detail));
      this.execution?.observe(this);
      if (this.objectivesEnabled) this.historicalExecution?.observe(this);
      onStep?.(this, gameplayStep);
      if (this.waitingStageIgnition && this.enginePower > .02) {
        this.waitingStageIgnition = false;
        this.report('stageIgnition');
      }
      if (!this.failed && this.kind === 'ascent' && this.altitude >= .15) this.report('towerClear', {}, 'towerClear');
      if (this.surface && this.surface !== lastSurface && this.surface !== 'earth') {
        this.report({ moon: 'moonTouch', mars: 'marsTouch', ocean: 'splash' }[this.surface]);
        if (this.lunar && this.surface === 'ocean' && this.execution.crewReady(this)) this.report('expeditionRecovery', { landingSpeedMps: this.lunar.entry.landingSpeedMps, crew: this.lifeSupport.crew.length });
      }
      this.timeline.update();
      const waitingForDock = this.physicalDockingRequired && ['docking', 'rendezvous'].includes(this.kind)
        && (!this.dockingLocked || this.totalTime - (this.dockingCaptureTime ?? -Infinity) < 2
          || this.objectivesEnabled && this.id === 'iss_resupply' && !this.historicalOperations.thermal.packed);
      if (this.execution && physicalAscent && this.launch.onPad
        && this.launch.stages.every(stage => !stage.attached || stage.failed || stage.fuelKg <= 0)
        && (!this.launch.boosters?.attached || this.launch.boosters.failed || this.launch.boosters.fuelKg <= 0)) this.fail('launch-propellant');
      if (this.lunar && this.kind === 'reentry' && this.time >= this.phase.duration && !this.lunar.entry.landed) this.fail('Splashdown unconfirmed before timeout');
      if (this.lunar && this.timeline.clock.seconds > this.design.spec.durationS) this.fail('Expedition time expired');
      const ready = this.historicalEntry && this.kind === 'reentry' ? this.historicalEntry.landed
        : this.marsEdl && this.kind === 'marsLanding' ? this.marsEdl.phase === 'completed'
        : this.surfaceExpedition && ['moonSurface', 'marsSurface'].includes(this.kind)
        ? this.surfaceExpedition.returned
        : this.localLanding && ['moonLanding', 'marsLanding'].includes(this.kind)
        ? ['excellent', 'hard'].includes(this.localLanding.status) && this.localLanding.throttle === 0
        : physicalAscent ? this.launch.orbitAchieved && !this.rocketTest : this.lunar
        ? this.kind === 'reentry' ? this.lunar.entry.landed : step >= untilBoundary - 1e-8
        : this.interplanetary ? this.time >= this.phase.duration
          : this.flightLength === 'short' && this.satellite ? this.execution.complete && this.execution.crewReady(this) : this.execution
        ? (this.execution.complete && this.execution.crewReady(this))
          || (this.design.spec.durationS == null ? this.time >= 1 : this.timeline.clock.seconds >= this.design.spec.durationS - 1e-8)
        : !waitingForDock && (!this.localAscent || this.kind !== 'rendezvous' || this.localAscent.status === 'orbit')
          && (!(this.objectivesEnabled && this.id === 'artemis_ii' && this.kind === 'orbit' && onStep) || this.historicalOperations.flags.icpsComplete)
          && (!(this.objectivesEnabled && this.id === 'iss_resupply' && this.kind === 'stationApproach' && onStep) || this.historicalOperations.flags.issCleared)
          && step >= untilBoundary - 1e-8;
      if (ready && !this.failed) {
        const index = this.phaseIndex;
        this.advancePhase();
        if (index !== this.phaseIndex && onPhaseChange?.(this) === false) break;
      }
    }
    return elapsed;
  }
  waitSurfaceDawn(emit = (type, detail) => this.report(type, detail, type)) {
    if (this.paused || this.kind !== 'marsSurface' || !this.surfaceExpedition) return false;
    const elapsed = this.surfaceExpedition.waitForDawn(emit);
    if (!elapsed) return false;
    this.totalTime += elapsed; this.time += elapsed; this.systems.tick(this, elapsed, 0); this.timeline.update();
    return true;
  }
  navigatePhysical() {
    const sample=this.path.sample(this.time);
    this.position.copy(sample.position);this.velocity.copy(sample.velocity);this.heading.copy(this.velocity).normalize();
    const measuredVelocity=this.velocity.clone().sub(sample.centerVelocity??new Vector3());
    this.speed=measuredVelocity.length()*1000;this.inertialSpeed=this.velocity.length()*1000;
    this.properAccelerationMps2.copy(sample.proper).multiplyScalar(1000);
    this.engine=this.path.isPowered(this.time);this.acceleration=this.properAccelerationMps2.length();this.gForce=this.acceleration/9.80665;
    const center=sample.center??(sample.reference==='sun'?sample.solarOrigin.clone().negate():sample.reference==='moon'?this.moonCenter:earthCenter);
    const radius=sample.reference==='sun'?0:planets[sample.reference]?.radiusKm??(sample.reference==='moon'?MOON_RADIUS:EARTH_RADIUS);
    const r=this.position.clone().sub(center),mu=sample.reference==='sun'?1.3271244004127942e11:planets[sample.reference]?.mu??(sample.reference==='moon'?MOON_GM:EARTH_GM);
    this.recordNavigation(r, measuredVelocity, r.clone().multiplyScalar(-mu*1000/r.length()**3).add(this.properAccelerationMps2));
    this.acceleration=this.navigation.acceleration.length();
    this.verticalSpeed=measuredVelocity.dot(r.normalize())*1000;
    this.horizontalSpeed=Math.sqrt(Math.max(0,this.speed**2-this.verticalSpeed**2));
    this.altitude=this.position.distanceTo(center)-radius;this.speedReference=sample.reference==='sun'?'sun-inertial':sample.reference==='moon'?'moon-relative':planets[sample.reference]?`${sample.reference}-relative`:'earth-inertial';
    if(this.solarFlight && this.kind==='marsTransfer')this.altitude=this.position.distanceTo(this.bodyCenter('mars'))-3389.5;
    if(this.solarFlight && this.id==='dart')this.dartRange=this.position.distanceTo(this.dartImpactOrigin)*1000;
  }
  recordNavigation(radial, velocityKmS, accelerationMps2) {
    this.navigation.phase = this.phaseIndex;
    this.navigation.radial.copy(radial);
    this.navigation.motion.copy(velocityKmS).multiplyScalar(1000);
    this.navigation.acceleration.copy(accelerationMps2);
  }
  ascent(dt, input, manualInputAllowed = true) {
    const manual = this.mode === 'manual';
    if (!manual) this.throttle = Math.min(1, this.throttle + dt * controlProfiles.rocket.limits.throttlePerSecond);
    const control = this.manualControl;
    const sas = manual && (control.sas || assistanceLevels[control.assistance].sasForced);
    this.launch.advance(dt, { ...input, mode: this.mode, rocketTest: this.rocketTest,
      throttle: this.throttle, sas: sas && manualInputAllowed, powerLimit: this.systems.powerLimit });
    this.syncLaunch();
    this.progress = MathUtils.clamp(Math.max(this.altitude / this.launch.vehicle.guidance.targetAltitudeM * 1000 * .4, this.inertialSpeed / 7800 * .6), 0, .99);
  }
  syncLaunch() {
    const p = this.launch;
    this.totalTime = p.time;
    if (this.kind === 'ascent') this.time = p.time;
    this.position.copy(p.positionM).multiplyScalar(.001);
    this.velocity.copy(p.velocityMps).multiplyScalar(.001);
    this.heading.copy(this.kind === 'ascent' ? p.thrustDirection : p.velocityMps.clone().normalize());
    this.altitude = Math.max(0, p.altitudeM * .001);
    this.speed = p.surfaceSpeedMps;
    this.verticalSpeed = p.verticalSpeedMps; this.horizontalSpeed = p.horizontalSpeedMps;
    this.inertialSpeed = p.orbit.inertialSpeedMps;
    this.acceleration = p.accelerationMps2.length(); this.gForce = p.properG;
    this.pitch = p.pitch; this.yaw = p.yaw; this.roll = p.roll;
    this.massKg = p.massKg; this.fuelMassKg = p.fuelMassKg; this.thrustN = p.thrustN;
    this.groundDistanceM = p.groundDistanceM;
    this.fuel = 100 * p.fuelMassKg / Math.max(1, p.initialFuelKg);
    this.engine = p.thrustN > 0 && !this.failed;
    this.stageCoast = Math.max(0, p.stageIgnitionAt - p.time);
    for (const event of p.events.splice(0)) {
      if (event.type === 'failure') this.fail(event.detail.reason);
      else {
        if (event.type === 'stage' && this.kind === 'ascent' && p.vehicle.stages[p.stageIndex].assemblyKeys) this.waitingStageIgnition = true;
        this.report(event.type, event.detail);
      }
    }
  }
  navigate() {
    if (this.kind === 'dartRelease' || isDartEncounter(this.kind)) {
      this.dartRange = this.kind === 'dartRelease' ? MathUtils.lerp(DART_RELEASE_RANGE, DART_APPROACH_RANGE, this.progress)
        : this.kind === 'dartApproach' ? dartRange(this.progress) : 0;
      dartWorldPosition(this.dartImpactOrigin, this.dartRange, this.position);
      this.heading.copy(dartHeading);
      this.altitude = this.dartRange * .001;
      this.speed = this.kind === 'dartAftermath' ? 0 : DART_SPEED;
      this.verticalSpeed = 0;
      return;
    }
    const u = MathUtils.smoothstep(this.progress, 0, 1);
    if (this.path) {
      this.path.sample(this.progress, this.position, this.heading);
      const profile = transferTargets[this.kind]?.speed ?? (this.kind === 'earthReturn' ? [2.5, 1.2, 7.8]
        : this.kind === 'asteroidTransfer' ? [10.6, 15, DART_SPEED / 1000] : null);
      if (profile) {
        const [departure, coast, arrival] = profile;
        this.speed = 1000 * MathUtils.lerp(departure, coast, MathUtils.smoothstep(this.progress, 0, .48));
        this.speed = MathUtils.lerp(this.speed, 1000 * arrival, MathUtils.smoothstep(this.progress, .52, 1));
      }
      if (['orbit', 'stationApproach', 'docking'].includes(this.kind)) {
        this.altitude = this.position.length() - EARTH_RADIUS;
        this.speed = 7800;
      }
      if (this.kind === 'moonOrbit' || this.kind === 'lunarFlyby' || this.kind === 'separate') this.speed = 1620;
    }
    if (this.kind === 'moonLanding' || this.kind === 'marsLanding') {
      const lunar = this.kind === 'moonLanding';
      const destination = lunar ? MOON : this.bodyCenter('mars');
      const radius = lunar ? MOON_RADIUS : 3389.5;
      const initialCenter=lunar?destination:this.bodyCenter('mars',this.phaseStartTime);
      const initialAltitude = Math.max(0, this.segmentStart.distanceTo(initialCenter) - radius);
      const radial = this.segmentStart.clone().sub(initialCenter).normalize();
      const landingUp = lunar ? moonUp : marsSites[this.id];
      const along = tangentAlong(radial, landingUp);
      const angle = radial.angleTo(landingUp) * u;
      const direction = radial.clone().multiplyScalar(Math.cos(angle)).addScaledVector(along, Math.sin(angle));
      this.heading.copy(along).multiplyScalar(Math.cos(angle)).addScaledVector(radial, -Math.sin(angle));
      const altitude = MathUtils.lerp(0.004, initialAltitude, (1 - u) ** 2);
      this.position.copy(destination).addScaledVector(direction, radius + altitude);
      this.altitude = this.position.distanceTo(destination) - radius;
      this.speed = (lunar ? 1620 : 5500) * (1 - u);
      if (!lunar) this.engine = this.altitude < 3 && !this.surface;
      if (this.progress === 1 && lunar) this.surface = 'moon';
    }
    if (this.kind === 'moonSurface') {
      this.surface = 'moon';
      this.altitude = 0;
      this.speed = 0;
    }
    if (this.kind === 'rendezvous') {
      this.surface = null;
      this.altitude = 120 * MathUtils.smoothstep(this.progress, 0, 0.78);
      const angle = .22 * MathUtils.smoothstep(this.progress, .16, 1);
      const radius = MOON_RADIUS + .004 + this.altitude;
      this.position.copy(MOON).addScaledVector(moonUp, Math.cos(angle) * radius).addScaledVector(moonEast, Math.sin(angle) * radius);
      this.heading.copy(moonEast).multiplyScalar(Math.cos(angle)).addScaledVector(moonUp, -Math.sin(angle));
      this.speed = 1620 * MathUtils.smoothstep(this.progress, 0, .78);
      this.engine = this.progress < 0.78;
    }
    if (this.kind === 'marsSurface') {
      // Surface contact is confirmed by the sky-crane geometry in FlightView.
      // Entering a scheduled phase alone is not a touchdown.
      this.altitude = 0;
      this.speed = 0;
    }
    if (this.kind === 'reentry') {
      const recovery = reentryProfile(this.progress);
      this.altitude = recovery.altitude;
      const angle = entryArc * MathUtils.smoothstep(this.progress, 0, .62);
      const radius = EARTH_RADIUS + this.altitude;
      this.position.copy(entryUp).multiplyScalar(Math.cos(angle) * radius).addScaledVector(entryHeading, Math.sin(angle) * radius);
      this.heading.copy(entryHeading).multiplyScalar(Math.cos(angle)).addScaledVector(entryUp, -Math.sin(angle));
      this.speed = recovery.speed;
      this.verticalSpeed = -recovery.speed;
      this.engine = false;
      if (recovery.opening >= .85) this.report('parachutes', {}, 'parachutes');
      if (recovery.landed) this.surface = 'ocean';
    }
  }
}
