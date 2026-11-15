import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { EARTH_GM, integrateBurn, keplerState } from '../orbital-propagator.mjs';
import { AU_KM, SUN_GM } from '../mission-planets.mjs';

for (const [name, eccentricity, sign] of [
  ['circular', 0, 1], ['eccentric elliptic', .9, 1], ['near parabolic', .99999999, 1],
  ['hyperbolic', 1.4, 1], ['retrograde', .2, -1],
]) test(`universal variables agree with RK4 and preserve integrals: ${name}`, () => {
  const p = new Vector3(7000, 0, 0);
  const v = new Vector3(0, 0, sign * Math.sqrt(EARTH_GM * (1 + eccentricity) / p.x));
  const time = 1200;
  const actual = keplerState(p, v, time);
  const reference = integrateBurn(p, v, time, new Vector3(), EARTH_GM, .25);
  const energy = (r, v) => v.lengthSq() / 2 - EARTH_GM / r.length();
  assert.ok(actual.position.distanceTo(reference.position) < 1e-5);
  assert.ok(actual.velocity.distanceTo(reference.velocity) < 1e-8);
  assert.ok(Math.abs(energy(actual.position, actual.velocity) - energy(p, v)) < 1e-9);
  assert.ok(p.clone().cross(v).distanceTo(actual.position.clone().cross(actual.velocity)) < 1e-6);
  const reverse = keplerState(actual.position, actual.velocity, -time);
  assert.ok(reverse.position.distanceTo(p) < 1e-5);
  assert.ok(reverse.velocity.distanceTo(v) < 1e-8);
});

test('nine months of solar propagation compose with daily samples', () => {
  const p = new Vector3(AU_KM, 0, 0);
  const v = new Vector3(0, 0, Math.sqrt(SUN_GM / AU_KM) * 1.1);
  const days = 270, dayS = 86400;
  const direct = keplerState(p, v, days * dayS, SUN_GM);
  let incremental = { position: p, velocity: v };
  for (let i = 0; i < days; i++) incremental = keplerState(incremental.position, incremental.velocity, dayS, SUN_GM);
  assert.ok(direct.position.distanceTo(incremental.position) < .001);
  assert.ok(direct.velocity.distanceTo(incremental.velocity) < 1e-8);
});
