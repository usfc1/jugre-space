import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareParts } from '../assembly.mjs';
import { assessVehicle } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { readMission } from '../mission-specification.mjs';
import { newStandardDraft, prepareStandardMission, readStandardDraft, standardDraftFromMission, standardMissionSpecification } from '../standard-mission.mjs';

const specs = prepareParts(JSON.parse(readFileSync(new URL('../../../original_parts/manifest.json', import.meta.url))).parts);

test('Standard drafts persist selections and reject unavailable destinations or broken state', () => {
  const draft = { ...newStandardDraft('standard-save'), instrumentIds: ['wide', 'mag'], budgetM: 20, step: 3 };
  assert.deepEqual(readStandardDraft(JSON.parse(JSON.stringify(draft))), draft);
  for (const invalid of [{ destination: 'mars' }, { goal: 'docking' }, { crewCount: 2 }, { step: 5 },
    { instrumentIds: ['wide', 'wide'] }, { instrumentIds: ['unknown'] }, { budgetM: -1 }]) {
    assert.throws(() => readStandardDraft({ ...draft, ...invalid }));
  }
});

test('Standard authoring produces the existing mission schema and keeps the selected payload', () => {
  const spec = standardMissionSpecification({ ...newStandardDraft('shared-schema'), goal: 'deployment', instrumentIds: ['mag'] });
  assert.deepEqual(readMission(spec), spec);
  assert.equal(spec.id, 'shared-schema');
  assert.equal(spec.type, 'deployment');
  assert.deepEqual(spec.spacecraft.instrumentIds, ['mag']);
  assert.deepEqual(standardDraftFromMission(spec).instrumentIds, ['mag']);
  assert.equal(standardMissionSpecification({ ...newStandardDraft('orbit'), goal: 'orbit' }).spacecraft, null);
});

test('automatic engineering resolves pointing and power using the shared assessment', async () => {
  const prepared = await prepareStandardMission({ ...newStandardDraft('precision'), instrumentIds: ['hires'] }, specs);
  assert.equal(prepared.candidate.ready, true);
  assert.equal(prepared.spec.spacecraft.attitude, 'precision');
  const report = assessVehicle(planMission(prepared.spec), prepared.candidate.blueprint.carrier ?? prepared.candidate.blueprint.layout, specs);
  assert.deepEqual(prepared.candidate.checks, report.checks);
  assert.deepEqual(prepared.candidate.performance, report.performance);
  assert.equal(prepared.candidate.spacecraft.costM, report.spacecraft.costM);
  assert.equal(report.checks.find(item => item.id === 'structures').status, 'UNKNOWN');
});

test('an unaffordable payload fails its real budget check and a simpler payload fixes it', async () => {
  const draft = { ...newStandardDraft('budget'), instrumentIds: ['hires'], budgetM: 10 };
  const expensive = await prepareStandardMission(draft, specs);
  assert.equal(expensive.candidate.ready, false);
  assert.equal(expensive.candidate.checks.find(item => item.id === 'budget').status, 'FAIL');
  const corrected = await prepareStandardMission({ ...draft, instrumentIds: ['wide'] }, specs);
  assert.equal(corrected.candidate.ready, true);
  assert.ok(corrected.candidate.spacecraft.costM <= 10);
});

test('lunar Standard mission uses the existing four-seat expedition and real resource requirements', async () => {
  const draft = { ...newStandardDraft('lunar-standard'), destination: 'moon', goal: 'expedition', crewCount: 4, cargoId: 'light' };
  const result = await prepareStandardMission(draft, specs);
  assert.equal(result.spec.crewCount, 4);
  assert.equal(result.spec.payloadMassKg, 50);
  assert.equal(result.candidate.ready, true);
  assert.equal(result.candidate.blueprint.carrier, 'artemis_ii');
  assert.ok(result.spec.cabin.oxygenKg > 0);
  assert.ok(result.plan.expedition.fuelKg > 0);
  assert.ok(result.plan.phases.some(item => item.id === 'recovery'));
  assert.equal(standardDraftFromMission(result.spec).cargoId, 'light');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareStandardMission(draft, specs, { signal: controller.signal }), { name: 'AbortError' });
});
