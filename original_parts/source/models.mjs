import * as T from 'three';
import { X, Y, Z, m, tau, num, neg, node, mount, polar, yaw, rot, mesh, lathe, cylinder, ring, box,
  rod, bell, sphere, solar } from './geometry.mjs';

const finish = (name, color, metalness = 0.15, roughness = 0.52) => (
  new T.MeshStandardMaterial({ name, color, metalness, roughness })
);

const paint = {
  ivory: finish('JUGRE · bone ceramic', 0xe3e0d4),
  graphite: finish('JUGRE · graphite composite', 0x25323b, 0.22),
  steel: finish('JUGRE · bead-blasted titanium', 0x89949a, 0.52),
  copper: finish('JUGRE · heat-resistant copper', 0x9c6240, 0.48),
  orange: finish('JUGRE · oxide orange', 0xdd632c),
  teal: finish('JUGRE · signal teal', 0x197e81),
  glass: finish('JUGRE · blue viewport', 0x1a4259, 0.35, 0.19),
};

function port(parent, id, xyz, direction, profile, role, extra = {}) {
  const result = mount(parent, `mount_${id}`, xyz, direction);
  const outward = new T.Vector3(...direction).normalize();
  const reference = new T.Vector3(...(Math.abs(outward.y) > 0.9 ? Z : Y));
  const right = new T.Vector3().crossVectors(reference, outward).normalize();
  const up = new T.Vector3().crossVectors(outward, right);
  result.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, outward));
  Object.assign(result.userData, { profile, attachmentRole: role, ...extra });
  return result;
}

function axial(parent, id, at, direction, diameter, role = 'structure', extra) {
  const xyz = typeof at === 'number' ? [0, at, 0] : at;
  return port(parent, id, xyz, direction, `jugre_stack_${Math.round(diameter * 100)}`, role,
    { nominalDiameterM: diameter, ...extra });
}

function stack(parent, height, aft, forward = aft) {
  axial(parent, 'aft', 0, neg(Y), aft);
  axial(parent, 'forward', height, Y, forward);
}

function radial(parent, id, xyz, direction, role = 'component') {
  return port(parent, id, xyz, direction, 'jugre_radial', role);
}

function pivot(parent, id, xyz, axis, limit) {
  return node(id, parent, xyz, { role: 'hinge', axis, ...(limit === undefined ? {} : { maxDeflectionDeg: limit }) });
}

function animated(pivot, axis, angles, time = [0, 1]) {
  return new T.QuaternionKeyframeTrack(`${pivot.uuid}.quaternion`, time, angles.flatMap((radians) => rot(axis, radians).toArray()));
}

function outline(parent, points, thickness, material, position, quaternion) {
  const shape = new T.Shape();
  for (const [i, [x, y]] of points.entries()) {
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -thickness / 2);
  return mesh(parent, geometry, material, position, quaternion);
}

function fasteners(parent, radius, y, count, size, mat = paint.steel) {
  for (let i = 0; i < count; i++) {
    cylinder(parent, mat, size, y, y + size * 0.51, polar(radius, i * tau / count), 6);
  }
}

function flange(parent, radius, inner, low, high, count = 16) {
  const size = (radius - inner) * 0.11;
  const surface = high - size * 0.51;
  const rimBase = surface - (surface - low) * 0.27;
  ring(parent, paint.graphite, radius, inner, low, rimBase);
  ring(parent, paint.steel, radius, inner, rimBase, surface);
  fasteners(parent, (radius + inner) / 2, surface, count, size);
}

function sideBadge(parent, radius, y, width, height, color, angle = 0) {
  const badge = node(`mark_${String(angle).replace('.', '_')}`, parent, polar(radius, angle, y));
  badge.quaternion.copy(yaw(angle));
  box(badge, paint.graphite, [width, height, 0.016]);
  const stroke = width * 0.08;
  for (let i = 0; i < 3; i++) box(badge, color, [stroke, height * 0.58, 0.004], [-width * 0.31 + i * width * 0.16, 0, 0.009], rot(Z, -0.33));
  box(badge, paint.ivory, [width * 0.24, height * 0.11, 0.005], [width * 0.25, -height * 0.22, 0.01]);
  box(badge, color, [width * 0.12, height * 0.1, 0.005], [width * 0.29, height * 0.22, 0.01]);
}

