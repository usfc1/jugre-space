import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { FlightState } from '../flight-missions.mjs';
import { assessVehicle, searchVehicles } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { planetaryMission, readMission } from '../mission-specification.mjs';
import { AU_KM, nominalTransferS, planetPosition, planets, sampleInterplanetary, SUN_GM } from '../mission-planets.mjs';
import { newStandardDraft, readStandardDraft, standardDraftFromMission, standardMissionSpecification } from '../standard-mission.mjs';
import { surfaceToInertialVelocity } from '../flight-coordinates.mjs';

for (const destination of Object.keys(planets)) for (const type of ['flyby', 'orbit']) {
  test(`${destination} ${type}: launch, ballistic cruise, finite fuel, encounter and save restoration`, async () => {
    const spec = planetaryMission(destination, type, `${destination}-${type}`);
    const plan = planMission(spec);
    assert.equal(plan.executable, true, plan.unavailable.join(' '));
    const candidates = await searchVehicles(plan, new Map());
    const candidate = candidates.find(item => item.ready);
    assert.ok(candidate, 'A compatible carrier must exist');
    const { route } = plan.interplanetary;
    const a = sampleInterplanetary(route, route.transferS * .2);
    const b = sampleInterplanetary(route, route.transferS * .7);
    const energy = state => state.velocity.lengthSq() / 2 - SUN_GM / state.position.clone().add(new Vector3().fromArray(route.sunOffset??[AU_KM,0,0])).length();
    assert.ok(Math.abs(energy(a) - energy(b)) < 1e-7, 'Solar two-body energy must be conserved');
    assert.ok(sampleInterplanetary(route, route.transferS).position.distanceTo(new Vector3().fromArray(route.arrival)) < 1, 'Lambert endpoint must be reached');
    const flight = new FlightState('designed', 'command', { vehicle: candidate.vehicle,
      design: { spec, carrier: candidate.blueprint.carrier, checks: candidate.checks } });
    flight.preflight = flight.countdown = 0;
    for (let i = 0; i < 20000 && !flight.interplanetary.departed && !flight.failed; i++) flight.update(.05, {}, 500);
    assert.equal(flight.failed, false, flight.failureReason);
    assert.equal(flight.interplanetary.departed, true);
    const departure = flight.interplanetary.route;
    const initial = sampleInterplanetary(departure, 0);
    const forward = surfaceToInertialVelocity(flight.launch.positionM, flight.launch.velocityMps).normalize();
    assert.ok(initial.velocity.sub(initial.centerVelocity).normalize().dot(forward) > .99);
    let range = flight.launch.positionM.length() / 1000;
    for (const time of [1, 60, 600, 1800, 3600, 21600, 43200, 86400]) {
      const next = sampleInterplanetary(departure, time).position
        .distanceTo(planetPosition('earth', time, departure.transferS, departure));
      assert.ok(next > range, `Earth range at ${time}s decreased from ${range} km to ${next} km`);
      range = next;
    }
    const hardwareSteps = [];
    flight.update(route.transferS * .4 / 1e9, {}, 1e9, undefined, (_state, dt) => hardwareSteps.push(dt));
    assert.ok(hardwareSteps.some(dt => dt > 0));
    assert.ok(hardwareSteps.every(dt => dt <= .08), 'Local hardware must not advance by orbital time');
    assert.equal(flight.kind, 'planetTransfer');
    const restored = FlightState.fromSave(flight.serialize());
    assert.ok(restored.position.distanceTo(flight.position) < 1e-6);
    assert.equal(restored.interplanetary.fuelKg, flight.interplanetary.fuelKg);
    for (let i = 0; i < 100 && !restored.complete && !restored.failed; i++) restored.update(2, {}, 1e9);
    assert.equal(restored.failed, false, restored.failureReason);
    assert.equal(restored.execution.result(restored).status, 'COMPLETED');
    assert.ok(restored.interplanetary.fuelKg >= 0 && restored.interplanetary.fuelKg < plan.interplanetary.fuelKg);
    if (type === 'orbit') {
      const evidence = restored.execution.objectives.find(item => item.id === 'planet-orbit').evidence;
      assert.ok(evidence.energy < 0);
      assert.ok(Math.abs(evidence.periapsisM - spec.orbit.periapsisM) < 1);
      assert.ok(Math.abs(evidence.apoapsisM - spec.orbit.apoapsisM) < 1);
    }
    const terminal = FlightState.fromSave(restored.serialize());
    assert.equal(terminal.execution.result(terminal).status, 'COMPLETED');
  });
}

test('planet drafts round trip; unavailable crew, landing, dates and impossible transfers remain explicit', () => {
  for (const destination of Object.keys(planets)) {
    const draft = readStandardDraft({ ...newStandardDraft(destination), destination, goal: 'orbit' });
    const spec = standardMissionSpecification(draft);
    assert.equal(spec.destination, destination);
    assert.equal(standardDraftFromMission(spec).destination, destination);
    const plan = planMission(spec);
    for (const change of [{ crewCount: 4, crewMassKgEach: 80 }, { type: 'landing' },
      { transferS: nominalTransferS(destination) * .1 }, { returnRequired: true }]) {
      assert.equal(planMission({ ...spec, ...change }).executable, false);
    }
    const empty = readMission({ ...spec, interplanetary: { ...spec.interplanetary, fuelKg: 0 } });
    assert.equal(assessVehicle(planMission(empty), 'artemis_ii', new Map()).checks.find(item => item.id === 'planet-fuel').status, 'FAIL');
  }
});
