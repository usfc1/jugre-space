import PhysX from 'physx-js-webidl';
import { Quaternion, Vector3 } from 'three';
import { rigidConfig } from './rigid-config.mjs';

let backend;
export async function loadPhysX() {
  if (!backend) backend = (async () => {
    const encoded = document.querySelector('#physx-wasm')?.textContent.trim();
    if (!encoded) throw new Error('PhysX WASM is absent from this build. Run npm run build.');
    const binary = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const P = await PhysX({ wasmBinary: binary, locateFile: () => 'embedded-physx.wasm' });
    const allocator = new P.PxDefaultAllocator(), errors = new P.PxDefaultErrorCallback();
    const foundation = P.CreateFoundation(P.PHYSICS_VERSION, allocator, errors);
    const scale = new P.PxTolerancesScale();
    const physics = P.CreatePhysics(P.PHYSICS_VERSION, foundation, scale);
    if (!physics.ptr) throw new Error('PxPhysics initialization failed');
    return { P, physics, foundation, scale, allocator, errors, version: P.PHYSICS_VERSION };
  })();
  return backend;
}

export const fromPx = (v, out = new Vector3()) => out.set(v.x, v.y, v.z);
const fromPose = pose => ({ p: fromPx(pose.p), q: new Quaternion(pose.q.x, pose.q.y, pose.q.z, pose.q.w) });

