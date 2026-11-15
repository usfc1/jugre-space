import { MissionClock } from './mission-clock.mjs';
import { createMissionTimelineConfig } from './mission-timeline-config.mjs';
import { apolloExtractionDuration } from './short-flight.mjs';
import { LUNAR_TIMING } from './lunar-trajectory.mjs';

export const TimelineStatus = Object.freeze({ PENDING: 'PENDING', ACTIVE: 'ACTIVE', COMPLETE: 'COMPLETE', FAILED: 'FAILED', SKIPPED: 'SKIPPED' });
const terminal = new Set(['COMPLETE', 'SKIPPED']);
const healthy = s => !s.failed && !s.aborted && s.systems.integrity > 0;
const distance = (s, body) => s.position.distanceTo(body);
// Derive osculating periapsis instead of granting orbit on phase name or altitude alone.
export function orbitalPeriapsis(state, center, radius, mu) {
  if ((state.kind === 'ascent' || state.kind === 'orbit') && state.launch) return state.launch.orbit.periapsisM * .001;
  const r = state.position.clone().sub(center);
  const v = state.kind === 'ascent' && state.mode === 'manual' ? state.velocity.clone() : state.heading.clone().multiplyScalar(state.speed / 1000);
  const energy = v.lengthSq() / 2 - mu / r.length();
  if (energy >= 0) return -Infinity;
  const h2 = r.clone().cross(v).lengthSq();
  const eccentricity = Math.sqrt(Math.max(0, 1 + 2 * energy * h2 / (mu * mu)));
  return -mu / (2 * energy) * (1 - eccentricity) - radius;
}

export class TimelineEvent {
  constructor(config) {
    Object.assign(this, config);
    this.status = 'PENDING';
    this.actualTime = null;
    this.reason = '';
  }
}

export class MissionStatusController {
  constructor() { this.state = 'PRELAUNCH'; this.reason = ''; }
  update(flight, clock, events = []) {
    const goals = events.filter(e => e.required);
    const execution = flight.execution ?? (flight.objectivesEnabled ? flight.historicalExecution : null);
    const incomplete = execution ? !execution.complete || !execution.crewReady(flight) : goals.some(e => e.status !== 'COMPLETE');
    this.state = flight.aborted ? (clock.launched ? 'MISSION ABORTED' : 'LAUNCH ABORTED')
      : flight.failed ? 'MISSION FAILED' : flight.complete ? (incomplete ? 'MISSION INCOMPLETE' : flight.mission.history?.ongoing ? 'SEGMENT COMPLETE' : 'MISSION COMPLETE')
        : flight.holding || flight.preflight > 0 ? 'HOLD' : flight.paused ? 'PAUSED' : clock.launched ? 'LIVE' : 'COUNTDOWN';
    this.reason = flight.failureReason ?? flight.holdReason ?? '';
    return this.state;
  }
}

