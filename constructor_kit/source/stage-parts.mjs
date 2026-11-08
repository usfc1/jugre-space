import { Box3, Vector3 } from 'three';
import { X, Y, Z, m, tau, num, neg, node, polar, yaw, rot, box, cylinder, lathe, ring, rod,
  bandedTank } from './geometry.mjs';
import { axial, stack, connector, radial, payload, fairingReceivers, findPart, readAsset, removeNodes, wrap } from './model-io.mjs';
import { names, stages, apollo, artemis, falcon, voyager } from './reference.mjs';

function asset(root, category, name, stage, representation, extra = {}) {
  return { id: root.name, root, category, name, program: stage.program, ref: stage.ref, representation, ...extra };
}

function engineSeat(root, profile, index, position) {
  connector(root, `engine_${num(index)}`, position, neg(Y), `heritage_engine_${profile}`, 'engineReceiver');
}

const tankFinishes = { rp1: m.fuel, lox: m.lox, lh2: m.hydrogen, aerozine50: m.gold, nto: m.orange };

async function stageVessels(stage, root) {
  const output = [];
  const configs = stage.vessels;
  const id = stage.ref.id;
  const add = (vessel, fluid, receiver, representation, ref) => {
    const key = `heritage_vessel_${id}_${fluid}`;
    connector(vessel, 'vessel', [0, 0, 0], neg(Y), key, 'internalVessel');
    connector(root, `vessel_${fluid}`, receiver, Y, key, 'internalReceiver');
    output.push(asset(vessel, 'tank', names(`${stage.label} · ${fluid.toUpperCase()}`, `${stage.label} · ${fluid.toUpperCase()}`),
      { ...stage, ref }, representation, { propellant: fluid, internal: true }));
  };
  if (configs.ref) {
    const cutaway = await readAsset(configs.ref);
    for (const [partName, fluid] of configs.entries) {
      const original = findPart(cutaway, `${id}.cutaway.${partName}`);
      if (!original) throw new Error(`Tank not found in cutaway for ${id}: ${partName}`);
      const { root: vessel, visual } = wrap(`${id}_${fluid}_vessel`, original);
      const bounds = new Box3().setFromObject(vessel, true);
      visual.position.y -= bounds.min.y;
      const [x, y, z] = original.getWorldPosition(new Vector3()).toArray();
      add(vessel, fluid, [x, y + bounds.min.y - stage.base, z], 'extracted', configs.ref);
    }
  } else {
    let y = 0.08;
    for (const [radius, length, fluid] of configs.simple) {
      const vessel = node(`${id}_${fluid}_vessel`);
      bandedTank(vessel, tankFinishes[fluid], 0, radius, length);
      for (const angle of [0.38, Math.PI + 0.38]) {
        rod(vessel, m.steel, polar(radius * 0.86, angle, 0.11), polar(radius * 1.011, angle, length * 0.28), radius * 0.016, 8);
        rod(vessel, m.steel, polar(radius * 1.011, angle, length * 0.28), polar(radius * 1.011, angle, length * 0.75), radius * 0.016, 8);
      }
      add(vessel, fluid, [0, y, 0], 'reconstructed', stage.ref);
      y += length + 0.12;
    }
  }
  return output;
}

function prepareControlDeck(stage, donor, top) {
  const id = `${stage.ref.id}_avionics`;
  const partId = `${stage.ref.id}.${stage.deck}`;
  const original = findPart(donor, partId);
  if (!original) throw new Error(`Missing avionics group ${partId}`);
  const { root, visual } = wrap(id, original);
  const height = (stage.deckTop ?? top) - stage.deckBase;
  if (stage.deck === 'forward_skirt') {
    visual.position.y -= stage.deckBase;
    const r = stage.diameter / 2;
    ring(root, m.alloy, r * 0.985, r * 0.81, 0.12, 0.24);
    ring(root, m.dark, r * 0.97, r * 0.83, height - 0.18, height - 0.08);
    for (let i = 0; i < 8; i++) {
      const angle = (i + 0.5) * tau / 8;
      box(root, m.alloy, [0.53, 0.42, 0.33], polar(r * 0.865, angle, height * 0.61), yaw(angle));
    }
  }
  stack(root, height, stage.diameter);
  return asset(root, 'control', names(`${stage.label} · авионика`, `${stage.label} avionics`), stage,
    stage.deck === 'forward_skirt' ? 'reconstructed' : 'extracted');
}

