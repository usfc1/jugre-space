import { MathUtils, Vector3 } from 'three';
import { rigidConfig, moduleMasses } from './rigid-config.mjs';

const transfers = new Set(['moonTransfer', 'marsTransfer', 'asteroidTransfer', 'jupiterTransfer', 'saturnTransfer']);
const lateral = new Vector3();
const probeToEarth = new Vector3();
const moonOffset = new Vector3();
const radians = Math.PI / 180;

export function airDensity(kind, heightKm) {
  if (kind === 'ascent' || kind === 'reentry') return heightKm < 95 ? 1.225 * Math.exp(-Math.max(0, heightKm) / 8.3) : 0;
  if (kind === 'marsLanding' || kind === 'marsSurface') return heightKm < 85 ? 0.020 * Math.exp(-Math.max(0, heightKm) / 10.8) : 0;
  return 0;
}

export class FlightSystems {
  constructor(moon, moonRadius) {
    this.moon = moon;
    this.moonRadius = moonRadius;
    this.density = 1.225;
    this.pressure = 0;
    this.peakPressure = 0;
    this.peakTime = 0;
    this.temperature = .23;
    this.integrity = 1;
    this.link = true;
    this.linkTime = 0;
    this.deviationTime = 0;
    this.trackError = 0;
    this.correction = 0;
    this.warnings = new Set();
    this.moduleDamage = {};
    this.cabinPressureKPa = 101.3;
    this.leakKgPerS = 0;
    this.powerProfile = null;
    this.batteryJ = 0;
    this.generatedJ = 0;
    this.consumedJ = 0;
    this.dumpedJ = 0;
    this.unmetJ = 0;
    this.generationW = 0;
    this.busW = 0;
    this.powerFailure = false;
  }
  configurePower(profile) {
    this.powerProfile={...profile};
    this.batteryJ=profile.batteryWh*3600;
    this.generationW=profile.generationW;
    this.busW=profile.busW;
  }
  powerBoundary() {
    if (!this.powerProfile) return Infinity;
    const { solar, busW, generationW } = this.powerProfile;
    const suppliedW = solar ? this.generationW : generationW * (1 - Math.max(0, this.moduleDamage.power ?? 0));
    return busW > suppliedW ? this.batteryJ / (busW - suppliedW) : Infinity;
  }

  get powerLimit() {
    return this.powerFailure?0:1 - 0.55 * MathUtils.smoothstep(this.temperature, .94, 1.20);
  }

  newPhase() {
    this.trackError = this.correction = this.deviationTime = 0;
  }

  impact(state, event) {
    const c = rigidConfig.damage;
    if (event.speedMps < c.minimumSpeedMps) return;
    const zone = String(event.zone ?? 'hull');
    const moduleId = Object.keys(moduleMasses).find(id => zone.includes(id)) ?? zone;
    const moduleMass = moduleMasses[moduleId] ?? event.hostMassKg;
    const reducedMass = event.hostMassKg * event.otherMassKg / Math.max(1, event.hostMassKg + event.otherMassKg);
    const energyJ = Math.min(.5 * reducedMass * event.speedMps ** 2, .5 * event.impulseNs * event.speedMps);
    const specific = energyJ / Math.max(1, moduleMass);
    if (specific < c.specificEnergyJkg) return;
    const damage = MathUtils.clamp((specific - c.specificEnergyJkg) / 120, 0, 1);
    this.moduleDamage[moduleId] = Math.min(1, (this.moduleDamage[moduleId] ?? 0) + damage);
    this.integrity = Math.max(0, this.integrity - damage * .35);
    if (state.crew && specific >= c.breachEnergyJkg && /hull|apollo_cm|orion_cm|eagle_ascent|pk_2/.test(moduleId)) this.leakKgPerS = Math.max(this.leakKgPerS, .02 + damage * .1);
    state.report('moduleDamage', { module: moduleId, damage, speedMps: event.speedMps, impulseNs: event.impulseNs, energyJ });
    const index = state.launch.vehicle.stages.findIndex(s => s.parts.some(id => moduleId.includes(id)));
    if (index >= 0 && this.moduleDamage[moduleId] >= .8) state.launch.failEngine(index);
    if (this.integrity <= 0) state.fail('structure');
  }

  navigate(state, dt, input) {
    const tracking = transfers.has(state.kind) || (state.kind === 'earthReturn' && state.segmentStart.length() > 30000);
    if (!tracking || state.progress < .16 || state.progress > .90) return;
    const steer = state.mode === 'manual' ? .28 * (input.yaw ?? 0) : 0;
    const drift = .065 + steer;
    if (this.correction) {
      const step = Math.min(dt, this.correction);
      this.trackError -= Math.sign(this.trackError) * Math.min(Math.abs(this.trackError), .95 * step);
      state.fuel = Math.max(0, state.fuel - step * .15);
      this.correction = Math.max(0, this.correction - dt);
    } else {
      this.trackError += drift * dt;
      if (Math.abs(this.trackError) > 2.7 && state.fuel > 1) {
        this.correction = 3.8;
        state.report('correction', {}, `correction:${state.phaseIndex}`);
      }
    }
    state.trimBurn = this.correction > 0;
    lateral.crossVectors(state.heading, this.moon).normalize();
    state.position.addScaledVector(lateral, this.trackError * (1 - MathUtils.smoothstep(state.progress, .78, .90)));
  }

