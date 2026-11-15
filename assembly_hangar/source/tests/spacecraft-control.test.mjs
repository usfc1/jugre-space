import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { rcsCommand, restoreRcs, targetInFov } from '../spacecraft-control.mjs';
import { canCapture, dockingMetrics } from '../flight-rigid.mjs';
test('RCS fuel limits impulse, changes mass budget and resumes mid approach', () => {
  const r = restoreRcs(), control = { rcs: true }, axes = { longitudinal: 1, yaw: 1 };
  rcsCommand(r, axes, control, 1000, 3);
  const copy = restoreRcs(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(rcsCommand(copy, axes, control, 1000, 4), rcsCommand(r, axes, control, 1000, 4));
  assert.deepEqual(copy, r); assert.ok(r.usedKg > 0);
  const exhausted = restoreRcs({ fuelKg: 0 });
  assert.equal(rcsCommand(exhausted, axes, control, 1000, 1).acceleration.length(), 0);
});
test('manual capture requires lateral alignment and low angular rate; pointing is geometric', () => {
  const a = { p: new Vector3(), q: new Quaternion(), preV: new Vector3(), preW: new Vector3() };
  const b = { ...a, p: new Vector3(0, 0, .1) };
  const pa = { p: new Vector3(), normal: new Vector3(0, 0, 1) }, pb = { ...pa, normal: new Vector3(0, 0, -1) };
  const m = dockingMetrics(a, pa, b, pb); assert.ok(canCapture(m, 'standard', true));
  assert.equal(canCapture({ ...m, speedMps: .21 }, 'standard', true), false);
  assert.equal(canCapture({ ...m, angularRateRadS: .01 }, 'standard', true), false);
  assert.ok(targetInFov(a.p, a.q, new Vector3(0, 0, -10)));
  assert.equal(targetInFov(a.p, a.q, new Vector3(10, 0, 0)), false);
});
