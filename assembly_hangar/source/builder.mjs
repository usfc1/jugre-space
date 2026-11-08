import {
  MathUtils, MeshStandardMaterial, Plane, Quaternion, Raycaster, Vector2, Vector3,
} from 'three';
import { buildCraft, compatible, example, isFoundation, jointPose, standPosition, standRotation } from './assembly.mjs';

const storageKey = 'jugre.assembly-hangar.craft.v1';
const anchor = new Vector3(...standPosition);
const categories = [
  ['tanks', 'Баки'], ['propulsion', 'Тяга'], ['structure', 'Рамы'], ['surfaces', 'Рули'], ['payload', 'Груз'],
];
const sketches = {
  tank: 'M14 12c0-3 5-5 11-5s11 2 11 5v20c0 3-5 5-11 5s-11-2-11-5z M14 13c4 4 18 4 22 0 M14 26c4 4 18 4 22 0',
  tall: 'M17 8c0-2 3-4 8-4s8 2 8 4v28c0 2-3 4-8 4s-8-2-8-4z M17 11c3 3 13 3 16 0 M17 27c3 3 13 3 16 0',
  engine: 'M19 6h12v8l-2 4 9 18H12l9-18-2-4z M18 24h14 M15 31h20',
  rail: 'M14 12h16l5 8-5 8H14l-4-8z M19 13v14 M26 13v14 M10 20h25',
  ring: 'M9 18c0-4 7-8 16-8s16 4 16 8v8c0 4-7 8-16 8s-16-4-16-8z M9 18c0 4 7 8 16 8s16-4 16-8 M18 18c0-2 3-3 7-3s7 1 7 3-3 3-7 3-7-1-7-3z',
  cone: 'M19 10h12v6l7 13v6H12v-6l7-13z M12 29h26 M19 16h12',
  wing: 'M11 35V17L38 8l-4 14-12 5v8z M11 30h11 M17 17v13',
  grid: 'M11 12h28v20H11z M20 12v20 M30 12v20 M11 22h28',
  capsule: 'M23 6h4l9 17v11H14V23z M14 26h22 M22 17h6v5h-6z',
  shell: 'M26 6c5 4 11 11 11 20v10H23V12z M26 10v24 M23 29h14',
};

function partArt(id, spec) {
  if (id.startsWith('st_25')) return 'shell';
  if (id === 'pk_2_kontur') return 'capsule';
  if (id === 'p_2512_konus') return 'cone';
  if (id === 'r_08_shepot' || id === 'g_060_puls' || id === 'bk_6_zamok') return 'rail';
  if (spec.group === 'propulsion') return 'engine';
  if (spec.group === 'tanks') return spec.dimensionsM[1] >= 3.2 ? 'tall' : 'tank';
  if (spec.group === 'surfaces') return /^(rr|sk)_/.test(id) ? 'grid' : 'wing';
  return 'ring';
}

function partCard(id, spec) {
  const button = document.createElement('button');
  button.className = 'part-card';
  button.type = 'button';
  button.dataset.part = id;
  button.setAttribute('aria-pressed', 'false');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 50 44');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', sketches[partArt(id, spec)]);
  svg.append(path);
  const code = document.createElement('span');
  code.className = 'part-code';
  code.textContent = spec.code;
  const name = document.createElement('span');
  name.className = 'part-name';
  name.textContent = spec.name;
  const detail = document.createElement('span');
  detail.className = 'part-detail';
  const diameter = spec.stats.mountDiameterM ?? spec.stats.outerDiameterM;
  detail.textContent = diameter ? `Ø ${String(diameter).replace('.', ',')} м` : 'Боковой узел';
  if (!diameter && spec.group !== 'surfaces' && spec.group !== 'tanks' && spec.group !== 'propulsion') {
    detail.textContent = 'Крепёж';
  }
  button.title = `${spec.code} · ${spec.name}`;
  button.append(svg, code, name, detail);
  return button;
}

