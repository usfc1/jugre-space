import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Group, Vector3 } from 'three';
import { buildCraft, prepareParts } from '../assembly.mjs';
import { EARTH_MU, EARTH_OMEGA, EARTH_RADIUS_M, G0, orbitElements } from '../flight-coordinates.mjs';
import { FlightState } from '../flight-missions.mjs';
import { assessVehicle, idealDeltaV, propulsionAnalysis, searchVehicles } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { loadMission, lunarExpedition, newMission, readMission, saveMission } from '../mission-specification.mjs';
import { launchVehicles } from '../launch-vehicles.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../../original_parts/manifest.json', import.meta.url), 'utf8'));
const specs = prepareParts(manifest.parts);
const models = new Map([...specs.keys()].map(id => [id, new Group()]));
const earth = newMission('earth-test');

test('mission definitions round trip, migrate hours and reject invalid physical inputs', () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  saveMission(storage, earth);
  assert.deepEqual(loadMission(storage), earth);
  assert.equal(readMission({ ...earth, schemaVersion: 0, durationHours: 2 }).durationS, 7200);
  for (const invalid of [{ crewCount: 1.5 }, { crewCount: -1 }, { payloadMassKg: -1 }, { propellantFraction: NaN },
    { launchUtc: '2026-02-31T00:00:00.000Z' }, { launchUtc: '2026-01-01T25:00:00.000Z' },
    { orbit: { ...earth.orbit, apoapsisM: 100000 } }]) assert.throws(() => readMission({ ...earth, ...invalid }));
});

test('stage Δv includes the upper stack and removes lower stage dry mass only after burning', () => {
  assert.equal(idealDeltaV(300, 20, 10), 300 * G0 * Math.log(2));
  const p = propulsionAnalysis(launchVehicles.apollo_11);
  assert.equal(p.stages[0].startKg, p.wetMassKg);
  assert.equal(p.stages[1].startKg, p.stages[0].endKg - p.stages[0].dryKg);
  assert.ok(p.twr > 1);
});

test('circular and escaping Earth orbits report physical elements', () => {
  const radius = EARTH_RADIUS_M + 200000;
  const speed = Math.sqrt(EARTH_MU / radius);
  const position = new Vector3(radius, 0, 0);
  const circular = orbitElements(position, new Vector3(0, 0, -(speed - EARTH_OMEGA * radius)));
  assert.ok(Math.abs(circular.periapsisM - 200000) < .01);
  assert.ok(Math.abs(circular.apoapsisM - 200000) < .01);
  assert.ok(Math.abs(circular.periodS - 2 * Math.PI * radius / speed) < 1e-6);
  assert.equal(circular.inclinationDeg, 0);
  const escaping = orbitElements(position, new Vector3(0, 0, -(speed * 1.5 - EARTH_OMEGA * radius)));
  assert.ok(escaping.energy > 0);
  assert.ok(Number.isFinite(escaping.periapsisM));
  assert.equal(escaping.periodS, null);
});

test('automatic candidates use the assembly joints and the same report as manual craft', async () => {
  const plan = planMission({ ...earth, availableParts: [...specs.keys()], payloadMassKg: 232 });
  const reports = await searchVehicles(plan, specs);
  assert.ok(reports.length > 0);
  const mounted = reports.find(candidate => candidate.checks.some(item => item.id === 'payload' && item.status === 'PASS'));
  assert.ok(mounted);
  assert.deepEqual(assessVehicle(plan, mounted.blueprint.layout, specs), mounted);
  assert.equal(buildCraft(mounted.blueprint.layout, specs, models).pieces.size, mounted.blueprint.components.length);
  const empty = assessVehicle(planMission({ ...plan.spec, propellantFraction: 0 }), mounted.blueprint.layout, specs);
  assert.equal(empty.performance.idealMps, 0);
  assert.ok(empty.performance.wetMassKg < mounted.performance.wetMassKg);
  assert.equal(empty.checks.find(item => item.id === 'delta-v').status, 'FAIL');
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(searchVehicles(plan, specs, { signal: stop.signal }), { name: 'AbortError' });
});

