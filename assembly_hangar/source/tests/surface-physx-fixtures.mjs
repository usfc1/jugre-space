import { loadPhysX } from '../physx-runtime.mjs';
import { SurfaceExpedition } from '../surface-expedition.mjs';
import { SurfacePhysics } from '../surface-physics.mjs';
export async function runSurfaceFixtures() {
  const runtime = await loadPhysX(), e = new SurfaceExpedition('apollo_11'), s = new SurfacePhysics(runtime, e);
  for (let i = 0; i < 120; i++) { e.advance(1 / 60, { lateral: 1 }); s.advance(1 / 60); }
  if (e.current.p.y < -.05 || e.current.p.x <= 7.2) throw new Error('EVA controller failed to walk on cooked terrain');
  const result = { controller: s.controllers.size, x: e.current.p.x, y: e.current.p.y };
  s.dispose();
  const rover = new SurfaceExpedition('mars_2020'), vehicleScene = new SurfacePhysics(runtime, rover);
  const trace = [];
  for (let i = 0; i < 300; i++) { rover.advance(1 / 60, { drive: 1 }); vehicleScene.advance(1 / 60); if (i % 60 === 0) trace.push({ p: rover.current.p.toArray(), tilt: rover.current.tilt, status: rover.current.status }); }
  const base = vehicleScene.vehicles[0].vehicle.baseState;
  result.vehicle = { p: rover.current.p.toArray(), v: rover.current.v.toArray(), trace,
    roads: Array.from({ length: 6 }, (_, i) => { const r = base.get_roadGeomStates(i), p = vehicleScene.vehicles[0].vehicle.baseParams.get_suspensionParams(i).suspensionAttachment; return { hit: r.hitState, point: [p.p.x, p.p.y, p.p.z], q: [p.q.x, p.q.y, p.q.z, p.q.w], normal: [r.plane.n.x, r.plane.n.y, r.plane.n.z], jounce: base.get_suspensionStates(i).jounce }; }) };
  if (rover.current.p.y < -1 || rover.current.p.z < .01) throw new Error('Vehicle2 chassis failed contact or propulsion: ' + JSON.stringify(result.vehicle));
  vehicleScene.dispose();
  result.trials = [];
  for (const id of ['barkhan_4', 'barkhan_6']) {
    let e = new SurfaceExpedition(id), physics = new SurfacePhysics(runtime, e);
    for (let i = 0; i < 180; i++) { e.advance(1 / 60, { drive: 1 }); physics.advance(1 / 60); }
    const saved = JSON.parse(JSON.stringify(e.serialize())), before = e.current.p.clone();
    physics.dispose(); e = new SurfaceExpedition(id, saved); physics = new SurfacePhysics(runtime, e);
    if (e.current.p.distanceTo(before) > 1e-8) throw new Error('Vehicle restore changed position');
    for (let i = 0; i < 120; i++) { e.advance(1 / 60, { drive: 1 }); physics.advance(1 / 60); }
    if (e.current.p.y < -.1 || e.current.p.z < 1 || e.current.status === 'failed') throw new Error('Earth trial vehicle failed ' + id);
    result.trials.push({ id, wheels: physics.vehicles[0].wheelCount, position: e.current.p.toArray(), energyJ: e.current.energyJ });
    physics.dispose();
  }
  return result;
}
