import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { FlightState } from '../flight-missions.mjs';
import { assessVehicle } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { playableLunarExpedition } from '../mission-specification.mjs';
import { burnPropellantKg } from '../lunar-expedition.mjs';
import { lunarOutbound, lunarReturn } from '../lunar-flight-plan.mjs';
import { initialEntry } from '../lunar-entry.mjs';

function flight(override = {}, carrier = 'artemis_ii') {
  const spec = { ...playableLunarExpedition('lunar-round-trip'), ...override };
  const assessment = assessVehicle(planMission(spec), carrier, new Map());
  assert.ok(assessment.executable);
  return { assessment, state: new FlightState('designed', 'command', { vehicle: assessment.vehicle, design: { spec, carrier, cabin: assessment.cabin } }) };
}

function run(state, condition) {
  for (let count = 0; count < 200 && !condition(state) && !state.failed && !state.complete; count++) state.update(60, {}, 500, () => false);
  return state;
}

test('four crew complete physical lunar capture and return with measured mass, consumables and splashdown', () => {
  const { assessment, state } = flight();
  assert.equal(assessment.ready, true);
  run(state, current => current.kind === 'moonOrbit');
  assert.equal(state.kind, 'moonOrbit');
  assert.equal(state.failed, false);
  const outbound = state.lunar.outbound;
  const returnPlan = state.lunar.returning;
  const out = lunarOutbound(outbound);
  const back = lunarReturn(state.moonCenter, returnPlan);
  for (const [path, boundary] of [[out, outbound.earthS], [back, returnPlan.moonS]]) {
    const a = path.sample(boundary - .001), b = path.sample(boundary + .001);
    assert.ok(a.position.distanceTo(b.position) < .02);
    assert.ok(a.velocity.distanceTo(b.velocity) < 2e-5);
  }
  const checkpoint = FlightState.fromSave(JSON.parse(JSON.stringify(state.serialize())));
  run(checkpoint, () => false);
  assert.equal(checkpoint.execution.result(checkpoint).status, 'COMPLETED');
  assert.equal(checkpoint.lifeSupport.crew.length, 4);
  assert.ok(checkpoint.lifeSupport.waterKg < 45);
  assert.ok(checkpoint.lifeSupport.oxygenKg < 20);
  const burns = checkpoint.execution.events.filter(event => ['expeditionCapture', 'expeditionReturn'].includes(event.type));
  assert.equal(burns.length, 2);
  assert.ok(Math.abs(checkpoint.lunar.fuelKg + burns.reduce((sum, event) => sum + event.detail.fuelKg, 0) - 8700) < 1e-8);
  assert.ok(checkpoint.lunar.entry.peakG < 13);
  assert.ok(checkpoint.lunar.entry.landingSpeedMps < 13);
  assert.equal(checkpoint.surface, 'ocean');
  assert.deepEqual(FlightState.fromSave(checkpoint.serialize()).lunar, checkpoint.lunar);
});

test('insufficient service-module fuel blocks capture and prevents recovery evidence', () => {
  const template = playableLunarExpedition();
  const { assessment, state } = flight({ expedition: { ...template.expedition, serviceFuelFraction: 0 } }, 'apollo_11');
  assert.equal(assessment.checks.find(item => item.id === 'lunar-fuel').status, 'FAIL');
  run(state, () => false);
  assert.equal(state.execution.result(state).status, 'FAILED');
  assert.match(state.failureReason, /Insufficient fuel for lunar capture/);
  assert.ok(state.execution.objectives.every(goal => goal.id !== 'recovery' || !goal.evidence));
});

test('dated lunar missions use the existing departure solver and preserve their geometry on restore', () => {
  const a=flight({launchUtc:'2026-11-14T00:00:00.000Z'}).state;
  const b=flight({launchUtc:'2026-11-21T00:00:00.000Z'}).state;
  for(const state of [a,b]) {
    run(state,current=>current.kind==='moonTransfer');
    assert.equal(state.failed,false,state.failureReason);
    assert.equal(state.kind,'moonTransfer');
    assert.ok(state.lunar.outbound.earthS+state.lunar.outbound.moonS>86400);
    const restored=FlightState.fromSave(state.serialize());
    assert.deepEqual(restored.lunar.outbound,state.lunar.outbound);
    assert.equal(restored.design.spec.launchUtc,state.design.spec.launchUtc);
    assert.ok(restored.position.distanceTo(state.position)<1e-6);
  }
  assert.ok(a.moonCenter.distanceTo(b.moonCenter)>10000);
});

test('entry rejects escape geometry and the impulse uses the rocket equation', () => {
  assert.throws(() => initialEntry(new Vector3(6491, 0, 0), new Vector3(0, 0, -11)), /corridor/);
  assert.ok(Math.abs(burnPropellantKg(10000, 9.80665 * 300 * Math.log(2), 300) - 5000) < 1e-8);
});

test('mid-entry checkpoint resumes the same measured descent and rejects invalid recovery state', () => {
  const { state } = flight();
  run(state, current => current.kind === 'reentry');
  assert.equal(state.failed, false);
  state.update(1, {}, 100);
  const data = JSON.parse(JSON.stringify(state.serialize()));
  const restored = FlightState.fromSave(data);
  for (const current of [state, restored]) current.update(2, {}, 100);
  assert.deepEqual(restored.lunar.entry, state.lunar.entry);
  assert.deepEqual(restored.lifeSupport.serialize(), state.lifeSupport.serialize());
  const invalid = structuredClone(data);
  invalid.design.lunar.entry.opening = 1.1;
  assert.throws(() => FlightState.fromSave(invalid), /Invalid lunar expedition state/);
});

test('an interrupted power supply degrades the cabin and prevents the lunar mission from succeeding', () => {
  const { state } = flight();
  run(state, current => current.kind === 'moonTransfer');
  state.commandCrew('system', 'power', false);
  run(state, () => false);
  assert.equal(state.execution.result(state).status, 'FAILED');
  assert.ok(state.execution.events.some(event => event.type === 'crewAlert' && event.detail.alerts.includes('power')));
  assert.ok(state.lifeSupport.crew.some(member => member.lowOxygenS > 0 || member.highCo2S > 0));
  assert.match(state.failureReason, /Critical cabin conditions/);
});
