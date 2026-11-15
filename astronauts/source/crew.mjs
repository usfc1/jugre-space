import { Group, MeshStandardMaterial, Vector3 } from 'three';
import { block, bubble, claw, cylinder, finishPart, grid, line, panel, turn } from './shapes.mjs';

const tau = 2 * Math.PI;
const faceZ = Math.PI / 2;
const onZ = [faceZ, 0, 0];
const onX = [0, 0, faceZ];
const shell = 0xf1f1ea;
const ice = 0xd7e2e8;
const dark = 0x293343;
const ink = 0x141a23;
const steel = 0xa1aeb7;
const red = 0xca443b;
const screen = 0x8ce9e0;
const visorPivot = [0, 0.261, 0.007];

export const suits = {
  apollo: {
    title: 'Apollo', code: 'A7', role: 'Лунная экспедиция', era: '01 / RETRO EVA',
    note: 'Тёплый белый корпус, золотой светофильтр LEVA, цветные разъёмы и высокий ранец PLSS.',
    base: 0xf4eee0, accent: red, secondary: 0x385c80, head: 0xffc04d, expression: 'Улыбка',
    dome: [0.299, 0.304, 0.298], window: [1.10, 0.78, -0.45, 0.21],
    lens: 0xd9a44f, metalness: 0.80, roughness: 0.23, pack: [0.46, 0.49, 0.24],
    accessory: 'sample_scoop', toolName: 'Лунный совок',
  },
  artemis: {
    title: 'Artemis', code: 'AX', role: 'Южный полюс Луны', era: '02 / LUNAR EVA',
    note: 'Панорамный визор, открытые шарниры, защитные щитки и плоский ранец с задним люком.',
    base: 0xf2f5f6, accent: 0x3dc5ca, secondary: 0x23577a, head: 0xffcb63, expression: 'Сосредоточенность',
    dome: [0.297, 0.287, 0.304], window: [1.18, 0.62, -0.39, 0.13],
    lens: 0x294e78, metalness: 0.63, roughness: 0.18, pack: [0.42, 0.397, 0.165],
    accessory: 'survey_scanner', toolName: 'Сканер грунта',
  },
  iss: {
    title: 'ISS', code: 'EV', role: 'Орбитальное обслуживание', era: '03 / ORBITAL EVA',
    note: 'Широкий шлем с камерой и фонарями, жёсткий торс, пульт DCM и узел страховки.',
    base: 0xeef0eb, accent: 0x3f68a2, secondary: red, head: 0xfab642, expression: 'Удивление',
    dome: [0.319, 0.319, 0.319], window: [1.24, 0.87, -0.49, 0.19],
    lens: 0x9abac8, metalness: 0.75, roughness: 0.19, pack: [0.46, 0.48, 0.265],
    accessory: 'tether_reel', toolName: 'Катушка страховки',
  },
  mars: {
    title: 'Mars', code: 'M4', role: 'Марсианская разведка', era: '04 / SURFACE EVA',
    note: 'Проектный скафандр с медным визором, пылезащитными манжетами и широкими протекторами.',
    base: 0xf5ede1, accent: 0xe56c31, secondary: 0x613832, head: 0xf3a83f, expression: 'Подмигивание',
    dome: [0.302, 0.279, 0.307], window: [1.09, 0.61, -0.33, 0.07],
    lens: 0xa85d41, metalness: 0.72, roughness: 0.23, pack: [0.43, 0.44, 0.212],
    accessory: 'dust_brush', toolName: 'Щётка реголита',
  },
};

function joint(parent, name, at) {
  const group = new Group();
  group.name = name;
  group.position.fromArray(at);
  parent.add(group);
  return group;
}

function port(part, x, y, z, color, r = 0.032) {
  cylinder(part, dark, r + 0.008, 0.018, [x, y, z], onZ, 'rubber');
  cylinder(part, color, r, 0.018, [x, y, z + 0.011], onZ);
  cylinder(part, ink, r * 0.42, 0.006, [x, y, z + 0.022], onZ, 'rubber', 8);
}

function tread(part, centerZ, width, depth) {
  for (const z of [-0.107, -0.057, -0.007, 0.043, 0.093, 0.143]) {
    if (Math.abs(z) + 0.01 >= depth / 2) continue;
    for (const side of [-1, 1]) {
      block(part, ink, [width * 0.39, 0.013, 0.027], [side * width * 0.26, -0.1065, centerZ + z], 0);
    }
  }
}

