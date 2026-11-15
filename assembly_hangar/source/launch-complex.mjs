import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import { box, cylinder, mesh, node, ring, rod, rot, seal, sphere, X, Y, Z, yaw } from '../../original_parts/source/geometry.mjs';

import { buildKennedyCampus, kennedyTerrain } from './kennedy-campus.mjs';

const finish = (name, color, properties = {}) => new MeshStandardMaterial({ name, color, roughness: 0.78, ...properties });
const m = {
  concrete: finish('Sun-washed concrete', 0xbfc4bd),
  white: finish('Ivory enamel', 0xe9e9df), steel: finish('Brushed steel', 0x718692, { metalness: 0.55 }),
  navy: finish('Marine blue cladding', 0x284a5c), dark: finish('Dark structural steel', 0x263a46),
  black: finish('Rubber and trench lining', 0x17252a), yellow: finish('Safety ochre', 0xe4ac43),
  orange: finish('Emergency orange', 0xc9673e), glass: finish('Blue glazing', 0x467785, { metalness: 0.45, roughness: 0.28 }),
  bark: finish('Palm trunks', 0x796a4d), leaf: finish('Palm leaves', 0x47745a), leafLight: finish('Sunlit palm leaves', 0x698c54),
  light: finish('Floodlight diffusers', 0xf4e9be, { emissive: 0xffdba0, emissiveIntensity: 1.2 }),
  red: finish('Beacon red', 0xc73927, { emissive: 0xa21911, emissiveIntensity: 0.5 }),
  blue: finish('US flag blue', 0x263467), flagRed: finish('US flag red', 0xab3441),
};

function triangles(parent, material, coordinates) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(coordinates, 3));
  geometry.computeVertexNormals();
  return mesh(parent, geometry, material);
}

const random = (i) => {
  const n = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};

function handrail(parent, a, b, height = 1.14) {
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const count = Math.max(1, Math.ceil(length / 3.5));
  for (let i = 0; i <= count; i++) {
    const p = a.map((n, axis) => n + (b[axis] - n) * i / count);
    rod(parent, m.yellow, p, [p[0], p[1] + height, p[2]], 0.047, 6);
  }
  for (const y of [height * 0.48, height]) {
    rod(parent, m.yellow, [a[0], a[1] + y, a[2]], [b[0], b[1] + y, b[2]], 0.047, 6);
  }
}

function sign(parent, id, text, size, position, angle = 0) {
  const root = node(id, parent, position, { role: 'outdoorSign', text, widthM: size[0], heightM: size[1] });
  root.rotation.y = angle;
  box(root, m.navy, [size[0] + 0.4, size[1] + 0.4, 0.19], [0, 0, 0]);
  return root;
}

function platform(root) {
  const group = node('launch_table', root);
  // Both berms flank the flame trench, and the crawler approaches from the south.
  for (const x of [-28, 28]) box(group, m.concrete, [38, 1.5, 91], [x, 0.85, -10]);
  box(group, m.concrete, [18, 1.5, 34], [0, 0.85, 35.5]);
  triangles(group, m.concrete, [
    -9, 1.6, 52.5, 9, 0.10, 70, 9, 1.6, 52.5,
    -9, 1.6, 52.5, -9, 0.10, 70, 9, 0.10, 70,
  ]);
  box(group, m.black, [17.7, 0.05, 74], [0, 0.03, -25.5]);
  for (const x of [-9.0, 9.0]) box(group, m.dark, [0.55, 5, 73], [x, 2.5, -25.5]);
  for (const x of [-18.5, 18.5]) {
    box(group, m.concrete, [8, 5.6, 30], [x, 3.6, 0]);
    box(group, m.dark, [8.6, 0.65, 32], [x, 6.45, 0]);
  }
  for (const z of [-12.5, 12.5]) {
    box(group, m.dark, [45, 1.2, 4], [0, 6.7, z]);
    box(group, m.steel, [45, 0.18, 4.3], [0, 7.34, z]);
  }
  ring(group, m.dark, 11, 6.3, 7.25, 8.65, { segments: 64 });
  ring(group, m.steel, 11.1, 6.25, 8.65, 9.0, { segments: 64 });
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    rod(group, m.steel, [x * 11.3, 7.7, z * 11.3], [x * 10.8, 8.2, z * 10.8], 0.16);
  }
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const x = 9.6 * Math.sin(a);
    const z = 9.6 * Math.cos(a);
    box(group, m.yellow, [0.36, 0.05, 0.9], [x, 9.03, z], yaw(a));
  }
  for (const side of [-1, 1]) {
    handrail(group, [side * 22.4, 7.45, -14.7], [side * 22.4, 7.45, 14.7]);
    for (const z of [-14.7, 14.7]) handrail(group, [side * 11.5, 7.45, z], [side * 22.4, 7.45, z]);
    rod(group, m.steel, [side * 10, 8.1, 0], [side * 4, 7.5, -6], 0.45);
  }
  const stair = node('access_stairs', group);
  for (let i = 0; i < 28; i++) {
    box(stair, m.steel, [2.9, 0.17, 0.48], [-24, 0.26 * (i + 1), 27 - 0.46 * i]);
  }
  for (const x of [-25.45, -22.55]) handrail(stair, [x, 0.24, 27], [x, 7.33, 14.58]);
  sign(group, 'pad_id', 'KENNEDY  /  LC-39A', [12, 1.8], [-28, 3.3, 16.1]);
  const deflector = node('flame_deflector', group);
  box(deflector, m.steel, [17.0, 0.5, 21], [0, 2.4, -29], rot(X, -0.23));
}

