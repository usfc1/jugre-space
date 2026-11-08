import {
  bell, box, cylinder, ellipsoid, flag, group, hinge, label, lateralNozzle, m, mount,
  numbered, orientY, part, polar, polygon, profile, rad, ring, skin, strut, tau, yaw,
} from './geometry.mjs';
import { cmRadius, stack } from './saturn.mjs';

export const cmDockY = 3.48;
export const smLength = stack.apollo_cm - stack.apollo_sm;
const quadrants = [0, 1, 2, 3].map((index) => index * Math.PI / 2);
const cmCone = [[1.948, 0.31], [1.937, 0.43], [0.707, 2.84], [0.665, 2.96]];
const coneRadius = (y) => 1.937 + (0.707 - 1.937) * (y - 0.43) / (2.84 - 0.43);
const coneMap = (angle, offset = 0) => (x, y) => polar(coneRadius(y) + offset, angle + x / coneRadius(y), y);

function capsuleSkin(node) {
  const bottom = 1.0;
  const top = 1.85;
  const halfAngle = 0.203;
  profile(node, m.bright, [...cmCone.slice(0, 2), [coneRadius(bottom), bottom]], { segments: 96 });
  skin(node, m.bright, coneRadius(bottom), coneRadius(top), bottom, top,
    { start: halfAngle, sweep: tau - 2 * halfAngle, segments: 88 });
  profile(node, m.bright, [[coneRadius(top), top], ...cmCone.slice(2)], { segments: 96 });
  const opening = part(node, 'hatch_recess');
  const rim = [polar(coneRadius(bottom), -halfAngle, bottom), polar(coneRadius(bottom), halfAngle, bottom),
    polar(coneRadius(top), halfAngle, top), polar(coneRadius(top), -halfAngle, top)];
  const recessed = rim.map(([x, y, z]) => [x, y, z - 0.17]);
  polygon(opening, m.shadow, recessed);
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    polygon(opening, m.steel, [rim[j], rim[i], recessed[i], recessed[j]]);
  }
  for (let i = 0; i < 32; i++) {
    const angle = i * tau / 32;
    const runs = Math.min(angle, tau - angle) < halfAngle
      ? [[0.45, bottom], [top, 2.83]] : [[0.45, 2.83]];
    for (const [start, end] of runs) {
      skin(node, i % 4 === 0 ? m.aluminum : m.bright, coneRadius(start) + 0.003,
        coneRadius(end) + 0.003, start, end, { start: angle, sweep: rad(0.68), segments: 1 });
    }
  }
}

function capsuleWindow(parent, name, angle, y, width, height, angled = false) {
  const node = part(parent, name, polar(coneRadius(y) + 0.02, angle, y));
  const stencil = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2],
    [w * (angled ? 0.26 : 0.48), h / 2], [-w * 0.46, h / 2]];
  const origin = node.position;
  for (const [finish, scale, shift] of [[m.steel, 1.16, 0.017], [m.shadow, 1.02, 0.031],
    [m.glass, 0.84, 0.037], [m.glassLight, 0.66, 0.04]]) {
    const h = height * scale;
    const vertices = stencil(width * scale, h).map(([x, dy]) =>
      coneMap(angle, shift)(x, y + dy * (finish === m.glassLight ? 0.19 : 1)
        + (finish === m.glassLight ? h * 0.43 : 0)).map((v, i) => v - origin.getComponent(i)));
    polygon(node, finish, vertices);
  }
}

function packedParachutes(parent) {
  const node = part(parent, 'parachutes', [0, 2.79, 0], { standalone: true, configuration: 'packed' });
  for (const [index, angle] of [0, tau / 3, 2 * tau / 3].entries()) {
    const pack = part(node, `main_${numbered(index)}`, polar(0.43, angle, 0.09));
    box(pack, m.canvas, [0.31, 0.19, 0.26], [0, 0, 0], yaw(angle));
    box(pack, m.orange, [0.072, 0.196, 0.263], [0, 0, 0], yaw(angle));
  }
}

