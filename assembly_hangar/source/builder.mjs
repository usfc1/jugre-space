import {
  Box3, MathUtils, MeshStandardMaterial, Plane, Quaternion, Raycaster, Vector2, Vector3,
} from 'three';
import { buildCraft, cargoExample, compatible, example, isFoundation, jointPose } from './assembly.mjs';
import { setupPayloadPreview } from './payload-preview.mjs';
import { vehicleFromAssembly } from './launch-vehicles.mjs';
import { deckY, defaultRocketBounds, placeOnDeck } from './vab-layout.mjs';
import { decoratePayload } from './payload-configuration.mjs';

const storageKey = 'jugre.assembly-hangar.craft.v1';
const deck = new Vector3(0, deckY, 0);
const upright = new Quaternion();
const categories = [
  ['command', 'Control'], ['payload', 'Bays'], ['vehicles', 'Spacecraft'],
  ['tanks', 'Tanks'], ['propulsion', 'Engines'], ['structure', 'Structure'], ['surfaces', 'Fins'],
];
function partCard(id, spec, thumbnails) {
  const button = document.createElement('button');
  button.className = 'part-card';
  button.type = 'button';
  button.dataset.part = id;
  button.setAttribute('aria-pressed', 'false');
  const code = document.createElement('span');
  code.className = 'part-code';
  code.textContent = spec.code;
  const name = document.createElement('span');
  name.className = 'part-name';
  name.textContent = spec.name;
  const compatibility = document.createElement('span');
  compatibility.className = 'part-compatibility';
  button.title = `${spec.code} · ${spec.name}`;
  const preview = document.createElement('img');
  preview.alt = ''; preview.width = 64; preview.height = 54;
  preview.src = thumbnails.get(id);
  const identity = document.createElement('span');
  identity.className = 'part-identity';
  identity.append(name, code);
  button.append(preview, identity, compatibility);
  return button;
}

