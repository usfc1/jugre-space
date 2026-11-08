import {
  BufferGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, MeshStandardMaterial, Path, Shape,
} from 'three';
import { box, mesh, node, ring, rod, rot, X } from '../../original_parts/source/geometry.mjs';
import { readAsset } from '../../constructor_kit/source/model-io.mjs';
import { buildCraft, example, standPosition, standRotation } from './assembly.mjs';

const material = (name, color, properties = {}) => new MeshStandardMaterial({ name, color, roughness: 0.72, ...properties });
const m = {
  concrete: [0x4d575d, 0x505a60, 0x535d62, 0x565e62, 0x50575c].map((color, index) => material(`Floor bay ${index + 1}`, color)),
  seam: material('Concrete joints', 0x28323a),
  pit: material('Assembly floor coating', 0x344047),
  wall: material('Cool grey wall enamel', 0x829098),
  panel: material('Light grey composite panels', 0x9aa5a6),
  graphite: material('Graphite structure', 0x2c3b45, { metalness: 0.23 }),
  black: material('Rubber and cable ducts', 0x141d23),
  navy: material('Blue equipment enamel', 0x264a5c),
  steel: material('Galvanized steel', 0x718795, { metalness: 0.62, roughness: 0.48 }),
  amber: material('Safety orange enamel', 0xc97524, { metalness: 0.14 }),
  yellow: material('Safety lane paint', 0xe3ad51),
  white: material('Warm white stenciling', 0xe9e2cf),
  glass: material('Smoke-blue observation glazing', 0x315366, { metalness: 0.46, roughness: 0.26 }),
  lit: material('Overhead diffusers', 0xe7f4ff, { emissive: 0xbcdfff, emissiveIntensity: 1.9 }),
  status: material('Control screen cyan', 0x53d9db, { emissive: 0x41c1c5, emissiveIntensity: 0.75 }),
  hot: material('Amber indicator', 0xec963d, { emissive: 0xe68533, emissiveIntensity: 0.7 }),
  cloth: [0xb31933, 0xf5f0e6, 0x202c62].map((color, index) =>
    material(['Flag red', 'Flag ivory', 'Flag canton blue'][index], color, { side: DoubleSide })),
};

const glyphs = {
  A: '0e111f1111', B: '1e111e111e', C: '0f1010100f', E: '1f101e101f', G: '0f1013170f',
  H: '11111f1111', I: '1f0404041f', J: '070101110e', K: '1112141211', L: '101010101f',
  M: '111b151111', N: '1119151311',
  O: '0e1111110e', R: '1e111e1211', S: '0f100e011e', T: '1f04040404', U: '111111110e',
  Y: '11110a0404', '0': '0e1315190e', '1': '040c04040e', '2': '0e1102041f',
  '3': '1e0106011e', '4': '060a121f02', '5': '1f101e011e', '6': '0e101e110e',
  '7': '1f01020404', '8': '0e110e110e', '9': '0e110f010e', '/': '0102040810', ' ': '0000000000',
};

function stencil(parent, label, height, position, finish = m.white, angle = 0) {
  const sign = new Group();
  sign.position.set(...position);
  sign.rotation.y = angle;
  parent.add(sign);
  const unit = height / 5;
  const offset = (label.length * 6 - 2) / 2;
  Array.from(label).forEach((letter, index) => {
    for (const [row, bits] of glyphs[letter].match(/../g).entries()) {
      const mask = parseInt(bits, 16);
      for (let column = 0; column < 5; column++) {
        if (mask & (16 >> column)) {
          box(sign, finish, [unit, unit, 0.013], [(index * 6 + column - offset) * unit, (2 - row) * unit, 0]);
        }
      }
    }
  });
}

