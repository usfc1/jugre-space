import * as THREE from 'three';
import {
  bell, beveledRect, box, cylinder, ellipsoid, flag, group, hinge, label, loft, m,
  mount, numbered, orientY, part, polar, polygon, profile, rad, ring, strut, tau, vector, yaw,
} from './geometry.mjs';
import { antennaDish, reactionCluster } from './columbia.mjs';

export const ascentDatum = 3.19;
export const lmDockY = 3.79;
const quadrants = [0, 1, 2, 3].map((index) => index * Math.PI / 2);
const legNames = ['front', 'right', 'rear', 'left'];
const footCenterHeight = 0.165;
const strutAngle = rad(11);
const deployAngle = Math.atan2(4.25 - 1.72, 2.96 - footCenterHeight) - strutAngle;

function random(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function insulation(node, lower, upper) {
  const noise = random(50605);
  for (let i = 0; i < lower.length; i++) {
    const j = (i + 1) % lower.length;
    const a = vector(lower[i]);
    const b = vector(lower[j]);
    const c = vector(upper[i]);
    const d = vector(upper[j]);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const columns = Math.ceil(a.distanceTo(b) / 0.26);
    const rows = 8;
    const points = Array.from({ length: rows + 1 }, (_, row) =>
      Array.from({ length: columns + 1 }, (_, col) => {
        const interior = row > 0 && row < rows && col > 0 && col < columns;
        const u = (col + (interior ? (noise() - 0.5) * 0.73 : 0)) / columns;
        const v = (row + (interior ? (noise() - 0.5) * 0.74 : 0)) / rows;
        const from = a.clone().lerp(b, u);
        const to = c.clone().lerp(d, u);
        return from.lerp(to, v).addScaledVector(normal, interior ? (noise() - 0.4) * 0.032 : 0).toArray();
      }));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const shade = Math.floor(noise() * m.foil.length);
        const quad = [points[y][x], points[y][x + 1], points[y + 1][x + 1], points[y + 1][x]];
        polygon(node, m.foil[shade], quad.slice(0, 3));
        polygon(node, m.foil[(shade + Number(noise() > 0.53)) % m.foil.length], [quad[0], quad[2], quad[3]]);
      }
    }
  }
  polygon(node, m.gold, [...lower].reverse());
  polygon(node, m.black, upper);
}

function footPad(leg, foot, stowed, front) {
  const pad = part(leg, 'footpad', foot, { standalone: true, role: 'joint', axis: [1, 0, 0] });
  pad.rotation.x = stowed ? rad(-78) : deployAngle;
  profile(pad, m.gold, [[0, -0.165], [0.3, -0.165], [0.42, -0.14], [0.475, -0.092],
    [0.477, -0.054], [0.41, -0.046], [0.33, -0.015], [0.21, 0.055], [0.115, 0.094], [0, 0.094]],
  { segments: 48 });
  ring(pad, m.bronze, 0.471, 0.454, -0.103, -0.084, { segments: 48 });
  ellipsoid(pad, m.steel, [0, 0.095, 0], [0.114, 0.095, 0.114]);
  if (!front) {
    const probe = hinge(pad, 'contact_probe', [0, -0.078, 0.27], [1, 0, 0], rad(85));
    strut(probe, m.steel, [0, 0, 0], [0, 0.028, stowed ? 0.62 : -0.93], 0.011, 6);
    probe.userData.configuration = stowed ? 'stowed' : 'folded_against_surface';
  }
  mount(pad, 'mount_axle', [0, 0.094, 0], [1, 0, 0]);
}

function ladder(leg, foot) {
  const ladder = part(leg, 'ladder', [0, -0.08, 0.12], { standalone: true });
  const top = vector([0, 0.02, 0.11]);
  const bottom = vector(foot).multiplyScalar(0.87).add(vector([0, -0.04, 0.19]));
  for (const side of [-1, 1]) {
    const shift = vector([side * 0.147, 0, 0]);
    strut(ladder, m.aluminum, top.clone().add(shift).toArray(), bottom.clone().add(shift).toArray(), 0.022);
  }
  for (let i = 0; i < 9; i++) {
    const step = top.clone().lerp(bottom, 0.10 + 0.10 * i);
    strut(ladder, m.bright, step.clone().add(vector([-0.147, 0, 0])).toArray(),
      step.clone().add(vector([0.147, 0, 0])).toArray(), 0.017, 8);
  }
  mount(ladder, 'mount_ladder', [0, 0, 0], [0, 0, -1]);
}

