import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareParts } from '../assembly.mjs';
import { assessVehicle } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { newMission } from '../mission-specification.mjs';
import { importProject, missionProject } from '../mission-projects.mjs';
import { trainingLayout } from '../assembly-workflow.mjs';
import { defaultSpacecraft } from '../spacecraft-design.mjs';
import { FlightState } from '../flight-missions.mjs';
const original = JSON.parse(readFileSync(new URL('../../../original_parts/manifest.json', import.meta.url))).parts;
const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url)));
const specs = prepareParts({ ...original, ...manifest.stagingParts, ...manifest.payloadParts });
test('the real training rocket is ready and its deliberate fuel shortage fails the same validator', () => {
  const spec = newMission();
  assert.equal(assessVehicle(planMission(spec), trainingLayout, specs).ready, true);
  assert.equal(assessVehicle(planMission({ ...spec, propellantFraction: .05 }), trainingLayout, specs).ready, false);
});
test('payload equipment survives project import, changes stage mass once and reaches flight telemetry', () => {
  const spec = { ...newMission(), spacecraft: defaultSpacecraft, type: 'science', durationS: 14400, assembly: 'manual' };
  const base = trainingLayout.map(entry => entry.key === 'satellite' ? { ...entry, spacecraft: defaultSpacecraft } : entry);
  const enhanced = base.map(entry => entry.key === 'satellite' ? { ...entry, spacecraft: { ...defaultSpacecraft, instrumentIds: ['wide', 'mag'] } } : entry);
  const first = assessVehicle(planMission(spec), base, specs);
  const finalSpec = { ...spec, spacecraft: enhanced.at(-1).spacecraft };
  const second = assessVehicle(planMission(finalSpec), enhanced, specs);
  assert.ok(Math.abs(second.performance.wetMassKg - first.performance.wetMassKg - 4) < 1e-8);
  const imported = importProject(JSON.stringify(missionProject(finalSpec, { layout: enhanced })), specs);
  assert.deepEqual(imported.selection.layout, enhanced);
  const flight = new FlightState('designed', 'command', { design: { spec: finalSpec, layout: enhanced,
    carrier: null, vehicle: second.vehicle, cabin: second.cabin, checks: second.checks }, vehicle: second.vehicle });
  assert.ok(flight.satellite);
  assert.deepEqual(flight.design.spec.spacecraft.instrumentIds, ['wide', 'mag']);
});
