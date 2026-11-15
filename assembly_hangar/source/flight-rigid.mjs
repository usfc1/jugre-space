import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { RigidScene, fromPx } from './physx-runtime.mjs';
import { relativeBounds } from './flight-maneuvers.mjs';
import { findPart } from './flight-layout.mjs';
import { rigidConfig, moduleMasses } from './rigid-config.mjs';
import { assistanceLevels } from './control-profiles.mjs';
import { EARTH_MU } from './flight-coordinates.mjs';
import { rcsCommand, restoreRcs, targetInFov } from './spacecraft-control.mjs';
import { controlContext } from './flight-controls.mjs';

const zero = new Vector3(), yAxis = new Vector3(0, 1, 0);
const icpsWaypoints = [[0, 0, 20], [20, 0, 0], [0, 0, -20], [-20, 0, 0], [0, 0, 50]];
const stationHoldPoints = [400, 200, 20];
function angularVelocity(a, b, dt) {
  const delta = b.clone().multiply(a.clone().invert()).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const angle = 2 * Math.acos(Math.min(1, delta.w));
  return new Vector3(delta.x, delta.y, delta.z).normalize().multiplyScalar(angle / Math.max(dt, 1e-6));
}

// Modules get independent contact zones. Thin solar arrays/antennae are omitted;
// three axial boxes approximate each hull without expensive render-mesh cooking.
export function hullBoxes(model, reference, ids = []) {
  let modules = ids.map(id => findPart(model, id)).filter(Boolean);
  if (!modules.length) modules = [model];
  return modules.flatMap(node => {
    const bounds = relativeBounds(node, node);
    const port=findPart(node,'dock_port');
    if(port){
      node.updateWorldMatrix(true,true);
      const normal=new Vector3(0,0,1).applyQuaternion(port.getWorldQuaternion(new Quaternion())).applyQuaternion(node.getWorldQuaternion(new Quaternion()).invert());
      const position=node.worldToLocal(port.getWorldPosition(new Vector3()));
      // Probes/antennas can extend beyond the capture plane (Apollo: 0.31 m).
      // They belong to the capture mechanism, not the solid hull collider.
      if(normal.y>.9)bounds.max.y=Math.min(bounds.max.y,position.y-.20);
      else if(normal.y<-.9)bounds.min.y=Math.max(bounds.min.y,position.y+.20);
    }
    const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
    if (bounds.isEmpty()) return [];
    reference.updateWorldMatrix(true, false);
    const matrix = reference.matrixWorld.clone().invert().multiply(node.matrixWorld);
    const translation = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    matrix.decompose(translation, rotation, scale);
    const zone = node.userData.partId ?? node.name ?? 'hull';
    return [-1, 0, 1].map(section => ({
      half: [Math.max(.025, size.x * Math.abs(scale.x) * (section ? .37 : .46)), Math.max(.025, size.y * Math.abs(scale.y) / 6 * .98), Math.max(.025, size.z * Math.abs(scale.z) * (section ? .37 : .46))],
      center: center.clone().addScaledVector(yAxis, section * size.y / 3).applyMatrix4(matrix).toArray(), rotation: rotation.toArray(), zone,
    }));
  });
}

export function portFrame(root) {
  const port = findPart(root, 'dock_port');
  if (!port) return null;
  root.updateWorldMatrix(true, true);
  const q = root.getWorldQuaternion(new Quaternion()).invert();
  return { p: root.worldToLocal(port.getWorldPosition(new Vector3())),
    normal: new Vector3(0, 0, 1).applyQuaternion(port.getWorldQuaternion(new Quaternion())).applyQuaternion(q).normalize() };
}

export function dockingMetrics(a, portA, b, portB) {
  const pa = portA.p.clone().applyQuaternion(a.q).add(a.p), pb = portB.p.clone().applyQuaternion(b.q).add(b.p);
  const va = a.preV.clone().add(new Vector3().crossVectors(a.preW, pa.clone().sub(a.p)));
  const vb = b.preV.clone().add(new Vector3().crossVectors(b.preW, pb.clone().sub(b.p)));
  const axis = portA.normal.clone().applyQuaternion(a.q), delta = pb.clone().sub(pa);
  const side = new Vector3(1, 0, 0); if (Math.abs(axis.dot(side)) > .9) side.set(0, 1, 0);
  side.cross(axis).normalize(); const up = new Vector3().crossVectors(axis, side);
  const relative = vb.clone().sub(va);
  return { distanceM: pa.distanceTo(pb), speedMps: va.sub(vb).length(), closingMps: -relative.dot(axis),
    lateralXM: delta.dot(side), lateralYM: delta.dot(up), lateralM: delta.clone().addScaledVector(axis, -delta.dot(axis)).length(),
    angularRateRadS: a.preW.clone().sub(b.preW).length(),
    angleRad: portA.normal.clone().applyQuaternion(a.q).angleTo(portB.normal.clone().applyQuaternion(b.q).negate()),
    point: pa.add(pb).multiplyScalar(.5) };
}
export function canCapture(m, assistance = 'standard', manual = false) {
  const c = rigidConfig.docking;
  const scale = assistanceLevels[assistance].toleranceScale;
  return m.distanceM <= c.distanceM * scale && m.speedMps <= (manual ? .2 : c.speedMps) * scale
    && m.angleRad <= (manual ? 4 * Math.PI / 180 : c.angleRad) * scale
    && (!manual || (m.lateralM ?? 0) <= .2 * scale && (m.angularRateRadS ?? 0) <= .2 * Math.PI / 180 * scale);
}