export function deployedParachutes(parent) {
  const node = parent ? part(parent, 'parachutes', [0, cmDockY, 0], { configuration: 'deployed' })
    : group('apollo_cm.parachutes', undefined, undefined, { configuration: 'deployed' });
  mount(node, 'mount_risers', [0, 0, 0], [0, -1, 0]);
  for (let i = 0; i < 3; i++) {
    const angle = 0.24 + i * tau / 3;
    const center = polar(14, angle, 33.5 + i * 1.1);
    const canopy = part(node, `main_${numbered(i)}`, center);
    for (let gore = 0; gore < 36; gore++) {
      const start = gore * tau / 36;
      const sweep = tau / 36;
      profile(canopy, Math.floor(gore / 3) % 2 ? m.canvas : m.orange, [
        [11.62, 0], [11.47, 1.18], [10.94, 2.45], [9.96, 3.74],
        [8.44, 4.88], [6.28, 5.78], [3.68, 6.3], [0.85, 6.51],
      ], { start, sweep, segments: 4 });
      if (gore % 3 === 0) {
        const lineEnd = polar(11.61, start);
        const bridle = polar(2.75, angle, 8.0).map((v, j) => v - center[j]);
        strut(canopy, m.canvas, lineEnd, bridle, 0.015, 4);
      }
    }
    strut(node, m.canvas, polar(2.75, angle, 8.0), polar(0.45, angle, 0.0), 0.041, 6);
  }
  return node;
}

export function commandModule(pose = 'orbit') {
  const node = group('apollo_cm');
  const recovery = pose === 'recovery';
  const docked = pose === 'docked';
  const body = part(node, 'skin');
  capsuleSkin(body);
  const shield = part(node, 'heat_shield', [0, 0.11, 0], { standalone: true });
  profile(shield, m.ablator, [[0, -0.11], [0.6, -0.09], [1.22, -0.025], [1.71, 0.071],
    [1.91, 0.143], [cmRadius, 0.192], [1.948, 0.24], [1.85, 0.28], [0, 0.28]],
  { segments: 96 });
  ring(shield, m.steel, 1.951, 1.895, 0.229, 0.25);
  mount(shield, 'mount_heat_shield', [0, 0.24, 0]);

  const hatchY = 1.42;
  const hatchPivot = coneMap(0, 0.04)(-0.46, hatchY);
  const hatch = hinge(node, 'side_hatch', hatchPivot, [0, 1, -0.51], rad(-88));
  hatch.userData.standalone = true;
  for (const [finish, w, h, offset] of [[m.steel, 0.99, 1.12, 0.024], [m.aluminum, 0.91, 1.03, 0.047]]) {
    const border = [[-0.39, -0.5], [0.38, -0.5], [0.5, -0.36], [0.45, 0.37],
      [0.33, 0.5], [-0.33, 0.5], [-0.46, 0.37], [-0.5, -0.36]];
    polygon(hatch, finish, border.map(([x, y]) => coneMap(0, offset)(w * x, hatchY + h * y)
      .map((v, i) => v - hatchPivot[i])));
  }
  for (const [finish, width, height, shift] of [[m.steel, 0.31, 0.24, 0.069], [m.glass, 0.235, 0.17, 0.077]]) {
    const map = (x, y) => coneMap(0, shift)(x, y).map((v, i) => v - hatchPivot[i]);
    polygon(hatch, finish, [map(-width / 2, 1.64), map(width / 2, 1.64),
      map(width / 2, 1.64 + height), map(-width / 2, 1.64 + height)]);
  }
  const handle = [coneMap(0, 0.087)(0.25, 1.34), coneMap(0, 0.087)(0.38, 1.34)];
  strut(hatch, m.steel, ...handle.map((point) => point.map((v, i) => v - hatchPivot[i])), 0.021);
  mount(hatch, 'mount_hinge', [0, 0, 0], [0, 1, -0.51]);
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'left' : 'right';
    capsuleWindow(node, `side_window_${suffix}`, side * rad(82), 1.3, 0.33, 0.25);
    capsuleWindow(node, `rendezvous_window_${suffix}`, side * rad(39), 2.1, 0.27, 0.31, true);
  }

  const tunnel = part(node, 'docking_tunnel', [0, 2.83, 0], { standalone: true });
  ring(tunnel, m.steel, 0.568, 0.457, 0, 0.61);
  ring(tunnel, m.bright, 0.596, 0.42, 0.61, cmDockY - 2.83);
  for (let i = 0; i < 12; i++) {
    const angle = i * tau / 12;
    box(tunnel, m.steel, [0.065, 0.031, 0.094], polar(0.526, angle, 0.631), yaw(angle));
  }
  return completeCommandModule(node, tunnel, recovery, docked);
}

