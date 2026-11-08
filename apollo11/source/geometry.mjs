import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const tau = Math.PI * 2;
export const rad = THREE.MathUtils.degToRad;
export const vector = (xyz) => new THREE.Vector3(...xyz);
export const polar = (radius, angle, y = 0) => [
  radius * Math.sin(angle), y, radius * Math.cos(angle),
];
export const numbered = (index) => String(index + 1).padStart(2, '0');

function material(name, color, metalness = 0, roughness = 0.62, side = THREE.FrontSide) {
  return new THREE.MeshStandardMaterial({ name, color, metalness, roughness, side });
}

export const m = {
  white: material('Warm white paint', 0xece9e0),
  enamel: material('White enamel', 0xf7f5ed, 0.08, 0.46),
  gray: material('Gray primer', 0x90999a, 0.16),
  black: material('Charcoal paint', 0x24292d),
  shadow: material('Dark recess', 0x11171d),
  aluminum: material('Satin aluminum', 0xb8c5cb, 0.56, 0.44),
  bright: material('Polished aluminum', 0xd7dce0, 0.68, 0.28),
  steel: material('Machined steel', 0x66737d, 0.57, 0.47),
  nickel: material('Heat-darkened nickel', 0x534e49, 0.52, 0.57),
  nozzle: material('Nozzle interior', 0x272828, 0.21, 0.78),
  bronze: material('Oxidized alloy', 0x976e49, 0.38, 0.58),
  ablator: material('Phenolic heat shield', 0x4b3732, 0.11, 0.82),
  red: material('Red insignia', 0xb52d33),
  blue: material('Flag blue', 0x233f6a),
  glass: material('Blue-black window', 0x173a4b, 0.34, 0.19),
  glassLight: material('Window coating', 0x5a8495, 0.34, 0.27),
  green: material('Cabin thermal coating', 0xa5aaa2, 0.31, 0.6),
  gold: material('Gold aluminized Kapton', 0xe4a328, 0.53, 0.46),
  foil: [0xc58a24, 0xd09221, 0xe5a527, 0xedaa2e, 0xf3b436, 0xc48922]
    .map((color, index) => material(`Kapton facet ${index + 1}`, color, 0.53, 0.48)),
  orange: material('International orange fabric', 0xe16a39, 0, 0.78, THREE.DoubleSide),
  canvas: material('Off-white parachute fabric', 0xffead8, 0, 0.82, THREE.DoubleSide),
  lox: material('Cutaway • liquid oxygen', 0x5396be, 0.14, 0.51),
  lh2: material('Cutaway • liquid hydrogen', 0x81bdb1, 0.1, 0.5),
  rp1: material('Cutaway • RP-1', 0xd4a14f, 0.14, 0.55),
  oxidizer: material('Cutaway • SPS oxidizer', 0xc97461, 0.12, 0.52),
  fuel: material('Cutaway • SPS fuel', 0x82b3ba, 0.14, 0.49),
};

const geometryByNode = new WeakMap();

export function group(name, parent, xyz = [0, 0, 0], extras = {}) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...xyz);
  node.userData = { partId: name, ...extras };
  parent?.add(node);
  return node;
}

export function part(parent, id, xyz, extras) {
  return group(`${parent.name}.${id}`, parent, xyz, extras);
}

export function mount(parent, id, xyz, outward = [0, 1, 0]) {
  const node = part(parent, id, xyz, { role: 'mount', outwardAxis: '+Z' });
  node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vector(outward).normalize());
  return node;
}

export function hinge(parent, id, xyz, axis, angle, pose = 0) {
  const node = part(parent, id, xyz, { role: 'hinge', axis, angleRadians: angle });
  node.quaternion.setFromAxisAngle(vector(axis).normalize(), angle * pose);
  return node;
}

export function put(node, geometry, mat, xyz, rotation, scale) {
  const transform = new THREE.Matrix4().compose(
    xyz ? vector(xyz) : new THREE.Vector3(),
    rotation ?? new THREE.Quaternion(),
    scale ? vector(scale) : new THREE.Vector3(1, 1, 1),
  );
  geometry.applyMatrix4(transform);
  const entries = geometryByNode.get(node) ?? new Map();
  if (!entries.has(mat)) entries.set(mat, []);
  geometry.deleteAttribute('uv');
  entries.get(mat).push(geometry.index ? geometry.toNonIndexed() : geometry);
  geometryByNode.set(node, entries);
}

export function seal(node) {
  node.traverse((child) => {
    const entries = geometryByNode.get(child);
    if (!entries) return;
    const geometries = Array.from(entries.values(), (items) => mergeGeometries(items));
    const geometry = mergeVertices(mergeGeometries(geometries, geometries.length > 1), 0.000001);
    const materials = Array.from(entries.keys());
    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.name = `${child.name}.mesh`;
    child.add(mesh);
    geometryByNode.delete(child);
  });
  return node;
}

export function box(node, mat, size, xyz, rotation) {
  put(node, new THREE.BoxGeometry(...size), mat, xyz, rotation);
}

export function profile(node, mat, points, options = {}) {
  const { xyz, start = 0, sweep = tau, segments = 64, rotation, scale } = options;
  put(node, new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(...p)),
    segments, start, sweep), mat, xyz, rotation, scale);
}

export function skin(node, mat, r0, r1, y0, y1, options) {
  profile(node, mat, [[r0, y0], [r1, y1]], options);
}

export function ring(node, mat, outer, inner, y0, y1, options) {
  profile(node, mat, [[inner, y0], [outer, y0], [outer, y1], [inner, y1], [inner, y0]], options);
}