export class MissionTimelineManager extends EventTarget {
  constructor(flight, bodies) {
    super();
    this.flight = flight;
    this.bodies = bodies;
    this.config = createMissionTimelineConfig(flight.id, flight.mission);
    this.events = this.config.events.map(e => new TimelineEvent(e));
    this.clock = new MissionClock(flight);
    this.status = new MissionStatusController();
    this.revision = 0;
    this.muted = false;
    this.update();
  }
  notify(type, detail) {
    if (!this.muted) this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  set(event, status, reason = '', actualTime) {
    if (event.status === status && event.reason === reason) return;
    event.status = status;
    event.reason = reason;
    if (status === 'COMPLETE' || status === 'FAILED') event.actualTime = actualTime ?? this.clock.seconds;
    this.revision++;
    this.notify('change', { id: event.id, status, actualTime: event.actualTime, reason });
    if (status === 'COMPLETE' || status === 'FAILED') this.notify('mission-control', {
      cue: event.id, status, actualTime: event.actualTime, missionId: this.flight.id,
    });
  }
  condition(name) {
    const s = this.flight;
    const { earth, moon, mars, jupiter, saturn } = this.bodies;
    if (name === 'dartSuccess') return this.events.find(e => e.id === 'impact')?.status === 'COMPLETE';
    if (!healthy(s)) return false;
    switch (name) {
      case 'liftoff': return !s.launch.onPad && s.enginePower > .01;
      case 'earthOrbit': return orbitalPeriapsis(s, earth, 6371, 398600.4418) > 100;
      case 'moonOrbit': return orbitalPeriapsis(s, moon, 1737.4, 4902.8) > 15;
      case 'marsOrbit': return orbitalPeriapsis(s, mars, 3389.5, 42828.4) > 100;
      case 'marsAscent': return s.kind === 'marsAscent' && s.altitude > .02 && s.enginePower > 0;
      case 'marsDescent': return s.kind === 'marsLanding' && s.enginePower > 0 && s.altitude > 0;
      case 'marsOperations': return s.surface === 'mars' && s.speed < 3 && s.systems.integrity > 0;
      case 'departure': return s.path?.physical ? s.time >= s.path.burnDuration : s.position.length() > 6800 && s.speed > 8000 && Boolean(s.path);
      case 'cruise': return s.position.length() > 30000 && Boolean(s.path);
      case 'checks': return s.systems.link && s.systems.integrity > .7 && s.fuel > 1 && this.condition('earthOrbit');
      case 'return': return Boolean(s.path) && s.speed > 0;
      case 'flyby': return distance(s, moon) < 12000 && s.heading.dot(s.position.clone().sub(moon)) > 0;
      case 'descent': return s.kind === 'moonLanding' && s.enginePower > 0 && s.altitude > 0;
      case 'moonTouch': return s.surface === 'moon' && s.speed < 4 && s.altitude < .02;
      case 'marsTouch': return s.surface === 'mars' && s.speed < 3 && s.altitude < .02;
      case 'splash': return s.surface === 'ocean' && s.speed < 12 && s.altitude < .02;
      case 'lunarAscent': return s.kind === 'rendezvous' && s.altitude > .02 && s.enginePower > 0;
      case 'marsApproach': return distance(s, s.solarFlight?s.bodyCenter('mars'):mars) < 20000;
      case 'marsEntry': return s.kind === 'marsLanding' && s.altitude <= 125 && s.speed > 500;
      case 'reentry': return s.kind === 'reentry' && s.altitude <= 120 && s.altitude > 0 && s.speed > 1000;
      case 'roverOperations': return s.surface === 'mars' && this.events.find(e => e.id === 'touchdown')?.status === 'COMPLETE';
      case 'dartTarget': return s.kind === 'dartApproach' && s.dartRange > 0 && s.dartRange <= 40000;
      case 'dartTerminal': return s.kind === 'dartApproach' && s.dartRange > 0 && s.dartRange < 1500;
      case 'dartImpact': return s.id === 'dart' && s.dartRange <= .01;
      case 'jupiter': return distance(s, s.solarFlight?s.bodyCenter('jupiter'):jupiter) < (s.solarFlight?700000:150000) && Boolean(s.path);
      case 'saturn': return distance(s, s.solarFlight?s.bodyCenter('saturn'):saturn) < 150000 && Boolean(s.path);
      case 'path': return Boolean(s.path) && s.speed > 0;
      case 'healthy': return true;
      default: return false;
    }
  }
  handle(type, detail = {}) {
    const s = this.flight;
    if (this.muted) return;
    if (type === 'liftoff' && this.condition('liftoff')) {
      this.clock.launch();
      if (Number.isFinite(detail.physicsTime)) this.clock.liftoffTime = detail.physicsTime;
    }
    if (type === 'count') this.notify('mission-control', { cue: 'countdown', value: detail.value, actualTime: this.clock.seconds, missionId: s.id });
    if (['moduleDamage', 'dockingContact', 'dockingRejected'].includes(type)) this.notify('mission-control', { cue: type, actualTime: this.clock.seconds, missionId: s.id, ...detail });
    if (type === 'recovery') {
      this.clock.resume();
      for (const e of this.events) if (e.reason === 'mission-failure') { e.actualTime = null; this.set(e, 'PENDING'); }
    }
    if (type === 'failure' || type === 'launchAbort' || type === 'missionAbort') {
      for (const e of this.events) {
        if (e.status === 'ACTIVE') this.set(e, 'FAILED', type === 'failure' ? 'mission-failure' : 'aborted');
        else if (e.status === 'PENDING') this.set(e, 'SKIPPED', type === 'failure' ? 'mission-failure' : 'aborted');
      }
      this.clock.stop();
      this.notify('mission-control', { cue: type, actualTime: this.clock.seconds, missionId: s.id, ...detail });
    }
    if (type === 'stageFailure') {
      const e = this.events.find(e => e.id === `stage-${detail.stage ?? 1}`);
      if (e && e.status !== 'COMPLETE') this.set(e, 'FAILED', detail.reason ?? 'separation-not-confirmed');
    }
    if (!s.failed && !s.aborted) for (const e of this.events) {
      if (terminal.has(e.status) || e.unsupported || e.signal !== type) continue;
      if (s.phaseIndex < e.phaseIndex || s.phaseIndex > e.endPhaseIndex) continue;
      if (e.filter && !Object.entries(e.filter).every(([key, value]) => detail[key] === value)) continue;
      if (this.condition(e.condition)) this.set(e, 'COMPLETE', '', Number.isFinite(detail.physicsTime) && this.clock.launched ? detail.physicsTime - this.clock.liftoffTime : undefined);
    }
    if (type === 'success' || type === 'designIncomplete' || type==='probeImpact'&&s.id==='dart') this.clock.stop();
    this.update();
  }
  update() {
    const s = this.flight;
    let active = false;
    if (!s.failed && !s.aborted) for (const e of this.events) {
      if (terminal.has(e.status) || e.status === 'FAILED') continue;
      if (e.unsupported && s.phaseIndex >= e.phaseIndex) this.set(e, 'SKIPPED', 'not-simulated');
      else if (s.phaseIndex > e.endPhaseIndex || s.complete) this.set(e, 'SKIPPED', 'not-confirmed');
      else if (s.phaseIndex >= e.phaseIndex) {
        if (e.signal === 'tick' && this.condition(e.condition)) this.set(e, 'COMPLETE');
        else if (!active) { this.set(e, 'ACTIVE'); active = true; }
        else this.set(e, 'PENDING');
      }
    }
    this.status.update(s, this.clock, this.events);
  }
  get current() { return this.events.find(e => e.status === 'FAILED') ?? this.events.find(e => e.status === 'ACTIVE') ?? this.events.find(e => e.status === 'PENDING') ?? this.events.at(-1); }
  // Continuously reforecast from the *current* trajectory/phase, independent of history.
  expected(e) {
    if (e.actualTime !== null) return e.actualTime;
    const s = this.flight;
    const launchOffset = this.clock.liftoffTime ?? 0;
    if (e.phaseIndex < s.phaseIndex) return null;
    let seconds = this.clock.launched ? s.totalTime - launchOffset : 0;
    if (s.kind === 'ascent') {
      const p = s.launch;
      if (p.cutoff && !p.orbitAchieved) return null;
      if (e.id === 'max-q') return s.verticalSpeed > 0 ? seconds + Math.max(0, (13000 - s.altitude * 1000) / s.verticalSpeed) : null;
      const index = e.id === 'meco' ? 0 : e.id.startsWith('stage-') ? Number(e.id.slice(6)) - 1 : null;
      if (index !== null) {
        let wait = Math.max(0, p.stageIgnitionAt - p.time);
        for (let i = p.stageIndex; i <= index; i++) {
          const spec = p.vehicle.stages[i], state = p.stages[i];
          if (!state || state.failed || s.throttle <= 0) return null;
          const flow = p.engine(spec, state, s.throttle * s.systems.powerLimit, p.air).flow;
          if (flow <= 0) return null;
          wait += state.fuelKg / flow + (i > p.stageIndex ? spec.ignitionDelayS : 0);
        }
        return seconds + wait;
      }
    }
    if (e.phaseIndex === s.phaseIndex) {
      const target = s.id === 'apollo_11' && s.flightLength === 'short' && e.id === 'lm-extraction'
        ? (s.path?.burnDuration ?? LUNAR_TIMING.apollo_11.tliBurn) + LUNAR_TIMING.apollo_11.extractionDelay + apolloExtractionDuration(s)
        : s.phase.duration * e.expectedFraction;
      return seconds + Math.max(0, target - s.time) + (s.systems.correction || 0);
    }
    seconds += Math.max(0, s.phase.duration - s.time);
    for (let i = s.phaseIndex + 1; i < e.phaseIndex; i++) seconds += s.mission.phases[i].duration;
    return seconds + s.mission.phases[e.phaseIndex].duration * e.expectedFraction;
  }
  serialize() { return { version: 1, missionId: this.flight.id, clock: this.clock.serialize(), events: this.events.map(({ id, status, actualTime, reason }) => ({ id, status, actualTime, reason })) }; }
  restore(data) {
    const validTime = value => value === null || Number.isFinite(value);
    if (data.version !== 1 || data.missionId !== this.flight.id || !Array.isArray(data.events)
      || !data.clock || !validTime(data.clock.liftoffTime) || !validTime(data.clock.stoppedAt)
      || data.events.some(e => !Object.values(TimelineStatus).includes(e.status) || !validTime(e.actualTime))) throw new Error('Incompatible timeline save');
    this.clock.restore(data.clock);
    for (const saved of data.events) {
      const e = this.events.find(e => e.id === saved.id);
      if (e && Object.values(TimelineStatus).includes(saved.status)) Object.assign(e, { status: saved.status, actualTime: saved.actualTime, reason: saved.reason });
    }
    this.revision++;
    this.status.update(this.flight, this.clock, this.events);
  }
}
