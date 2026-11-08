import * as T from 'three';
import { X, Y, Z, m, tau, num, neg, node, part, joint, mount, ports, placed, polar, yaw, rot, vec, mesh,
  lathe, cylinder, ring, box, rod, nozzle, sphere, solar, optics, rtg } from './geometry.mjs';
import { falconLaunch, titanLaunch, registerTitan } from './launchers.mjs';

function liciacube(deployed = true) {
  const root = node('liciacube');
  box(root, m.black, [0.224, 0.108, 0.344], [0, 0.054, 0]);
  for (const x of [-0.115, 0.115]) {
    for (const y of [0.01, 0.097]) rod(root, m.alloy, [x, y, -0.175], [x, y, 0.175], 0.009, 6);
  }
  box(root, m.gold, [0.212, 0.094, 0.022], [0, 0.054, 0.175]);
  for (const [name, x, r] of [['luke', -0.052, 0.023], ['leia', 0.053, 0.033]]) {
    optics(part(root, name, [x, 0.06, 0.188], neg(Z)), r, 0.025);
  }
  for (const [i, side] of [-1, 1].entries()) {
    const hinge = joint(root, `wing_${num(i)}`, [side * 0.12, 0.07, -0.12], X, deployed ? 0 : Math.PI / 2, neg(X));
    hinge.quaternion.premultiply(yaw(side * Math.PI / 2));
    const panel = node('panel', hinge, [0, 0, 0.098]);
    solar(panel, 0.139, 0.184, 4, 5);
    const aerial = joint(root, `antenna_${num(i)}`, [side * 0.102, 0.103, -0.123], X, deployed ? 0 : -1.1);
    rod(aerial, m.alloy, [0, 0, 0], [side * 0.078, 0.134, 0.013], 0.0032, 6);
  }
  nozzle(root, 'cold_gas_nozzle', [0, 0.059, -0.177], 0.014, 0.02, neg(Z));
  mount(root, 'mount_deployer', [0, 0.054, -0.188], neg(Z));
  return root;
}

function dartBus() {
  const root = node('dart_bus');
  box(root, m.gold, [1.26, 1.18, 1.28], [0, 0.63, 0]);
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const blanket = node(`blanket_${num(Math.round(a * 2 / Math.PI))}`, root, polar(0.648, a, 0.65));
    blanket.quaternion.copy(yaw(a));
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        box(blanket, m.foil[(x * 5 + y * 3 + (x * y) % 5) % m.foil.length],
          [0.248, 0.234, 0.019], [(x - 2) * 0.25, (y - 2) * 0.236, 0.002 * Math.sin(x + y)]);
      }
    }
    for (const x of [-0.625, 0.625]) box(blanket, m.alloy, [0.028, 1.216, 0.036], [x, 0, 0.006]);
  }
  box(root, m.alloy, [1.31, 0.076, 1.3], [0, 0.07, 0]);
  box(root, m.gold, [1.28, 0.067, 1.31], [0, 1.244, 0]);
  ring(root, m.alloy, 0.57, 0.49, 0, 0.054);
  mount(root, 'mount_aft', [0, 0, 0], neg(Y));
  for (const [name, xyz, axis] of [['rosa_l', [-0.652, 0.69, 0.13], neg(X)], ['rosa_r', [0.652, 0.69, 0.13], X],
    ['draco', [-0.35, 0.82, 0.655], Z], ['rlsa', [0.37, 1.25, 0.19], Y],
    ['propulsion', [0, 0.62, -0.653], neg(Z)], ['liciacube', [0.28, 0.39, 0.654], Z]]) mount(root, `mount_${name}`, xyz, axis);
  return root;
}