function completeCommandModule(node, tunnel, recovery, docked) {
  const forwardHatch = hinge(tunnel, 'forward_hatch', [0.4, 0.365, 0], [0, 0, 1], rad(-85));
  forwardHatch.userData.standalone = true;
  cylinder(forwardHatch, m.aluminum, 0.407, -0.035, 0.011, [-0.4, 0, 0]);
  box(forwardHatch, m.steel, [0.16, 0.055, 0.04], [-0.37, 0.02, 0]);
  if (!recovery && !docked) {
    const probe = part(tunnel, 'probe', [0, 0.41, 0], { standalone: true });
    cylinder(probe, m.steel, 0.084, 0, 0.38);
    profile(probe, m.bright, [[0.123, 0.36], [0.102, 0.49], [0.015, 0.55], [0, 0.55]], { segments: 24 });
    for (let i = 0; i < 3; i++) {
      strut(probe, m.aluminum, polar(0.33, i * tau / 3, 0.005), [0, 0.27, 0], 0.025);
    }
    mount(probe, 'mount_probe', [0, 0, 0], [0, -1, 0]);
  }
  if (recovery) {
    deployedParachutes(node);
  } else {
    const cover = part(node, 'forward_cover', [0, 2.78, 0], { standalone: true });
    profile(cover, m.bright, [[0.695, 0], [0.737, 0], [0.711, 0.076], [0.661, 0.29],
      [0.611, 0.53], [0.585, 0.53], [0.65, 0.15], [0.695, 0]]);
    mount(cover, 'mount_forward_cover', [0, 0, 0], [0, -1, 0]);
    packedParachutes(node);
  }
  mount(node, 'dock_port', [0, cmDockY, 0]);
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  return node;
}

function serviceCutaway(parent) {
  const section = part(parent, 'cutaway', undefined, { role: 'cutaway' });
  for (const [i, angle] of [rad(-35), rad(40), rad(145), rad(228)].entries()) {
    const finish = i % 2 ? m.oxidizer : m.fuel;
    const tank = part(section, i % 2 ? `sps_oxidizer_${i}` : `sps_fuel_${i}`, polar(1.02, angle, 0.72));
    const height = i < 2 ? 2.98 : 3.69;
    profile(tank, finish, [[0, 0], [0.29, 0.073], [0.52, 0.28], [0.61, 0.58],
      [0.61, height - 0.62], [0.51, height - 0.28], [0.27, height - 0.07], [0, height]]);
    for (const y of [0.78, height - 0.71]) ring(tank, m.aluminum, 0.618, 0.58, y - 0.035, y + 0.035);
    strut(tank, m.steel, [0, 0.08, 0], [0, -0.44, 0], 0.07);
  }
  for (const [i, y] of [3.26, 3.75, 4.24].entries()) {
    const cell = part(section, `fuel_cell_${numbered(i)}`, [-1.14, y, 0.65]);
    box(cell, m.aluminum, [0.64, 0.38, 0.57], [0, 0, 0]);
    for (let j = -3; j <= 3; j++) box(cell, m.steel, [0.049, 0.31, 0.04], [j * 0.083, 0, 0.299]);
  }
  const reactants = part(section, 'reactant_tanks', [-1.12, 1.65, 0.58]);
  for (const [i, finish] of [m.lox, m.lh2].entries()) {
    ellipsoid(reactants, finish, [0, i * 0.84, 0], [0.35, 0.35, 0.35]);
    ring(reactants, m.steel, 0.357, 0.343, i * 0.84 - 0.03, i * 0.84 + 0.03);
  }
  cylinder(section, m.steel, 0.31, 0.18, smLength - 0.19);
  for (const y of [1.4, 3.42]) ellipsoid(section, m.aluminum, [0, y, 0], [0.37, 0.37, 0.37]);
}