// Each scene owns native actors, shapes, joints and callbacks. Borrowed getter wrappers
// belong to their owner and must never be destroyed as independently allocated values.
export class RigidScene {
  constructor(runtime, onContact = () => {}) {
    Object.assign(this, runtime);
    const { P, physics, scale } = this;
    this.bodies = new Map(); this.shapes = new Map(); this.joints = new Set();
    this.events = []; this.time = 0; this.accumulator = 0; this.steps = 0; this.stepMs = 0;
    this.onContact = onContact;
    this.vec = new P.PxVec3(0, 0, 0);
    this.pose = new P.PxTransform(P.PxIDENTITYEnum.PxIdentity);
    this.rotation = new P.PxQuat(0, 0, 0, 1);
    this.contactBuffer = new P.PxArray_PxContactPairPoint(16);
    this.callback = new P.PxSimulationEventCallbackImpl();
    for (const key of ['onConstraintBreak', 'onWake', 'onSleep', 'onTrigger']) this.callback[key] = () => {};
    this.callback.onContact = (headerPtr, pairsPtr, count) => {
      const header = P.wrapPointer(headerPtr, P.PxContactPairHeader);
      const a = this.bodies.get(header.get_actors(0).ptr), b = this.bodies.get(header.get_actors(1).ptr);
      if (!a || !b) return;
      const pairs = P.wrapPointer(pairsPtr, P.PxContactPair);
      for (let i = 0; i < count; i++) {
        const pair = P.NativeArrayHelpers.prototype.getContactPairAt(pairs, i);
        const key = [a.actor.ptr, b.actor.ptr].sort((x, y) => x - y).join(':');
        const shapeKey = [pair.get_shapes(0).ptr, pair.get_shapes(1).ptr].sort((x,y)=>x-y).join(':');
        const activeShapes = this.contacts.get(key) ?? new Set();
        if (pair.events.isSet(P.PxPairFlagEnum.eNOTIFY_TOUCH_LOST)) {
          activeShapes.delete(shapeKey); if (!activeShapes.size) this.contacts.delete(key); continue;
        }
        const alreadyTouching = activeShapes.size > 0;
        activeShapes.add(shapeKey); this.contacts.set(key, activeShapes);
        if (alreadyTouching) continue;
        const n = pair.extractContacts(this.contactBuffer.begin(), 16);
        let impulseNs = 0, point = null;
        for (let j = 0; j < n; j++) {
          const contact = this.contactBuffer.get(j);
          impulseNs += fromPx(contact.impulse).length(); point ??= fromPx(contact.position);
        }
        const velocityAt = (body) => body.preV.clone().add(new Vector3().crossVectors(body.preW, (point ?? body.p).clone().sub(body.p)));
        this.events.push({ a, b, speedMps: velocityAt(a).sub(velocityAt(b)).length(), impulseNs,
          point, zoneA: this.shapes.get(pair.get_shapes(0).ptr), zoneB: this.shapes.get(pair.get_shapes(1).ptr), time: this.time });
      }
    };
    this.contacts = new Map();
    this.filter = new P.PassThroughFilterShaderImpl();
    this.filter.filterShader = (_a, groupA, maskA, familyA, _w3, _b, groupB, maskB, familyB) => {
      if (!(groupA & maskB) || !(groupB & maskA) || (familyA && familyA === familyB)) return P.PxFilterFlagEnum.eSUPPRESS;
      this.filter.outputPairFlags = P.PxPairFlagEnum.eCONTACT_DEFAULT | P.PxPairFlagEnum.eDETECT_CCD_CONTACT
        | P.PxPairFlagEnum.eNOTIFY_TOUCH_FOUND | P.PxPairFlagEnum.eNOTIFY_TOUCH_LOST | P.PxPairFlagEnum.eNOTIFY_CONTACT_POINTS;
      return P.PxFilterFlagEnum.eDEFAULT;
    };
    this.dispatcher = P.DefaultCpuDispatcherCreate(0);
    const desc = new P.PxSceneDesc(scale);
    desc.gravity = this.vec; desc.cpuDispatcher = this.dispatcher; desc.simulationEventCallback = this.callback;
    desc.flags.raise(P.PxSceneFlagEnum.eENABLE_CCD);
    P.setupPassThroughFilterShader(desc, this.filter);
    this.scene = physics.createScene(desc); P.destroy(desc);
    const m = rigidConfig.material;
    this.material = physics.createMaterial(m.staticFriction, m.dynamicFriction, m.restitution);
    this.shapeFlags = new P.PxShapeFlags(P.PxShapeFlagEnum.eSIMULATION_SHAPE | P.PxShapeFlagEnum.eSCENE_QUERY_SHAPE);
  }
  pxVector(v) { this.vec.x = v.x; this.vec.y = v.y; this.vec.z = v.z; return this.vec; }
  pxPose(p, q = new Quaternion()) {
    this.pose.p = this.pxVector(p);
    this.rotation.x = q.x; this.rotation.y = q.y; this.rotation.z = q.z; this.rotation.w = q.w;
    this.pose.q = this.rotation; return this.pose;
  }
  add({ id, p = new Vector3(), q = new Quaternion(), v = new Vector3(), w = new Vector3(),
    boxes, mass = 1, fixed = false, kinematic = false, family = 0, group = 1, mask = 0xffff, mesh = null }) {
    const { P } = this;
    const actor = fixed ? this.physics.createRigidStatic(this.pxPose(p, q)) : this.physics.createRigidDynamic(this.pxPose(p, q));
    const body = { id, actor, boxes, p: p.clone(), q: q.clone(), previousP: p.clone(), previousQ: q.clone(),
      preV: v.clone(), preW: w.clone(), fixed, kinematic, mass, mesh, shapeRefs: [], family, group, mask };
    for (const box of boxes) {
      const geometry = new P.PxBoxGeometry(...box.half.map(x => Math.max(.015, x)));
      const shape = this.physics.createShape(geometry, this.material, true, this.shapeFlags);
      shape.setLocalPose(this.pxPose(new Vector3(...(box.center ?? [0, 0, 0])), new Quaternion(...(box.rotation ?? [0,0,0,1]))));
      shape.setContactOffset(.005); shape.setRestOffset(0);
      const data = new P.PxFilterData(group, mask, family, 0); shape.setSimulationFilterData(data); P.destroy(data);
      actor.attachShape(shape); this.shapes.set(shape.ptr, box.zone ?? id); body.shapeRefs.push(shape);
      shape.release(); P.destroy(geometry);
    }
    if (!fixed) {
      P.PxRigidBodyExt.prototype.setMassAndUpdateInertia(actor, mass, this.pxVector(new Vector3()));
      actor.setLinearDamping(0); actor.setAngularDamping(0); actor.setSleepThreshold(.00001);
      actor.setRigidBodyFlag(P.PxRigidBodyFlagEnum.eKINEMATIC, kinematic);
      if (!kinematic) actor.setRigidBodyFlag(P.PxRigidBodyFlagEnum.eENABLE_CCD, true);
      actor.setLinearVelocity(this.pxVector(v)); actor.setAngularVelocity(this.pxVector(w));
      actor.setSolverIterationCounts(8, 2);
    }
    this.scene.addActor(actor); this.bodies.set(actor.ptr, body); return body;
  }
  setVelocity(body, velocity, angular = null) {
    body.actor.setLinearVelocity(this.pxVector(velocity));
    if (angular) body.actor.setAngularVelocity(this.pxVector(angular));
  }
  setFamily(body, family) {
    const data = new this.P.PxFilterData(body.group, body.mask, family, 0);
    for (const shape of body.shapeRefs) shape.setSimulationFilterData(data);
    this.P.destroy(data); body.family = family; this.scene.resetFiltering(body.actor);
  }
  target(body, p, q) { body.actor.setKinematicTarget(this.pxPose(p, q)); }
  force(body, acceleration) { if(acceleration.lengthSq()>1e-16)body.actor.addForce(this.pxVector(acceleration), this.P.PxForceModeEnum.eACCELERATION, true); }
  impulse(body, impulse) { body.actor.addForce(this.pxVector(impulse), this.P.PxForceModeEnum.eIMPULSE, true); }
  lock(a, b, worldPoint) {
    const local = body => worldPoint.clone().sub(body.p).applyQuaternion(body.q.clone().invert());
    const fa = new this.P.PxTransform(this.P.PxIDENTITYEnum.PxIdentity);
    fa.p = this.pxVector(local(a));
    const fb = new this.P.PxTransform(this.P.PxIDENTITYEnum.PxIdentity);
    fb.p = this.pxVector(local(b));
    // Frames must share a world orientation, including for opposed docking ports.
    const qb = a.q.clone().invert().multiply(b.q).invert();
    this.rotation.x = qb.x; this.rotation.y = qb.y; this.rotation.z = qb.z; this.rotation.w = qb.w; fb.q = this.rotation;
    const joint = this.P.FixedJointCreate(this.physics, a.actor, fa, b.actor, fb);
    joint.setBreakForce(rigidConfig.docking.breakForceN, rigidConfig.docking.breakForceN);
    this.P.destroy(fa); this.P.destroy(fb); this.joints.add(joint); return joint;
  }
  advance(dt, beforeStep = () => {}, afterStep = () => {}) {
    this.accumulator += Math.max(0, dt);
    const start = performance.now(); let count = 0;
    while (this.accumulator + 1e-10 >= rigidConfig.step) {
      beforeStep(rigidConfig.step);
      for (const b of this.bodies.values()) {
        b.previousP.copy(b.p); b.previousQ.copy(b.q);
        if (!b.fixed) { fromPx(b.actor.getLinearVelocity(), b.preV); fromPx(b.actor.getAngularVelocity(), b.preW); }
      }
      this.scene.simulate(rigidConfig.step); this.scene.fetchResults(true);
      this.time += rigidConfig.step; this.steps++; count++;
      for (const b of this.bodies.values()) {
        const pose = fromPose(b.actor.getGlobalPose()); b.p.copy(pose.p); b.q.copy(pose.q);
      }
      for (const event of this.events.splice(0)) this.onContact(event);
      afterStep(rigidConfig.step);
      this.accumulator -= rigidConfig.step;
    }
    if (count) this.stepMs = (performance.now() - start) / count;
  }
  render(body, p = new Vector3(), q = new Quaternion()) {
    const alpha = Math.max(0, Math.min(1, this.accumulator / rigidConfig.step));
    p.lerpVectors(body.previousP, body.p, alpha); q.slerpQuaternions(body.previousQ, body.q, alpha);
    return { p, q };
  }
  skipQuietTime(dt) {
    this.time+=dt;this.accumulator=0;
    for(const b of this.bodies.values()){b.previousP.copy(b.p);b.previousQ.copy(b.q);}
  }
  saveBody(b) {
    return { id:b.id, p:b.p.toArray(), q:b.q.toArray(), v:b.fixed ? [0,0,0] : fromPx(b.actor.getLinearVelocity()).toArray(),
      w:b.fixed ? [0,0,0] : fromPx(b.actor.getAngularVelocity()).toArray(), boxes:b.boxes, mass:b.mass, fixed:b.fixed };
  }
  restoreBody(b, saved) {
    for (const [key,length] of [['p',3],['q',4],['v',3],['w',3]]) {
      if (!Array.isArray(saved[key]) || saved[key].length!==length || !saved[key].every(Number.isFinite)) throw new Error('Invalid PhysX state');
    }
    b.p.fromArray(saved.p); b.q.fromArray(saved.q).normalize(); b.previousP.copy(b.p); b.previousQ.copy(b.q);
    b.actor.setGlobalPose(this.pxPose(b.p,b.q));
    if (!b.fixed) this.setVelocity(b,new Vector3(...saved.v),new Vector3(...saved.w));
  }
  remove(body) {
    if (!this.bodies.delete(body.actor.ptr)) return;
    const ptr = body.actor.ptr;
    for (const key of this.contacts.keys()) if (key.split(':').includes(String(ptr))) this.contacts.delete(key);
    for (const shape of body.shapeRefs) this.shapes.delete(shape.ptr);
    body.actor.release(); body.mesh?.removeFromParent(); body.disposeVisual?.();
  }
  dispose() {
    for (const joint of this.joints) joint.release(); this.joints.clear();
    for (const body of [...this.bodies.values()]) this.remove(body);
    this.scene.release(); this.material.release(); this.P.destroy(this.dispatcher);
    for (const native of [this.filter, this.callback, this.vec, this.pose, this.rotation, this.contactBuffer, this.shapeFlags]) this.P.destroy(native);
    this.contacts.clear(); this.events.length = 0;
  }
}
