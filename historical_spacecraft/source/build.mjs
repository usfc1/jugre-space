import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Quaternion, Scene, Vector3 } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { seal } from './geometry.mjs';
import { registerArtemis } from './artemis.mjs';
import { registerFalcon } from './launchers.mjs';
import { registerMarsShared, registerRover } from './rovers.mjs';
import { registerDart, registerVoyager } from './probes.mjs';
import { registerStation } from './station.mjs';

globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const output = fileURLToPath(new URL('../', import.meta.url));
const exporter = new GLTFExporter();
const manifest = {
  version: 1,
  name: 'JUGRE Historical Spacecraft',
  format: 'glTF 2.0 binary',
  units: 'meter',
  up: '+Y',
  rocketNose: '+Y',
  roverForward: '+Z',
  mountOutward: '+Z',
  missions: {},
  assemblies: {},
  components: {},
  variants: {},
  parts: {},
};

const packs = [
  ['artemis_ii', 'Artemis II', registerArtemis],
  ['atlas_v_and_mars_edl', 'Atlas V 541 / Mars EDL', registerMarsShared],
  ['perseverance', 'Mars 2020 / Perseverance / Ingenuity', (out) => registerRover(out, 'perseverance'), ['atlas_v_and_mars_edl']],
  ['curiosity', 'Mars Science Laboratory / Curiosity', (out) => registerRover(out, 'curiosity'), ['atlas_v_and_mars_edl']],
  ['falcon_9', 'Falcon 9', registerFalcon],
  ['dart', 'DART / LICIACube', registerDart, ['falcon_9']],
  ['voyager_2', 'Voyager 2', registerVoyager],
  ['iss_resupply', 'ISS / Cargo Dragon 2', registerStation, ['falcon_9']],
];

function detached(original) {
  const result = original.clone(true);
  result.position.set(0, 0, 0);
  result.quaternion.identity();
  return result;
}

function inspect(root) {
  root.updateMatrixWorld(true);
  const allIds = new Set();
  const mounts = {};
  const hinges = {};
  const vector = new Vector3();
  const quaternion = new Quaternion();
  root.traverse((item) => {
    const { partId, role, axis, angleRadians } = item.userData;
    if (!partId) return;
    if (allIds.has(partId)) throw new Error(`Repeated partId ${partId} in ${root.name}`);
    allIds.add(partId);
    if (role === 'mount') {
      mounts[partId] = { translation: item.getWorldPosition(vector).toArray(), rotation: item.getWorldQuaternion(quaternion).toArray() };
    }
    if (role === 'hinge') hinges[partId] = { axis, angleRadians };
  });
  if (root.userData.dockingPair) {
    const [a, b] = root.userData.dockingPair.map((id) => root.getObjectByName(id));
    const gap = a.getWorldPosition(new Vector3()).distanceTo(b.getWorldPosition(new Vector3()));
    const axisA = vector.set(0, 0, 1).clone().applyQuaternion(a.getWorldQuaternion(quaternion));
    const axisB = vector.set(0, 0, 1).clone().applyQuaternion(b.getWorldQuaternion(quaternion));
    if (Math.abs(gap - root.userData.gapMeters) > 1e-7 || axisA.dot(axisB) > -0.9999999) {
      throw new Error(`Docking planes or axes fail to align in ${root.name}`);
    }
  }
  const bounds = new Box3().setFromObject(root, true);
  if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) {
    throw new Error(`Missing or invalid geometry in ${root.name}`);
  }
  return { bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, mounts, hinges };
}

async function exportModel(category, id, original, packId, metadata) {
  const root = detached(original);
  const scene = new Scene();
  scene.name = id;
  seal(root);
  const inspection = inspect(root);
  scene.add(root);
  const data = Buffer.from(await exporter.parseAsync(scene, { binary: true, trs: true }));
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) {
    throw new Error(`Invalid GLB header for ${id}`);
  }
  const file = `models/${category}/${id}.glb`;
  await writeFile(path.join(output, file), data);
  manifest[category][id] = { file, root: root.name, pack: packId, ...metadata, ...inspection };
  manifest.missions[packId][category].push(id);
}

for (const category of ['assemblies', 'components', 'variants', 'parts']) {
  await mkdir(path.join(output, 'models', category), { recursive: true });
}

for (const [id, name, register, shared = []] of packs) {
  const entries = { components: [], assemblies: [], variants: [] };
  const pack = { name, shared, assemblies: [], components: [], variants: [], parts: [] };
  manifest.missions[id] = pack;
  register({
    component: (root) => entries.components.push([root.name, root, {}]),
    assembly: (root, state, key = root.name) => entries.assemblies.push([key, root, { state }]),
    variant: (key, state, root) => entries.variants.push([key, root, { state }]),
  });
  for (const [category, list] of Object.entries(entries)) {
    for (const [key, root, extra] of list) {
      if (manifest[category][key]) throw new Error(`Duplicate export key ${key}`);
      await exportModel(category, key, root, id, extra);
      const parts = [];
      root.traverse((item) => {
        if (item !== root && item.userData.standalone && !manifest.parts[item.name]) parts.push(item);
      });
      for (const item of parts) {
        await exportModel('parts', item.name, item, id, {
          parent: item.parent.name, translation: item.position.toArray(), rotation: item.quaternion.toArray(),
        });
      }
    }
  }
  console.log(`${name} | ${pack.assemblies.length} assemblies, ${pack.components.length} components, ${pack.variants.length} variants, ${pack.parts.length} parts`);
}

await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const count = ['assemblies', 'components', 'variants', 'parts'].reduce((sum, category) => sum + Object.keys(manifest[category]).length, 0);
console.log(`Exported ${count} GLB files.`);
