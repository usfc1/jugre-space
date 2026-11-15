import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Box3, Scene } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { lathe, m, node, seal } from '../../original_parts/source/geometry.mjs';
import { buildHangar } from './hangar.mjs';
import { buildScientist, scientistStyles } from './scientist.mjs';
import { deckY, equipmentStand } from './vab-layout.mjs';
import { buildBay, buildCrew, cargoIds, packedCargo } from './cargo.mjs';
import { collectReadyRockets } from './ready-rockets-build.mjs';
import { buildLaunchComplex } from './launch-complex.mjs';
import { embedKennedyTextures } from './kennedy-textures-build.mjs';
import { kennedySites, kennedyTiles } from './kennedy-layout.mjs';
import { collectFlightAssets } from './flight-assets-build.mjs';
import { radioLines } from './mission-radio.mjs';
import { buildTimelinePreview } from './build-timeline-preview.mjs';
import { earthImageryRegions, earthImageryService } from './earth-imagery-config.mjs';
import { interstages } from './rocket-interstages.mjs';

globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const routes = [
  { start: 0.03, runOffset: null, points: [[-8, 11.3], [0, 11.3], [8, 11.3], [8, 16.7], [-8, 16.7]] },
  { start: 0.2, runOffset: null, points: [[-7, -10], [0, -10], [6.6, -10], [6.4, -14.6], [-6.8, -14.5]] },
  { start: 0.042, runOffset: 3, points: [[-17, 7], [-18, -2], [-17.4, -9.5], [-22, -8], [-22, 7.4], [-19, 10]] },
  { start: 0.62, runOffset: 12, points: [[22, 14.5], [28, 14.5], [28, 6], [25.5, 5], [25.5, 13]] },
];
const exporter = new GLTFExporter();
const manifest = {
  version: 1,
  name: 'JUGRE Vehicle Assembly Building',
  units: 'meter',
  up: '+Y',
  visitorForward: '+Z',
  hangar: { file: 'models/assembly_hangar.glb', rocketDeck: [0, deckY, 0], equipmentStand },
  wordmark: { default: 'JUGRE' },
  locomotionMps: { walk: 1.3, run: 2.9 },
  scientists: [],
};

async function exportGLB(root, file, clips = [], transform = null) {
  const scene = new Scene();
  scene.name = root.name;
  scene.add(root);
  const exported = Buffer.from(await exporter.parseAsync(scene, { binary: true, trs: true, animations: clips }));
  const data = transform ? await transform(exported) : exported;
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
  const { code, name, group, mounts, stats, dimensionsM, massKg } = spec;
  const model = await readFile(new URL(spec.file, partsFolder));
  return [id, { code, name: name.en, group, mounts, stats, dimensionsM, massKg, glb: model.toString('base64') }];
})));
const command = catalog.pb_1_strizh;
Object.assign(command, { name: 'Swift', group: 'command', detail: 'Ø 1.25 m' });
await mkdir(new URL('../models/staging/', import.meta.url), { recursive: true });
manifest.stagingParts = {};
for (const [id, spec] of Object.entries(interstages)) {
  const root = node(id);
  const { mountDiameterM, heightM } = spec.stats;
  const outer = mountDiameterM / 2 + .03;
  const inner = mountDiameterM / 2 - .002;
  lathe(root, m.white, [[outer, 0], [outer, heightM], [inner, heightM]]);
  lathe(root, m.dark, [[inner, heightM], [inner, 0], [outer, 0]]);
  for (const y of [.025, heightM - .065]) lathe(root, m.orange, [[outer + .003, y], [outer + .003, y + .04]]);
  const file = `models/staging/${id}.glb`;
  catalog[id] = { ...spec, glb: await exportGLB(seal(root), file) };
  manifest.stagingParts[id] = { ...spec, file };
}
await mkdir(new URL('../models/payload/', import.meta.url), { recursive: true });
manifest.payloadParts = {};
for (const asset of [buildBay(), await buildCrew(catalog.pk_2_kontur)]) {
  const file = `models/payload/${asset.root.name}.glb`;
  const glb = await exportGLB(asset.root, file, asset.clips);
  catalog[asset.root.name] = { ...asset.spec, glb };
  const { glb: embedded, ...spec } = asset.spec;
  manifest.payloadParts[asset.root.name] = { file, ...spec };
}
const kit = new URL('../../constructor_kit/', import.meta.url);
const kitParts = JSON.parse(await readFile(new URL('manifest.json', kit), 'utf8')).parts;
const cargoNames = [
  ['MK', 'Mayak-K'], ['MS', 'Mayak-S'],
  ['B-4', 'Barkhan-4'], ['B-6', 'Barkhan-6'],
];
for (const [index, id] of cargoIds.entries()) {
  const part = kitParts[id];
  const spec = packedCargo(id, part, ...cargoNames[index]);
  const bytes = await readFile(new URL(part.file, kit));
  const file = `models/payload/${id}.glb`;
  await writeFile(new URL(`../${file}`, import.meta.url), bytes);
  catalog[id] = { ...spec, glb: bytes.toString('base64') };
  manifest.payloadParts[id] = { file, ...spec };
}
const root = buildHangar();
const bounds = new Box3().setFromObject(root, true);
manifest.hangar.bounds = { min: bounds.min.toArray(), max: bounds.max.toArray() };
const hangar = await exportGLB(root, manifest.hangar.file);
const launchRoot = buildLaunchComplex();
manifest.launchComplex = {
  file: 'models/jugre_launch_complex.glb', units: 'meter', rocketMount: 'jugre_launch_complex.rocket_mount',
  rocketTranslation: [0, 9.08, 0], towerHeightM: 134.1,
  name: 'Kennedy Space Center', anchor: 'LC-39A', shoreline: 'east',
  landmarks: kennedySites, aerialTiles: kennedyTiles,
};
const launchComplex = await exportGLB(launchRoot, manifest.launchComplex.file, [], embedKennedyTextures);
const scientists = [];
for (const [index, style] of scientistStyles.entries()) {
  const { root: character, clips } = buildScientist(style);
  const file = `models/scientist_${style.id}.glb`;
  scientists.push(await exportGLB(seal(character), file, clips));
  manifest.scientists.push({ file, clips: clips.map((clip) => clip.name), route: routes[index] });
}
const readyRockets = await collectReadyRockets();
manifest.readyRockets = readyRockets.map(({ spec }) => spec);
const flight = await collectFlightAssets();
const recordings = await Promise.all(Object.entries(radioLines).map(async ([id, line]) => {
  const file = `assets/audio/radio/${id}.mp3`;
  const audio = await readFile(new URL(`../${file}`, import.meta.url)).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    console.warn(`Missing radio recording (subtitle only): ${file}`);
    return null;
  });
  return { id, file, ...line, audio };
}));
manifest.flight = { launchLocation: { name: 'Kennedy Space Center · LC-39A', latitude: 28.6084, longitude: -80.6042 },
  mode: 'educational', missions: flight.missions, astronauts: flight.astronauts,
  earthImagery: {projection:'EPSG:4326',service:earthImageryService,regions:earthImageryRegions},
  models: flight.models.map(({ id, file }) => ({ id, file })) };