function landingLeg(parent, angle, index, stowed) {
  const front = index === 0;
  const y = 2.96;
  const r = 1.72;
  const mountPosition = polar(r, angle, y);
  const yawFrame = part(parent, `gear_${legNames[index]}`, mountPosition, { standalone: true });
  yawFrame.quaternion.copy(yaw(angle));
  mount(yawFrame, 'mount_hinge', [0, 0, 0], [1, 0, 0]);
  const leg = hinge(yawFrame, 'main_strut', [0, 0, 0], [1, 0, 0], -deployAngle, Number(!stowed));
  const length = stowed ? 1.92 : (y - footCenterHeight) / Math.cos(strutAngle + deployAngle);
  const foot = [0, -length * Math.cos(strutAngle), length * Math.sin(strutAngle)];
  const along = (f) => foot.map((value) => value * f);
  strut(leg, m.gold, [0, 0, 0], along(0.64), 0.094, 14, 0.074);
  strut(leg, m.bright, along(0.55), foot, 0.051, 12, 0.035);
  for (const f of [0.09, 0.14, 0.21, 0.35, 0.59, 0.67, 0.83]) {
    strut(leg, f > 0.59 ? m.steel : m.bronze, along(f), along(f + 0.027), f > 0.59 ? 0.063 : 0.099, 12);
  }
  ellipsoid(yawFrame, m.steel, [0, 0.015, 0], [0.19, 0.14, 0.16]);
  const attachment = vector(along(stowed ? 0.46 : 0.58)).applyQuaternion(leg.quaternion).toArray();
  for (const side of [-1, 1]) {
    const braceRoot = [side * 0.56, -1.17, -0.38];
    const brace = part(yawFrame, side < 0 ? 'brace_left' : 'brace_right', braceRoot, { role: 'joint' });
    const endpoint = attachment.map((value, i) => value - braceRoot[i]);
    strut(brace, m.bright, [0, 0, 0], endpoint, 0.049, 10, 0.032);
    const collar = endpoint.map((v) => v * 0.47);
    strut(brace, m.gold, [0, 0, 0], collar, 0.066, 10);
    mount(brace, 'mount_brace', [0, 0, 0], [1, 0, 0]);
  }
  footPad(leg, foot, stowed, front);
  if (front) ladder(leg, foot);
  mount(parent, `mount_sla_${numbered(index)}`, mountPosition, [0, -1, 0]);
}

function porch(parent) {
  const node = part(parent, 'porch', [0, 2.98, 1.97], { standalone: true });
  box(node, m.steel, [0.9, 0.087, 0.68], [0, 0, 0.26]);
  for (let i = -4; i <= 4; i++) {
    strut(node, m.aluminum, [i * 0.094, 0.06, -0.041], [i * 0.094, 0.06, 0.58], 0.012, 6);
  }
  for (const side of [-1, 1]) {
    const x = side * 0.434;
    strut(node, m.steel, [x, -0.34, -0.04], [x, -0.025, 0.52], 0.033);
    strut(node, m.bright, [x, 0.02, 0.52], [x, 0.18, 0.51], 0.018);
    strut(node, m.bright, [x, 0.18, 0.51], [x, 0.18, 0.05], 0.018);
  }
  mount(node, 'mount_porch', [0, 0, 0], [0, 0, -1]);
}