function floor(root) {
  const base = node('floor', root);
  box(base, m.seam, [30, 0.276, 35], [0, -0.162, 0]);
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) {
      box(base, m.concrete[(x * x + 3 * x * z + z * z) % m.concrete.length],
        [2.983, 0.022, 3.478], [3 * x - 13.5, -0.011, 3.5 * z - 15.75]);
    }
  }
  box(base, m.pit, [19.8, 0.02, 7.8], [0, 0.01, -4.4]);
  for (const z of [-8.27, -0.53]) {
    box(base, m.yellow, [19.8, 0.012, 0.07], [0, 0.025, z]);
    for (let x = -9; x < 10; x += 2) {
      box(base, m.yellow, [0.5, 0.012, 0.11], [x, 0.025, z + 0.14 * Math.sign(z + 4.4)]);
    }
  }
  for (const x of [-9.88, 9.88]) box(base, m.yellow, [0.07, 0.012, 7.8], [x, 0.025, -4.4]);
  for (const x of [-11.9, 11.9]) {
    for (const dx of [-0.8, 0.8]) box(base, m.white, [0.045, 0.013, 33], [x + dx, 0.014, 0]);
    for (let z = -15; z <= 15; z += 1.6) box(base, m.yellow, [0.055, 0.016, 0.68], [x, 0.014, z]);
  }
  for (const z of [4.5, 5.2]) {
    box(base, m.graphite, [19.4, 0.019, 0.15], [0, 0.011, z]);
    for (let x = -9.6; x < 9.7; x += 0.24) box(base, m.steel, [0.03, 0.014, 0.12], [x, 0.025, z]);
  }
  for (let x = -4; x <= 4; x += 0.58) box(base, m.white, [0.27, 0.015, 1.15], [x, 0.017, 9.7]);
  const id = node('floor_bay_id', base, [-7.8, 0.025, 2.5]);
  id.rotation.x = -Math.PI / 2;
  stencil(id, '01', 0.85, [0, 0, 0]);
  stencil(id, 'BAY', 0.25, [0, -0.78, 0]);
}

function door(parent, x, label) {
  box(parent, m.graphite, [3.25, 3.8, 0.28], [x, 1.9, -16.18]);
  box(parent, m.navy, [2.9, 3.37, 0.19], [x, 1.76, -16.01]);
  for (let i = 1; i <= 12; i++) box(parent, m.steel, [2.88, 0.026, 0.022], [x, i * 0.255, -15.91]);
  box(parent, m.black, [1.44, 0.28, 0.06], [x, 2.55, -15.87]);
  box(parent, m.glass, [1.28, 0.16, 0.018], [x, 2.55, -15.833]);
  box(parent, m.status, [0.14, 0.11, 0.07], [x + 1.78, 2.43, -16.01]);
  stencil(parent, label, 0.24, [x, 4.13, -16.13]);
}

function structure(root) {
  const back = node('rear_wall', root);
  box(back, m.graphite, [30, 11.8, 0.42], [0, 5.9, -16.68]);
  for (let i = 0; i < 12; i++) {
    const x = 2.5 * i - 13.75;
    box(back, m.navy, [2.46, 4.65, 0.14], [x, 2.325, -16.39]);
    box(back, m.panel, [2.46, 5.69, 0.14], [x, 7.55, -16.39]);
    box(back, m.steel, [2.46, 0.34, 0.19], [x, 10.66, -16.35]);
  }
  box(back, m.graphite, [30, 0.16, 0.27], [0, 4.65, -16.24]);
  box(back, m.steel, [30, 0.09, 0.35], [0, 4.5, -16.28]);
  door(back, -10.3, 'LAB 01');
  door(back, 10.3, 'AIRLOCK');
  box(back, m.graphite, [12.0, 2.75, 0.24], [0, 2.17, -16.14]);
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 1.94;
    box(back, m.glass, [1.83, 2.37, 0.12], [x, 2.17, -15.98]);
    box(back, m.status, [1.52, 0.036, 0.026], [x, 3.11, -15.91]);
    box(back, m.steel, [1.88, 0.06, 0.09], [x, 1.53, -15.88]);
  }
  for (const side of [-1, 1]) {
    const wall = node(side < 0 ? 'left_wall' : 'right_wall', root);
    box(wall, m.graphite, [0.31, 11.8, 33.4], [side * 14.91, 5.9, -0.04]);
    for (let index = 0; index < 8; index++) {
      const z = -14.35 + 4.08 * index;
      box(wall, m.wall, [0.16, 3.64, 3.94], [side * 14.69, 1.95, z]);
      box(wall, m.panel, [0.16, 5.25, 3.94], [side * 14.69, 7.31, z]);
      box(wall, m.glass, [0.13, 0.68, 3.72], [side * 14.57, 4.28, z]);
      for (let offset = -1.24; offset <= 1.25; offset += 1.24) {
        box(wall, m.lit, [0.04, 0.075, 1.05], [side * 14.494, 4.49, z + offset]);
      }
      box(wall, m.graphite, [0.68, 11.8, 0.37], [side * 14.37, 5.9, z - 2.04]);
      box(wall, m.steel, [0.12, 2.9, 0.38], [side * 13.99, 1.45, z - 2.04]);
      box(wall, m.yellow, [0.13, 0.42, 0.38], [side * 13.92, 0.28, z - 2.04]);
    }
    box(wall, m.black, [0.27, 0.24, 33.1], [side * 14.46, 0.12, -0.05]);
    box(wall, m.graphite, [0.46, 0.46, 33.05], [side * 14.48, 8.9, -0.05]);
    rod(wall, m.steel, [side * 14.31, 7.9, -16.4], [side * 14.31, 7.9, 16.3], 0.14);
  }
  const roof = node('roof', root);
  box(roof, m.graphite, [29.95, 0.22, 33.7], [0, 11.87, -0.05]);
  for (let z = -15; z <= 16; z += 3.9) {
    box(roof, m.steel, [29, 0.21, 0.28], [0, 11.48, z]);
    box(roof, m.graphite, [28.7, 0.18, 0.19], [0, 10.79, z]);
    for (let x = -13.4; x <= 12; x += 2.42) {
      rod(roof, m.steel, [x, 10.86, z], [x + 1.17, 11.42, z], 0.056, 6);
      rod(roof, m.steel, [x + 1.17, 11.42, z], [x + 2.34, 10.86, z], 0.056, 6);
    }
    for (const x of [-8.7, -2.9, 2.9, 8.7]) {
      box(roof, m.black, [3.55, 0.15, 0.44], [x, 10.69, z]);
      box(roof, m.lit, [3.44, 0.06, 0.3], [x, 10.594, z]);
    }
  }
}

