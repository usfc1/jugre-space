import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FlightState, missions, customMission, EARTH_RADIUS, launchUp } from '../flight-missions.mjs';
import { formatMissionTime } from '../mission-clock.mjs';
import { createMissionTimelineConfig, registerMissionTimeline } from '../mission-timeline-config.mjs';
import { orbitalPeriapsis } from '../mission-timeline.mjs';

const event = (s, id) => s.timeline.events.find(e => e.id === id);
const simulate = (s, seconds, frame = .05, rate = 1) => {
  for (let t = 0; t < seconds - 1e-8; t += frame) s.update(Math.min(frame, seconds - t), {}, rate);
  return s;
};
const launch = id => simulate(new FlightState(id), 18);
function finishMission(s) {
  for(let i=0;i<1000&&!s.complete&&!s.failed;i++){
    advanceMission(s);
  }
  return s;
}
function advanceMission(s) {
  const remaining = s.phase.duration - s.time;
  if (remaining > 300 && s.path?.physical && !s.path.isPowered(s.time)) {
    s.advanceCoast(Math.min(remaining - .25, s.lifeSupport ? 3600 : remaining));
  } else s.update(60, {}, 500, () => false);
}

test('countdown, elapsed time, multi-day formatting and nonwrapping days', () => {
  assert.equal(formatMissionTime(-9.01, false), 'T− 00:00:10');
  assert.equal(formatMissionTime(15.99), 'T+ 00:00:15');
  assert.equal(formatMissionTime(90061), 'T+ 1d 01:01:01');
  assert.equal(formatMissionTime(1234 * 86400 + 4), 'T+ 1234d 00:00:04');
  assert.equal(formatMissionTime(0, false), 'T− 00:00:00');
});

test('preflight and countdown share simulation time and ignore time warp', () => {
  const a = simulate(new FlightState('apollo_11'), 9.5, .1, 1);
  const b = simulate(new FlightState('apollo_11'), 9.5, .1, 100);
  assert.ok(Math.abs(a.countdown - 6) < 1e-7);
  assert.ok(Math.abs(a.countdown - b.countdown) < 1e-7);
  assert.equal(a.timeline.clock.launched, false);
});

test('clock switches to T+ only on physical liftoff, not countdown expiry', () => {
  const s = new FlightState('apollo_11');
  s.update(15.5);
  assert.equal(s.countdown, 0);
  assert.equal(s.timeline.clock.launched, false);
  simulate(s, 3);
  assert.equal(s.timeline.clock.launched, true);
  assert.equal(event(s, 'liftoff').actualTime, 0);
});

test('countdown holds, pauses and resumes without accumulating hidden time', () => {
  const s = simulate(new FlightState('apollo_11'), 8);
  const before = s.countdown;
  s.hold(); s.update(100);
  assert.equal(s.countdown, before);
  assert.equal(s.timeline.status.state, 'HOLD');
  s.hold(); s.paused = true; s.update(100);
  assert.equal(s.countdown, before);
  s.paused = false; s.update(1);
  assert.ok(Math.abs(s.countdown - before + 1) < 1e-8);
});

test('postlaunch pause freezes MET; time warp advances MET with simulation', () => {
  const s = launch('apollo_11');
  s.paused = true;
  const time = s.timeline.clock.seconds;
  s.update(100, {}, 100);
  assert.equal(s.timeline.clock.seconds, time);
  s.paused = false;
  s.update(1, {}, 2);
  assert.ok(Math.abs(s.timeline.clock.seconds - time - 2) < 1e-8);
});

test('frame partition does not change countdown, simulation time or navigation', () => {
  const a = simulate(new FlightState('apollo_11'), 40, .02);
  const b = simulate(new FlightState('apollo_11'), 40, .25);
  assert.ok(Math.abs(a.totalTime - b.totalTime) < 1e-7);
  assert.ok(a.position.distanceTo(b.position) < 1e-6);
  assert.ok(Math.abs(a.timeline.clock.seconds - b.timeline.clock.seconds) < .26);
});

test('abort freezes T− and never produces a liftoff', () => {
  const s = simulate(new FlightState('dart'), 9);
  s.abort();
  const time = s.timeline.clock.seconds;
  s.update(10000);
  assert.equal(s.timeline.clock.seconds, time);
  assert.equal(s.timeline.status.state, 'LAUNCH ABORTED');
  assert.equal(event(s, 'liftoff').status, 'FAILED');
  assert.equal(s.enginePower, 0);
});

test('structural failure before Max Q cannot complete future events', () => {
  const s = launch('apollo_11');
  s.systems.integrity = 0;
  s.fail('structure');
  s.report('maxQ', { peakKPa: 30 });
  s.update(10000);
  assert.equal(event(s, 'max-q').status, 'FAILED');
  assert.equal(event(s, 'orbit').status, 'SKIPPED');
  assert.equal(s.timeline.status.state, 'MISSION FAILED');
});