export function descentStage(stowed = false) {
  const node = group('eagle_descent', undefined, undefined, { configuration: stowed ? 'stowed' : 'deployed' });
  const lower = beveledRect(3.75, 3.75, 0.88, 1.49);
  const upper = beveledRect(4.28, 4.28, 1.03, 2.78);
  const roof = beveledRect(3.76, 3.76, 0.9, ascentDatum);
  const skin = part(node, 'thermal_blanket');
  insulation(skin, lower, upper);
  loft(skin, m.black, upper, roof, false);
  polygon(skin, m.steel, roof);
  for (let i = 0; i < upper.length; i++) {
    strut(skin, m.bronze, upper[i], upper[(i + 1) % upper.length], 0.029, 8);
  }
  const deck = part(node, 'equipment_bay', [0, 2.1, -1.996]);
  box(deck, m.black, [1.13, 0.86, 0.095], [0, 0, 0]);
  box(deck, m.gold, [0.96, 0.72, 0.034], [0, 0, -0.064]);
  for (const side of [-1, 1]) {
    box(deck, m.bronze, [0.05, 0.62, 0.065], [0.37 * side, 0, -0.078]);
  }
  const dps = part(node, 'dps', [0, 1.6, 0], { standalone: true, engineType: 'DPS', role: 'engine' });
  bell(part(dps, 'nozzle', [0, -0.88, 0]), 0.68, 0.86, m.nickel);
  mount(dps, 'mount_gimbal', [0, 0, 0]);
  quadrants.forEach((angle, index) => landingLeg(node, angle, index, stowed));
  const radar = part(node, 'landing_radar', [0.74, 1.53, 1.06], { standalone: true });
  box(radar, m.steel, [0.51, 0.24, 0.49], [0, -0.09, 0], orientY([0.13, 0.98, 0.17]));
  antennaDish(radar, 'array', [0, -0.2, 0], [0.13, -0.98, 0.17], 0.215, 0.061, m.enamel);
  mount(radar, 'mount_radar', [0, 0, 0]);
  porch(node);
  mount(node, 'mount_ascent', [0, ascentDatum, 0]);
  return node;
}

function triangularWindow(parent, side) {
  const name = side < 0 ? 'left' : 'right';
  const node = part(parent, `forward_window_${name}`, [side * 0.84, 2.1, 1.59]);
  const shape = [[0.24, -0.33, 0.16], [0.72, 0.38, 0.06], [-0.46, 0.33, 0.28]];
  const vertices = (scale, offset) => {
    const points = shape.map(([x, y, z]) => [side * x * scale, y * scale, z * scale + offset]);
    return side < 0 ? points.reverse() : points;
  };
  polygon(node, m.steel, vertices(1.16, 0.024));
  polygon(node, m.shadow, vertices(1.05, 0.059));
  polygon(node, m.glass, vertices(0.88, 0.103));
  const [a, b, c] = vertices(0.87, 0.104);
  const va = vector(a);
  const vb = vector(b);
  const vc = vector(c);
  polygon(node, m.glassLight, [vb.clone().lerp(va, 0.17).toArray(), b, c,
    vc.clone().lerp(va, 0.17).toArray()]);
}

function ascentHatch(parent) {
  const node = hinge(parent, 'forward_hatch', [-0.44, 0.84, 1.835], [0, 1, 0], rad(-98));
  node.userData.standalone = true;
  box(node, m.steel, [0.91, 0.92, 0.065], [0.44, 0.02, 0.008]);
  box(node, m.aluminum, [0.79, 0.8, 0.059], [0.44, 0.02, 0.05]);
  box(node, m.steel, [0.14, 0.06, 0.063], [0.70, 0.08, 0.093]);
  for (const y of [-0.31, 0.34]) {
    strut(node, m.steel, [-0.015, y - 0.065, 0.024], [-0.015, y + 0.065, 0.024], 0.036, 12);
  }
  mount(node, 'mount_hinge', [0, 0, 0], [0, 1, 0]);
}