function flag(root) {
  const group = node('us_flag', root, [-4.55, 7.48, -16.08], { canton: 'upper left from the assembly floor' });
  const width = 6.3;
  const height = width / 1.9;
  const stripe = height / 13;
  const cantonWidth = 0.76 * height;
  const wave = (x, y) => 0.06 * Math.sin((x + width / 2) * 3.8) * (0.55 + 0.45 * (0.5 - y / height));
  const face = (positions, finish) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    mesh(group, geometry, finish);
  };
  function fabric(left, top, w, h, finish) {
    const positions = [];
    for (let i = 0; i < 42; i++) {
      const x = left + w * i / 42;
      const right = left + w * (i + 1) / 42;
      const bottom = top - h;
      const corners = [[x, top], [x, bottom], [right, bottom], [right, top]];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const [u, v] = corners[index];
        positions.push(u, v, wave(u, v));
      }
    }
    face(positions, finish);
  }
  for (let row = 0; row < 13; row++) {
    const offset = row < 7 ? cantonWidth : 0;
    fabric(-width / 2 + offset, height / 2 - row * stripe, width - offset, stripe, m.cloth[row % 2]);
  }
  fabric(-width / 2, height / 2, cantonWidth, 7 * stripe, m.cloth[2]);
  const positions = [];
  for (let row = 0; row < 9; row++) {
    const count = row % 2 ? 5 : 6;
    for (let column = 0; column < count; column++) {
      const x = -width / 2 + (column + (count === 6 ? 0.5 : 1)) * cantonWidth / 6;
      const y = height / 2 - (row + 1) * 7 * stripe / 10;
      const star = Array.from({ length: 10 }, (_, index) => {
        const angle = index * Math.PI / 5;
        const radius = height * 0.0308 * (index % 2 ? 0.382 : 1);
        const u = x - radius * Math.sin(angle);
        const v = y + radius * Math.cos(angle);
        return [u, v, wave(u, v) + 0.006];
      });
      for (let point = 0; point < star.length; point++) {
        positions.push(x, y, wave(x, y) + 0.006, ...star[point], ...star[(point + 1) % star.length]);
      }
    }
  }
  face(positions, m.cloth[1]);
  rod(group, m.steel, [-3.28, 1.72, -0.01], [3.28, 1.72, -0.01], 0.033);
}

const wordmarkContours = [
  [[0, 0.31], [0.18, 0.31], [0.18, 0.23], [0.23, 0.18], [0.59, 0.18], [0.65, 0.24], [0.65, 1],
    [0.83, 1], [0.83, 0.17], [0.66, 0], [0.17, 0], [0, 0.17]],
  [[0, 1], [0.18, 1], [0.18, 0.25], [0.25, 0.18], [0.58, 0.18], [0.65, 0.25], [0.65, 1],
    [0.83, 1], [0.83, 0.18], [0.65, 0], [0.18, 0], [0, 0.18]],
  [[0, 0.82], [0.18, 1], [0.83, 1], [0.83, 0.82], [0.25, 0.82], [0.18, 0.75], [0.18, 0.25],
    [0.25, 0.18], [0.65, 0.18], [0.65, 0.39], [0.42, 0.39], [0.42, 0.57], [0.83, 0.57], [0.83, 0], [0.18, 0], [0, 0.18]],
  [[0, 1], [0.68, 1], [0.83, 0.85], [0.83, 0.60], [0.67, 0.44], [0.59, 0.44], [0.83, 0.08],
    [0.83, 0], [0.67, 0], [0.37, 0.44], [0.18, 0.44], [0.18, 0], [0, 0]],
  [[0, 1], [0.83, 1], [0.83, 0.82], [0.18, 0.82], [0.18, 0.60], [0.69, 0.60],
    [0.69, 0.42], [0.18, 0.42], [0.18, 0.18], [0.83, 0.18], [0.83, 0], [0, 0]],
];

