import assert from 'node:assert/strict';
import test from 'node:test';
import { MarsEdlControl } from '../mars-edl-control.mjs';

test('both Mars EDL profiles reach contact and clear the rover; reconstruction preserves the remaining descent', () => {
  for (const nav of [true, false]) {
    const model = new MarsEdlControl(nav), events = [];
    for (let i = 0; i < 270; i++) model.advance(1, {}, true, t => events.push(t));
    const restored = new MarsEdlControl(nav, model.serialize());
    for (const lander of [model, restored]) for (let i = 0; i < 400; i++) lander.advance(1, {}, true, t => events.push(t));
    assert.deepEqual(restored.serialize(), model.serialize());
    assert.equal(model.phase, 'completed'); assert.ok(model.touchdownMps <= .75);
    assert.ok(events.includes('rangeTrigger')); assert.ok(events.includes('tethersCut')); assert.ok(events.includes('craneFlyaway'));
    assert.equal(events.includes('safeSiteSelected'), nav);
  }
});

test('out of window parachute and hard crane touchdown do not grant contact', () => {
  const lander = new MarsEdlControl(false), events = [];
  const emit = t => events.push(t);
  assert.equal(lander.command('parachute', emit), false);
  lander.phase = 'crane'; lander.heightM = 7.5; lander.ropeM = 7.4; lander.ropeRateMps = 1.2;
  lander.advance(1, {}, false, emit);
  assert.equal(lander.phase, 'failed'); assert.ok(!events.includes('skyCraneTouchdown'));
});
