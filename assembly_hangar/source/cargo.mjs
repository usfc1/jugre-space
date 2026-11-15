import { AnimationClip, Box3, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import { box, cylinder, lathe, node, polar, ring, rod, rot, seal, sphere, X, Y, Z, yaw } from '../../original_parts/source/geometry.mjs';
import { readAsset } from '../../constructor_kit/source/model-io.mjs';

export const bayId = 'go_34_cargo_bay';
export const cargoIds = ['mayak_k', 'mayak_s', 'barkhan_4', 'barkhan_6'];
const colors = {
  ivory: 0xe6e4dc, dark: 0x25343f, steel: 0x788b97, gold: 0xcd8a39, teal: 0x3f9598,
};
const m = Object.fromEntries(Object.entries(colors).map(([name, color]) =>
  [name, new MeshStandardMaterial({ name, color, metalness: name === 'steel' ? 0.5 : 0.14, roughness: 0.63 })]));
const aft = rot(X, Math.PI / 2);
const forward = new Quaternion(0, Math.SQRT1_2, Math.SQRT1_2, 0);
const face = new Quaternion(0, 1, 0, 0);
const bore = 1.6;
const radius = 1.73;
const bottom = 0.6;
const top = 5.06;
const midpoint = (bottom + top) / 2;

function port(root, mounts, key, profile, attachmentRole, translation, rotation, more = {}) {
  const connector = node(key, root, translation, { role: 'mount', profile, attachmentRole, ...more });
  connector.quaternion.copy(rotation);
  mounts[connector.name] = { profile, attachmentRole, translation, rotation: rotation.toArray(), ...more };
}

function casing(parent, start, sweep) {
  const sections = { start, sweep, segments: 34 };
  lathe(parent, m.ivory, [[radius, bottom], [radius, top]], sections);
  lathe(parent, m.steel, [[bore, top], [bore, bottom]], sections);
  for (const y of [bottom + 0.12, top - 0.21]) ring(parent, m.gold, radius + 0.01, bore, y, y + 0.075, sections);
  for (const y of [1.56, 2.82, 4.12]) ring(parent, m.dark, bore + 0.008, bore - 0.046, y, y + 0.045, sections);
}

export function buildBay() {
  const root = node(bayId, null, [0, 0, 0], { role: 'cargoBay' });
  const mounts = {};
  port(root, mounts, 'mount_aft', 'jugre_stack_250', 'structure', [0, 0, 0], aft);
  port(root, mounts, 'mount_forward', 'jugre_stack_250', 'structure', [0, 5.66, 0], forward);
  port(root, mounts, 'mount_payload', 'jugre_cargo_bay_34', 'payloadReceiver', [0, midpoint, 0], forward, { acceptsParts: cargoIds });
  lathe(root, m.ivory, [[1.25, 0], [1.25, 0.11], [radius, bottom], [radius, bottom + 0.09]]);
  lathe(root, m.ivory, [[radius, top - 0.09], [radius, top], [1.25, 5.54], [1.25, 5.66]]);
  for (const y of [0, 5.55]) ring(root, m.steel, 1.255, 0.99, y, y + 0.11);
  for (const y of [bottom - 0.095, top]) cylinder(root, m.dark, radius - 0.035, y, y + 0.083);
  const angle = 1.31;
  const opening = -Math.PI / 2;
  casing(root, opening + angle, 2 * Math.PI - 2 * angle);
  const tracks = [];
  for (const sign of [-1, 1]) {
    const edge = opening + sign * angle;
    const hinge = polar(radius, edge);
    const pivot = node(sign < 0 ? 'door_lower' : 'door_upper', root, hinge, { role: 'hinge', axis: Y });
    const shell = node('shell', pivot, hinge.map((value) => -value));
    casing(shell, sign < 0 ? edge : opening + 0.009, angle - 0.009);
    rod(root, m.dark, [hinge[0], bottom, hinge[2]], [hinge[0], top, hinge[2]], 0.055);
    const latch = node('latch', shell, polar(radius + 0.026, opening + sign * 0.12, midpoint));
    latch.quaternion.copy(yaw(opening));
    box(latch, m.teal, [0.16, 0.39, 0.048]);
    tracks.push(new QuaternionKeyframeTrack(`${pivot.uuid}.quaternion`, [0, 1],
      [...new Quaternion().toArray(), ...rot(Y, sign * 0.96).toArray()]));
  }
  // The wheel restraints sit outside the central mounting volume.
  for (const y of [bottom + 0.12, top - 0.12]) {
    box(root, m.steel, [2.28, 0.10, 0.094], [0, y, 0.765]);
    for (const x of [-0.84, 0.84]) box(root, m.gold, [0.25, 0.18, 0.10], [x, y, 0.71]);
  }
  return {
    root: seal(root), clips: [new AnimationClip('bay_doors', 1, tracks)],
    spec: { code: 'GO-34', name: 'Cargo bay', group: 'payload', detail: 'Doors · 1 payload', massKg: 480, massBasis: 'JUGRE engineering estimate',
      system: 'bay', clip: 'bay_doors', mounts, stats: { mountDiameterM: 2.5 }, dimensionsM: [3.46, 5.66, 3.46] },
  };
}

export async function buildCrew(original) {
  const root = node('pk_2_kontur', null, [0, 0, 0], { role: 'crewCabin', seats: 2 });
  const exterior = node('exterior', root, [0, 0, 0], { role: 'crewExterior' });
  const skin = (await readAsset({ pack: 'original_parts', id: root.name })).clone(true);
  skin.name = 'pressure_shell_visual';
  delete skin.userData.partId;
  for (const mount of skin.children.filter((item) => item.userData.role === 'mount')) root.add(mount);
  exterior.rotation.y = -Math.PI / 2;
  exterior.add(skin);
  const cabin = node('interior', root);
  cylinder(cabin, m.dark, 1.03, 0.20, 0.26, undefined, 40);
  ring(cabin, m.steel, 1.13, 0.99, 0.19, 0.29);
  for (const z of [-0.35, 0.35]) {
    box(cabin, m.steel, [0.65, 0.13, 0.59], [0.09, 0.33, z]);
    box(cabin, m.teal, [0.48, 0.12, 0.48], [0.08, 0.43, z]);
    box(cabin, m.dark, [0.12, 0.56, 0.47], [0.32, 0.66, z], rot(Z, -0.13));
    box(cabin, m.teal, [0.11, 0.24, 0.28], [0.27, 1.02, z]);
    for (const dz of [-0.12, 0.12]) rod(cabin, m.gold, [0.24, 0.89, z + dz], [-0.06, 0.48, z + dz], 0.019);
  }
  box(cabin, m.dark, [0.26, 0.22, 1.01], [-0.55, 0.79, 0], rot(Z, 0.32));
  for (const z of [-0.25, 0.25]) box(cabin, m.teal, [0.037, 0.12, 0.36], [-0.674, 0.79, z], rot(Z, 0.32));
  for (const z of [-0.40, 0, 0.40]) sphere(cabin, m.gold, [0.021, 0.021, 0.021], [-0.68, 0.75, z], 8);
  seal(cabin);
  return {
    root, clips: [],
    spec: { ...original, name: 'Contour', group: 'command', detail: '2 seats · Ø 2.5 m', system: 'crew' },
  };
}

export function packedCargo(id, part, code, name) {
  const { min, max } = part.transportBounds.bounds;
  const rover = part.vehicle === 'rover';
  const rotation = rover ? rot(X, -Math.PI / 2) : new Quaternion();
  const plug = new Vector3(0, rover ? 0.71 : (min[1] + max[1]) / 2, rover ? (min[2] + max[2]) / 2 : 0);
  const packed = new Box3(new Vector3(...min), new Vector3(...max));
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const p = new Vector3(x, y, z).sub(plug).applyQuaternion(rotation);
        if (Math.hypot(p.x, p.z) > bore - 0.045 || Math.abs(p.y) > (top - bottom) / 2 - 0.12) {
          throw new Error(`${id} does not fit the closed cargo bay`);
        }
      }
    }
  }
  return {
    code, name, group: 'vehicles', detail: rover ? 'Folding mast' : 'Folding panels',
    system: 'payload', vehicle: part.vehicle, clip: part.transportClip, stats: part.gameStats,
    dimensionsM: packed.getSize(new Vector3()).toArray(),
    releaseM: radius + 0.22 + Math.max(Math.abs(part.bounds.min[0]), Math.abs(part.bounds.max[0])),
    mounts: { [`${id}.bay_payload`]: {
      profile: 'jugre_cargo_bay_34', attachmentRole: 'payload', translation: plug.toArray(),
      rotation: rotation.invert().multiply(forward).multiply(face).toArray(),
    } },
  };
}
