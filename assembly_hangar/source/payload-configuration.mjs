import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { readSpacecraft, spacecraftTotals } from './spacecraft-design.mjs';
import { labItem } from './payload-lab-catalog.mjs';

const box = new BoxGeometry(1, 1, 1);
const rounded = new RoundedBoxGeometry(1, 1, 1, 2, .055);
const cylinder = new CylinderGeometry(.5, .5, 1, 24);
const bolt = new CylinderGeometry(.5, .5, 1, 6);
const ring = new TorusGeometry(.5, .045, 6, 24);
const metal = new MeshStandardMaterial({ color: 0x9aa8ae, metalness: .64, roughness: .46 });
const paint = new MeshStandardMaterial({ color: 0x536b78, metalness: .3, roughness: .58 });
const dark = new MeshStandardMaterial({ color: 0x202d35, metalness: .32, roughness: .56 });
const glass = new MeshStandardMaterial({ color: 0x244b66, metalness: .52, roughness: .13, emissive: 0x102234, emissiveIntensity: .14 });
const gold = new MeshStandardMaterial({ color: 0xb89556, metalness: .5, roughness: .66 });
const cells = new MeshStandardMaterial({ color: 0x203b65, metalness: .42, roughness: .34 });
const templates = new Map();
const forward = new Vector3(0, 0, 1);
function part(parent, geometry, material, scale, position, rotation) {
  const mesh = new Mesh(geometry, material);
  mesh.scale.set(...scale); mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}