function rosa(side, deployed) {
  const root = node(`dart_rosa_${side < 0 ? 'l' : 'r'}`);
  const hinge = joint(root, 'deployment', [0, 0, 0], X, deployed ? 0 : -Math.PI / 2, neg(Z));
  hinge.userData.angleRadians = Math.PI / 2;
  const drum = joint(hinge, 'roller', [0, 0, 0.17], X);
  rod(drum, m.steel, [-0.45, 0, 0], [0.45, 0, 0], 0.085);
  for (const x of [-0.45, 0.45]) rod(drum, m.alloy, [x, 0, 0], [x, 0.01, 0], 0.11);
  const blanket = part(hinge, 'blanket', [0, 0.094, 0.19], neg(Z));
  if (deployed) {
    const length = 7.98;
    const panel = node('cells', blanket, [0, 0, length / 2]);
    solar(panel, 0.91, length, 9, 41);
    for (const x of [-0.448, 0.448]) rod(blanket, m.alloy, [x, -0.018, 0], [x, -0.018, length], 0.012);
    rod(blanket, m.steel, [-0.46, 0, length], [0.46, 0, length], 0.033);
  } else {
    blanket.position.set(0, 0, 0.17);
    rod(blanket, m.solar, [-0.428, 0, 0], [0.428, 0, 0], 0.105, 32);
  }
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  return root;
}

function draco(covered) {
  const root = node('dart_draco');
  box(root, m.steel, [0.298, 0.285, 0.53], [0, 0, 0.245]);
  box(root, m.bright, [0.308, 0.311, 0.19], [0, 0, 0.149]);
  for (const x of [-0.105, 0.105]) rod(root, m.alloy, [x, -0.166, 0.035], [x, -0.166, 0.5], 0.023);
  optics(node('telescope', root, [0, 0, 0.472]), 0.124, 0.22, m.dark);
  if (covered) {
    const cap = part(root, 'cover', [0, 0, 0.691], neg(Z));
    rod(cap, m.white, [0, 0, -0.013], [0, 0, 0.013], 0.126, 32);
    box(cap, m.red, [0.079, 0.032, 0.012], [0.044, 0, 0.02]);
  }
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  return root;
}

function rlsa() {
  const root = node('dart_rlsa');
  const base = joint(root, 'azimuth', [0, 0, 0], Y);
  cylinder(base, m.steel, 0.099, 0, 0.089);
  const dish = joint(base, 'elevation', [0, 0.115, 0], X, 0.3);
  cylinder(dish, m.bright, 0.324, 0, 0.034);
  for (let i = 0; i < 9; i++) ring(dish, m.alloy, 0.041 + i * 0.032, 0.036 + i * 0.032, 0.034, 0.037);
  mount(root, 'mount_bus', [0, 0, 0], neg(Y));
  return root;
}

function dartPropulsion() {
  const root = node('dart_propulsion');
  box(root, m.alloy, [0.56, 0.51, 0.065]);
  const next = part(root, 'next_c', [0, 0.013, -0.035], Z);
  next.userData.role = 'ion_thruster';
  rod(next, m.steel, [0, 0, 0], [0, 0, -0.15], 0.196, 48, 0.24);
  const grid = node('ion_grid', next, [0, 0, -0.154]);
  rod(grid, m.dark, [0, 0, 0.005], [0, 0, -0.016], 0.208, 48);
  for (let row = -7; row <= 7; row++) {
    for (let column = -7; column <= 7; column++) {
      const x = column * 0.027;
      const y = row * 0.027;
      if (Math.hypot(x, y) > 0.196) continue;
      rod(grid, m.alloy, [x, y, -0.018], [x, y, -0.02], 0.0049, 6);
    }
  }
  for (const [i, [x, y]] of [[-0.44, -0.35], [0.44, -0.35], [-0.44, 0.37], [0.44, 0.37]].entries()) {
    const cluster = part(root, `hydrazine_cluster_${num(i)}`, [x, y, -0.041], Z);
    cluster.userData.role = 'chemical_thruster_cluster';
    box(cluster, m.alloy, [0.165, 0.165, 0.11]);
    for (const [j, dx] of [-0.045, 0.045].entries()) nozzle(cluster, `thruster_${num(j)}`, [dx, 0, -0.037], 0.035, 0.066, [dx * 5, Math.sign(y) * 0.3, -1]);
  }
  mount(root, 'mount_bus', [0, 0, 0], Z);
  return root;
}