const engineShapes = {
  k_35_iskra: { deck: 0.34, bell: 0.25, length: 0.46, body: 0.28, chamber: 0.31, pipes: 2, color: paint.teal, heat: paint.copper },
  k_125_klen: { deck: 0.41, bell: 0.44, length: 0.73, body: 0.49, chamber: 0.34, pipes: 3, color: paint.orange, heat: m.nickel },
  k_420_kedr: { deck: 0.78, bell: 0.92, length: 1.24, body: 0.81, chamber: 0.63, pipes: 4, color: paint.orange, heat: paint.copper },
  k_155v_dalniy: { deck: 0.41, bell: 0.61, length: 1.21, body: 0.37, chamber: 0.35, pipes: 2, color: paint.teal, heat: paint.steel },
};

function mainEngine(spec) {
  const shape = engineShapes[spec.id];
  const { deck, length, body, chamber, pipes, color, heat } = shape;
  const root = node(spec.id);
  const head = node('upper_hardware', root);
  flange(head, deck, deck * 0.67, -deck * 0.22, -0.008);
  cylinder(head, paint.ivory, deck * 0.81, -body * 0.47, -deck * 0.14, undefined, 32);
  cylinder(head, paint.graphite, deck * 0.53, -body * 0.84, -body * 0.43, undefined, 28, deck * 0.81);
  ring(head, color, deck * 0.825, deck * 0.802, -body * 0.44, -body * 0.32);
  sideBadge(head, deck * 0.815, -body * 0.31, deck * 0.86, body * 0.18, color);
  for (let i = 0; i < pipes; i++) {
    const angle = i * tau / pipes + 0.7;
    const a = polar(deck * 0.57, angle, -body * 0.14);
    const b = polar(deck * 0.86, angle, -body * 0.53);
    const c = polar(deck * 0.74, angle + 0.31, -body - chamber * 0.39);
    rod(head, paint.steel, a, b, deck * 0.052);
    rod(head, i % 2 ? paint.copper : paint.steel, b, c, deck * 0.049);
    sphere(head, paint.graphite, [deck * 0.078, deck * 0.069, deck * 0.075], b, 10);
    const pump = node(`pump_${num(i)}`, head, polar(deck * 0.64, angle, -body * 0.53));
    pump.quaternion.copy(yaw(angle));
    box(pump, paint.graphite, [deck * 0.36, body * 0.32, deck * 0.42]);
    box(pump, color, [deck * 0.24, body * 0.16, deck * 0.15], [0, 0, deck * 0.22]);
  }
  const gimbal = pivot(root, 'gimbal_pitch', [0, -body, 0], X);
  const swivel = pivot(gimbal, 'gimbal_yaw', [0, 0, 0], Z);
  cylinder(swivel, paint.graphite, deck * 0.46, -chamber, 0, undefined, 24, deck * 0.55);
  for (const f of [0.18, 0.67]) ring(swivel, paint.steel, deck * 0.50, deck * 0.45, -chamber * f, -chamber * f + chamber * 0.065);
  const nozzle = node('nozzle', swivel, [0, -chamber - length, 0]);
  bell(nozzle, shape.bell, length, heat);
  if (spec.id === 'k_155v_dalniy') {
    ring(nozzle, paint.graphite, shape.bell * 1.016, shape.bell * 0.955, 0.012, 0.083);
    for (let i = 0; i < 12; i++) {
      const a = i * tau / 12;
      rod(nozzle, paint.graphite, polar(shape.bell * 0.984, a, 0.036), polar(shape.bell * 0.864, a, length * 0.18), 0.012);
    }
  }
  axial(root, 'engine', 0, Y, spec.stats.mountDiameterM, 'engine');
  return root;
}

function coldGas(spec) {
  const root = node(spec.id);
  box(root, paint.graphite, [0.26, 0.19, 0.073], [0, 0, 0.039]);
  box(root, paint.teal, [0.20, 0.122, 0.097], [0, 0, 0.091]);
  const nozzle = node('nozzle', root, [0, 0, 0.264]);
  nozzle.quaternion.copy(rot(X, -Math.PI / 2));
  bell(nozzle, 0.072, 0.142, paint.steel);
  for (const x of [-0.10, 0.10]) {
    rod(root, paint.steel, [x, -0.065, 0.076], [x, 0.066, 0.076], 0.018, 6);
    rod(root, paint.copper, [x, -0.053, 0.105], [x * 0.51, -0.02, 0.162], 0.012);
  }
  radial(root, 'rail', [0, 0, 0], neg(Z), 'thruster');
  return root;
}