function lowerCabin(node, belly, shoulder) {
  loft(node, m.black, belly, shoulder, false, true);
  polygon(node, m.black, [...belly].reverse());
  const yBottom = belly[0][1];
  const yTop = shoulder[0][1];
  const openingBottom = 0.48;
  const openingTop = 1.24;
  const width = 0.335;
  const lerp = (a, b, y) => THREE.MathUtils.lerp(a, b, (y - yBottom) / (yTop - yBottom));
  const side = (y) => lerp(belly[1][0], shoulder[1][0], y);
  const face = (x, y) => [x, y, lerp(belly[1][2], shoulder[1][2], y)];
  const strip = (left, right, bottom, top) => polygon(node, m.black, [
    face(left(bottom), bottom), face(right(bottom), bottom), face(right(top), top), face(left(top), top),
  ]);
  const left = (y) => -side(y);
  strip(left, side, yBottom, openingBottom);
  strip(left, () => -width, openingBottom, openingTop);
  strip(() => width, side, openingBottom, openingTop);
  strip(left, side, openingTop, yTop);
  const rim = [face(-width, openingBottom), face(width, openingBottom),
    face(width, openingTop), face(-width, openingTop)];
  const inset = rim.map(([x, y]) => [x, y, 1.33]);
  polygon(node, m.shadow, inset);
  for (let i = 0; i < rim.length; i++) {
    const j = (i + 1) % rim.length;
    polygon(node, m.steel, [rim[j], rim[i], inset[i], inset[j]]);
  }
}

export function eagleAntennas(parent, stowed) {
  const node = group('eagle_antennas', parent, undefined, { configuration: stowed ? 'stowed' : 'deployed' });
  const rr = hinge(node, 'rendezvous_radar', [-0.77, 3.08, 1.06], [1, 0, 0], rad(-38), Number(!stowed));
  rr.userData.standalone = true;
  strut(rr, m.aluminum, [0, 0, 0], [0, 0.28, 0.08], 0.061);
  antennaDish(rr, 'reflector', [0, 0.3, 0.08], [-0.24, 0.62, 0.75], 0.311, 0.094, m.enamel);
  mount(rr, 'mount_gimbal', [0, 0, 0], [1, 0, 0]);
  const sBand = hinge(node, 's_band', [1.27, 2.61, -0.66], [0, 0, 1], rad(-54), Number(!stowed));
  sBand.userData.standalone = true;
  strut(sBand, m.aluminum, [0, 0, 0], [0.03, 0.68, 0], 0.059);
  antennaDish(sBand, 'reflector', [0.03, 0.70, 0], [0.17, 0.97, 0.1], 0.477, 0.128, m.aluminum);
  mount(sBand, 'mount_gimbal', [0, 0, 0], [0, 0, 1]);
  for (const [i, side] of [-1, 1].entries()) {
    const whip = hinge(node, `vhf_${numbered(i)}`, [side * 1.55, 2.7, -0.32], [0, 0, 1],
      side * rad(59), Number(!stowed));
    whip.userData.standalone = true;
    strut(whip, m.steel, [0, 0, 0], [-side * 0.26, 0.66, -0.27], 0.012, 8, 0.007);
    cylinder(whip, m.bright, 0.047, 0, 0.11, undefined, 12);
  }
  return node;
}

