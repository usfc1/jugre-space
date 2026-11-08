import { X, Y, Z, m, tau, num, neg, node, part, joint, mount, ports, placed, polar, yaw, rot,
  lathe, cylinder, ring, box, rod, nozzle, solar, sphere, optics, vec, cutawaySkin } from './geometry.mjs';
import { falconLaunch, collars } from './launchers.mjs';
import { parachutes } from './artemis.mjs';

const trunkLength = 3.73;
const capsuleBase = 0;
const zenithPort = [0, 4.11, 16.13];
const snapshot = '2026-10-15';

function dragonNosecone(open) {
  const root = node('dragon_nosecone');
  const hinge = joint(root, 'hinge', [0, 0, 0], X, open ? -2.22 : 0);
  hinge.userData.angleRadians = -2.22;
  const shell = node('shell', hinge, [0, 0, 0.89]);
  lathe(shell, m.white, [[1.021, 0], [0.962, 0.2], [0.826, 0.44], [0.56, 0.72], [0.27, 0.835], [0, 0.85]]);
  lathe(shell, m.steel, [[0, 0.81], [0.26, 0.8], [0.53, 0.695], [0.796, 0.414], [0.927, 0.179], [0.986, 0]]);
  ring(shell, m.dark, 1.026, 0.985, 0, 0.033);
  for (const x of [-0.46, 0.46]) rod(hinge, m.alloy, [x, 0.023, 0.05], [x, 0.113, 0.31], 0.028);
  mount(root, 'mount_capsule', [0, 0, 0], neg(Y));
  return root;
}

function dragonDock() {
  const root = node('dragon_dock');
  ring(root, m.dark, 0.955, 0.63, 0, 0.15);
  ring(root, m.alloy, 0.795, 0.52, 0.13, 0.317);
  ring(root, m.steel, 0.702, 0.555, 0.307, 0.375);
  const hatch = joint(root, 'hatch', [0.49, 0.145, 0], Z);
  cylinder(hatch, m.bright, 0.502, 0, 0.045, [-0.49, 0, 0]);
  box(hatch, m.steel, [0.18, 0.032, 0.063], [-0.49, 0.05, 0.071]);
  for (let i = 0; i < 12; i++) {
    const a = i * tau / 12;
    box(root, m.steel, [0.073, 0.042, 0.082], polar(0.74, a, 0.329), yaw(a));
  }
  for (const [i, a] of [0.78, 2.81, 4.91].entries()) {
    const lug = part(root, `capture_guide_${num(i)}`, polar(0.592, a, 0.326));
    lug.quaternion.copy(yaw(a));
    box(lug, m.alloy, [0.133, 0.06, 0.099], [0, 0.015, 0]);
  }
  for (const [i, x] of [-0.815, 0.815].entries()) {
    const eye = part(root, `rendezvous_sensor_${num(i)}`, [x, 0.085, 0.107]);
    eye.quaternion.copy(rot(X, -Math.PI / 2));
    optics(eye, 0.052, 0.084);
  }
  mount(root, 'dock_port', [0, 0.375, 0]);
  mount(root, 'mount_capsule', [0, 0, 0], neg(Y));
  return root;
}

function dragonDraco() {
  const root = node('dragon_draco');
  for (const [i, a] of [0.53, 2.08, 3.63, 5.2].entries()) {
    const cluster = part(root, `cluster_${num(i)}`, polar(1.46, a, 1.61), neg(Z));
    cluster.quaternion.copy(yaw(a));
    box(cluster, m.dark, [0.58, 0.4, 0.18], [0, 0, 0.09], rot(X, -0.33));
    for (const [j, [x, y, z]] of [[-0.164, -0.068, 0.16], [0.173, -0.068, 0.16], [0, 0.136, 0.12]].entries()) {
      nozzle(cluster, `nozzle_${num(j)}`, [x, y, z], 0.074, 0.125, [x * 1.95, j === 2 ? 0.72 : -0.29, 1], m.black);
    }
  }
  for (const [i, a] of [0.08, 1.64, 3.19, 4.81].entries()) {
    const thruster = nozzle(root, `nose_thruster_${num(i)}`, polar(1.02, a, 2.89), 0.062, 0.089, polar(1, a, 0.68), m.black);
    thruster.userData.role = 'rcs';
  }
  mount(root, 'mount_capsule', [0, 0, 0], neg(Y));
  return root;
}