function tower(root) {
  const group = node('service_tower', root, [-20, 0, -10]);
  box(group, m.concrete, [13.6, 2, 13.6], [0, 1, 0]);
  for (const x of [-4.4, 4.4]) {
    for (const z of [-4.4, 4.4]) {
      box(group, m.orange, [0.9, 124, 0.9], [x, 64, z]);
      for (let level = 0; level < 15; level++) {
        const y = 4 + level * 8;
        const coating = level > 11 ? m.white : m.orange;
        box(group, coating, [1.03, 3.2, 1.03], [x, y + 2.5, z]);
      }
    }
  }
  for (let level = 0; level <= 15; level++) {
    const y = 4 + level * 8;
    box(group, m.steel, [9.8, 0.24, 9.8], [0, y, 0]);
    if (level === 15) continue;
    for (const side of [-1, 1]) {
      rod(group, m.orange, [-4.4, y, side * 4.4], [4.4, y + 8, side * 4.4], 0.13, 8);
      rod(group, m.orange, [4.4, y, side * 4.4], [-4.4, y + 8, side * 4.4], 0.13, 8);
      rod(group, m.orange, [side * 4.4, y, -4.4], [side * 4.4, y + 8, 4.4], 0.13, 8);
      handrail(group, [-4.65, y + 0.13, side * 4.65], [4.65, y + 0.13, side * 4.65]);
    }
    // Flight of stairs inside the truss, offset from the lift shaft.
    rod(group, m.steel, [-2.6, y + 0.2, -3.5], [-2.6, y + 8.1, 3.5], 0.10);
    for (let step = 0; step < 28; step++) {
      box(group, m.steel, [1.5, 0.08, 0.28], [-2.6, y + 0.28 * step + 0.2, -3.5 + step * 0.25]);
    }
  }
  box(group, m.navy, [2.6, 122, 2.6], [1.0, 64, -0.6]);
  for (const x of [-0.05, 2.05]) rod(group, m.steel, [x, 2, 1.0], [x, 125, 1.0], 0.11);
  const lift = node('service_lift', group, [1, 16, 1.1], { role: 'serviceLift' });
  box(lift, m.yellow, [2.65, 3.1, 2.0], [0, 0, 0]);
  box(lift, m.glass, [2.38, 2.0, 0.08], [0, 0.2, 1.04]);
  box(group, m.white, [12, 1, 11], [0, 126, 0]);
  rod(group, m.steel, [0, 126, 0], [0, 134, 0], 0.12);
  sphere(group, m.red, [0.29, 0.29, 0.29], [0, 134.1, 0], 12);
  sign(group, 'tower_mark', 'LC-39A', [6.2, 2], [0, 113, 4.97]);
  for (let i = 0; i < 4; i++) {
    const arm = node(`service_arm_${i}`, root, [-15, 32 + i * 22, -5.5], { role: 'serviceArm', level: i });
    box(arm, m.steel, [13, 0.28, 2.3], [6.5, 0, 0]);
    box(arm, m.white, [10.4, 1.8, 1.5], [5.2, 1.05, 0]);
    for (const x of [2, 4.5, 7, 9.5]) box(arm, m.glass, [1.9, 0.67, 0.032], [x, 1.25, 0.77]);
    box(arm, m.yellow, [2.55, 0.12, 2.7], [11.75, 0.06, 0]);
    for (const z of [-1.12, 1.12]) handrail(arm, [0, 0.14, z], [13, 0.14, z]);
    rod(arm, m.steel, [0, 3.3, 0], [11.5, 0.3, 0], 0.075);
  }
}

