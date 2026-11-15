import { Quaternion, Vector3 } from 'three';
import { RigidScene, fromPx } from './physx-runtime.mjs';
import { hullBoxes, portFrame, dockingMetrics, canCapture } from './flight-rigid.mjs';
import { rcsCommand, restoreRcs } from './spacecraft-control.mjs';

export class AssemblyRcs {
  constructor(runtime, hostModel, targetModel, emit, saved = null) {
    this.scene = new RigidScene(runtime); this.runtime = runtime; this.emit = emit;
    this.hostModel = hostModel; this.targetModel = targetModel;
    const body = (model, id, mass) => {
      model.updateWorldMatrix(true, true);
      return this.scene.add({ id, mass, p: model.getWorldPosition(new Vector3()), q: model.getWorldQuaternion(new Quaternion()), boxes: hullBoxes(model, model) });
    };
    this.host = body(hostModel, 'columbia', 24000); this.target = body(targetModel, 'eagle', 15000);
    this.portA = portFrame(hostModel); this.portB = portFrame(targetModel); this.rcs = restoreRcs(); this.joint = null;
    this.origin = this.target.p.clone(); this.complete = false; this.mode = 'retreat';
    if (!this.portA || !this.portB) throw new Error('Docking ports not found');
    if (saved) {
      this.scene.restoreBody(this.host, saved.host); this.scene.restoreBody(this.target, saved.target);
      this.origin.fromArray(saved.origin); this.rcs = restoreRcs(saved.rcs); this.complete = saved.complete; this.mode = saved.mode;
      if (saved.captured) this.joint = this.scene.lock(this.host, this.target, dockingMetrics(this.host, this.portA, this.target, this.portB).point);
    }
  }
  advance(dt, axes, control, automatic = false) {
    this.scene.advance(dt, step => {
      let command = axes ?? {};
      if (automatic) {
        const aNormal = this.portA.normal.clone().applyQuaternion(this.host.q), targetNormal = this.portB.normal.clone().applyQuaternion(this.target.q);
        const desired = this.host.q.clone().premultiply(new Quaternion().setFromUnitVectors(aNormal, targetNormal.clone().negate()));
        const delta = desired.multiply(this.host.q.clone().invert()); if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const angular = new Vector3(delta.x, delta.y, delta.z).multiplyScalar(2).sub(fromPx(this.host.actor.getAngularVelocity())).clampLength(0, .025);
        if (this.rcs.fuelKg > 0) this.host.actor.addTorque(this.scene.pxVector(angular), this.runtime.P.PxForceModeEnum.eACCELERATION, true);
        const pb = this.portB.p.clone().applyQuaternion(this.target.q).add(this.target.p);
        const pa = this.portA.p.clone().applyQuaternion(this.host.q).add(this.host.p);
        const m = dockingMetrics(this.host, this.portA, this.target, this.portB);
        if (this.mode === 'retreat' && pa.distanceTo(pb) > 6) this.mode = 'approach';
        const goal = this.joint ? this.origin.clone().addScaledVector(targetNormal, 12)
          : pb.clone().addScaledVector(targetNormal, this.mode === 'retreat' || m.angleRad > .08 ? 7 : .08);
        const desiredVelocity = goal.sub(pa).multiplyScalar(.12).clampLength(0, this.joint ? .3 : .15);
        const acceleration = desiredVelocity.sub(fromPx(this.host.actor.getLinearVelocity())).multiplyScalar(.5).clampLength(0, .025);
        const local = acceleration.applyQuaternion(this.host.q.clone().invert()).multiplyScalar(this.host.mass / 220);
        command = { lateral: local.x, vertical: local.y, longitudinal: -local.z };
      }
      const c = rcsCommand(this.rcs, command, control, this.host.mass, step, fromPx(this.host.actor.getAngularVelocity()).applyQuaternion(this.host.q.clone().invert()));
      this.scene.force(this.host, c.acceleration.applyQuaternion(this.host.q));
      if (!automatic) this.host.actor.addTorque(this.scene.pxVector(c.angular.applyQuaternion(this.host.q)), this.runtime.P.PxForceModeEnum.eACCELERATION, true);
    }, () => {
      for (const b of [this.host, this.target]) { fromPx(b.actor.getLinearVelocity(), b.preV); fromPx(b.actor.getAngularVelocity(), b.preW); }
      this.metrics = dockingMetrics(this.host, this.portA, this.target, this.portB);
      if (!this.joint && canCapture(this.metrics, 'standard', true)) { this.joint = this.scene.lock(this.host, this.target, this.metrics.point); this.emit('dock', { target: 'eagle', fixedJoint: true }); }
      if (this.joint && this.target.p.distanceTo(this.origin) > 3 && !this.complete) { this.complete = true; this.emit('eagleExtracted', { distanceM: this.target.p.distanceTo(this.origin), fixedJoint: true, rcsKg: this.rcs.usedKg }); }
    });
  }
  render() {
    for (const [body, model] of [[this.host, this.hostModel], [this.target, this.targetModel]]) {
      const { p, q } = this.scene.render(body); model.parent.updateWorldMatrix(true, false);
      model.position.copy(model.parent.worldToLocal(p)); model.quaternion.copy(model.parent.getWorldQuaternion(new Quaternion()).invert().multiply(q));
    }
  }
  serialize() { return { version: 1, host: this.scene.saveBody(this.host), target: this.scene.saveBody(this.target), captured: Boolean(this.joint),
    origin: this.origin.toArray(), complete: this.complete, mode: this.mode, rcs: this.rcs }; }
  dispose() { this.scene.dispose(); }
}