  checkLink(state, dt) {
    let blocked = false;
    if (['moonOrbit', 'lunarFlyby', 'separate', 'rendezvous', 'moonLanding', 'moonSurface', 'earthReturn'].includes(state.kind)) {
      const range = state.position.length();
      probeToEarth.copy(state.position).multiplyScalar(-1 / Math.max(range, 1));
      moonOffset.copy(this.moon).sub(state.position);
      const along = moonOffset.dot(probeToEarth);
      const radius = this.moonRadius + (this.link ? -3 : 3);
      blocked = along > 0 && along < range && moonOffset.lengthSq() - along * along < radius * radius;
    }
    if (state.kind === 'reentry') blocked = state.altitude < 108 && state.altitude > 43 && state.speed > 2050;
    const available = !blocked;
    this.linkTime = available === this.link ? 0 : this.linkTime + dt;
    if (this.linkTime < .65) return;
    this.linkTime = 0;
    this.link = available;
    state.report('link', { available });
  }

  tick(state, dt, enginePower) {
    if(this.powerProfile && dt>=0){
      const p=this.powerProfile;
      let factor=1;
      if(p.solar && (state.solarFlight||state.interplanetary?.departed)){
        const offset=state.interplanetary?.route?.sunOffset;
        const radius=offset?state.position.clone().add(new Vector3().fromArray(offset)).length()
          :state.position.distanceTo(state.bodyCenter('sun'));
        factor=(149597870.7/Math.max(1,radius))**2;
      }
      this.generationW=p.generationW*factor*(1-Math.max(0,this.moduleDamage.power??0));
      this.busW=p.busW;
      const generated=this.generationW*dt,requested=this.busW*dt,available=this.batteryJ+generated,supplied=Math.min(available,requested);
      this.generatedJ+=generated;
      this.consumedJ+=supplied;
      this.unmetJ+=requested-supplied;
      this.dumpedJ+=Math.max(0,available-supplied-p.batteryWh*3600);
      this.batteryJ=Math.max(0,Math.min(p.batteryWh*3600,available-supplied));
      const failed=this.batteryJ<=1e-6&&this.generationW<this.busW;
      const firstFailure = failed && !this.powerFailure;
      this.powerFailure=failed;
      if (firstFailure) state.report('powerFailure', { batteryJ: this.batteryJ, generationW: this.generationW, busW: this.busW });
    }
    if (state.crew && !state.lifeSupport && this.leakKgPerS > 0) {
      this.cabinPressureKPa = Math.max(0, this.cabinPressureKPa - this.leakKgPerS * 8.4 * dt);
      if (this.cabinPressureKPa < 55 && !this.warnings.has('cabinPressure')) {
        this.warnings.add('cabinPressure'); state.report('warning', { id: 'cabinPressure' });
      }
      if (this.cabinPressureKPa < 20) state.fail('depressurization');
    }
    if (state.kind === 'dartAftermath') {
      this.density = this.pressure = 0;
      return;
    }
    const physical = state.kind === 'ascent' || state.kind === 'orbit';
    this.density = physical ? state.launch.air.density : airDensity(state.kind, state.altitude);
    this.pressure = physical ? state.launch.dynamicPressurePa * .001 : .0005 * this.density * state.speed ** 2;
    if (state.kind === 'ascent') {
      if (this.pressure > this.peakPressure) {
        this.peakPressure = this.pressure;
        this.peakTime = state.totalTime;
      }
      if (this.peakPressure > 1.5 && this.pressure < this.peakPressure * .93 && state.totalTime - this.peakTime > .65) {
        state.report('maxQ', { peakKPa: this.peakPressure, physicsTime: this.peakTime }, 'maxQ');
      }
    }
    // Rated operation reaches a stable temperature below the damage limit.
    // The previous model overheated every normally operating long-burn engine.
    const target = .23 + .52 * enginePower ** 2 + (state.launch?.thermalFault ?? 0);
    const tau = enginePower > .3 ? 42 : 14;
    this.temperature += (target - this.temperature) * (1 - Math.exp(-dt / tau));
    if (state.kind === 'ascent') {
      const aero = Math.max(0, this.pressure / 67 - 1) * .12;
      const heat = Math.max(0, this.temperature - 1.10) * .29;
      this.integrity = Math.max(0, this.integrity - (aero + heat) * dt);
    }
    if (!state.failed) {
      this.checkLink(state, dt);
      this.checkWarnings(state, dt);
      if (this.integrity === 0) state.fail('structure');
    }
  }

  checkWarnings(state, dt) {
    const pitch = state.launch?.guidancePitch(Math.max(.1, state.thrustN / state.massKg)) ?? state.pitch;
    const crossTrack = Math.abs(Math.sin(state.yaw * radians)) * Math.min(1, Math.abs(Math.sin(state.pitch * radians)));
    const offCourse = state.mode === 'manual' && state.kind === 'ascent' && state.altitude > 1
      && (Math.abs(state.pitch - pitch) > 40 || crossTrack > .56);
    this.deviationTime = offCourse ? this.deviationTime + dt : 0;
    const triggered = {
      hot: this.temperature >= .97,
      fuel: state.fuel <= 12,
      guidance: this.deviationTime >= 2 || Math.abs(this.trackError) >= 5.5,
      structure: this.integrity <= .30,
    };
    for (const id of ['structure', 'hot', 'fuel', 'guidance']) {
      if (!triggered[id] || this.warnings.has(id)) continue;
      this.warnings.add(id);
      state.report('warning', { id });
    }
  }
}