function radialRails(parent, radius, levels, braceWidth) {
  for (const [i, y] of levels.entries()) {
    for (let index = 0; index < 4; index++) {
      const angle = index * tau / 4;
      const socket = node(`rail_${i + 1}_${num(index)}`, parent, polar(radius, angle, y));
      socket.quaternion.copy(yaw(angle));
      box(socket, paint.graphite, [braceWidth, 0.21, 0.045], [0, 0, -0.008]);
      for (const x of [-0.32, 0.32]) box(socket, paint.steel, [0.021, 0.158, 0.026], [braceWidth * x, 0, 0.019]);
      radial(parent, `radial_${i + 1}_${num(index)}`, polar(radius + 0.032, angle, y), polar(1, angle), 'host');
    }
  }
}

const tankLooks = {
  b_12_sota: { ribs: 2, signal: paint.teal, shell: paint.ivory, topBand: 0.18 },
  b_32_stvol: { ribs: 4, signal: paint.teal, shell: paint.ivory, topBand: 0.31 },
  b_140_bochka: { ribs: 3, signal: paint.orange, shell: paint.ivory, topBand: 0.29 },
  b_240_rezerv: { ribs: 6, signal: paint.orange, shell: paint.ivory, topBand: 0.43 },
};

function mainTank(spec) {
  const { mountDiameterM: diameter, heightM: height } = spec.stats;
  const { ribs, shell, signal, topBand } = tankLooks[spec.id];
  const root = node(spec.id);
  const r = diameter / 2;
  const collar = Math.min(0.14, height * 0.076);
  const skin = node('pressure_shell', root);
  lathe(skin, shell, [[r * 0.83, collar * 0.44], [r * 0.97, collar], [r, collar * 1.62],
    [r, height - collar * 1.62], [r * 0.97, height - collar], [r * 0.83, height - collar * 0.44]], { segments: 64 });
  for (const y of [0, height - collar]) flange(root, r * 0.97, r * 0.79, y, y + collar, diameter > 2 ? 24 : 16);
  for (let i = 0; i < ribs; i++) {
    const y = collar * 1.9 + (height - collar * 3.8) * (i + 1) / (ribs + 1);
    ring(skin, paint.steel, r * 1.007, r * 0.994, y, y + 0.021, { segments: 64 });
  }
  const bandY = height - topBand - collar * 1.83;
  for (const [start, sweep] of [[0.23, 1.08], [2.1, 1.23], [4.0, 1.89]]) {
    lathe(skin, signal, [[r * 1.0018, bandY], [r * 1.0018, bandY + topBand]], { start, sweep, segments: 24 });
  }
  for (const angle of [0.65, Math.PI + 0.65]) {
    const line = node(`feedline_${angle < 1 ? 'a' : 'b'}`, root);
    rod(line, paint.graphite, polar(r * 0.985, angle, collar), polar(r * 1.014, angle, collar * 1.83), r * 0.027);
    rod(line, paint.graphite, polar(r * 1.014, angle, collar * 1.83), polar(r * 1.014, angle, height - collar * 2.04), r * 0.027);
    for (const f of [0.27, 0.61, 0.8]) box(line, paint.steel, [r * 0.09, 0.07, r * 0.059], polar(r * 1.032, angle, height * f), yaw(angle));
  }
  sideBadge(root, r * 1.004, height * 0.58, r * 0.63, 0.13, signal, 0.32);
  radialRails(root, r, [height * 0.20, height * 0.73], Math.min(0.30, r * 0.48));
  stack(root, height, diameter);
  return root;
}

