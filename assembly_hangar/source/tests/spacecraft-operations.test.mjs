import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3 } from 'three';
import { prepareParts } from '../assembly.mjs';
import { EARTH_MU, EARTH_OMEGA, EARTH_RADIUS_M, geographicUp } from '../flight-coordinates.mjs';
import { FlightState } from '../flight-missions.mjs';
import { assessVehicle, searchVehicles } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { defaultSpacecraft, spacecraftTotals } from '../spacecraft-design.mjs';
import { earthShadow, SpacecraftOperations, stationContact } from '../spacecraft-operations.mjs';
import { newMission } from '../mission-specification.mjs';

const specs = prepareParts(JSON.parse(readFileSync(new URL('../../../original_parts/manifest.json', import.meta.url))).parts);
const earth = newMission('science-flight');
const science = { ...earth, type: 'science', durationS: 14400, spacecraft: defaultSpacecraft };
const radiusM = EARTH_RADIUS_M + 200000;
const surfaceSpeedMps = Math.sqrt(EARTH_MU / radiusM) - EARTH_OMEGA * radiusM;

test('catalog changes mass, budget, peak demand, memory and launch margin through a single design', () => {
  const baseline = assessVehicle(planMission(science), 'dart', specs);
  const changed = assessVehicle(planMission({ ...science, spacecraft: { ...defaultSpacecraft, instrumentIds: ['hires', 'wide'],
    computer: 'basic', budgetM: 1 } }), 'dart', specs);
  assert.equal(changed.spacecraft.massKg - baseline.spacecraft.massKg, 21);
  assert.ok(changed.spacecraft.costM > baseline.spacecraft.costM);
  assert.ok(changed.spacecraft.peakW > baseline.spacecraft.peakW);
  assert.equal(changed.spacecraft.computer.storageMB, 64);
  assert.equal(changed.vehicle.payloadMassKg, changed.spacecraft.massKg);
  assert.equal(changed.performance.wetMassKg - baseline.performance.wetMassKg, 21);
  assert.ok(changed.performance.idealMps < baseline.performance.idealMps);
  assert.equal(changed.checks.find(item => item.id === 'budget').status, 'FAIL');
  assert.equal(changed.checks.find(item => item.id === 'pointing-hires').status, 'FAIL');
});

test('Earth limb blocks the Sun and the ground link, with full rate overhead', () => {
  const sun = new Vector3(1, 0, 0);
  assert.equal(earthShadow(new Vector3(-radiusM, 0, 0), sun), true);
  assert.equal(earthShadow(new Vector3(radiusM, 0, 0), sun), false);
  assert.equal(earthShadow(new Vector3(-1000000, EARTH_RADIUS_M + 1, 0), sun), false);
  const up = geographicUp(28.61, -80.60);
  const radio = spacecraftTotals(defaultSpacecraft).radio;
  const overhead = stationContact(up.clone().multiplyScalar(radiusM), radio);
  assert.equal(overhead.name, 'Florida');
  assert.ok(Math.abs(overhead.elevationDeg - 90) < 1e-4);
  assert.ok(Math.abs(overhead.rateMBs - .4) < 1e-12);
  assert.equal(stationContact(up.clone().multiplyScalar(-radiusM), radio), null);
});

test('eclipse consumes the battery by delivered Wh; a weak bus enters safe mode', () => {
  const position = new Vector3(-radiusM, 0, 0);
  const velocity = new Vector3(0, 0, surfaceSpeedMps);
  const robust = new SpacecraftOperations(defaultSpacecraft);
  robust.deploy(position, velocity, 0);
  robust.advance(5);
  const expected = robust.design.battery.capacityWh - robust.design.standbyW * 5 / (.92 * 3600);
  assert.equal(robust.eclipsed, true);
  assert.ok(Math.abs(robust.batteryWh - expected) < 1e-10);
  const weak = new SpacecraftOperations({ ...defaultSpacecraft, battery: 'trial', panels: 'compact' });
  const events = [];
  weak.deploy(position, velocity, 0);
  weak.advance(500, type => events.push(type));
  assert.ok(weak.safe);
  assert.equal(weak.generatedMB, 0);
  assert.equal(weak.loadW, 8);
  assert.deepEqual(events, ['satelliteSafeMode']);
});

