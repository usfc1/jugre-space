import { Box3, Group, MathUtils, MeshStandardMaterial, Raycaster, Vector2, Vector3 } from 'three';
import { clipPose } from './payload-preview.mjs';
import { equipmentStand, placeOnDeck } from './vab-layout.mjs';
import { defaultSpacecraft, readSpacecraft, spacecraftParts, spacecraftTotals } from './spacecraft-design.mjs';
import { createPayloadEquipment, decoratePayload, payloadBodyBounds, payloadMass, payloadMounts,
  payloadVisibleBounds, positionPayloadEquipment, setPayloadDeployment } from './payload-configuration.mjs';
import { labBodyNames, labInstruments, labItem, labSystems, systemNames } from './payload-lab-catalog.mjs';
import { partThumbnails } from './part-thumbnails.mjs';

const draftKey = 'jugre.payload-lab.draft.v1';
const libraryKey = 'jugre.payload-subassemblies.v1';
const fmt = value => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const keyFor = entry => entry.kind + ':' + entry.id;
const blankLoadout = () => readSpacecraft({ ...defaultSpacecraft, instrumentIds: [], manualPlacement: true, mounting: [],
  ...Object.fromEntries(Object.keys(spacecraftParts).map(field => [field, null])) });
function editableLoadout(input) {
  if (!input) return blankLoadout();
  const legacy = readSpacecraft(input);
  if (legacy.manualPlacement) return legacy;
  return readSpacecraft({ ...legacy, manualPlacement: true, mounting: [
    ...legacy.instrumentIds.map((id, index) => ({ kind: 'instrument', id,
      slot: (index < 8 ? 'front_' : 'rear_') + (index % 8 + 1), turn: 0 })),
    ...Object.keys(spacecraftParts).map((id, index) => ({ kind: 'system', id, slot: 'left_' + (index + 1), turn: 0 })),
  ] });
}

