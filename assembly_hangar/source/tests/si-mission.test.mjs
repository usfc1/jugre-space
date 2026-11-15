import test from 'node:test';
import assert from 'node:assert/strict';
import { missionFromSiProposal } from '../si-mission.mjs';
import { planMission } from '../mission-plan.mjs';

const lunar = { name: 'Lunar science', destination: 'moon', goal: 'expedition', crewCount: 4, payloadMassKg: 232, returnRequired: true };

test('maps the lunar concept into the actual validated mission model', () => {
  const spec = missionFromSiProposal(lunar, 'si-test');
  assert.equal(spec.id, 'si-test');
  assert.equal(spec.payloadMassKg, 232);
  assert.equal(spec.crewCount, 4);
  assert.equal(spec.returnRequired, true);
  assert.equal(planMission(spec).unavailable.length, 0);
});

test('does not silently change unsupported mission requirements', () => {
  assert.throws(() => missionFromSiProposal({ ...lunar, crewCount: 5 }, 'si-test'), /four astronauts/);
  assert.throws(() => missionFromSiProposal({ ...lunar, goal: 'landing' }, 'si-test'), /lunar profile/);
  assert.throws(() => missionFromSiProposal({ ...lunar, destination: 'mars', goal: 'orbit' }, 'si-test'), /uncrewed/);
  assert.throws(() => missionFromSiProposal({ ...lunar, payloadMassKg: -1 }, 'si-test'), /invalid/);
});

test('preserves payload mass for uncrewed Earth missions', () => {
  const spec = missionFromSiProposal({ name: 'Earth observer', destination: 'earth', goal: 'science', crewCount: 0,
    payloadMassKg: 80, returnRequired: false }, 'si-test');
  assert.equal(spec.payloadMassKg, 80);
  assert.equal(spec.type, 'science');
  assert.ok(spec.spacecraft);
});