function cargoPack(parent, i, position) {
  const pack = part(parent, `cargo_pack_${num(i)}`, position);
  box(pack, i % 3 === 0 ? m.fabric : m.white, [0.39, 0.275, 0.36]);
  for (const side of [-1, 1]) box(pack, m.steel, [0.032, 0.286, 0.366], [side * 0.128, 0, 0]);
  box(pack, m.gold, [0.12, 0.072, 0.004], [0, 0.018, 0.182]);
  return pack;
}

function dragonCapsule(pose = 'closed') {
  const root = node('dragon_capsule');
  const cut = pose === 'cutaway';
  const shell = cut ? { start: Math.PI / 2, sweep: Math.PI } : undefined;
  const profile = [[1.965, 0.145], [1.984, 0.34], [1.917, 0.72], [1.769, 1.12], [1.51, 1.62],
    [1.26, 2.3], [1.105, 2.91], [1.025, 3.5], [1.021, 3.52]];
  if (cut) cutawaySkin(root, m.white, profile, 0.062, m.alloy);
  else lathe(root, m.white, profile);
  const shield = part(root, 'heat_shield', [0, capsuleBase, 0], Y);
  lathe(shield, m.shield, [[0, 0], [1.39, 0.038], [1.77, 0.088], [1.962, 0.145], [1.985, 0.204], [1.94, 0.275], [0, 0.28]]);
  const side = joint(root, 'side_hatch', [-0.31, 1.23, 1.7], Y, 0, neg(Z));
  if (!cut) {
    box(side, m.alloy, [0.81, 0.91, 0.08], [0, 0, 0.02], rot(X, -0.42));
    box(side, m.bright, [0.69, 0.8, 0.07], [0, 0, 0.066], rot(X, -0.42));
    box(side, m.steel, [0.11, 0.033, 0.029], [0.14, -0.1, 0.096]);
  } else root.remove(side);
  for (const [r, y] of [[1.96, 0.37], [1.761, 1.13], [1.256, 2.31], [1.03, 3.46]]) {
    ring(root, m.alloy, r + 0.008, r - 0.027, y, y + 0.026, shell);
  }
  placed(root, dragonDock(), [0, 3.48, 0]);
  if (!cut) placed(root, dragonDraco());
  if (pose !== 'recovery' && !cut) placed(root, dragonNosecone(pose === 'open'), [0, 3.52, -0.89]);
  if (pose === 'recovery') {
    const canopies = parachutes(root, 'dragon_recovery', 4, 15.0, 31.6);
    canopies.position.set(0.62, 2.81, 0.21);
  } else if (cut) {
    const interior = node('cutaway', root, undefined, { role: 'cutaway' });
    cylinder(interior, m.steel, 1.71, 0.32, 0.43);
    for (const [i, x] of [-0.68, 0.21].entries()) {
      const shelf = node(`cargo_rack_${num(i)}`, interior, [x, 0.53, -0.42]);
      for (const x of [-0.44, 0.44]) for (const z of [-0.32, 0.32]) rod(shelf, m.alloy, [x, 0, z], [x * 0.72, 1.69, z], 0.029);
      for (let j = 0; j < 4; j++) {
        box(shelf, m.steel, [0.83 - 0.069 * j, 0.043, 0.68], [0, 0.18 + 0.41 * j, 0]);
        for (const [k, dx] of [-0.19, 0.19].entries()) cargoPack(shelf, i * 8 + j * 2 + k, [dx, 0.33 + 0.41 * j, 0]);
      }
    }
  } else {
    const chute = part(root, 'parachute_cover', [0.68, 2.69, 0.84], neg(Z));
    box(chute, m.bright, [0.37, 0.32, 0.054], [0, 0, 0], rot(X, -0.2));
  }
  mount(root, 'mount_trunk', [0, capsuleBase, 0], neg(Y));
  mount(root, 'mount_nosecone', [0, 3.52, -0.89]);
  return root;
}