function insignia(part, id, cfg, x, y, z) {
  const ring = id === 'apollo' || id === 'mars';
  if (ring) {
    cylinder(part, cfg.secondary, 0.048, 0.008, [x, y, z], onZ, undefined, 12);
    cylinder(part, cfg.accent, 0.042, 0.008, [x, y, z + 0.003], onZ, undefined, 12);
  } else {
    block(part, cfg.secondary, [0.090, 0.075, 0.009], [x, y, z], 0.003, [0, 0, -0.10]);
  }
  const p = (dx, dy) => [x + dx, y + dy, z + 0.008];
  if (id === 'iss') {
    for (const s of [-1, 1]) {
      block(part, ice, [0.022, 0.030, 0.003], [x + s * 0.023, y, z + 0.008], 0);
    }
    block(part, shell, [0.029, 0.009, 0.003], [x, y, z + 0.010], 0);
  } else if (id === 'mars') {
    panel(part, shell, [p(-0.026, -0.014), p(0.025, -0.014), p(0.009, 0.017), p(-0.004, 0.004)]);
    cylinder(part, shell, 0.0065, 0.004, [x - 0.018, y + 0.019, z + 0.009], onZ, undefined, 8);
  } else {
    panel(part, shell, [p(-0.023, -0.018), p(0.017, -0.010), p(0.028, 0.027), p(0.001, 0.010)]);
    panel(part, ice, [p(-0.029, 0.002), p(-0.017, 0.001), p(-0.012, 0.019)]);
  }
}

function torsoParts(torso, id, cfg) {
  const color = cfg.base;
  const accent = cfg.accent;
  block(torso, color, [0.476, 0.490, 0.334], [0, 0.253, 0], 0.043, undefined, undefined, 0.572);
  block(torso, dark, [0.453, 0.066, 0.343], [0, 0.046, 0], 0.014, undefined, 'rubber');
  turn(torso, steel, [[0.173, 0], [0.213, 0], [0.229, 0.011], [0.229, 0.031], [0.216, 0.043], [0.170, 0.043]],
    [0, 0.484, 0.005], 20, 'alloy');
  cylinder(torso, dark, 0.170, 0.052, [0, 0.507, 0.005], undefined, 'rubber', 20);
  insignia(torso, id, cfg, -0.154, 0.397, 0.169);
  block(torso, dark, [0.111, 0.025, 0.012], [0.137, 0.409, 0.173], 0.004);
  for (let i = 0; i < 3; i++) {
    block(torso, i === 0 ? accent : ice, [0.018 + i * 0.004, 0.006, 0.004], [0.108 + 0.027 * i, 0.410, 0.180], 0);
  }
  if (id === 'apollo') {
    for (const side of [-1, 1]) {
      block(torso, 0xd3d0c4, [0.045, 0.270, 0.023], [side * 0.203, 0.247, 0.169], 0.008, [0, 0, -side * 0.10]);
    }
    block(torso, ice, [0.206, 0.106, 0.055], [0, 0.295, 0.177], 0.011);
    block(torso, dark, [0.085, 0.035, 0.012], [-0.024, 0.308, 0.207], 0.005);
    block(torso, 0xa8d1ae, [0.062, 0.012, 0.004], [-0.024, 0.307, 0.214], 0);
    cylinder(torso, red, 0.014, 0.018, [0.060, 0.303, 0.214], onZ, undefined, 8);
    port(torso, -0.124, 0.142, 0.179, red);
    port(torso, 0.128, 0.145, 0.180, cfg.secondary);
    line(torso, dark, [[-0.124, 0.139, 0.197], [-0.091, 0.095, 0.220], [0.020, 0.084, 0.216], [0.122, 0.149, 0.198]],
      0.011, 'rubber');
  } else if (id === 'artemis') {
    block(torso, 0xd1e1e5, [0.400, 0.169, 0.061], [0, 0.231, 0.166], 0.025, undefined, undefined, 0.454);
    block(torso, dark, [0.186, 0.079, 0.037], [0, 0.245, 0.197], 0.013);
    block(torso, cfg.secondary, [0.125, 0.036, 0.005], [-0.011, 0.245, 0.218], 0.005);
    block(torso, screen, [0.082, 0.006, 0.004], [-0.024, 0.248, 0.222], 0);
    for (const s of [-1, 1]) {
      block(torso, accent, [0.053, 0.015, 0.009], [s * 0.163, 0.231, 0.200], 0.003, [0, 0, -s * 0.42]);
      block(torso, cfg.secondary, [0.069, 0.038, 0.017], [s * 0.138, 0.087, 0.179], 0.007);
    }
  } else if (id === 'iss') {
    block(torso, ice, [0.436, 0.200, 0.079], [0, 0.258, 0.171], 0.024, undefined, undefined, 0.463);
    block(torso, dark, [0.347, 0.110, 0.030], [0, 0.264, 0.219], 0.013);
    block(torso, cfg.accent, [0.155, 0.054, 0.012], [-0.037, 0.278, 0.237], 0.005);
    block(torso, screen, [0.106, 0.009, 0.004], [-0.047, 0.282, 0.245], 0);
    cylinder(torso, shell, 0.030, 0.015, [0.096, 0.267, 0.241], onZ);
    block(torso, red, [0.007, 0.020, 0.004], [0.100, 0.269, 0.250], 0, [0, 0, -0.44]);
    line(torso, steel, [[-0.062, 0.129, 0.175], [-0.061, 0.092, 0.222], [0, 0.069, 0.232],
      [0.061, 0.092, 0.222], [0.062, 0.129, 0.175]], 0.013, 'alloy', 10);
    port(torso, 0.165, 0.126, 0.181, accent, 0.021);
  } else {
    block(torso, accent, [0.431, 0.186, 0.065], [0, 0.228, 0.171], 0.023, undefined, undefined, 0.478);
    block(torso, cfg.secondary, [0.247, 0.095, 0.031], [0, 0.245, 0.211], 0.013);
    block(torso, 0xeccc9b, [0.115, 0.033, 0.005], [-0.026, 0.247, 0.229], 0.006);
    for (const side of [-1, 1]) {
      block(torso, dark, [0.053, 0.073, 0.033], [side * 0.161, 0.117, 0.173], 0.008);
      for (let i = 0; i < 3; i++) {
        block(torso, accent, [0.035, 0.005, 0.004], [side * 0.161, 0.104 + i * 0.013, 0.192], 0);
      }
    }
  }
}

