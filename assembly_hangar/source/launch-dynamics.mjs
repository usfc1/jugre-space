import { MathUtils, Vector3 } from 'three';
import { atmosphere, EARTH_MU, EARTH_OMEGA, EARTH_RADIUS_M, G0, PAD_POSITION_M, groundDistanceM, localBasis, orbitElements } from './flight-coordinates.mjs';
import { physicsSample } from './flight-diagnostics.mjs';
import { keplerState } from './orbital-propagator.mjs';
import { rocketControlDefaults, steerRocket, rotateHoldWithEarth } from './rocket-control.mjs';

export const PHYSICS_STEP_S = 1 / 120;
const checkpointSamples = 1024;
const radians = Math.PI / 180;
function interpolate(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (x <= points[i][0]) {
    const [a, va] = points[i - 1], [b, vb] = points[i];
    return MathUtils.lerp(va, vb, (x - a) / (b - a));
  }
  return points.at(-1)[1];
}

export class LaunchDynamics {
  constructor(vehicle) {
    this.vehicle = structuredClone(vehicle);
    this.positionM = PAD_POSITION_M.clone();
    this.velocityMps = new Vector3();
    this.accelerationMps2 = new Vector3();
    this.thrustDirection = PAD_POSITION_M.clone().normalize();
    this.rocketControl = rocketControlDefaults();
    this.rocketControl.hold = this.thrustDirection.toArray();
    this.stages = vehicle.stages.map(s => ({ fuelKg: s.propellantKg, attached: true, failed: false }));
    this.boosters = vehicle.boosters ? { fuelKg: vehicle.boosters.propellantKg, attached: true, failed: false, ignited: false } : null;
    this.stageIndex = 0;
    this.ventedPayloadKg = 0;
    this.releasedPayloadKg = 0;
    this.stageIgnitionAt = vehicle.stages[0].igniteAfterS ?? 0;
    this.time = 0;
    this.accumulator = 0;
    this.pitch = 0; this.yaw = 90 - vehicle.guidance.azimuthDeg; this.roll = 0;
    this.pitchRate = 0; this.yawRate = 0; this.rollRate = 0;
    this.thrustN = 0; this.dragN = 0; this.massKg = this.mass();
    this.fairingAttached = vehicle.fairingMassKg > 0;
    this.onPad = true;
    this.liftoffTime = null;
    this.orbitAchieved = false;
    this.crashed = false;
    this.cutoff = false;
    this.separationFaults = new Set();
    this.events = [];
    this.trajectory = [];
    this.lastRecordS = 0;
    this.measure();
    this.trajectory.push(physicsSample(this));
  }
  mass() {
    let mass = this.vehicle.payloadMassKg - this.ventedPayloadKg - this.releasedPayloadKg + (this.fairingAttached ? this.vehicle.fairingMassKg : 0);
    this.stages.forEach((s, i) => { if (s.attached) mass += this.vehicle.stages[i].dryMassKg + s.fuelKg; });
    if (this.boosters?.attached) mass += this.vehicle.boosters.dryMassKg + this.boosters.fuelKg;
    return Math.max(1, mass);
  }
  get fuelMassKg() { return this.stages.reduce((sum, s) => sum + (s.attached ? s.fuelKg : 0), 0) + (this.boosters?.attached ? this.boosters.fuelKg : 0); }
  get initialFuelKg() { return this.vehicle.stages.reduce((sum, s) => sum + s.propellantKg, 0) + (this.vehicle.boosters?.propellantKg ?? 0); }
  emit(type, detail = {}) { this.events.push({ type, detail: { ...detail, physicsTime: this.time } }); }
  failEngine(stage = this.stageIndex) {
    if (stage === 'boosters' && this.boosters) this.boosters.failed = true;
    else if (this.stages[stage]) this.stages[stage].failed = true;
    this.emit('engineFailure', { stage });
  }
  separate(manual = false) {
    const index = this.stageIndex, stage = this.stages[index];
    if (!stage?.attached || index >= this.stages.length - 1 || (!manual && stage.fuelKg > 1e-6)) return false;
    if (this.separationFaults.has(index)) {
      if (!stage.separationFailureReported) this.emit('stageFailure', { stage: index + 1, reason: 'Separation actuator failure' });
      stage.separationFailureReported = true;
      return false;
    }
    this.emit('engineCutoff', { stage: index + 1 });
    const releasedMassKg = this.vehicle.stages[index].dryMassKg + stage.fuelKg;
    stage.attached = false;
    this.stageIndex++;
    this.thrustN = 0;
    this.stageIgnitionAt = this.time + this.vehicle.stages[this.stageIndex].ignitionDelayS;
    this.emit('stage', { stage: index + 1, releasedMassKg, parts: this.vehicle.stages[index].parts });
    this.massKg = this.mass();
    return true;
  }
  jettisonFairing() {
    if (!this.fairingAttached) return false;
    this.fairingAttached = false;
    this.massKg = this.mass();
    this.emit('fairingSeparated', { releasedMassKg: this.vehicle.fairingMassKg });
    return true;
  }
  engine(stage, state, throttle, ambient) {
    if (!state || state.failed || state.fuelKg <= 0 || throttle <= 0) return { thrust: 0, flow: 0 };
    const vacuum = MathUtils.clamp(1 - ambient.pressurePa / 101325, 0, 1);
    const factor = stage.curve ? interpolate(stage.curve, 1 - state.fuelKg / stage.propellantKg) : throttle;
    const thrust = MathUtils.lerp(stage.seaThrustN, stage.vacuumThrustN, vacuum) * factor;
    const isp = MathUtils.lerp(stage.seaIspS, stage.vacuumIspS, vacuum);
    return { thrust, flow: thrust / (Math.max(1, isp) * G0) };
  }
  guidancePitch(thrustAcceleration) {
    const g = this.vehicle.guidance;
    if (this.onPad || this.time - (this.liftoffTime ?? this.time) < g.verticalSeconds) return 0;
    if (this.altitudeM < 65000) return interpolate(g.pitchAltitudes, this.altitudeM);
    const { up } = localBasis(this.positionM);
    const vi = this.orbit.inertialSpeedMps, vr = this.velocityMps.dot(up);
    const horizontal2 = Math.max(0, vi * vi - vr * vr);
    const target = this.stageIndex === 0 ? g.loftAltitudeM : g.targetAltitudeM;
    const circularSpeed = Math.sqrt(EARTH_MU / this.positionM.length());
    const circularizing = MathUtils.smoothstep(Math.sqrt(horizontal2) / circularSpeed, .75, .98);
    const desiredVertical = MathUtils.clamp((target - this.altitudeM) / 90, -200, 1000) * (1 - circularizing);
    const gravity = EARTH_MU / this.positionM.lengthSq() - horizontal2 / this.positionM.length();
    const requiredRadial = gravity + (desiredVertical - vr) / MathUtils.lerp(45, 12, circularizing);
    return MathUtils.radToDeg(Math.acos(MathUtils.clamp(requiredRadial / Math.max(.1, thrustAcceleration), -.65, .98)));
  }
  acceleration(position, velocity, thrustN, massKg, direction, out) {
    const radius = position.length(), air = atmosphere(radius - EARTH_RADIUS_M);
    const speed = velocity.length();
    const dragFactor = .5 * air.density * this.vehicle.dragCoefficient * this.frontalAreaM2 * speed / massKg;
    out.copy(position).multiplyScalar(-EARTH_MU / radius ** 3).addScaledVector(direction, thrustN / massKg).addScaledVector(velocity, -dragFactor);
    // Earth-fixed equations: gravity + thrust + drag - 2ω×v - ω×(ω×r).
    out.x += -2 * EARTH_OMEGA * velocity.z + EARTH_OMEGA ** 2 * position.x;
    out.z += 2 * EARTH_OMEGA * velocity.x + EARTH_OMEGA ** 2 * position.z;
    return out;
  }
  get frontalAreaM2() {
    this.frontalAreas ??= this.vehicle.stages.map((item, index, stages) => {
      const diameter = item.diameterM == null ? this.vehicle.diameterM : Math.max(...stages.slice(index).map(remaining => remaining.diameterM));
      return Math.PI * (diameter / 2) ** 2;
    });
    return this.frontalAreas[this.stageIndex];
  }
  measure() {
    this.altitudeM = this.positionM.length() - EARTH_RADIUS_M;
    const up = this.positionM.clone().normalize();
    this.verticalSpeedMps = this.velocityMps.dot(up);
    this.surfaceSpeedMps = this.velocityMps.length();
    this.horizontalSpeedMps = Math.sqrt(Math.max(0, this.surfaceSpeedMps ** 2 - this.verticalSpeedMps ** 2));
    this.air = atmosphere(this.altitudeM);
    this.dynamicPressurePa = .5 * this.air.density * this.surfaceSpeedMps ** 2;
    this.groundDistanceM = groundDistanceM(this.positionM);
    this.orbit = orbitElements(this.positionM, this.velocityMps);
    this.massKg = this.mass();
    this.dragN = this.dynamicPressurePa * this.vehicle.dragCoefficient * this.frontalAreaM2;
    this.properG = this.onPad ? (EARTH_MU / this.positionM.lengthSq() - EARTH_OMEGA ** 2 * this.positionM.clone().setY(0).length()) / G0
      : this.thrustDirection.clone().multiplyScalar(this.thrustN / this.massKg).addScaledVector(this.velocityMps, -this.dragN / (this.massKg * Math.max(1e-12, this.surfaceSpeedMps))).length() / G0;
  }
  step(dt, controls) {
    if (this.crashed) return;
    this.measure();
    const g = this.vehicle.guidance;
    const current = this.stages[this.stageIndex], spec = this.vehicle.stages[this.stageIndex];
    const trial = controls.rocketTest === true && controls.mode === 'manual';
    const node = this.rocketControl.maneuver;
    if (trial && node?.status === 'armed') this.rocketControl.sasMode = node.direction;
    const pending = trial && node?.status === 'armed' && this.time < node.startS;
    const remaining = node?.status === 'armed' ? node.deltaVMps - node.deliveredMps : Infinity;
    let throttle = this.cutoff && !trial || pending ? 0 : MathUtils.clamp(controls.throttle ?? 1, 0, 1) * MathUtils.clamp(controls.powerLimit ?? 1, 0, 1);
    if (trial && (remaining <= 1e-7 || node?.status === 'complete' || node?.status === 'failed')) throttle = 0;
    let commanded = throttle * (spec.throttleLimit ?? 1);
    if (controls.mode !== 'manual') {
      if (this.dynamicPressurePa > g.maxDynamicPressurePa) commanded *= MathUtils.clamp(g.maxDynamicPressurePa / this.dynamicPressurePa, .35, 1);
      if (this.properG > g.maxG) commanded *= g.maxG / this.properG;
    }
    let core = this.time >= this.stageIgnitionAt ? this.engine(spec, current, commanded, this.air) : { thrust: 0, flow: 0 };
    if (trial && node?.status === 'armed' && core.thrust * dt / this.massKg > remaining) {
      const fraction = remaining * this.massKg / (core.thrust * dt);
      core.thrust *= fraction;
      core.flow *= fraction;
    }
    if (this.boosters && !this.boosters.ignited && throttle > .05) this.boosters.ignited = true;
    let boosters = this.boosters?.attached && this.boosters.ignited ? this.engine(this.vehicle.boosters, this.boosters, 1, this.air) : { thrust: 0, flow: 0 };
    const coreFraction = core.flow > 0 ? Math.min(1, current.fuelKg / (core.flow * dt)) : 0;
    const boosterFraction = boosters.flow > 0 ? Math.min(1, this.boosters.fuelKg / (boosters.flow * dt)) : 0;
    core.thrust *= coreFraction; core.flow *= coreFraction;
    boosters.thrust *= boosterFraction; boosters.flow *= boosterFraction;
    this.thrustN = core.thrust + boosters.thrust;
    const usedCore = core.flow * dt, usedBooster = boosters.flow * dt;
    const midMass = this.massKg - (usedCore + usedBooster) / 2;
    const minPitch = trial ? -180 : -10, maxPitch = trial ? 180 : 125;
    const desiredPitch = controls.mode === 'manual' ? MathUtils.clamp(this.pitch + (controls.pitch ?? 0) * 20, minPitch, maxPitch) : this.guidancePitch(this.thrustN / midMass);
    const desiredRate = MathUtils.clamp((desiredPitch - this.pitch) * .8, -g.maxPitchRateDegS, g.maxPitchRateDegS);
    const response = axis => 1 - Math.exp(-dt * (controls.sas && !controls[axis] ? 10 : 3));
    this.pitchRate += (desiredRate - this.pitchRate) * response('pitch');
    this.pitch = MathUtils.clamp(this.pitch + this.pitchRate * dt, minPitch, maxPitch);
    this.yawRate += (((controls.mode === 'manual' ? controls.yaw ?? 0 : 0) * 3) - this.yawRate) * response('yaw');
    this.rollRate += (((controls.mode === 'manual' ? controls.roll ?? 0 : 0) * 8) - this.rollRate) * response('roll');
    this.yaw += this.yawRate * dt; this.roll += this.rollRate * dt;
    const { up, east, north } = localBasis(this.positionM);
    this.thrustDirection.copy(up).multiplyScalar(Math.cos(this.pitch * radians))
      .addScaledVector(east, Math.sin(this.pitch * radians) * Math.cos(this.yaw * radians))
      .addScaledVector(north, Math.sin(this.pitch * radians) * Math.sin(this.yaw * radians)).normalize();
    if (trial) {
      steerRocket(this, dt, controls);
      this.pitch = MathUtils.radToDeg(Math.acos(MathUtils.clamp(this.thrustDirection.dot(up), -1, 1)));
      this.yaw = MathUtils.radToDeg(Math.atan2(this.thrustDirection.dot(north), this.thrustDirection.dot(east)));
      rotateHoldWithEarth(this, dt);
    }
    const acceleration = this.acceleration(this.positionM, this.velocityMps, this.thrustN, midMass, this.thrustDirection, new Vector3());
    if (this.onPad && acceleration.dot(up) <= 0) {
      this.positionM.copy(PAD_POSITION_M); this.velocityMps.set(0, 0, 0); this.accelerationMps2.set(0, 0, 0);
    } else {
      if (this.onPad) { this.onPad = false; this.liftoffTime = this.time; this.emit('liftoff'); }
      const predictedPosition = this.positionM.clone().addScaledVector(this.velocityMps, dt).addScaledVector(acceleration, .5 * dt * dt);
      const predictedVelocity = this.velocityMps.clone().addScaledVector(acceleration, dt);
      const endAcceleration = this.acceleration(predictedPosition, predictedVelocity, this.thrustN, midMass, this.thrustDirection, new Vector3());
      this.velocityMps.addScaledVector(acceleration.add(endAcceleration), dt / 2);
      this.positionM.copy(predictedPosition);
      this.accelerationMps2.copy(endAcceleration);
    }
    current.fuelKg = Math.max(0, current.fuelKg - usedCore);
    if (this.boosters) this.boosters.fuelKg = Math.max(0, this.boosters.fuelKg - usedBooster);
    this.time += dt;
    if (trial && node?.status === 'armed' && !pending) {
      node.deliveredMps += core.thrust * dt / midMass;
      if (node.deliveredMps >= node.deltaVMps - 1e-5) {
        node.status = 'complete'; this.emit('maneuverComplete', { deltaVMps: node.deliveredMps });
      } else if (current.fuelKg <= 1e-6 || current.failed) {
        node.status = 'failed'; this.emit('maneuverFailed', { reason: 'propellant-or-engine' });
      }
    }
    if (this.boosters?.attached && this.boosters.fuelKg <= 1e-6) {
      if (!this.separationFaults.has('boosters')) {
        this.boosters.attached = false;
        this.emit('boostersSeparated', { releasedMassKg: this.vehicle.boosters.dryMassKg, parts: this.vehicle.boosters.parts });
      }
    }
    if (!this.cutoff && current.fuelKg <= 1e-6) {
      if (this.stageIndex < this.stages.length - 1 && !trial) this.separate();
      else { this.cutoff = true; this.thrustN = 0; this.emit('engineCutoff', { final: true, exhausted: true }); }
    }
    this.measure();
    if (this.fairingAttached && this.altitudeM > 85000 && this.dynamicPressurePa < 500) this.jettisonFairing();
    if (!this.onPad && this.altitudeM < -.1) { this.crashed = true; this.thrustN = 0; this.emit('failure', { reason: 'impact' }); }
    if (!this.orbitAchieved
      && this.orbit.periapsisM >= g.targetAltitudeM - 10000 && this.orbit.apoapsisM <= g.targetAltitudeM + 200000 && this.altitudeM > 100000) {
      if (!trial) {
        if (this.stageIndex < this.stages.length - 1) this.separate(true);
        this.cutoff = true;
        this.thrustN = 0;
        this.emit('engineCutoff', { final: true, exhausted: false });
      }
      this.orbitAchieved = true;
      this.emit('orbitInsertion', { periapsisM: this.orbit.periapsisM, apoapsisM: this.orbit.apoapsisM });
    }
    // Telemetry represents the instantaneous post-burn/post-separation forces,
    // not the averaged force used over the preceding integration interval.
    this.measure();
    if (this.onPad || this.crashed) this.accelerationMps2.set(0, 0, 0);
    else this.acceleration(this.positionM, this.velocityMps, this.thrustN, this.massKg, this.thrustDirection, this.accelerationMps2);
    if (this.time - this.lastRecordS >= 1 - 1e-8) {
      this.trajectory.push(physicsSample(this)); this.lastRecordS = this.time;
      if (this.trajectory.length > 7200) this.trajectory.shift();
    }
  }
  advance(seconds, controls = {}) {
    this.accumulator += Math.max(0, seconds);
    while (this.accumulator >= PHYSICS_STEP_S - 1e-10) {
      this.accumulator -= PHYSICS_STEP_S;
      this.step(PHYSICS_STEP_S, controls);
    }
    return this;
  }
  get canCoast() { return this.orbitAchieved && !this.onPad && this.thrustN <= 0; }
  coast(seconds) {
    if(!this.canCoast) return this.advance(seconds,{throttle:0});
    const omega=new Vector3(0,EARTH_OMEGA,0);
    const inertial=this.velocityMps.clone().add(new Vector3().crossVectors(omega,this.positionM)).multiplyScalar(.001);
    const state=keplerState(this.positionM.clone().multiplyScalar(.001),inertial,seconds);
    // ECI axes are aligned with ECEF at the beginning of this coast interval.
    const angle=-EARTH_OMEGA*seconds,cos=Math.cos(angle),sin=Math.sin(angle);
    const rotate=v=>{const x=v.x,z=v.z;v.x=cos*x+sin*z;v.z=-sin*x+cos*z;return v;};
    this.positionM.copy(rotate(state.position.multiplyScalar(1000)));
    this.velocityMps.copy(rotate(state.velocity.multiplyScalar(1000))).sub(new Vector3().crossVectors(omega,this.positionM));
    this.time+=seconds;this.accumulator=0;this.measure();
    this.acceleration(this.positionM,this.velocityMps,0,this.massKg,this.thrustDirection,this.accelerationMps2);
    this.properG=0;
    if(this.time-this.lastRecordS>=1){this.trajectory.push(physicsSample(this));this.lastRecordS=this.time;if(this.trajectory.length>7200)this.trajectory.shift();}
    return this;
  }
  snapshot() {
    const trajectory = this.trajectory.length <= checkpointSamples ? this.trajectory
      : Array.from({ length: checkpointSamples }, (_, i) => this.trajectory[Math.round(i * (this.trajectory.length - 1) / (checkpointSamples - 1))]);
    return { version: 1, vehicle: this.vehicle, rocketControl: structuredClone(this.rocketControl), positionM: this.positionM.toArray(), velocityMps: this.velocityMps.toArray(),
      accelerationMps2: this.accelerationMps2.toArray(), thrustDirection: this.thrustDirection.toArray(),
      stages: structuredClone(this.stages), boosters: structuredClone(this.boosters), stageIndex: this.stageIndex, stageIgnitionAt: this.stageIgnitionAt,
      time: this.time, accumulator: this.accumulator, pitch: this.pitch, yaw: this.yaw, roll: this.roll,
      pitchRate: this.pitchRate, yawRate: this.yawRate, rollRate: this.rollRate,
      fairingAttached: this.fairingAttached, onPad: this.onPad, liftoffTime: this.liftoffTime, orbitAchieved: this.orbitAchieved,
      crashed: this.crashed, cutoff: this.cutoff, thrustN: this.thrustN, ventedPayloadKg: this.ventedPayloadKg, releasedPayloadKg: this.releasedPayloadKg,
      separationFaults: [...this.separationFaults], trajectory: structuredClone(trajectory), lastRecordS: this.lastRecordS };
  }
  static restore(saved) {
    if (saved?.version !== 1 || !saved.vehicle || !Array.isArray(saved.stages)) throw new Error('Unsupported launch physics save');
    const engine = new LaunchDynamics(saved.vehicle);
    engine.rocketControl = rocketControlDefaults(saved.rocketControl);
    const vented = saved.ventedPayloadKg ?? 0;
    const released = saved.releasedPayloadKg ?? 0;
    if (!Number.isFinite(vented) || vented < 0 || !Number.isFinite(released) || released < 0
      || released + vented > saved.vehicle.payloadMassKg) throw new Error('Invalid released or vented mass');
    engine.ventedPayloadKg = vented;
    engine.releasedPayloadKg = released;
    for (const key of ['positionM','velocityMps','accelerationMps2','thrustDirection']) {
      if (!Array.isArray(saved[key]) || saved[key].length !== 3 || !saved[key].every(Number.isFinite)) throw new Error('Invalid launch physics vector');
      engine[key].fromArray(saved[key]);
    }
    for (const key of ['stageIndex','stageIgnitionAt','time','accumulator','pitch','yaw','roll','pitchRate','yawRate','rollRate','fairingAttached','onPad','liftoffTime','orbitAchieved','crashed','cutoff','thrustN']) engine[key] = saved[key];
    engine.stages = structuredClone(saved.stages); engine.boosters = structuredClone(saved.boosters);
    engine.separationFaults = new Set(saved.separationFaults); engine.measure();
    engine.trajectory = structuredClone(saved.trajectory ?? []); engine.lastRecordS = saved.lastRecordS ?? engine.time;
    return engine;
  }
}