function dragonTrunk() {
  const root = node('dragon_trunk');
  const radius = 1.986;
  lathe(root, m.white, [[radius, 0], [radius, trunkLength], [1.893, trunkLength], [1.893, 0], [radius, 0]], { segments: 64 });
  collars(root, 2.012, [0.052, trunkLength - 0.1], 0.081, m.alloy);
  const shell = part(root, 'body_solar_array', [0, 0.14, 0]);
  for (let column = 0; column < 31; column++) {
    const a = -Math.PI / 2 + (column + 0.5) * Math.PI / 31;
    for (let row = 0; row < 17; row++) {
      const y = (row + 0.5) * (trunkLength - 0.28) / 17;
      box(shell, column % 4 === 0 ? m.solarAlt : m.solar, [0.19, 0.187, 0.018], polar(1.99, a, y), yaw(a));
    }
  }
  for (const [i, a] of [0.58, 2.56, 3.68, 5.7].entries()) {
    const fin = part(root, `fin_${num(i)}`, polar(radius, a, 0.19), neg(Z));
    fin.quaternion.copy(yaw(a));
    const finHeight = 1.73;
    const base = [0, 0, 0];
    const outer = [0, 0.24, 0.49];
    const top = [0, finHeight, 0];
    for (const dx of [-0.034, 0.034]) {
      rod(fin, m.white, [dx, base[1], base[2]], [dx, outer[1], outer[2]], 0.035);
      rod(fin, m.white, [dx, outer[1], outer[2]], [dx, top[1], top[2]], 0.035);
    }
    box(fin, m.bright, [0.075, 0.49, 0.27], [0, 0.39, 0.16], rot(X, 0.24));
  }
  for (let i = 0; i < 8; i++) rod(root, m.alloy, polar(1.82, i * tau / 8, 0.07), polar(1.82, i * tau / 8, 3.49), 0.046);
  const pallet = part(root, 'cargo_pallet', [0, 2.32, 0], Y);
  box(pallet, m.alloy, [2.38, 0.14, 1.44]);
  for (const x of [-0.88, 0.88]) box(pallet, m.dark, [0.12, 0.075, 1.35], [x, -0.085, 0]);
  mount(pallet, 'mount_cargo', [0, -0.074, 0], neg(Y));
  ports(root, trunkLength);
  return root;
}

function dragon(pose) {
  const root = node('cargo_dragon_2');
  placed(root, dragonTrunk());
  placed(root, dragonCapsule(pose), [0, trunkLength, 0]);
  mount(root, 'mount_falcon9', [0, 0, 0], neg(Y));
  return root;
}

function stationCylinder(id, radius, length, style = 'us') {
  const root = node(id);
  const coat = style === 'ru' ? m.bright : m.white;
  const end = length / 2;
  lathe(root, coat, [[radius * 0.63, -end], [radius * 0.92, -end + 0.32], [radius, -end + 0.73],
    [radius, end - 0.73], [radius * 0.94, end - 0.34], [radius * 0.63, end]]);
  for (const [r, y] of [[radius * 0.96, -end + 0.35], [radius * 1.007, -end + 0.79], [radius * 1.005, end - 0.88],
    [radius * 0.91, end - 0.28]]) ring(root, m.alloy, r, r * 0.978, y, y + 0.064);
  for (let a = 0; a < 8; a++) {
    const angle = a * tau / 8;
    for (let i = 0; i < Math.max(2, Math.round(length / 2.4)); i++) {
      const y = -end + 0.76 + (i + 0.5) * (length - 1.52) / Math.max(2, Math.round(length / 2.4));
      box(root, i % 2 ? m.bright : m.alloy, [radius * 0.43, 0.83, 0.061], polar(radius * 1.003, angle, y), yaw(angle));
      rod(root, m.gold, polar(radius * 1.04, angle + 0.12, y - 0.27), polar(radius * 1.04, angle + 0.12, y + 0.33), 0.028);
    }
  }
  for (const [label, side] of [['a', -1], ['b', 1]]) {
    const axial = part(root, `axial_hatch_${label}`, [0, side * end, 0], [0, -side, 0]);
    if (side < 0) axial.quaternion.copy(rot(X, Math.PI));
    ring(axial, m.steel, radius * 0.65, radius * 0.43, 0, 0.13);
    cylinder(axial, m.dark, radius * 0.46, -0.09, -0.031);
    mount(root, `mount_${label}`, [0, side * end, 0], [0, side, 0]);
  }
  return root;
}

