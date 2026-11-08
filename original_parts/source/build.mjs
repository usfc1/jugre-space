import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Scene, Quaternion, Vector3 } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { groups, parts, propellants } from './catalog.mjs';
import { seal } from './geometry.mjs';
import { buildPart } from './models.mjs';
import { specifications } from './specifications.mjs';

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
  name: 'JUGRE Original Parts',
  format: 'glTF 2.0 binary',
  units: 'meter',
  up: '+Y',
  rocketNose: '+Y',
  mountOutward: '+Z',
  mountClocking: '+Y',
  statsKind: 'gameplay',
  catalogTypes: new Set(parts.map((part) => part.catalogId)).size,
  groups,
  propellants,
  parts: {},
};

function inspect(root, spec) {
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root, true);
  if (bounds.isEmpty()) throw new Error(`No geometry in ${spec.id}`);
  const dimensions = bounds.getSize(new Vector3());
  if (spec.stats.heightM && Math.abs(dimensions.y - spec.stats.heightM) > 0.003) {
    throw new Error(`${spec.id} measures ${dimensions.y} m in Y, expected ${spec.stats.heightM} m`);
  }
  const mounts = {};
  const hinges = {};
  const seen = new Set();
  root.traverse((item) => {
    const { partId, role, axis, profile, attachmentRole, nominalDiameterM, acceptsParts, maxDeflectionDeg } = item.userData;
    if (!partId) return;
    if (seen.has(partId)) throw new Error(`Duplicate node ${partId}`);
    seen.add(partId);
    if (role === 'mount') {
      if (!profile) throw new Error(`Missing attachment profile for ${partId}`);
      mounts[partId] = {
        profile, attachmentRole, nominalDiameterM, acceptsParts,
        translation: item.getWorldPosition(new Vector3()).toArray(),
        rotation: item.getWorldQuaternion(new Quaternion()).toArray(),
      };
    }
    if (role === 'hinge') hinges[partId] = { axis, maxDeflectionDeg };
  });
  if (Object.keys(mounts).length === 0) throw new Error(`No mounts in ${spec.id}`);
  return {
    dimensionsM: dimensions.toArray(),
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    mounts,
    hinges,
  };
}

await mkdir(path.join(output, 'models'), { recursive: true });
for (const spec of parts) {
  const { root, clips } = buildPart(spec);
  if (root.name !== spec.id || manifest.parts[spec.id]) throw new Error(`Unexpected or repeated part ${spec.id}`);
  Object.assign(root.userData, { catalogId: spec.catalogId, code: spec.code });
  seal(root);
  const geometry = inspect(root, spec);
  const scene = new Scene();
  scene.name = spec.id;
  scene.add(root);
  const data = Buffer.from(await exporter.parseAsync(scene, { binary: true, trs: true, animations: clips }));
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) {
    throw new Error(`Invalid GLB header for ${spec.id}`);
  }
  const file = `models/${spec.id}.glb`;
  await writeFile(path.join(output, file), data);
  manifest.parts[spec.id] = { ...spec, file, root: root.name, ...geometry, clips: clips.map((clip) => clip.name) };
}

await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const locale of ['ru', 'en']) {
  await writeFile(path.join(output, `specs.${locale}.md`), specifications(manifest.parts, locale));
}
console.log(`Exported ${Object.keys(manifest.parts).length} GLBs across ${manifest.catalogTypes} part types.`);