function outline(path, points) {
  const [first, ...rest] = points;
  path.moveTo(...first);
  for (const point of rest) path.lineTo(...point);
  path.closePath();
  return path;
}

function branding(root) {
  const frame = node('brand_frame', root, [4.05, 7.48, -16.07]);
  box(frame, m.graphite, [7.0, 3.315, 0.17], [0, 0, 0]);
  box(frame, m.navy, [6.91, 3.22, 0.035], [0, 0, 0.104]);
  for (const x of [-3.14, 3.14]) {
    box(frame, m.steel, [0.06, 0.18, 0.018], [x, 1.35, 0.134]);
    box(frame, m.steel, [0.06, 0.18, 0.018], [x, -1.35, 0.134]);
  }
  box(frame, m.yellow, [5.73, 0.042, 0.02], [0, -0.69, 0.137]);
  stencil(frame, 'ASSEMBLY BAY 01', 0.27, [0, -1.08, 0.149]);
  const name = node('hangar_brand', frame, [0, 0.24, 0.15], {
    role: 'editableWordmark', text: 'JUGRE', printableSizeM: [5.7, 1.45],
  });
  for (const [index, contour] of wordmarkContours.entries()) {
    const shape = outline(new Shape(), contour);
    if (index === 3) shape.holes.push(outline(new Path(),
      [[0.18, 0.82], [0.18, 0.62], [0.59, 0.62], [0.65, 0.68], [0.65, 0.76], [0.59, 0.82]]));
    mesh(name, new ExtrudeGeometry(shape, { depth: 0.023, bevelEnabled: false }),
      m.white, [-2.395 + index * 0.99, -0.5, 0]);
  }
}

function crane(root) {
  const group = node('bridge_crane', root);
  for (const x of [-12.8, 12.8]) {
    box(group, m.graphite, [0.62, 0.45, 32.9], [x, 9.32, 0]);
    box(group, m.steel, [0.16, 0.12, 32.9], [x, 9.59, 0]);
    box(group, m.amber, [0.94, 0.36, 2.75], [x, 9.86, -4.85]);
  }
  for (const z of [-5.42, -4.48]) {
    box(group, m.amber, [26.5, 0.53, 0.42], [0, 10.06, z]);
    box(group, m.yellow, [26.5, 0.08, 0.51], [0, 9.83, z]);
  }
  const x = -9.9;
  box(group, m.graphite, [2.05, 0.38, 1.63], [x, 9.69, -4.95]);
  box(group, m.amber, [1.18, 0.42, 0.84], [x, 9.38, -4.95]);
  for (const dx of [-0.18, 0.18]) rod(group, m.black, [x + dx, 9.25, -4.95], [x + dx, 6.7, -4.95], 0.017);
  box(group, m.yellow, [0.6, 0.25, 0.32], [x, 6.64, -4.95]);
  ring(group, m.steel, 0.16, 0.099, -0.035, 0.035, {
    position: [x, 6.42, -4.95], quaternion: rot(X, Math.PI / 2), start: -Math.PI / 2, sweep: 5.2,
  });
  stencil(group, 'CRANE 01', 0.26, [8.8, 10.07, -4.264], m.black);
}

function trestle(parent, x, z) {
  const group = node(`stand_${x}`, parent, [x, 0.025, z]);
  box(group, m.graphite, [1.6, 0.22, 2.8], [0, 0.14, 0]);
  box(group, m.amber, [1.57, 0.08, 2.73], [0, 0.28, 0]);
  for (const side of [-1, 1]) {
    rod(group, m.steel, [0, 0.27, side * 1.28], [0, 1.5, side * 0.99], 0.13, 8);
    rod(group, m.amber, [-0.62, 0.29, side * 1.25], [0, 1.22, side * 1.055], 0.087, 8);
    rod(group, m.amber, [0.62, 0.29, side * 1.25], [0, 1.22, side * 1.055], 0.087, 8);
    box(group, m.black, [0.48, 0.18, 0.31], [0, 1.51, side * 0.99], rot(X, -side * 0.9));
  }
}

