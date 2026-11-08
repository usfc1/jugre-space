import { Euler, Group, Quaternion, Vector3 } from 'three';

export const standPosition = [-6.38, 2.24, -4.42];
export const standRotation = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, -Math.PI / 2, 'ZYX'));
export const example = [
  { key: 'tank', part: 'b_240_rezerv' },
  { key: 'frame', part: 'r_253_triada', parent: 'tank', socket: 'mount_aft', plug: 'mount_forward' },
  ...[1, 2, 3].map((i) => ({
    key: `engine${i}`, part: 'k_125_klen', parent: 'frame', socket: `mount_engine_0${i}`, plug: 'mount_engine',
  })),
  { key: 'separator', part: 'o_25_razryv', parent: 'tank', socket: 'mount_forward', plug: 'release_ring.mount_aft' },
  { key: 'upper', part: 'b_140_bochka', parent: 'separator', socket: 'retained_ring.mount_forward', plug: 'mount_aft' },
  { key: 'base', part: 'ob_25_poyas', parent: 'upper', socket: 'mount_forward', plug: 'mount_aft' },
  { key: 'shell', part: 'st_25_stvorka_right', parent: 'base', socket: 'mount_shell_right', plug: 'mount_latch' },
];

const flip = new Quaternion(0, 1, 0, 0);
const rolePairs = new Set([
  'structure/structure', 'engine/structure', 'engine/engineReceiver', 'boosterReceiver/host',
  'host/surface', 'host/tank', 'host/thruster', 'adapter/host', 'shell/shellReceiver',
]);

export function compatible(target, targetPart, source, sourcePart) {
  return target.profile === source.profile
    && rolePairs.has([target.attachmentRole, source.attachmentRole].sort().join('/'))
    && (!target.acceptsParts || target.acceptsParts.includes(sourcePart))
    && (!source.acceptsParts || source.acceptsParts.includes(targetPart));
}

export function isFoundation(spec) {
  return [...spec.mounts.values()].some((port) => port.attachmentRole === 'structure');
}

export function jointPose(targetPosition, targetRotation, plug) {
  const rotation = targetRotation.clone().multiply(flip).multiply(plug.rotation.clone().invert());
  const position = targetPosition.clone().sub(plug.position.clone().applyQuaternion(rotation));
  return { position, rotation };
}

export function prepareParts(parts) {
  return new Map(Object.entries(parts).map(([id, spec]) => {
    const mounts = new Map(Object.entries(spec.mounts).map(([name, port]) => [name.slice(id.length + 1), {
      ...port, position: new Vector3(...port.translation), rotation: new Quaternion(...port.rotation),
    }]));
    return [id, { ...spec, mounts }];
  }));
}

export function buildCraft(layout, specs, models) {
  const group = new Group();
  const pieces = new Map();
  for (const entry of layout) {
    const { key, part, parent, socket, plug } = entry;
    const spec = specs.get(part);
    if (!spec || typeof key !== 'string' || pieces.has(key)) throw new Error('Invalid assembly part');
    const object = new Group();
    object.name = key;
    object.userData.assemblyKey = key;
    object.add(models.get(part).clone(true));
    const used = new Set();
    if (parent === undefined) {
      if (pieces.size || !isFoundation(spec)) throw new Error('Invalid assembly foundation');
      group.add(object);
    } else {
      const host = pieces.get(parent);
      const target = host?.spec.mounts.get(socket);
      const source = spec.mounts.get(plug);
      if (!target || !source || host.used.has(socket) || !compatible(target, host.entry.part, source, part)) {
        throw new Error(`Invalid assembly connection: ${part}.${plug} → ${parent}.${socket}`);
      }
      const { position, rotation } = jointPose(target.position, target.rotation, source);
      object.position.copy(position);
      object.quaternion.copy(rotation);
      host.object.add(object);
      host.used.add(socket);
      used.add(plug);
    }
    pieces.set(key, { entry, object, spec, used });
  }
  return { group, pieces };
}
