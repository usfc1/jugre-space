import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightState, missions } from '../flight-missions.mjs';
import { coastFixture } from './flight-fixtures.mjs';
import { hasShortRoute, shortenedSpaceScale } from '../short-flight.mjs';
import { sampleInterplanetary } from '../mission-planets.mjs';

test('every mission shortens launch distances by 40% while preserving powered launch physics', () => {
  for (const id of Object.keys(missions)) {
    const full = new FlightState(id);
    const short = new FlightState(id, 'command', { flightLength: 'short' });
    full.preflight = full.countdown = short.preflight = short.countdown = 0;
    assert.equal(shortenedSpaceScale(full), 1, id);
    assert.equal(shortenedSpaceScale(short), .6, id);
    assert.equal(hasShortRoute(short), false, id);
    const hardware = [];
    full.update(10, undefined, 1);
    short.update(6, undefined, 1, undefined, (_state, seconds) => hardware.push(seconds));
    assert.ok(full.position.distanceTo(short.position) < 1e-7, id);
    assert.ok(Math.abs(full.speed - short.speed) < 1e-6, id);
    assert.ok(Math.abs(short.totalTime - 10) < .01, id);
    assert.ok(Math.abs(hardware.reduce((sum, step) => sum + step, 0) - 6) < 1e-7, id);
    assert.equal(short.actualRate, 1, id);
    assert.equal(short.shortRoute, null, id);
  }
});

test('short launch preserves stage events and save continuation without shortening countdown', () => {
  const short = new FlightState('apollo_11', 'command', { flightLength: 'short' });
  short.preflight = 0;
  const countdown = short.countdown;
  short.update(1, undefined, 1);
  assert.equal(short.countdown, countdown - 1);
  short.countdown = 0;
  const full = new FlightState('apollo_11');
  full.preflight = full.countdown = 0;
  full.update(200, undefined, 1);
  short.update(120, undefined, 1);
  assert.ok(short.launch.stageIndex > 0);
  assert.equal(short.launch.stageIndex, full.launch.stageIndex);
  assert.ok(short.position.distanceTo(full.position) < 1e-6);
  const restored = FlightState.fromSave(JSON.parse(JSON.stringify(short.serialize())));
  short.update(.6, undefined, 1);
  restored.update(.6, undefined, 1);
  assert.equal(restored.totalTime, short.totalTime);
  assert.ok(restored.position.distanceTo(short.position) < 1e-9);
  short.paused = true;
  const time = short.totalTime;
  short.update(1, undefined, 1);
  assert.equal(short.totalTime, time);
});

test('short interplanetary flight uses ordinary resource and hardware seconds while MET follows the route', () => {
  const flight = coastFixture('mars');
  flight.flightLength = 'short';
  const initialTime = flight.totalTime;
  const initialEnergy = flight.systems.consumedJ;
  const initialSpeed = flight.speed;
  const steps = [];
  flight.update(1, undefined, 1, () => false, (_state, seconds) => steps.push(seconds));
  assert.equal(flight.actualRate, 1);
  assert.equal(steps.reduce((sum, step) => sum + step, 0), 1);
  assert.ok(steps.every(step => step <= .25));
  assert.ok(Math.abs(flight.totalTime - initialTime - 1e6) < 1e-6);
  assert.ok(Math.abs(flight.systems.consumedJ - initialEnergy - flight.systems.busW) < 1e-6);
  assert.equal(flight.gameplaySeconds, 1);
  const reference = sampleInterplanetary(flight.interplanetary.route, flight.time);
  assert.ok(flight.position.distanceTo(reference.position) < 1e-6);
  assert.ok(flight.velocity.distanceTo(reference.velocity) < 1e-9);
  assert.ok(flight.speed / initialSpeed < 2);
  assert.equal(flight.startWrapit, undefined);
});

test('crew resources advance one second for one second of short flight and checkpoint continuation is deterministic', () => {
  const flight = coastFixture('moon');
  flight.flightLength = 'short';
  const initial = flight.lifeSupport.seconds;
  flight.update(1, undefined, 1);
  assert.equal(flight.lifeSupport.seconds - initial, 1);
  assert.equal(flight.time, 1000);
  const saved = JSON.parse(JSON.stringify(flight.serialize()));
  const restored = FlightState.fromSave(saved);
  flight.update(.25, undefined, 1);
  restored.update(.25, undefined, 1);
  assert.equal(restored.time, flight.time);
  assert.equal(restored.totalTime, flight.totalTime);
  assert.ok(restored.position.distanceTo(flight.position) < 1e-6);
  assert.deepEqual(restored.lifeSupport.serialize(), flight.lifeSupport.serialize());
  restored.paused = true;
  const paused = restored.totalTime;
  restored.update(2, undefined, 1);
  assert.equal(restored.totalTime, paused);
});

test('short route arrival is independent of frame rate and transfers to the existing landing phase', () => {
  const initial = coastFixture('mars');
  initial.flightLength = 'short';
  const saved = initial.serialize();
  const expectedEpoch = initial.totalTime + initial.phase.duration - initial.time;
  for (const hz of [24, 120]) {
    const flight = FlightState.fromSave(saved);
    for (let frame = 0; frame < hz * 60 && flight.kind === 'planetTransfer'; frame++) {
      flight.update(1 / hz, undefined, 1, () => false);
    }
    assert.equal(flight.kind, 'planetOrbit');
    assert.ok(Math.abs(flight.totalTime - expectedEpoch) < 1e-6);
    assert.equal(flight.time, 0);
    assert.equal(flight.actualRate, 1);
  }
  for (const [id, kind] of [['apollo_11', 'moonLanding'], ['mars_2020', 'marsLanding']]) {
    const flight = new FlightState(id, 'command', { flightLength: 'short' });
    flight.preflight = flight.countdown = 0;
    flight.phaseIndex = flight.mission.phases.findIndex(phase => phase.kind === kind);
    flight.path = null;
    flight.update(.25, undefined, 1);
    assert.equal(flight.time, .25);
    assert.equal(shortenedSpaceScale(flight), 1);
  }
});

test('active legacy cinematic saves restore at the same state on pause', () => {
  const flight = coastFixture('mars');
  const saved = flight.serialize();
  saved.wrapit = { active: true };
  const restored = FlightState.fromSave(saved);
  assert.equal(restored.paused, true);
  assert.equal(restored.time, flight.time);
  assert.equal(restored.position.distanceTo(flight.position), 0);
  assert.equal(restored.serialize().wrapit, undefined);
});