function preparePayloadAdapter(stage, donor, top) {
  const original = findPart(donor, `${stage.ref.id}.payload_adapter`);
  const { root } = wrap(`${stage.ref.id}_payload_fitting`, original);
  axial(root, 'aft', 0, neg(Y), stage.diameter);
  payload(root, top - original.position.y, { receiver: true });
  if (stage.ref.id === 'falcon9_stage_2') fairingReceivers(root, 'falcon', top - original.position.y);
  return asset(root, 'structure', names(`${stage.label} · адаптер груза`, `${stage.label} payload fitting`), stage, 'extracted');
}

function extraStageSockets(stage, donor, root) {
  const stageId = stage.ref.id;
  const attachments = donor.children.filter((o) => {
    const id = o.userData.partId ?? '';
    return /\.mount_srb_/.test(id) || /^s_ic\.engine_fairing_\d+$/.test(id) || /^falcon9_stage_1\.landing_leg_\d+$/.test(id);
  });
  for (const [index, o] of attachments.entries()) {
    const p = o.position.clone();
    const normal = new Vector3(p.x, 0, p.z).normalize();
    p.y -= stage.base;
    radial(root, `side_${num(index)}`, p.toArray(), normal.toArray(), 'host');
  }
  if (stageId === 'icps') axial(root, 'launch_support', findPart(donor, 'icps.mount_aft').position.y - stage.base, neg(Y), 5.1);
  if (['s_ii', 's_ivb', 'atlas_v_centaur', 'falcon9_stage_2', 'titan_stage_2', 'titan_centaur'].includes(stageId)) {
    axial(root, 'launch_support', -stage.base, neg(Y), stage.diameter);
  }
}

function buildFrame(stage, engines) {
  const origin = Math.min(...engines.map((engine) => engine.position.y));
  const h = stage.base - origin;
  const r = stage.diameter / 2;
  const root = node(`${stage.ref.id}_engine_frame`);
  const rim = Math.min(0.17, h * 0.49);
  ring(root, m.steel, r * 0.992, r * 0.88, h - rim, h);
  ring(root, m.dark, r * 0.926, r * 0.878, Math.max(0, h - rim - r * 0.082), h - rim);
  const seats = stage.paired ? [[0, 0, 0]] : engines.map(({ position: p }) => [p.x, p.y - origin, p.z]);
  for (const [i, [x, y, z]] of seats.entries()) {
    const seatRadius = Math.min(r * 0.74, r * (seats.length > 5 ? 0.217 : seats.length > 1 ? 0.28 : 0.5));
    ring(root, m.alloy, seatRadius, seatRadius * 0.64, y, y + Math.min(h * 0.48, 0.13), { position: [x, 0, z] });
    engineSeat(root, stage.engine, i, [x, y, z]);
    const angle = Math.atan2(x, z);
    for (const twist of [-0.58, 0.58]) {
      rod(root, m.alloy, [x, y + Math.min(h * 0.32, 0.094), z], polar(r * 0.898, angle + twist, h - rim * 0.54), r * 0.041, 8);
    }
  }
  if (seats.length === 1) {
    for (const angle of [Math.PI - 0.58, Math.PI + 0.58]) {
      rod(root, m.alloy, [0, h * 0.22, 0], polar(r * 0.9, angle, h - rim * 0.5), r * 0.044, 10);
    }
  }
  axial(root, 'forward', h, Y, stage.diameter);
  return asset(root, 'structure', names(`${stage.label} · двигательная рама`, `${stage.label} engine frame`), stage, 'constructorFit',
    { engineProfile: `heritage_engine_${stage.engine}`, engineSlots: seats.length });
}

