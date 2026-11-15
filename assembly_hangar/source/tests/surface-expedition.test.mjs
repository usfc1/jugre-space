import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceExpedition, helicopterLift, surfaceConfig } from '../surface-expedition.mjs';
test('EVA resource, sample mass, interaction and restoration use actual objects', () => {
  const e = new SurfaceExpedition('apollo_11'), a = e.current, events = [];
  const sample = e.objects.find(o => o.id === 'contingency'); a.p.fromArray(sample.p); a.tool = 1;
  assert.ok(e.interact((t, d) => events.push({ t, d }))); assert.equal(e.sampleKg, .5);
  e.advance(10, { lateral: 1 }); assert.equal(Math.round(a.remainingS), 8990);
  const restored = new SurfaceExpedition('apollo_11', JSON.parse(JSON.stringify(e.serialize())));
  e.advance(1, { longitudinal: 1 }); restored.advance(1, { longitudinal: 1 });
  assert.deepEqual(restored.serialize(), e.serialize()); assert.ok(events.some(x => x.t === 'sampleCollected'));
  a.remainingS = .01; e.advance(.1); assert.equal(a.status, 'failed');
});
test('EVA autopilot physically visits the objects and returns the required sample mass', () => {
  const e = new SurfaceExpedition('apollo_11'), events = [];
  for (let i = 0; i < 12000 && !e.returned; i++) e.autopilot(.1, (type, detail) => events.push({ type, detail }));
  assert.ok(e.returned, JSON.stringify({ p: e.current.p.toArray(), next: e.nearest()?.id, tool: e.current.tool, photos: e.photos }));
  assert.ok(e.loadedKg >= 20); assert.ok(e.objects.find(o => o.id === 'seismometer').done); assert.ok(e.objects.find(o => o.id === 'reflector').done);
  assert.ok(events.some(e => e.type === 'evaReturned'));
});
test('rover terrain, battery, drill inventory, delayed queue and drive save are consistent', () => {
  const e = new SurfaceExpedition('mars_2020'), a = e.current;
  e.advance(10, { drive: 1 }); assert.ok(a.distanceM > 5); assert.ok(a.energyJ < surfaceConfig.rover.perseverance.capacityJ);
  assert.equal(a.p.y, e.height(a.p.x, a.p.z));
  const rock = e.objects.find(o => o.id === 'rock0'); a.p.fromArray(rock.p); a.tool = 3;
  e.interact(); e.interact(); assert.equal(a.inventory[0].sealed, true);
  e.enqueue({ drive: 1 }); const p = a.p.clone(); e.advance(4, {}, new Set(), 'realism'); assert.ok(a.p.distanceTo(p) < 1);
  const copy = new SurfaceExpedition(e.id, JSON.parse(JSON.stringify(e.serialize())));
  e.advance(8, {}, new Set(), 'realism'); copy.advance(8, {}, new Set(), 'realism'); assert.deepEqual(copy.serialize(), e.serialize());
});
test('automated Mars operations transport real samples, heat the battery at night, and fly the first sortie', () => {
  const expedition = new SurfaceExpedition('mars_2020'), events = [];
  const emit = (type, detail) => events.push({ type, detail });
  for (let i = 0; i < 4500 && !expedition.returned; i++) {
    expedition.autopilot(.5, emit);
    if (expedition.operations.stage === 14 && !expedition.nightComplete) expedition.waitForDawn(emit);
  }
  assert.equal(expedition.deposited.length, 10);
  assert.equal(new Set(expedition.deposited.map(t => t.rock)).size, 3);
  assert.ok(events.find(e => e.type === 'firstNightHeated')?.detail.energyJ > 0);
  assert.ok(events.find(e => e.type === 'helicopterLanded')?.detail.hoverSeconds >= 30);
  assert.ok(expedition.returned);
});
test('Ingenuity lift follows rho and rpm squared; standard hover and depleted descent are physical', () => {
  assert.ok(Math.abs(helicopterLift(2000) / helicopterLift(1000) - 4) < 1e-10);
  assert.equal(helicopterLift(2000, .0245) / helicopterLift(2000), 2);
  const e = new SurfaceExpedition('mars_2020'); e.actors[0].p.x = -10; e.switchActor();
  const h = e.current; h.p.set(3, 3, 0); h.status = 'flying'; h.rpm = 1400;
  e.advance(10); assert.ok(Math.abs(h.v.y) < .1); assert.ok(Math.abs(h.p.y - 3) < 1); assert.ok(h.energyJ < 70000);
  h.energyJ = 6000; const events = []; e.advance(20, {}, new Set(), 'standard', t => events.push(t));
  assert.ok(h.emergency); assert.ok(events.includes('helicopterEmergency')); assert.ok(['landed', 'failed'].includes(h.status));
});
