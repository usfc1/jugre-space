import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Scene, Vector3 } from 'three';
import { FlightState } from '../flight-missions.mjs';
import { FlightRigidPhysics } from '../flight-rigid.mjs';
import { loadPhysX } from '../physx-runtime.mjs';

export async function runManualNativeFixtures() {
  const runtime = await loadPhysX(), results = [];
  for (const mission of ['artemis_ii', 'iss_resupply']) {
    const state = new FlightState(mission, 'command', { historicalTraining: true });
    state.phaseIndex = state.mission.phases.findIndex(p => p.kind === (mission === 'artemis_ii' ? 'orbit' : 'stationApproach'));
    const scene = new Scene(), ship = new Group(), model = new Group(), events = [];
    const mesh = new Mesh(new BoxGeometry(.8, .8, .8), new MeshBasicMaterial());
    model.add(mesh); ship.add(model); scene.add(ship);
    const create = () => {
      const physics = new FlightRigidPhysics(runtime, scene, (type, detail) => { events.push({ type, detail }); state.report(type, detail); });
      physics.syncHost(model, ship, state); return physics;
    };
    let physics = create();
    if (mission === 'artemis_ii') {
      physics.startProximity(model);
      if (physics.canRail()) throw new Error('ICPS scene must retain native integration');
    } else {
      physics.target = physics.exterior.add({ id: 'iss', mass: 420000, p: new Vector3(0, 451, 0),
        q: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI), boxes: [{ half: [.4, .4, .4] }] });
      physics.portA = { p: new Vector3(0, .5, 0), normal: new Vector3(0, 1, 0) };
      physics.portB = { p: new Vector3(0, .5, 0), normal: new Vector3(0, 1, 0) };
      physics.targetRelativeQ = physics.target.q.clone(); physics.dockingActive = true;
      physics.stationApproach = { index: 0, corridorViolated: false, retreating: false };
    }
    for (let i = 0; i < 60000; i++) {
      physics.advance(1 / 30);
      if (i === 1800) {
        const saved = JSON.parse(JSON.stringify(physics.serialize())), before = physics.host.p.clone();
        physics.dispose(); physics = create(); physics.restore(saved);
        if (physics.host.p.distanceTo(before) > 1e-5) throw new Error('Native approach restore moved the host');
      }
      if (state.historicalOperations.flags.issCleared) state.phaseIndex = state.mission.phases.findIndex(p => p.kind === 'docking');
      if (physics.proximity?.done || physics.joint) break;
    }
    const complete = mission === 'artemis_ii' ? physics.proximity?.done : Boolean(physics.joint);
    const result = { mission, complete, rcsKg: physics.rcs.usedKg, waypoints: physics.proximity?.waypoint,
      holdPoints: events.filter(e => e.type === 'issClearance').map(e => e.detail.pointM), events: events.filter(e => !['tick'].includes(e.type)) };
    physics.dispose();
    if (!complete) throw new Error('Native training approach incomplete: ' + JSON.stringify(result));
    results.push(result);
  }
  return results;
}
