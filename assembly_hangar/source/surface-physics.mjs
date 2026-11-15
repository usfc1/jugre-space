import { Vector3 } from 'three';
import { RigidScene, fromPx } from './physx-runtime.mjs';
import { buildTerrainGeometry, roverTrialRocks, surfaceRocks, terrainMeshHeight } from './planet-terrain.mjs';
import { RoverVehicle } from './rover-vehicle.mjs';

export class SurfacePhysics {
  constructor(runtime, expedition) {
    this.runtime = runtime; this.expedition = expedition; this.scene = new RigidScene(runtime);
    const { P } = runtime;
    const geometry = buildTerrainGeometry(expedition.body === 'earth' ? 'mars' : expedition.body, expedition.id === 'mars_science_laboratory' ? 1 : 0);
    const p = geometry.attributes.position, indices = geometry.index;
    const vertices = new P.PxArray_PxVec3(p.count), triangles = new P.PxArray_PxU32(indices.count);
    for (let i = 0; i < p.count; i++) vertices.set(i, this.scene.pxVector(new Vector3(p.getX(i), expedition.body === 'earth' ? 0 : p.getY(i), p.getZ(i))));
    for (let i = 0; i < indices.count; i++) triangles.set(i, indices.getX(i));
    const desc = new P.PxTriangleMeshDesc(), cooking = new P.PxCookingParams(runtime.scale);
    cooking.areaTestEpsilon = 1e-12; cooking.meshWeldTolerance = 1e-7;
    desc.points.count = vertices.size(); desc.points.stride = 12; desc.points.data = vertices.begin();
    desc.triangles.count = triangles.size() / 3; desc.triangles.stride = 12; desc.triangles.data = triangles.begin();
    this.mesh = P.CreateTriangleMesh(cooking, desc);
    if (!this.mesh?.ptr) throw new Error('Could not create terrain collision');
    const meshGeometry = new P.PxTriangleMeshGeometry(this.mesh);
    this.ground = runtime.physics.createRigidStatic(this.scene.pxPose(new Vector3()));
    const shape = runtime.physics.createShape(meshGeometry, this.scene.material, true, this.scene.shapeFlags);
    const filter = new P.PxFilterData(1, 0xffff, 0, 0); shape.setSimulationFilterData(filter); P.destroy(filter);
    const queryFilter = new P.PxFilterData(1, 0, 0, 0); shape.setQueryFilterData(queryFilter); P.destroy(queryFilter);
    this.ground.attachShape(shape); shape.release(); this.scene.scene.addActor(this.ground);
    // The deliberately flat touchdown pad also gets a single broad collision
    // face; tiny logarithmic render triangles must not leave cooking slivers.
    const pad = this.scene.add({ id: 'touchdown-pad', fixed: true, p: new Vector3(0, -.5, 0), boxes: [{ half: [9, .5, 9] }] });
    const padQuery = new P.PxFilterData(1, 0, 0, 0); for (const s of pad.shapeRefs) s.setQueryFilterData(padQuery); P.destroy(padQuery);
    for (const obj of [vertices, triangles, desc, cooking, meshGeometry]) P.destroy(obj);
    const obstacles = expedition.body === 'earth' ? roverTrialRocks : surfaceRocks(expedition.id === 'mars_science_laboratory' ? 1 : 0);
    for (const [i, r] of obstacles.entries()) if (r.radius >= .15) {
      const h = expedition.body === 'earth' ? 0 : terrainMeshHeight(geometry, r.x, r.z);
      const rock = this.scene.add({ id: 'rock:' + i, fixed: true, p: new Vector3(r.x, h + r.height * .2, r.z), boxes: [{ half: [r.radius * .7, r.height * .5, r.radius * .7] }] });
      const queryFilter = new P.PxFilterData(1, 0, 0, 0); for (const shape of rock.shapeRefs) shape.setQueryFilterData(queryFilter); P.destroy(queryFilter);
    }
    geometry.dispose();
    this.controllers = new Map(); this.filters = new P.PxControllerFilters();
    this.manager = P.CreateControllerManager(this.scene.scene);
    this.vehicles = expedition.actors.filter(a => a.profile === 'rover').map(a => { const v = new RoverVehicle(this.scene, a, expedition.body); a.nativeVehicle = true; return v; });
    for (const a of expedition.actors.filter(a => a.profile === 'astronaut')) {
      const d = new P.PxCapsuleControllerDesc(); d.radius = .28; d.height = 1.1;
      d.material = this.scene.material; d.slopeLimit = Math.cos(.6); d.stepOffset = .25; d.contactOffset = .015;
      const position = new P.PxExtendedVec3(a.p.x, a.p.y + .85, a.p.z); d.position = position;
      if (!d.isValid()) throw new Error('Invalid EVA controller');
      const c = this.manager.createController(d); this.controllers.set(a.id, c); P.destroy(d); P.destroy(position);
    }
  }
  advance(dt) {
    for (const a of this.expedition.actors) {
      const c = this.controllers.get(a.id); if (!c) continue;
      const delta = a.p.clone().sub(fromPx(c.getFootPosition()));
      c.move(this.scene.pxVector(delta), .0001, dt, this.filters); a.p.copy(fromPx(c.getFootPosition()));
    }
    this.scene.advance(dt, step => { for (const v of this.vehicles) v.beforeStep(step); }, () => { for (const v of this.vehicles) v.afterStep(); });
  }
  dispose() {
    for (const v of this.vehicles) { v.actor.nativeVehicle = false; v.dispose(); }
    for (const c of this.controllers.values()) c.release(); this.controllers.clear();
    this.manager.release(); this.runtime.P.destroy(this.filters); this.ground.release(); this.mesh.release(); this.scene.dispose();
  }
}