test('four-person lunar expedition stays unsupported and its estimate depends on date and orbit', async () => {
  const spec = lunarExpedition();
  const initial = planMission(spec);
  assert.equal(initial.trajectory, null);
  assert.equal(initial.executable, false);
  assert.ok(initial.phases.some(phase => phase.id === 'lunar-orbit'));
  assert.ok(initial.phases.some(phase => phase.id === 'recovery'));
  assert.ok(!initial.phases.some(phase => phase.id === 'landing'));
  const candidates = await searchVehicles(initial, specs);
  assert.ok(candidates.length > 0 && candidates.every(result => !result.executable));
  assert.ok(candidates.every(result => result.checks.find(item => item.id === 'seats').status === 'FAIL'));
  const input = { ...spec, transferS: 72 * 3600, launchUtc: '2026-11-14T12:00:00.000Z', orbit: { periapsisM: 100000, apoapsisM: 120000, toleranceM: 20000 } };
  const a = planMission(input).trajectory;
  const b = planMission({ ...input, launchUtc: '2026-11-17T12:00:00.000Z' }).trajectory;
  const c = planMission({ ...input, orbit: { ...input.orbit, apoapsisM: 170000 } }).trajectory;
  assert.ok(a.departureMps > 0 && a.captureMps > 0);
  assert.notEqual(a.departureMps, b.departureMps);
  assert.notEqual(a.captureMps, c.captureMps);
});

test('designed flight validates physical orbit and restores objective progress mid-ascent', () => {
  const plan = planMission(earth);
  const report = assessVehicle(plan, 'apollo_11', specs);
  const options = { vehicle: report.vehicle, design: { spec: earth, carrier: 'apollo_11', checks: report.checks } };
  const original = new FlightState('designed', 'command', options);
  original.update(32, {}, 10);
  assert.equal(original.execution.objectives[0].state, 'COMPLETED');
  assert.equal(original.execution.objectives[1].state, 'ACTIVE');
  const copy = FlightState.fromSave(JSON.parse(JSON.stringify(original.serialize())));
  assert.deepEqual(copy.execution.serialize(), original.execution.serialize());
  for (const state of [original, copy]) {
    for (let i = 0; i < 240 && !state.complete && !state.failed; i++) state.update(.25, {}, 100);
    assert.equal(state.execution.result(state).status, 'COMPLETED');
    assert.ok(state.execution.objectives[1].evidence.periapsisM > 150000);
  }
  assert.deepEqual(copy.execution.serialize(), original.execution.serialize());
});

test('an exhausted rocket and an out-of-tolerance orbit cannot complete the mission', () => {
  const dry = { ...earth, propellantFraction: 0 };
  const dryVehicle = assessVehicle(planMission(dry), 'apollo_11', specs).vehicle;
  const failed = new FlightState('designed', 'command', { vehicle: dryVehicle, design: { spec: dry } });
  for (const stage of failed.launch.stages) stage.failed = true;
  failed.update(30);
  assert.equal(failed.execution.result(failed).status, 'FAILED');
  assert.equal(failed.execution.objectives[1].state, 'SKIPPED');
  const strict = readMission({ ...earth, orbit: { ...earth.orbit, toleranceM: 1 } });
  const vehicle = assessVehicle(planMission(strict), 'apollo_11', specs).vehicle;
  const outside = new FlightState('designed', 'command', { vehicle, design: { spec: strict } });
  for (let i = 0; i < 240 && !outside.complete && !outside.failed; i++) outside.update(.25, {}, 100);
  assert.equal(outside.execution.result(outside).status, 'INCOMPLETE');
  assert.equal(outside.execution.objectives[1].state, 'FAILED');
});