export function reactionCluster(parent, name, pos, angle, scale = 1) {
  const node = part(parent, name, pos, { standalone: true, role: 'rcs' });
  node.quaternion.copy(yaw(angle));
  box(node, m.aluminum, [0.38 * scale, 0.39 * scale, 0.37 * scale], [0, 0, 0.16 * scale]);
  const jets = [
    [[0, 0.32, 0.24], [0, 1, 0]], [[0, -0.32, 0.24], [0, -1, 0]],
    [[0.36, 0, 0.24], [1, 0, 0]], [[-0.36, 0, 0.24], [-1, 0, 0]],
  ];
  for (const [i, [lip, direction]] of jets.entries()) {
    const nozzle = lateralNozzle(node, `nozzle_${numbered(i)}`, lip.map((v) => v * scale),
      direction, 0.105 * scale, 0.18 * scale);
    nozzle.userData.standalone = true;
  }
  mount(node, 'mount_rcs', [0, 0, 0], [0, 0, -1]);
  return node;
}

export function antennaDish(parent, id, xyz, direction, radius, depth, finish = m.aluminum) {
  const node = part(parent, id, xyz);
  node.quaternion.copy(orientY(direction));
  const inner = Array.from({ length: 11 }, (_, i) => [radius * i / 10, depth * (i / 10) ** 2]);
  profile(node, finish, [...inner].reverse(), { segments: 32 });
  profile(node, m.gray, inner.map(([r, y]) => [r, y - radius * 0.035]), { segments: 32 });
  ring(node, m.steel, radius * 1.008, radius * 0.986, depth - radius * 0.027, depth + radius * 0.014,
    { segments: 32 });
  for (const angle of [0, tau / 3, 2 * tau / 3]) {
    strut(node, m.steel, polar(radius * 0.92, angle, depth * 0.83), [0, depth + radius * 0.22, 0],
      radius * 0.021, 6);
  }
  ellipsoid(node, m.enamel, [0, depth + radius * 0.22, 0], [radius * 0.12, radius * 0.17, radius * 0.12]);
  return node;
}

function highGain(parent, stowed) {
  const node = hinge(parent, 'high_gain_antenna', [0, 0.09, -1.53], [1, 0, 0], rad(99), Number(!stowed));
  node.userData.standalone = true;
  const wrist = [0, -1.59, 0.04];
  strut(node, m.aluminum, [0, 0, 0], wrist, 0.057);
  cylinder(node, m.steel, 0.097, -0.23, 0.01);
  const frame = hinge(node, 'reflector_frame', wrist, [1, 0, 0], rad(-90), Number(!stowed));
  ellipsoid(frame, m.steel, [0, 0, 0], [0.115, 0.09, 0.11]);
  for (const [index, [x, y]] of [[-0.45, -0.43], [0.45, -0.43], [-0.45, 0.43], [0.45, 0.43]].entries()) {
    const hub = [x, y, 0];
    strut(frame, m.steel, [0, 0, 0], hub, 0.039);
    antennaDish(frame, `reflector_${numbered(index)}`, hub, [0, 0, -1], 0.412, 0.114);
  }
  mount(node, 'mount_hinge', [0, 0, 0], [1, 0, 0]);
}

export function serviceModule({ cutaway = false, stowed = false } = {}) {
  const node = group('apollo_sm');
  const panelStart = cutaway ? rad(62) : 0;
  const panelSweep = cutaway ? rad(236) : tau;
  const panelCount = cutaway ? 4 : 6;
  for (let i = 0; i < panelCount; i++) {
    const panel = part(node, `panel_${numbered(i)}`);
    const start = panelStart + i * panelSweep / panelCount;
    const sweep = panelSweep / panelCount;
    skin(panel, i % 3 ? m.aluminum : m.enamel, cmRadius, cmRadius, 0.06, smLength - 0.06,
      { start: start + rad(0.11), sweep: sweep - rad(0.22), segments: 16 });
    strut(panel, m.steel, polar(cmRadius - 0.009, start, 0.08),
      polar(cmRadius - 0.009, start, smLength - 0.06), 0.017, 6);
  }
  for (const y of [0, smLength - 0.11]) {
    ring(node, m.steel, cmRadius + 0.003, 0.34, y, y + 0.11,
      { start: panelStart, sweep: panelSweep, segments: 72 });
  }
  for (const [i, angle] of [rad(-49), rad(48), rad(139), rad(228)].entries()) {
    if (!cutaway || (angle > panelStart && angle < panelStart + panelSweep)) {
      reactionCluster(node, `rcs_${numbered(i)}`, polar(cmRadius - 0.037, angle, 3.97), angle);
    }
  }
  for (const angle of [rad(99), rad(259)]) {
    const radiator = part(node, `radiator_${Math.round(angle * 180 / Math.PI)}`);
    for (let i = 0; i < 9; i++) {
      const y = 0.39 + i * 0.17;
      skin(radiator, m.enamel, cmRadius + 0.009, cmRadius + 0.009, y, y + 0.137,
        { start: angle - rad(22), sweep: rad(44), segments: 14 });
    }
  }
  if (!cutaway) {
    const map = (x, y) => polar(cmRadius + 0.021, x / cmRadius, y);
    flag(node, 0.8, 0.48, (x, y) => map(x - 0.4, y + 3.16));
    label(node, m.red, 'UNITED STATES', 0.15, (x, y) => map(x - 0.82, y + 2.89));
  }
  const sps = part(node, 'sps', [0, 0.1, 0], { standalone: true, engineType: 'SPS', role: 'engine' });
  const nozzle = part(sps, 'nozzle', [0, -2.17, 0]);
  bell(nozzle, 1.24, 2.01, m.nickel, 64);
  cylinder(sps, m.steel, 0.56, -0.37, 0.15);
  mount(sps, 'mount_gimbal', [0, 0, 0]);
  highGain(node, stowed);
  if (cutaway) serviceCutaway(node);
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  mount(node, 'mount_forward', [0, smLength, 0]);
  return node;
}