function pressureVessel(spec) {
  const root = node(spec.id);
  box(root, paint.graphite, [0.83, 0.46, 0.078], [0, 0, 0.04]);
  for (const [i, x] of [-0.264, 0.264].entries()) {
    const bottle = node(`vessel_${num(i)}`, root, [x, 0, 0.265]);
    const profile = [[0, -0.26], [0.10, -0.252], [0.183, -0.195], [0.217, -0.137],
      [0.217, 0.121], [0.197, 0.178], [0.132, 0.216], [0.055, 0.231], [0, 0.231]];
    lathe(bottle, paint.ivory, profile, { segments: 40 });
    cylinder(bottle, paint.steel, 0.054, 0.203, 0.26, undefined, 8);
    for (const y of [-0.126, 0.091]) ring(bottle, paint.teal, 0.224, 0.216, y, y + 0.065);
  }
  rod(root, paint.copper, [-0.264, 0.229, 0.265], [0.264, 0.229, 0.265], 0.022);
  box(root, paint.graphite, [0.196, 0.095, 0.095], [0, 0.177, 0.27]);
  cylinder(root, paint.steel, 0.041, 0.212, 0.249, [0, 0, 0.274], 8);
  radial(root, 'rail', [0, 0, 0], neg(Z), 'tank');
  return root;
}

function enginePlate(spec) {
  const root = node(spec.id);
  const r = 1.25;
  const height = 0.32;
  flange(root, r, 1.105, 0, height, 28);
  for (let i = 0; i < 3; i++) {
    const a = i * tau / 3;
    const [x, , z] = polar(0.62, a);
    const seat = node(`engine_seat_${num(i)}`, root, [x, 0, z]);
    flange(seat, 0.443, 0.312, 0, 0.092, 12);
    ring(seat, paint.orange, 0.458, 0.437, 0.071, 0.102);
    for (const offset of [-0.4, 0.4]) {
      rod(root, paint.steel, [x, 0.10, z], polar(1.132, a + offset, 0.24), 0.065, 8);
    }
    axial(root, `engine_${num(i)}`, [x, 0, z], neg(Y), 1.25, 'engineReceiver', { acceptsParts: [spec.stats.compatibleEngineId] });
  }
  for (let i = 0; i < 3; i++) {
    const angle = (i + 0.5) * tau / 3;
    const arm = node(`web_${num(i)}`, root, polar(0.71, angle, 0.164));
    arm.quaternion.copy(yaw(angle));
    box(arm, paint.graphite, [0.126, 0.15, 0.83]);
    box(arm, paint.steel, [0.17, 0.028, 0.79], [0, 0.074, 0]);
  }
  axial(root, 'forward', height, Y, 2.5);
  return root;
}

function cone(spec) {
  const { heightM: h, forwardDiameterM: forward, aftDiameterM: aft } = spec.stats;
  const root = node(spec.id);
  const profile = [[0.597, 0.038], [0.62, 0.071], [1.232, h - 0.102], [1.25, h - 0.056],
    [1.211, h - 0.056], [1.187, h - 0.105], [0.577, 0.069], [0.552, 0.038], [0.597, 0.038]];
  lathe(root, paint.ivory, profile, { segments: 64 });
  flange(root, aft / 2, aft / 2 - 0.08, 0, 0.076, 18);
  flange(root, forward / 2, forward / 2 - 0.09, h - 0.062, h, 28);
  for (let i = 0; i < 12; i++) {
    const a = i * tau / 12;
    rod(root, i % 3 === 0 ? paint.orange : paint.graphite, polar(0.632, a, 0.082), polar(1.224, a, h - 0.109), 0.018, 8);
  }
  stack(root, h, aft, forward);
  return root;
}

function separator(spec) {
  const { heightM: h, mountDiameterM: diameter } = spec.stats;
  const root = node(spec.id);
  const r = diameter / 2;
  const upper = node('retained_ring', root);
  const lower = node('release_ring', root);
  flange(lower, r, r * 0.81, 0, h * 0.38);
  flange(upper, r, r * 0.81, h * 0.61, h);
  ring(root, paint.orange, r * 0.972, r * 0.88, h * 0.35, h * 0.65);
  const latchCount = diameter > 2 ? 12 : 8;
  for (let i = 0; i < latchCount; i++) {
    const angle = i * tau / latchCount;
    box(upper, paint.steel, [r * 0.17, h * 0.37, 0.039], polar(r * 0.986, angle, h * 0.65), yaw(angle));
    box(lower, paint.graphite, [r * 0.12, h * 0.19, 0.04], polar(r * 0.986, angle, h * 0.29), yaw(angle));
  }
  axial(lower, 'aft', 0, neg(Y), diameter);
  axial(upper, 'forward', h, Y, diameter);
  return root;
}