test('science and downlink close the data budget; storage fills and checkpoint partition agrees', () => {
  const craft = new SpacecraftOperations({ ...defaultSpacecraft, instrumentIds: ['hires'], computer: 'basic',
    attitude: 'precision', panels: 'extended', battery: 'extended', downlinkGoalMB: 200 });
  const position = new Vector3(radiusM, 0, 0);
  craft.deploy(position, new Vector3(0, 0, -surfaceSpeedMps), 0);
  craft.radioEnabled = false;
  craft.advance(73);
  assert.equal(craft.storedMB, 64);
  assert.ok(craft.lostMB > 0);
  assert.equal(craft.downlinkedMB, 0);
  const clone = new SpacecraftOperations(craft.config, JSON.parse(JSON.stringify(craft.serialize())));
  craft.radioEnabled = clone.radioEnabled = true;
  craft.advance(9227);
  for (let i = 0; i < 1318; i++) clone.advance(7);
  clone.advance(1);
  assert.deepEqual(clone.serialize(), craft.serialize());
  assert.ok(craft.downlinkedMB > 0);
  assert.ok(craft.storedMB <= 64);
  assert.ok(Math.abs(craft.generatedMB - craft.lostMB - craft.storedMB - craft.downlinkedMB) < 1e-7);
  assert.throws(() => new SpacecraftOperations(craft.config, { ...craft.serialize(), storedMB: 200 }), /Invalid/);
});

test('the default science project physically reaches orbit, releases mass, sends data and restores its result', async () => {
  const plan = planMission(science);
  const candidate = (await searchVehicles(plan, specs))[0];
  const flight = new FlightState('designed', 'command', { vehicle: candidate.vehicle, design: { spec: plan.spec, carrier: candidate.blueprint.carrier } });
  for (let i = 0; i < 1600 && !flight.complete && !flight.failed; i++) flight.update(.25, {}, 500);
  assert.equal(flight.execution.result(flight).status, 'COMPLETED');
  assert.ok(Math.abs(flight.timeline.clock.seconds - science.durationS) < 1e-7);
  assert.equal(flight.launch.releasedPayloadKg, candidate.spacecraft.massKg);
  assert.equal(flight.execution.events.filter(event => event.type === 'satelliteDeployed').length, 1);
  assert.ok(flight.satellite.downlinkedMB >= defaultSpacecraft.downlinkGoalMB - 1e-8);
  const copy = FlightState.fromSave(JSON.parse(JSON.stringify(flight.serialize())));
  assert.deepEqual(copy.satellite.serialize(), flight.satellite.serialize());
  assert.deepEqual(copy.execution.result(copy), flight.execution.result(flight));
});

test('an allowed engineering drill records power problems and cannot pass the science goal', () => {
  const plan = planMission({ ...science, spacecraft: { ...defaultSpacecraft, panels: 'compact', battery: 'trial',
    instrumentIds: ['hires'], attitude: 'precision', radio: 'high' } });
  const candidate = assessVehicle(plan, 'dart', specs);
  assert.equal(candidate.executable, true);
  assert.equal(candidate.feasibility, 'Requires Redesign');
  assert.equal(candidate.checks.find(item => item.id === 'eclipse-energy').status, 'FAIL');
  const flight = new FlightState('designed', 'command', { vehicle: candidate.vehicle, design: { spec: plan.spec } });
  for (let i = 0; i < 1600 && !flight.complete && !flight.failed; i++) flight.update(.25, {}, 500);
  assert.equal(flight.execution.result(flight).status, 'INCOMPLETE');
  assert.equal(flight.satellite.downlinkedMB, 0);
  assert.ok(flight.execution.events.some(event => event.type === 'satelliteSafeMode'));
});

test('short science flight waits for data objectives after the shortened orbit interval', () => {
  const plan = planMission(science);
  const candidate = assessVehicle(plan, 'dart', specs);
  const flight = new FlightState('designed', 'command', { vehicle: candidate.vehicle, design: { spec: plan.spec } });
  for (let i = 0; i < 1600 && !flight.satellite.orbit && !flight.failed; i++) flight.update(.25, {}, 500, () => false);
  assert.ok(flight.satellite.orbit);
  flight.flightLength = 'short';
  flight.satellite.radioEnabled = false;
  flight.update(20, undefined, 1);
  assert.equal(flight.complete, false);
  assert.ok(flight.time > flight.phase.duration);
  assert.equal(flight.actualRate, 1);
  assert.equal(flight.satellite.downlinkedMB, 0);
});