export function columbia(pose = 'orbit') {
  const node = group('columbia_csm');
  node.add(serviceModule({ stowed: pose === 'launch' }), commandModule(pose));
  node.children[1].position.y = smLength;
  return node;
}

export function launchEscape() {
  const node = group('launch_escape');
  const cover = part(node, 'bpc', undefined, { standalone: true });
  profile(cover, m.white, [[cmRadius + 0.04, 0.2], [cmRadius + 0.047, 0.35],
    [0.74, 2.86], [0.605, 3.36], [0.33, 3.88]], { segments: 96 });
  skin(cover, m.gray, 0.321, cmRadius - 0.01, 3.88, 0.2, { segments: 96 });
  ring(cover, m.aluminum, cmRadius + 0.054, cmRadius - 0.019, 0.2, 0.256);
  mount(cover, 'mount_bpc', [0, 0.2, 0], [0, -1, 0]);

  const truss = part(node, 'tower_truss');
  const a = rad(45);
  for (const angle of quadrants.map((v) => v + a)) {
    strut(truss, m.enamel, polar(0.63, angle, 3.36), polar(0.317, angle, 6.68), 0.049, 12);
    for (const [y0, y1] of [[3.89, 4.78], [4.78, 5.69], [5.69, 6.57]]) {
      const r = (y) => 0.63 - 0.313 * (y - 3.36) / 3.32;
      strut(truss, m.enamel, polar(r(y0), angle, y0), polar(r(y1), angle + Math.PI / 2, y1), 0.033);
      strut(truss, m.enamel, polar(r(y1), angle, y1), polar(r(y1), angle + Math.PI / 2, y1), 0.031);
    }
  }
  const motor = part(node, 'escape_motor', [0, 6.62, 0], { standalone: true });
  profile(motor, m.white, [[0.31, 0], [0.37, 0.19], [0.315, 0.43], [0.315, 3.1],
    [0.29, 3.46], [0.21, 3.98], [0.11, 4.4], [0, stack.tip - stack.launch_escape - 6.62]]);
  for (const [i, angle] of quadrants.entries()) {
    const [x, , z] = polar(0.5, angle);
    lateralNozzle(motor, `escape_jet_${numbered(i)}`, [x, 0.05, z], [x, -1, z], 0.165, 0.29);
  }
  lateralNozzle(motor, 'jettison_jet_01', [0.37, 2.24, 0], [0.85, -0.28, 0], 0.074, 0.19);
  lateralNozzle(motor, 'jettison_jet_02', [-0.37, 2.24, 0], [-0.85, -0.28, 0], 0.074, 0.19);
  lateralNozzle(motor, 'pitch_jet', [0.25, 3.89, 0], [1, 0, 0], 0.062, 0.13);
  for (const [index, side] of [-1, 1].entries()) {
    const vane = hinge(motor, `canard_${numbered(index)}`, [0, 3.45, side * 0.24], [1, 0, 0], -side * rad(65));
    box(vane, m.enamel, [0.21, 0.56, 0.054], [0, 0.29, 0]);
  }
  mount(node, 'mount_capsule', [0, 0, 0], [0, -1, 0]);
  return node;
}