function sideLatch(spec) {
  const root = node(spec.id);
  const host = node('host_plate', root);
  box(host, paint.graphite, [0.31, 0.56, 0.072], [0, 0, 0.036]);
  const release = node('release_plate', root);
  box(release, paint.steel, [0.30, 0.47, 0.071], [0, 0, 0.249]);
  for (const side of [-1, 1]) {
    const clamp = node(`clamp_${side < 0 ? 'l' : 'r'}`, root, [0.092 * side, 0, 0.086]);
    box(clamp, paint.orange, [0.09, 0.36, 0.177]);
    for (const y of [-0.139, 0.139]) rod(clamp, paint.steel, [0, y, -0.018], [0, y, 0.141], 0.041, 10);
    box(release, paint.graphite, [0.045, 0.20, 0.038], [0.082 * side, 0, 0.272]);
  }
  radial(host, 'host', [0, 0, 0], neg(Z), 'adapter');
  radial(release, 'booster', [0, 0, 0.291], Z, 'boosterReceiver');
  return root;
}

function surfaceBase(root, height, width, depth, color) {
  box(root, paint.graphite, [width, height, depth], [0, 0, depth / 2]);
  box(root, color, [width * 0.76, height * 0.82, depth * 0.27], [0, 0, depth * 0.93]);
  for (const y of [-height * 0.34, height * 0.34]) rod(root, paint.steel, [-width * 0.55, y, depth * 0.58],
    [width * 0.55, y, depth * 0.58], width * 0.15, 10);
  radial(root, 'rail', [0, 0, 0], neg(Z), 'surface');
}

const finProfiles = {
  s_22_pero: { shape: [[0, -0.30], [0, 0.34], [0.43, -0.005], [0.49, -0.22], [0.35, -0.31]], thickness: 0.033, face: paint.graphite, accent: paint.teal },
  s_65_kil: { shape: [[0, -0.47], [0, 0.52], [0.82, 0.038], [0.93, -0.19], [0.76, -0.39]], thickness: 0.058, face: paint.ivory, accent: paint.orange },
  r_42_lopast: { shape: [[0, -0.37], [0, 0.32], [0.68, 0.128], [0.78, -0.099], [0.59, -0.32]], thickness: 0.055, face: paint.steel, accent: paint.teal },
};

function fin(spec) {
  const root = node(spec.id);
  const { shape, thickness, face, accent } = finProfiles[spec.id];
  const area = Math.abs(shape.reduce((sum, [x, y], i) => {
    const next = shape[(i + 1) % shape.length];
    return sum + x * next[1] - y * next[0];
  }, 0)) / 2;
  const profile = shape.map(([z, y]) => [z * spec.stats.areaM2 / area, y]);
  const cap = 0.087;
  const sweep = rot(Y, -Math.PI / 2);
  surfaceBase(root, (shape[1][1] - shape[0][1]) * 0.88, thickness * 2.6, cap, accent);
  const blade = spec.stats.maxDeflectionDeg
    ? pivot(root, 'deflection', [0, 0, cap], Z, spec.stats.maxDeflectionDeg)
    : node('blade', root, [0, 0, cap]);
  outline(blade, profile, thickness, face, [0, 0, 0], sweep);
  for (const sign of [-1, 1]) {
    const stripe = profile.map(([z, y]) => [z * 0.32 + profile[2][0] * 0.49, y * 0.62 - 0.02]);
    outline(blade, stripe, 0.004, accent, [sign * (thickness / 2 + 0.002), 0, 0], sweep);
  }
  for (const [i, [z, y]] of profile.entries()) {
    const [nextZ, nextY] = profile[(i + 1) % profile.length];
    rod(blade, paint.graphite, [0, y, z], [0, nextY, nextZ], thickness * 0.42, 7);
  }
  return root;
}