const axisZ = rot(X, Math.PI / 2);

function portStack(parent, id, position, orientation, primary) {
  const pma = part(parent, `pma_${id}`, position);
  pma.quaternion.copy(orientation);
  lathe(pma, m.black, [[1.27, 0], [1.22, 0.27], [0.93, 0.89], [0.77, 1.36], [0.77, 1.46]]);
  collars(pma, 1.279, [0.075], 0.055, m.bright);
  const ida = part(pma, `ida_${id}`, [0, 1.46, 0]);
  ring(ida, m.white, 0.81, 0.53, 0, 0.51);
  ring(ida, m.alloy, 0.705, 0.555, 0.5, 0.61);
  for (let i = 0; i < 12; i++) {
    const a = i * tau / 12;
    box(ida, m.steel, [0.064, 0.033, 0.09], polar(0.751, a, 0.516), yaw(a));
  }
  mount(ida, primary ? 'dock_port' : 'dock_port_forward', [0, 0.61, 0]);
}

function harmony() {
  const root = node('iss_harmony_dock');
  placed(root, stationCylinder('harmony', 2.22, 6.71), [0, 0, 0], axisZ);
  portStack(root, 'zenith', [0, zenithPort[1] - 2.07, zenithPort[2] - 15.4], rot(Y, 0), true);
  portStack(root, 'forward', [0, 0, 3.36], axisZ, false);
  for (const [i, [x, y, z]] of [[-0.93, 1.94, -0.97], [0.91, 1.89, 1.57], [1.77, 1.14, -1.64]].entries()) {
    const target = part(root, `external_target_${num(i)}`, [x, y, z]);
    box(target, m.black, [0.46, 0.082, 0.46]);
    box(target, m.white, [0.058, 0.021, 0.38], [0, 0.056, 0]);
    box(target, m.white, [0.38, 0.021, 0.058], [0, 0.056, 0]);
  }
  mount(root, 'mount_destiny', [0, 0, -3.355], neg(Z));
  for (const side of [-1, 1]) mount(root, side < 0 ? 'mount_kibo' : 'mount_columbus', [side * 2.23, 0, 0], [side, 0, 0]);
  return root;
}

function cupola() {
  const root = node('cupola');
  lathe(root, m.bright, [[1.49, 0], [1.49, 0.19], [1.16, 0.8], [0.61, 1.03]], { segments: 6 });
  cylinder(root, m.window, 0.59, 0.999, 1.038, undefined, 48);
  ring(root, m.alloy, 0.681, 0.581, 1.0, 1.08);
  for (let i = 0; i < 6; i++) {
    const a = (i + 0.5) * tau / 6;
    const pane = part(root, `window_${num(i)}`, polar(1.084, a, 0.62), neg(Z));
    pane.quaternion.copy(yaw(a).multiply(rot(X, -0.61)));
    box(pane, m.steel, [0.78, 0.45, 0.077]);
    box(pane, m.window, [0.63, 0.37, 0.02], [0, 0, 0.043]);
  }
  mount(root, 'mount_tranquility', [0, 0, 0], neg(Y));
  return root;
}