function engineModel(stage, engines) {
  const id = `${stage.engine}_engine`;
  let root;
  if (stage.paired) {
    root = node(id);
    const y = engines[0].position.y;
    for (const engine of engines) {
      const clone = engine.clone(true);
      clone.position.y -= y;
      root.add(clone);
    }
    rod(root, m.alloy, [-0.91, 0.05, 0], [0.91, 0.05, 0], 0.10);
  } else ({ root } = wrap(id, engines[0]));
  const chambers = {
    rs25: [[0, -1], [0, 1]], rd180: [[-0.78, -1], [0.78, 1]], lr87: [[-0.65, -1], [0.65, 1]],
    merlin_vac: [[0, 1]],
  }[stage.engine];
  if (chambers) {
    const fittings = node('simplified_feed_hardware', root);
    for (const [x, side] of chambers) {
      const a = [x + side * 0.21, -0.05, -0.15];
      const b = [x + side * 0.48, -0.34, -0.11];
      const c = [x + side * 0.47, -0.74, 0.09];
      const d = [x + side * 0.23, -0.94, 0.11];
      rod(fittings, m.steel, a, b, 0.068);
      rod(fittings, m.steel, b, c, 0.067);
      rod(fittings, m.nickel, c, d, 0.062);
      box(fittings, m.dark, [0.18, 0.28, 0.24], [x + side * 0.38, -0.22, 0.10]);
    }
  }
  connector(root, 'engine', [0, 0, 0], Y, `heritage_engine_${stage.engine}`, 'engine');
  return asset(root, 'engine', names(stage.engineLabel, stage.engineLabel), stage, 'extracted', { propellant: stage.propellant });
}

async function splitStage(stage) {
  const donor = await readAsset(stage.ref);
  const id = stage.ref.id;
  const top = findPart(donor, `${id}.mount_forward`).position.y;
  const engines = donor.children.filter((child) => stage.nodePattern.test(child.userData.partId ?? ''));
  if (engines.length === 0) throw new Error(`Missing engines in ${id}`);
  const { root, visual } = wrap(`${id}_tank_section`, donor);
  const drops = new Set([`${id}.mount_aft`, `${id}.mount_forward`, `${id}.mount_launch_adapter`]);
  if (stage.deck) drops.add(`${id}.${stage.deck}`);
  if (stage.payloadAdapter) drops.add(`${id}.payload_adapter`);
  removeNodes(visual, (child) => {
    const tag = child.userData.partId ?? '';
    return drops.has(tag) || stage.nodePattern.test(tag) || stage.removed?.test(tag);
  });
  visual.position.y -= stage.base;
  stack(root, (stage.deckBase ?? top) - stage.base, stage.diameter);
  if (id === 'titan_centaur') fairingReceivers(root, 'titan', -stage.base);
  extraStageSockets(stage, donor, root);
  const vessels = await stageVessels(stage, root);
  const result = [asset(root, 'tank', names(`${stage.label} · секция баков`, `${stage.label} tank section`), stage, 'extracted', {
    propellant: stage.propellant, includes: vessels.map((vessel) => vessel.id),
  }), buildFrame(stage, engines), engineModel(stage, engines), ...vessels];
  if (stage.deck) result.push(prepareControlDeck(stage, donor, top));
  if (stage.payloadAdapter) result.push(preparePayloadAdapter(stage, donor, top));
  return result;
}

function falconAvionics() {
  const root = node('falcon9_avionics_section');
  const r = 1.83;
  const h = 0.37;
  ring(root, m.bright, r, r * 0.94, 0, h);
  ring(root, m.steel, r * 0.947, r * 0.83, 0.071, 0.117);
  for (let i = 0; i < 8; i++) {
    const angle = i * tau / 8;
    box(root, i % 2 ? m.alloy : m.steel, [0.32, 0.2, 0.33], polar(r * 0.848, angle, 0.176), yaw(angle));
  }
  stack(root, h, 3.66);
  return asset(root, 'control', names('Falcon 9 · секция авионики', 'Falcon 9 avionics insert'),
    { program: falcon, ref: { id: 'falcon9_stage_2', pack: 'historical_spacecraft' } }, 'constructorFit');
}

function titanSeparator() {
  const root = node('titan_centaur_separation_joint');
  const height = 0.24;
  const r = 1.525;
  ring(root, m.alloy, r, 1.37, 0, 0.088);
  ring(root, m.steel, r, 1.35, height - 0.086, height);
  ring(root, m.dark, r * 0.97, 1.39, 0.085, height - 0.084);
  for (let i = 0; i < 12; i++) {
    const a = i * tau / 12;
    box(root, m.steel, [0.16, 0.095, 0.047], polar(r, a, height / 2), yaw(a));
  }
  stack(root, height, 3.05);
  return asset(root, 'separation', names('Titan IIIE · стык отделения Centaur', 'Titan IIIE Centaur separation joint'),
    { program: voyager, ref: { id: 'titan_centaur', pack: 'historical_spacecraft' } }, 'constructorFit', { staging: 'detach' });
}