function gridFin(spec) {
  const root = node(spec.id);
  surfaceBase(root, 0.26, 0.32, 0.118, paint.orange);
  const fold = pivot(root, 'deployment', [0, 0, 0.135], X);
  const hinge = pivot(fold, 'deflection', [0, 0, 0.124], Z, spec.stats.maxDeflectionDeg);
  rod(fold, paint.steel, [-0.162, 0, 0], [0.162, 0, 0], 0.053, 20);
  rod(fold, paint.graphite, [0, 0, 0.022], [0, 0, 0.154], 0.054);
  const width = 0.70;
  const length = spec.stats.areaM2 / width;
  for (let i = 0; i <= 7; i++) box(hinge, i === 0 || i === 7 ? paint.orange : paint.steel,
    [0.063, i === 0 || i === 7 ? 0.044 : 0.019, length], [0, (i / 7 - 0.5) * width, length / 2]);
  for (let i = 0; i <= 8; i++) box(hinge, i === 0 || i === 8 ? paint.orange : paint.steel,
    [0.063, width, i === 0 || i === 8 ? 0.044 : 0.018], [0, 0, i * length / 8]);
  return { root, clips: [new T.AnimationClip('deployment', 1, [animated(fold, X, [-Math.PI / 2, 0])])] };
}

function solarWing(spec) {
  const root = node(spec.id);
  surfaceBase(root, 0.37, 0.52, 0.113, paint.teal);
  const hinge = pivot(root, 'deployment', [0, 0, 0.143], X);
  rod(hinge, paint.steel, [-0.28, 0, 0], [0.28, 0, 0], 0.056, 16);
  const panelWidth = 1.5;
  const panelLength = spec.stats.areaM2 / panelWidth / 2;
  for (const side of [-1, 1]) rod(hinge, paint.steel, [side * 0.19, 0, 0.03], [side * 0.39, 0, 0.25], 0.030);
  const leaf1 = node('inner_leaf', hinge, [0, 0, 0.24]);
  const leaf2 = pivot(leaf1, 'panel_fold', [0, 0.063, panelLength + 0.014], X);
  for (const leaf of [leaf1, leaf2]) {
    const cells = node('cells', leaf, [0, 0, panelLength / 2]);
    solar(cells, panelWidth, panelLength, 12, 15);
    for (const sign of [-1, 1]) {
      box(cells, paint.graphite, [0.036, 0.044, panelLength], [sign * (panelWidth / 2 - 0.015), 0, 0]);
      box(cells, paint.teal, [panelWidth, 0.043, 0.042], [0, 0, sign * (panelLength / 2 - 0.012)]);
    }
    box(cells, paint.graphite, [0.145, 0.034, panelLength * 0.72], [0, -0.025, 0]);
  }
  return { root, clips: [new T.AnimationClip('deployment', 1.4, [
    animated(hinge, X, [-Math.PI / 2, 0, 0], [0, 0.7, 1.4]),
    animated(leaf2, X, [Math.PI, Math.PI, 0], [0, 0.55, 1.4]),
  ])] };
}