function face(part, id, cfg) {
  turn(part, cfg.head, [[0, 0.041], [0.164, 0.041], [0.194, 0.052], [0.215, 0.074],
    [0.218, 0.095], [0.218, 0.341], [0.212, 0.364], [0.189, 0.385], [0.151, 0.391], [0, 0.391]], [0, 0, 0], 32);
  turn(part, cfg.head, [[0.087, 0.390], [0.087, 0.424], [0.077, 0.433], [0.061, 0.433], [0.061, 0.408], [0, 0.408]],
    [0, 0, 0], 20);
  const at = (x, y, lift = 0.003) => [x, y, Math.sqrt(0.218 ** 2 - x ** 2) + lift];
  const stroke = (points, size) => line(part, ink, points.map(([x, y]) => at(x, y)), size, undefined, 8, 5);
  for (const s of [-1, 1]) {
    const x = s * 0.075;
    if (id === 'mars' && s === 1) {
      stroke([[0.052, 0.247], [0.072, 0.258], [0.099, 0.249]], 0.008);
    } else {
      bubble(part, ink, [0.019, id === 'iss' ? 0.028 : 0.023, 0.009], at(x, 0.247), undefined, 10);
      bubble(part, 0xffefcb, [0.0055, 0.006, 0.0025], at(x - 0.004, 0.253, 0.013), undefined, 8);
    }
    if (id === 'artemis') stroke([[s * 0.051, 0.281], [s * 0.096, 0.294]], 0.008);
    if (id === 'iss') stroke([[s * 0.051, 0.299], [s * 0.076, 0.307], [s * 0.101, 0.299]], 0.006);
  }
  if (id === 'iss') {
    bubble(part, ink, [0.027, 0.031, 0.008], at(0, 0.162), undefined, 12);
    bubble(part, 0xe47e50, [0.012, 0.006, 0.0025], at(0, 0.151, 0.011), undefined, 8);
  } else if (id === 'artemis') {
    stroke([[-0.041, 0.167], [0.007, 0.161], [0.041, 0.166]], 0.0075);
  } else {
    stroke([[-0.063, 0.183], [-0.042, 0.158], [0.004, 0.149], [0.048, 0.165], [0.063, 0.189]], 0.008);
    if (id === 'mars') {
      for (const x of [-0.111, -0.093, -0.075]) {
        bubble(part, 0xc67835, [0.004, 0.004, 0.002], at(x, 0.202), undefined, 8);
      }
    }
  }
}