export function setupBuilder({ scene, camera, controls, canvas, specs, models, clips, thumbnails, onGrip, onLayout, onInspect, onPreset, onPreview }) {
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
  let craftVisible = true;
  let layout = example;
  let craft;
  let held;
  let drag;
  let nearest;
  let sequence = 0;
  const history = [];
  const future = [];
  const redo = document.querySelector('#assembly-redo');
  let selectedKey;
  let payloadConfiguration;
  let isolated = false;
  let suspendedHistory;
  let pendingRemoval;
  const confirmation = document.querySelector('#assembly-confirm');
  document.querySelector('#assembly-confirm-cancel').addEventListener('click', () => confirmation.close());
  document.querySelector('#assembly-confirm-accept').addEventListener('click', () => { confirmation.close(); pendingRemoval?.(); pendingRemoval = undefined; });
  const initialHint = 'Drag a part to a mount.';
  const label = (spec) => `${spec.code} · ${spec.name}`;

  function announce(text, tone = '') {
    if (status.textContent !== text) status.textContent = text;
    status.dataset.tone = tone;
  }

  const systems = setupPayloadPreview(clips, announce, (key) => {
    clearGrip();
    const excluded = descendantKeys(key);
    commit(layout.filter((entry) => !excluded.has(entry.key)));
    announce('Payload removed.');
  }, onInspect);

  function refresh(next, nextCraft) {
    craft?.group.removeFromParent();
    craft = nextCraft;
    layout = next;
    craft.group.name = 'vab_custom_rocket';
    const localBounds = new Box3().setFromObject(craft.group, true);
    const bounds = localBounds.isEmpty() ? defaultRocketBounds() : placeOnDeck(craft.group, localBounds);
    craft.group.visible = craftVisible;
    craft.group.traverse((item) => {
      if (item.isMesh) item.castShadow = item.receiveShadow = true;
    });
    scene.add(craft.group);
    craft.group.updateMatrixWorld(true);
    count.textContent = String(layout.length);
    undo.disabled = history.length === 0;
    redo.disabled = future.length === 0;
    systems.load(craft.pieces);
    onLayout(bounds);
    window.dispatchEvent(new CustomEvent('jugre-assembly-change'));
  }

  function save() {
    if (isolated) return;
    try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* The current scene still works. */ }
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved)) refresh(saved, buildCraft(saved, specs, models));
  } catch { /* Restore the example if a previous layout is unreadable. */ }
  if (!craft) refresh(example, buildCraft(example, specs, models));

  function commit(next) {
    const rebuilt = buildCraft(next, specs, models);
    history.push(structuredClone(layout));
    future.length = 0;
    refresh(next, rebuilt);
    save();
  }

  function undoEdit() {
    const previous = history.pop();
    if (!previous) return;
    clearGrip();
    future.push(layout);
    refresh(previous, buildCraft(previous, specs, models));
    save();
    announce('Undone.');
  }
  function redoEdit() {
    const next = future.pop();
    if (!next) return;
    clearGrip();
    history.push(layout);
    refresh(next, buildCraft(next, specs, models));
    save();
    announce('Redone.');
  }
  function removeKeys(key) {
    const excluded = descendantKeys(key);
    const perform = () => { clearGrip(); commit(layout.filter(entry => !excluded.has(entry.key))); };
    if (excluded.size <= 1) { perform(); return; }
    pendingRemoval = perform;
    document.querySelector('#assembly-confirm-message').textContent =
      'Remove the selected part and ' + excluded.size + ' attached parts. ' +
      layout.filter(entry => excluded.has(entry.key)).map(entry => label(specs.get(entry.part))).join(', ') +
      '. You can undo this.';
    confirmation.showModal();
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
      if (!isFoundation(spec)) return [];
      const bottom = new Box3().setFromObject(models.get(part)).min.y;
      return [{ at: deck, pose: { position: new Vector3(0, deckY - bottom, 0), rotation: upright } }];
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
          target = { parent: key, socket, plug, at, pose, direction, host: piece.spec, role: port.attachmentRole };
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
    if (spec.system === 'payload') systems.openBays();
    const ghost = piece ? piece.object.clone(true) : models.get(part).clone(true);
    if (!piece && payloadConfiguration?.part === part) decoratePayload(ghost, payloadConfiguration.spacecraft);
    ghost.traverse((item) => {
      if (!item.isMesh) return;
      item.material = ghostMaterial;
      item.castShadow = false;
      item.receiveShadow = false;
    });
    const grip = hit ? piece.object.worldToLocal(hit.clone()) : new Vector3();
    const rotation = piece ? piece.object.getWorldQuaternion(ghost.quaternion.clone()) : upright;
    const excluded = piece ? descendantKeys(piece.entry.key) : new Set();
    const blocked = new Set(piece ? layout.filter((entry) => entry.parent === piece.entry.key).map((entry) => entry.socket) : []);
    ghost.visible = false;
    scene.add(ghost);
    const size = new Box3().setFromObject(ghost).getSize(new Vector3());
    held = { part, spec, piece, excluded, grip, ghost, rotation, large: Math.max(size.x, size.y, size.z) >= 2.5 };
    held.targets = findTargets(part, spec, excluded, blocked, rotation);
    if (spec.group === 'propulsion') held.targets.sort((a, b) => Number(b.role === 'engineReceiver') - Number(a.role === 'engineReceiver'));
    for (const target of held.targets) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'mount-point';
      marker.textContent = target.role === 'engineReceiver' ? '✓ Engine' : target.direction ? '✓ Side' : '✓ Mount';
      marker.title = target.host ? `Mount · ${label(target.host)} · ${target.socket}` : 'Build stand';
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('click', () => { if (held && !drag && canGrip()) attach(target); });
      target.marker = marker;
      marks.append(marker);
    }
    remove.hidden = !piece;
    cards.querySelector(`[data-part="${part}"]`)?.setAttribute('aria-pressed', 'true');
    if (held.targets.length) announce(`${label(spec)} · move to a marked mount.`);
    else announce(spec.system === 'payload' ? 'Requires an empty GO-34 bay.'
      : layout.length ? `${label(spec)} · no compatible mount.` : 'Start with a tank, frame, or control module.', 'invalid');
    update();
    if (!piece && held.targets.length) onPreview?.(held.targets.map(target => target.at), new Box3().setFromObject(ghost));
  }

  function attach(target) {
    const { part, piece, excluded, spec } = held;
    const previewPosition = held.ghost.getWorldPosition(new Vector3());
    const quantity = piece ? 1 : Number(document.querySelector('#assembly-symmetry').value);
    const prefix = target.socket?.replace(/\d+$/, '');
    let siblings = quantity > 1 ? held.targets.filter(item => item.parent === target.parent &&
      item.socket?.replace(/\d+$/, '') === prefix && Math.abs(item.at.y - target.at.y) < .01) : [target];
    if (siblings.length < quantity) { announce('This symmetry needs ' + quantity + ' matching mounts on the same level.', 'invalid'); return; }
    if (quantity > 1) {
      const center = craft.pieces.get(target.parent).object.getWorldPosition(new Vector3());
      const angle = item => Math.atan2(item.at.x - center.x, item.at.z - center.z);
      const initial = angle(target);
      const chosen = [target];
      for (let index = 1; index < quantity; index++) {
        const desired = initial + index * Math.PI * 2 / quantity;
        const sibling = siblings.find(item => !chosen.includes(item) &&
          Math.abs(Math.atan2(Math.sin(angle(item) - desired), Math.cos(angle(item) - desired))) < .08);
        if (!sibling) { announce('Choose a different symmetry.', 'invalid'); return; }
        chosen.push(sibling);
      }
      siblings = chosen;
    }
    let key = piece?.entry.key;
    while (!key) {
      const candidate = `part-${++sequence}`;
      if (!craft.pieces.has(candidate)) key = candidate;
    }
    const next = layout.filter((entry) => !excluded.has(entry.key));
    const connection = target.parent === undefined ? {} : { parent: target.parent, socket: target.socket, plug: target.plug };
    const extra = payloadConfiguration?.part === part ? { spacecraft: structuredClone(payloadConfiguration.spacecraft) } : {};
    next.push({ key, part, ...connection, ...extra });
    for (const sibling of siblings.filter(item => item !== target).slice(0, quantity - 1)) {
      let siblingKey;
      do { siblingKey = 'part-' + (++sequence); } while (next.some(entry => entry.key === siblingKey));
      next.push({ key: siblingKey, part, parent: sibling.parent, socket: sibling.socket, plug: sibling.plug, ...extra });
    }
    if (piece) next.push(...layout.filter((entry) => excluded.has(entry.key) && entry.key !== key));
    clearGrip();
    commit(next);
    const installed = craft.pieces.get(key);
    const end = installed.object.position.clone();
    const from = installed.object.parent.worldToLocal(previewPosition);
    if (from.distanceTo(end) < .05) from.y += .22;
    installed.object.position.copy(from);
    installed.object.userData.snapScale = { end, from, progress: 0 };
    announce(`${label(spec)} · installed.`, 'snap');
  }

  function returnPart() {
    if (!held?.piece) return;
    removeKeys(held.piece.entry.key);
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
    if (held.piece) held.piece.object.visible = !drag?.moved;
    let distance = MathUtils.clamp(rect.width * 0.045, 25, 54);
    const projectedTargets = [];
    nearest = undefined;
    for (const target of held.targets) {
      projected.copy(target.at).project(camera);
      const faceVisible = !target.direction || normal.copy(camera.position).sub(target.at).dot(target.direction) > 0;
      const visible = faceVisible && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98 && Math.abs(projected.z) < 1;
      let x = (projected.x + 1) * rect.width / 2;
      const y = (1 - projected.y) * rect.height / 2;
      target.marker.hidden = !visible;
      if (!visible) continue;
      const overlaps = projectedTargets.filter(point => Math.abs(point.x - x) < 95 && Math.abs(point.y - y) < 27).length;
      if (overlaps) x += overlaps * 102;
      projectedTargets.push({ x, y });
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
    held.ghost.visible = !!overCanvas || (!drag?.moved && held.targets.length > 0);
    if (!overCanvas) {
      if (held.targets[0]) {
        held.ghost.position.copy(held.targets[0].pose.position);
        held.ghost.quaternion.copy(held.targets[0].pose.rotation);
      }
      return;
    }
    if (nearest) {
      held.ghost.position.copy(nearest.pose.position);
      held.ghost.quaternion.copy(nearest.pose.rotation);
      ghostMaterial.color.setHex(0x8ce0c0);
      ghostMaterial.emissive.setHex(0x216754);
      announce('Release to attach.', 'snap');
    } else {
      setRay(pointer, rect);
      const origin = held.piece ? held.piece.object.localToWorld(held.grip.clone())
        : held.targets.reduce((nearest, target) => nearest.distanceTo(camera.position) <= target.at.distanceTo(camera.position)
          ? nearest : target.at, held.targets[0]?.at ?? craft.group.position);
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(normal), origin);
      ray.ray.intersectPlane(plane, place);
      held.ghost.position.copy(place).sub(projected.copy(held.grip).applyQuaternion(held.rotation));
      held.ghost.quaternion.copy(held.rotation);
      ghostMaterial.color.setHex(0xefb570);
      ghostMaterial.emissive.setHex(0x673717);
      announce(held.targets.length ? 'Move to a green mount.' : 'No compatible mount.', 'invalid');
    }
  }

  function grab(event, selection) {
    event.preventDefault();
    event.stopImmediatePropagation();
    pointer.set(event.clientX, event.clientY);
    drag = { id: event.pointerId, start: pointer.clone(), moved: false, selection };
    controls.enabled = false;
    area.classList.add('gripping');
    area.setPointerCapture(event.pointerId);
  }

  function canGrip() {
    if (!systems.isReleasing()) return true;
    announce('Stow the payload first.', 'invalid');
    return false;
  }

  cards.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('[data-part]');
    if (!enabled || !button || !event.isPrimary || event.button !== 0 || !canGrip()) return;
    begin(button.dataset.part);
    grab(event);
  });
  cards.addEventListener('click', (event) => {
    const button = event.target.closest('[data-part]');
    if (!enabled || !button || event.detail !== 0 || !canGrip()) return;
    begin(button.dataset.part);
    area.classList.add('choosing');
    update();
    marks.querySelector('button:not([hidden])')?.focus();
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (!enabled || held || !event.isPrimary || event.button !== 0) return;
    setRay(pointer.set(event.clientX, event.clientY), canvas.getBoundingClientRect());
    const hit = ray.intersectObject(craft.group, true).find(({ object }) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    });
    let object = hit?.object;
    while (object && !object.userData.assemblyKey) object = object.parent;
    const piece = craft.pieces.get(object?.userData.assemblyKey);
    if (!piece) return;
    if (piece.entry.parent !== undefined && !systems.isReleasing()) begin(piece.entry.part, piece, hit.point);
    else onGrip();
    grab(event, piece);
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
    if (drag.selection && !drag.moved) {
      const { selection } = drag;
      clearGrip();
      selectedKey = selection.entry.key;
      window.dispatchEvent(new CustomEvent('jugre-assembly-select', { detail: selectedKey }));
      onInspect(selection, 'part');
      announce(label(selection.spec));
    } else if (!held) {
      clearGrip();
    } else if (!drag.moved) {
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
      announce(hasTarget ? 'Move to a green mount to attach.' : 'No compatible mount.', 'invalid');
    }
  });
  const cancel = () => {
    if (!held && !drag) return;
    clearGrip();
    announce(initialHint);
  };
  area.addEventListener('pointercancel', (event) => { if (event.pointerId === drag?.id) cancel(); });
  area.addEventListener('lostpointercapture', (event) => { if (event.pointerId === drag?.id) cancel(); });
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', (event) => {
    if (!enabled || event.target.matches?.('input, textarea')) return;
    if (event.key === 'Escape') cancel();
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !event.shiftKey) {
      event.preventDefault();
      undoEdit();
    }
    if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyY' || event.code === 'KeyZ' && event.shiftKey)) {
      event.preventDefault();
      redoEdit();
    }
  });
  remove.addEventListener('click', returnPart);
  undo.addEventListener('click', undoEdit);
  redo.addEventListener('click', redoEdit);
  document.querySelector('#assembly-new').addEventListener('click', () => {
    clearGrip();
    if (layout.length) commit([]);
    announce('Drag a tank, frame, or control module onto the stand.');
  });
  document.querySelector('#assembly-example').addEventListener('click', () => {
    clearGrip();
    if (layout !== example) commit(example);
    onPreset();
    announce(initialHint);
  });
  document.querySelector('#assembly-cargo-example').addEventListener('click', () => {
    clearGrip();
    commit(cargoExample);
    showCategory('vehicles');
    onPreset();
    announce('Folded satellite installed. Test it in Build setup.');
  });

  function showCategory(id) {
    for (const tab of filters.children) tab.setAttribute('aria-pressed', String(tab.dataset.category === id));
    const matching = [...specs].filter(([, spec]) => spec.group === id);
    cards.replaceChildren(...matching.map(([part, spec]) => partCard(part, spec, thumbnails)));
    window.dispatchEvent(new CustomEvent('jugre-catalog-change'));
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
    choose(part, configuration) {
      payloadConfiguration = configuration ? { part, spacecraft: configuration } : undefined;
      begin(part);
      area.classList.add('choosing');
    },
    showCategory,
    focusPart(key) {
      const piece = craft.pieces.get(key);
      if (!piece) return;
      selectedKey = key;
      window.dispatchEvent(new CustomEvent('jugre-assembly-select', { detail: key }));
      onInspect(piece, 'part');
    },
    getPieces() { return craft.pieces; },
    removePart: removeKeys,
    replacePart(key, part) {
      try {
        const next = layout.map(entry => entry.key === key ? { ...entry, part } : entry);
        buildCraft(next, specs, models);
        clearGrip();
        commit(next);
        announce('Part replaced.');
      } catch { announce('Replacement does not fit adjacent parts.', 'invalid'); }
    },
    configurePayload(key, spacecraft) {
      commit(layout.map(entry => entry.key === key ? { ...entry, spacecraft } : entry));
    },
    compatibility(part) {
      const spec = specs.get(part);
      const targets = findTargets(part, spec, new Set(), new Set(), upright);
      if (targets.length) return { ok: true, text: 'Compatible mounts: ' + targets.length };
      const profiles = new Set([...spec.mounts.values()].map(port => port.profile));
      const matching = [...craft.pieces.values()].some(piece => [...piece.spec.mounts.values()].some(port => profiles.has(port.profile)));
      return { ok: false, text: layout.length ? matching ? 'Matching mount required' : 'Adapter required' : 'Start with a tank or frame' };
    },
    setIsolated(value) {
      if (value === isolated) return;
      if (value) suspendedHistory = { history: [...history], future: [...future] };
      isolated = value;
      history.length = 0; future.length = 0;
      if (!value && suspendedHistory) {
        history.push(...suspendedHistory.history);
        future.push(...suspendedHistory.future);
        suspendedHistory = undefined;
      }
      undo.disabled = history.length === 0;
      redo.disabled = future.length === 0;
    },
    get installingLargePart() { return !!held?.large; },
    canInstallPayload(part) {
      return !systems.isReleasing() && !!findTargets(part, specs.get(part), new Set(), new Set(), upright).length;
    },
    stagePayload(part, configuration) {
      payloadConfiguration = configuration ? { part, spacecraft: configuration } : undefined;
      begin(part);
      if (!held.targets.length) return;
      const bay = craft.pieces.get(held.targets[0].parent);
      area.classList.add('choosing');
      onInspect(bay, 'bay');
    },
    getLayout() { return structuredClone(layout); },
    applyBlueprint(blueprint) {
      cancel();
      commit(structuredClone(blueprint.layout));
    },
    snapshotCraft(candidate = layout) {
      if (!candidate.length) return null;
      const root = buildCraft(candidate, specs, models).group;
      root.userData.launchVehicle = vehicleFromAssembly(candidate, specs);
      return root;
    },
    setCraftVisible(visible) {
      craftVisible = visible;
      craft.group.visible = visible;
    },
    setEnabled(active) {
      if (enabled !== active) cancel();
      enabled = active;
      panel.hidden = !active;
      area.classList.toggle('building', active);
      document.querySelector('#assembly-hud').hidden = !active;
    },
    update(dt) {
      for (const piece of craft.pieces.values()) {
        const snap = piece.object.userData.snapScale;
        if (!snap) continue;
        snap.progress = Math.min(1, snap.progress + dt * 5);
        piece.object.position.lerpVectors(snap.from, snap.end, MathUtils.smoothstep(snap.progress, 0, 1));
        if (snap.progress === 1) delete piece.object.userData.snapScale;
      }
      systems.update(dt);
      update();
    },
  };
}
