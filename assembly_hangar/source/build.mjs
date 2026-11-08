import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Box3, Scene } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { seal } from '../../original_parts/source/geometry.mjs';
import { buildHangar } from './hangar.mjs';
import { buildScientist, scientistStyles } from './scientist.mjs';
import { prepareParts } from './assembly.mjs';

globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const routes = [
  { start: 0.03, runOffset: null, points: [[-7, 3], [0, 2.8], [6.8, 3.1], [7, 8.7], [-6.9, 8.7]] },
  { start: 0.2, runOffset: null, points: [[-7, -11.2], [0, -11.1], [6.6, -10.9], [6.4, -14.6], [-6.8, -14.5]] },
  { start: 0.042, runOffset: 3, points: [[-9.45, 5.8], [-9.55, -2], [-10.55, -9.5], [-12.25, -8], [-12.12, 7.4], [-11.5, 9.8]] },
  { start: 0.62, runOffset: 12, points: [[9.25, -7.6], [9.25, 0], [9.3, 7.5], [11.85, 9], [12, -7.6], [10.9, -10.2]] },
];
const exporter = new GLTFExporter();
const manifest = {
  version: 1,
  name: 'JUGRE Assembly Hangar',
  units: 'meter',
  up: '+Y',
  visitorForward: '+Z',
  hangar: { file: 'models/assembly_hangar.glb', exampleAssembly: 'assembly_hangar.example_rocket' },
  wordmark: { node: 'assembly_hangar.brand_frame.hangar_brand', default: 'JUGRE' },
  locomotionMps: { walk: 1.3, run: 2.9 },
  scientists: [],
};

async function exportGLB(root, file, clips = []) {
  const scene = new Scene();
  scene.name = root.name;
  scene.add(root);
  const data = Buffer.from(await exporter.parseAsync(scene, { binary: true, trs: true, animations: clips }));
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(8) !== data.length) {
    throw new Error(`Invalid GLB header for ${file}`);
  }
  await writeFile(new URL(`../${file}`, import.meta.url), data);
  return data.toString('base64');
}

await mkdir(new URL('../models/', import.meta.url), { recursive: true });
const partsFolder = new URL('../../original_parts/', import.meta.url);
const { parts } = JSON.parse(await readFile(new URL('manifest.json', partsFolder), 'utf8'));
const catalog = Object.fromEntries(await Promise.all(Object.entries(parts).map(async ([id, spec]) => {
  const { code, name, group, mounts, stats, dimensionsM } = spec;
  const model = await readFile(new URL(spec.file, partsFolder));
  return [id, { code, name: name.ru, group, mounts, stats, dimensionsM, glb: model.toString('base64') }];
})));
const { root, addDemo } = await buildHangar();
seal(root);
await addDemo(prepareParts(parts));
const bounds = new Box3().setFromObject(root, true);
manifest.hangar.bounds = { min: bounds.min.toArray(), max: bounds.max.toArray() };
const hangar = await exportGLB(root, manifest.hangar.file);
const scientists = [];
for (const [index, style] of scientistStyles.entries()) {
  const { root: character, clips } = buildScientist(style);
  const file = `models/scientist_${style.id}.glb`;
  scientists.push(await exportGLB(seal(character), file, clips));
  manifest.scientists.push({ file, clips: clips.map((clip) => clip.name), route: routes[index] });
}
await writeFile(new URL('../manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
const [template, bundle, license] = await Promise.all([
  readFile(new URL('./viewer.html', import.meta.url), 'utf8'),
  build({
    entryPoints: [fileURLToPath(new URL('./viewer.mjs', import.meta.url))],
    bundle: true, write: false, minify: true, format: 'iife', target: 'es2022',
  }),
  readFile(new URL('../LICENSE', import.meta.resolve('three')), 'utf8'),
]);
const html = template
  .replace('/* ASSET_DATA */', () => `window.hangarData = ${JSON.stringify({ hangar, scientists, manifest, catalog })};`)
  .replace('/* VIEWER_SCRIPT */', () => bundle.outputFiles[0].text.replaceAll('</script', '<\\/script'))
  .replace('<!-- THREE_LICENSE -->', () => `<!-- Three.js\n${license.trim()}\n-->`);
await writeFile(new URL('../index.html', import.meta.url), html);
console.log(`Exported the assembly hangar, ${scientists.length} animated scientists and the offline viewer.`);