function tube(parent, material, diameter, depth, position) {
  return part(parent, cylinder, material, [diameter, depth, diameter], position, [Math.PI / 2, 0, 0]);
}
function equipmentTemplate(item) {
  const key = item.kind + ':' + item.id + ':' + (item.variant ?? '');
  if (templates.has(key)) return templates.get(key);
  const root = new Group();
  part(root, rounded, metal, [.98, .98, .075], [0, 0, .045]);
  for (const x of [-.39, .39]) for (const y of [-.39, .39]) {
    part(root, bolt, dark, [.065, .045, .065], [x, y, .1], [Math.PI / 2, 0, 0]);
  }
  const camera = ['hires', 'wide', 'telescope', 'multi', 'ir', 'uv', 'xray', 'thermal', 'lidar'].includes(item.id);
  if (camera) {
    part(root, rounded, paint, [.82, .72, .47], [0, -.025, .34]);
    part(root, box, gold, [.64, .04, .4], [0, .36, .34]);
    tube(root, dark, item.id === 'wide' ? .62 : .52, .35, [0, -.025, .68]);
    tube(root, metal, .59, .06, [0, -.025, .83]);
    tube(root, dark, .51, .11, [0, -.025, .89]);
    tube(root, glass, .405, .015, [0, -.025, .952]);
    part(root, ring, metal, [.46, .46, .46], [0, -.025, .958]);
    for (const x of [-.43, .43]) for (let i = 0; i < 5; i++) {
      part(root, box, metal, [.055, .055, .38], [x, -.24 + i * .11, .35]);
    }
    if (item.id === 'multi') {
      tube(root, dark, .23, .2, [.27, .23, .71]);
      tube(root, glass, .17, .015, [.27, .23, .82]);
    }
  } else if (item.id === 'panels') {
    part(root, rounded, dark, [.55, .75, .17], [0, 0, .18]);
    for (const side of [-1, 1]) {
      const hinge = new Group(); hinge.name = 'payload_solar_hinge';
      hinge.position.set(side * .23, 0, .29); hinge.userData.solarSide = side; root.add(hinge);
      part(hinge, rounded, metal, [.47, .86, .04], [side * .235, 0, 0]);
      part(hinge, box, cells, [.43, .80, .014], [side * .235, 0, .029]);
      for (let i = 0; i < 6; i++) part(hinge, box, metal, [.43, .012, .018], [side * .235, -.33 + i * .132, .04]);
      for (const x of [.12, .24, .36]) part(hinge, box, metal, [.006, .80, .018], [side * x, 0, .04]);
    }
  } else if (item.id === 'radio') {
    part(root, rounded, paint, [.72, .63, .36], [0, -.12, .29]);
    tube(root, dark, .14, .4, [0, .12, .6]);
    const dish = new CylinderGeometry(.44, .14, .18, 24, 1, true);
    part(root, dish, metal, [1, 1, 1], [0, .05, .69], [Math.PI / 2, 0, 0]);
    part(root, ring, metal, [.88, .88, .88], [0, .05, .785]);
    tube(root, gold, .07, .19, [0, .05, .88]);
    for (const x of [-.3, .3]) part(root, box, dark, [.02, .33, .025], [x * .5, .05, .84], [0, 0, x > 0 ? -.8 : .8]);
  } else if (['mag', 'plasma', 'atmosphere'].includes(item.id)) {
    part(root, rounded, paint, [.7, .57, .29], [0, -.13, .25]);
    tube(root, metal, .075, .5, [0, .16, .48]);
    part(root, rounded, dark, [.38, .31, .2], [0, .16, .81]);
    for (const x of [-.13, .13]) part(root, cylinder, gold, [.025, .26, .025], [x, .34, .81]);
  } else {
    part(root, rounded, paint, [.82, .75, .63], [0, -.025, .43]);
    part(root, rounded, item.id === 'battery' ? gold : metal, [.75, .66, .035], [0, -.025, .77]);
    for (let i = 0; i < 6; i++) part(root, box, dark, [.53, .026, .015], [0, -.23 + i * .08, .795]);
    for (const x of [-.2, 0, .2]) tube(root, dark, .09, .075, [x, -.4, .52]);
    if (['radar', 'radiation', 'soil', 'mass'].includes(item.id)) {
      tube(root, dark, .38, .16, [0, .08, .84]);
      tube(root, glass, .27, .015, [0, .08, .93]);
    }
  }
  root.scale.set(...item.dimensionsM);
  templates.set(key, root); return root;
}
export function payloadMass(spec, config) {
  const base = spec.massKg ?? spec.stats?.massKg;
  return config ? base + spacecraftTotals(config).massKg - 38 : base;
}
export function payloadVisibleBounds(model) {
  model.updateMatrixWorld(true);
  const bounds = new Box3();
  model.traverse(node => {
    if (!node.isMesh) return;
    for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return;
    bounds.union(new Box3().setFromObject(node));
  });
  return bounds;
}
export function payloadBodyBounds(model) {
  const bounds = new Box3();
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if (node.userData.partId && /^mayak_[ks]$/.test(node.userData.partId)) {
      for (const child of node.children) if (child.isMesh) bounds.union(new Box3().setFromObject(child));
    }
  });
  return bounds.isEmpty() ? new Box3(new Vector3(-.35, .2, -.28), new Vector3(.35, 1, .28)) : bounds;
}
export function payloadMounts(model) {
  const bounds = payloadBodyBounds(model);
  const center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
  const mounts = [];
  for (const face of ['front', 'rear', 'left', 'right', 'top']) {
    for (let row = 0; row < 2; row++) for (let column = 0; column < 4; column++) {
      const u = (column - 1.5) * .22, v = (row - .5) * .36;
      const position = center.clone(), normal = new Vector3();
      if (face === 'top') {
        position.add(new Vector3(u * size.x, size.y / 2 + .014, v * size.z)); normal.y = 1;
      } else if (face === 'front' || face === 'rear') {
        const side = face === 'front' ? 1 : -1;
        position.add(new Vector3(u * size.x, v * size.y, side * (size.z / 2 + .014))); normal.z = side;
      } else {
        const side = face === 'right' ? 1 : -1;
        position.add(new Vector3(side * (size.x / 2 + .014), v * size.y, u * size.z)); normal.x = side;
      }
      mounts.push({ id: face + '_' + (row * 4 + column + 1), face, position, normal,
        rotation: new Quaternion().setFromUnitVectors(forward, normal) });
    }
  }
  return mounts;
}
export function createPayloadEquipment(item) {
  const root = equipmentTemplate(item).clone(true);
  root.name = item.title; root.userData.equipmentKey = item.key; return root;
}
export function positionPayloadEquipment(root, mount, turn = 0) {
  root.position.copy(mount.position);
  root.quaternion.copy(mount.rotation).multiply(new Quaternion().setFromAxisAngle(forward, turn * Math.PI / 2));
  root.updateMatrixWorld(true);
}
export function setPayloadDeployment(model, progress) {
  model.traverse(node => { if (node.name === 'payload_solar_hinge') node.rotation.y = node.userData.solarSide * (1 - progress) * Math.PI * .44; });
}
export function decoratePayload(model, input) {
  if (!input) return;
  const config = readSpacecraft(input), mounts = payloadMounts(model);
  if (config.manualPlacement) model.traverse(node => {
    const id = node.userData.partId ?? '';
    if (/\.(left_wing_carrier|right_wing_carrier|relay_azimuth|front_equipment\.star_tracker)$/.test(id)) node.visible = false;
  });
  const group = new Group(); group.name = 'configured_payload_hardware';
  const entries = config.manualPlacement ? config.mounting : [
    ...config.instrumentIds.map((id, index) => ({ kind: 'instrument', id, slot: mounts[index % 8].id, turn: 0 })),
    ...['battery', 'radio', 'computer', 'attitude'].map((id, index) => ({ kind: 'system', id, slot: 'rear_' + (index + 1), turn: 0 })),
  ];
  for (const entry of entries) {
    const item = labItem(entry.kind, entry.id, config[entry.id]), mount = mounts.find(mount => mount.id === entry.slot);
    if (!item || !mount) continue;
    const hardware = createPayloadEquipment(item); positionPayloadEquipment(hardware, mount, entry.turn); group.add(hardware);
  }
  model.add(group); setPayloadDeployment(model, 0); model.userData.spacecraft = config;
}
