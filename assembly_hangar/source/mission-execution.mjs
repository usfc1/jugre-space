import { planMission } from './mission-plan.mjs';
import { historicalPlan, validatedHistoricalSignals } from './historical-objectives.mjs';

const terminalEvents = new Set(['failure', 'launchAbort', 'missionAbort', 'success', 'designIncomplete']);
const expeditionEvents = { expeditionTli: 'tli', expeditionArrival: 'lunar-coast', expeditionCapture: 'lunar-orbit',
  expeditionOperations: 'lunar-operations', expeditionReturn: 'return-burn', expeditionEntry: 'entry', expeditionRecovery: 'recovery' };
const planetaryEvents = { planetDeparture: 'planet-departure', planetArrival: 'planet-arrival', planetCapture: 'planet-orbit' };

export class MissionExecution {
  constructor(spec, saved = null) {
    this.historical = typeof spec === 'string';
    this.plan = this.historical ? historicalPlan(spec) : planMission(spec);
    if (!this.plan.executable) throw new Error('Mission profile unavailable');
    this.objectives = (this.historical ? this.plan.objectives : this.plan.phases).map(({ id, name, dependencies, ...meta }) => ({
      ...meta,
      id, name, dependencies, state: meta.future ? 'SKIPPED' : dependencies.length ? 'LOCKED' : 'ACTIVE', evidence: null,
    }));
    this.events = [];
    if (saved) this.restore(saved);
  }

  restore(saved) {
    if (saved.version !== 1 || !Array.isArray(saved.objectives) || !this.historical && saved.objectives.length !== this.objectives.length
      || !Array.isArray(saved.events) || saved.events.length > 1000) throw new Error('Invalid mission objectives');
    const goalsById = this.historical ? new Map(saved.objectives.map(goal => [goal.id, goal])) : null;
    this.objectives.forEach((item, i) => {
      const value = goalsById ? goalsById.get(item.id) : saved.objectives[i];
      if (this.historical && !value) return;
      if (value?.id !== item.id || !['LOCKED', 'ACTIVE', 'COMPLETED', 'FAILED', 'SKIPPED'].includes(value.state)
        || (value.state === 'COMPLETED' && (!value.evidence || !Number.isFinite(value.evidence.seconds)))) throw new Error('Invalid mission objective');
      Object.assign(item, { state: value.state, evidence: value.evidence });
    });
    if (saved.events.some(event => typeof event.type !== 'string' || !Number.isFinite(event.seconds))) throw new Error('Invalid mission log');
    this.events = structuredClone(saved.events);
  }

  get complete() { return this.objectives.filter(item => !this.historical || item.tier === 'primary').every(item => item.state === 'COMPLETED'); }

  observe(flight, type, detail = {}, missionTime = flight.totalTime) {
    if (this.historical) return this.observeHistorical(flight, type, detail, missionTime);
    if (['liftoff', 'stage', 'stageFailure', 'stageIgnition', 'engineFailure', 'engineCutoff', 'orbitInsertion', 'moduleDamage', 'crewAlert', 'crewControl', 'powerFailure', 'soiEntry',
      'satelliteDeployed', 'satelliteSafeMode', 'satelliteRecovered', 'satelliteControl'].includes(type) || terminalEvents.has(type) || Object.hasOwn(expeditionEvents, type) || Object.hasOwn(planetaryEvents, type)) {
      if (this.events.length === 120) this.events.shift();
      this.events.push({ type, seconds: missionTime, detail: structuredClone(detail) });
    }
    if (terminalEvents.has(type) && type !== 'success') {
      for (const item of this.objectives) {
        if (item.state === 'ACTIVE') item.state = 'FAILED';
        else if (item.state === 'LOCKED') item.state = 'SKIPPED';
      }
    }
    if (flight.failed || flight.aborted || flight.complete) return;
    if (type === 'recovery') {
      for (const item of this.objectives) if (item.state === 'FAILED' || item.state === 'SKIPPED') item.state = 'LOCKED';
    }
    const { target: orbit } = this.plan;
    const { durationS } = this.plan.spec;
    const satellite = flight.satellite;
    const { periapsisM, apoapsisM, energy, eccentricity, inclinationDeg, periodS } = flight.launch.orbit;
    const withinOrbit = flight.launch.orbitAchieved && energy < 0
      && Math.abs(periapsisM - orbit.periapsisM) <= orbit.toleranceM
      && Math.abs(apoapsisM - orbit.apoapsisM) <= orbit.toleranceM;
    for (const item of this.objectives) {
      if (item.state === 'LOCKED' && item.dependencies.every(id => this.objectives.find(goal => goal.id === id).state === 'COMPLETED')) item.state = 'ACTIVE';
      if (item.state !== 'ACTIVE') continue;
      const elapsed = flight.timeline.clock.seconds;
      const evidence = item.id === 'liftoff' && !flight.launch.onPad ? { altitudeM: flight.launch.altitudeM }
        : item.id === 'earth-orbit' && withinOrbit && (durationS == null || elapsed <= durationS)
          ? { periapsisM, apoapsisM, energy, eccentricity, inclinationDeg, periodS }
          : item.id === 'deployment' && satellite?.orbit ? { elapsed }
          : item.id === 'observation' && satellite?.generatedMB > satellite?.lostMB ? { generatedMB: satellite.generatedMB }
          : item.id === 'downlink' && satellite?.downlinkedMB >= this.plan.spec.spacecraft.downlinkGoalMB - 1e-8 ? { downlinkedMB: satellite.downlinkedMB }
          : Object.hasOwn(expeditionEvents, type) && item.id === expeditionEvents[type] ? detail
          : Object.hasOwn(planetaryEvents, type) && item.id === planetaryEvents[type]
            && (type !== 'planetCapture' || detail.energy < 0 && Math.abs(detail.periapsisM - this.plan.spec.orbit.periapsisM) <= this.plan.spec.orbit.toleranceM
              && Math.abs(detail.apoapsisM - this.plan.spec.orbit.apoapsisM) <= this.plan.spec.orbit.toleranceM) ? detail
          : item.id === 'duration' && withinOrbit && elapsed >= durationS - 1e-8 && this.crewReady(flight) ? { elapsed } : null;
      if (evidence) {
        item.state = 'COMPLETED';
        item.evidence = { ...evidence, seconds: flight.totalTime };
      }
    }
  }

