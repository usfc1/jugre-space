import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareParts } from '../assembly.mjs';
import { importProject, missionProject, openProjectLibrary, PROJECT_LIBRARY_KEY } from '../mission-projects.mjs';
import { MISSION_STORAGE_KEY, newMission } from '../mission-specification.mjs';

const specs = prepareParts(JSON.parse(readFileSync(new URL('../../../original_parts/manifest.json', import.meta.url))).parts);
const storageWith = (...items) => {
  const values = new Map(items);
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test('legacy mission migrates, three projects persist, and export preserves the exact valid assembly', () => {
  const legacy = { ...newMission('old'), schemaVersion: 0, durationHours: 2 };
  const storage = storageWith([MISSION_STORAGE_KEY, JSON.stringify(legacy)]);
  let library = openProjectLibrary(storage, specs);
  assert.equal(library.active(), 'old');
  assert.equal(library.get('old').spec.durationS, 7200);
  const carrier = library.save(missionProject(newMission('carrier'), { carrier: 'apollo_11' }));
  const custom = library.save(missionProject({ ...newMission('custom'), assembly: 'manual' }, { layout: [{ key: 'tank', part: 'b_240_rezerv' }] }));
  library.save({ ...carrier, archived: true }, { activate: false });
  library = openProjectLibrary(storage, specs);
  assert.equal(library.list().length, 3);
  assert.equal(library.active(), 'custom');
  assert.equal(library.get('carrier').archived, true);
  assert.deepEqual(importProject(JSON.stringify(library.get('custom')), specs), custom);
  assert.equal(library.get('carrier').spec.blueprintId, 'carrier-apollo_11');
  assert.ok(custom.spec.blueprintId.startsWith('assembly-'));
  assert.equal(storage.getItem(MISSION_STORAGE_KEY), JSON.stringify(legacy));
  library.remove('custom');
  assert.equal(openProjectLibrary(storage, specs).active(), null);
});

test('an invalid import or an unsuccessful storage write cannot alter the library', () => {
  const storage = storageWith();
  const library = openProjectLibrary(storage, specs);
  const valid = library.save(missionProject(newMission('saved')));
  const raw = storage.getItem(PROJECT_LIBRARY_KEY);
  for (const corrupt of [{ ...valid, version: 999 }, { ...valid, selection: { carrier: 'constructor' } },
    { ...valid, selection: { layout: [{ key: 'x', part: 'not-in-catalog' }] } }, { ...valid, result: { status: 'COMPLETED' } }]) {
    assert.throws(() => importProject(JSON.stringify(corrupt), specs));
  }
  storage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.throws(() => library.save(missionProject(newMission('unsaved'))), /QuotaExceeded/);
  assert.deepEqual(library.list(), [valid]);
  assert.equal(library.active(), 'saved');
  assert.equal(storage.getItem(PROJECT_LIBRARY_KEY), raw);
});