export class FlightRigidPhysics {
  constructor(runtime, scene, report, impact) {
    this.runtime = runtime; this.renderScene = scene; this.report = report; this.impact = impact;
    this.frame = new Quaternion(); this.command = new Quaternion(); this.previousCommand = null;
    this.angular = new Vector3(); this.guidanceAngular = new Vector3(); this.anchorVelocity = new Vector3();
    this.gravity = new Vector3(); this.anchorAcceleration = new Vector3();
    this.pendingInteriorDeltaV = new Vector3(); this.debris = []; this.lastDock = null;
    this.reset();
  }
  reset() {
    this.rcs = restoreRcs();
    this.exterior?.dispose();
    this.exterior = new RigidScene(this.runtime, e => this.contact(e));
    this.debris = []; this.host = null; this.target = null; this.joint = null; this.modelKey = '';
    this.previousCommand = null; this.angular.set(0, 0, 0); this.guidanceAngular.set(0, 0, 0);
    this.pendingInteriorDeltaV.set(0, 0, 0); this.lastDock = null; this.damagePairs = new Map(); this.lastOmega = null;
    this.contactCount = 0; this.separations = []; this.dockingActive = false; this.geometryRevision = 0;
    this.dockingRejected = false; this.approachSample = null; this.dockingFault = false; this.lastContact = null;
    this.freeModule = null; this.pendingHostVelocity = null; this.assemblySample = null; this.assemblyCaptured = false;
    this.proximity = null;
    this.stationApproach = null;
  }
  dispose() { this.exterior.dispose(); this.host = this.target = null; this.debris = []; }
  setFrame(frame) { this.frame.copy(frame); }
  syncHost(model, ship, state) {
    this.state = state;
    state.localPhysicsAvailable = true;
    this.rcs ??= restoreRcs();
    this.command.copy(this.frame).multiply(ship.quaternion);
    this.anchorVelocity.copy(state.kind === 'ascent' || state.kind === 'orbit' ? state.launch.velocityMps : state.heading.clone().multiplyScalar(state.speed));
    if (state.kind === 'ascent' || state.kind === 'orbit') {
      const pos = state.launch.positionM;
      this.gravity.copy(pos).multiplyScalar(-EARTH_MU / pos.length() ** 3);
      // The trajectory engine already accounts for Earth rotation. Match its
      // apparent gravity so a released body receives no second thrust force.
      const omega = new Vector3(0, 7.292115e-5, 0);
      this.gravity.add(new Vector3().crossVectors(omega, new Vector3().crossVectors(omega, pos)).negate());
      this.gravity.add(new Vector3().crossVectors(omega, state.launch.velocityMps).multiplyScalar(-2));
      this.anchorAcceleration.copy(state.launch.accelerationMps2);
      if (state.launch.onPad) this.anchorAcceleration.set(0, 0, 0);
    } else if (state.path?.physical || state.lunar?.entry) {
      this.gravity.set(0,0,0);this.anchorAcceleration.copy(state.properAccelerationMps2);
    } else {
      this.gravity.set(0, 0, 0); this.anchorAcceleration.set(0, 0, 0);
      const c = rigidConfig.maneuverProperMps2;
      const proper = state.kind === 'moonSurface' ? 1.62 : state.kind === 'marsSurface' ? 3.71
        : ['moonLanding','rendezvous'].includes(state.kind) ? state.enginePower * c.lunarBurn
          : state.kind === 'marsLanding' ? state.enginePower * c.marsBurn
            : state.kind === 'reentry' ? (state.surface ? 9.81 : c.reentry * Math.sin(Math.PI * state.progress))
              : state.trimBurn ? c.trim : 0;
      this.anchorAcceleration.copy(yAxis).applyQuaternion(this.command).multiplyScalar(proper);
    }
    const ids = state.kind === 'ascent' ? state.launch.vehicle.stages.filter((_, i) => state.launch.stages[i].attached).flatMap(s => s.parts)
      .concat(state.launch.boosters?.attached ? state.launch.vehicle.boosters.parts : [], Object.keys(moduleMasses)) : Object.keys(moduleMasses);
    const key = `${model.uuid}:${state.launch.stageIndex}:${state.launch.boosters?.attached}:${state.launch.fairingAttached}:${this.geometryRevision}`;
    if (key !== this.modelKey) {
      const old = this.host;
      const transfer = old ? { p: old.p.clone(), q: old.q.clone(), v: fromPx(old.actor.getLinearVelocity()), w: fromPx(old.actor.getAngularVelocity()) }
        : { p: new Vector3(), q: this.command.clone(), v: new Vector3(), w: new Vector3() };
      if (this.pendingHostVelocity) { transfer.v.copy(this.pendingHostVelocity.v); transfer.w.copy(this.pendingHostVelocity.w); this.pendingHostVelocity = null; }
      if (old) this.exterior.remove(old);
      this.hostIncludesStageHardware = state.launch.vehicle.stages.some(s=>s.parts.some(id=>findPart(model,id)));
      this.payloadMass = Object.entries(moduleMasses).reduce((sum,[id,mass])=>sum+(findPart(model,id)?mass:0),0) || state.launch.vehicle.payloadMassKg;
      const mass = state.kind === 'ascent' || this.hostIncludesStageHardware || state.lunar?.isolated || state.localAscent && state.kind === 'rendezvous' ? state.massKg : this.payloadMass;
      this.host = this.exterior.add({ id: 'vessel', ...transfer, mass: mass || 10000,
        boxes: hullBoxes(model, ship, ids), family: 1 });
      this.modelKey = key; this.hostModel = model; this.ship = ship;
    }
    const mass = (state.kind === 'ascent' || this.hostIncludesStageHardware || state.lunar?.isolated || state.localAscent && state.kind === 'rendezvous' ? state.massKg : this.payloadMass)
      - (this.target?.id === 'columbia' && state.objectivesEnabled && state.kind === 'rendezvous' ? 0 : this.rcs.usedKg);
    if (this.host && this.host.mass !== mass) {
      this.host.mass = mass;
      this.runtime.P.PxRigidBodyExt.prototype.setMassAndUpdateInertia(this.host.actor, Math.max(1, mass), this.exterior.pxVector(zero));
    }
  }
  release(part, velocity, spin = .16, lifetime = rigidConfig.debrisLifetime, mass = 500) {
    if (!part) return false;
    this.geometryRevision++;
    while (this.debris.length >= rigidConfig.maxDebris) this.exterior.remove(this.debris.shift());
    const pivot = new Group();
    pivot.position.copy(new Box3().setFromObject(part, true).getCenter(new Vector3()));
    pivot.quaternion.copy(part.getWorldQuaternion(new Quaternion()));
    this.renderScene.add(pivot); pivot.attach(part);
    const p = pivot.position.clone().applyQuaternion(this.frame);
    const q = this.frame.clone().multiply(pivot.quaternion);
    const relative = velocity.clone().applyQuaternion(this.frame)
      .add(new Vector3().crossVectors(this.angular, p.clone().sub(this.host?.p ?? zero)))
      .add(this.host ? fromPx(this.host.actor.getLinearVelocity()) : zero);
    const w = this.angular.clone().add(new Vector3(spin, spin * .43, -spin * .74).applyQuaternion(q));
    const body = this.exterior.add({ id: `debris:${part.userData.partId ?? part.name}`, p, q, v: relative, w, mass,
      boxes: hullBoxes(part, pivot), family: 1, mesh: pivot });
    body.born = this.exterior.time; body.lifetime = lifetime; body.radius = relativeBounds(part, pivot).getSize(new Vector3()).length() / 2;
    this.debris.push(body);
    this.separations.push({ id: body.id, time: body.born, positionM: p.toArray(), worldVelocityMps: relative.clone().add(this.anchorVelocity).toArray(), angularVelocityRadS: w.toArray() });
    if (this.separations.length > 40) this.separations.shift();
    return true;
  }
  discardDebris() {
    for (const body of this.debris) this.exterior.remove(body);
    this.debris.length = 0;
  }
  detachNearby(root, model, velocity, mass = 15000) {
    if (!model || this.freeModule) return;
    const p = root.position.clone().applyQuaternion(this.frame), q = this.frame.clone().multiply(root.quaternion);
    const v = velocity.clone().applyQuaternion(this.frame).add(new Vector3().crossVectors(this.angular,p.clone().sub(this.host?.p ?? zero)))
      .add(this.host ? fromPx(this.host.actor.getLinearVelocity()) : zero);
    const body = this.exterior.add({id:'free-eagle',p,q,v,w:this.angular.clone(),mass,boxes:hullBoxes(model,root,['eagle_ascent','eagle_descent']),family:1});
    this.freeModule={body,root}; this.geometryRevision++;
  }
  endFreeModule() {
    if (!this.freeModule) return;
    const { body } = this.freeModule;
    this.pendingHostVelocity={v:fromPx(body.actor.getLinearVelocity()),w:fromPx(body.actor.getAngularVelocity())};
    this.exterior.remove(body); this.freeModule=null;
  }
  confirmAssemblyCapture(a, b, progress, duration) {
    if (!a || !b) return false;
    const pose = root => ({p:root.getWorldPosition(new Vector3()),q:root.getWorldQuaternion(new Quaternion()),preV:new Vector3(),preW:new Vector3()});
    const pa=portFrame(a),pb=portFrame(b); if(!pa || !pb)return false;
    const current={a:pose(a),b:pose(b),progress};
    const sample=this.assemblySample,dt=sample?(progress-sample.progress)*duration:0;
    if(dt>1e-6) for(const key of ['a','b']) {
      current[key].preV.copy(current[key].p).sub(sample[key].p).divideScalar(dt);
      current[key].preW.copy(angularVelocity(sample[key].q,current[key].q,dt));
    }
    this.assemblySample=current;
    if(progress<1 || !sample)return false;
    const metrics=dockingMetrics(current.a,pa,current.b,pb);
    if(!canCapture(metrics))return false;
    // The captured CSM/LM is represented by the vessel's compound rigid actor.
    // Rebuild its shapes after the guided transposition has changed their poses.
    this.geometryRevision++; this.assemblyCaptured=true; return true;
  }
  advance(dt) {
    if (!this.host || dt <= 0) return;
    const nextAngular = this.previousCommand ? angularVelocity(this.previousCommand, this.command, dt) : zero.clone();
    this.previousCommand = this.command.clone(); this.angular.copy(nextAngular);
    const manual = this.state.mode === 'manual' && controlContext(this.state).owner === 'physx';
    this.exterior.advance(dt, step => {
      if (manual) {
        this.guidanceAngular.set(0, 0, 0);
        const controlled = this.state.objectivesEnabled && this.state.kind === 'rendezvous' && this.target?.id === 'columbia'
          ? this.target : this.host;
        const inverse = controlled.q.clone().invert();
        const basis = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.state.id === 'dart' ? Math.PI : Math.PI / 2);
        const c = rcsCommand(this.rcs, this.state.localControlAxes ?? {}, this.state.manualControl, controlled.mass, step,
          fromPx(controlled.actor.getAngularVelocity()).applyQuaternion(inverse).applyQuaternion(basis.clone().invert()));
        this.exterior.force(controlled, c.acceleration.applyQuaternion(basis).applyQuaternion(controlled.q));
        controlled.actor.addTorque(this.exterior.pxVector(c.angular.applyQuaternion(basis).applyQuaternion(controlled.q)), this.runtime.P.PxForceModeEnum.eACCELERATION, true);
        if (controlled !== this.host && c.usedKg > 0) {
          controlled.mass -= c.usedKg;
          this.runtime.P.PxRigidBodyExt.prototype.setMassAndUpdateInertia(controlled.actor, controlled.mass, this.exterior.pxVector(zero));
        }
      } else {
        // A render frame may contain zero, one or several PhysX steps. Solve
        // against the last committed pose on the same clock as the integrator.
        const residual = fromPx(this.host.actor.getAngularVelocity()).sub(this.guidanceAngular);
        const drivenAngular = angularVelocity(this.host.q, this.command, step);
        this.exterior.setVelocity(this.host, fromPx(this.host.actor.getLinearVelocity()), drivenAngular.clone().add(residual));
        this.guidanceAngular.copy(drivenAngular);
      }
      if (this.proximity && !manual) this.guideProximity(step);
      if (this.stationApproach?.retreating && this.target) {
        const outward = this.host.p.clone().sub(this.target.p).normalize();
        const wanted = outward.multiplyScalar(.4).add(fromPx(this.target.actor.getLinearVelocity()));
        this.exterior.force(this.host, wanted.sub(fromPx(this.host.actor.getLinearVelocity())).clampLength(0, .04));
      }
      if (this.target && !this.joint && !this.dockingRejected && !this.dockingFault && this.state.mode !== 'manual' && !this.stationApproach?.retreating) {
        const m = dockingMetrics(this.host, this.portA, this.target, this.portB);
        const pa = this.portA.p.clone().applyQuaternion(this.host.q).add(this.host.p);
        const pb = this.portB.p.clone().applyQuaternion(this.target.q).add(this.target.p);
        const axis=this.portA.normal.clone().applyQuaternion(this.host.q),delta=pb.clone().sub(pa),axial=delta.dot(axis);
        const lateral=delta.clone().addScaledVector(axis,-axial);
        const hold = this.stationApproach ? stationHoldPoints[this.stationApproach.index] ?? .1 : .1;
        const closing=m.distanceM>2?Math.min(this.stationApproach ? 2.5 : 1.5,Math.sqrt(.2*Math.max(0,m.distanceM-hold))):.18;
        const axialSpeed = axial < hold ? Math.min(.5, (hold - axial) * .3)
          : lateral.length() > .12 && !this.stationApproach ? Math.max(-.5,Math.min(.5,(2-axial)*.8)) : -closing;
        const desired=lateral.multiplyScalar(-.8).clampLength(0,.3).addScaledVector(axis,axialSpeed)
          .add(fromPx(this.host.actor.getLinearVelocity()))
          .add(new Vector3().crossVectors(fromPx(this.host.actor.getAngularVelocity()),pa.clone().sub(this.host.p)))
          .sub(new Vector3().crossVectors(fromPx(this.target.actor.getAngularVelocity()),pb.clone().sub(this.target.p)));
        this.exterior.force(this.target, desired.sub(fromPx(this.target.actor.getLinearVelocity())).multiplyScalar(4).clampLength(0, 5));
        const targetQ = this.host.q.clone().multiply(this.targetRelativeQ);
        const w = angularVelocity(this.target.q, targetQ, 1).clampLength(0, .2).add(fromPx(this.host.actor.getAngularVelocity()));
        this.target.actor.setAngularVelocity(this.exterior.pxVector(w));
      }
      const acceleration = this.gravity.clone().sub(this.anchorAcceleration);
      if(this.freeModule) {
        const b=this.freeModule.body;this.exterior.force(b,acceleration);
        const radius=boxes=>Math.max(...boxes.map(box=>new Vector3(...box.half).length()+new Vector3(...box.center).length()),1);
        if(b.family && b.p.distanceTo(this.host.p)>radius(b.boxes)+radius(this.host.boxes)+.05)this.exterior.setFamily(b,0);
      }
      for (const body of this.debris) {
        this.exterior.force(body, acceleration);
        if (body.family && this.exterior.time - body.born > .3) {
          // Suppress the just-separated family until their conservative bounding
          // volumes no longer overlap. No positional nudge or depenetration kick.
          const bounds = this.host.boxes.map(box => new Vector3(...box.half).length() + new Vector3(...box.center).length());
          if (body.p.distanceTo(this.host.p) > body.radius + Math.max(...bounds, 1) + .05) this.exterior.setFamily(body, 0);
        }
      }
    }, step => {
      if (this.dockingActive && !this.joint) this.tryCapture();
      if (this.proximity) this.measureProximity(step);
    });
    this.state.localControlAxes = {};
    if (manual && this.state.manualControl.attitude) {
      const controlled = controlContext(this.state).actorId === 'columbia' && this.target ? this.target : this.host;
      this.state.manualControl.attitude.copy(controlled.q);
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const body = this.debris[i];
      if (this.exterior.time - body.born > body.lifetime || body.p.length() > 15000) { this.exterior.remove(body); this.debris.splice(i, 1); }
    }
  }
  grantStationClearance() {
    const ops = this.stationApproach, m = this.lastDock;
    const point = ops && stationHoldPoints[ops.index];
    if (!point || !m || Math.abs(m.distanceM - point) > (point > 20 ? 8 : 2) || m.speedMps > .4) return false;
    ops.index++;
    this.report('issClearance', { pointM: point, speedMps: m.speedMps, rangeM: m.distanceM });
    if (ops.index === stationHoldPoints.length) this.report('issHoldClearances', { validated: true, count: ops.index });
    return true;
  }
  retreatFromStation() {
    if (!this.stationApproach || !this.target || this.joint) return false;
    this.stationApproach.retreating = true; return true;
  }
  startProximity(model) {
    if (!this.host || this.proximity) return;
    const position = this.host.p.clone().add(new Vector3(0, 0, -36).applyQuaternion(this.frame));
    const body = this.exterior.add({ id: 'icps', fixed: true, p: position, q: this.frame, boxes: hullBoxes(model, model) });
    this.proximity = { body, basis: this.frame.clone(), waypoint: 0, holdS: 0, holdOrigin: null, done: false };
  }
  guideProximity(step) {
    const p = this.proximity;
    const point = icpsWaypoints[p.waypoint];
    if (!point) return;
    const target = new Vector3(...point).applyQuaternion(p.basis).add(p.body.p);
    const desiredV = target.sub(this.host.p).multiplyScalar(.12).clampLength(0, .7);
    const desiredA = desiredV.sub(fromPx(this.host.actor.getLinearVelocity())).multiplyScalar(.5);
    const local = desiredA.applyQuaternion(this.host.q.clone().invert()).multiplyScalar(this.host.mass / 220);
    const c = rcsCommand(this.rcs, { lateral: local.x, vertical: local.y, longitudinal: -local.z }, { rcs: true }, this.host.mass, step);
    this.exterior.force(this.host, c.acceleration.applyQuaternion(this.host.q));
  }
  measureProximity(step) {
    const p = this.proximity;
    if (p.done) return;
    const delta = this.host.p.clone().sub(p.body.p).applyQuaternion(p.basis.clone().invert());
    const speedMps = fromPx(this.host.actor.getLinearVelocity()).length();
    if (p.waypoint === 0 && delta.distanceTo(new Vector3(...icpsWaypoints[0])) <= 2 && speedMps <= .025) {
      p.holdOrigin ??= this.host.p.toArray();
      const driftM = this.host.p.distanceTo(new Vector3(...p.holdOrigin));
      if (driftM > .5) { p.holdS = 0; p.holdOrigin = this.host.p.toArray(); }
      else p.holdS += step;
      if (p.holdS >= 60) this.report('icpsHold', { driftM, holdS: p.holdS }, 'icpsHold');
    }
    if (delta.distanceTo(new Vector3(...icpsWaypoints[p.waypoint])) > 2 || p.waypoint === 0 && p.holdS < 60) return;
    if (++p.waypoint === icpsWaypoints.length) {
      p.done = true; this.state.historicalOperations.flags.icpsComplete = true;
      this.report('icpsCircuit', { waypoints: p.waypoint, rangeM: delta.length(), rcsKg: this.rcs.usedKg });
    }
  }
  renderProximity(root) {
    if (!this.proximity) return;
    const p = this.proximity;
    root.position.copy(p.body.p).applyQuaternion(this.frame.clone().invert());
    root.quaternion.copy(this.frame).invert().multiply(p.body.q);
    root.visible = true;
  }
  canRail() {
    return Boolean(this.host&&!this.target&&!this.proximity&&!this.joint&&!this.freeModule&&!this.debris.length
      &&this.pendingInteriorDeltaV.lengthSq()<1e-12
      &&fromPx(this.host.actor.getLinearVelocity()).lengthSq()<1e-10
      &&fromPx(this.host.actor.getAngularVelocity()).sub(this.guidanceAngular).lengthSq()<1e-10);
  }
  canRailExpedition() {
    // The deep-space model prescribes the vessel pose. Wait for departed hardware
    // and contact impulses, then let guidance settle any residual angular motion.
    return Boolean(this.host && !this.target && !this.proximity && !this.joint && !this.freeModule && !this.debris.length
      && this.pendingInteriorDeltaV.lengthSq() < 1e-12);
  }
  rail(dt) {
    // The isolated host has no external local forces or contacts during coast.
    // Preserve its pose and let the orbital propagator advance the distant anchor.
    this.exterior.setVelocity(this.host,zero,zero);this.host.q.copy(this.command);
    this.host.actor.setGlobalPose(this.exterior.pxPose(this.host.p,this.host.q));
    this.previousCommand=this.command.clone();this.angular.set(0,0,0);this.guidanceAngular.set(0,0,0);
    this.exterior.skipQuietTime(dt);
  }
  contact(e) {
    this.contactCount++;
    this.lastContact = { a: e.a.id, b: e.b.id, zoneA: e.zoneA, zoneB: e.zoneB, speedMps: e.speedMps };
    if ([e.a, e.b].includes(this.proximity?.body) && [e.a, e.b].includes(this.host)) this.state.fail('Orion collided with ICPS');
    if (e.a === this.host || e.b === this.host) {
      const hostFirst = e.a === this.host, other = hostFirst ? e.b : e.a;
      const delta = fromPx(this.host.actor.getLinearVelocity()).sub(this.host.preV);
      this.pendingInteriorDeltaV.add(delta);
      const zone = hostFirst ? e.zoneA : e.zoneB;
      const key = [e.a.actor.ptr, e.b.actor.ptr].sort().join(':');
      if (e.time - (this.damagePairs.get(key) ?? -Infinity) > rigidConfig.damage.cooldownS) {
        this.damagePairs.set(key, e.time);
        this.impact({ ...e, zone, otherMassKg: other.mass, hostMassKg: this.host.mass });
      }
      if (other === this.target && !this.joint) {
        const m = dockingMetrics(this.host, this.portA, this.target, this.portB);
        const scale = assistanceLevels[this.state.manualControl?.assistance ?? 'standard'].toleranceScale;
        const manual = this.state.mode === 'manual';
        if (e.speedMps > (manual ? .2 : rigidConfig.docking.speedMps) * scale || m.angleRad > (manual ? 4 * Math.PI / 180 : rigidConfig.docking.angleRad) * scale) {
          this.dockingRejected = true; this.report('dockingRejected', { speedMps: e.speedMps, angleRad: m.angleRad });
        }
        this.report('dockingContact', { speedMps: e.speedMps, impulseNs: e.impulseNs, zone });
      }
    }
  }
  // Scripted navigation owns the distant rendezvous. At twenty metres the actual
  // poses/velocities are handed to PhysX, and scripts stop writing either body.
  approach(model, root, kind, dt) {
    const station = this.state.objectivesEnabled && this.state.id === 'iss_resupply';
    if (!this.host || !['docking', 'rendezvous'].includes(kind) && !(station && kind === 'stationApproach')) return false;
    const aPort = portFrame(this.ship), bPort = portFrame(root);
    if (!aPort || !bPort) return false;
    if (!this.target) {
      const p = root.position.clone().applyQuaternion(this.frame), q = this.frame.clone().multiply(root.quaternion);
      const candidate = { p, q, preV: new Vector3(), preW: new Vector3() };
      const sampleTime = this.exterior.time;
      const sample = this.approachSample;
      const delta = sample ? sampleTime - sample.time : 0;
      if(delta>1e-6){
        const move=p.clone().sub(sample.p).clampLength(0,1.5*delta);p.copy(sample.p).add(move);
        q.copy(sample.q.clone().rotateTowards(q,.15*delta));
      }else if(sample){p.copy(sample.p);q.copy(sample.q);}
      const metrics = dockingMetrics(this.host, aPort, candidate, bPort);
      const v = delta > 1e-6 ? p.clone().sub(sample.p).divideScalar(delta)
        : aPort.normal.clone().applyQuaternion(this.host.q).multiplyScalar(-.25).add(fromPx(this.host.actor.getLinearVelocity()));
      const w = delta > 1e-6 ? angularVelocity(sample.q, q, delta) : new Vector3();
      this.approachSample = { p: p.clone(), q: q.clone(), time: sampleTime };
      if (metrics.distanceM > (station ? 450 : 20)) {
        const inverse=this.frame.clone().invert();root.position.copy(p).applyQuaternion(inverse);root.quaternion.copy(inverse).multiply(q);
        return false;
      }
      this.target = this.exterior.add({ id: kind === 'docking' || station ? 'iss' : 'columbia', p, q,
        v, w,
        mass: kind === 'docking' || station ? 420000 : 24000, boxes: hullBoxes(model, root, kind === 'docking' || station
          ? ['unity', 'destiny', 'harmony', 'pma_zenith', 'ida_zenith', 'pma_forward', 'ida_forward', 'tranquility', 'cupola', 'columbus', 'kibo', 'kibo_logistics', 'quest', 'zarya', 'zvezda', 'poisk', 'rassvet', 'nauka']
          : ['apollo_cm', 'apollo_sm']), family: 0 });
      this.dockingActive = true; this.portA = aPort; this.portB = bPort;
      this.state.dockingPhysicsReady = true;
      if (station) this.stationApproach = { index: 0, corridorViolated: false, retreating: false };
      this.targetRelativeQ = this.host.q.clone().invert().multiply(q);
      // Host family suppression is for its own newly detached hardware only.
      this.report('physicsApproach', { target: this.target.id, distanceM: metrics.distanceM });
    }
    if (dt > 0) this.tryCapture();
    const pose = this.exterior.render(this.target), inverse = this.frame.clone().invert();
    root.position.copy(pose.p).applyQuaternion(inverse); root.quaternion.copy(inverse).multiply(pose.q);
    return true;
  }
  tryCapture() {
    if (!this.target || this.joint) return;
    // Read current point velocities, including spin, rather than the scheduled animation speed.
    for (const b of [this.host, this.target]) { fromPx(b.actor.getLinearVelocity(), b.preV); fromPx(b.actor.getAngularVelocity(), b.preW); }
    const m = dockingMetrics(this.host, this.portA, this.target, this.portB);
    this.lastDock = { ...m, point: undefined, angleDeg: m.angleRad * 180 / Math.PI, captured: false,
      inFov: targetInFov(this.host.p, this.host.q, this.target.p, 15, this.portA.normal), holdPointM: [400, 200, 20].find(n => m.distanceM >= n) ?? 0 };
    if (this.stationApproach) {
      const station = this.stationApproach;
      if (station.retreating && m.distanceM > 24) { station.retreating = false; station.index = Math.min(station.index, 2); this.dockingRejected = false; }
      const corridor = Math.max(.2, m.distanceM * .1);
      if (m.lateralM > corridor && m.distanceM < 200) station.corridorViolated = true;
      if (m.lateralM > corridor * 3 && m.distanceM < 20 && m.speedMps > 2) { this.state.fail('Dragon left the corridor at unsafe speed'); return; }
      if (station.index < 3 && this.state.mode !== 'manual') this.grantStationClearance();
      if (station.index < 3 || station.retreating || this.state.kind !== 'docking') {
        if (station.index === 3) this.state.historicalOperations.flags.issCleared = true;
        return;
      }
    }
    if (this.dockingRejected) return;
    if (!canCapture(m, this.state.manualControl?.assistance, this.state.mode === 'manual')) return;
    this.joint = this.exterior.lock(this.host, this.target, m.point); this.lastDock.captured = true;
    this.state.dockingCaptured = this.state.dockingLocked = true;
    this.state.dockingCaptureTime = this.state.totalTime;
    this.report('dock', { target: this.target.id }); this.report('hardCapture', {}); this.report('dockingComplete', {});
    if (this.target.id === 'columbia') this.report('columbiaCaptured', { fixedJoint: true, speedMps: m.speedMps, lateralM: m.lateralM, angleRad: m.angleRad });
    if (this.stationApproach) this.report('idaCaptured', { fixedJoint: true, speedMps: m.speedMps, lateralM: m.lateralM,
      angleRad: m.angleRad, corridorViolated: this.stationApproach.corridorViolated });
  }
  clearDock() {
    if (this.joint) { this.joint.release(); this.exterior.joints.delete(this.joint); this.joint = null; }
    if (this.target) this.exterior.remove(this.target);
    this.target = null; this.dockingActive = false; this.dockingRejected = false; this.approachSample = null; this.dockingFault = false;
    this.stationApproach = null;
    if (this.state) this.state.dockingPhysicsReady = false;
  }
  dockingTest(mode) {
    if (!this.target || this.joint) return;
    this.dockingFault = true;
    const direction = this.portA.normal.clone().applyQuaternion(this.host.q).multiplyScalar(mode === 'fast' ? -12 : -.55);
    this.exterior.setVelocity(this.target, direction.add(fromPx(this.host.actor.getLinearVelocity())), mode === 'angle'
      ? new Vector3(1,0,0).applyQuaternion(this.host.q).multiplyScalar(.9) : zero);
  }
  serialize() {
    const port = p => p && ({p:p.p.toArray(),normal:p.normal.toArray()});
    const proximity = this.proximity;
    return { rcs: this.rcs, host:this.host && this.exterior.saveBody(this.host), target:this.target && this.exterior.saveBody(this.target),
      proximity: proximity && { ...proximity, body: this.exterior.saveBody(proximity.body), basis: proximity.basis.toArray() }, stationApproach: this.stationApproach,
      freeModule:this.freeModule && this.exterior.saveBody(this.freeModule.body),
      portA:port(this.portA), portB:port(this.portB), captured:Boolean(this.joint), rejected:this.dockingRejected,
      targetRelativeQ:this.targetRelativeQ?.toArray() };
  }
  restore(saved, nearby) {
    if (!saved?.host || !this.host) return;
    this.rcs = restoreRcs(saved.rcs);
    this.exterior.restoreBody(this.host,saved.host);
    if (saved.proximity) {
      const { body, basis, ...values } = saved.proximity;
      const fixed = this.exterior.add({ id: 'icps', fixed: true, p: new Vector3(...body.p), q: new Quaternion(...body.q), boxes: body.boxes });
      this.proximity = { ...values, body: fixed, basis: new Quaternion(...basis) };
    }
    if(saved.freeModule && nearby?.children.length) {
      const t=saved.freeModule;
      const body=this.exterior.add({id:t.id,p:new Vector3(...t.p),q:new Quaternion(...t.q),v:new Vector3(...t.v),w:new Vector3(...t.w),mass:t.mass,boxes:t.boxes,family:1});
      this.exterior.restoreBody(body,t);this.freeModule={body,root:nearby};
    }
    if (saved.target && saved.portA && saved.portB) {
      const t=saved.target;
      this.target=this.exterior.add({id:t.id,p:new Vector3(...t.p),q:new Quaternion(...t.q),v:new Vector3(...t.v),w:new Vector3(...t.w),mass:t.mass,boxes:t.boxes});
      this.exterior.restoreBody(this.target,t);
      this.portA={p:new Vector3(...saved.portA.p),normal:new Vector3(...saved.portA.normal)};
      this.portB={p:new Vector3(...saved.portB.p),normal:new Vector3(...saved.portB.normal)};
      this.targetRelativeQ=new Quaternion(...(saved.targetRelativeQ ?? [0,0,0,1]));
      this.dockingActive=true; this.dockingRejected=Boolean(saved.rejected);
      this.state.dockingPhysicsReady = true;
      this.stationApproach = saved.stationApproach ? { ...saved.stationApproach } : null;
      if(saved.captured){const m=dockingMetrics(this.host,this.portA,this.target,this.portB);this.joint=this.exterior.lock(this.host,this.target,m.point);this.lastDock={distanceM:m.distanceM,speedMps:m.speedMps,angleDeg:m.angleRad*180/Math.PI,captured:true};}
    }
  }
  strike() {
    if (!this.host) return;
    const zone = this.host.boxes.find(b => /apollo_cm|orion_cm|eagle_ascent|pk_2/.test(b.zone)) ?? this.host.boxes[0];
    const side = new Vector3(1, 0, 0).applyQuaternion(this.host.q);
    const target = new Vector3(...zone.center).applyQuaternion(this.host.q).add(this.host.p);
    const p = target.clone().addScaledVector(side, zone.half[0] + 12);
    const mesh = new Mesh(new BoxGeometry(.6, .6, .6), new MeshStandardMaterial({ color: 0xb67c58 }));
    this.renderScene.add(mesh);
    while (this.debris.length >= rigidConfig.maxDebris) this.exterior.remove(this.debris.shift());
    const b = this.exterior.add({ id: 'impact-test', p, v: side.multiplyScalar(-95), mass: 8000, mesh, boxes: [{ half: [.3,.3,.3], zone: 'debris' }] });
    b.disposeVisual = () => { mesh.geometry.dispose(); mesh.material.dispose(); };
    b.born = this.exterior.time; b.lifetime = 5; b.radius = .52; this.debris.push(b);
  }
  render(ship) {
    const inv = this.frame.clone().invert();
    if (this.host) {
      const pose = this.exterior.render(this.host);
      ship.position.copy(pose.p).applyQuaternion(inv); ship.quaternion.copy(inv).multiply(pose.q);
    }
    for (const b of this.debris) {
      const pose = this.exterior.render(b);
      b.mesh.position.copy(pose.p).applyQuaternion(inv); b.mesh.quaternion.copy(inv).multiply(pose.q);
    }
    if(this.freeModule) {
      const {body,root}=this.freeModule,pose=this.exterior.render(body);
      root.position.copy(pose.p).applyQuaternion(inv);root.quaternion.copy(inv).multiply(pose.q);
    }
  }
  cabinMotion(dt) {
    // Nominal proper acceleration excludes gravity: free fall is weightless.
    const q = this.host?.q ?? this.command, inverse = q.clone().invert();
    const proper = this.anchorAcceleration.clone().sub(this.gravity).applyQuaternion(inverse);
    const deltaV = this.pendingInteriorDeltaV.clone().applyQuaternion(inverse); this.pendingInteriorDeltaV.set(0, 0, 0);
    const omega = this.host ? fromPx(this.host.actor.getAngularVelocity()).applyQuaternion(inverse) : zero.clone();
    const alpha = this.lastOmega ? omega.clone().sub(this.lastOmega).divideScalar(Math.max(dt, .001)) : zero.clone();
    this.lastOmega = omega.clone();
    return { proper, omega, alpha, deltaV };
  }
  snapshot() {
    return { backend: 'NVIDIA PhysX 5.12.0 / WASM', loaded: true, fixedStepS: rigidConfig.step,
      actors: this.exterior.bodies.size, debris: this.debris.length, joints: this.exterior.joints.size,
      contacts: this.contactCount, dockingRejected: this.dockingRejected, dockingActive: this.dockingActive, stepMs: this.exterior.stepMs, steps: this.exterior.steps,
      hostOffsetM: this.host?.p.toArray(), hostMassKg: this.host?.mass, freeModule: Boolean(this.freeModule), freeModulePositionM:this.freeModule?.body.p.toArray(),
      freeModuleRenderedPositionM:this.freeModule?.root.getWorldPosition(new Vector3()).applyQuaternion(this.frame).toArray(),
      assemblyCaptured:this.assemblyCaptured, docking: this.lastDock, lastContact: this.lastContact, separations: this.separations };
  }
}