function tankFarm(root) {
  const group = node('tank_farm', root, [-372, 0, -240]);
  box(group, m.concrete, [65, 0.25, 63], [0, 0.13, 0]);
  for (const [index, x, z, radius, height] of [[0, -17, -11, 7, 16], [1, 4, -11, 7, 16], [2, 22, 10, 5.4, 13]]) {
    cylinder(group, m.concrete, radius + 1, 0.1, 1.4, [x, 0, z], 48);
    cylinder(group, m.white, radius, 1.4, height, [x, 0, z], 48);
    sphere(group, m.white, [radius, radius * 0.34, radius], [x, height, z], 32);
    for (const y of [2, height - 1]) ring(group, m.steel, radius + 0.12, radius - 0.1, y, y + 0.1, { position: [x, 0, z] });
    sign(group, `tank_sign_${index}`, ['LOX', 'FUEL', 'N2'][index], [4, 2], [x, height * 0.59, z + radius + 0.16]);
    rod(group, m.steel, [x, 1.9, z + radius], [x, 1.9, 28], 0.3);
  }
  sphere(group, m.white, [8.7, 8.7, 8.7], [-13, 10.8, 14], 32);
  for (const x of [-18, -8]) for (const z of [9, 19]) box(group, m.steel, [0.7, 5, 0.7], [x, 2.5, z]);
  const hydrogen = node('liquid_hydrogen_tank', root, [369, 0, -235]);
  box(hydrogen, m.concrete, [31, 0.18, 35], [0, 0.08, 0]);
  sphere(hydrogen, m.white, [10.5, 10.5, 10.5], [0, 13, 0], 32);
  for (const x of [-5.8, 5.8]) for (const z of [-5.8, 5.8]) {
    rod(hydrogen, m.steel, [x, 0, z], [x, 9, z], 0.43, 10);
  }
  sign(hydrogen, 'lh2_mark', 'LH2', [4, 1.5], [0, 13, 10.55]);
  const water = node('water_tower', root, [99, 0, -133]);
  for (const x of [-5, 5]) for (const z of [-5, 5]) {
    rod(water, m.white, [x, 0, z], [x * 0.75, 27, z * 0.75], 0.31);
  }
  cylinder(water, m.white, 7.2, 25, 32, undefined, 48);
  sphere(water, m.white, [7.2, 2.5, 7.2], [0, 32, 0], 28);
  sign(water, 'water_label', 'LC-39A  /  WATER', [9, 1.9], [0, 28.5, 7.28]);
}

function building(parent, id, position, size, title) {
  const group = node(id, parent, position);
  box(group, m.concrete, [size[0] + 6, 0.18, size[2] + 6], [0, 0.1, 0]);
  box(group, m.white, size, [0, size[1] / 2, 0]);
  box(group, m.navy, [size[0] + 0.5, 0.5, size[2] + 0.5], [0, size[1], 0]);
  for (let x = -size[0] / 2 + 3; x < size[0] / 2 - 1; x += 4.2) {
    box(group, m.glass, [3.5, 1.9, 0.08], [x, size[1] - 2.1, size[2] / 2 + 0.06]);
    box(group, m.navy, [3.6, 0.15, 0.55], [x, size[1] - 3.12, size[2] / 2 + 0.3]);
  }
  sign(group, 'building_sign', title, [size[0] * 0.61, 2], [0, 3.2, size[2] / 2 + 0.14]);
  return group;
}