function usSegment() {
  const root = node('iss_us_segment');
  placed(root, stationCylinder('unity', 2.26, 5.48), [0, 0, 0], axisZ);
  placed(root, stationCylinder('destiny', 2.16, 8.54), [0, 0, 7.29], axisZ);
  placed(root, harmony(), [0, 0, 15.4]);
  placed(root, stationCylinder('tranquility', 2.22, 6.7), [-5.42, 0, 0], rot(Z, Math.PI / 2));
  placed(root, cupola(), [-6.38, -2.09, -0.07], rot(X, Math.PI));
  placed(root, stationCylinder('columbus', 2.24, 6.87), [5.44, 0, 15.4], rot(Z, -Math.PI / 2));
  placed(root, stationCylinder('kibo', 2.2, 11.18), [-7.65, 0, 15.4], rot(Z, Math.PI / 2));
  placed(root, stationCylinder('kibo_logistics', 2.15, 4.2), [-7.09, 3.04, 15.5]);
  const pallet = part(root, 'kibo_exposed_facility', [-14.95, 0.04, 15.4]);
  box(pallet, m.bright, [4.7, 1.14, 3.48]);
  for (let i = 0; i < 6; i++) box(pallet, i % 2 ? m.steel : m.gold, [0.83, 0.82, 0.63], [(i % 3 - 1) * 1.34, 0.81, (i < 3 ? -1 : 1) * 0.82]);
  placed(root, stationCylinder('quest', 1.65, 5.44), [4.82, 0, 0], rot(Z, -Math.PI / 2));
  const pma = placed(root, stationCylinder('pma_1', 1.36, 1.45), [0, 0, -3.38], axisZ);
  pma.userData.role = 'intermodule_adapter';
  mount(root, 'mount_zarya', [0, 0, -4.1], neg(Z));
  mount(root, 'mount_truss', [0, 2.22, 6.2]);
  return root;
}

function shortWings(parent, id, length, width) {
  for (const side of [-1, 1]) {
    const frame = joint(parent, `${id}_${side < 0 ? 'l' : 'r'}`, [side * 2.02, 0.19, 0], X, 0);
    frame.quaternion.copy(yaw(side * Math.PI / 2));
    const cells = node('cells', frame, [0, 0, length / 2 + 0.2]);
    solar(cells, width, length, 8, 18, m.solarAlt);
  }
}

function russianSegment() {
  const root = node('iss_russian_segment');
  const zarya = placed(root, stationCylinder('zarya', 2.03, 12.55, 'ru'), [0, 0, -10.34], axisZ);
  const zvezda = placed(root, stationCylinder('zvezda', 2.09, 13.1, 'ru'), [0, 0, -23.15], axisZ);
  shortWings(node('wing_base', zvezda, [0, 0.08, 1.62]), 'solar', 5.92, 2.27);
  for (const side of [-1, 1]) {
    const antenna = part(zvezda, `kurs_${side < 0 ? 'l' : 'r'}`, [side * 1.31, -6.05, 0.96]);
    rod(antenna, m.alloy, [0, 0, 0], [side * 0.8, -0.17, 0.36], 0.035);
    cylinder(antenna, m.alloy, 0.147, -0.079, 0.049);
  }
  placed(root, stationCylinder('poisk', 1.25, 4.05, 'ru'), [0, 4.01, -17.48]);
  placed(root, stationCylinder('rassvet', 1.2, 4.61, 'ru'), [0, -3.92, -7.75]);
  const nauka = placed(root, stationCylinder('nauka', 2.08, 12.18, 'ru'), [0, -6.4, -18.58], rot(X, Math.PI));
  shortWings(node('wing_base', nauka, [0, 2.91, 0]), 'solar', 4.57, 1.89);
  const prichal = node('prichal', root, [0, -13.58, -18.58]);
  sphere(prichal, m.bright, [1.45, 1.42, 1.45], [0, 0, 0]);
  for (const dir of [Y, neg(Y), Z, neg(Z), X, neg(X)]) {
    const end = dir.map((x) => x * 1.55);
    rod(prichal, m.alloy, dir.map((x) => x * 1.19), end, 0.62, 32);
  }
  mount(zarya, 'mount_unity', [0, 6.27, 0]);
  mount(root, 'mount_unity', [0, 0, -4.1], Z);
  return root;
}

function trussPiece(parent, id, x0, x1, girth, sections) {
  const root = part(parent, id, [x0, 0, 0], neg(X));
  const size = x1 - x0;
  const corners = [[girth, girth], [girth, -girth], [-girth, -girth], [-girth, girth]];
  for (const [y, z] of corners) rod(root, m.alloy, [0, y, z], [size, y, z], 0.11);
  for (let i = 0; i <= sections; i++) {
    const x = i * size / sections;
    for (const [k, [y, z]] of corners.entries()) {
      const [ny, nz] = corners[(k + 1) % corners.length];
      rod(root, m.alloy, [x, y, z], [x, ny, nz], 0.08);
      if (i < sections) rod(root, m.steel, [x, y, z], [x + size / sections, ny, nz], 0.068);
    }
    if (i < sections && i % 2 === 0) {
      box(root, m.bright, [Math.abs(size) / sections * 0.71, girth * 0.84, girth], [x + size / sections / 2, 0, 0]);
      box(root, m.gold, [Math.abs(size) / sections * 0.52, 0.27, 0.4], [x + size / sections / 2, 0.44, girth * 0.64]);
    }
  }
  return root;
}