  crewReady(flight) {
    return this.plan.spec.crewCount === 0 || flight.lifeSupport?.readiness().ready === true;
  }
  observeHistorical(flight, type, detail, seconds) {
    const signals = validatedHistoricalSignals(flight, type, detail);
    for (const signal of signals) {
      if (!this.events.some(e => e.signal === signal)) this.events.push({ type: type ?? 'measurement', signal, detail: structuredClone(detail), seconds });
    }
    for (const goal of this.objectives) {
      if (goal.future || goal.state === 'COMPLETED') continue;
      const evidence = goal.signals.map(signal => this.events.find(e => e.signal === signal));
      if (evidence.length && evidence.every(Boolean)) { goal.state = 'COMPLETED'; goal.evidence = { seconds, signals: structuredClone(evidence) }; }
      else if (flight.failed || flight.aborted || ['failure', 'missionAbort', 'launchAbort'].includes(type)) goal.state = goal.tier === 'primary' ? 'FAILED' : 'SKIPPED';
    }
    if (this.events.length > 1000) this.events.splice(0, this.events.length - 1000);
  }
  medal(flight) {
    if (!this.complete || flight.failed || flight.aborted || !flight.complete) return null;
    const optional = this.objectives.filter(o => o.tier === 'optional' && !o.future), done = optional.filter(o => o.state === 'COMPLETED').length;
    const gold = this.objectives.find(o => /Gold|Золото/.test(o.name));
    return done === optional.length && (!gold || gold.state === 'COMPLETED') ? 'gold' : done >= Math.ceil(optional.length / 2) ? 'silver' : 'bronze';
  }
  saveRecord(flight, storage) {
    const medal = this.medal(flight); if (!this.historical || !medal) return false;
    const key = 'jugre.mission-records.v1', order = { bronze: 1, silver: 2, gold: 3 };
    try {
      let records = JSON.parse(storage.getItem(key) ?? 'null'); if (records?.version !== 1) records = { version: 1, missions: {} };
      records.missions ??= {};
      const old = records.missions[this.plan.id], next = { medal, seconds: flight.totalTime, fuelKg: flight.fuelMassKg, updatedUtc: new Date().toISOString() };
      if (!old || order[medal] > order[old.medal] || order[medal] === order[old.medal] && next.seconds < old.seconds) records.missions[this.plan.id] = next;
      storage.setItem(key, JSON.stringify(records)); return true;
    } catch { return false; }
  }

  result(flight) {
    return { status: flight.aborted ? 'ABORTED' : flight.failed ? 'FAILED'
      : flight.complete ? this.complete && this.crewReady(flight) ? 'COMPLETED' : 'INCOMPLETE' : 'ACTIVE',
    objectives: this.objectives, events: this.events };
  }

  serialize() {
    return { version: 1, objectives: structuredClone(this.objectives), events: structuredClone(this.events) };
  }
}