manifest.audio = {
  voices: 'en', subtitles: 'en',
  recordings: recordings.map(({ audio, ...clip }) => ({ ...clip, available: Boolean(audio?.length) })),
};
await writeFile(new URL('../manifest.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
const [template, bundle, license, physxWasm, physxNotices, standardStyles, consoleStyles, menuStyles, menuMarkup, menuArt] = await Promise.all([
  readFile(new URL('./viewer.html', import.meta.url), 'utf8'),
  build({
    entryPoints: [fileURLToPath(new URL('./viewer.mjs', import.meta.url))],
    bundle: true, write: false, minify: true, format: 'iife', target: 'es2022',
  }),
  readFile(new URL('../LICENSE', import.meta.resolve('three')), 'utf8'),
  readFile(new URL('./physx-js-webidl.wasm', import.meta.resolve('physx-js-webidl'))),
  readFile(new URL('./physx-NOTICE.txt', import.meta.url), 'utf8'),
  readFile(new URL('./standard-mission.css', import.meta.url), 'utf8'),
  readFile(new URL('./console.css', import.meta.url), 'utf8'),
  readFile(new URL('./main-menu.css', import.meta.url), 'utf8'),
  readFile(new URL('./main-menu.html', import.meta.url), 'utf8'),
  readFile(new URL('../assets/menu/orbital-station.png', import.meta.url)),
]);
const html = template
  .replace('/* STANDARD_DESIGN_STYLES */', () => standardStyles)
  .replace('/* CONSOLE_STYLES */', () => consoleStyles)
  .replace('/* MAIN_MENU_STYLES */', () => menuStyles.replace('__MENU_ART__', `data:image/png;base64,${menuArt.toString('base64')}`))
  .replace('<!-- MAIN_MENU -->', () => menuMarkup)
  .replace('<!-- PHYSX_DATA -->', () => `<script type="application/octet-stream" id="physx-wasm">${physxWasm.toString('base64')}</script><!-- ${physxNotices.replaceAll('--', '—')} -->`)
  .replace('/* ASSET_DATA */', () => `window.hangarData = ${JSON.stringify({ hangar, launchComplex, scientists, manifest, catalog })};`)
  .replace('<!-- READY_ROCKET_DATA -->', () => readyRockets.map(({ spec, glb }) =>
    `<script type="application/octet-stream" id="rocket-data-${spec.id}">${glb}</script>`).join('\n'))
  .replace('<!-- FLIGHT_DATA -->', () => `<script>window.flightTextures=${JSON.stringify(flight.textures)};</script>\n`
    + flight.models.map(({ id, glb }) => `<script type="application/octet-stream" id="flight-data-${id}">${glb}</script>`).join('\n'))
  .replace('<!-- RADIO_DATA -->', () => recordings.filter(({ audio }) => audio?.length).map(({ id, audio }) =>
    `<script type="application/octet-stream" id="audio-data-${id}">${audio.toString('base64')}</script>`).join('\n'))
  .replace('/* VIEWER_SCRIPT */', () => bundle.outputFiles[0].text.replaceAll('</script', '<\\/script'))
  .replace('<!-- THREE_LICENSE -->', () => `<!-- Three.js\n${license.trim()}\n-->`);
const stagedViewer = new URL(`../.index-${process.pid}.tmp`, import.meta.url);
try {
  await writeFile(stagedViewer, html);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(stagedViewer, new URL('../index.html', import.meta.url));
      break;
    } catch (error) {
      if (attempt === 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await wait(200 * 2 ** attempt);
    }
  }
} finally {
  await rm(stagedViewer, { force: true });
}
console.log(`Exported the assembly hangar, ${scientists.length} animated scientists, ${readyRockets.length} ready rockets and the offline viewer.`);
await buildTimelinePreview();