function consoleStation(parent, label, x, z, angle) {
  const group = node(label, parent, [x, 0, z]);
  group.rotation.y = angle;
  box(group, m.graphite, [1.8, 0.1, 0.66], [0, 0.05, 0]);
  box(group, m.navy, [1.58, 0.94, 0.56], [0, 0.55, 0]);
  box(group, m.steel, [1.82, 0.08, 0.79], [0, 1.05, 0.04]);
  box(group, m.black, [0.9, 0.49, 0.075], [0, 1.38, -0.17], rot(X, -0.16));
  box(group, m.glass, [0.82, 0.41, 0.015], [0, 1.38, -0.128], rot(X, -0.16));
  for (let i = 0; i < 6; i++) {
    box(group, m.status, [0.25 + (i * 7 % 5) * 0.084, 0.014, 0.018], [-0.018, 1.23 + 0.045 * i, -0.09 - i * 0.007]);
  }
  box(group, m.black, [0.55, 0.025, 0.21], [0, 1.105, 0.17]);
  box(group, m.hot, [0.07, 0.033, 0.07], [0.65, 1.109, 0.19]);
  for (let i = 0; i < 3; i++) {
    box(group, m.graphite, [1.28, 0.035, 0.031], [0, 0.35 + i * 0.22, 0.287]);
    box(group, m.steel, [0.19, 0.033, 0.04], [0, 0.46 + i * 0.22, 0.3]);
  }
}

function equipment(root) {
  const group = node('workstations', root);
  for (const [index, x, z, angle] of [[1, -8.3, -8.9, 0], [2, 7.5, -9.5, 0], [3, -13.7, 1, Math.PI / 2], [4, 13.7, 2, -Math.PI / 2]]) {
    consoleStation(group, `console_${index}`, x, z, angle);
  }
  for (const x of [-5.3, -1.15, 2.72]) trestle(group, x, -4.42);
  const rack = node('equipment_rack', group, [11.3, 0, -12.6]);
  for (const x of [-1.38, 1.38]) {
    for (const z of [-0.52, 0.52]) box(rack, m.amber, [0.1, 2.28, 0.1], [x, 1.14, z]);
  }
  for (const y of [0.22, 1.05, 1.88]) {
    box(rack, m.steel, [2.85, 0.11, 1.15], [0, y, 0]);
    for (const x of [-0.9, 0, 0.9]) {
      box(rack, m.navy, [0.74, 0.47, 0.9], [x, y + 0.29, 0]);
      box(rack, m.steel, [0.27, 0.05, 0.03], [x, y + 0.34, 0.462]);
      box(rack, m.yellow, [0.11, 0.05, 0.02], [x - 0.22, y + 0.46, 0.463]);
    }
  }
  const stair = node('mobile_access_steps', group, [5.9, 0, -1.45]);
  for (let i = 0; i < 6; i++) {
    box(stair, m.graphite, [1.13, 0.11, 0.35], [0, 0.19 * (i + 1), 1 - 0.31 * i]);
    box(stair, m.yellow, [1.13, 0.06, 0.035], [0, 0.19 * (i + 1), 1.18 - 0.31 * i]);
  }
  for (const x of [-0.55, 0.55]) {
    rod(stair, m.amber, [x, 0.15, 1.09], [x, 1.11, -0.55], 0.048);
    rod(stair, m.amber, [x, 0.98, 1.09], [x, 2, -0.55], 0.035);
    for (const [y, z] of [[0.2, 1.09], [0.57, 0.45], [1.13, -0.55]]) {
      rod(stair, m.amber, [x, y, z], [x, y + 0.82, z], 0.03);
    }
  }
}

async function sampleRocket(root, specs) {
  const demo = node('example_rocket', root, standPosition, { role: 'replaceableDemoAssembly' });
  demo.quaternion.copy(standRotation);
  const ids = [...new Set(example.map(({ part }) => part))];
  const models = new Map(await Promise.all(ids.map(async (id) => [id, await readAsset({ pack: 'original_parts', id })])));
  demo.add(buildCraft(example, specs, models).group);
}

export async function buildHangar() {
  const root = node('assembly_hangar', null, [0, 0, 0], { units: 'meter', up: '+Y' });
  floor(root);
  structure(root);
  flag(root);
  branding(root);
  crane(root);
  equipment(root);
  return { root, addDemo: (specs) => sampleRocket(root, specs) };
}
