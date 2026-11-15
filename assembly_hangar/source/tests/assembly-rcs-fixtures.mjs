import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPhysX } from '../physx-runtime.mjs';
import { AssemblyRcs } from '../assembly-rcs.mjs';
import { findPart } from '../flight-layout.mjs';
export async function runAssemblyFixtures() {
  const bytes = Uint8Array.from(atob(document.querySelector('#apollo-fixture').textContent), c => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, ''), model = gltf.scene;
  const events = [], runtime = await loadPhysX();
  const create = saved => new AssemblyRcs(runtime, findPart(model, 'columbia_csm'), findPart(model, 'eagle_lm'), (t, d) => events.push({ t, d }), saved);
  let e = create();
  for (let i = 0; i < 1200; i++) e.advance(1 / 60, {}, { rcs: true, sas: true }, true);
  const saved = e.serialize(); e.dispose(); e = create(saved);
  for (let i = 0; i < 36000 && !e.complete; i++) e.advance(1 / 60, {}, { rcs: true, sas: true }, true);
  const result = { complete: e.complete, captured: Boolean(e.joint), fuelKg: e.rcs.fuelKg,
    distance: e.metrics.distanceM, angle: e.metrics.angleRad, events };
  e.dispose(); if (!result.complete) throw new Error('CSM extraction did not complete: ' + JSON.stringify(result)); return result;
}
