import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Box3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const missions = [
  ['apollo_11', 'Apollo 11', 'Saturn V', 'Columbia and Eagle', 'apollo11', 'saturn_v_sa506'],
  ['artemis_ii', 'Artemis II', 'SLS Block 1', 'Orion Integrity', 'historical_spacecraft', 'artemis_ii_launch'],
  ['mars_2020', 'Mars 2020', 'Atlas V 541', 'Perseverance and Ingenuity', 'historical_spacecraft', 'perseverance_atlas_v_541'],
  ['mars_science_laboratory', 'Mars Science Laboratory', 'Atlas V 541', 'Curiosity', 'historical_spacecraft', 'curiosity_atlas_v_541'],
  ['dart', 'DART', 'Falcon 9', 'DART and LICIACube', 'historical_spacecraft', 'dart_falcon9_launch'],
  ['voyager_2', 'Voyager 2', 'Titan IIIE–Centaur', 'Voyager 2 probe', 'historical_spacecraft', 'voyager_2_launch'],
  ['iss_resupply', 'ISS Resupply', 'Falcon 9', 'Cargo Dragon 2', 'historical_spacecraft', 'cargo_dragon_falcon9_launch'],
];

export async function collectReadyRockets() {
  const packs = new Map(await Promise.all(['apollo11', 'historical_spacecraft'].map(async (id) => {
    const directory = new URL(`../../${id}/`, import.meta.url);
    const { assemblies } = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
    return [id, { directory, assemblies }];
  })));
  await mkdir(new URL('../models/rockets/', import.meta.url), { recursive: true });
  const loader = new GLTFLoader();
  return Promise.all(missions.map(async ([id, name, launcher, payload, pack, assembly]) => {
    const { directory, assemblies } = packs.get(pack);
    const entry = assemblies[assembly];
    if (!entry) throw new Error(`Missing launch assembly ${pack}/${assembly}`);
    const bytes = await readFile(new URL(entry.file, directory));
    const { scene } = await loader.parseAsync(Uint8Array.from(bytes).buffer, '');
    const root = scene.getObjectByProperty('name', entry.root)
      ?? scene.children.find((item) => item.userData.partId === entry.root);
    const box = new Box3().setFromObject(scene, true);
    if (!root || box.isEmpty()) throw new Error(`Empty or incomplete launch assembly ${assembly}`);
    const file = `models/rockets/${assembly}.glb`;
    await writeFile(new URL(`../${file}`, import.meta.url), bytes);
    return {
      spec: { id, name, launcher, payload, file, root: entry.root, source: { pack, assembly },
        bounds: { min: box.min.toArray(), max: box.max.toArray() } },
      glb: bytes.toString('base64'),
    };
  }));
}
