import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Box3, Quaternion, Scene, Vector3 } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { seal } from './geometry.mjs';
import { imported } from './model-io.mjs';
import { existing, missions, names, propellants, stages } from './reference.mjs';
import { stageParts, crossAdapter, cargoDeck } from './stage-parts.mjs';
import { originalPayloads } from './payloads.mjs';

globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const root = fileURLToPath(new URL('../', import.meta.url));
const exporter = new GLTFExporter();
const categories = {
  engine: names('Двигатели', 'Engines'),
  tank: names('Баки и топливные секции', 'Tanks and tank sections'),
  control: names('Управление', 'Control'),
  payload: names('Полезная нагрузка', 'Payload'),
  surface: names('Кили, рули, крылья и раскрываемые элементы', 'Fins, control surfaces, wings, and deployables'),
  structure: names('Рамы и переходники', 'Frames and adapters'),
  separation: names('Отделители и створки', 'Separators and fairing shells'),
  destination: names('Орбитальные объекты', 'Orbital destinations'),
};
const manifest = {
  version: 1,
  name: 'JUGRE Constructor Kit',
  format: 'glTF 2.0 binary',
  units: 'meter',
  up: '+Y',
  rocketNose: '+Y',
  roverForward: '+Z',
  mountOutward: '+Z',
  constructorMountClocking: '+Y',
  categories,
  propellants,
  missions: Object.fromEntries(Object.entries(missions).map(([id, entry]) => [id, { ...entry, parts: [] }])),
  readyPayloads: [],
  parts: {},
};

function readBounds(object) {
  const bounds = new Box3().setFromObject(object, true);
  const { min, max } = bounds;
  const dimensions = bounds.getSize(new Vector3()).toArray();
  if (bounds.isEmpty() || dimensions.some((value) => !Number.isFinite(value))) {
    throw new Error(`Missing geometry for ${object.name}`);
  }
  return { bounds: { min: min.toArray(), max: max.toArray() }, dimensionsM: dimensions };
}

function inspect(object) {
  object.updateMatrixWorld(true);
  const ids = new Set();
  const mounts = {};
  const hinges = {};
  object.traverse((item) => {
    const { partId, role, profile, attachmentRole, nominalDiameterM, axis } = item.userData;
    if (!partId) return;
    if (ids.has(partId)) throw new Error(`Repeated node ${partId} in ${object.name}`);
    ids.add(partId);
    if (role === 'mount') {
      mounts[partId] = {
        profile, attachmentRole: attachmentRole ?? 'native', nominalDiameterM,
        translation: item.getWorldPosition(new Vector3()).toArray(),
        rotation: item.getWorldQuaternion(new Quaternion()).toArray(),
      };
    }
    if (axis) hinges[partId] = { axis, role };
  });
  return { ...readBounds(object), mounts, hinges };
}

function poseBounds(object, clips, name) {
  if (!name) return undefined;
  const mixer = new AnimationMixer(object);
  const clip = clips.find((clip) => clip.name === name);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  const packed = readBounds(object);
  mixer.stopAllAction();
  object.updateMatrixWorld(true);
  return packed;
}

async function writeAsset(entry) {
  const { id, root: object, clips = [], ref, ...details } = entry;
  if (manifest.parts[id] || !categories[details.category] || object.name !== id) throw new Error(`Unexpected asset ${id}`);
  const origin = details.origin ?? 'heritage';
  Object.assign(object.userData, { catalogId: id, category: details.category, origin, representation: details.representation });
  seal(object);
  const geometry = inspect(object);
  const packed = poseBounds(object, clips, details.transportClip);
  const scene = new Scene();
  scene.name = id;
  scene.add(object);
  const data = Buffer.from(await exporter.parseAsync(scene, { binary: true, trs: true, animations: clips }));
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(8) !== data.length) throw new Error(`Invalid GLB ${id}`);
  const file = `models/${origin}/${details.category}/${id}.glb`;
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), data);
  manifest.parts[id] = { id, ...details, origin, file, root: id, source: ref, ...geometry, transportBounds: packed,
    clips: clips.map((clip) => clip.name) };
  if (details.ready && details.category === 'payload') manifest.readyPayloads.push(id);
  for (const mission of details.program) manifest.missions[mission].parts.push(id);
}

for (const entry of await stageParts()) await writeAsset(entry);
for (const entry of existing) await writeAsset(await imported(entry));
const sizes = [...new Set([...stages.map((stage) => stage.diameter), 3.9116, 4.0, 5.02])].sort((a, b) => a - b);
for (const diameter of sizes) await writeAsset(crossAdapter(diameter));
await writeAsset(cargoDeck());
for (const entry of originalPayloads()) await writeAsset(entry);

for (const { variantOf, id } of Object.values(manifest.parts)) {
  if (variantOf && !manifest.parts[variantOf]) throw new Error(`Missing parent for ${id}`);
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const [category, label] of Object.entries(categories)) {
  const count = Object.values(manifest.parts).filter((part) => part.category === category).length;
  console.log(`${label.en}: ${count}`);
}
console.log(`Exported ${Object.keys(manifest.parts).length} GLBs with ${manifest.readyPayloads.length} ready payload entries.`);