async function serviceTanks() {
  const configurations = [
    ['apollo11', 'apollo_sm_cutaway', 'apollo_sm', apollo, [
      ['sps_fuel_0', 'columbia_sps_fuel_tank', 'Бак горючего SPS', 'SPS fuel tank'],
      ['sps_oxidizer_1', 'columbia_sps_oxidizer_tank', 'Бак окислителя SPS', 'SPS oxidizer tank'],
    ]],
    ['historical_spacecraft', 'orion_esm_cutaway', 'orion_esm', artemis, [
      ['propellant_01', 'orion_esm_tank_a', 'Топливный бак Orion A', 'Orion ESM propellant tank A'],
      ['propellant_02', 'orion_esm_tank_b', 'Топливный бак Orion B', 'Orion ESM propellant tank B'],
      ['water', 'orion_esm_water_tank', 'Бак воды Orion', 'Orion ESM water tank'],
    ]],
  ];
  const models = [];
  for (const [pack, sourceId, component, program, entries] of configurations) {
    const ref = { id: sourceId, pack };
    const donor = await readAsset(ref);
    for (const [partId, id, ru, en] of entries) {
      const original = findPart(donor, `${component}.cutaway.${partId}`);
      const { root, visual } = wrap(id, original);
      const bounds = new Box3().setFromObject(root, true);
      visual.position.y -= bounds.min.y;
      connector(root, 'vessel', [0, 0, 0], neg(Y), `heritage_vessel_${id}`, 'internalVessel');
      models.push(asset(root, 'tank', names(ru, en), { program, ref }, 'extracted', { internal: true }));
    }
  }
  return models;
}

export async function stageParts() {
  const result = [];
  for (const stage of stages) result.push(...await splitStage(stage));
  return [...result, falconAvionics(), titanSeparator(), ...await serviceTanks()];
}

export function crossAdapter(diameter) {
  const id = `jugre_adapter_250_${Math.round(diameter * 100)}`;
  const root = node(id);
  const small = 1.25;
  const large = diameter / 2;
  const height = Math.max(0.3, (large - small) * 0.86 + 0.23);
  const profile = [[small, 0], [small, 0.10], [large, height - 0.10], [large, height],
    [large - 0.055, height], [large - 0.055, height - 0.10], [small - 0.055, 0.10], [small - 0.055, 0], [small, 0]];
  lathe(root, m.bright, profile, { segments: 64 });
  ring(root, m.steel, small * 1.006, small * 0.955, 0, 0.07);
  ring(root, m.steel, large * 1.003, large - 0.072, height - 0.069, height);
  for (let i = 0; i < 12; i++) {
    const a = i * tau / 12;
    rod(root, i % 3 === 0 ? m.orange : m.steel, polar(small + 0.014, a, 0.105), polar(large + 0.013, a, height - 0.104), 0.021, 9);
  }
  stack(root, height, 2.50, diameter);
  return { id, root, category: 'structure', origin: 'jugre', representation: 'original',
    name: names(`Переходник JUGRE Ø2,50 ↔ ${diameter.toFixed(2).replace('.', ',')} м`, `JUGRE adapter Ø2.50 ↔ ${diameter.toFixed(2)} m`),
    program: [], gameStats: { nominalDiametersM: [2.5, diameter] } };
}

export function cargoDeck() {
  const id = 'jugre_cargo_deck_250';
  const root = node(id);
  const height = 0.29;
  ring(root, m.steel, 1.25, 1.11, 0, height);
  cylinder(root, m.bright, 1.11, 0.15, 0.23);
  for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    box(root, m.orange, [0.22, 0.11, 0.23], polar(0.87, a, 0.231), yaw(a));
    rod(root, m.steel, polar(0.42, a, 0.087), polar(1.13, a, 0.132), 0.045, 10);
  }
  axial(root, 'aft', 0, neg(Y), 2.5);
  payload(root, height, { receiver: true });
  return { id, root, category: 'separation', origin: 'jugre', representation: 'original',
    name: names('Грузовая площадка JUGRE Ø2,50 м', 'JUGRE Ø2.50 m payload deck'), program: [], staging: 'deployPayload' };
}