function vehicle(parent, id, at, color, bus = false) {
  const group = node(id, parent, at);
  const length = bus ? 7.9 : 5.4;
  const body = bus ? m.white : color;
  box(group, m.dark, [2.3, 0.35, length], [0, 0.66, 0]);
  box(group, body, [2.45, 1.35, length - 0.3], [0, 1.42, 0]);
  box(group, m.glass, [2.29, 0.9, bus ? 6.1 : 2.9], [0, 2.0, bus ? 0.65 : 1.0]);
  box(group, body, [2.5, 0.15, bus ? 6.5 : 3.0], [0, 2.51, bus ? 0.65 : 1.0]);
  for (const x of [-1.24, 1.24]) {
    for (const z of [-length * 0.31, length * 0.31]) {
      rod(group, m.black, [x - 0.15, 0.56, z], [x + 0.15, 0.56, z], 0.52, 14);
      rod(group, m.steel, [x - 0.2, 0.56, z], [x + 0.2, 0.56, z], 0.24, 12);
    }
  }
  for (const x of [-0.85, 0.85]) box(group, m.light, [0.35, 0.25, 0.06], [x, 1.15, length / 2 - 0.08]);
  return group;
}

function installations(root) {
  const group = node('grounds', root);
  building(group, 'pad_support_west', [-196, 0, 101], [46, 8, 25], 'LC-39A  /  SUPPORT');
  building(group, 'pad_support_east', [145, 0, -34], [32, 10, 24], 'LC-39A  /  OPERATIONS');
  building(group, 'pad_equipment_south', [58, 0, 401], [34, 10, 27], 'LC-39A  /  SERVICES');
  building(group, 'pad_gate', [27, 0, 435], [13, 4, 10], 'LC-39A');
  vehicle(group, 'crew_bus', [-152, 0.1, 120], m.white, true);
  vehicle(group, 'fire_engine', [-39, 0.1, 38], m.orange);
  vehicle(group, 'service_pickup', [131, 0.1, 12], m.navy);
  const crawler = node('mobile_transporter', group, [55, 0, 136]);
  box(crawler, m.dark, [24, 2.6, 28], [0, 3.2, 0]);
  box(crawler, m.steel, [26, 0.7, 29], [0, 4.8, 0]);
  for (const x of [-9.3, 9.3]) {
    for (const z of [-8.5, 8.5]) {
      box(crawler, m.black, [5.6, 2.7, 8.5], [x, 1.6, z]);
      for (let step = -3.8; step <= 4; step += 0.62) box(crawler, m.steel, [5.76, 0.23, 0.27], [x, 0.27, z + step]);
      for (let offset = -2.7; offset <= 2.8; offset += 1.35) rod(crawler, m.steel, [x - 2.85, 1.5, z + offset], [x + 2.85, 1.5, z + offset], 0.65, 12);
    }
  }
  box(crawler, m.yellow, [4.7, 2.9, 3.0], [-10.8, 5.8, 11]);
  box(crawler, m.glass, [4.3, 1.55, 0.08], [-10.8, 6.1, 12.55]);
  handrail(crawler, [-12.8, 5.2, -14], [-12.8, 5.2, 14]);
  handrail(crawler, [12.8, 5.2, -14], [12.8, 5.2, 14]);
  const fence = node('pad_39a_perimeter', group);
  const perimeter = [[-455,-245],[-210,-405],[214,-405],[465,-240],[467,48],[226,403],[-215,403],[-453,48]];
  for (const [index, a] of perimeter.entries()) {
    const b = perimeter[(index + 1) % perimeter.length];
    const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 13);
    for (let i = 0; i < count; i++) {
      const x = a[0] + (b[0] - a[0]) * i / count;
      const z = a[1] + (b[1] - a[1]) * i / count;
      if (z > 390 && Math.abs(x) < 52) continue;
      rod(fence, m.steel, [x, 0, z], [x, 2.3, z], 0.082, 6);
    }
    const spans = index === 5 ? [[a, [52, 403]], [[-52, 403], b]] : [[a, b]];
    for (const [start, end] of spans) for (const y of [0.54, 1.45, 2.2]) {
      rod(fence, m.steel, [start[0], y, start[1]], [end[0], y, end[1]], 0.032, 5);
    }
  }
  for (const [x, z] of [[-46, 46], [46, 12], [-52, -45], [52, -45], [-68, 169], [58, 274]]) {
    const lamp = node(`floodlight_${x}_${z}`, root, [x, 0, z], { role: 'outdoorLight' });
    rod(lamp, m.steel, [0, 0, 0], [0, 18, 0], 0.19, 10);
    box(lamp, m.dark, [4.2, 1.5, 1.4], [0, 18, 0], rot(X, -0.58));
    box(lamp, m.light, [3.8, 0.07, 1.2], [0, 17.5, 0.4], rot(X, -0.58));
  }
}