function deployer(open) {
  const root = node('dart_liciacube_mount');
  box(root, m.alloy, [0.282, 0.173, 0.037], [0, 0, 0.016]);
  for (const x of [-0.13, 0.13]) box(root, m.alloy, [0.025, 0.158, 0.321], [x, 0, 0.164]);
  box(root, m.black, [0.26, 0.021, 0.33], [0, -0.082, 0.171]);
  const hatch = joint(root, 'door', [0, 0.081, 0.335], X, open ? -1.92 : 0, neg(Z));
  box(hatch, m.dark, [0.277, 0.168, 0.022], [0, -0.084, 0.011]);
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  mount(root, 'mount_liciacube', [0, 0, 0.037], Z);
  return root;
}

function dart(pose = 'flight') {
  const root = node('dart');
  const launch = pose === 'launch';
  const carrying = launch || pose === 'carrying';
  placed(root, dartBus());
  for (const side of [-1, 1]) placed(root, rosa(side, !launch), [side * 0.652, 0.69, 0.13], yaw(side * Math.PI / 2));
  placed(root, draco(launch), [-0.35, 0.82, 0.655]);
  placed(root, rlsa(), [0.37, 1.25, 0.19]);
  placed(root, dartPropulsion(), [0, 0.62, -0.653]);
  placed(root, deployer(!carrying), [0.28, 0.39, 0.654]);
  if (carrying) placed(root, liciacube(false), [0.28, 0.336, 0.879]);
  mount(root, 'mount_launch_adapter', [0, 0, 0], neg(Y));
  return root;
}

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function asteroid(id, major, seed) {
  const root = node(id);
  const random = seeded(seed);
  const axes = major ? [420, 309, 389] : [88.5, 58, 84];
  const palette = major ? [0x695f55, 0x6f655a, 0x796d61, 0x7c6f64, 0x665d54]
    : [0x85776a, 0x8e8075, 0x74685d, 0x91857b, 0x807269];
  const materials = palette.map((color, i) => new T.MeshStandardMaterial({ name: `Regolith ${i + 1}`, color, roughness: 0.95, flatShading: true }));
  const surface = ([x, y, z]) => {
    const wave = 1 + 0.048 * Math.sin(10 * x + 6 * y) * Math.cos(7 * z - 5 * y) +
      0.019 * Math.sin(23 * z + 17 * x) * Math.cos(14 * y + 12 * x) +
      (major ? 0.085 * Math.exp(-15 * y * y) : 0.035 * Math.sin(6 * x + 4 * z));
    return [x * axes[0] * wave, y * axes[1] * wave, z * axes[2] * wave];
  };
  const geometry = new T.IcosahedronGeometry(1, 17);
  const position = geometry.attributes.position;
  const baseColors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 3) {
    const tint = new T.Color(palette[Math.floor(random() * palette.length)]);
    for (let k = i; k < i + 3; k++) {
      position.setXYZ(k, ...surface([position.getX(k), position.getY(k), position.getZ(k)]));
      tint.toArray(baseColors, k * 3);
    }
  }
  geometry.setAttribute('color', new T.BufferAttribute(baseColors, 3));
  geometry.computeVertexNormals();
  const rock = new T.MeshStandardMaterial({ name: 'Facet colors', roughness: 0.95, vertexColors: true, flatShading: true });
  const body = node('surface', root);
  mesh(body, geometry, rock);
  const rocks = node('boulders', root);
  const count = major ? 270 : 420;
  for (let i = 0; i < count; i++) {
    const y = 2 * random() - 1;
    const phi = random() * tau;
    const r = Math.sqrt(1 - y * y);
    const size = (major ? 17 : 7.5) * (0.09 + 0.91 * random() ** 3.1);
    const point = surface([r * Math.sin(phi), y, r * Math.cos(phi)]);
    const position = vec(point).addScaledVector(vec(point).normalize(), -0.17 * size).toArray();
    mesh(rocks, new T.DodecahedronGeometry(1, 0), materials[i % materials.length], position, yaw(random() * tau),
      [size, size * (0.53 + 0.5 * random()), size * (0.65 + 0.38 * random())]);
  }
  Object.assign(root.userData, { historicalPose: 'before_impact', scaleClass: 'shape_approximation' });
  return root;
}