const trussY = 4.1;
const trussZ = 6.2;

function truss() {
  const root = node('iss_truss');
  trussPiece(root, 's0', -5.7, 5.7, 1.39, 4);
  for (const [side, id] of [[-1, 'p'], [1, 's']]) {
    for (const [n, a, b, girth, segments] of [[1, 5.7, 17.6, 1.34, 5], [3, 17.6, 27.2, 1.17, 4],
      [4, 27.2, 34.3, 1.0, 3], [5, 34.3, 42.7, 0.94, 3], [6, 42.7, 47, 0.88, 2]]) {
      trussPiece(root, `${id}${n}`, a * side, b * side, girth, segments);
    }
    for (const [i, x] of [10.5, 15.8, 21.5].entries()) {
      const radiator = joint(root, `${id}_radiator_${num(i)}`, [side * x, -0.2, -1.4], Z, side * 0.11, Z);
      const head = joint(radiator, 'gimbal', [0, 0, -0.45], X, -0.36);
      for (let tile = 0; tile < 7; tile++) {
        const at = -0.51 - tile * 1.04;
        box(head, m.bright, [1.98, 0.059, 1.01], [0, 0, at]);
        for (const rib of [-0.87, 0, 0.87]) box(head, m.alloy, [0.049, 0.081, 1.015], [rib, 0, at]);
      }
    }
    for (const x of [30.1, 48.95]) mount(root, `mount_${id}${x < 40 ? '4' : '6'}_arrays`, [side * x, 0, 0], [side, 0, 0]);
  }
  for (const side of [-1, 1]) rod(root, m.steel, [side * 1.12, -1.34, 0], [side * 1.12, -2.12, 0], 0.2);
  mount(root, 'mount_destiny', [0, -1.88, 0], neg(Y));
  return root;
}

function arrays() {
  const root = node('iss_arrays', undefined, undefined, { referenceDate: snapshot });
  const channels = [['p6', -48.95, '2B', '4B'], ['p4', -30.1, '2A', '4A'],
    ['s4', 30.1, '3A', '1A'], ['s6', 48.95, '3B', '1B']];
  for (const [segment, x, aftChannel, forwardChannel] of channels) {
    const alpha = joint(root, `${segment}_alpha_joint`, [x, 0, 0], X, x < 0 ? -0.11 : 0.1);
    rod(alpha, m.steel, [-0.95, 0, 0], [0.95, 0, 0], 0.65, 24);
    for (const side of [-1, 1]) {
      const beta = joint(alpha, `wing_${side < 0 ? 'aft' : 'forward'}`, [0, 0.15, side * 1.18], Z);
      const channel = side < 0 ? aftChannel : forwardChannel;
      beta.userData.powerChannel = channel;
      beta.quaternion.copy(yaw(side < 0 ? Math.PI : 0));
      const length = 35.15;
      rod(beta, m.alloy, [0, 0, 0], [0, 0, length], 0.095, 8);
      for (const half of [-1, 1]) {
        const blanket = part(beta, `blanket_${half < 0 ? 'l' : 'r'}`, [half * 2.78, 0, 0.55]);
        solar(node('cells', blanket, [0, 0, (length - 0.58) / 2]), 5.42, length - 0.58, 18, 44, m.solarAmber);
        for (const x of [-2.67, 2.67]) rod(blanket, m.steel, [x, 0, 0], [x, 0, length - 0.55], 0.033, 7);
      }
      if (channel !== '2A' && channel !== '3B') {
        const overlay = joint(beta, 'irosa', [0, 0.26, 1.05], X, -0.125);
        const cells = node('cells', overlay, [0, 0, 9.25]);
        solar(cells, 5.96, 18.4, 19, 39);
        for (const x of [-2.96, 2.96]) rod(overlay, m.alloy, [x, 0, 0], [x, 0, 18.42], 0.045);
        for (const x of [-2.5, 2.5]) rod(beta, m.steel, [x, 0, 1.1], [x, 0.44, 2.03], 0.082);
      }
    }
  }
  return root;
}

