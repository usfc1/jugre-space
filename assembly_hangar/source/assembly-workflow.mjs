import { Box3, Matrix4, Vector3 } from 'three';
import { assessVehicle } from './mission-engineering.mjs';
import { planMission } from './mission-plan.mjs';
import { missionProject } from './mission-projects.mjs';
import { newMission, readMission } from './mission-specification.mjs';
import { twoStageExample } from './rocket-interstages.mjs';
import { payloadMass } from './payload-configuration.mjs';

export const trainingLayout = [
  ...twoStageExample.slice(0, 8),
  { key: 'payload-adapter', part: 'p_2512_konus', parent: 'command', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'bay', part: 'go_34_cargo_bay', parent: 'payload-adapter', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'satellite', part: 'mayak_k', parent: 'bay', socket: 'mount_payload', plug: 'bay_payload' },
];
const storageKey = 'jugre.vab-workflow.v1';
const lessonKey = 'jugre.vab-lesson.v1';
const routes = [
  ['Base', 'tanks', 'Start with a tank.'],
  ['First stage', 'propulsion', 'Mount an engine under the tank.'],
  ['Upper stages', 'structure', 'Use an interstage to mount another stage.'],
  ['Payload', 'vehicles', 'Build a payload in the lab and load it into a bay.'],
  ['Systems', 'command', 'Add flight control and a bay for the payload.'],
  ['Review', 'structure', 'Review ignition, separation, and mission checks.'],
];
const fmt = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'Unknown';
const button = (text, action, parent) => {
  const node = document.createElement('button');
  node.type = 'button'; node.className = 'control'; node.textContent = text;
  node.addEventListener('click', action); parent.append(node); return node;
};

export function assemblyFitProblems(pieces) {
  const errors = [];
  for (const piece of pieces.values()) {
    if (piece.spec.system !== 'payload') continue;
    if (piece.entry.spacecraft?.manualPlacement) {
      const hardware = piece.visual.getObjectByName('configured_payload_hardware');
      const inverse = piece.visual.matrixWorld.clone().invert();
      const boxes = (hardware?.children ?? []).map(node => new Box3().setFromObject(node).applyMatrix4(inverse).expandByScalar(-.003));
      if (boxes.some((box, index) => boxes.slice(index + 1).some(other => box.intersectsBox(other)))) {
        errors.push({ key: piece.entry.key, text: 'Payload modules overlap. Open PAYLOAD LAB and move the conflicting hardware.' });
      }
    }
    const host = pieces.get(piece.entry.parent);
    if (host?.spec.system !== 'bay') continue;
    const transform = new Matrix4().copy(host.object.matrixWorld).invert().multiply(piece.visual.matrixWorld);
    const geometry = new Box3();
    // Ignore the deployment preview and examine the packed visual at its saved mount.
    piece.visual.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const matrix = new Matrix4().copy(piece.visual.matrixWorld).invert().multiply(mesh.matrixWorld);
      geometry.union(mesh.geometry.boundingBox.clone().applyMatrix4(matrix));
    });
    const fitted = geometry.applyMatrix4(transform);
    const radius = Math.hypot(Math.max(Math.abs(fitted.min.x), Math.abs(fitted.max.x)),
      Math.max(Math.abs(fitted.min.z), Math.abs(fitted.max.z)));
    if (radius > 1.6 - .025 || fitted.min.y < .6 || fitted.max.y > 5.06) {
      errors.push({ key: piece.entry.key, text: 'Payload exceeds GO-34 clearance.' });
    }
    const capacity = host.spec.stats.maxPayloadMassKg;
    if (Number.isFinite(capacity) && payloadMass(piece.spec, piece.entry.spacecraft) > capacity) {
      errors.push({ key: piece.entry.key, text: 'Payload exceeds the mount limit.' });
    }
  }
  return errors;
}