export function setupBuilder({ scene, camera, controls, canvas, specs, models, onGrip }) {
  const area = document.querySelector('#work-area');
  const panel = document.querySelector('#catalog');
  const cards = document.querySelector('#part-cards');
  const filters = document.querySelector('#part-filters');
  const marks = document.querySelector('#mount-points');
  const status = document.querySelector('#assembly-message');
  const count = document.querySelector('#assembly-count');
  const undo = document.querySelector('#assembly-undo');
  const remove = document.querySelector('#assembly-remove');
  document.querySelector('#catalog-total').textContent = String(specs.size);
  const ray = new Raycaster();
  const plane = new Plane();
  const ndc = new Vector2();
  const place = new Vector3();
  const normal = new Vector3();
  const projected = new Vector3();
  const pointer = new Vector2();
  const ghostMaterial = new MeshStandardMaterial({
    color: 0xefb570, emissive: 0x673717, emissiveIntensity: 0.44,
    transparent: true, opacity: 0.58, depthWrite: false, roughness: 0.48,
  });

  let enabled = false;
  let layout = example;
  let craft;
  let held;
  let drag;
  let nearest;
  let sequence = 0;
  const history = [];
  const initialHint = 'Перетащите деталь из каталога к креплению.';
  const label = (spec) => `${spec.code} · ${spec.name}`;

  function announce(text, tone = '') {
    if (status.textContent !== text) status.textContent = text;
    status.dataset.tone = tone;
  }

  function refresh(next, nextCraft) {
    craft?.group.removeFromParent();
    craft = nextCraft;
    layout = next;
    craft.group.position.copy(anchor);
    craft.group.quaternion.copy(standRotation);
    craft.group.traverse((item) => {
      if (item.isMesh) item.castShadow = item.receiveShadow = true;
    });
    scene.add(craft.group);
    craft.group.updateMatrixWorld(true);
    count.textContent = String(layout.length);
    undo.disabled = history.length === 0;
  }

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* The current scene still works. */ }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved)) refresh(saved, buildCraft(saved, specs, models));
  } catch { /* Restore the example if a previous layout is unreadable. */ }
  if (!craft) refresh(example, buildCraft(example, specs, models));

  function commit(next) {
    const rebuilt = buildCraft(next, specs, models);
    history.push(layout);
    refresh(next, rebuilt);
    save();
  }

  function undoEdit() {
    const previous = history.pop();
    if (!previous) return;
    clearGrip();
    refresh(previous, buildCraft(previous, specs, models));
    save();
    announce('Последнее изменение отменено.');
  }

  function descendantKeys(key) {
    const keys = new Set();
    for (const entry of layout) {
      if (entry.key === key || keys.has(entry.parent)) keys.add(entry.key);
    }
    return keys;
  }

  function findTargets(part, spec, excluded, blocked, rotation) {
    if (!layout.length) {
      return isFoundation(spec) ? [{ at: anchor, pose: { position: anchor, rotation: standRotation } }] : [];
    }
    const targets = [];
    for (const piece of craft.pieces.values()) {
      const { key } = piece.entry;
      if (excluded.has(key)) continue;
      const worldRotation = piece.object.getWorldQuaternion(new Quaternion());
      for (const [socket, port] of piece.spec.mounts) {
        const connectedToGrip = held?.piece?.entry.parent === key && held.piece.entry.socket === socket;
        if (piece.used.has(socket) && !connectedToGrip) continue;
        const at = piece.object.localToWorld(port.position.clone());
        const outward = worldRotation.clone().multiply(port.rotation);
        const direction = port.profile === 'jugre_radial' ? new Vector3(0, 0, 1).applyQuaternion(outward) : null;
        let target;
        let bestAngle = Infinity;
        for (const [plug, source] of spec.mounts) {
          if (blocked.has(plug) || !compatible(port, piece.entry.part, source, part)) continue;
          const pose = jointPose(at, outward, source);
          const angle = pose.rotation.angleTo(rotation);
          if (angle >= bestAngle) continue;
          bestAngle = angle;
          target = { parent: key, socket, plug, at, pose, direction, host: piece.spec };
        }
        if (target) targets.push(target);
      }
    }
    return targets;
  }

  function clearGrip() {
    const pointerId = drag?.id;
    drag = undefined;
    if (pointerId !== undefined && area.hasPointerCapture(pointerId)) area.releasePointerCapture(pointerId);
    if (held?.piece) held.piece.object.visible = true;
    held?.ghost.removeFromParent();
    held = nearest = undefined;
    controls.enabled = true;
    area.classList.remove('gripping', 'choosing');
    remove.hidden = true;
    remove.classList.remove('over');
    marks.replaceChildren();
    cards.querySelector('[aria-pressed=true]')?.setAttribute('aria-pressed', 'false');
  }

  function begin(part, piece, hit) {
    clearGrip();
    onGrip();
    const spec = specs.get(part);
    const ghost = piece ? piece.object.clone(true) : models.get(part).clone(true);
    ghost.traverse((item) => {
      if (!item.isMesh) return;
      item.material = ghostMaterial;
      item.castShadow = false;
      item.receiveShadow = false;
    });
    const grip = hit ? piece.object.worldToLocal(hit.clone()) : new Vector3();
    const rotation = piece ? piece.object.getWorldQuaternion(ghost.quaternion.clone()) : standRotation;
    const excluded = piece ? descendantKeys(piece.entry.key) : new Set();
    const blocked = new Set(piece ? layout.filter((entry) => entry.parent === piece.entry.key).map((entry) => entry.socket) : []);
    if (piece) piece.object.visible = false;
    ghost.visible = false;
    scene.add(ghost);
    held = { part, spec, piece, excluded, grip, ghost, rotation };
    held.targets = findTargets(part, spec, excluded, blocked, rotation);
    for (const target of held.targets) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'mount-point';
      marker.title = target.host ? `Крепление · ${label(target.host)}` : 'Основание на стапеле';
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('click', () => { if (held && !drag) attach(target); });
      target.marker = marker;
      marks.append(marker);
    }
    remove.hidden = !piece;
    cards.querySelector(`[data-part="${part}"]`)?.setAttribute('aria-pressed', 'true');
    if (held.targets.length) announce(`${label(spec)} · подведите к отмеченному креплению.`);
    else announce(layout.length ? `${label(spec)} · нет свободного подходящего крепления.` : 'Для основы выберите бак, раму или командный модуль.', 'invalid');
    update();
  }

  function attach(target) {
    const { part, piece, excluded, spec } = held;
    let key = piece?.entry.key;
    while (!key) {
      const candidate = `part-${++sequence}`;
      if (!craft.pieces.has(candidate)) key = candidate;
    }
    const next = layout.filter((entry) => !excluded.has(entry.key));
    const connection = target.parent === undefined ? {} : { parent: target.parent, socket: target.socket, plug: target.plug };
    next.push({ key, part, ...connection });
    if (piece) next.push(...layout.filter((entry) => excluded.has(entry.key) && entry.key !== key));
    clearGrip();
    commit(next);
    announce(`${label(spec)} · установлено.`, 'snap');
  }

  function returnPart() {
    if (!held?.piece) return;
    const next = layout.filter((entry) => !held.excluded.has(entry.key));
    clearGrip();
    commit(next);
    announce('Узел возвращён в каталог.');
  }

  function contains(rect, point) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function setRay(point, rect) {
    ndc.set((point.x - rect.left) / rect.width * 2 - 1, 1 - (point.y - rect.top) / rect.height * 2);
    ray.setFromCamera(ndc, camera);
  }

  function update() {
    if (!held) return;
    const rect = canvas.getBoundingClientRect();
    const overCanvas = drag?.moved && contains(rect, pointer);
    let distance = MathUtils.clamp(rect.width * 0.045, 25, 54);
    nearest = undefined;
    for (const target of held.targets) {
      projected.copy(target.at).project(camera);
      const faceVisible = !target.direction || normal.copy(camera.position).sub(target.at).dot(target.direction) > 0;
      const visible = faceVisible && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98 && Math.abs(projected.z) < 1;
      const x = (projected.x + 1) * rect.width / 2;
      const y = (1 - projected.y) * rect.height / 2;
      target.marker.hidden = !visible;
      if (!visible) continue;
      target.marker.style.left = `${x}px`;
      target.marker.style.top = `${y}px`;
      if (!overCanvas) continue;
      const delta = Math.hypot(x + rect.left - pointer.x, y + rect.top - pointer.y);
      if (delta >= distance) continue;
      nearest = target;
      distance = delta;
    }
    for (const target of held.targets) target.marker.classList.toggle('snapped', target === nearest);
    remove.classList.toggle('over', !!drag?.moved && !remove.hidden && contains(remove.getBoundingClientRect(), pointer));
    held.ghost.visible = !!overCanvas;
    if (!overCanvas) return;
    if (nearest) {
      held.ghost.position.copy(nearest.pose.position);
      held.ghost.quaternion.copy(nearest.pose.rotation);
      ghostMaterial.color.setHex(0x8ce0c0);
      ghostMaterial.emissive.setHex(0x216754);
      announce('Отпустите, чтобы установить.', 'snap');
    } else {
      setRay(pointer, rect);
      const origin = held.piece ? held.piece.object.localToWorld(held.grip.clone()) : anchor;
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(normal), origin);
      ray.ray.intersectPlane(plane, place);
      held.ghost.position.copy(place).sub(projected.copy(held.grip).applyQuaternion(held.rotation));
      held.ghost.quaternion.copy(held.rotation);
      ghostMaterial.color.setHex(0xefb570);
      ghostMaterial.emissive.setHex(0x673717);
      announce(held.targets.length ? 'Подведите деталь к зелёной точке.' : 'Нет свободного подходящего крепления.', 'invalid');
    }
  }

  function grab(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    pointer.set(event.clientX, event.clientY);
    drag = { id: event.pointerId, start: pointer.clone(), moved: false };
    controls.enabled = false;
    area.classList.add('gripping');
    area.setPointerCapture(event.pointerId);
  }

  cards.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('[data-part]');
    if (!enabled || !button || !event.isPrimary || event.button !== 0) return;
    begin(button.dataset.part);
    grab(event);
  });
  cards.addEventListener('click', (event) => {
    const button = event.target.closest('[data-part]');
    if (!enabled || !button || event.detail !== 0) return;
    begin(button.dataset.part);
    area.classList.add('choosing');
    update();
    marks.querySelector('button:not([hidden])')?.focus();
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (!enabled || held || !event.isPrimary || event.button !== 0) return;
    setRay(pointer.set(event.clientX, event.clientY), canvas.getBoundingClientRect());
    const hit = ray.intersectObject(craft.group, true)[0];
    let object = hit?.object;
    while (object && !object.userData.assemblyKey) object = object.parent;
    const piece = craft.pieces.get(object?.userData.assemblyKey);
    if (!piece?.entry.parent) return;
    begin(piece.entry.part, piece, hit.point);
    grab(event);
  }, { capture: true });

  area.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.id) return;
    pointer.set(event.clientX, event.clientY);
    drag.moved ||= pointer.distanceTo(drag.start) > 5;
    update();
  });
  area.addEventListener('pointerup', (event) => {
    if (event.pointerId !== drag?.id) return;
    pointer.set(event.clientX, event.clientY);
    drag.moved ||= pointer.distanceTo(drag.start) > 5;
    update();
    if (!drag.moved) {
      drag = undefined;
      controls.enabled = true;
      area.classList.remove('gripping');
      area.classList.add('choosing');
    } else if (nearest) {
      attach(nearest);
    } else if (!remove.hidden && contains(remove.getBoundingClientRect(), pointer)) {
      returnPart();
    } else {
      const hasTarget = held.targets.length > 0;
      clearGrip();
      announce(hasTarget ? 'Установка отменена. Подведите деталь к зелёной точке.' : 'Установка отменена. Подходящего крепления нет.', 'invalid');
    }
  });
  const cancel = () => {
    if (!held) return;
    clearGrip();
    announce(initialHint);
  };
  area.addEventListener('pointercancel', (event) => { if (event.pointerId === drag?.id) cancel(); });
  area.addEventListener('lostpointercapture', (event) => { if (event.pointerId === drag?.id) cancel(); });
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', (event) => {
    if (!enabled || event.target.matches?.('input, textarea')) return;
    if (event.key === 'Escape' && held) cancel();
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !event.shiftKey) {
      event.preventDefault();
      undoEdit();
    }
  });
  remove.addEventListener('click', returnPart);
  undo.addEventListener('click', undoEdit);
  document.querySelector('#assembly-new').addEventListener('click', () => {
    clearGrip();
    if (layout.length) commit([]);
    announce('Перетащите бак, раму или командный модуль на метку стапеля.');
  });
  document.querySelector('#assembly-example').addEventListener('click', () => {
    clearGrip();
    if (layout !== example) commit(example);
    announce(initialHint);
  });

  function showCategory(id) {
    for (const tab of filters.children) tab.setAttribute('aria-pressed', String(tab.dataset.category === id));
    const matching = [...specs].filter(([, spec]) => spec.group === id);
    cards.replaceChildren(...matching.map(([part, spec]) => partCard(part, spec)));
  }
  for (const [id, text] of categories) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.category = id;
    tab.textContent = text;
    tab.addEventListener('click', () => { cancel(); showCategory(id); });
    filters.append(tab);
  }
  showCategory('tanks');

  return {
    setEnabled(active) {
      if (enabled !== active) cancel();
      enabled = active;
      panel.hidden = !active;
      area.classList.toggle('building', active);
      document.querySelector('#assembly-hud').hidden = !active;
    },
    update,
  };
}
