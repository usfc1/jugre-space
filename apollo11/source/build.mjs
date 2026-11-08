import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { group, mount, seal, yaw } from './geometry.mjs';
import {
  adapter, firstInterstage, firstStage, instrumentUnit, lmClocking, lmInSla,
  secondInterstage, secondStage, stack, thirdStage,
} from './saturn.mjs';
import {
  cmDockY, columbia, commandModule, deployedParachutes, launchEscape, serviceModule, smLength,
} from './columbia.mjs';
import { ascentDatum, ascentStage, descentStage, eagle, lmDockY } from './eagle.mjs';

// GLTFExporter uses FileReader for the assembled binary Blob.
globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};

const output = fileURLToPath(new URL('../', import.meta.url));
const manifest = {
  version: 1,
  mission: 'Apollo 11',
  format: 'glTF 2.0 binary',
  units: 'meter',
  up: '+Y',
  mountOutward: '+Z',
  assemblies: {},
  components: {},
  variants: {},
  parts: {},
};
const exporter = new GLTFExporter();

async function exportModel(node, id, category, meta = {}) {
  const file = `models/${category}/${id}.glb`;
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  const scene = new THREE.Scene();
  scene.name = id;
  node.traverse((child) => {
    if (child.userData.standalone && !child.children.some((item) => item.userData.role === 'mount')) {
      mount(child, 'mount_parent', [0, 0, 0]);
    }
  });
  scene.add(seal(node));
  const glb = await exporter.parseAsync(scene, { binary: true, trs: true });
  await writeFile(destination, Buffer.from(glb));
  scene.remove(node);
  manifest[category][id] = { file, root: node.name, ...meta };
}

function atY(parent, node, y) {
  node.position.y = y;
  parent.add(node);
  return node;
}

function stowedEagle(parent, baseY) {
  const node = atY(parent, eagle({ stowed: true }), baseY + lmInSla);
  node.quaternion.copy(yaw(lmClocking));
}

function launchStack() {
  const node = group('saturn_v_sa506', undefined, undefined, { configuration: 'launch' });
  atY(node, firstStage(), stack.s_ic);
  atY(node, firstInterstage(), stack.interstage_1_2);
  atY(node, secondStage(), stack.s_ii);
  atY(node, secondInterstage(), stack.interstage_2_3);
  atY(node, thirdStage(), stack.s_ivb);
  atY(node, instrumentUnit(), stack.instrument_unit);
  atY(node, adapter(), stack.sla);
  stowedEagle(node, stack.sla);
  atY(node, columbia('launch'), stack.apollo_sm);
  atY(node, launchEscape(), stack.launch_escape);
  return node;
}

function exposedEagle() {
  const node = group('apollo11_sla_open', undefined, undefined, { configuration: 'before_extraction' });
  const base = stack.s_ivb;
  atY(node, thirdStage(), 0);
  atY(node, instrumentUnit(), stack.instrument_unit - base);
  atY(node, adapter(true), stack.sla - base);
  stowedEagle(node, stack.sla - base);
  return node;
}

function extractedEagle() {
  const node = group('apollo11_csm_lm_docked', undefined, undefined, { configuration: 'after_extraction' });
  node.add(columbia('docked'));
  const lm = atY(node, eagle({ stowed: true, docked: true }), smLength + cmDockY + ascentDatum + lmDockY);
  lm.rotation.x = Math.PI;
  return node;
}

function detached(node) {
  const copy = node.clone(true);
  copy.position.set(0, 0, 0);
  copy.quaternion.identity();
  return copy;
}

for (const [factory, id, state] of [
  [launchStack, 'saturn_v_sa506', 'launch'],
  [columbia, 'columbia_csm', 'orbit'],
  [eagle, 'eagle_lm', 'landing'],
  [exposedEagle, 'apollo11_sla_open', 'before_extraction'],
  [extractedEagle, 'apollo11_csm_lm_docked', 'after_extraction'],
]) {
  await exportModel(factory(), id, 'assemblies', { state });
}

const components = [
  firstStage(), firstInterstage(), secondStage(), secondInterstage(), thirdStage(), instrumentUnit(),
  adapter(), launchEscape(), commandModule(), serviceModule(), descentStage(), ascentStage(),
];
for (const node of components) await exportModel(node, node.name, 'components');
const antennas = components.at(-1).getObjectByName('eagle_antennas');
await exportModel(detached(antennas), 'eagle_antennas', 'components');

for (const [node, id, state] of [
  [firstStage(true), 's_ic_cutaway', 'cutaway'],
  [secondStage(true), 's_ii_cutaway', 'cutaway'],
  [thirdStage(true), 's_ivb_cutaway', 'cutaway'],
  [serviceModule({ cutaway: true }), 'apollo_sm_cutaway', 'cutaway'],
  [serviceModule({ stowed: true }), 'apollo_sm_stowed', 'stowed'],
  [eagle({ stowed: true }), 'eagle_lm_stowed', 'stowed'],
  [commandModule('recovery'), 'apollo_cm_recovery', 'recovery'],
  [deployedParachutes(), 'apollo_cm.parachutes_deployed', 'deployed'],
]) {
  await exportModel(node, id, 'variants', { state });
}

for (const component of components) {
  const parts = [];
  component.traverse((node) => {
    if (node.userData.standalone) parts.push(node);
  });
  for (const node of parts) {
    const copy = detached(node);
    await exportModel(copy, node.name, 'parts', {
      parent: node.parent.name,
      translation: node.position.toArray(),
      rotation: node.quaternion.toArray(),
    });
  }
}

await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const count = Object.values(manifest).filter((entry) => typeof entry === 'object')
  .reduce((sum, entry) => sum + Object.keys(entry).length, 0);
console.log(`Exported ${count} GLB files.`);