function helmetParts(helmet, visor, id, cfg) {
  const [rx, ry, rz] = cfg.dome;
  const [angle, top, bottom, corner] = cfg.window;
  const low = t => bottom + corner * (Math.min(1, Math.abs(t) / angle) ** 4);
  const high = t => top - corner * (Math.min(1, Math.abs(t) / angle) ** 4);
  const coordinates = (t, p) => [Math.sin(t) * Math.cos(p), Math.sin(p), Math.cos(t) * Math.cos(p)];
  const origin = [0, 0.224, 0.016];
  const point = (t, p, depth, pivot) => coordinates(t, p).map((a, i) =>
    a * (cfg.dome[i] + depth) + origin[i] - (pivot ? visorPivot[i] : 0));
  const normal = (t, p) => new Vector3(...coordinates(t, p).map((a, i) => a / cfg.dome[i])).normalize().toArray();
  const surface = (part, color, columns, rows, theta, limits, depth = 0, pivot = false, finish, reverse = false) => {
    const sample = (u, v) => {
      const t = theta(u);
      const [a, b] = limits(t, u);
      return [t, a + (b - a) * v];
    };
    grid(part, color, rows, columns, (u, v) => point(...sample(u, v), depth, pivot),
      (u, v) => normal(...sample(u, v)).map(value => reverse ? -value : value), finish, reverse);
  };
  const front = u => -angle + 2 * angle * u;
  const rear = u => angle + (tau - 2 * angle) * u;
  const cap = Math.PI / 2 - 0.002;
  for (const [theta, columns, rearHalf] of [[front, 20, false], [rear, 26, true]]) {
    const t = x => rearHalf ? angle : x;
    surface(helmet, cfg.base, columns, 5, theta, x => [high(t(x)), cap]);
    surface(helmet, id === 'mars' ? cfg.accent : cfg.base, columns, 5, theta, x => [-cap, low(t(x))]);
  }
  surface(helmet, cfg.base, 26, 7, rear, () => [low(angle), high(angle)]);
  surface(helmet, dark, 20, 2, front, t => [low(t) - 0.055, low(t)], 0.004, false, 'rubber');
  surface(helmet, dark, 20, 2, front, t => [high(t), high(t) + 0.052], 0.004, false, 'rubber');
  for (const s of [-1, 1]) {
    const side = u => s < 0 ? -angle - 0.045 + u * 0.045 : angle + u * 0.045;
    surface(helmet, dark, 2, 7, side, () => [low(angle), high(angle)], 0.004, false, 'rubber');
  }
  const glazing = new MeshStandardMaterial({
    name: `${cfg.title} coated visor`, vertexColors: true, metalness: cfg.metalness, roughness: cfg.roughness,
  });
  surface(visor, dark, 20, 9, front, t => [low(t) - 0.011, high(t) + 0.011], 0.015, true, 'rubber');
  surface(visor, cfg.lens, 20, 9, u => front(0.013 + u * 0.974),
    t => [low(t) + 0.029, high(t) - 0.028], 0.022, true, glazing);
  surface(visor, dark, 20, 7, front, t => [low(t) - 0.011, high(t) + 0.011], 0.014, true, 'rubber', true);

  for (const s of [-1, 1]) {
    cylinder(helmet, dark, 0.073, 0.039, [s * (rx - 0.016), 0.263, 0.038], onX, 'rubber');
    cylinder(helmet, id === 'apollo' ? cfg.base : cfg.accent, 0.060, 0.023,
      [s * (rx + 0.011), 0.263, 0.038], onX);
    cylinder(helmet, id === 'apollo' ? cfg.secondary : steel, 0.025, 0.012,
      [s * (rx + 0.027), 0.263, 0.038], onX, 'alloy', 10);
    if (id === 'iss' || id === 'artemis') {
      const iss = id === 'iss';
      block(helmet, cfg.base, [0.074, 0.112, 0.147],
        [s * (iss ? 0.260 : 0.237), iss ? 0.381 : 0.365, 0.092], 0.014, [0, s * 0.26, -s * 0.27]);
      block(helmet, dark, [0.106, iss ? 0.090 : 0.047, 0.102],
        [s * (iss ? 0.249 : 0.228), iss ? 0.417 : 0.397, 0.169], 0.013, [0, s * 0.17, 0]);
      block(helmet, iss ? shell : screen, [0.070, iss ? 0.051 : 0.019, 0.012],
        [s * (iss ? 0.252 : 0.228), iss ? 0.416 : 0.398, 0.222], 0.005);
    }
    if (id === 'apollo') {
      block(helmet, cfg.base, [0.092, 0.131, 0.086], [s * 0.247, 0.340, 0.179], 0.014, [-0.22, s * 0.32, -s * 0.20]);
    }
    if (id === 'mars') {
      block(helmet, cfg.accent, [0.111, 0.086, 0.104], [s * 0.230, 0.139, 0.192], 0.014, [0.08, s * 0.45, s * 0.17]);
      block(helmet, ink, [0.060, 0.021, 0.014], [s * 0.222, 0.132, 0.242], 0.004, [0.08, s * 0.45, s * 0.17]);
    }
  }
  if (id === 'iss') {
    block(helmet, cfg.accent, [0.093, 0.080, 0.139], [0.209, 0.482, 0.107], 0.016, [0, 0.12, 0.17]);
    port(helmet, 0.214, 0.477, 0.178, dark, 0.023);
  } else if (id === 'artemis') {
    block(helmet, cfg.secondary, [0.159, 0.029, 0.063], [0, 0.485, 0.146], 0.011, [-0.54, 0, 0]);
    block(helmet, screen, [0.100, 0.011, 0.011], [0, 0.479, 0.181], 0.003, [-0.54, 0, 0]);
  } else if (id === 'mars') {
    block(helmet, cfg.accent, [0.242, 0.029, 0.066], [0, 0.472, 0.170], 0.010, [-0.40, 0, 0]);
    block(helmet, ice, [0.081, 0.006, 0.013], [0, 0.467, 0.206], 0.002);
  }
  helmet.userData.mount = 'neck_eva_v1';
  visor.userData.hingeAxis = [1, 0, 0];
}

