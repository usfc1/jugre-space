import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import validator from 'gltf-validator';
import { Box3, Scene } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { astronautClips, clips, visorOpenAngle } from './animation.mjs';
import { createAccessory, createAstronaut, suits } from './crew.mjs';

globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const output = new URL('../', import.meta.url);
const gltf = new GLTFExporter();
const round = values => values.map(value => Number(value.toFixed(4)));
const manifest = {
  name: 'JUGRE / EVA Crew',
  version: 1,
  units: 'meter',
  up: '+Y',
  forward: '+Z',
  rig: 'jugre_eva_v1',
  mounts: {
    helmet: { node: 'helmet', parent: 'head', interface: 'neck_eva_v1' },
    visor: { node: 'visor', parent: 'helmet', openAngleRad: visorOpenAngle },
    head: { node: 'head', parent: 'torso', interface: 'neck_eva_v1' },
    backpack: { node: 'backpack', parent: 'torso', interface: 'back_eva_v1' },
    hand: { nodes: ['grip_L', 'grip_R'], interface: 'grip_eva_v1', pinRadiusM: 0.033, pinAxis: '+Z' },
    seat: { node: 'seat_mount' },
    tether: { node: 'tether_mount' },
  },
  clips,
  suits: {},
};
const assets = {};

async function exportModel(root, file, animations = []) {
  const scene = new Scene();
  scene.name = 'JUGRE EVA';
  scene.add(root);
  const bounds = new Box3().setFromObject(root, true);
  const data = new Uint8Array(await gltf.parseAsync(scene, { binary: true, trs: true, animations }));
  const report = await validator.validateBytes(data, { uri: file, maxIssues: 50 });
  if (report.issues.numErrors || report.issues.numWarnings) {
    const issues = report.issues.messages.filter(issue => issue.severity <= 1);
    throw new Error(`${file} failed glTF validation: ${JSON.stringify(issues, null, 2)}`);
  }
  await writeFile(new URL(file, output), data);
  assets[file] = Buffer.from(data).toString('base64');
  return {
    file, triangles: report.info.totalTriangleCount, drawCalls: report.info.drawCallCount,
    bounds: { min: round(bounds.min.toArray()), max: round(bounds.max.toArray()) },
  };
}

await mkdir(new URL('models/accessories/', output), { recursive: true });
for (const [id, suit] of Object.entries(suits)) {
  const { root, physics } = createAstronaut(id);
  const info = await exportModel(root, `models/${id}.glb`, astronautClips());
  const accessory = await exportModel(createAccessory(id), `models/accessories/${suit.accessory}.glb`);
  const { title, code, role, era, note, expression, toolName, accent } = suit;
  manifest.suits[id] = { title, code, role, era, note, expression, accent, toolName, ...info, accessory, physics };
  console.log(`${info.file}: ${info.triangles} triangles, ${info.drawCalls} draws`);
}
await writeFile(new URL('manifest.json', output), `${JSON.stringify(manifest, null, 2)}\n`);
if (!process.argv.includes('--models-only')) {
  const html = await readFile(new URL('viewer.html', import.meta.url), 'utf8');
  const script = await build({
    stdin: {
      contents: `import { launch } from './viewer.mjs'; launch(${JSON.stringify(manifest)}, ${JSON.stringify(assets)});`,
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    },
    bundle: true,
    minify: true,
    write: false,
    legalComments: 'inline',
  });
  await writeFile(new URL('index.html', output), html.replace('<!-- VIEWER_SCRIPT -->', () =>
    `<script>${script.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`));
}
