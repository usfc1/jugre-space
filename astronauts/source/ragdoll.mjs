import {
  Body, Box, ConeTwistConstraint, ConvexPolyhedron, HingeConstraint, LockConstraint,
  Plane, Quaternion as PhysicsQuaternion, RotationalEquation, SAPBroadphase, Vec3, World,
} from 'cannon-es';
import { Quaternion, SphereGeometry, Vector3 } from 'three';

const terrain = 1;
const crew = 2;
const debris = 4;
const radians = Math.PI / 180;

class LimitedHinge extends HingeConstraint {
  constructor(a, b, options, [min, max]) {
    super(a, b, options);
    // Compare the child tangent with the midpoint of the allowed arc on the parent.
    const middle = (min + max) * radians / 2;
    this.referenceA = new Vec3(0, -Math.cos(middle), -Math.sin(middle));
    this.referenceB = new Vec3(0, -1, 0);
    this.stop = new RotationalEquation(a, b);
    this.stop.maxAngle = (max - min) * radians / 2;
    this.stop.maxForce = 0;
    this.equations.push(this.stop);
  }

  update() {
    super.update();
    this.bodyA.vectorToWorldFrame(this.referenceA, this.stop.axisA);
    this.bodyB.vectorToWorldFrame(this.referenceB, this.stop.axisB);
  }
}

function ellipsoid(size) {
  const geometry = new SphereGeometry(1, 10, 6);
  const attribute = geometry.attributes.position;
  const vertices = [];
  const welded = new Map();
  const remap = [];
  for (let i = 0; i < attribute.count; i++) {
    const p = [attribute.getX(i), attribute.getY(i), attribute.getZ(i)];
    const key = p.map(value => Math.round(value * 10000)).join('/');
    if (!welded.has(key)) {
      welded.set(key, vertices.length);
      vertices.push(new Vec3(...p.map((value, axis) => value * size[axis] / 2)));
    }
    remap.push(welded.get(key));
  }
  const faces = [];
  for (let i = 0; i < geometry.index.count; i += 3) {
    faces.push([0, 1, 2].map(j => remap[geometry.index.getX(i + j)]));
  }
  geometry.dispose();
  return new ConvexPolyhedron({ vertices, faces });
}

export function startRagdoll(scene, root, config, floorY = 0) {
  const world = new World({ gravity: new Vec3(0, -9.81, 0), allowSleep: true });
  world.broadphase = new SAPBroadphase(world);
  world.solver.iterations = 24;
  world.defaultContactMaterial.friction = 0.46;
  world.defaultContactMaterial.restitution = 0.16;
  const floor = new Body({ mass: 0, shape: new Plane(), collisionFilterGroup: terrain });
  floor.position.y = floorY;
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);

  const bodies = new Map();
  const joints = new Map();
  const position = new Vector3();
  const rotation = new Quaternion();
  root.updateWorldMatrix(true, true);
  for (const [name, spec] of Object.entries(config.bodies)) {
    const object = root.getObjectByName(name);
    const center = new Vector3(...spec.collider.center);
    const shape = spec.collider.kind === 'ellipsoid' ? ellipsoid(spec.collider.size)
      : new Box(new Vec3(...spec.collider.size.map(value => value / 2)));
    object.getWorldQuaternion(rotation);
    object.getWorldPosition(position).add(center.clone().applyQuaternion(rotation));
    const body = new Body({
      mass: spec.mass, shape, linearDamping: 0.12, angularDamping: 0.22,
      position: new Vec3(...position), quaternion: new PhysicsQuaternion(...rotation),
      collisionFilterGroup: crew, collisionFilterMask: terrain,
      sleepSpeedLimit: 0.19,
    });
    world.addBody(body);
    bodies.set(name, { object, center, body });
  }

  for (const link of config.links) {
    const a = bodies.get(link.a).body;
    const child = bodies.get(link.b);
    const b = child.body;
    const pivot = new Vec3(...child.object.getWorldPosition(position));
    const options = { collideConnected: false };
    let constraint;
    if (link.type === 'fixed') {
      constraint = new LockConstraint(a, b, options);
      constraint.collideConnected = false;
    } else {
      const axis = new Vec3(...link.axis);
      Object.assign(options, {
        pivotA: a.pointToLocalFrame(pivot), pivotB: b.pointToLocalFrame(pivot),
        axisA: axis, axisB: b.vectorToLocalFrame(a.vectorToWorldFrame(axis)),
      });
      constraint = link.type === 'hinge' ? new LimitedHinge(a, b, options, link.limitsDeg)
        : new ConeTwistConstraint(a, b, {
          ...options, angle: link.swingDeg * radians, twistAngle: link.twistDeg * radians,
        });
    }
    world.addConstraint(constraint);
    joints.set(link.b, { link, constraint });
  }

  // Keep local pivots while removing visual transform inheritance during simulation.
  for (const { object } of bodies.values()) scene.attach(object);

  function kick(name, velocity, spin) {
    const { body } = bodies.get(name);
    body.wakeUp();
    body.velocity.vadd(new Vec3(...velocity), body.velocity);
    body.angularVelocity.vadd(new Vec3(...spin), body.angularVelocity);
  }

  function detach(name, velocity, spin) {
    if (!joints.has(name)) return false;
    world.removeConstraint(joints.get(name).constraint);
    joints.delete(name);
    const branch = [name];
    for (const parent of branch) {
      const { body } = bodies.get(parent);
      body.collisionFilterGroup = debris;
      body.collisionFilterMask = terrain | debris;
      for (const [child, { link }] of joints) {
        if (link.a === parent) branch.push(child);
      }
      kick(parent, velocity, spin);
    }
    return true;
  }

  return {
    count: bodies.size,
    kick,
    detach,
    step(dt) {
      world.step(1 / 120, dt, 7);
      for (const { body, object, center } of bodies.values()) {
        rotation.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        position.copy(center).applyQuaternion(rotation);
        object.position.set(body.position.x, body.position.y, body.position.z).sub(position);
        object.quaternion.copy(rotation);
      }
    },
    dispose() {
      for (const { object } of bodies.values()) object.removeFromParent();
    },
  };
}
