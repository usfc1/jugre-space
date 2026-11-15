import test from 'node:test';
import assert from 'node:assert/strict';
import { MissionExecution } from '../mission-execution.mjs';
import { historicalPlan } from '../historical-objectives.mjs';
import { FlightState } from '../flight-missions.mjs';
test('all seven Appendix B configurations contain primary goals with explicit evidence rules', () => {
  for (const id of ['apollo_11', 'artemis_ii', 'mars_2020', 'mars_science_laboratory', 'dart', 'voyager_2', 'iss_resupply']) {
    const plan = historicalPlan(id); assert.ok(plan.objectives.some(o => o.tier === 'primary'));
    assert.ok(plan.objectives.filter(o => !o.future).every(o => o.signals.length), id);
    const f = new FlightState(id), e = f.historicalExecution; e.observe(f, 'tick', {}, 1e12);
    assert.equal(e.complete, false); assert.equal(e.medal(f), null);
    const restored = new MissionExecution(id, e.serialize()); assert.deepEqual(restored.serialize(), e.serialize());
  }
});
test('valid evidence completes a goal, unvalidated timestamps do not, and old saves use defaults', () => {
  const f = new FlightState('apollo_11'), e = f.historicalExecution;
  e.observe(f, 'computerDecision', { go: false }); assert.equal(e.objectives.find(o => o.id === '1-4-2').state, 'ACTIVE');
  e.observe(f, 'computerDecision', { go: true }); assert.equal(e.objectives.find(o => o.id === '1-4-2').state, 'COMPLETED');
  const save = f.serialize(), copy = FlightState.fromSave(save); assert.deepEqual(copy.historicalExecution.serialize(), e.serialize());
  delete save.historicalObjectives; assert.equal(FlightState.fromSave(save).historicalExecution.complete, false);
});