export function registerDart(out) {
  for (const item of [dartBus(), rosa(-1, true), rosa(1, true), draco(true), rlsa(), dartPropulsion(), deployer(false),
    asteroid('didymos', true, 1974), asteroid('dimorphos', false, 2022)]) out.component(item);
  out.assembly(dart(), 'rosa_deployed_liciacube_separated');
  out.assembly(liciacube(), 'wings_deployed');
  out.assembly(falconLaunch('dart_falcon9_launch', dart('launch'), 'closed'), 'launch');
  out.variant('dart_falcon9_fairing_open', 'fairing_halves_separated', falconLaunch('dart_falcon9_launch', dart('launch'), 'open'));
  out.variant('dart_stowed', 'wings_stowed', dart('launch'));
  out.variant('dart_with_liciacube', 'wings_deployed_liciacube_attached', dart('carrying'));
  out.variant('dart_rosa_l_rolled', 'blanket_rolled', rosa(-1, false));
  out.variant('dart_rosa_r_rolled', 'blanket_rolled', rosa(1, false));
  out.variant('liciacube_stowed', 'wings_stowed', liciacube(false));
  const released = node('dart_liciacube_separation');
  placed(released, dart());
  placed(released, liciacube(), [0.28, 0.336, 2.45]);
  out.assembly(released, 'liciacube_separated');
  const binary = node('didymos_binary');
  placed(binary, asteroid('didymos', true, 1974));
  const orbit = node('dimorphos_orbit', binary, undefined, { role: 'orbit', radiusMeters: 1190, axis: Y, state: 'before_impact' });
  placed(orbit, asteroid('dimorphos', false, 2022), [1190, 0, 0], yaw(0.8));
  out.assembly(binary, 'pre_impact_binary_scale');
}

function voyagerBus() {
  const root = node('voyager_bus');
  cylinder(root, m.black, 0.86, 0.07, 0.54, undefined, 10);
  cylinder(root, m.bright, 0.865, 0.51, 0.56, undefined, 10);
  cylinder(root, m.alloy, 0.826, 0.028, 0.074, undefined, 10);
  const face = 0.86 * Math.cos(Math.PI / 10);
  for (let i = 0; i < 10; i++) {
    const a = (i + 0.5) * tau / 10;
    const panel = part(root, `equipment_bay_${num(i)}`, polar(face, a, 0.3), neg(Z));
    panel.quaternion.copy(yaw(a));
    box(panel, i % 3 === 0 ? m.gold : m.black, [0.493, 0.409, 0.026]);
    for (const x of [-0.235, 0.235]) box(panel, m.alloy, [0.014, 0.438, 0.029], [x, 0, 0.015]);
    if (i % 2 === 0) box(panel, m.steel, [0.22, 0.15, 0.082], [0.09, -0.04, 0.047]);
    if (i % 3 === 0) nozzle(panel, 'attitude_thruster', [-0.17, -0.13, 0.064], 0.039, 0.071, [0.4, 0, 1]);
  }
  for (const [id, xyz, direction] of [['hga', [0, 0.56, 0], Y], ['rtg', [-0.816, 0.26, 0], neg(X)], ['mag', [0.83, 0.39, 0.14], X],
    ['radio', [-0.24, 0.48, -0.78], neg(Z)], ['scan', [0.28, 0.35, -0.79], neg(Z)], ['record', [0.27, 0.28, 0.804], Z]]) {
    mount(root, `mount_${id}`, xyz, direction);
  }
  mount(root, 'mount_injection_stage', [0, 0, 0], neg(Y));
  return root;
}

function voyagerHga() {
  const root = node('voyager_hga');
  const radius = 1.85;
  const curve = Array.from({ length: 24 }, (_, i) => [radius * i / 23, 0.14 + 0.39 * (i / 23) ** 2]);
  lathe(root, m.white, [...curve].reverse(), { segments: 88 });
  lathe(root, m.alloy, curve.map(([r, y]) => [r, y - 0.022]), { segments: 88 });
  ring(root, m.bright, radius, radius - 0.036, 0.506, 0.541, { segments: 88 });
  cylinder(root, m.alloy, 0.21, 0, 0.18);
  const feed = part(root, 'feed', [0, 1.03, 0]);
  cylinder(feed, m.gold, 0.083, -0.16, 0.05);
  cylinder(feed, m.bright, 0.15, 0.043, 0.093, undefined, 32, 0.087);
  for (let i = 0; i < 3; i++) rod(root, m.bright, polar(1.48, i * tau / 3, 0.4), polar(0.075, i * tau / 3, 1.012), 0.023);
  mount(root, 'mount_bus', [0, 0, 0], neg(Y));
  return root;
}