export function ascentStage({ stowed = false, docked = false } = {}) {
  const node = group('eagle_ascent');
  const body = part(node, 'pressure_cabin');
  const belly = beveledRect(2.56, 2.94, 0.58, 0.21, 0, 0.1);
  const cabin = beveledRect(3.54, 3.58, 0.87, 1.27, 0, 0.05);
  const brow = beveledRect(3.48, 3.39, 0.98, 2.50, 0, 0.03);
  const roof = beveledRect(2.1, 2.67, 0.54, 3.18, 0, -0.06);
  lowerCabin(body, belly, cabin);
  loft(body, m.green, cabin, brow, false);
  loft(body, m.aluminum, brow, roof);
  const bay = part(node, 'aft_equipment_bay');
  const bayShoulder = beveledRect(3.32, 1.47, 0.43, 2.64, 0, -1.12);
  loft(bay, m.black, beveledRect(2.63, 1.53, 0.32, 0.55, 0, -1.07), bayShoulder);
  loft(bay, m.aluminum, bayShoulder,
    beveledRect(2.38, 1.22, 0.38, 3.01, 0, -1.13));
  box(bay, m.enamel, [1.54, 1.06, 0.09], [0, 1.57, -1.86]);
  for (let i = -4; i <= 4; i++) {
    box(bay, m.aluminum, [0.023, 1.0, 0.026], [i * 0.155, 1.57, -1.916]);
  }
  for (const side of [-1, 1]) {
    const pod = part(node, side < 0 ? 'equipment_left' : 'equipment_right');
    const x = side * 1.52;
    loft(pod, side < 0 ? m.aluminum : m.green,
      beveledRect(0.75, 1.34, 0.2, 0.7, x, -0.22), beveledRect(1.17, 1.68, 0.33, 2.34, x, -0.17));
    loft(pod, m.aluminum, beveledRect(1.17, 1.68, 0.33, 2.34, x, -0.17),
      beveledRect(0.62, 1.04, 0.24, 2.83, x * 0.95, -0.26));
    triangularWindow(node, side);
    strut(body, m.steel, [side * 0.67, 0.38, 1.59], [side * 0.81, 1.58, 1.95], 0.018, 8);
    strut(body, m.steel, [side * 0.81, 1.58, 1.95], [side * 0.58, 2.74, 1.68], 0.018, 8);
  }
  ascentHatch(node);
  for (const [i, angle] of [rad(45), rad(135), rad(225), rad(315)].entries()) {
    const rcs = reactionCluster(node, `rcs_${numbered(i)}`, polar(1.98, angle, 2.27), angle, 0.92);
    strut(rcs, m.aluminum, [-0.21, -0.21, -0.64], [0, -0.04, 0], 0.062);
    strut(rcs, m.aluminum, [0.25, 0.18, -0.61], [0, 0.035, 0], 0.059);
  }
  const markings = part(node, 'markings');
  box(markings, m.enamel, [0.78, 0.51, 0.059], [-1.12, 0.94, 1.42], yaw(rad(-22)));
  flag(markings, 0.53, 0.31, (x, y) => [-1.39 + x, 0.815 + y, 1.35 + 0.40 * x]);
  label(markings, m.red, 'USA', 0.11, (x, y) => [0.69 + x, 0.91 + y, 1.58 - 0.36 * x]);
  const tunnel = part(node, 'docking_tunnel', [0, 3.18, 0], { standalone: true });
  ring(tunnel, m.aluminum, 0.61, 0.438, 0, 0.56);
  ring(tunnel, m.bright, 0.596, 0.42, 0.56, lmDockY - 3.18);
  const hatch = hinge(tunnel, 'overhead_hatch', [0.39, 0.14, 0], [0, 0, 1], rad(-83));
  hatch.userData.standalone = true;
  cylinder(hatch, m.steel, 0.412, -0.037, 0.02, [-0.39, 0, 0]);
  if (!docked) {
    const drogue = part(tunnel, 'drogue', [0, 0.2, 0], { standalone: true });
    profile(drogue, m.steel, [[0.063, 0.035], [0.095, 0.04], [0.38, 0.31], [0.4, 0.34],
      [0.373, 0.34], [0.067, 0.074], [0.063, 0.035]], { segments: 32 });
    mount(drogue, 'mount_drogue', [0, 0, 0], [0, -1, 0]);
  }
  const engine = part(node, 'aps', [0, 0.28, 0], { standalone: true, engineType: 'APS', role: 'engine' });
  bell(part(engine, 'nozzle', [0, -0.91, 0]), 0.386, 0.81, m.nickel);
  mount(engine, 'mount_engine', [0, 0, 0]);
  eagleAntennas(node, stowed);
  const mounts = group('eagle_mounts', node);
  mount(mounts, 'mount_descent', [0, 0, 0], [0, -1, 0]);
  mount(node, 'dock_port', [0, lmDockY, 0]);
  return node;
}

export function eagle({ stowed = false, docked = false } = {}) {
  const node = group('eagle_lm', undefined, undefined, { configuration: stowed ? 'stowed' : 'deployed' });
  const ascent = ascentStage({ stowed, docked });
  ascent.position.y = ascentDatum;
  node.add(descentStage(stowed), ascent);
  return node;
}