function palm(parent, index, x, z) {
  const h = 7 + random(index + 12) * 6.5;
  const group = node(`palm_${index}`, parent, [x, 0, z]);
  const lean = 0.8 + random(index) * 0.7;
  rod(group, m.bark, [0, 0, 0], [lean, h, 0.3], 0.26, 9, 0.16);
  for (let y = 0.5; y < h; y += 0.45) ring(group, m.bark, 0.267 - y / h * 0.10, 0.14, y, y + 0.1, { position: [lean * y / h, 0, 0.3 * y / h] });
  for (let frond = 0; frond < 9; frond++) {
    const theta = frond * Math.PI * 2 / 9 + random(index) * 3;
    const data = [];
    const span = 3.8 + random(index + frond) * 1.1;
    const points = [];
    for (let i = 0; i <= 9; i++) {
      const t = i / 9;
      points.push([lean + Math.cos(theta) * t * span, h + Math.sin(t * Math.PI) * 1.3 - t * 1.25, 0.3 + Math.sin(theta) * t * span]);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const width = Math.sin((i + 0.3) / 10 * Math.PI) * 0.7;
      const a = points[i];
      const b = points[i + 1];
      const left = [a[0] - Math.sin(theta) * width, a[1] - 0.19, a[2] + Math.cos(theta) * width];
      const right = [a[0] + Math.sin(theta) * width, a[1] - 0.19, a[2] - Math.cos(theta) * width];
      data.push(...a, ...b, ...left, ...a, ...right, ...b, ...a, ...left, ...b, ...a, ...b, ...right);
    }
    triangles(group, frond % 2 ? m.leaf : m.leafLight, data);
  }
}

function planting(root) {
  const group = node('coastal_vegetation', root);
  for (let i = 0; i < 18; i++) {
    palm(group, i, 278 + random(i + 11) * 94, -467 - random(i + 40) * 115);
  }
  const scrub = node('dune_scrub', group);
  for (const [zone, [x0, z0, width, length]] of [
    [-485, -403, 92, 118], [350, 75, 72, 98], [287, -555, 175, 125],
    [-425, 164, 138, 96], [-187, 270, 102, 85], [495, -128, 85, 168],
  ].entries()) {
    for (let i = 0; i < 36; i++) {
      const seed = zone * 151 + i * 7;
      const x = x0 + width * random(seed);
      const z = z0 + length * random(seed + 1);
      const height = 0.65 + random(seed + 2) ** 2 * 3.5;
      sphere(scrub, i % 3 ? m.leafLight : m.leaf, [height * 1.6, height, height * 1.3], [x, height * 0.58, z], 7);
    }
  }
}

function flags(root) {
  const group = node('flags', root, [52, 0, 408]);
  for (const x of [-5, 5]) {
    cylinder(group, m.concrete, 1.5, 0, 0.5, [x, 0, 0], 20);
    rod(group, m.steel, [x, 0.5, 0], [x, 15.5, 0], 0.075, 10);
  }
  const flag = node('us_flag', group, [-5, 12.6, 0.03]);
  for (let row = 0; row < 13; row++) {
    box(flag, row % 2 ? m.white : m.flagRed, [4.5, 0.183, 0.027], [2.25, 1.19 - row * 0.183, 0]);
  }
  box(flag, m.blue, [1.8, 1.281, 0.032], [0.9, 0.64, 0.02]);
  for (let row = 0; row < 9; row++) {
    const count = row % 2 ? 5 : 6;
    for (let col = 0; col < count; col++) box(flag, m.white, [0.07, 0.07, 0.01], [0.16 + col * 0.29 + (row % 2 ? 0.14 : 0), 1.17 - row * 0.13, 0.044]);
  }
  sign(group, 'pad_flag', 'LC-39A', [4, 2.5], [7, 12.3, 0.02]);
}

export function buildLaunchComplex() {
  const root = node('jugre_launch_complex', null, [0, 0, 0], { units: 'meter', up: '+Y' });
  node('rocket_mount', root, [0, 9.08, 0], { role: 'launchRocketMount', forward: '+Y' });
  platform(root);
  tower(root);
  tankFarm(root);
  installations(root);
  planting(root);
  flags(root);
  buildKennedyCampus(root);
  seal(root);
  kennedyTerrain(root);
  return root;
}
