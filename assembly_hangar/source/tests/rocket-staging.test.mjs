import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Group, Vector3 } from 'three';
import { buildCraft, prepareParts } from '../assembly.mjs';
import { LaunchDynamics } from '../launch-dynamics.mjs';
import { captureAssemblyStage } from '../flight-maneuvers.mjs';
import { FlightState } from '../flight-missions.mjs';
import { assessVehicle } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { newMission } from '../mission-specification.mjs';
import { interstages, twoStageExample } from '../rocket-interstages.mjs';
import { defaultSpacecraft } from '../spacecraft-design.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../../original_parts/manifest.json', import.meta.url)));
const specs = prepareParts({ ...manifest.parts, ...interstages });
const layout = [
  { key: 'lower', part: 'b_140_bochka' },
  { key: 'boost', part: 'k_420_kedr', parent: 'lower', socket: 'mount_aft', plug: 'mount_engine' },
  { key: 'adapter', part: 'p_2512_konus', parent: 'lower', socket: 'mount_forward', plug: 'mount_forward' },
  { key: 'sleeve', part: 'is_125', parent: 'adapter', socket: 'mount_aft', plug: 'mount_aft' },
  { key: 'upper-engine', part: 'k_155v_dalniy', parent: 'sleeve', socket: 'mount_engine', plug: 'mount_engine' },
  { key: 'upper', part: 'b_32_stvol', parent: 'sleeve', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'command', part: 'pb_1_strizh', parent: 'upper', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'rack', part: 'pn_1_polka', parent: 'command', socket: 'mount_forward', plug: 'mount_aft' },
];
const spec = newMission('staged');

test('axial staging derives separate tanks, reserves ignition delay and accounts for every kilogram', () => {
  const { blueprint, checks, vehicle, performance } = assessVehicle(planMission(spec), layout, specs);
  assert.deepEqual(blueprint.fuelNetworks.map(({ tanks, engines }) => [tanks, engines]), [[['lower'], ['boost']], [['upper'], ['upper-engine']]]);
  assert.equal(checks.find(item => item.id === 'staging').status, 'PASS');
  assert.deepEqual(vehicle.stages.map(stage => stage.diameterM), [2.5, 1.25]);
  assert.equal(performance.stages[1].startKg, performance.stages[0].endKg - performance.stages[0].dryKg);
  const sim = new LaunchDynamics(vehicle);
  sim.advance(2);
  const area = sim.frontalAreaM2;
  assert.equal(sim.stages[1].fuelKg, 3200);
  // Run to automatic separation, then measure the mass shed and the ignition delay.
  for (let i = 0; i < 180 && sim.stageIndex === 0; i++) sim.advance(1);
  assert.equal(sim.stageIndex, 1);
  assert.equal(sim.stages[0].attached, false);
  assert.equal(sim.massKg, sim.vehicle.stages[1].dryMassKg + sim.stages[1].fuelKg);
  assert.equal(sim.frontalAreaM2, area / 4);
  const separation = sim.events.find(event => event.type === 'stage');
  assert.equal(separation.detail.releasedMassKg, vehicle.stages[0].dryMassKg);
  assert.equal(sim.stages[1].fuelKg, 3200);
  sim.advance(3);
  assert.ok(sim.stages[1].fuelKg < 3200);
  assert.equal(sim.thrustN > 0, true);
  assert.equal(LaunchDynamics.restore(JSON.parse(JSON.stringify(sim.snapshot()))).stageIndex, 1);
});

test('an upper stage cannot borrow tanks from below its interstage', () => {
  const unfinished = layout.filter(entry => !['upper-engine'].includes(entry.key));
  const report = assessVehicle(planMission(spec), unfinished, specs);
  assert.equal(report.executable, false);
  assert.match(report.checks.find(item => item.id === 'topology').reason, /Stage 2: requires its own engines and tanks/);
});

test('separating a lower subtree preserves the world poses and keys of both upper branches', () => {
  const models = new Map([...specs.keys()].map(key => [key, new Group()]));
  const model = buildCraft(layout, specs, models);
  const ship = new Group();
  ship.add(model.group);
  ship.position.set(3, 8, 18);
  ship.rotation.z = .37;
  const engine = model.pieces.get('upper-engine').object;
  const oldPosition = engine.getWorldPosition(new Vector3());
  const report = assessVehicle(planMission(spec), layout, specs);
  const [lower, upper] = report.vehicle.stages;
  const discarded = captureAssemblyStage(ship, model.group, lower.parts, upper.parts);
  assert.deepEqual(discarded.children.map(node => node.name), ['lower']);
  assert.deepEqual(model.group.children.map(node => node.name), ['upper-engine', 'upper']);
  assert.equal(engine.parent, model.group);
  assert.ok(engine.getWorldPosition(new Vector3()).distanceTo(oldPosition) < 1e-10);
});

test('the two-stage example releases a satellite and transfers measured data', () => {
  const project = { ...spec, type: 'science', assembly: 'manual', upperThrottle: .7, spacecraft: defaultSpacecraft,
    durationS: 14400, orbit: { ...spec.orbit, apoapsisM: 310000, toleranceM: 75000 } };
  const report = assessVehicle(planMission(project), twoStageExample, specs);
  assert.equal(report.ready, true);
  assert.equal(report.vehicle.stages[1].throttleLimit, .7);
  const state = new FlightState('designed', 'command', { vehicle: report.vehicle, design: { spec: project, layout: twoStageExample } });
  for (let i = 0; i < 1600 && !state.complete && !state.failed; i++) state.update(.25, {}, 500);
  assert.equal(state.execution.result(state).status, 'COMPLETED');
  assert.equal(state.execution.events.filter(event => event.type === 'stage').length, 1);
  assert.equal(state.execution.events.filter(event => event.type === 'stageIgnition').length, 1);
  assert.ok(state.satellite.downlinkedMB >= 12 - 1e-8);
});