export function cylinder(node, mat, radius, y0, y1, xyz, segments = 48) {
  profile(node, mat, [[0, y0], [radius, y0], [radius, y1], [0, y1]], { xyz, segments });
}

export function ellipsoid(node, mat, xyz, axes, segments = 24) {
  put(node, new THREE.SphereGeometry(1, segments, 16), mat, xyz, undefined, axes);
}

export function orientY(direction) {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector(direction).normalize());
}

export function yaw(angle) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
}

export function strut(node, mat, a, b, radius, segments = 10, endRadius = radius) {
  const direction = vector(b).sub(vector(a));
  put(node, new THREE.CylinderGeometry(endRadius, radius, direction.length(), segments),
    mat, vector(a).addScaledVector(direction, 0.5).toArray(), orientY(direction.toArray()));
}

export function polygon(node, mat, points) {
  const positions = [];
  for (let i = 1; i < points.length - 1; i++) positions.push(...points[0], ...points[i], ...points[i + 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  put(node, geometry, mat);
}

export function loft(node, mat, bottom, top, capped = true, skipFront = false) {
  for (let i = skipFront ? 1 : 0; i < bottom.length; i++) {
    const j = (i + 1) % bottom.length;
    polygon(node, mat, [bottom[i], bottom[j], top[j], top[i]]);
  }
  if (capped) {
    polygon(node, mat, [...bottom].reverse());
    polygon(node, mat, top);
  }
}

export function beveledRect(width, depth, bevel, y, x = 0, z = 0) {
  const w = width / 2;
  const d = depth / 2;
  return [[-w + bevel, d], [w - bevel, d], [w, d - bevel], [w, -d + bevel],
    [w - bevel, -d], [-w + bevel, -d], [-w, -d + bevel], [-w, d - bevel]]
    .map(([px, pz]) => [x + px, y, z + pz]);
}

// The bell walls have real thickness and an open, dark throat.
export function bell(node, radius, length, finish = m.nickel, segments = 40) {
  const shape = [[1, 0], [0.84, 0.18], [0.67, 0.36], [0.47, 0.57], [0.33, 0.78],
    [0.29, 0.9], [0.31, 1]];
  const thickness = radius * 0.044;
  const wall = shape.map(([r, y]) => [radius * r, length * y]);
  profile(node, finish, wall, { segments });
  profile(node, m.nozzle, wall.map(([r, y]) => [r - thickness, y]).reverse(), { segments });
  ring(node, m.steel, radius * 1.016, radius - thickness, 0, length * 0.031, { segments });
  cylinder(node, m.shadow, radius * 0.31, length * 0.91, length * 0.96, undefined, segments);
  for (const [r, y] of shape.slice(1, -1)) {
    ring(node, finish, radius * (r + 0.023), radius * (r - 0.014),
      length * y, length * y + radius * 0.035, { segments });
  }
}

export function lateralNozzle(parent, id, xyz, direction, radius, length) {
  const node = part(parent, id, xyz, { role: 'engine' });
  node.quaternion.copy(orientY(direction.map((value) => -value)));
  bell(node, radius, length, m.steel, 14);
  mount(node, 'mount_engine', [0, length, 0]);
  return node;
}

const glyphs = {
  U: '17/17/17/17/17/17/14', N: '17/25/21/19/17/17/17',
  I: '14/4/4/4/4/4/14', T: '31/4/4/4/4/4/4', E: '31/16/16/30/16/16/31',
  D: '30/17/17/17/17/17/30', S: '15/16/16/14/1/1/30',
  A: '14/17/17/31/17/17/17', C: '15/16/16/16/16/16/15',
  F: '31/16/16/30/16/16/16', B: '30/17/17/30/17/17/30',
  L: '16/16/16/16/16/16/31', M: '17/27/21/21/17/17/17',
  V: '17/17/17/17/17/10/4', 0: '14/17/17/17/17/17/14',
  1: '4/12/4/4/4/4/14', 2: '14/17/1/2/4/8/31',
  3: '30/1/1/14/1/1/30', 5: '31/16/16/30/1/1/30',
  6: '14/16/16/30/17/17/14', '-': '0/0/0/31/0/0/0', ' ': '0/0/0/0/0/0/0',
};

export function patch(node, mat, map, x, y, width, height) {
  const segments = Math.ceil(width / 0.12);
  for (let i = 0; i < segments; i++) {
    const a = x + width * i / segments;
    const b = x + width * (i + 1) / segments;
    polygon(node, mat, [map(a, y), map(b, y), map(b, y + height), map(a, y + height)]);
  }
}

export function label(node, mat, text, height, map) {
  const unit = height / 7;
  [...text].forEach((letter, index) => {
    glyphs[letter].split('/').map(Number).forEach((row, y) => {
      for (let x = 0; x < 5; x++) {
        if (row & (16 >> x)) patch(node, mat, map, (index * 6 + x) * unit, (6 - y) * unit, unit, unit);
      }
    });
  });
}

export function flag(node, width, height, map) {
  const stripe = height / 13;
  for (let y = 0; y < 13; y++) {
    patch(node, y % 2 === 0 ? m.red : m.enamel, map, 0, y * stripe, width, stripe);
  }
  const overlay = (x, y) => map(x, y).map((value, i) => i === 1 ? value : value * 1.002);
  patch(node, m.blue, overlay, 0, 6 * stripe, width * 0.43, 7 * stripe);
  const stars = (x, y) => overlay(x, y).map((value, i) => i === 1 ? value : value * 1.0015);
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < (row % 2 === 0 ? 6 : 5); col++) {
      patch(node, m.enamel, stars, width * (0.024 + 0.069 * col + 0.034 * (row % 2)),
        height * (0.49 + row * 0.058), height * 0.023, height * 0.023);
    }
  }
}
