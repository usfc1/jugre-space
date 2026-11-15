import assert from 'node:assert/strict';
import test from 'node:test';
import { LunarAscentControl } from '../lunar-ascent-control.mjs';
test('fixed thrust lunar ascent measures orbit and sample mass affects the fuel reserve', () => {
  const empty = new LunarAscentControl(), laden = new LunarAscentControl(21.5);
  for (const a of [empty, laden]) for (let i = 0; i < 8000 && !['orbit', 'failed'].includes(a.status); i++) a.advance(.1);
  assert.equal(laden.status, 'orbit'); assert.ok(laden.orbit.periapsisM >= 10000); assert.ok(laden.orbit.apoapsisM < 200000);
  assert.ok(laden.fuelKg < empty.fuelKg); assert.ok(laden.elapsed > empty.elapsed);
});
test('mid ascent state resumes continuously and the ignition window is enforced', () => {
  const a = new LunarAscentControl(21.5); assert.equal(a.ignite(61), false); assert.equal(a.ignite(5), true);
  a.advance(120); const b = new LunarAscentControl(21.5, a.serialize());
  a.advance(30); b.advance(30); assert.deepEqual(a.serialize(), b.serialize());
});