export class InteriorPhysics {
  constructor(runtime, root, size = 1) {
    this.root = root; this.size = size; this.contacts = 0;
    this.scene = new RigidScene(runtime, () => this.contacts++);
    this.loose = []; this.fixed = [];
    // Collider positions are actual scaled cabin metres, independent of the world render origin.
    root.updateWorldMatrix(true, true);
    for (const mesh of root.children.filter(n => n.isMesh && n.geometry.type === 'BoxGeometry')) {
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix), dimensions = bounds.getSize(new Vector3()).multiplyScalar(size);
      const center = bounds.getCenter(new Vector3()).multiplyScalar(size);
      this.fixed.push(this.scene.add({ id: 'equipment', fixed: true, p: center,
        boxes: [{ half: dimensions.multiplyScalar(.5).toArray(), zone: 'interior' }] }));
    }
    this.fixed.push(this.scene.add({ id: 'front-wall', fixed: true, p: new Vector3(0, .88, 1.33).multiplyScalar(size),
      boxes: [{ half: [1.34 * size, .88 * size, .035 * size], zone: 'window-wall' }] }));
  }
  addLoose(mesh, position, velocity = new Vector3()) {
    this.root.add(mesh); mesh.position.copy(position);
    const half = rigidConfig.interior.looseHalfM * this.size;
    const body = this.scene.add({ id: 'loose', p: position.clone().multiplyScalar(this.size), v: velocity,
      mass: rigidConfig.interior.looseMassKg, boxes: [{ half: [half, half, half] }] });
    body.mesh = mesh; body.initial = position.clone(); this.loose.push(body); return body;
  }
  advance(dt, { proper = zero, omega = zero, alpha = zero, deltaV = zero } = {}) {
    // Collision delta-v is consumed once; never also differentiated into proper acceleration.
    for (const b of this.loose) if (deltaV.lengthSq()) this.scene.impulse(b, deltaV.clone().multiplyScalar(-b.mass));
    this.scene.advance(dt, () => {
      for (const b of this.loose) {
        const velocity = fromPx(b.actor.getLinearVelocity());
        const acceleration = proper.clone().negate()
          .sub(new Vector3().crossVectors(alpha, b.p))
          .sub(new Vector3().crossVectors(omega, new Vector3().crossVectors(omega, b.p)))
          .sub(new Vector3().crossVectors(omega, velocity).multiplyScalar(2));
        this.scene.force(b, acceleration);
      }
    });
    for (const b of this.loose) {
      const pose = this.scene.render(b); b.mesh.position.copy(pose.p).divideScalar(this.size); b.mesh.quaternion.copy(pose.q);
    }
  }
  coast(dt) {
    // Exact force-free drift between possible contacts. A swept bounding sphere
    // conservatively brackets every rotating cube; PhysX still resolves contacts
    // and CCD at 1/120 s. No object is frozen or snapped to a stowed position.
    const radius=rigidConfig.interior.looseHalfM*this.size*Math.sqrt(3)+.006;
    const hitTime=(p,v,half,limit)=>{
      let enter=0,exit=limit;
      for(const axis of ['x','y','z']){
        if(Math.abs(v[axis])<1e-12){if(Math.abs(p[axis])>half[axis])return Infinity;continue;}
        const a=(-half[axis]-p[axis])/v[axis],b=(half[axis]-p[axis])/v[axis];
        enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
        if(enter>exit)return Infinity;
      }
      return exit<0?Infinity:Math.max(0,enter);
    };
    while(dt>1e-8){
      let safe=dt;
      const velocities=this.loose.map(b=>fromPx(b.actor.getLinearVelocity()));
      for(const [i,b] of this.loose.entries()){
        const v=velocities[i];
        if(v.lengthSq()>=1e-16||fromPx(b.actor.getAngularVelocity()).lengthSq()>=1e-16)for(const fixed of this.fixed)for(const box of fixed.boxes){
          const center=fixed.p.clone().add(new Vector3(...(box.center??[0,0,0])));
          const half=new Vector3(...box.half).addScalar(radius);
          safe=Math.min(safe,hitTime(b.p.clone().sub(center),v,half,dt));
        }
        for(let j=i+1;j<this.loose.length;j++)safe=Math.min(safe,hitTime(b.p.clone().sub(this.loose[j].p),v.clone().sub(velocities[j]),new Vector3(2*radius,2*radius,2*radius),dt));
      }
      if(safe>.05){
        const jump=safe>=dt?dt:safe-.025;
        for(const [i,b] of this.loose.entries()){
          b.p.addScaledVector(velocities[i],jump);
          const w=fromPx(b.actor.getAngularVelocity()),spin=w.length();
          if(spin>1e-12)b.q.premultiply(new Quaternion().setFromAxisAngle(w.multiplyScalar(1/spin),spin*jump)).normalize();
          b.actor.setGlobalPose(this.scene.pxPose(b.p,b.q));
        }
        this.scene.skipQuietTime(jump);dt-=jump;
      }else{const step=Math.min(.25,dt);this.advance(step);dt-=step;}
    }
    for(const b of this.loose){b.mesh.position.copy(b.p).divideScalar(this.size);b.mesh.quaternion.copy(b.q);}
  }
  push() { for (const b of this.loose) this.scene.impulse(b, new Vector3(.28, .18, rigidConfig.interior.pushMps).multiplyScalar(b.mass)); }
  reset() {
    this.contacts = 0; this.scene.contacts.clear(); this.scene.accumulator = 0;
    for (const b of this.loose) {
      b.p.copy(b.initial).multiplyScalar(this.size); b.q.identity(); b.previousP.copy(b.p); b.previousQ.copy(b.q);
      b.actor.setGlobalPose(this.scene.pxPose(b.p, b.q)); this.scene.setVelocity(b, zero, zero);
      b.mesh.position.copy(b.initial); b.mesh.quaternion.identity();
    }
  }
  snapshot() { return { actors: this.scene.bodies.size, fixed: this.fixed.length, contacts: this.contacts,
    loose: this.loose.map(b => ({ positionM: b.p.toArray(), velocityMps: fromPx(b.actor.getLinearVelocity()).toArray() })) }; }
  dispose() { this.scene.dispose(); }
  serialize() { return this.loose.map(b=>this.scene.saveBody(b)); }
  restore(saved) { saved?.forEach((b,i)=>{if(this.loose[i])this.scene.restoreBody(this.loose[i],b);}); }
}