function packParts(pack, id, cfg) {
  const [w, h, d] = cfg.pack;
  block(pack, dark, [w * 0.83, h * 0.87, 0.080], [0, 0, -0.028], 0.013, undefined, 'rubber');
  block(pack, cfg.base, [w, h, d], [0, 0, -d * 0.53 - 0.028], 0.036);
  const z = -d - 0.020;
  const band = id === 'apollo' ? cfg.secondary : cfg.accent;
  block(pack, band, [w * 0.82, h * 0.13, 0.026], [0, h * 0.29, z], 0.008);
  block(pack, id === 'mars' ? cfg.secondary : ice, [w * 0.75, h * 0.47, 0.032],
    [0, -h * 0.058, z], 0.018);
  for (const s of [-1, 1]) {
    block(pack, steel, [0.054, h * 0.54, 0.074], [s * w * 0.46, -h * 0.03, z + 0.065], 0.008, undefined, 'alloy');
    block(pack, dark, [0.036, 0.052, 0.039], [s * w * 0.37, -h * 0.27, z - 0.008], 0.006, undefined, 'rubber');
  }
  for (let i = 0; i < 4; i++) {
    block(pack, dark, [w * 0.39, 0.009, 0.008], [0, -h * 0.145 + i * 0.018, z - 0.020], 0);
  }
  if (id === 'apollo' || id === 'iss') {
    block(pack, id === 'apollo' ? shell : ice, [w * 0.83, 0.086, d * 0.78],
      [0, (id === 'apollo' ? 1 : -1) * h * 0.48, -d * 0.56 - 0.04], 0.016);
    if (id === 'apollo') {
      line(pack, steel, [[0.151, 0.257, -0.158], [0.151, 0.311, -0.161], [0.184, 0.355, -0.168]], 0.008, 'alloy', 6);
      bubble(pack, red, [0.014, 0.014, 0.014], [0.184, 0.355, -0.168], undefined, 8);
    }
  } else {
    line(pack, steel, [[-0.073, h * 0.40, z + 0.050], [-0.073, h * 0.53, z + 0.040],
      [0.073, h * 0.53, z + 0.040], [0.073, h * 0.40, z + 0.050]], 0.012, 'alloy', 8);
    if (id === 'mars') {
      for (const s of [-1, 1]) {
        cylinder(pack, cfg.accent, 0.041, 0.166, [s * w * 0.477, -0.062, z + 0.071], undefined, undefined, 10);
      }
    }
  }
  if (id === 'artemis') {
    const latch = -d - 0.043;
    for (const s of [-1, 1]) {
      block(pack, cfg.secondary, [0.046, 0.105, 0.021], [s * 0.171, 0.011, latch], 0.006);
      block(pack, cfg.accent, [0.025, 0.059, 0.010], [s * 0.171, 0.019, latch - 0.012], 0.004);
    }
  }
  pack.userData.mount = 'back_eva_v1';
}