function canadarm() {
  const root = node('iss_canadarm2');
  const socket = joint(root, 'base_roll', [0, 0, 0], Y, 0.39);
  cylinder(socket, m.alloy, 0.34, -0.1, 0.31);
  const shoulder = joint(socket, 'shoulder_pitch', [0, 0.32, 0], X, -0.8);
  cylinder(shoulder, m.bright, 0.175, 0, 7.58);
  collars(shoulder, 0.199, [0, 0.51, 6.95, 7.44], 0.08, m.steel);
  const elbow = joint(shoulder, 'elbow_pitch', [0, 7.57, 0], X, 2.08);
  cylinder(elbow, m.bright, 0.169, 0.04, 7.56);
  collars(elbow, 0.193, [0.05, 0.57, 7.0, 7.46], 0.081, m.steel);
  const wrist = joint(elbow, 'wrist_pitch', [0, 7.56, 0], X, -0.63);
  const end = joint(wrist, 'wrist_roll', [0, 0.22, 0], Y, 0.16);
  cylinder(end, m.steel, 0.247, 0, 0.52);
  ring(end, m.white, 0.255, 0.146, 0.491, 0.57);
  mount(end, 'mount_grapple', [0, 0.57, 0]);
  mount(root, 'mount_station', [0, 0, 0], neg(Y));
  return root;
}

function station() {
  const root = node('iss', undefined, undefined, { referenceDate: snapshot, configuration: 'CRS-35 approach' });
  placed(root, usSegment());
  placed(root, russianSegment());
  placed(root, truss(), [0, trussY, trussZ]);
  placed(root, arrays(), [0, trussY, trussZ]);
  placed(root, canadarm(), [-2.41, 1.61, 11.8], yaw(-0.8));
  return root;
}

function withDragon(gap = 0, close = false) {
  const root = node(close ? 'dragon_harmony_detail' : gap ? 'dragon_iss_approach' : 'dragon_iss_docked');
  const iss = close ? placed(root, harmony(), [0, 0, 15.4]) : placed(root, station());
  const craft = placed(root, dragon('open'), [0, 0, 0], rot(X, Math.PI));
  const target = iss.getObjectByName('iss_harmony_dock.pma_zenith.ida_zenith.dock_port');
  const probe = craft.getObjectByName('dragon_dock.dock_port');
  root.updateMatrixWorld(true);
  const correction = target.getWorldPosition(vec([0, 0, 0])).sub(probe.getWorldPosition(vec([0, 0, 0])));
  craft.position.add(correction).add(vec([0, gap, 0]));
  Object.assign(root.userData, { dockingPair: [target.name, probe.name], gapMeters: gap, referenceDate: snapshot });
  return root;
}

export function registerStation(out) {
  for (const item of [dragonCapsule(), dragonNosecone(false), dragonDock(), dragonDraco(), dragonTrunk(),
    truss(), arrays(), usSegment(), russianSegment(), harmony(), canadarm(), parachutes(undefined, 'dragon_recovery', 4, 15.0, 31.6)]) out.component(item);
  out.assembly(falconLaunch('cargo_dragon_falcon9_launch', dragon('closed')), 'launch_without_fairing');
  out.assembly(dragon('open'), 'nosecone_open');
  out.assembly(station(), 'crs35_snapshot');
  out.assembly(withDragon(22), 'zenith_approach');
  out.assembly(withDragon(), 'harmony_zenith_docked');
  out.assembly(withDragon(0, true), 'harmony_closeup_docked');
  out.variant('dragon_nosecone_open', 'hinge_open', dragonNosecone(true));
  out.variant('cargo_dragon_closed', 'nosecone_closed', dragon('closed'));
  out.variant('dragon_capsule_cutaway', 'cutaway', dragonCapsule('cutaway'));
  out.variant('dragon_capsule_recovery', 'parachutes_deployed_trunk_separated', dragonCapsule('recovery'));
}
