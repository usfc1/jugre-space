import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareParts } from '../assembly.mjs';
import { metabolism, foodKgS, waterKgS } from '../cabin-profile.mjs';
import { atmosphereReading, CrewLifeSupport } from '../crew-life-support.mjs';
import { FlightState } from '../flight-missions.mjs';
import { assessVehicle, searchVehicles } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { newMission } from '../mission-specification.mjs';

// Test hardware is explicit scenario input, independent of flight catalog ratings.
const profile = { volumeM3: 5, equipmentKg: 45, oxygenKg: .12, reserveKg: .01, oxygenDeliveryKgH: .15,
  waterKg: 1, foodKg: .2, ventilationW: 30, busW: 20, scrubberKgH: .2, scrubberCapacityKg: .1,
  scrubberW: 30, thermalJK: 120000, thermalW: 100, heatRejectionW: 500, generationW: 0 };
const configuration = { profile, module: 'pk_2_kontur', crewCount: 2, batteryJ: 7200000, catalogOxygenKg: .1416, seats: 2 };
const spec = { ...newMission('crew-test'), crewCount: 2, crewMassKgEach: 82, durationS: 1800, cabin: profile };
const specs = prepareParts(JSON.parse(readFileSync(new URL('../../../original_parts/manifest.json', import.meta.url), 'utf8')).parts);
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const totalMass = c => Object.values(c.gas).reduce((sum, kg) => sum + kg, 0)
  + c.oxygenKg + c.reserveKg + c.waterKg + c.foodKg + c.wastewaterKg + c.retainedKg + c.ventedKg;

test('partial pressures follow ideal gas law and sum to cabin pressure', () => {
  const a = atmosphereReading({ o2: .0319988, n2: .0280134, co2: 0, vapor: 0 }, 1, 300);
  near(a.partialPa.o2, 8.31446261815324 * 300);
  near(a.pressurePa, 2 * a.partialPa.o2);
  near(a.oxygenFraction, .5);
});

test('nominal crew use finite oxygen, food and water and add respiratory CO₂', () => {
  const c = new CrewLifeSupport(configuration);
  const baseline = totalMass(c);
  const beforeO2 = c.oxygenKg;
  const beforeCo2 = c.gas.co2;
  c.setControl('scrubber', false);
  c.advance(600);
  near(beforeO2 - c.oxygenKg, 1200 * metabolism.nominal.o2);
  near(c.gas.co2 - beforeCo2, 1200 * metabolism.nominal.co2);
  near(c.foodKg, profile.foodKg - 1200 * foodKgS);
  near(c.waterKg, profile.waterKg - 1200 * waterKgS);
  near(totalMass(c), baseline);
  assert.equal(c.crew[0].awakeS, 600);
  c.setActivity('crew-1', 'sleep');
  c.advance(10);
  assert.equal(c.crew[0].awakeS, 0);
  assert.equal(c.crew[0].sleepS, 10);
  assert.equal(c.crew[1].awakeS, 610);
});

test('scrubber and power failures change actual cabin readings and readiness', () => {
  const normal = new CrewLifeSupport(configuration);
  const offline = new CrewLifeSupport(configuration);
  const unpowered = new CrewLifeSupport(configuration);
  offline.setControl('scrubber', false);
  unpowered.setControl('power', false);
  for (const cabin of [normal, offline, unpowered]) cabin.advance(3600);
  assert.ok(normal.gas.co2 < offline.gas.co2);
  near(offline.gas.co2, unpowered.gas.co2);
  assert.equal(unpowered.batteryJ, configuration.batteryJ);
  assert.equal(unpowered.powered.ventilation, false);
  assert.ok(unpowered.alerts.includes('power'));
  assert.ok(offline.alerts.includes('high-co2'));
  assert.equal(offline.readiness().ready, false);
  assert.equal(normal.readiness().ready, true);
});