function armParts(upper, lower, hand, id, cfg, s) {
  const hard = id === 'artemis' || id === 'mars';
  cylinder(upper, dark, 0.101, 0.115, [s * 0.012, -0.012, 0], onX, 'rubber');
  block(upper, hard ? cfg.accent : cfg.base, [0.216, 0.178, 0.215], [s * 0.033, -0.054, 0.003], 0.039, [0, 0, s * 0.20]);
  block(upper, cfg.base, [0.180, 0.137, 0.180], [s * 0.046, -0.135, 0.011], 0.022, [0, 0, s * 0.18]);
  if (s === -1) insignia(upper, id, cfg, s * 0.038, -0.054, 0.109);
  if (s === 1) {
    block(upper, cfg.secondary, [0.082, 0.023, 0.010], [s * 0.041, -0.071, 0.114], 0.005);
    block(upper, ice, [0.051, 0.007, 0.004], [s * 0.041, -0.070, 0.121], 0);
  }
  cylinder(lower, dark, 0.077, 0.150, [0, 0.005, 0], onX, 'rubber');
  cylinder(lower, hard ? steel : cfg.secondary, 0.044, 0.021, [s * 0.078, 0.004, 0], onX, 'alloy', 10);
  block(lower, cfg.base, [0.178, 0.157, 0.176], [0, -0.084, 0.012], 0.026, [-0.16, 0, 0]);
  cylinder(lower, hard ? dark : steel, 0.091, 0.041, [0, -0.148, 0.031], undefined, hard ? 'rubber' : 'alloy', 14);
  if (s === 1) {
    block(lower, dark, [0.101, 0.068, 0.027], [0, -0.078, 0.110], 0.008, [-0.16, 0, 0]);
    block(lower, id === 'apollo' ? ice : screen, [0.063, 0.028, 0.008], [0, -0.077, 0.126], 0.004);
  }
  if (id === 'mars') {
    cylinder(lower, cfg.accent, 0.093, 0.020, [0, -0.121, 0.026], undefined, undefined, 14);
  }
  block(hand, dark, [0.111, 0.068, 0.094], [0, -0.017, 0.020], 0.011, undefined, 'rubber');
  claw(hand, id === 'apollo' ? 0x647f93 : id === 'mars' ? cfg.secondary : dark, s);
}

function legParts(thigh, shin, boot, id, cfg, s) {
  const mars = id === 'mars';
  const hard = mars || id === 'artemis';
  cylinder(thigh, dark, 0.091, 0.180, [0, 0.004, 0], onX, 'rubber');
  block(thigh, cfg.base, [0.223, 0.196, 0.252], [0, -0.104, -0.004], 0.027);
  if (id === 'iss' && s === 1) {
    block(thigh, red, [0.228, 0.030, 0.254], [0, -0.111, -0.004], 0.009);
  } else {
    block(thigh, hard ? cfg.accent : ice, [0.133, 0.070, 0.030], [s * 0.013, -0.106, 0.127], 0.009);
  }
  cylinder(shin, dark, 0.084, 0.173, [0, 0.006, 0], onX, 'rubber');
  block(shin, cfg.base, [0.221, 0.183, 0.236], [0, -0.110, 0], 0.025);
  block(shin, hard ? cfg.accent : ice, [0.155, hard ? 0.126 : 0.088, 0.043],
    [0, hard ? -0.057 : -0.079, 0.118], 0.014, [-0.12, 0, 0]);
  if (hard) {
    cylinder(shin, steel, 0.041, 0.019, [s * 0.097, 0.006, 0], onX, 'alloy', 10);
    block(shin, cfg.secondary, [0.091, 0.015, 0.007], [0, -0.040, 0.142], 0.003);
  }
  const width = mars ? 0.258 : 0.231;
  const depth = mars ? 0.348 : 0.307;
  const z = mars ? 0.053 : 0.040;
  block(boot, mars ? cfg.accent : cfg.base, [width, 0.105, depth], [0, -0.038, z], 0.023);
  block(boot, id === 'apollo' ? cfg.secondary : dark, [width + 0.009, 0.044, depth + 0.012],
    [0, -0.086, z], 0.011, undefined, 'rubber');
  block(boot, mars ? cfg.secondary : ice, [width * 0.75, 0.032, 0.106], [0, 0.004, z + depth * 0.24], 0.009);
  tread(boot, z, width, depth);
}

