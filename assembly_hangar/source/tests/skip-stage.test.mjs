import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightState } from '../flight-missions.mjs';
import { displayedSpaceScale } from '../short-flight.mjs';
import { surfaceToInertialVelocity } from '../flight-coordinates.mjs';

test('always available skip reaches liftoff, MAX Q and MECO with actual launch state and valid saves', async () => {
  for (const flightLength of ['full', 'short']) {
    const flight = new FlightState('apollo_11', 'command', { flightLength });
    flight.paused = true;
    for (const id of ['liftoff', 'max-q', 'meco']) {
      await flight.skipNextEvent();
      assert.equal(flight.timeline.events.find(e => e.id === id).status, 'COMPLETE');
      assert.equal(flight.paused, true);
      assert.equal(flight.failed, false);
      const restored = FlightState.fromSave(JSON.parse(JSON.stringify(flight.serialize())));
      assert.ok(restored.position.distanceTo(flight.position) < 1e-7);
    }
    assert.ok(flight.launch.stageIndex >= 1);
    assert.ok(flight.launch.stages[0].fuelKg < 1e-6);
    await flight.skipNextEvent();
    assert.equal(flight.timeline.events.find(e => e.id === 'stage-2').status, 'COMPLETE');
  }
});

test('skip stops at phase transition and respects cancellation and terminal state', async () => {
  const flight = new FlightState('apollo_11');
  flight.preflight = flight.countdown = 0;
  flight.paused = true;
  const before = flight.totalTime;
  await flight.skipNextEvent({ shouldStop: () => true });
  assert.equal(flight.totalTime, before);
  flight.aborted = true;
  assert.equal(await flight.skipNextEvent(), null);
  const held = new FlightState('apollo_11');
  held.holding = true;
  await held.skipNextEvent();
  assert.equal(held.timeline.clock.launched, true);
  assert.equal(held.holding, false);
});

function historicalDeparture(id) {
  const flight = new FlightState(id, 'command', { flightLength: 'short' });
  flight.preflight = flight.countdown = 0;
  for (let i = 0; i < 1000 && !flight.solarFlight && !flight.failed; i++) flight.update(30, {}, 20, () => false);
  assert.ok(flight.solarFlight, `No solar flight for ${id}`);
  return flight;
}

test('historical interplanetary flights leave parking orbit forwards and gain distance from Earth', () => {
  for (const id of ['voyager_2', 'mars_2020', 'mars_science_laboratory', 'dart']) {
    const flight = historicalDeparture(id);
    const initial = flight.path.sample(0);
    const forward = surfaceToInertialVelocity(flight.launch.positionM, flight.launch.velocityMps).normalize();
    assert.ok(initial.velocity.sub(initial.centerVelocity).normalize().dot(forward) > .99, id);
    const rangeFromEarth = time => flight.path.sample(time).position
      .distanceTo(flight.bodyCenter('earth', flight.phaseStartTime + time));
    let previous = flight.launch.positionM.length() / 1000;
    for (const time of [1, 60, 600, 1800, 3600, 21600, 43200, 86400]) {
      const range = rangeFromEarth(time);
      assert.ok(range > previous, `${id}: Earth range decreased at ${time}s`);
      previous = range;
    }
  }
});

test('short Voyager skips to Saturn without reusing the old coast clock', async () => {
  const flight = historicalDeparture('voyager_2');
  assert.equal(flight.kind, 'jupiterTransfer');
  assert.equal(displayedSpaceScale(flight), 1);
  flight.update(.2);
  assert.ok(flight.shortRoute);
  flight.paused = true;
  for (let i = 0; i < 20 && flight.kind !== 'saturnFlyby'; i++) {
    const before = flight.totalTime;
    await flight.skipNextEvent();
    assert.ok(flight.totalTime >= before);
    assert.equal(flight.paused, true);
    assert.equal(flight.failed, false);
    FlightState.fromSave(flight.serialize());
  }
  assert.equal(flight.kind, 'saturnFlyby');
  assert.ok(flight.position.distanceTo(flight.bodyCenter('saturn')) < 105000);
  assert.ok(flight.position.distanceTo(flight.bodyCenter('earth')) > 1e9);
});
