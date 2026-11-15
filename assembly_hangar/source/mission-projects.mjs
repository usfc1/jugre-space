import { assemblyBlueprint } from './mission-engineering.mjs';
import { launchVehicles } from './launch-vehicles.mjs';
import { loadMission, readMission } from './mission-specification.mjs';

export const PROJECT_LIBRARY_KEY = 'jugre.mission-projects.v1';
export const MAX_PROJECT_FILE_BYTES = 256 * 1024;
const projectFormat = 'jugre-mission-project';
const resultStates = ['COMPLETED', 'INCOMPLETE', 'FAILED', 'ABORTED'];

function readSelection(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid launcher configuration');
  if (value.carrier && value.layout == null && Object.hasOwn(launchVehicles, value.carrier)) {
    return { carrier: value.carrier, layout: null };
  }
  if (value.carrier != null || !Array.isArray(value.layout) || value.layout.length > 64) throw new Error('Invalid launcher configuration');
  for (const entry of value.layout) {
    if (!entry || !['key', 'part'].every(key => typeof entry[key] === 'string' && entry[key].length > 0 && entry[key].length <= 160)
      || (entry.parent !== undefined && !['parent', 'socket', 'plug'].every(key => typeof entry[key] === 'string' && entry[key].length > 0 && entry[key].length <= 160))) {
      throw new Error('Invalid part attachment');
    }
  }
  return { carrier: null, layout: value.layout };
}

function readResult(value) {
  if (value == null) return null;
  const { status, elapsedS, completed, total, downlinkedMB = null, reason = '' } = value;
  if (!resultStates.includes(status) || !Number.isFinite(elapsedS) || elapsedS < 0
    || !Number.isInteger(total) || total < 1 || total > 64 || !Number.isInteger(completed) || completed < 0 || completed > total
    || (status === 'COMPLETED' && completed !== total)
    || (downlinkedMB != null && (!Number.isFinite(downlinkedMB) || downlinkedMB < 0))
    || typeof reason !== 'string' || reason.length > 240) throw new Error('Invalid project results');
  return { status, elapsedS, completed, total, downlinkedMB, reason };
}

export function readProject(input, specs) {
  if (!input || typeof input !== 'object' || input.format !== projectFormat || input.version !== 1
    || typeof input.archived !== 'boolean') throw new Error('Unsupported project format');
  const spec = readMission(input.spec);
  const selection = readSelection(input.selection);
  const assembly = selection?.layout ? assemblyBlueprint(selection.layout, specs) : null;
  if (assembly) selection.layout = assembly.layout;
  spec.blueprintId = selection ? (selection.carrier ? `carrier-${selection.carrier}` : assembly.id) : null;
  return { format: projectFormat, version: 1, spec, selection, archived: input.archived, result: readResult(input.result) };
}

export function missionProject(spec, selection = null) {
  return { format: projectFormat, version: 1, spec, selection, archived: false, result: null };
}

export function importProject(text, specs) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PROJECT_FILE_BYTES) throw new Error('Project file too large');
  const input = JSON.parse(text.replace(/^\uFEFF/, ''));
  // The original designer stored the mission specification by itself.
  return readProject(input?.format == null ? missionProject(input) : input, specs);
}

export function openProjectLibrary(storage, specs) {
  const raw = storage.getItem(PROJECT_LIBRARY_KEY);
  let current;
  if (raw == null) {
    const legacy = loadMission(storage);
    current = { version: 1, activeId: legacy?.id ?? null, projects: legacy ? [readProject(missionProject(legacy), specs)] : [] };
  } else {
    const input = JSON.parse(raw);
    if (input?.version !== 1 || !Array.isArray(input.projects)) throw new Error('Invalid project library');
    const projects = input.projects.map(item => readProject(item, specs));
    const ids = new Set(projects.map(item => item.spec.id));
    if (ids.size !== projects.length || (input.activeId !== null && !ids.has(input.activeId))) throw new Error('Invalid project library selection');
    current = { version: 1, activeId: input.activeId, projects };
  }

  function commit(projects, activeId) {
    const next = { version: 1, activeId, projects };
    storage.setItem(PROJECT_LIBRARY_KEY, JSON.stringify(next));
    current = next;
  }

  return {
    list: () => structuredClone(current.projects),
    get: id => structuredClone(current.projects.find(item => item.spec.id === id) ?? null),
    active: () => current.activeId,
    select(id) {
      if (!current.projects.some(item => item.spec.id === id)) throw new Error('Project not found');
      commit(current.projects, id);
    },
    save(input, { activate = true } = {}) {
      const item = readProject(input, specs);
      const projects = current.projects.filter(project => project.spec.id !== item.spec.id);
      projects.push(item);
      commit(projects, activate ? item.spec.id : current.activeId);
      return structuredClone(item);
    },
    remove(id) {
      const projects = current.projects.filter(project => project.spec.id !== id);
      commit(projects, current.activeId === id ? null : current.activeId);
    },
  };
}