const bodyData = (mass, size, center, kind = 'box') => ({ mass, collider: { kind, size, center } });
const fixed = (a, b) => ({ a, b, type: 'fixed' });
const cone = (a, b, axis, swingDeg, twistDeg) => ({ a, b, type: 'coneTwist', axis, swingDeg, twistDeg });
const hinge = (a, b, limitsDeg) => ({ a, b, type: 'hinge', axis: [1, 0, 0], limitsDeg });

export function createAstronaut(id) {
  const cfg = suits[id];
  const root = new Group();
  root.name = 'jugre_astronaut';
  root.userData = { suit: id, unit: 'm', forward: '+Z', rig: 'jugre_eva_v1' };
  const pelvis = joint(root, 'pelvis', [0, 0.615, 0]);
  const torso = joint(pelvis, 'torso', [0, 0.065, 0]);
  const head = joint(torso, 'head', [0, 0.527, 0]);
  const helmet = joint(head, 'helmet', [0, 0, 0]);
  const visor = joint(helmet, 'visor', visorPivot);
  const backpack = joint(torso, 'backpack', [0, 0.281, -0.169]);
  joint(torso, 'tether_mount', [0.121, 0.098, 0.226]);
  joint(pelvis, 'seat_mount', [0, -0.043, -0.113]);
  block(pelvis, dark, [0.489, 0.121, 0.286], [0, -0.005, -0.011], 0.025, undefined, 'rubber');
  block(pelvis, cfg.base, [0.415, 0.077, 0.085], [0, 0.016, 0.115], 0.014);
  block(pelvis, cfg.accent, [0.104, 0.044, 0.023], [0, 0.020, 0.162], 0.007);
  torsoParts(torso, id, cfg);
  face(head, id, cfg);
  helmetParts(helmet, visor, id, cfg);
  packParts(backpack, id, cfg);
  const [w, h, d] = cfg.pack;
  const [rx, ry, rz] = cfg.dome;
  const bodies = {
    pelvis: bodyData(11, [0.46, 0.12, 0.27], [0, 0, 0]),
    torso: bodyData(27, [0.47, 0.47, 0.31], [0, 0.248, 0]),
    head: bodyData(5, [0.40, 0.33, 0.40], [0, 0.224, 0], 'ellipsoid'),
    helmet: bodyData(2.2, [rx * 2, ry * 2, rz * 2], [0, 0.224, 0.016], 'ellipsoid'),
    backpack: bodyData(8.5, [w, h, d], [0, 0, -d * 0.53 - 0.028]),
  };
  const links = [
    cone('pelvis', 'torso', [0, 1, 0], 22, 25),
    cone('torso', 'head', [0, 1, 0], 32, 52),
    fixed('head', 'helmet'), fixed('torso', 'backpack'),
  ];
  for (const [label, s] of [['L', 1], ['R', -1]]) {
    const shoulder = joint(torso, `upper_arm_${label}`, [s * 0.314, 0.424, 0.001]);
    const elbow = joint(shoulder, `forearm_${label}`, [s * 0.057, -0.212, 0.008]);
    const glove = joint(elbow, `glove_${label}`, [0, -0.176, 0.035]);
    joint(glove, `grip_${label}`, [0, -0.083, 0.022]);
    armParts(shoulder, elbow, glove, id, cfg, s);
    const thigh = joint(pelvis, `thigh_${label}`, [s * 0.138, -0.043, 0]);
    const shin = joint(thigh, `shin_${label}`, [0, -0.235, 0]);
    const boot = joint(shin, `boot_${label}`, [0, -0.224, 0]);
    legParts(thigh, shin, boot, id, cfg, s);
    Object.assign(bodies, {
      [shoulder.name]: bodyData(3.3, [0.178, 0.207, 0.180], [s * 0.034, -0.100, 0]),
      [elbow.name]: bodyData(2.5, [0.166, 0.161, 0.176], [0, -0.083, 0.014]),
      [glove.name]: bodyData(0.7, [0.143, 0.149, 0.085], [0, -0.082, 0.022]),
      [thigh.name]: bodyData(5.3, [0.211, 0.209, 0.223], [0, -0.108, 0]),
      [shin.name]: bodyData(4.1, [0.206, 0.181, 0.224], [0, -0.108, 0]),
      [boot.name]: bodyData(1.9, [id === 'mars' ? 0.252 : 0.224, 0.125, id === 'mars' ? 0.346 : 0.302],
        [0, -0.050, id === 'mars' ? 0.053 : 0.040]),
    });
    links.push(cone('torso', shoulder.name, [0, -1, 0], 85, 40), hinge(shoulder.name, elbow.name, [-137, 9]),
      cone(elbow.name, glove.name, [0, -1, 0], 32, 50), cone('pelvis', thigh.name, [0, -1, 0], 70, 28),
      hinge(thigh.name, shin.name, [-5, 136]), cone(shin.name, boot.name, [0, -1, 0], 34, 15));
  }
  root.traverse(part => {
    finishPart(part);
    if (bodies[part.name]) part.userData.rigidPart = part.name;
  });
  return { root, physics: { bodies, links } };
}

