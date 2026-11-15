import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { FlightState } from '../flight-missions.mjs';
import { ControlBindings, FlightInput, controlContext, controlsKey, routeFlightInput } from '../flight-controls.mjs';
import { controlProfiles } from '../control-profiles.mjs';
import { canCapture } from '../flight-rigid.mjs';

const command = (state, axes = {}, ...actions) => ({ ...controlContext(state), axes, actions: new Set(actions) });
function ascent() {
  const flight = new FlightState('apollo_11');
  flight.update(40);
  return flight;
}
function orbit() {
  const flight = ascent();
  flight.update(30, undefined, 100, () => false);
  assert.equal(flight.kind, 'orbit');
  return flight;
}
function kinematics(flight) {
  return {
    phase: flight.phaseIndex, clock: flight.totalTime, phaseTime: flight.time,
    position: flight.position.toArray(), velocity: flight.velocity.toArray(),
    fuel: flight.fuelMassKg, mass: flight.massKg, launch: flight.launch.snapshot(),
    crew: flight.lifeSupport.serialize(),
  };
}

test('a manual frame is routed to exactly one owner and expires on phase changes', () => {
  const flight = ascent();
  const owners = [];
  const handlers = Object.fromEntries(['launch', 'trajectory', 'physx'].map(id => [id, () => owners.push(id)]));
  assert.equal(flight.setMode('manual'), true);
  const rocket = command(flight, { pitch: 1 }, 'cutoff');
  assert.equal(routeFlightInput(flight, rocket, 1, handlers), true);
  assert.equal(routeFlightInput(flight, rocket, 10, handlers), false);
  flight.paused = true;
  assert.equal(routeFlightInput(flight, rocket, 1, handlers), false);

  const orbitalFlight = orbit();
  orbitalFlight.setMode('manual');
  const spacecraft = command(orbitalFlight, { yaw: 1 });
  assert.equal(routeFlightInput(orbitalFlight, rocket, 1, handlers), false);
  assert.equal(routeFlightInput(orbitalFlight, { ...spacecraft, actorId: 'other' }, 1, handlers), false);
  assert.equal(routeFlightInput(orbitalFlight, spacecraft, 1, handlers), true);
  assert.equal(routeFlightInput(orbitalFlight, { ...spacecraft, presentation: true }, 1, handlers), false);
  orbitalFlight.phaseIndex = orbitalFlight.mission.phases.findIndex(phase => phase.kind === 'moonLanding');
  assert.match(controlContext(orbitalFlight).reason, /GUIDED SEGMENT/i);
  assert.equal(routeFlightInput(orbitalFlight, command(orbitalFlight), 1, handlers), false);
  assert.deepEqual(owners, ['launch', 'trajectory']);
});

test('orbital takeover and handback preserve pose, trajectory, phase, time and resources', () => {
  const flight = orbit();
  const reference = FlightState.fromSave(flight.serialize());
  const pose = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .25);
  const before = kinematics(flight);
  assert.equal(flight.setMode('manual', { attitude: pose }), true);
  assert.deepEqual(kinematics(flight), before);
  assert.deepEqual(flight.manualControl.attitude.toArray(), pose.toArray());
  flight.update(.5, command(flight, { pitch: 1 }));
  reference.update(.5);
  assert.deepEqual(kinematics(flight), kinematics(reference));
  assert.ok(flight.manualControl.attitude.angleTo(pose) > .01);
  const beforeHandback = kinematics(flight);
  const handbackPose = flight.manualControl.attitude.toArray();
  assert.equal(flight.setMode('command'), true);
  assert.deepEqual(kinematics(flight), beforeHandback);
  assert.deepEqual(flight.manualControl.attitude.toArray(), handbackPose);
  flight.update(.5);
  reference.update(.5);
  assert.deepEqual(kinematics(flight), kinematics(reference));
});

