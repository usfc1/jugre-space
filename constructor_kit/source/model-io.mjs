import { readFile } from 'node:fs/promises';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { X, Y, Z, node, mount, neg, rot } from './geometry.mjs';

const loader = new GLTFLoader();
const packs = new Map();
const models = new Map();
const base = new URL('../../', import.meta.url);

export async function readAsset(ref) {
  const { pack, id } = ref;
  if (!packs.has(pack)) {
    const folder = new URL(`${pack}/`, base);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
    packs.set(pack, { folder, manifest });
  }
  const { folder, manifest } = packs.get(pack);
  const key = `${pack}/${id}`;
  if (!models.has(key)) {
    const entry = ['parts', 'components', 'variants', 'assemblies'].map((key) => manifest[key]?.[id]).find(Boolean);
    if (!entry) throw new Error(`Missing source asset ${key}`);
    const bytes = await readFile(new URL(entry.file, folder));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { scene } = await loader.parseAsync(buffer, '');
    const root = findPart(scene, entry.root);
    if (!root) throw new Error(`Missing source node ${entry.root} in ${entry.file}`);
    models.set(key, root);
  }
  return models.get(key);
}

export function findPart(root, id) {
  let result;
  root.traverse((item) => { if (item.userData.partId === id) result = item; });
  return result;
}

export function removeNodes(root, filter) {
  const removed = [];
  root.traverse((item) => { if (item !== root && filter(item)) removed.push(item); });
  for (const item of removed) item.removeFromParent();
}

export function wrap(id, source, rotation) {
  const result = node(id);
  const visual = source.clone(true);
  visual.position.set(0, 0, 0);
  visual.quaternion.copy(rotation ?? new Quaternion());
  if (visual.userData.partId === id) {
    visual.name = `${id}.visual`;
    visual.userData.partId = visual.name;
  }
  result.add(visual);
  return { root: result, visual };
}

export function connector(parent, id, position, direction, profile, role, extra = {}) {
  const previous = findPart(parent, `${parent.name}.mount_${id}`);
  if (previous?.userData.role === 'mount') previous.removeFromParent();
  const result = mount(parent, `mount_${id}`, position, direction);
  const normal = new Vector3(...direction).normalize();
  const reference = new Vector3(...(Math.abs(normal.y) > 0.9 ? Z : Y));
  const right = new Vector3().crossVectors(reference, normal).normalize();
  const up = new Vector3().crossVectors(normal, right);
  result.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal));
  Object.assign(result.userData, { profile, attachmentRole: role, ...extra });
  return result;
}

export function axial(parent, id, at, direction, diameter) {
  return connector(parent, id, [0, at, 0], direction, `jugre_stack_${Math.round(diameter * 100)}`,
    'structure', { nominalDiameterM: diameter });
}

export function stack(root, top, aft, forward = aft) {
  axial(root, 'aft', 0, neg(Y), aft);
  axial(root, 'forward', top, Y, forward);
}

export function radial(root, id, xyz, normal = neg(Z), role = 'component') {
  return connector(root, id, xyz, normal, 'jugre_radial', role);
}

export function payload(root, y = 0, { receiver = false } = {}) {
  return connector(root, 'payload', [0, y, 0], receiver ? Y : neg(Y), 'jugre_payload', receiver ? 'payloadReceiver' : 'payload');
}

export function fairingReceivers(root, family, y) {
  for (const side of ['left', 'right']) {
    connector(root, `fairing_${side}`, [0, y, 0], Y, `heritage_fairing_${family}_${side}`, 'shellReceiver');
  }
}

function authoredRails(root, original, filter, role) {
  for (const [i, item] of original.children.filter((item) => filter.test(item.userData.partId ?? '')).entries()) {
    const direction = item.userData.role === 'mount'
      ? new Vector3(0, 0, 1).applyQuaternion(item.quaternion)
      : new Vector3(item.position.x, 0, item.position.z).normalize();
    radial(root, `${role}_${i + 1}`, item.position.toArray(), direction.toArray(), role);
  }
}

function existingAttachment(source, side) {
  const id = source.userData.partId;
  return findPart(source, `${id}.mount_${side}`)?.position.y;
}

export async function imported(entry) {
  const asset = await readAsset(entry.ref);
  const original = entry.node ? findPart(asset, entry.node) : asset;
  if (!original) throw new Error(`Cannot extract ${entry.node} from ${entry.ref.id}`);
  const angle = { orion_solar_wing_stowed: -Math.PI / 2, falcon9_grid_fin_deployed: Math.PI / 2 }[entry.id];
  const { root, visual } = wrap(entry.id, original, angle === undefined ? undefined : rot(X, angle));
  if (entry.strip) removeNodes(visual, (item) => entry.strip.test(item.userData.partId ?? ''));
  const bounds = new Box3().setFromObject(root, true);
  const config = entry.mount;
  if (config.stack || config.aft) {
    const aft = config.y ?? existingAttachment(original, 'aft') ?? 0;
    axial(root, 'aft', aft, neg(Y), config.aft ?? config.stack);
  }
  if (config.stack || config.forward) {
    const top = existingAttachment(original, 'forward') ?? bounds.max.y;
    axial(root, 'forward', top, Y, config.forward ?? config.stack);
  }
  if (config.engine) connector(root, 'engine', [0, 0, 0], Y, `heritage_engine_${config.engine}`, 'engine');
  if (config.radial) radial(root, 'rail', [0, 0, 0], config.normal);
  if (config.cargo) payload(root, bounds.min.y);
  if (config.fairingReceiver) fairingReceivers(root, config.fairingReceiver, existingAttachment(original, 'forward') ?? bounds.max.y);
  if (config.fairing) connector(root, 'shell', [0, 0, 0], neg(Y), `heritage_fairing_${config.fairing.join('_')}`, 'shell');
  if (config.socket) connector(root, 'fitting', [0, config.socket.y, 0], config.socket.receiver ? Y : neg(Y),
    config.socket.profile, config.socket.receiver ? 'host' : 'component');
  if (config.radialHosts) authoredRails(root, original, config.radialHosts, 'host');
  if (config.booster) {
    const core = original.children.some((item) => /\.mount_core_/.test(item.userData.partId ?? ''));
    authoredRails(root, original, core ? /\.mount_core_/ : /\.mount_(lower|upper)$/, 'booster');
  }
  return { root, representation: entry.node || entry.strip ? 'extracted' : 'existing', ...entry,
    staging: entry.category === 'separation' ? config.fairing ? 'fairingJettison' : 'detach' : undefined, mount: undefined, strip: undefined, node: undefined };
}