export function createAccessory(id) {
  const cfg = suits[id];
  const root = new Group();
  root.name = cfg.accessory;
  root.userData = { mount: 'grip_eva_v1', pinAxis: '+Z', units: 'meter' };
  cylinder(root, dark, 0.033, 0.124, [0, 0, 0], onZ, 'rubber');
  const z = 0.073;
  if (id === 'apollo') {
    cylinder(root, steel, 0.021, 0.400, [0, 0.052, z], undefined, 'alloy', 10);
    block(root, cfg.secondary, [0.056, 0.130, 0.061], [0, -0.036, z], 0.010);
    block(root, steel, [0.155, 0.133, 0.083], [0, 0.295, z + 0.019], 0.015, [-0.26, 0, 0], 'alloy');
    block(root, dark, [0.119, 0.058, 0.009], [0, 0.305, z + 0.067], 0.006, [-0.26, 0, 0]);
    for (const s of [-1, 1]) {
      block(root, ice, [0.020, 0.098, 0.026], [s * 0.064, 0.321, z + 0.059], 0.004, [-0.26, 0, 0]);
    }
  } else if (id === 'artemis') {
    block(root, cfg.secondary, [0.071, 0.210, 0.071], [0, 0.032, z], 0.013);
    block(root, ice, [0.165, 0.105, 0.116], [0, 0.166, z + 0.016], 0.019, [-0.15, 0, 0]);
    block(root, dark, [0.121, 0.075, 0.014], [0, 0.164, z + 0.077], 0.010, [-0.15, 0, 0]);
    block(root, screen, [0.082, 0.032, 0.009], [0, 0.168, z + 0.087], 0.004);
    cylinder(root, cfg.accent, 0.016, 0.024, [0, 0.075, z + 0.034], onZ);
  } else if (id === 'iss') {
    block(root, cfg.accent, [0.067, 0.131, 0.073], [0, 0.026, z], 0.010);
    cylinder(root, dark, 0.095, 0.064, [0, 0.126, z + 0.008], onZ);
    cylinder(root, cfg.accent, 0.081, 0.013, [0, 0.126, z + 0.045], onZ);
    port(root, 0, 0.125, z + 0.053, steel, 0.028);
    line(root, steel, [[0.060, 0.168, z], [0.130, 0.218, z], [0.159, 0.202, z],
      [0.131, 0.174, z], [0.108, 0.176, z]], 0.009, 'alloy', 8);
  } else {
    block(root, cfg.accent, [0.069, 0.212, 0.069], [0, 0.047, z], 0.011);
    block(root, cfg.base, [0.192, 0.076, 0.079], [0, 0.165, z], 0.010);
    for (let i = 0; i < 6; i++) {
      block(root, dark, [0.024, 0.048, 0.059], [-0.075 + i * 0.030, 0.212, z], 0.003, undefined, 'rubber');
    }
  }
  finishPart(root);
  return root;
}
