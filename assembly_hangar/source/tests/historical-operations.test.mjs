import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightState } from '../flight-missions.mjs';
import { dragonDeorbit, dragonReturnPath } from '../dragon-return.mjs';
import { initialEntry, stepEntry } from '../lunar-entry.mjs';
import { DartNavigation } from '../dart-navigation.mjs';
import { SurfaceExpedition } from '../surface-expedition.mjs';

test('Mars and Voyager departures consume stage budgets using the correct reference frame', () => {
  for (const id of ['mars_2020', 'mars_science_laboratory', 'voyager_2']) {
    const f = new FlightState(id, 'command', { historicalTraining: true });
    for (let i = 0; i < 40 && ['ascent', 'orbit', 'separate'].includes(f.kind); i++) f.update(60, {}, 500, () => false);
    const initialFuel = f.launch.stages.at(-1).fuelKg;
    f.update(1);
    assert.ok(f.launch.stages.at(-1).fuelKg < initialFuel, id);
    const goal = f.historicalExecution.objectives.find(o => o.signals.includes('centaurDeparture'));
    assert.equal(goal.state, 'COMPLETED', id);
    const copy = FlightState.fromSave(JSON.parse(JSON.stringify(f.serialize())));
    copy.update(1); assert.equal(copy.launch.stages.at(-1).fuelKg, f.launch.stages.at(-1).fuelKg);
  }
});

test('Dragon deorbit and aerodynamic return measure the corridor, both parachute stages and touchdown', () => {
  const plan = dragonDeorbit(new Vector3(6791, 0, 0), new Vector3(0, 0, 1));
  const end = dragonReturnPath(plan).sample(plan.duration), entry = initialEntry(end.position, end.velocity, 'dragon');
  assert.ok(plan.deltaVMps > 100 && plan.deltaVMps < 200);
  let reason;
  for (let i = 0; i < 3000 && !entry.landed && !reason; i++) reason = stepEntry(entry, .5, 9900)?.reason;
  assert.ok(!reason, reason); assert.ok(entry.landed && entry.drogue && entry.chute);
  assert.ok(entry.landingSpeedMps <= 12);
});

test('DRACO resolves the secondary in its window and restores a corrected aim without inventing an impact', () => {
  const nav = new DartNavigation(); assert.equal(nav.acquire('dimorphos', 4000), false);
  nav.solveAutomatically(3000); assert.ok(nav.dispersionM.length() < 1e-8); assert.equal(nav.impact, null);
  const copy = new DartNavigation(JSON.parse(JSON.stringify(nav.serialize())));
  assert.deepEqual(copy.serialize(), nav.serialize()); assert.equal(copy.correct(.1, 0, 100), false);
});

test('Curiosity discovery follows physical inventories and both laboratory results in manual operation', () => {
  const e = new SurfaceExpedition('mars_science_laboratory'), a = e.current, events = [];
  const emit = (type, detail) => events.push({ type, detail });
  const sand = e.objects.find(o => o.id === 'rock5'), powder = e.objects.find(o => o.id === 'rock4');
  a.p.fromArray(sand.p); a.tool = 4; e.interact(emit); a.tool = 5; e.interact(emit);
  assert.equal(events.some(e => e.type === 'habitabilityDiscovery'), false);
  a.p.fromArray(powder.p); a.tool = 3; e.interact(emit); e.interact(emit);
  a.tool = 5; e.interact(emit); a.tool = 6; e.interact(emit);
  assert.ok(events.some(e => e.type === 'habitabilityDiscovery'));
});