test('electrolysis, wastewater processing and leakage close the resource mass balance', () => {
  const c = new CrewLifeSupport({ ...configuration, profile: { ...profile, electrolysisKgH: .1,
    electrolysisW: 500, recoveryKgH: .5, recoveryFraction: .75, recoveryW: 30 } });
  const baseline = totalMass(c);
  c.advance(600);
  assert.ok(c.powered.electrolysis && c.powered.waterRecovery);
  assert.ok(c.ventedKg > 0);
  near(totalMass(c), baseline);
  const air = c.reading();
  c.advance(60, { leakKgS: .03, exteriorPa: 0 });
  assert.ok(c.reading().pressurePa < air.pressurePa);
  assert.ok(c.alerts.includes('low-oxygen'));
  near(totalMass(c), baseline);
  c.advance(1200, { leakKgS: 1 });
  for (const kg of Object.values(c.gas)) assert.ok(Number.isFinite(kg) && kg >= 0);
  assert.ok(c.reading().pressurePa <= 103000);
  near(totalMass(c), baseline);
});

test('timestep partition, battery depletion, reserve activation and serialized state are consistent', () => {
  const a = new CrewLifeSupport(configuration);
  const b = new CrewLifeSupport(configuration);
  a.advance(120);
  for (let i = 0; i < 480; i++) b.advance(.25);
  assert.deepEqual(a.serialize(), b.serialize());
  const restored = new CrewLifeSupport(configuration, JSON.parse(JSON.stringify(a.serialize())));
  assert.deepEqual(restored.serialize(), a.serialize());
  const small = new CrewLifeSupport({ ...configuration, batteryJ: 100, profile: { ...profile, oxygenKg: .002, reserveKg: .001 } });
  small.advance(100);
  assert.equal(small.powered.ventilation, false);
  assert.equal(small.oxygenKg, 0);
  near(small.reserveKg, .001);
  small.setControl('reserve', true);
  small.advance(20);
  assert.ok(small.reserveKg < .001);
  assert.ok(small.batteryJ >= 0);
});

test('life-support shortage is visible preflight and a selected cabin follows flight clock and mass', async () => {
  const plan = planMission(spec);
  const candidates = await searchVehicles(plan, specs);
  const report = candidates.find(r => r.executable && r.performance.twr > 1);
  assert.ok(report);
  assert.deepEqual(report, assessVehicle(plan, report.blueprint.layout, specs));
  const short = assessVehicle(planMission({ ...spec, cabin: { ...profile, oxygenKg: .02 } }), report.blueprint.layout, specs);
  assert.equal(short.checks.find(item => item.id === 'oxygen').status, 'FAIL');
  assert.ok(short.performance.wetMassKg < report.performance.wetMassKg);
  const state = new FlightState('designed', 'command', { vehicle: report.vehicle,
    design: { spec, layout: report.blueprint.layout, cabin: report.cabin, checks: report.checks } });
  state.update(100, {}, 1);
  near(state.lifeSupport.seconds + state.lifeSupport.pendingS, state.totalTime, 1e-6);
  state.paused = true;
  const paused = state.serialize();
  state.update(100, {}, 100);
  assert.deepEqual(state.serialize().design.lifeSupport, paused.design.lifeSupport);
  const restored = FlightState.fromSave(JSON.parse(JSON.stringify(paused)));
  restored.paused = false;
  restored.systems.impact(restored, { zone: 'pk_2_kontur', speedMps: 80, impulseNs: 400000, otherMassKg: 8000, hostMassKg: restored.massKg });
  assert.ok(restored.systems.leakKgPerS > 0);
  restored.update(20, {}, 1);
  assert.ok(restored.lifeSupport.ventedKg > 0);
  near(restored.massKg, restored.launch.mass());
  near(restored.launch.ventedPayloadKg, restored.lifeSupport.ventedKg);
  assert.ok(restored.execution.events.some(event => event.type === 'moduleDamage'));
});