function capsule(spec) {
  const root = node(spec.id);
  const hull = node('pressure_hull', root);
  lathe(hull, paint.ivory, [[1.25, 0.19], [1.25, 0.22], [1.196, 0.43], [1.075, 0.73], [0.878, 1.18],
    [0.70, 1.56], [0.55, 1.83], [0.43, 1.98], [0.365, 2.05]], { segments: 64 });
  flange(root, 1.25, 1.032, 0, 0.19, 32);
  lathe(hull, paint.orange, [[1.254, 0.198], [1.254, 0.22], [1.245, 0.257]], { segments: 64 });
  lathe(hull, paint.graphite, [[0.964, 1.003], [0.886, 1.18], [0.757, 1.455]], { start: -0.96, sweep: 1.92, segments: 32 });
  const tilt = rot(X, -0.415);
  for (const [i, angle] of [-0.39, 0.39].entries()) {
    const frame = node(`viewport_${num(i)}`, root, polar(0.936, angle, 1.115));
    frame.quaternion.copy(yaw(angle).multiply(tilt));
    const shape = [[-0.21, -0.16], [0.22, -0.14], [0.17, 0.10], [-0.126, 0.13]];
    outline(frame, shape, 0.046, paint.graphite, [0, 0, 0.006]);
    outline(frame, shape.map(([x, y]) => [x * 0.83, y * 0.76]), 0.025, paint.glass, [0, 0, 0.037]);
  }
  const door = pivot(root, 'crew_hatch', [0.957, 0.76, -0.62], Y);
  const panel = node('skin', door, [0, 0, 0]);
  panel.quaternion.copy(yaw(2.145).multiply(tilt));
  const doorShape = [[-0.22, -0.34], [0.22, -0.34], [0.262, -0.28], [0.234, 0.27], [0.155, 0.34], [-0.18, 0.33]];
  outline(panel, doorShape, 0.043, paint.graphite, [0, 0, 0.055]);
  outline(panel, doorShape.map(([x, y]) => [x * 0.85, y * 0.86]), 0.025, paint.ivory, [0, 0, 0.078]);
  box(panel, paint.orange, [0.15, 0.032, 0.033], [0.076, -0.03, 0.101]);
  for (const y of [-0.22, 0.22]) rod(panel, paint.steel, [-0.20, y - 0.06, 0.098], [-0.20, y + 0.059, 0.098], 0.028);
  for (const [i, a] of [0.87, 2.25, 3.71, 5.45].entries()) {
    const panel = node(`service_panel_${num(i)}`, root, polar(1.16, a, 0.48));
    panel.quaternion.copy(yaw(a).multiply(tilt));
    box(panel, paint.steel, [0.21, 0.20, 0.034]);
    for (const y of [-0.048, 0.004, 0.055]) box(panel, paint.graphite, [0.15, 0.014, 0.007], [0, y, 0.018]);
  }
  flange(root, 0.408, 0.31, 1.99, 2.06, 12);
  cylinder(root, paint.graphite, 0.32, 1.988, 2.035);
  sideBadge(root, 1.16, 0.50, 0.25, 0.15, paint.orange, 0.19);
  axial(root, 'aft', 0, neg(Y), spec.stats.mountDiameterM);
  port(root, 'recovery', [0, 2.06, 0], Y, 'jugre_recovery', 'recoveryReceiver');
  return root;
}

function avionics(spec) {
  const root = node(spec.id);
  const r = 0.625;
  const h = 0.30;
  flange(root, r, 0.53, 0, 0.059);
  flange(root, r, 0.53, h - 0.052, h);
  cylinder(root, paint.graphite, 0.534, 0.04, 0.26, undefined, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * tau / 8;
    const pod = node(`avionics_bay_${num(i)}`, root, polar(0.504, a, 0.15));
    pod.quaternion.copy(yaw(a));
    box(pod, i % 2 === 0 ? paint.ivory : paint.steel, [0.318, 0.148, 0.055]);
    box(pod, paint.teal, [0.063, 0.086, 0.015], [-0.098, 0, 0.037]);
    for (const x of [0, 0.041, 0.082]) box(pod, paint.graphite, [0.015, 0.045, 0.013], [x, 0.015, 0.033]);
  }
  cylinder(root, paint.teal, 0.32, 0.035, h - 0.012, undefined, 12);
  stack(root, h, spec.stats.mountDiameterM);
  return root;
}

function shelf(spec) {
  const root = node(spec.id);
  const r = 0.625;
  const h = 0.47;
  flange(root, r, 0.514, 0, 0.067);
  flange(root, r, 0.507, h - 0.068, h);
  for (let i = 0; i < spec.stats.payloadMounts; i++) {
    const a = (i + 0.5) * tau / 4;
    const beam = node(`brace_${num(i)}`, root, polar(0.515, a));
    beam.quaternion.copy(yaw(a));
    rod(beam, paint.steel, [-0.06, 0.064, 0], [0.081, h - 0.049, 0], 0.032, 8);
    rod(beam, paint.graphite, [0.08, 0.061, 0.042], [-0.06, h - 0.05, 0.042], 0.021, 8);
    const plate = node(`payload_plate_${num(i)}`, root, polar(0.451, a, h - 0.066));
    plate.quaternion.copy(yaw(a));
    box(plate, paint.teal, [0.167, 0.072, 0.199], [0, 0.026, 0]);
    port(root, `payload_${num(i)}`, polar(0.451, a, h), Y, 'jugre_equipment', 'payloadReceiver');
  }
  axial(root, 'aft', 0, neg(Y), spec.stats.mountDiameterM);
  return root;
}