function voyagerRtg(deployed) {
  const root = node('voyager_rtg_boom');
  const boom = joint(root, 'deployment', [0, 0, 0], Y, deployed ? 0 : 1.68, neg(Z));
  const beamLength = deployed ? 1.12 : 0.24;
  for (const x of [-0.081, 0.081]) rod(boom, m.alloy, [x, 0, 0], [x, 0, beamLength + 0.06], 0.022);
  rod(boom, m.steel, [-0.081, 0, beamLength * 0.1], [0.081, 0, beamLength * 0.93], 0.02);
  for (let i = 0; i < 3; i++) {
    const z = beamLength + 0.57 * i;
    const generator = part(boom, `rtg_${num(i)}`, [0, 0, z], neg(Z));
    generator.quaternion.copy(rot(X, Math.PI / 2));
    rtg(generator, 0.49, 0.18, 12);
    if (i < 2) rod(boom, m.alloy, [0, 0, z + 0.47], [0, 0, z + 0.58], 0.049);
  }
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  return root;
}

function voyagerMag(deployed) {
  const root = node('voyager_mag_boom');
  box(root, m.alloy, [0.29, 0.25, 0.36], [0, 0, 0.165]);
  const boom = part(root, 'deployable_truss', [0, 0, 0.343], neg(Z));
  boom.userData.deployment = deployed ? 'extended' : 'in_canister';
  const sections = deployed ? 42 : 6;
  const length = deployed ? 12.66 : 0.215;
  const corners = Array.from({ length: 3 }, (_, i) => [0.078 * Math.cos(tau * i / 3), 0.078 * Math.sin(tau * i / 3)]);
  for (let i = 0; i < sections; i++) {
    const a = i / sections * length;
    const b = (i + 1) / sections * length;
    for (const [k, [x, y]] of corners.entries()) {
      const [nx, ny] = corners[(k + 1) % corners.length];
      rod(boom, m.bright, [x, y, a], [x, y, b], 0.0075, 6);
      rod(boom, m.steel, [x, y, a], [nx, ny, b], 0.0065, 6);
      rod(boom, m.alloy, [x, y, b], [nx, ny, b], 0.006, 6);
    }
  }
  for (const [i, z] of (deployed ? [5.657, length] : [0.11, 0.205]).entries()) {
    const sensor = part(boom, `magnetometer_${num(i)}`, [0, 0.03, z], neg(Z));
    box(sensor, m.black, [0.14, 0.14, 0.12]);
    box(sensor, m.gold, [0.079, 0.082, 0.049], [0, 0.048, 0.061]);
  }
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  return root;
}

function voyagerRadio(deployed) {
  const root = node('voyager_radio_antennas');
  box(root, m.steel, [0.24, 0.15, 0.164]);
  for (const [i, side] of [-1, 1].entries()) {
    const whip = joint(root, `whip_${num(i)}`, [side * 0.07, 0, 0.08], Y, side * (deployed ? 0.56 : 0.2), neg(Z));
    rod(whip, m.alloy, [0, 0, 0], [0, 0, deployed ? 10 : 0.37], 0.0105, 8, 0.0055);
  }
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  return root;
}