test('repaired recoverable failure resumes the timeline', () => {
  const s = launch('apollo_11');
  s.fail('temporary-guidance');
  assert.equal(s.recover(), true);
  simulate(s, 110);
  assert.equal(s.failed, false);
  assert.equal(event(s, 'max-q').status, 'COMPLETE');
});

test('separation requires a signal, records failure, and can be retried', () => {
  const s = launch('apollo_11');
  s.report('stageFailure', { stage: 1 });
  assert.equal(event(s, 'stage-1').status, 'FAILED');
  s.separateStage(.8, 1);
  assert.equal(event(s, 'stage-1').status, 'COMPLETE');
  assert.equal(event(s, 'meco').status, 'COMPLETE');
  assert.equal(event(s, 'stage-2').status, 'PENDING');
});

test('elapsed schedules cannot complete missing separation hardware', () => {
  const s = new FlightState('apollo_11');
  s.launch.separationFaults.add(0);
  simulate(s, 250);
  assert.equal(event(s, 'stage-1').status, 'FAILED');
  assert.equal(s.launch.stages[0].attached, true);
  assert.equal(s.kind, 'ascent');
});

test('orbit requires a safe periapsis, not merely high altitude', () => {
  const s = new FlightState('apollo_11');
  s.launch.positionM.copy(launchUp).multiplyScalar((EARTH_RADIUS + 200) * 1000);
  s.launch.velocityMps.copy(launchUp).multiplyScalar(7800);
  s.launch.measure(); s.syncLaunch();
  assert.ok(orbitalPeriapsis(s, new Vector3(), EARTH_RADIUS, 398600.4418) < 100);
  s.phaseIndex = 1; s.timeline.update();
  assert.notEqual(event(s, 'orbit').status, 'COMPLETE');
  s.launch.velocityMps.crossVectors(new Vector3(0, 1, 0), launchUp).normalize().multiplyScalar(7800);
  s.launch.measure(); s.syncLaunch(); s.timeline.update();
  assert.equal(event(s, 'orbit').status, 'COMPLETE');
});

test('unsafe touchdown and scheduled surface phase never grant landing', () => {
  const s = new FlightState('mars_2020');
  s.phaseIndex = 4; s.surface = 'mars'; s.altitude = 0; s.speed = 25;
  s.report('marsTouch');
  assert.notEqual(event(s, 'touchdown').status, 'COMPLETE');
  s.surface = null; s.update(1);
  assert.notEqual(event(s, 'touchdown').status, 'COMPLETE');
  s.surface = 'mars'; s.speed = 0; s.report('marsTouch');
  assert.equal(event(s, 'touchdown').status, 'COMPLETE');
});

test('DART impact is the intended goal despite loss of integrity and radio', () => {
  const s = finishMission(new FlightState('dart'));
  assert.equal(s.complete, true);
  assert.equal(s.failed, false);
  assert.equal(s.systems.integrity, 0);
  assert.equal(event(s, 'impact').status, 'COMPLETE');
  assert.equal(event(s, 'success').status, 'COMPLETE');
  assert.equal(s.timeline.status.state, 'MISSION COMPLETE');
});

test('save/load round trip preserves clocks, vectors, systems and event history', () => {
  const original = simulate(new FlightState('apollo_11'), 110, .05, 2);
  const save = JSON.parse(JSON.stringify(original.serialize()));
  const restored = FlightState.fromSave(save);
  assert.deepEqual(restored.timeline.serialize(), original.timeline.serialize());
  assert.ok(restored.position.distanceTo(original.position) < 1e-8);
  simulate(original, 3); simulate(restored, 3);
  assert.ok(restored.position.distanceTo(original.position) < 1e-6);
  assert.ok(Math.abs(original.timeline.clock.seconds - restored.timeline.clock.seconds) < 1e-8);
});

test('held countdown can be saved and restored; restart resets mission history', () => {
  const s = simulate(new FlightState('artemis_ii'), 9); s.hold();
  const restored = FlightState.fromSave(JSON.parse(JSON.stringify(s.serialize())));
  restored.update(100);
  assert.equal(restored.countdown, s.countdown);
  assert.equal(restored.holding, true);
  const fresh = new FlightState('artemis_ii');
  assert.equal(fresh.timeline.clock.seconds, -10);
  assert.ok(fresh.timeline.events.every(e => e.actualTime === null));
});

test('corrupt save clocks and unknown schema versions are rejected', () => {
  const data = new FlightState('dart').serialize();
  data.values.totalTime = -1;
  assert.throws(() => FlightState.fromSave(data));
  data.version = 999;
  assert.throws(() => FlightState.fromSave(data));
});

test('every registered mission has independent unique event definitions', () => {
  for (const [id, mission] of [...Object.entries(missions), ['custom', customMission]]) {
    const config = createMissionTimelineConfig(id, mission);
    assert.ok(config.events.length >= 10, id);
    assert.equal(new Set(config.events.map(e => e.id)).size, config.events.length, id);
    assert.ok(config.events.every(e => e.description && Number.isFinite(e.expectedTime)), id);
    assert.ok(config.events.every(e => e.historicalTime === null || Number.isFinite(e.historicalTime) && e.timeSource), id);
  }
  const artemis = createMissionTimelineConfig('artemis_ii', missions.artemis_ii);
  assert.ok(!artemis.events.some(e => /LANDING|LUNAR ORBIT/.test(e.label)));
  const v2 = createMissionTimelineConfig('voyager_2', missions.voyager_2);
  assert.equal(v2.events.find(e => e.id === 'uranus').unsupported, true);
});

