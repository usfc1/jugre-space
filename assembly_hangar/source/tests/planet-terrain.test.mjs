import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { buildTerrainGeometry, landingEnvelope, terrainHeight, terrainMeshHeight, TERRAIN_RADIUS } from '../planet-terrain.mjs';

test('descent and ascent have no visibility step at the former 2 km boundary', () => {
  for (const kind of ['moonLanding', 'marsLanding', 'rendezvous']) {
    const below = landingEnvelope({ kind, altitude: 1.999 });
    const above = landingEnvelope({ kind, altitude: 2.001 });
    assert.equal(below.blend, 1);
    assert.equal(above.blend, 1);
    let previous = 1;
    for (let altitude = 0; altitude <= 120; altitude += .1) {
      const { blend } = landingEnvelope({ kind, altitude });
      assert.ok(blend <= previous + 1e-10);
      assert.ok(previous - blend < .004, 'no abrupt altitude cutover');
      previous = blend;
    }
    assert.equal(previous, 0);
  }
  assert.equal(landingEnvelope({ kind: 'orbit', altitude: 200 }).blend, 0);
  assert.equal(landingEnvelope({ kind: 'moonSurface', altitude: 0 }).air, 0);
});

test('touchdown and EVA stay level; surrounding surfaces differ and remain continuous', () => {
  for (const body of ['moon', 'mars']) {
    assert.equal(terrainHeight(body, 0, 0), 0);
    assert.equal(terrainHeight(body, 10, 5), 0);
    for (const [x, z] of [[13, 0], [42, 0], [115, 210], [-680, -400], [4200, 10]]) {
      const center = terrainHeight(body, x, z);
      assert.ok(Number.isFinite(center));
      assert.ok(Math.abs(center - terrainHeight(body, x + .001, z)) < .05);
    }
  }
  assert.notEqual(terrainHeight('mars', 1500, 300), terrainHeight('mars', 1500, 300, 1));
  assert.notEqual(terrainHeight('moon', 1500, 300), terrainHeight('mars', 1500, 300));
});

test('curved terrain has a closed ring seam, finite normals and a 65 km extent', () => {
  for (const body of ['moon', 'mars']) {
    const geometry = buildTerrainGeometry(body);
    const p = geometry.attributes.position, normals = geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getY(i)));
      assert.ok(Number.isFinite(normals.getY(i)) && normals.getY(i) > 0);
      assert.ok(Math.abs(p.getY(i) - terrainHeight(body, p.getX(i), p.getZ(i))) < .02);
    }
    assert.ok(Math.abs(Math.hypot(p.getX(p.count - 1), p.getZ(p.count - 1)) - TERRAIN_RADIUS) < .01);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 20000);
    for (const [x, z] of [[0, 0], [8, 4], [30, 22], [95, -112], [-450, 670], [1090, 1], [800, -20], [-34000, -8000]]) {
      ray.ray.origin.set(x, 10000, z);
      const hit = ray.intersectObject(mesh)[0];
      assert.ok(hit, 'surface must be closed under every rock');
      assert.ok(Math.abs(hit.point.y - terrainMeshHeight(geometry, x, z)) < 1e-5, 'rocks follow rendered triangles');
    }
    mesh.material.dispose();
    geometry.dispose();
  }
});