function voyagerScan(stowed) {
  const root = node('voyager_scan_platform');
  const hinge = joint(root, 'boom', [0, 0, 0], Y, stowed ? Math.PI / 2 : 0, neg(Z));
  for (const x of [-0.083, 0.083]) rod(hinge, m.alloy, [x, 0, 0], [x, 0, 1.39], 0.021);
  rod(hinge, m.steel, [-0.08, 0, 0.12], [0.08, 0, 1.23], 0.02);
  const pan = joint(hinge, 'azimuth', [0, 0, 1.37], Y, 0.24);
  const head = joint(pan, 'elevation', [0, 0.06, 0], X, -0.17);
  box(head, m.gold, [0.42, 0.14, 0.371]);
  for (const [name, x, y, r, length] of [['wide_angle', -0.1, 0.13, 0.072, 0.17],
    ['narrow_angle', 0.117, 0.135, 0.065, 0.38], ['iris', -0.12, -0.09, 0.086, 0.13], ['uvs', 0.12, -0.067, 0.044, 0.115]]) {
    const tool = part(head, name, [x, y, 0.135], neg(Z));
    optics(tool, r, length, name === 'uvs' ? m.gold : m.bright);
  }
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  return root;
}

function voyagerRecord() {
  const root = node('voyager_record');
  const q = rot(X, Math.PI / 2);
  lathe(root, m.gold, [[0, 0], [0.151, 0], [0.155, 0.018], [0.15, 0.029], [0, 0.029]], { quaternion: q, segments: 64 });
  for (const radius of [0.133, 0.143]) ring(root, m.nickel, radius, radius - 0.002, 0.028, 0.032, { quaternion: q });
  for (let i = 0; i < 13; i++) {
    const a = i * tau / 13 + Math.sin(i * 15) * 0.11;
    rod(root, m.nickel, [-0.033, -0.024, 0.031], [-0.033 + Math.cos(a) * 0.056, -0.024 + Math.sin(a) * 0.049, 0.031], 0.0009, 6);
  }
  for (let i = 0; i < 5; i++) rod(root, m.nickel, [0.028, 0.02 + i * 0.009, 0.031], [0.093 - i * 0.003, 0.02 + i * 0.009, 0.031], 0.0009, 6);
  mount(root, 'mount_bus', [0, 0, 0], neg(Z));
  return root;
}

function voyager(stowed = false) {
  const root = node('voyager_2');
  placed(root, voyagerBus());
  placed(root, voyagerHga(), [0, 0.56, 0]);
  placed(root, voyagerRtg(!stowed), [-0.816, 0.26, 0], yaw(-Math.PI / 2));
  placed(root, voyagerMag(!stowed), [0.83, 0.39, 0.14], yaw(Math.PI / 2 - 0.14));
  placed(root, voyagerRadio(!stowed), [-0.24, 0.48, -0.78], yaw(Math.PI).multiply(rot(X, -0.18)));
  placed(root, voyagerScan(stowed), [0.28, 0.35, -0.79], yaw(Math.PI - 0.3));
  placed(root, voyagerRecord(), [0.27, 0.28, 0.804], yaw(Math.PI / 10));
  mount(root, 'mount_injection_stage', [0, 0, 0], neg(Y));
  return root;
}

function injection() {
  const root = node('voyager_injection_stage');
  lathe(root, m.alloy, [[0.74, 0.02], [0.83, 0.14], [0.68, 0.27], [0.61, 0.88], [0.84, 1.18], [0.85, 1.24]]);
  sphere(root, m.bright, [0.59, 0.43, 0.59], [0, 0.58, 0]);
  nozzle(root, 'tem_364_4_nozzle', [0, 0.39, 0], 0.25, 0.34);
  ports(root, 1.24);
  return root;
}

export function registerVoyager(out) {
  registerTitan(out);
  for (const item of [voyagerBus(), voyagerHga(), voyagerRtg(true), voyagerMag(true), voyagerRadio(true),
    voyagerScan(false), voyagerRecord(), injection()]) out.component(item);
  out.assembly(voyager(), 'science_booms_deployed');
  const payload = node('voyager_titan_payload');
  placed(payload, injection());
  placed(payload, voyager(true), [0, 1.24, 0]);
  out.assembly(titanLaunch(payload), 'launch');
  out.variant('voyager_fairing_open', 'fairing_halves_separated', titanLaunch(payload.clone(true), true));
  out.variant('voyager_2_stowed', 'booms_stowed', voyager(true));
  out.variant('voyager_mag_boom_stowed', 'canister', voyagerMag(false));
  out.variant('voyager_rtg_boom_stowed', 'launch', voyagerRtg(false));
  out.variant('voyager_radio_antennas_stowed', 'launch', voyagerRadio(false));
}
