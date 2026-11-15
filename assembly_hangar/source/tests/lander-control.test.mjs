import test from 'node:test';
import assert from 'node:assert/strict';
import { LanderControl, landingQuality } from '../lander-control.mjs';
test('probe contact, engine cutoff and touchdown survive a round trip', () => {
  const l = new LanderControl(); l.p.y = 4; l.alarm = null;
  let probe = false;
  for (let i = 0; i < 1000 && !l.contact; i++) l.advance(.02, {}, new Set(), false, type => { probe ||= type === 'probeContact'; });
  assert.ok(probe); assert.ok(l.fuelKg < l.config.initialFuelKg);
  l.shutdown(); const saved = new LanderControl('moon', l.serialize());
  for (let i = 0; i < 1000 && l.status === 'descending'; i++) { l.advance(.02); saved.advance(.02); }
  assert.deepEqual(saved.serialize(), l.serialize()); assert.equal(l.status, 'hard');
  const landed = new LanderControl('moon', l.serialize()); assert.deepEqual(landed.p, l.p);
});
test('landing outcomes and fuel failures are physical', () => {
  assert.equal(landingQuality(.6, .1, 1), 'excellent'); assert.equal(landingQuality(2, .1, 1), 'hard');
  assert.equal(landingQuality(4, 0, 0), 'crashed'); assert.equal(landingQuality(.5, 2, 0), 'crashed');
  const l = new LanderControl(); l.fuelKg = 0; const events = [];
  l.advance(1, {}, new Set(), false, type => events.push(type)); assert.equal(l.status, 'failed'); assert.ok(events.includes('landingFuelExhausted'));
});
