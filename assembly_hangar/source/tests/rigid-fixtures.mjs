import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Scene, Vector3 } from 'three';
import { loadPhysX, RigidScene, fromPx } from '../physx-runtime.mjs';
import { canCapture, dockingMetrics, FlightRigidPhysics, InteriorPhysics } from '../flight-rigid.mjs';
import { FlightState } from '../flight-missions.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const box = (size, p = [0,0,0], id = '') => {
  const m = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial()); m.position.set(...p); m.userData.partId = id; return m;
};
export async function runRigidFixtures() {
  const runtime = await loadPhysX(), results = [];
  {
    const state = new FlightState('mars_2020');
    const scene = new Scene(), ship = new Group(), model = new Group();
    scene.add(ship); ship.add(model); model.add(box([2, 3, 2]));
    const physics = new FlightRigidPhysics(runtime, scene, () => {}, () => {});
    physics.syncHost(model, ship, state);
    ship.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), .1);
    physics.syncHost(model, ship, state);
    for (const dt of [.007, .002, .013, .028, .004, .017]) {
      const previousError = physics.host.q.angleTo(physics.command);
      physics.advance(dt);
      check(physics.host.q.angleTo(physics.command) <= previousError + .001, 'Guidance overshot at irregular frame intervals');
    }
    check(physics.host.q.angleTo(physics.command) < .001, 'Guidance did not reach the commanded attitude');
    physics.dispose();
  }
  {
    const events = [], s = new RigidScene(runtime, e => events.push(e));
    s.add({ id:'wall', fixed:true, p:new Vector3(2,0,0), boxes:[{half:[.05,2,2]}] });
    const b = s.add({ id:'fast', boxes:[{half:[.1,.1,.1]}], v:new Vector3(100,0,0) });
    s.advance(.2);
    check(b.p.x < 1.9, 'CCD allowed tunnelling');
    check(events.length === 1 && events[0].impulseNs > 0 && events[0].speedMps > 99, 'Missing actual contact data');
    results.push({scenario:'CCD 100 m/s against 0.1 m wall', position:b.p.toArray(), impulseNs:events[0].impulseNs}); s.dispose();
  }
  {
    const s = new RigidScene(runtime);
    const a = s.add({ id:'A',mass:100,boxes:[{half:[.5,.5,.5]}] });
    const b = s.add({ id:'B',mass:100,p:new Vector3(0,1.15,0),q:new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI),boxes:[{half:[.5,.5,.5]}] });
    const port = {p:new Vector3(0,.5,0),normal:new Vector3(0,1,0)};
    check(canCapture(dockingMetrics(a,port,b,port)), 'Aligned slow ports rejected');
    b.preV.set(0,-8,0); check(!canCapture(dockingMetrics(a,port,b,port)), 'Fast approach captured'); b.preV.set(0,0,0);
    const aligned = b.q.clone(); b.q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.4));
    check(!canCapture(dockingMetrics(a,port,b,port)), 'Oblique approach captured'); b.q.copy(aligned);
    s.lock(a,b,new Vector3(0,.575,0)); s.impulse(a,new Vector3(80,0,0)); s.advance(2);
    check(Math.abs(a.p.distanceTo(b.p)-1.15)<.01, 'Fixed docking joint separated');
    results.push({scenario:'dock speed/angle gates and native fixed joint', separationM:a.p.distanceTo(b.p)}); s.dispose();
  }
  {
    const state = new FlightState('apollo_11'); state.update(90);
    const scene = new Scene(), ship = new Group(), model = new Group(); scene.add(ship); ship.add(model);
    model.add(box([2,8,2],[0,0,0],'apollo_cm'));
    const part = box([1,2,1],[3,0,0],'test-stage'); model.add(part);
    const physics = new FlightRigidPhysics(runtime,scene,()=>{},e=>state.systems.impact(state,e));
    physics.setFrame(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.3));
    physics.syncHost(model,ship,state); physics.angular.set(0,.2,0);
    const before = part.getWorldPosition(new Vector3()); const expected = before.clone().applyQuaternion(physics.frame);
    const relative = new Vector3(1,0,0).applyQuaternion(physics.frame).add(new Vector3().crossVectors(physics.angular,expected));
    physics.release(part,new Vector3(1,0,0),0,18,100);
    check(part.getWorldPosition(new Vector3()).distanceTo(before)<1e-6, 'Separation teleported model');
    check(new Vector3(...physics.separations[0].worldVelocityMps).distanceTo(relative.add(state.launch.velocityMps))<1e-5,'Point velocity failed to include host velocity/spin');
    physics.advance(.2); physics.render(ship);
    check(physics.contactCount===0,'Initial collider overlap caused false contact');
    check(physics.debris[0].p.distanceTo(expected)>.05,'Separated body stayed attached');
    for(let i=0;i<50;i++){const m=box([.1,.1,.1],[20+i,0,0]);scene.add(m);physics.release(m,new Vector3(),0,18,1);}
    check(physics.debris.length===32,'Debris cap failed');
    const cabinRoot=new Group();
    for(let i=0;i<100;i++) cabinRoot.add(box([.2,.2,.2],[10+i*.3,0,0]));
    const cabin=new InteriorPhysics(runtime,cabinRoot);
    cabin.addLoose(box([.13,.13,.13]),new Vector3(0,1,0),new Vector3(.2,.1,.3));
    cabin.addLoose(box([.13,.13,.13]),new Vector3(1,1,0),new Vector3(-.2,.1,.3));
    const start=performance.now(); for(let i=0;i<120;i++){physics.advance(1/120);cabin.advance(1/120);}
    results.push({scenario:'separation, inheritance, overlap suppression, 32-body cap plus cabin', combinedPhysicsMs:performance.now()-start, exteriorActors:physics.exterior.bodies.size, interiorActors:cabin.scene.bodies.size});
    cabin.dispose();
    physics.reset();check(physics.exterior.bodies.size===0&&physics.debris.length===0,'Reset retained native actors');physics.dispose();
  }
  {
    const root=new Group();
    for(const [size,p] of [ [[4,.1,4],[0,-.05,0]], [[4,.1,4],[0,2.05,0]], [[.1,2,4],[-2.05,1,0]], [[.1,2,4],[2.05,1,0]], [[4,2,.1],[0,1,-2.05]] ]) root.add(box(size,p));
    const interior = new InteriorPhysics(runtime,root);
    const b=interior.addLoose(box([.13,.13,.13]),new Vector3(0,1,0),new Vector3(.5,0,0));
    interior.advance(.5);check(Math.abs(b.p.x-.25)<.002,'Zero-g drift lost momentum');
    interior.advance(.5,{proper:new Vector3(2,0,0)});check(fromPx(b.actor.getLinearVelocity()).x<-.45,'Cabin acceleration did not move free object');
    interior.scene.setVelocity(b,new Vector3(5,0,0));interior.advance(1);
    check(interior.contacts>0&&b.p.x<2,'Cabin wall failed');
    interior.reset();check(b.p.distanceTo(new Vector3(0,1,0))<1e-6&&fromPx(b.actor.getLinearVelocity()).length()===0,'Cabin reset retained motion');
    interior.advance(.1,{deltaV:new Vector3(1,0,0)}); interior.advance(.1);
    check(Math.abs(fromPx(b.actor.getLinearVelocity()).x+1)<.005,'Collision delta-v applied twice');
    results.push({scenario:'interior drift, acceleration, wall, single impulse, reset',fixed:interior.fixed.length});interior.dispose();
  }
  {
    const root=new Group();
    root.add(box([.1,4,4],[2,1,0]));
    const interior=new InteriorPhysics(runtime,root);
    const b=interior.addLoose(box([.13,.13,.13]),new Vector3(0,1,0),new Vector3(.2,0,0));
    interior.coast(4);
    check(Math.abs(b.p.x-.8)<1e-6,'Warp coast changed zero-g momentum');
    check(interior.scene.steps===0,'Empty free drift needlessly ran native substeps');
    interior.coast(20);
    check(interior.contacts>0&&b.p.x<1.95,'Warp coast skipped a cabin wall contact');
    check(Math.abs(interior.scene.time-24)<.009,'Warp interior clock diverged');
    results.push({scenario:'analytic warp drift with native CCD wall contact',positionM:b.p.toArray(),nativeSteps:interior.scene.steps,contacts:interior.contacts});
    interior.dispose();
  }
  return {version:runtime.version,results};
}