test('manual rocket commands use the original thrust and steering solver and are gated by tempo and pause', () => {
  const flight = ascent();
  flight.setMode('manual');
  const previousYaw = flight.yaw;
  flight.update(.5, command(flight, { yaw: 1 }, 'cutoff'), 10);
  assert.equal(flight.throttle, 1);
  assert.ok(Math.abs(flight.yaw - previousYaw) < 1e-9);
  flight.paused = true;
  const before = kinematics(flight);
  flight.update(.5, command(flight, { yaw: 1 }, 'cutoff'));
  assert.equal(flight.throttle, 1);
  assert.deepEqual(kinematics(flight), before);
  flight.paused = false;
  flight.update(.5, command(flight, { yaw: 1 }, 'cutoff'));
  assert.equal(flight.throttle, 0);
  assert.equal(flight.launch.thrustN, 0);
  assert.ok(flight.yaw > previousYaw);
  flight.update(.5, command(flight, { throttle: 1 }));
  assert.ok(Math.abs(flight.throttle - .15) < 1e-10);
});

test('v1 checkpoints use control defaults and round-trip a live manual orbital attitude', () => {
  const launch = ascent();
  launch.setMode('manual');
  const legacy = launch.serialize();
  delete legacy.manualControl;
  const restored = FlightState.fromSave(legacy);
  assert.equal(restored.mode, 'manual');
  assert.deepEqual(restored.serialize().manualControl, {
    version: 1, profile: 'rocket', actorId: 'vessel', assistance: 'standard', sas: false,
    rcs: true, precision: false, attitude: null, angularRate: [0, 0, 0],
  });
  assert.deepEqual(kinematics(restored), kinematics(launch));

  const flight = orbit();
  flight.setMode('manual');
  flight.manualControl.assistance = 'arcade';
  flight.update(.4, command(flight, { yaw: 1 }, 'precision'));
  const current = JSON.parse(JSON.stringify(flight.serialize()));
  const resumed = FlightState.fromSave(current);
  assert.equal(resumed.mode, 'manual');
  assert.deepEqual(resumed.serialize().manualControl, current.manualControl);
  delete current.manualControl;
  assert.equal(FlightState.fromSave(current).mode, 'command');
});

test('binding conflicts include aliases, while remaps and controller edges survive their expected lifecycle', () => {
  const slots = new Map();
  const storage = { getItem: key => slots.get(key) ?? null, setItem: (key, value) => slots.set(key, value) };
  const bindings = new ControlBindings(storage);
  assert.equal(Object.keys(controlProfiles).length, 6);
  assert.match(bindings.remap('rocket', 'cutoff', 'KeyZ'), /already assigned/);
  assert.match(bindings.remap('rocket', 'cutoff', 'ArrowUp'), /already assigned/);
  assert.equal(bindings.remap('rocket', 'cutoff', 'KeyC'), '');
  assert.equal(JSON.parse(slots.get(controlsKey)).profiles.rocket.cutoff, 'KeyC');
  const input = new FlightInput(new ControlBindings(storage));
  const context = controlContext(ascent());
  assert.equal(input.matchKey(context, 'KeyX'), undefined);
  assert.equal(input.matchKey(context, 'KeyC'), 'cutoff');
  input.keyDown('KeyC', false);
  assert.equal(input.sample(context).actions.has('cutoff'), true);
  assert.equal(input.sample(context).actions.has('cutoff'), false);
  const pad = { mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })) };
  input.sample(context, pad);
  pad.axes[1] = -1;
  pad.buttons[0].pressed = true;
  const sample = input.sample(context, pad);
  assert.equal(sample.axes.pitch, 1);
  assert.equal(sample.actions.has('stage'), true);
  assert.equal(input.sample(context, pad).actions.has('stage'), false);
  input.clear();
  assert.equal(input.sample(context, pad).axes.pitch, 0);
});

test('assistance levels change the actual docking tolerance and standard preserves the previous threshold', () => {
  const capture = { distanceM: .2, speedMps: .3, angleRad: .05 };
  assert.equal(canCapture(capture), true);
  assert.equal(canCapture(capture, 'realism'), false);
  capture.distanceM = .25;
  assert.equal(canCapture(capture), false);
  assert.equal(canCapture(capture, 'arcade'), true);
});
