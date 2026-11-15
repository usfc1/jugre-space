import { Quaternion, Vector3 } from 'three';
import { fromPx } from './physx-runtime.mjs';
import { surfaceConfig } from './surface-expedition.mjs';

// Six-wheel educational chassis using the SDK's Vehicle2 DirectDrive pipeline.
// The visual rocker-bogie remains an approximation of the physical suspension.
export class RoverVehicle {
  constructor(scene, actor, body) {
    const { P, physics, scale } = scene; this.scene = scene; this.actor = actor;
    const c = surfaceConfig.rover[actor.id], gravity = body === 'earth' ? 9.81 : 3.71;
    const wheelCount = this.wheelCount = c.wheels ?? 6;
    P.PxVehicleTopLevelFunctions.prototype.InitVehicleExtension(scene.foundation);
    const vehicle = this.vehicle = new P.DirectDriveVehicle(), b = vehicle.baseParams;
    const axle = b.axleDescription; axle.setToDefault(); axle.nbAxles = wheelCount / 2; axle.nbWheels = wheelCount;
    for (let i = 0; i < axle.nbAxles; i++) { axle.set_nbWheelsPerAxle(i, 2); axle.set_axleToWheelIds(i, i * 2); }
    for (let i = 0; i < wheelCount; i++) axle.set_wheelIdsInAxleOrder(i, i);
    b.frame.lngAxis = P.PxVehicleAxesEnum.ePosZ; b.frame.latAxis = P.PxVehicleAxesEnum.ePosX; b.frame.vrtAxis = P.PxVehicleAxesEnum.ePosY;
    b.scale.scale = 1; b.rigidBodyParams.mass = c.massKg;
    b.rigidBodyParams.moi = scene.pxVector(new Vector3(c.massKg * .7, c.massKg, c.massKg * .7));
    b.nbAntiRollForceParams = 0;
    for (let j = 0; j < 2; j++) { const ack = b.get_ackermannParams(j); ack.set_wheelIds(0, 0); ack.set_wheelIds(1, 1); ack.wheelBase = 2; ack.trackWidth = 1.6; ack.strength = 0; }
    b.suspensionStateCalculationParams.suspensionJounceCalculationType = P.PxVehicleSuspensionJounceCalculationTypeEnum.eRAYCAST;
    b.suspensionStateCalculationParams.limitSuspensionExpansionVelocity = false;
    b.steerResponseParams.maxResponse = .55; b.steerResponseParams.nonlinearResponse.clear();
    const response = vehicle.directDriveParams.directDriveThrottleResponseParams; response.maxResponse = 30; response.nonlinearResponse.clear();
    for (let i = 0; i < wheelCount; i++) {
      response.set_wheelResponseMultipliers(i, 1); b.steerResponseParams.set_wheelResponseMultipliers(i, i < 2 ? 1 : i >= wheelCount - 2 ? -1 : 0);
      for (let j = 0; j < 2; j++) { const brake = b.get_brakeResponseParams(j); brake.maxResponse = 2000; brake.nonlinearResponse.clear(); brake.set_wheelResponseMultipliers(i, 1); }
      const wheel = b.get_wheelParams(i); wheel.radius = .25; wheel.halfWidth = .11; wheel.mass = 8; wheel.moi = .25; wheel.dampingRate = .1;
      const suspension = b.get_suspensionParams(i);
      const point = new Vector3(i % 2 ? .8 : -.8, -.1, 1 - 2 * Math.floor(i / 2) / (wheelCount / 2 - 1));
      suspension.suspensionAttachment = scene.pxPose(point); suspension.wheelAttachment = scene.pxPose(new Vector3());
      suspension.suspensionTravelDir = scene.pxVector(new Vector3(0, -1, 0)); suspension.suspensionTravelDist = .35;
      const force = b.get_suspensionForceParams(i); force.sprungMass = c.massKg / wheelCount; force.stiffness = c.massKg * gravity * 3; force.damping = c.massKg * 1.4;
      const compliance = b.get_suspensionComplianceParams(i);
      compliance.wheelToeAngle.clear(); compliance.wheelCamberAngle.clear(); compliance.suspForceAppPoint.clear(); compliance.tireForceAppPoint.clear();
      compliance.wheelToeAngle.addPair(0, 0); compliance.wheelCamberAngle.addPair(0, 0);
      compliance.suspForceAppPoint.addPair(0, scene.pxVector(new Vector3())); compliance.tireForceAppPoint.addPair(0, scene.pxVector(new Vector3()));
      const tire = b.get_tireForceParams(i); tire.latStiffX = 2; tire.latStiffY = 1500; tire.longStiff = 1500; tire.camberStiff = 0; tire.restLoad = c.massKg * gravity / wheelCount;
      for (const [j, x, y] of [[0, 0, 1], [1, .1, 1], [2, 1, 1]]) { P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, j, 0, x); P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, j, 1, y); }
      for (const [j, x, y] of [[0, 0, 0], [1, 3, 3]]) { P.PxVehicleTireForceParamsExt.prototype.setLoadFilter(tire, j, 0, x); P.PxVehicleTireForceParamsExt.prototype.setLoadFilter(tire, j, 1, y); }
    }
    if (!b.isValid()) throw new Error('Invalid Vehicle2 chassis parameters');
    const query = new P.PxQueryFilterData(), friction = new P.PxVehiclePhysXMaterialFriction();
    const road = new P.PxFilterData(1, 0, 0, 0); query.data = road; P.destroy(road);
    const queryFlags = new P.PxQueryFlags(P.PxQueryFlagEnum.eSTATIC); query.flags = queryFlags; P.destroy(queryFlags);
    friction.material = scene.material; friction.friction = .8;
    const geometry = new P.PxBoxGeometry(.7, .2, 1.1), local = new P.PxTransform(P.PxIDENTITYEnum.PxIdentity);
    vehicle.physXParams.create(axle, query, null, friction, 1, .8, local, geometry, local, P.PxVehiclePhysXRoadGeometryQueryTypeEnum.eRAYCAST);
    vehicle.physXParams.physxActorShapeFlags = scene.shapeFlags;
    const filter = new P.PxFilterData(1, 0xffff, 2, 0); vehicle.physXParams.physxActorSimulationFilterData = filter; P.destroy(filter);
    const ownQuery = new P.PxFilterData(2, 0, 0, 0); vehicle.physXParams.physxActorQueryFilterData = ownQuery;
    vehicle.physXParams.physxActorWheelQueryFilterData = ownQuery; P.destroy(ownQuery);
    const cooking = new P.PxCookingParams(scale);
    if (!vehicle.initialize(physics, cooking, scene.material, true)) throw new Error('Could not create Vehicle2');
    vehicle.baseState.setToDefault(); vehicle.directDriveState.setToDefault(); vehicle.commandState.setToDefault(); vehicle.transmissionCommandState.setToDefault();
    this.body = P.castObject(vehicle.physXState.physxActor.rigidBody, P.PxRigidDynamic);
    this.body.setGlobalPose(scene.pxPose(actor.p.clone().add(new Vector3(0, .6, 0)), actor.nativeQ ? new Quaternion(...actor.nativeQ) : new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), actor.yaw)));
    this.body.setLinearVelocity(scene.pxVector(actor.v)); scene.scene.addActor(this.body);
    this.body.setAngularDamping(3); this.body.setLinearDamping(.2);
    if (actor.nativeW) this.body.setAngularVelocity(scene.pxVector(new Vector3(...actor.nativeW)));
    this.headingTarget = actor.headingTarget ?? actor.yaw;
    if (actor.nativeWheels?.length === wheelCount) for (let i = 0; i < wheelCount; i++) {
      const saved = actor.nativeWheels[i], wheel = vehicle.baseState.get_wheelRigidBody1dStates(i), suspension = vehicle.baseState.get_suspensionStates(i);
      wheel.rotationSpeed = saved.rotationSpeed; wheel.rotationAngle = saved.rotationAngle;
      suspension.jounce = saved.jounce; suspension.jounceSpeed = saved.jounceSpeed; suspension.separation = saved.separation;
    }
    this.context = new P.PxVehiclePhysXSimulationContext(); this.context.setToDefault();
    this.context.gravity = scene.pxVector(new Vector3(0, -gravity, 0)); this.context.physxScene = scene.scene;
    this.context.frame = b.frame; this.context.scale = b.scale; this.context.physxActorUpdateMode = P.PxVehiclePhysXActorUpdateModeEnum.eAPPLY_ACCELERATION;
    this.gravity = gravity;
    for (const value of [query, friction, geometry, local, cooking]) P.destroy(value);
  }
  beforeStep(dt) {
    const a = this.actor, { P } = this.scene, c = this.vehicle.commandState;
    const speed = a.driveCommand ?? 0;
    const measuredSpeed = fromPx(this.body.getLinearVelocity()).length(), max = surfaceConfig.rover[a.id].maxMps * (1 - a.slip);
    c.throttle = a.energyJ > 0 && a.status !== 'failed' ? Math.abs(speed) * Math.max(0, Math.min(1, (max - measuredSpeed) * 3)) : 0;
    c.steer = a.steerCommand ?? 0; c.nbBrakes = 1; c.set_brakes(0, a.braking || !speed || measuredSpeed > max ? 1 : 0);
    this.vehicle.transmissionCommandState.gear = speed < 0 ? P.PxVehicleDirectDriveTransmissionCommandStateEnum.eREVERSE : P.PxVehicleDirectDriveTransmissionCommandStateEnum.eFORWARD;
    // Scene gravity is zero because lunar characters integrate it independently.
    if (a.spinCommand) this.body.addTorque(this.scene.pxVector(new Vector3(0, a.spinCommand * .2, 0)), P.PxForceModeEnum.eACCELERATION, true);
    this.body.setLinearDamping(measuredSpeed > max ? 5 : .2);
    this.vehicle.step(dt, this.context);
  }
  afterStep() {
    const a = this.actor, pose = this.body.getGlobalPose(); a.p.copy(fromPx(pose.p)); a.p.y -= .6;
    a.v.copy(fromPx(this.body.getLinearVelocity()));
    const q = new Quaternion(pose.q.x, pose.q.y, pose.q.z, pose.q.w), up = new Vector3(0, 1, 0).applyQuaternion(q);
    a.nativeQ = q.toArray(); a.nativeW = fromPx(this.body.getAngularVelocity()).toArray();
    a.headingTarget = this.headingTarget;
    a.nativeWheels = Array.from({ length: this.wheelCount }, (_, i) => {
      const wheel = this.vehicle.baseState.get_wheelRigidBody1dStates(i), s = this.vehicle.baseState.get_suspensionStates(i);
      return { rotationSpeed: wheel.rotationSpeed, rotationAngle: wheel.rotationAngle, jounce: s.jounce, jounceSpeed: s.jounceSpeed, separation: s.separation };
    });
    const forward = new Vector3(0, 0, 1).applyQuaternion(q); a.yaw = Math.atan2(forward.x, forward.z); a.tilt = up.angleTo(new Vector3(0, 1, 0));
    if (a.tilt > .8) a.status = 'failed';
  }
  dispose() { this.scene.scene.removeActor(this.body); this.vehicle.destroyState(); this.scene.P.destroy(this.context); this.scene.P.destroy(this.vehicle); }
}
