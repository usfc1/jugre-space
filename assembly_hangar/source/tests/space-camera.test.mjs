import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { spaceCameraNear, SPACE_SCALE } from '../space-world.mjs';

test('near plane preserves Earth surface at Apollo short-flight extraction distance', () => {
  const radius = 6371;
  const displayedAltitude = 8.6 * SPACE_SCALE;
  const earth = { radius, mesh: { visible: true, position: new Vector3(0, -radius * SPACE_SCALE - displayedAltitude, 0) } };
  for (const eye of [new Vector3(), new Vector3(.0004, -.0002, .0008)]) {
    const surfaceDistance = eye.distanceTo(earth.mesh.position) - radius * SPACE_SCALE;
    const near = spaceCameraNear([earth], eye);
    assert.ok(near < surfaceDistance);
    assert.ok(Math.abs(near - surfaceDistance * .16) < 1e-12);
  }
});

test('near plane uses the nearest visible rendered body across route scales', () => {
  for (const scale of [1, .6, 1e-3, 1e-6]) {
    const earth = { radius: 6371, mesh: { visible: true, position: new Vector3(0, -(6371 + 200 * scale) * SPACE_SCALE, 0) } };
    const hidden = { radius: 1, mesh: { visible: false, position: new Vector3(.0100001, 0, 0) } };
    const near = spaceCameraNear([hidden, earth], new Vector3());
    assert.ok(Math.abs(near - Math.max(.000001, Math.min(1, 200 * scale * SPACE_SCALE * .16))) < 1e-12);
  }
  assert.equal(spaceCameraNear([], new Vector3()), 1);
  assert.ok(spaceCameraNear([{ radius: 1, mesh: { visible: true, position: new Vector3(.01, 0, 0) } }], new Vector3()) > 0);
});

test('near plane also preserves the nearby cloud shell above the Earth surface', () => {
  const earth = { radius: 6371, clipRadii: [6379, 6371 * 1.012],
    mesh: { visible: true, position: new Vector3(0, -(6371 + 8.2) * SPACE_SCALE, 0) } };
  const cloudDistance = .2 * SPACE_SCALE;
  assert.ok(spaceCameraNear([earth], new Vector3()) < cloudDistance);
});