test('future profiles can be registered without changing renderer', () => {
  registerMissionTimeline('science-test', () => [{ id: 'science', label: 'SCIENCE', phase: 'orbit', signal: 'scienceComplete', description: 'Confirmed instrument result', expectedFraction: .5, condition: 'healthy' }]);
  const c = createMissionTimelineConfig('science-test', customMission);
  assert.equal(c.events.length, 1);
  assert.equal(c.events[0].signal, 'scienceComplete');
});

test('mission-control hooks emit once per completion and do not replay on load', () => {
  const s = new FlightState('apollo_11');
  const cues = [];
  s.timeline.addEventListener('mission-control', e => cues.push(e.detail.cue));
  simulate(s, 20);
  assert.equal(cues.filter(c => c === 'liftoff').length, 1);
  const before = cues.length;
  s.timeline.restore(s.timeline.serialize());
  assert.equal(cues.length, before);
});

test('trajectory changes update forecasts without changing completion', () => {
  const s = launch('apollo_11'); s.mode = 'manual'; s.altitude = 2; s.verticalSpeed = 100;
  const e = event(s, 'max-q');
  const before = e.status;
  const slow = s.timeline.expected(e);
  s.verticalSpeed = 1000;
  assert.ok(s.timeline.expected(e) < slow);
  assert.equal(e.status, before);
});

test('presentation time advances the mission clock while trajectory time is suspended', () => {
  const s = launch('apollo_11');
  const time = s.timeline.clock.seconds, phaseTime = s.time;
  s.advancePresentation(3);
  assert.equal(s.time, phaseTime);
  assert.equal(s.timeline.clock.seconds, time + 3);
  s.paused = true; s.advancePresentation(10);
  assert.equal(s.timeline.clock.seconds, time + 3);
});

test('surface mission cannot declare success without contact confirmation', () => {
  const s = finishMission(new FlightState('mars_2020'));
  assert.equal(s.complete, true);
  assert.equal(event(s, 'touchdown').status, 'SKIPPED');
  assert.equal(s.timeline.status.state, 'MISSION INCOMPLETE');
});

test('a custom crewed Mars architecture uses crew descent, orbit and ascent without a rover sky crane', () => {
  const mission = { title: 'Mars crew', crew: true, phases: ['ascent','orbit','marsTransfer','marsOrbit','marsLanding','marsSurface','marsAscent','earthReturn','reentry'].map(kind => ({ kind, label: kind, duration: 100 })) };
  const c = createMissionTimelineConfig('mars-crew', mission);
  assert.ok(c.events.some(e => e.id === 'mars-orbit'));
  assert.ok(c.events.some(e => e.id === 'mars-ascent'));
  assert.ok(c.events.some(e => e.label === 'MARS LANDING'));
  assert.ok(!c.events.some(e => e.label === 'SKY CRANE'));
});

test('unknown condition names cannot silently complete future events', () => {
  const s = launch('apollo_11');
  assert.equal(s.timeline.condition('typo-in-condition'), false);
});

test('a safe return cannot conceal a missed required lunar objective', () => {
  const s = new FlightState('apollo_11');
  for (const e of s.timeline.events) if (e.required && e.id !== 'landing') e.status = 'COMPLETE';
  s.complete = true;
  s.timeline.update();
  assert.equal(s.timeline.status.state, 'MISSION INCOMPLETE');
  event(s, 'landing').status = 'COMPLETE';
  s.timeline.update();
  assert.equal(s.timeline.status.state, 'MISSION COMPLETE');
});

test('all mission path types continue identically after save/load', () => {
  for (const id of Object.keys(missions)) {
    const s = new FlightState(id);
    let last = -1;
    for (let tick = 0; tick < 5000 && !s.complete && !s.failed; tick++) {
      // Native geometry confirms extraction in the browser. This mechanics-only
      // harness has no GLTF hardware, so acknowledge the elapsed extraction here.
      if(s.id==='apollo_11'&&s.kind==='moonTransfer'&&s.time>5700)s.reported.add('apolloTransposition');
      advanceMission(s);
      if (s.phaseIndex === last) continue;
      last = s.phaseIndex;
      const copy = FlightState.fromSave(JSON.parse(JSON.stringify(s.serialize())));
      copy.update(.05);
      s.update(.05);
      assert.ok(s.position.distanceTo(copy.position) < 1e-6, `${id}/${s.kind}: path reconstruction`);
      assert.ok(Math.abs(s.timeline.clock.seconds - copy.timeline.clock.seconds) < 1e-8);
    }
    assert.ok(s.complete||s.failed,`${id}: did not reach the final phase`);
  }
});
