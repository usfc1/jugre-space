import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Group } from 'three';
import { FlightRigidPhysics } from '../flight-rigid.mjs';
import { apolloTransposition, captureParts, finishSkippedManeuver } from '../flight-maneuvers.mjs';
import { findPart } from '../flight-layout.mjs';
import { apolloExtractionDuration } from '../short-flight.mjs';
import { coastFixture } from './flight-fixtures.mjs';
import { FlightState } from '../flight-missions.mjs';

test('65% shorter Apollo extraction still requires and achieves aligned physical ports', async () => {
  const bytes = await readFile(new URL('../../models/rockets/saturn_v_sa506.glb', import.meta.url));
  for (const flightLength of ['full', 'short']) {
    const duration = apolloExtractionDuration({ realTimeLunar: true, flightLength });
    assert.equal(duration, flightLength === 'short' ? 1260 : 3600);
    const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const payload = captureParts(new Group(), scene, ['columbia_csm', 'eagle_lm']);
    const csm = findPart(payload, 'columbia_csm'), eagle = findPart(payload, 'eagle_lm');
    const pose = apolloTransposition(payload);
    const rigid = Object.assign(Object.create(FlightRigidPhysics.prototype), {
      assemblySample: null, assemblyCaptured: false, geometryRevision: 0,
    });
    for (const progress of [0, .24, .42, .64, .9, .999]) {
      pose(progress);
      assert.equal(rigid.confirmAssemblyCapture(csm, eagle, progress, duration), false);
    }
    pose(1);
    assert.equal(rigid.confirmAssemblyCapture(csm, eagle, 1, duration), true);
    assert.equal(rigid.assemblyCaptured, true);
  }
});

test('short extraction forecast advances by 65% and stays pending until a docking event', () => {
  const flight = coastFixture('apollo');
  flight.reported.delete('apolloTransposition');
  const event = flight.timeline.events.find(event => event.id === 'lm-extraction');
  event.actualTime = null;
  event.status = 'PENDING';
  flight.time = flight.path.burnDuration + 1680;
  flight.totalTime = flight.phaseStartTime + flight.time;
  flight.timeline.update();
  const full = flight.timeline.expected(event);
  flight.flightLength = 'short';
  const short = flight.timeline.expected(event);
  assert.ok(Math.abs(full - short - 2340) < 1e-6);
  assert.notEqual(event.status, 'COMPLETE');
  flight.report('dock', { target: 'eagle' }, 'apolloTransposition');
  assert.equal(event.status, 'COMPLETE');
});

test('skipping Apollo from any progress completes the actual capture in full and short missions', async () => {
  const bytes = await readFile(new URL('../../models/rockets/saturn_v_sa506.glb', import.meta.url));
  for (const flightLength of ['full', 'short']) for (const progress of [0, .5, .99999]) {
    const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const payload = captureParts(new Group(), scene, ['columbia_csm', 'eagle_lm']);
    const csm = findPart(payload, 'columbia_csm'), eagle = findPart(payload, 'eagle_lm');
    const pose = apolloTransposition(payload);
    const rigid = Object.assign(Object.create(FlightRigidPhysics.prototype), {
      assemblySample: null, assemblyCaptured: false, geometryRevision: 0,
    });
    const duration = apolloExtractionDuration({ realTimeLunar: true, flightLength });
    let finished = 0;
    const action = { duration, time: duration * progress, pose(p) {
      pose(p);
      rigid.confirmAssemblyCapture(csm, eagle, p, duration);
    }, finish() { finished++; } };
    action.pose(progress);
    finishSkippedManeuver(action);
    assert.equal(rigid.assemblyCaptured, true, `${flightLength}/${progress}`);
    assert.equal(finished, 1);
    assert.equal(action.time, duration);
  }
});

test('skip advances the passive route, clock and crew, keeps pause and produces a valid save', () => {
  const initial = coastFixture('apollo');
  for (const flightLength of ['full', 'short']) {
    const flight = FlightState.fromSave(initial.serialize());
    flight.flightLength = flightLength;
    flight.paused = true;
    const before = { time: flight.time, epoch: flight.totalTime, crew: flight.lifeSupport.seconds, phase: flight.phaseIndex };
    const duration = apolloExtractionDuration(flight);
    assert.ok(Math.abs(flight.skipPresentation(duration) - duration) < 1e-6);
    assert.ok(Math.abs(flight.time - before.time - duration) < 1e-6);
    assert.ok(Math.abs(flight.lifeSupport.seconds - before.crew - duration) < 1e-6);
    assert.equal(flight.paused, true);
    assert.equal(flight.phaseIndex, before.phase);
    assert.ok(flight.position.distanceTo(flight.path.sample(flight.time).position) < 1e-7);
    const saved = FlightState.fromSave(JSON.parse(JSON.stringify(flight.serialize())));
    assert.equal(saved.totalTime, flight.totalTime);
    assert.equal(saved.paused, true);
    flight.failed = true;
    assert.equal(flight.skipPresentation(duration), 0);
    assert.equal(flight.totalTime, saved.totalTime);
  }
});

test('skip completes generic deployment and separation callbacks while their phase stays suspended', () => {
  for (const id of ['dart', 'mars_2020', 'iss_resupply']) {
    const flight = new FlightState(id);
    flight.paused = true;
    const phaseTime = flight.time;
    const epoch = flight.totalTime;
    const poses = [];
    let finishes = 0;
    const action = { duration: 4, time: 1, pose: p => poses.push(p), finish: () => finishes++ };
    flight.skipPresentation(action.duration - action.time);
    finishSkippedManeuver(action);
    assert.equal(flight.totalTime, epoch + 3);
    assert.equal(flight.time, phaseTime);
    assert.equal(flight.paused, true);
    assert.equal(poses.at(-1), 1);
    assert.equal(finishes, 1);
  }
});