export function setupAssemblyWorkflow({ builder, specs, designer, launch, showRocket, showEquipment, showLaunch, cameraControls }) {
  const get = id => document.getElementById(id);
  const status = get('assembly-workflow-status');
  let mission = newMission();
  let lesson;
  let selected;
  let route = 0;
  let reviewed = false;
  let result;
  let refreshing = false;
  let replacing = false;
  try { const saved = JSON.parse(localStorage.getItem(storageKey)); if (saved) mission = readMission(saved.mission); }
  catch { status.textContent = 'Mission settings reset to defaults.'; }
  try { lesson = JSON.parse(localStorage.getItem(lessonKey)); } catch { lesson = null; }
  const initialMission = mission;
  const initialLayout = builder.getLayout();
  const tutorial = get('assembly-tutorial');
  const routeNodes = [];
  for (const [index, [name, category, help]] of routes.entries()) {
    const node = button(name, () => {
      route = index; builder.showCategory(category); get('assembly-step-help').textContent = help; renderRoute();
      if (index === 5) get('assembly-checks').scrollIntoView({ block: 'nearest' });
    }, get('assembly-route'));
    routeNodes.push(node);
  }
  function renderRoute() {
    routeNodes.forEach((node, index) => node.setAttribute('aria-current', index === route ? 'step' : 'false'));
    get('assembly-step-help').textContent = routes[route][2];
  }
  function catalog() {
    for (const card of document.querySelectorAll('[data-part]')) {
      const compatibility = builder.compatibility(card.dataset.part);
      const note = card.querySelector('.part-compatibility');
      if (note) { note.textContent = compatibility.text; note.dataset.compatible = String(compatibility.ok); }
    }
    renderLesson();
  }
  function save() {
    try {
      if (lesson) {
        lesson.layout = builder.getLayout();
        lesson.mission = mission;
        localStorage.setItem(lessonKey, JSON.stringify(lesson));
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ mission }));
        const layout = builder.getLayout();
        designer.projects.current().save(missionProject({ ...mission, assembly: 'manual' }, layout.length ? { carrier: null, layout } : null));
        designer.projects.refresh(mission.id);
      }
    } catch (error) { status.textContent = 'Autosave unavailable · ' + error.message; }
  }
  function focusIssue(check) {
    if (check.id?.startsWith('model-')) { get('assembly-purpose').focus(); status.textContent = check.text; return; }
    const pieces = [...builder.getPieces().values()];
    const piece = pieces.find(piece => piece.entry.key === check.key) ??
      pieces.find(piece => /guidance|seats/.test(check.id) ? piece.spec.group === 'command'
        : /payload|geometry|pointing|solar|battery|budget/.test(check.id) ? piece.spec.system === 'payload'
          : piece.spec.group === 'tanks');
    if (piece) builder.focusPart(piece.entry.key);
    if (/guidance/.test(check.id)) builder.showCategory('command');
    else if (/payload|geometry|pointing|solar|battery|budget/.test(check.id)) showEquipment(piece?.entry);
    else builder.showCategory('propulsion');
  }
  function refresh() {
    if (refreshing) return;
    refreshing = true;
    reviewed = false;
    const layout = builder.getLayout();
    const payload = layout.find(entry => entry.spacecraft);
    if (payload) mission = readMission({ ...mission, spacecraft: payload.spacecraft });
    get('assembly-mission').textContent = mission.name +
      (mission.returnRequired ? ' · Earth return' : '') + (lesson ? ' · Tutorial' : '');
    get('assembly-fuel').value = String(mission.propellantFraction * 100);
    const purpose = get('assembly-purpose');
    if (![...purpose.options].some(option => option.value === mission.type)) purpose.add(new Option(mission.name, mission.type));
    purpose.value = mission.type;
    get('assembly-fuel-value').textContent = Math.round(mission.propellantFraction * 100) + '%';
    get('assembly-checks').replaceChildren();
    result = undefined;
    const problems = [];
    try {
      result = assessVehicle(planMission({ ...mission, assembly: 'manual' }), layout, specs);
      problems.push(...result.checks.filter(check => check.status !== 'PASS').map(check => ({
        ...check, severity: check.status === 'FAIL' || check.id.startsWith('model-') || ['topology', 'mass-data'].includes(check.id) ? 'error' : 'warning',
        text: check.label + '. ' + check.reason + (check.action ? ' ' + check.action : ''),
      })));
      problems.push(...assemblyFitProblems(builder.getPieces()).map(item => ({ ...item, severity: 'error' })));
      if (mission.spacecraft && !payload) problems.push({ id: 'payload', severity: 'error', text: 'Install the satellite from the lab.' });
      const parts = result.blueprint.components;
      for (const stage of result.blueprint.stages ?? []) {
        if (!stage.engines.length || !stage.tanks.length) problems.push({ id: 'topology', key: stage.components[0], severity: 'error',
          text: 'Stage ' + (stage.index + 1) + ' needs a tank and engine.' });
      }
      const installedKg = parts.filter(part => part.system === 'payload').reduce((sum, part) => sum + (part.massKg ?? 0), 0);
      get('assembly-summary').textContent =
        `${fmt(result.performance.wetMassKg)} kg · ${result.vehicle.stages.length} stages · ${fmt(installedKg + mission.payloadMassKg)} kg payload`;
      get('assembly-staging').textContent = result.vehicle.stages.map((stage, index) =>
        (index + 1) + '. Ignition · ' + stage.id + (index < result.vehicle.stages.length - 1 ? ' → burnout → separation' : ' → cutoff')).join('\n');
    } catch (error) {
      problems.push({ severity: 'error', text: layout.length ? error.message : 'Start with a tank or frame.' });
      get('assembly-summary').textContent = 'Add a base part';
      get('assembly-staging').textContent = '';
    }
    get('assembly-tree').replaceChildren();
    for (const entry of layout) {
      const node = button(specs.get(entry.part).name, () => builder.focusPart(entry.key), get('assembly-tree'));
      node.dataset.key = entry.key;
      node.setAttribute('aria-pressed', String(entry.key === selected));
    }
    for (const check of problems) {
      const node = button((check.severity === 'error' ? '× ' : '△ ') + check.text,
        () => focusIssue(check), get('assembly-checks'));
      node.dataset.severity = check.severity;
    }
    result = result && { ...result, workflowReady: result.ready && !problems.some(check => check.severity === 'error') };
    get('assembly-summary').textContent += ' · ' + (result?.workflowReady ? 'Ready to check' : 'Needs changes');
    get('assembly-to-pad').disabled = true;
    get('assembly-selected-remove').disabled = get('assembly-replace').disabled = !layout.some(entry => entry.key === selected);
    get('assembly-edit-payload').hidden = !layout.find(entry => entry.key === selected && specs.get(entry.part).system === 'payload');
    catalog();
    advanceLesson();
    save();
    refreshing = false;
  }
  function select(key) {
    selected = key;
    for (const node of get('assembly-tree').children) node.setAttribute('aria-pressed', String(node.dataset.key === key));
    get('assembly-selected-remove').disabled = get('assembly-replace').disabled = false;
    get('assembly-edit-payload').hidden = !builder.getLayout().find(entry => entry.key === key && specs.get(entry.part).system === 'payload');
  }
  function verify() {
    reviewed = true;
    if (!result?.workflowReady || lesson) get('assembly-settings').open = true;
    get('assembly-to-pad').disabled = !result?.workflowReady || !!lesson;
    status.textContent = result?.workflowReady ? 'Build checked.'
      : 'Resolve the flagged issues.';
    if (lesson?.step === 5) {
      lesson.snapshots[5] = { layout: builder.getLayout(), mission };
      lesson.step = 6;
      mission = readMission({ ...mission, propellantFraction: .05 });
      refresh();
    } else if (lesson?.step === 7 && result?.workflowReady) {
      lesson.snapshots[7] = { layout: builder.getLayout(), mission };
      lesson.step = 8; renderLesson(); save();
    }
  }
  window.addEventListener('jugre-assembly-change', refresh);
  window.addEventListener('jugre-catalog-change', catalog);
  window.addEventListener('jugre-assembly-select', event => select(event.detail));
  get('assembly-fuel').addEventListener('input', () => {
    mission = readMission({ ...mission, propellantFraction: Number(get('assembly-fuel').value) / 100 }); refresh();
  });
  get('assembly-purpose').addEventListener('change', () => {
    mission = readMission({ ...mission, type: get('assembly-purpose').value,
      durationS: get('assembly-purpose').value === 'science' ? mission.durationS ?? 14400 : mission.durationS });
    refresh();
  });
  get('assembly-selected-remove').addEventListener('click', () => builder.removePart(selected));
  get('assembly-replace').addEventListener('click', () => { replacing = true; status.textContent = 'Select a replacement part.'; });
  get('part-cards').addEventListener('pointerdown', event => {
    if (!replacing) return;
    const card = event.target.closest('[data-part]');
    if (!card) return;
    event.preventDefault(); event.stopImmediatePropagation();
    replacing = false; builder.replacePart(selected, card.dataset.part);
  }, { capture: true });
  get('assembly-edit-payload').addEventListener('click', () => showEquipment(builder.getLayout().find(entry => entry.key === selected)));
  get('assembly-projects').addEventListener('click', () => { designer.open(mission); designer.showProjects(); });
  get('assembly-verify').addEventListener('click', verify);
  get('assembly-to-pad').addEventListener('click', async () => {
    if (!reviewed || !result?.workflowReady || lesson) return;
    try {
      const spec = readMission({ ...mission, assembly: 'manual', blueprintId: result.blueprint.id });
      designer.savePrepared(spec, result);
      showLaunch();
      await launch.selectDesign({ spec, layout: result.blueprint.layout, carrier: null, vehicle: result.vehicle, cabin: result.cabin, checks: result.checks });
      status.textContent = 'Vehicle sent to pad.';
    } catch (error) { status.textContent = error.message; }
  });
  window.addEventListener('jugre-open-assembly', event => {
    if (lesson) leaveLesson();
    mission = readMission(event.detail.spec);
    if (event.detail.blueprint?.layout) builder.applyBlueprint(event.detail.blueprint);
    showRocket(); refresh();
  });
  function beginLesson() {
    if (lesson) leaveLesson();
    lesson = { version: 1, step: 0, backup: { layout: builder.getLayout(), mission }, snapshots: [], skipped: [] };
    builder.setIsolated(true);
    mission = readMission({ ...newMission(), name: 'Tutorial Rocket' });
    builder.applyBlueprint({ layout: [] });
    showRocket();
    lesson.camera = { position: cameraControls.object.position.toArray(), distance: cameraControls.object.position.distanceTo(cameraControls.target) };
    renderLesson(); save();
  }
  function leaveLesson() {
    const backup = lesson.backup;
    lesson = null;
    mission = readMission(backup.mission);
    builder.applyBlueprint({ layout: backup.layout });
    builder.setIsolated(false);
    localStorage.removeItem(lessonKey);
    tutorial.hidden = true; clearHighlights(); refresh();
  }
  function clearHighlights() { document.querySelectorAll('.tutorial-focus').forEach(node => node.classList.remove('tutorial-focus')); }
  const lessonNames = ['Camera controls', 'Rocket base', 'First-stage engine', 'Second stage', 'Satellite & bay', 'Staging', 'Resolve a fault', 'Preflight', 'Tutorial complete'];
  function nextRequired() {
    const layout = builder.getLayout();
    const limit = lesson.step === 1 ? 1 : lesson.step === 2 ? 2 : lesson.step === 3 ? 7 : trainingLayout.length;
    const matches = new Map();
    for (const entry of trainingLayout.slice(0, limit)) {
      const actual = layout.find(actual => actual.part === entry.part && actual.parent === matches.get(entry.parent) &&
        actual.socket === entry.socket && actual.plug === entry.plug);
      if (!actual) return entry;
      matches.set(entry.key, actual.key);
    }
  }
  function renderLesson() {
    clearHighlights();
    tutorial.hidden = !lesson;
    get('assembly-learn').textContent = 'Tutorial';
    if (!lesson) return;
    get('assembly-learn-offer').hidden = true;
    get('assembly-learn').textContent = 'Restart tutorial';
    get('assembly-tutorial-title').textContent = (lesson.step + 1) + ' / 9 · ' + lessonNames[lesson.step];
    const required = lesson.step >= 1 && lesson.step <= 4 ? nextRequired() : null;
    const text = lesson.step === 0 ? 'Drag to orbit and scroll to zoom. Then choose a base.'
      : required ? 'Select “' + specs.get(required.part).name + '”, then select a green mount. ' +
        (lesson.step === 2 ? 'The engine provides thrust.' : lesson.step === 3 ? 'The interstage separates the spent stage.' : lesson.step === 4 ? 'The GO-34 bay protects the satellite.' : 'The tank stores propellant.')
        : lesson.step === 5 ? 'Open Parts & staging, then select Check build.'
          : lesson.step === 6 ? 'The tank is at 5%. Set Fuel to 100%.'
            : lesson.step === 7 ? 'Select Check build.'
              : 'Save the tutorial rocket or exit.';
    get('assembly-tutorial-text').textContent = text;
    get('tutorial-keep').hidden = lesson.step !== 8;
    get('tutorial-skip').hidden = lesson.step === 8;
    get('tutorial-back').disabled = lesson.step === 0;
    const target = required ? document.querySelector('[data-part="' + required.part + '"]')
      : lesson.step === 6 ? get('assembly-fuel') : get('assembly-verify');
    target?.classList.add('tutorial-focus');
    if (required && !target) builder.showCategory(specs.get(required.part).group);
  }
  function advanceLesson() {
    if (!lesson) return;
    if (lesson.step >= 1 && lesson.step <= 4 && !nextRequired() || lesson.step === 6 && mission.propellantFraction === 1) {
      lesson.snapshots[lesson.step] = { layout: builder.getLayout(), mission };
      lesson.step++;
      renderLesson();
    }
  }
  cameraControls.addEventListener('change', () => {
    if (lesson?.step !== 0 || !lesson.camera) return;
    const distance = cameraControls.object.position.distanceTo(cameraControls.target);
    lesson.camera.zoomed ||= Math.abs(distance / lesson.camera.distance - 1) > .08;
    const from = new Vector3(...lesson.camera.position).sub(cameraControls.target).normalize();
    const to = cameraControls.object.position.clone().sub(cameraControls.target).normalize();
    lesson.camera.rotated ||= from.angleTo(to) > .08;
  });
  cameraControls.addEventListener('end', () => {
    if (lesson?.step !== 0) return;
    if (!lesson.camera?.rotated || !lesson.camera?.zoomed) return;
    lesson.snapshots[0] = { layout: builder.getLayout(), mission };
    lesson.step = 1; builder.showCategory('tanks'); renderLesson(); save();
  });
  get('assembly-learn').addEventListener('click', beginLesson);
  get('tutorial-exit').addEventListener('click', leaveLesson);
  get('tutorial-back').addEventListener('click', () => {
    if (!lesson.step) return;
    lesson.step--;
    const saved = lesson.snapshots[lesson.step - 1] ?? { layout: [], mission: newMission() };
    mission = readMission(saved.mission);
    builder.applyBlueprint({ layout: saved.layout });
    renderLesson(); save();
  });
  get('tutorial-skip').addEventListener('click', () => {
    lesson.skipped.push(lesson.step);
    lesson.snapshots[lesson.step] = { layout: builder.getLayout(), mission };
    if (lesson.step >= 1 && lesson.step <= 4) {
      const count = lesson.step === 1 ? 1 : lesson.step === 2 ? 2 : lesson.step === 3 ? 7 : trainingLayout.length;
      builder.applyBlueprint({ layout: trainingLayout.slice(0, count) });
    } else if (lesson.step === 6) {
      mission = readMission({ ...mission, propellantFraction: 1 }); refresh();
    } else if (lesson.step === 5) {
      lesson.step = 6;
      mission = readMission({ ...mission, propellantFraction: .05 });
      refresh();
    } else { lesson.step++; renderLesson(); save(); }
  });
  get('tutorial-keep').addEventListener('click', () => {
    const item = missionProject({ ...mission, assembly: 'manual' }, { carrier: null, layout: builder.getLayout() });
    designer.projects.current().save(item, { activate: false });
    status.textContent = 'Tutorial rocket saved.';
    leaveLesson();
  });
  get('assembly-learn-offer').hidden = localStorage.getItem('jugre.vab-visited') === '1';
  localStorage.setItem('jugre.vab-visited', '1');
  try {
    if (lesson?.version === 1 && lesson.backup && Array.isArray(lesson.layout) && Number.isInteger(lesson.step) && lesson.step >= 0 && lesson.step <= 8) {
      builder.setIsolated(true); mission = readMission(lesson.mission); builder.applyBlueprint({ layout: lesson.layout });
    } else lesson = null;
  } catch {
    lesson = null; mission = initialMission;
    builder.applyBlueprint({ layout: initialLayout });
    builder.setIsolated(false); localStorage.removeItem(lessonKey);
    status.textContent = 'Tutorial reset.';
  }
  renderRoute(); refresh();
  return { refresh, get mission() { return mission; },
    validate() { return result?.workflowReady ? null : 'Resolve build issues before launch.'; },
  };
}
