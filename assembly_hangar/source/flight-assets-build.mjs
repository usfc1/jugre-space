import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { missions } from './flight-missions.mjs';
import { earthImageryRegions } from './earth-imagery-config.mjs';

const models = [
  ['apollo_docked', 'apollo11', 'apollo11_csm_lm_docked'],
  ['columbia', 'apollo11', 'columbia_csm'], ['eagle', 'apollo11', 'eagle_lm'],
  ['icps', 'historical_spacecraft', 'icps', 'components'],
  ['orion', 'historical_spacecraft', 'orion_integrity'],
  ['mars2020_ship', 'historical_spacecraft', 'perseverance_spacecraft'],
  ['msl_ship', 'historical_spacecraft', 'curiosity_spacecraft'],
  ['mars_parachute', 'historical_spacecraft', 'mars_parachute', 'components'],
  ['perseverance', 'historical_spacecraft', 'perseverance_with_ingenuity'],
  ['curiosity', 'historical_spacecraft', 'curiosity'],
  ['ingenuity', 'historical_spacecraft', 'ingenuity'],
  ['dart', 'historical_spacecraft', 'dart'], ['liciacube', 'historical_spacecraft', 'liciacube'],
  ['voyager', 'historical_spacecraft', 'voyager_2'],
  ['dragon', 'historical_spacecraft', 'cargo_dragon_2'],
  ['iss', 'historical_spacecraft', 'iss'], ['didymos', 'historical_spacecraft', 'didymos_binary'],
  ['science_satellite', 'constructor_kit', 'mayak_k', 'jugre/payload'],
  ['barkhan_4', 'constructor_kit', 'barkhan_4', 'jugre/payload'],
  ['barkhan_6', 'constructor_kit', 'barkhan_6', 'jugre/payload'],
];

export async function collectFlightAssets() {
  const flightModels = [];
  await mkdir(new URL('../models/flight/', import.meta.url), { recursive: true });
  for (const [id, pack, assembly, folder = 'assemblies'] of models) {
    const source = new URL(`../../${pack}/models/${folder}/${assembly}.glb`, import.meta.url);
    const bytes = await readFile(source);
    const file = `models/flight/${id}.glb`;
    await writeFile(new URL(`../${file}`, import.meta.url), bytes);
    flightModels.push({ id, file, glb: bytes.toString('base64') });
  }
  const crewPack = new URL('../../astronauts/', import.meta.url);
  const { suits, clips } = JSON.parse(await readFile(new URL('manifest.json', crewPack), 'utf8'));
  const astronauts = [];
  for (const [id, spec] of Object.entries(suits)) {
    const model = `eva_${id}`;
    const file = `models/flight/${model}.glb`;
    const bytes = await readFile(new URL(spec.file, crewPack));
    await writeFile(new URL(`../${file}`, import.meta.url), bytes);
    flightModels.push({ id: model, file, glb: bytes.toString('base64') });
    astronauts.push({ id, title: spec.title, model, walkSpeed: clips.walk.speedMps });
  }
  const textures = {};
  for (const [id, file, mime] of [
    ['earth', 'earth.jpg', 'image/jpeg'], ['lights', 'earth_lights.png', 'image/png'], ['moon', 'moon.jpg', 'image/jpeg'],
    ['mars', 'mars.jpg', 'image/jpeg'], ['jupiter', 'jupiter.jpg', 'image/jpeg'], ['saturn', 'saturn.jpg', 'image/jpeg'],
    ['rings', 'saturn-ring.png', 'image/png'],
  ]) {
    const bytes = await readFile(new URL(`../assets/space/${file}`, import.meta.url));
    textures[id] = `data:${mime};base64,${bytes.toString('base64')}`;
  }
  for(const {id,file} of earthImageryRegions) {
    const bytes=await readFile(new URL(`../assets/earth-flight/${file}`,import.meta.url));
    textures[`earth_${id}`]=`data:image/png;base64,${bytes.toString('base64')}`;
  }
  return { textures, models: flightModels, missions, astronauts };
}