export function setupEquipmentBench({ scene, specs, models, clips, loadEagle, onFocus, canInstall, onInstall, onApollo, onEdit, camera, canvas }) {
  const get = id => document.getElementById(id);
  const panel = get('vab-equipment-panel'), select = get('vab-equipment-model'), status = get('vab-equipment-status');
  const test = get('vab-equipment-test'), install = get('vab-equipment-install'), apollo = get('vab-equipment-apollo');
  const overlay = get('lab-mount-points'), catalog = get('equipment-instruments'), faceSelect = get('lab-face');
  const viewport = canvas.parentElement;
  for (const [id, spec] of specs) if (spec.system === 'payload') select.add(new Option(labBodyNames[id] ?? id, id));
  select.add(new Option(labBodyNames.eagle, 'eagle'));
  const display = new Group(); display.name = 'vab_equipment_display'; display.visible = false; scene.add(display);
  const ray = new Raycaster(), pointer = new Vector2(), projected = new Vector3();
  const ghostMaterial = new MeshStandardMaterial({ color: 0x8bd6bd, emissive: 0x31554e, emissiveIntensity: .2,
    transparent: true, opacity: .48, depthWrite: false, roughness: .6 });
  let configuration = blankLoadout(), editing, missionRequest, active = false, model, mounts = [], pose, eagle;
  let selected, selectedKey, pending, ghost, hoverMount, turn = 0, drag, clickStart;
  let extended = false, progress = 0, request = 0, category = 'all', images;
  let library = [], undo = [], redo = [], note = '';
  try {
    library = JSON.parse(localStorage.getItem(libraryKey)) ?? [];
    if (!Array.isArray(library)) library = [];
    const draft = JSON.parse(localStorage.getItem(draftKey));
    if (draft && specs.get(draft.part)?.vehicle === 'satellite') {
      select.value = draft.part; configuration = editableLoadout(draft.spacecraft);
    }
  } catch { library = []; note = 'The last loadout could not be restored. Start with a bare bus or open a saved payload.'; }
  const configurable = () => specs.get(select.value)?.vehicle === 'satellite';
  function saveDraft() {
    if (!configurable()) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ part: select.value, spacecraft: configuration })); }
    catch { note = 'Local storage is unavailable. This loadout is still active in the workshop.'; }
  }
  function libraryOptions() {
    get('equipment-library').replaceChildren(new Option('Open saved payload…', ''),
      ...library.map((entry, index) => new Option(entry.name, String(index))));
  }
  function cancelPlacement() {
    pending = undefined; hoverMount = undefined;
    ghost?.removeFromParent(); ghost = undefined;
    overlay.replaceChildren(); get('lab-mount-list').replaceChildren();
    catalog.querySelector('[aria-pressed=true]')?.setAttribute('aria-pressed', 'false');
  }
  function chooseItem(item) {
    if (!model || !configurable() || progress > 0) return;
    cancelPlacement();
    pending = item; turn = 0;
    const existing = configuration.mounting.find(entry => keyFor(entry) === item.key);
    selectedKey = existing ? item.key : undefined;
    ghost = createPayloadEquipment(item);
    ghost.traverse(node => { if (node.isMesh) { node.material = ghostMaterial; node.castShadow = false; } });
    ghost.visible = false; model.add(ghost);
    get('lab-selection').textContent = item.title + ' · ' + fmt(item.massKg) + ' kg · ' + fmt(item.costM) + ' M';
    note = existing ? 'This module is already installed. Choose a point to move or replace it.'
      : 'Choose an attachment point on the bus. The preview is not installed yet.';
    renderMounts(); renderCatalog(); render();
  }
  function renderCatalog() {
    if (!images) return;
    const query = get('lab-search').value.trim().toLowerCase();
    const items = [...labInstruments, ...labSystems].filter(item =>
      (category === 'all' || category === 'systems' && item.kind === 'system' ||
        category === 'optical' && item.kind === 'instrument' && item.category === 'optical' ||
        category === 'science' && item.kind === 'instrument' && item.category !== 'optical') &&
      (item.title + ' ' + item.purpose).toLowerCase().includes(query));
    catalog.replaceChildren();
    for (const item of items) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'lab-part-card';
      card.dataset.labItem = item.kind + ':' + item.id + (item.variant ? ':' + item.variant : '');
      card.setAttribute('aria-pressed', String(pending === item));
      const image = document.createElement('img'); image.src = images.get(card.dataset.labItem); image.alt = ''; image.width = 58; image.height = 50;
      const title = document.createElement('strong'); title.textContent = item.title;
      const purpose = document.createElement('span'); purpose.textContent = item.purpose;
      const numbers = document.createElement('small'); numbers.textContent = fmt(item.massKg) + ' kg · ' + fmt(item.costM) +
        ' M' + (item.peakW ? ' · ' + item.peakW + ' W peak' : '');
      card.append(image, title, purpose, numbers);
      card.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); chooseItem(item);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        viewport.setPointerCapture(event.pointerId);
      });
      card.addEventListener('click', event => { if (event.detail === 0) chooseItem(item); });
      catalog.append(card);
    }
    get('lab-empty-search').hidden = items.length !== 0;
  }
  function selectInstalled(key) {
    cancelPlacement(); selectedKey = key;
    const entry = configuration.mounting.find(entry => keyFor(entry) === key);
    if (!entry) { selectedKey = undefined; return; }
    get('lab-selection').textContent = labItem(entry.kind, entry.id, configuration[entry.id]).title;
    get('lab-remove').disabled = get('lab-move').disabled = false;
    note = 'Selected module. Move it to another point or remove it from the bus.'; render();
  }
  function validateMount(mount) {
    if (!pending || !model) return 'Select a component first.';
    const occupied = configuration.mounting.find(entry => entry.slot === mount.id && keyFor(entry) !== pending.key);
    if (occupied) return 'This attachment point is occupied. Select the installed module to move or remove it.';
    const candidate = createPayloadEquipment(pending);
    positionPayloadEquipment(candidate, mount, turn);
    // Compare in the bus frame. Housing bounds include the mounting bracket.
    const proposed = new Box3().setFromObject(candidate).expandByScalar(-.003);
    const hardware = model.getObjectByName('configured_payload_hardware');
    const inverse = model.matrixWorld.clone().invert();
    for (const installed of hardware?.children ?? []) {
      if (installed.userData.equipmentKey === pending.key) continue;
      const other = new Box3().setFromObject(installed).applyMatrix4(inverse).expandByScalar(-.003);
      if (proposed.intersectsBox(other)) return 'The housing overlaps another module. Try a different face or rotate the part.';
    }
    return null;
  }
  function renderMounts() {
    overlay.replaceChildren(); get('lab-mount-list').replaceChildren();
    if (!pending || !model) return;
    for (const mount of mounts.filter(mount => faceSelect.value === 'all' || mount.face === faceSelect.value)) {
      const problem = validateMount(mount);
      const marker = document.createElement('button'); marker.type = 'button'; marker.className = 'lab-mount';
      marker.dataset.slot = mount.id; marker.dataset.valid = String(!problem);
      marker.textContent = (problem ? '× ' : '+ ') + mount.id.split('_')[1];
      marker.title = mount.id.replace('_', ' ') + ' · ' + (problem ?? 'Available attachment point');
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('pointerenter', () => preview(mount));
      marker.addEventListener('focus', () => preview(mount));
      marker.addEventListener('click', () => attach(mount));
      mount.marker = marker; overlay.append(marker);
      const accessible = document.createElement('button'); accessible.type = 'button'; accessible.className = 'control';
      accessible.textContent = marker.textContent; accessible.title = marker.title;
      accessible.addEventListener('pointerenter', () => preview(mount));
      accessible.addEventListener('focus', () => preview(mount));
      accessible.addEventListener('click', () => attach(mount));
      get('lab-mount-list').append(accessible);
    }
  }
  function preview(mount) {
    if (!ghost) return;
    hoverMount = mount; positionPayloadEquipment(ghost, mount, turn); ghost.visible = true;
    const error = validateMount(mount);
    ghostMaterial.color.setHex(error ? 0xe3a17e : 0x8bd6bd);
    get('lab-placement-status').textContent = error ?? 'Available · click to mount here.';
  }
  function commit(next) {
    const validated = readSpacecraft(next);
    if (editing) onEdit(editing, validated);
    undo.push(structuredClone(configuration)); redo.length = 0;
    configuration = validated; saveDraft(); cancelPlacement(); show(false);
  }
  function attach(mount) {
    if (!pending) return;
    const error = validateMount(mount);
    if (error) { note = error; get('lab-placement-status').textContent = error; render(); return; }
    const item = pending;
    const next = { ...configuration, mounting: configuration.mounting.filter(entry => keyFor(entry) !== item.key) };
    if (item.kind === 'instrument') next.instrumentIds = [...new Set([...configuration.instrumentIds, item.id])];
    else next[item.id] = item.variant;
    next.mounting.push({ kind: item.kind, id: item.id, slot: mount.id, turn });
    selectedKey = item.key;
    note = item.title + ' installed on ' + mount.id.replace('_', ' ') + '.';
    commit(next);
  }
  function removeSelected() {
    const entry = configuration.mounting.find(entry => keyFor(entry) === selectedKey);
    if (!entry) return;
    const next = { ...configuration, mounting: configuration.mounting.filter(item => item !== entry) };
    if (entry.kind === 'instrument') next.instrumentIds = configuration.instrumentIds.filter(id => id !== entry.id);
    else next[entry.id] = null;
    selectedKey = undefined; note = 'Module removed. Its mass and cost have been removed from the loadout.'; commit(next);
  }
  function render() {
    const historical = select.value === 'eagle', custom = configurable(), ready = selected === select.value;
    get('equipment-config').hidden = !custom;
    test.hidden = install.hidden = historical; apollo.hidden = !historical;
    test.disabled = !ready || (!pose && !custom);
    test.setAttribute('aria-pressed', String(extended)); test.textContent = extended ? 'Fold hardware' : 'Test deployment';
    install.disabled = !ready || !canInstall(selected) || extended || progress > 0 || !!pending;
    get('lab-undo').disabled = undo.length === 0; get('lab-redo').disabled = redo.length === 0;
    get('lab-remove').disabled = get('lab-move').disabled = !configuration.mounting.some(entry => keyFor(entry) === selectedKey);
    get('lab-rotate').disabled = !pending; get('lab-cancel').disabled = !pending;
    get('lab-placement').hidden = !pending;
    get('lab-mission-request').textContent = missionRequest?.instrumentIds?.length
      ? 'Mission requests ' + missionRequest.instrumentIds.map(id => labItem('instrument', id).title).join(', ') + '. Install the required hardware yourself.' : '';
    if (custom) {
      const totals = spacecraftTotals(configuration);
      const missing = Object.keys(spacecraftParts).filter(field => !configuration[field]);
      get('equipment-totals').textContent = fmt(payloadMass(specs.get(select.value), configuration)) + ' kg · ' + fmt(totals.costM) +
        ' M · ' + Math.round(totals.solarW) + ' W solar';
      get('lab-missing').textContent = missing.length ? 'Required systems still to mount · ' + missing.map(field => systemNames[field]).join(', ')
        : 'All bus systems mounted. Mission readiness is checked in the rocket editor.';
      get('lab-installed').replaceChildren();
      for (const entry of configuration.mounting) {
        const node = document.createElement('button'); node.type = 'button'; node.className = 'control';
        node.textContent = labItem(entry.kind, entry.id, configuration[entry.id]).title + ' · ' + entry.slot.replace('_', ' ');
        node.setAttribute('aria-pressed', String(keyFor(entry) === selectedKey));
        node.addEventListener('click', () => selectInstalled(keyFor(entry)));
        get('lab-installed').append(node);
      }
    }
    status.textContent = !ready ? 'Loading payload…' : historical ? 'Eagle uses the Apollo 11 launch assembly.'
      : note || (pending ? 'Choose a point on the bus to mount this component.' : custom
        ? 'Select hardware, then choose an attachment point. Dragging is also supported.'
        : 'This vehicle uses its existing transport configuration.');
  }
  async function show(refocus = true) {
    const id = select.value, token = ++request;
    cancelPlacement(); selected = undefined; pose = undefined; extended = false; progress = 0; display.clear(); render();
    try {
      if (id === 'eagle') eagle ??= loadEagle().catch(error => { eagle = undefined; throw error; });
      const source = id === 'eagle' ? await eagle : models.get(id);
      if (token !== request) return;
      model = source.clone(true);
      if (configurable()) decoratePayload(model, configuration);
      if (clips.has(id)) pose = clipPose(model, clips.get(id));
      pose?.(0); setPayloadDeployment(model, 0);
      const bounds = configurable() ? payloadBodyBounds(model) : payloadVisibleBounds(model);
      placeOnDeck(model, bounds, equipmentStand, true); display.add(model);
      model.updateMatrixWorld(true); mounts = payloadMounts(source);
      selected = id;
      model.traverse(node => { if (node.isMesh) node.castShadow = node.receiveShadow = true; });
      if (!images && configurable()) {
        const thumbnails = new Map([...labInstruments, ...labSystems].map(item => [
          item.kind + ':' + item.id + (item.variant ? ':' + item.variant : ''), createPayloadEquipment(item),
        ]));
        images = partThumbnails(thumbnails);
      }
      renderCatalog(); render();
      if (active && refocus) onFocus(payloadVisibleBounds(model).expandByScalar(.4));
    } catch (error) {
      console.error(error); if (token === request) { note = 'This payload could not be opened. Select the bus again or open a compatible saved loadout.'; status.textContent = note; }
    }
  }
  function changeFace() {
    renderMounts();
    if (!model) return;
    const directions = { front: [.12, .2, 1], rear: [-.12, .2, -1], left: [-1, .2, .12], right: [1, .2, -.12], top: [.1, 1, .12], all: [.64, .39, 1] };
    onFocus(payloadVisibleBounds(model).expandByScalar(.3), new Vector3(...directions[faceSelect.value]));
  }
  faceSelect.addEventListener('change', changeFace);
  get('lab-focus').addEventListener('click', changeFace);
  get('lab-search').addEventListener('input', renderCatalog);
  get('lab-category').addEventListener('change', event => { category = event.target.value; renderCatalog(); });
  get('lab-rotate').addEventListener('click', () => { turn = (turn + 1) % 4; renderMounts(); if (hoverMount) preview(hoverMount); });
  get('lab-cancel').addEventListener('click', () => { cancelPlacement(); note = 'Placement cancelled.'; render(); renderCatalog(); });
  get('lab-remove').addEventListener('click', removeSelected);
  get('lab-move').addEventListener('click', () => {
    const entry = configuration.mounting.find(entry => keyFor(entry) === selectedKey);
    if (!entry) return;
    chooseItem(labItem(entry.kind, entry.id, configuration[entry.id]));
    turn = entry.turn; faceSelect.value = entry.slot.split('_')[0]; changeFace();
    preview(mounts.find(mount => mount.id === entry.slot));
  });
  function travelHistory(from, to) {
    if (!from.length) return;
    const next = from.at(-1);
    if (editing) onEdit(editing, next);
    from.pop(); to.push(configuration); configuration = next; saveDraft(); show(false);
  }
  get('lab-undo').addEventListener('click', () => travelHistory(undo, redo));
  get('lab-redo').addEventListener('click', () => travelHistory(redo, undo));
  get('equipment-save').addEventListener('click', () => {
    const name = get('lab-name').value.trim() || labBodyNames[select.value] + ' · ' + (library.length + 1);
    library.push({ name, part: select.value, spacecraft: structuredClone(configuration) });
    try { localStorage.setItem(libraryKey, JSON.stringify(library)); note = 'Payload saved. Attachment points and rotations are included.'; }
    catch { note = 'The payload could not be saved. Local storage is unavailable.'; }
    libraryOptions(); render();
  });
  get('equipment-library').addEventListener('change', () => {
    if (get('equipment-library').value === '') return;
    const item = library[Number(get('equipment-library').value)];
    try {
      if (!item || !specs.has(item.part)) throw new Error('Unsupported payload');
      const next = editableLoadout(item.spacecraft);
      if (select.value !== item.part) editing = undefined;
      if (editing) onEdit(editing, next);
      configuration = next; select.value = item.part; undo = []; redo = []; get('lab-name').value = item.name;
      note = 'Saved payload restored. Select a module to move or remove it.'; saveDraft(); show();
    } catch { note = 'This saved payload is incompatible. Choose another loadout.'; render(); }
  });
  select.addEventListener('change', () => {
    editing = undefined; configuration = blankLoadout(); selectedKey = undefined; undo = []; redo = [];
    get('lab-name').value = ''; note = 'Bare bus ready. Choose and mount each component yourself.'; saveDraft(); show();
  });
  test.addEventListener('click', () => { cancelPlacement(); extended = !extended; note = ''; render(); });
  install.addEventListener('click', () => {
    if (progress === 0 && !extended && !pending && canInstall(selected)) onInstall(selected, configurable() ? configuration : undefined);
  });
  apollo.addEventListener('click', onApollo);
  function hitAt(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(pointer, camera);
    return ray.intersectObject(model, true).find(hit => {
      for (let node = hit.object; node; node = node.parent) if (!node.visible || node === ghost) return false;
      return true;
    });
  }
  function closestMount(event) {
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    let nearest, distance = 60;
    for (const mount of mounts) {
      if (faceSelect.value !== 'all' && mount.face !== faceSelect.value) continue;
      projected.copy(mount.position); model.localToWorld(projected).project(camera);
      const delta = Math.hypot((projected.x + 1) * rect.width / 2 + rect.left - event.clientX,
        (1 - projected.y) * rect.height / 2 + rect.top - event.clientY);
      if (Math.abs(projected.z) < 1 && delta < distance) { distance = delta; nearest = mount; }
    }
    return nearest;
  }
  document.addEventListener('pointermove', event => {
    if (!active || !pending || !model) return;
    if (drag?.id === event.pointerId) drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6;
    const mount = closestMount(event);
    if (mount) preview(mount);
  });
  document.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    const moved = drag.moved; drag = undefined;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (moved) { const mount = closestMount(event); if (mount) attach(mount); }
  });
  viewport.addEventListener('pointercancel', () => { drag = undefined; cancelPlacement(); render(); });
  canvas.addEventListener('pointerdown', event => { if (active && event.button === 0) clickStart = [event.clientX, event.clientY]; });
  canvas.addEventListener('pointerup', event => {
    if (!active || !model || !clickStart || Math.hypot(event.clientX - clickStart[0], event.clientY - clickStart[1]) > 5) return;
    clickStart = undefined;
    if (pending) { const mount = closestMount(event); if (mount) attach(mount); return; }
    const hit = hitAt(event);
    for (let node = hit?.object; node; node = node.parent) if (node.userData.equipmentKey) { selectInstalled(node.userData.equipmentKey); break; }
  });
  window.addEventListener('keydown', event => {
    if (!active || event.key !== 'Escape') return;
    cancelPlacement(); note = 'Placement cancelled.'; render();
  });
  libraryOptions();
  return {
    useMission(config) { missionRequest = config; },
    edit(entry, inherited) {
      editing = entry?.key; missionRequest = inherited;
      if (entry) { select.value = entry.part; configuration = editableLoadout(entry.spacecraft); undo = []; redo = []; }
      if (active) show();
    },
    setEnabled(enabled) {
      active = enabled; display.visible = enabled; panel.hidden = !enabled; overlay.hidden = !enabled;
      if (enabled) show();
      else { cancelPlacement(); drag = undefined; }
    },
    getConfiguration() { return structuredClone(configuration); },
    update(dt) {
      if (!active || !model) return;
      const next = MathUtils.clamp(progress + (extended ? 1 : -1) * dt, 0, 1);
      if (next !== progress) {
        pose?.(next); setPayloadDeployment(model, next); progress = next;
        if (progress === 0 || progress === 1) render();
      }
      if (!pending) return;
      const rect = canvas.getBoundingClientRect();
      for (const mount of mounts) {
        if (!mount.marker?.isConnected) continue;
        const world = model.localToWorld(mount.position.clone());
        const outward = mount.normal.clone().transformDirection(model.matrixWorld);
        projected.copy(world).project(camera);
        const visible = camera.position.clone().sub(world).dot(outward) > 0 && Math.abs(projected.x) < .96 &&
          Math.abs(projected.y) < .95 && projected.z > -1 && projected.z < 1;
        mount.marker.hidden = !visible;
        if (visible) { mount.marker.style.left = (projected.x + 1) * rect.width / 2 + 'px'; mount.marker.style.top = (1 - projected.y) * rect.height / 2 + 'px'; }
      }
    },
  };
}