const fairing = { height: 2.76, baseHeight: 0.27, pinRadius: 1.106, thickness: 0.037 };

function fairingBase(spec) {
  const root = node(spec.id);
  const h = fairing.baseHeight;
  flange(root, 1.25, 1.047, 0, h, 28);
  lathe(root, paint.ivory, [[1.213, 0.063], [1.252, 0.108], [1.252, 0.174], [1.224, 0.205]], { segments: 64 });
  for (const [name, side] of [['left', -1], ['right', 1]]) {
    const latch = node(`latch_${name}`, root, [side * fairing.pinRadius, h - 0.055, 0]);
    box(latch, paint.orange, [0.129, 0.109, 0.29]);
    for (const z of [-0.09, 0.09]) rod(latch, paint.steel, [0, 0.039, z], [0, 0.058, z], 0.039, 8);
    port(root, `shell_${name}`, [side * fairing.pinRadius, h, 0], Y, `jugre_fairing_250_${name}`, 'shellReceiver');
  }
  stack(root, h, spec.stats.mountDiameterM);
  return root;
}

function fairingShell(spec) {
  const root = node(spec.id);
  const side = spec.stats.side === 'left' ? -1 : 1;
  const skin = node('shell', root, [-side * fairing.pinRadius, 0, 0]);
  const r = spec.stats.outerDiameterM / 2;
  const profile = [[r - 0.012, 0], [r, 0.16], [r, 1.52], [1.224, 1.75], [1.172, 1.93],
    [0.954, 2.24], [0.557, 2.53], [0.22, 2.69], [0, fairing.height]];
  const start = side < 0 ? Math.PI : 0;
  const half = { start, sweep: Math.PI, segments: 40 };
  lathe(skin, paint.ivory, profile, half);
  lathe(skin, paint.steel, [...profile].reverse().map(([r, y]) => [Math.max(0, r - fairing.thickness), y]), half);
  for (const z of [-1, 1]) {
    for (let i = 0; i < profile.length - 1; i++) {
      const [a, y] = profile[i];
      const [b, nextY] = profile[i + 1];
      rod(skin, paint.graphite, [side * 0.012, y, z * a], [side * 0.012, nextY, z * b], 0.012, 7);
    }
  }
  ring(skin, paint.graphite, r * 1.005, r * 0.967, 0.024, 0.076, half);
  for (const y of [0.45, 1.35]) ring(skin, paint.graphite, r - fairing.thickness + 0.005,
    r - fairing.thickness - 0.037, y, y + 0.032, half);
  for (const fraction of [0.26, 0.5, 0.74]) {
    const angle = start + fraction * Math.PI;
    rod(skin, paint.steel, polar(r - fairing.thickness - 0.013, angle, 0.07),
      polar(r - fairing.thickness - 0.013, angle, 1.52), 0.015, 8);
  }
  lathe(skin, paint.orange, [[r * 1.0017, 0.31], [r * 1.0017, 0.48]], { start: start + 0.08, sweep: Math.PI - 0.16, segments: 34 });
  sideBadge(skin, 1.254, 1.14, 0.30, 0.17, paint.orange, start + Math.PI * 0.46);
  port(root, 'latch', [0, 0, 0], neg(Y), `jugre_fairing_250_${spec.stats.side}`, 'shell');
  return root;
}

const factories = {
  r_08_shepot: coldGas,
  g_060_puls: pressureVessel,
  r_253_triada: enginePlate,
  p_2512_konus: cone,
  o_12_schelchok: separator,
  o_25_razryv: separator,
  bk_6_zamok: sideLatch,
  rr_49_reshetka: gridFin,
  sk_18_luch: solarWing,
  pk_2_kontur: capsule,
  pb_1_strizh: avionics,
  pn_1_polka: shelf,
  ob_25_poyas: fairingBase,
  st_25_stvorka_left: fairingShell,
  st_25_stvorka_right: fairingShell,
};

export function buildPart(spec) {
  const factory = factories[spec.id] ?? (engineShapes[spec.id] && mainEngine)
    ?? (tankLooks[spec.id] && mainTank) ?? (finProfiles[spec.id] && fin);
  if (!factory) throw new Error(`Missing model for ${spec.id}`);
  const result = factory(spec);
  return result.isGroup ? { root: result, clips: [] } : result;
}
