import { X, Y, Z, m, tau, num, neg, node, part, joint, mount, placed, polar, yaw, rot,
  lathe, cylinder, ring, box, rod, nozzle, sphere, solar, optics, rtg } from './geometry.mjs';
import { atlasLaunch, registerAtlas } from './launchers.mjs';
import { parachutes } from './artemis.mjs';

const front = 1.35;
const aft = -1.36;

function radio(parent, prefix, modern) {
  const root = parent ? part(parent, prefix, [0, 0.95, -0.92]) : node(prefix);
  if (!parent) mount(root, 'mount_deck', [0, 0, 0], neg(Y));
  const generator = part(root, 'mmrtg', [0.38, -0.18, -0.47], neg(Z));
  generator.quaternion.copy(rot(Z, Math.PI / 2));
  rtg(generator, 0.66, 0.28);
  for (const x of [-0.68, 0.68]) rod(root, m.steel, [x, -0.24, -0.12], [x, -0.22, -0.57], 0.036);
  const high = joint(root, 'high_gain', [-0.56, 0.18, 0.16], Y, -0.49);
  rod(high, m.steel, [0, 0, 0], [0, 0.22, 0], 0.044);
  const dish = joint(high, 'elevation', [0, 0.235, 0], X, -0.33);
  cylinder(dish, m.alloy, 0.23, 0, 0.042, undefined, 6);
  cylinder(dish, modern ? m.white : m.bright, 0.218, 0.041, 0.052, undefined, 6);
  const low = part(root, 'low_gain', [0.55, 0.18, 0.2]);
  cylinder(low, m.white, 0.036, 0, 0.25);
  cylinder(low, m.steel, 0.07, 0, 0.035);
  const uhf = part(root, 'uhf', [0.73, 0.17, 0.61]);
  rod(uhf, m.steel, [0, 0, 0], [0.02, 0.33, 0], 0.016);
  return root;
}

function body(id, modern, cut) {
  const root = node(`${id}_body`);
  box(root, m.steel, [1.84, 0.12, 2.38], [0, 0.58, 0]);
  if (!cut) box(root, m.bright, [1.91, 0.45, 2.38], [0, 0.84, 0]);
  const deck = node('deck', root);
  for (const x of (cut ? [-0.74] : [-0.52, 0.52])) {
    box(deck, m.white, [cut ? 0.39 : 0.99, 0.11, 2.49], [x, 1.06, 0]);
    for (let i = 0; i < 4; i++) {
      const z = -1.06 + i * 0.66;
      box(deck, m.alloy, [0.32, 0.046, 0.42], [x, 1.137, z]);
      for (const offset of [-0.12, 0.12]) box(deck, m.steel, [0.025, 0.018, 0.34], [x + offset, 1.169, z]);
    }
  }
  for (const side of [-1, 1]) {
    if (cut && side > 0) continue;
    for (let i = 0; i < 4; i++) {
      const z = (i - 1.5) * 0.596;
      box(root, i % 2 ? m.white : m.bright, [0.076, 0.36, 0.57], [side * 0.96, 0.83, z]);
      for (const y of [0.69, 0.97]) box(root, m.steel, [0.02, 0.046, 0.47], [side * 1.005, y, z]);
    }
  }
  for (const [group, z] of [['front', front], ['rear', aft]]) {
    const frame = node(`${group}_equipment`, root, [0, 0.83, z]);
    box(frame, m.alloy, [1.73, 0.27, 0.21]);
    for (const [i, x] of (modern && group === 'front' ? [-0.74, -0.48, 0.48, 0.74] : [-0.67, 0.67]).entries()) {
      const camera = part(frame, `hazcam_${num(i)}`, [x, -0.06, 0.121 * Math.sign(z)], neg(Z));
      camera.quaternion.copy(yaw(z > 0 ? x * 0.28 : Math.PI));
      box(camera, m.black, [0.109, 0.102, 0.038]);
      optics(camera, modern ? 0.033 : 0.031, 0.034);
    }
  }
  if (!modern) radio(root, 'power_comms', modern);
  for (const [name, at, axis] of [['mast', [0.64, 1.12, 0.64], Y], ['arm', [-0.39, 0.78, 1.25], Z],
    ['suspension_left', [-0.97, 0.65, -0.03], neg(X)], ['suspension_right', [0.97, 0.65, -0.03], X],
    ['skycrane', [0, 1.16, 0], Y]]) mount(root, `mount_${name}`, at, axis);
  if (modern) mount(root, 'mount_ingenuity', [0.1, 0.52, -0.04], neg(Y));
  return root;
}

function wheel(parent, name, modern) {
  const outer = modern ? 0.262 : 0.25;
  const width = modern ? 0.218 : 0.394;
  const tire = joint(parent, name, [0, 0, 0], X);
  const shell = node('rim', tire);
  const x = rot(Z, -Math.PI / 2);
  lathe(shell, modern ? m.steel : m.alloy, [[outer * 0.47, -width / 2], [outer, -width / 2],
    [outer, width / 2], [outer * 0.47, width / 2]], { quaternion: x, segments: 36 });
  lathe(shell, m.dark, [[outer * 0.44, width / 2], [outer * 0.44, -width / 2]], { quaternion: x, segments: 24 });
  rod(shell, m.nickel, [-width / 2 - 0.02, 0, 0], [width / 2 + 0.025, 0, 0], 0.106, 20);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = i * tau / 6;
      rod(shell, m.steel, [side * width / 2, 0, 0], [side * width / 2, outer * 0.46 * Math.cos(a), outer * 0.46 * Math.sin(a)], 0.021);
    }
  }
  const count = modern ? 48 : 24;
  for (let i = 0; i < count; i++) {
    const angle = i * tau / count;
    const tilt = rot(X, angle);
    const radial = [0, outer * Math.cos(angle), outer * Math.sin(angle)];
    if (modern) {
      for (const half of [-1, 1]) box(shell, m.steel, [width * 0.51, 0.012, 0.009],
        [half * width * 0.25, radial[1], radial[2]], tilt.clone().multiply(rot(Y, half * 0.21)));
    } else {
      const y = 0.014 * (i % 3 === 0 ? 1.3 : 1);
      box(shell, m.steel, [width * 0.97, y, 0.015], radial, tilt.clone().multiply(rot(Y, (i % 2 ? -1 : 1) * 0.17)));
    }
  }
}

function mobility(id, modern) {
  const root = node(`${id}_mobility`);
  const wheelY = modern ? 0.2681 : 0.2592;
  for (const side of [-1, 1]) {
    const x = side * (modern ? 1.23 : 1.18);
    const rocker = joint(root, side < 0 ? 'rocker_left' : 'rocker_right', [side * 0.96, 0.66, -0.04], X);
    const frontAxis = [x - rocker.position.x, wheelY - 0.66, 1.13];
    const middlePivot = [side * 0.14, -0.14, -0.47];
    rod(rocker, m.steel, [0, 0, 0], [side * 0.16, 0.04, 0.49], 0.052);
    rod(rocker, m.alloy, [side * 0.16, 0.04, 0.49], frontAxis, 0.056);
    rod(rocker, m.alloy, [0, 0, 0], middlePivot, 0.059);
    const bogie = joint(rocker, 'bogie', middlePivot, X);
    const localX = x - rocker.position.x - middlePivot[0];
    const middleAxis = [localX, wheelY - 0.66 - middlePivot[1], 0.43];
    const rearAxis = [localX, wheelY - 0.66 - middlePivot[1], -0.59];
    for (const axis of [middleAxis, rearAxis]) rod(bogie, m.steel, [0, 0, 0], axis, 0.049);
    for (const [host, label, axis, steers] of [[rocker, 'front', frontAxis, true], [bogie, 'middle', middleAxis, false],
      [bogie, 'rear', rearAxis, true]]) {
      const hub = steers ? joint(host, `steer_${label}`, axis, Y) : node('axle_middle', host, axis);
      box(hub, m.alloy, [0.17, 0.18, 0.144]);
      wheel(hub, `wheel_${label}`, modern);
    }
  }
  mount(root, 'mount_left', [-0.97, 0.65, -0.03], X);
  mount(root, 'mount_right', [0.97, 0.65, -0.03], neg(X));
  return root;
}

function mast(id, modern, stowed) {
  const root = node(`${id}_mast`);
  const stem = joint(root, 'deployment', [0, 0, 0], X, stowed ? -Math.PI / 2 : 0);
  stem.userData.angleRadians = Math.PI / 2;
  cylinder(stem, m.steel, 0.117, -0.025, 0.15);
  rod(stem, m.white, [0, 0.12, 0], [0, 0.88, -0.04], 0.071);
  rod(stem, m.steel, [0.074, 0.08, 0], [0.074, 0.81, -0.039], 0.014);
  const azimuth = joint(stem, 'azimuth', [0, 0.85, -0.04], Y, modern ? 0.05 : -0.07);
  const head = joint(azimuth, 'head', [0, 0.1, 0.02], X);
  box(head, m.white, [modern ? 0.5 : 0.48, 0.252, 0.249]);
  box(head, m.steel, [0.45, 0.201, 0.034], [0, 0, 0.131]);
  const pair = modern ? [['mastcam_z_l', -0.126, 0.048], ['mastcam_z_r', 0.126, 0.048]]
    : [['mastcam_34', -0.127, 0.035], ['mastcam_100', 0.13, 0.05]];
  for (const [name, x, radius] of [...pair, ['navcam_l', -0.212, 0.026], ['navcam_r', 0.212, 0.026]]) {
    const camera = part(head, name, [x, name.includes('navcam') ? 0.045 : -0.035, 0.15], neg(Z));
    optics(camera, radius, 0.057);
  }
  const science = part(head, modern ? 'supercam' : 'chemcam', [0, 0.184, -0.025]);
  box(science, m.bright, [0.237, 0.235, 0.258]);
  optics(node('telescope', science, [0, 0, 0.136]), 0.08, 0.047);
  const weather = part(stem, modern ? 'meda_booms' : 'rems_booms', [0, 0.64, -0.025]);
  for (const side of [-1, 1]) {
    const probe = part(weather, side < 0 ? 'boom_l' : 'boom_r', [side * 0.045, 0, 0]);
    rod(probe, m.alloy, [0, 0, 0], [side * 0.19, 0.028 * side, -0.017], 0.022);
    box(probe, m.white, [0.068, 0.049, 0.053], [side * 0.18, 0.028 * side, -0.017]);
  }
  mount(root, 'mount_deck', [0, 0, 0], neg(Y));
  return root;
}

function turret(id, modern) {
  const root = node(`${id}_turret`);
  cylinder(root, m.steel, 0.228, -0.085, 0.13, undefined, 8);
  box(root, m.bright, [0.36, 0.15, 0.28], [0, 0.04, 0.08]);
  const tools = modern ? ['drill', 'pixl', 'sherloc', 'watson', 'gdrt', 'contact_sensor']
    : ['drill', 'drt', 'mahli', 'apxs', 'chimra'];
  for (const [i, name] of tools.entries()) {
    const a = i * tau / tools.length;
    const tool = part(root, name, polar(0.225, a, -0.018), neg(Z));
    tool.quaternion.copy(yaw(a));
    box(tool, i % 2 ? m.alloy : m.bright, [0.125, 0.13, 0.094]);
    if (['drill', 'gdrt', 'contact_sensor'].includes(name)) {
      rod(tool, m.nickel, [0, 0, 0.04], [0, 0, name === 'drill' ? 0.26 : 0.133], name === 'drill' ? 0.027 : 0.017);
      if (name === 'drill') ring(tool, m.steel, 0.028, 0.014, 0.236, 0.256, { quaternion: rot(X, Math.PI / 2) });
    } else if (name === 'chimra') {
      box(tool, m.alloy, [0.108, 0.011, 0.136], [0, -0.052, 0.118]);
      for (const side of [-1, 1]) box(tool, m.steel, [0.012, 0.039, 0.116], [side * 0.05, -0.035, 0.115]);
    } else if (name === 'drt') {
      rod(tool, m.steel, [0, 0, 0.037], [0, 0, 0.11], 0.037);
      for (const x of [-0.024, 0, 0.024]) rod(tool, m.nickel, [x, 0, 0.102], [x, 0, 0.142], 0.009);
    } else optics(node('aperture', tool, [0, 0, 0.048]), 0.036, 0.034);
  }
  mount(root, 'mount_wrist', [0, 0.13, 0]);
  return root;
}

function arm(id, modern, stowed) {
  const root = node(`${id}_arm`);
  const azimuth = joint(root, 'shoulder_azimuth', [0, 0, 0], Y, stowed ? Math.PI * 0.46 : -0.14, neg(Z));
  const shoulder = joint(azimuth, 'shoulder_elevation', [0, 0, 0.13], X, stowed ? 0.025 : -0.52);
  rod(shoulder, m.alloy, [-0.102, 0, 0], [0.102, 0, 0], 0.128);
  rod(shoulder, m.white, [0, 0, 0.04], [0, 0, 0.71], 0.074);
  rod(shoulder, m.dark, [0.075, 0.05, 0.02], [0.075, 0.05, 0.68], 0.016);
  const elbow = joint(shoulder, 'elbow', [0, 0, 0.71], X, stowed ? 0 : 1.2);
  rod(elbow, m.steel, [-0.087, 0, 0], [0.087, 0, 0], 0.095);
  const fold = joint(elbow, 'forearm', [0, 0, 0.09], Y, stowed ? 2.71 : 0);
  rod(fold, m.bright, [0, 0, 0], [0, 0, 0.56], 0.061);
  rod(fold, m.dark, [-0.066, 0.03, 0.03], [-0.066, 0.03, 0.54], 0.013);
  const wrist = joint(fold, 'wrist', [0, 0, 0.57], X, stowed ? -0.1 : -0.36);
  cylinder(wrist, m.steel, 0.104, -0.04, 0.12);
  const spin = joint(wrist, 'turret_rotation', [0, -0.105, 0.047], Y);
  placed(spin, turret(id, modern), [0, -0.13, 0]);
  mount(root, 'mount_body', [0, 0, 0], neg(Z));
  return root;
}

function sampling() {
  const root = node('perseverance_sampling');
  const carousel = joint(root, 'bit_carousel', [-0.51, 0.01, 0.92], Y);
  cylinder(carousel, m.steel, 0.24, 0, 0.11, undefined, 12);
  for (let i = 0; i < 9; i++) cylinder(carousel, m.black, 0.025, 0.109, 0.124, polar(0.175, i * tau / 9));
  const store = node('tube_storage', root, [0.26, -0.15, 0.03]);
  box(store, m.alloy, [0.48, 0.12, 0.36]);
  for (let i = 0; i < 43; i++) {
    const tube = part(store, `tube_${num(i)}`, [(i % 9 - 4) * 0.049, 0.06, (Math.floor(i / 9) - 2) * 0.068]);
    rod(tube, m.alloy, [0, 0, -0.029], [0, 0, 0.029], 0.0085, 10);
    rod(tube, m.gold, [0, 0, 0.025], [0, 0, 0.033], 0.0106, 10);
  }
  const handler = joint(root, 'transfer_mechanism', [-0.22, -0.055, 0.22], Y);
  box(handler, m.steel, [0.17, 0.1, 0.34]);
  rod(handler, m.alloy, [0, 0.04, 0.1], [0.34, 0.075, 0.15], 0.025);
  mount(root, 'mount_deck', [0, 0, 0]);
  return root;
}

function percyScience(cut = false) {
  const root = node('perseverance_science');
  const rimfax = part(root, 'rimfax', [0, 0, -1.31]);
  box(rimfax, m.bright, [0.88, 0.084, 0.17]);
  rod(rimfax, m.dark, [-0.33, -0.047, 0.042], [0.33, -0.047, 0.042], 0.019);
  const meda = part(root, 'meda_sensors', [-0.68, 0.22, -0.34]);
  box(meda, m.bright, [0.173, 0.074, 0.112]);
  optics(node('radiometer', meda), 0.038, 0.065);
  if (cut) {
    const inside = node('cutaway', root, undefined, { role: 'cutaway' });
    const moxie = part(inside, 'moxie', [-0.62, -0.105, 0.46]);
    box(moxie, m.gold, [0.31, 0.22, 0.241]);
    for (const x of [-0.09, 0.09]) rod(moxie, m.alloy, [x, 0.08, 0.12], [x, 0.11, 0.24], 0.015);
  }
  mount(root, 'mount_deck', [0, 0, 0], neg(Y));
  return root;
}

function labs(cut = true) {
  const root = node('curiosity_labs');
  const inlets = node('sample_inlets', root);
  for (const [i, x] of [-0.25, 0.17].entries()) {
    const cap = joint(inlets, `inlet_cover_${num(i)}`, [x, 0.025, 0.18], X, cut ? -1.2 : 0);
    cylinder(cap, m.alloy, 0.087, 0, 0.045);
    ring(inlets, m.steel, 0.098, 0.049, 0, 0.033, { position: [x, 0.0, 0.18] });
  }
  if (cut) {
    const inside = node('cutaway', root, undefined, { role: 'cutaway' });
    for (const [name, x, size, mat] of [['sam', 0.41, [0.67, 0.28, 0.72], m.alloy],
      ['chemin', -0.35, [0.31, 0.24, 0.31], m.gold]]) {
      const instrument = part(inside, name, [x, -0.29, 0.2]);
      box(instrument, mat, size);
      for (let i = 0; i < 4; i++) box(instrument, m.steel, [0.032, size[1] * 0.8, 0.03], [(i - 1.5) * size[0] * 0.19, 0, size[2] / 2]);
    }
  }
  mount(root, 'mount_deck', [0, 0, 0], neg(Y));
  return root;
}

function ingenuity(stowed = false) {
  const root = node('ingenuity');
  const electronics = part(root, 'electronics', [0, 0.145, 0]);
  box(electronics, m.gold, [0.139, 0.128, 0.164]);
  box(electronics, m.black, [0.143, 0.012, 0.17], [0, 0.057, 0]);
  optics(node('navigation_camera', electronics, [0.025, -0.054, 0.084]), 0.014, 0.014);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * tau / 4;
    const leg = joint(root, `leg_${num(i)}`, polar(0.085, a, 0.145), X, 0);
    leg.quaternion.copy(yaw(a).multiply(rot(X, stowed ? -1.97 : 0)));
    leg.userData.angleRadians = 1.97;
    rod(leg, m.steel, [0, 0, 0], [0, -0.13, 0.183], 0.0048);
    sphere(leg, m.black, [0.009, 0.012, 0.009], [0, -0.133, 0.183], 10);
  }
  rod(root, m.black, [0, 0.18, 0], [0, 0.43, 0], 0.013);
  for (let i = 0; i < 2; i++) {
    const rotor = joint(root, `rotor_${num(i)}`, [0, 0.303 + i * 0.063, 0], Y, i * (stowed ? 0.05 : Math.PI / 2));
    Object.assign(rotor.userData, { spinDirection: i ? -1 : 1 });
    cylinder(rotor, m.steel, 0.025, -0.016, 0.016);
    for (const side of [-1, 1]) {
      const blade = part(rotor, side < 0 ? 'blade_a' : 'blade_b', [0, 0, side * 0.029]);
      box(blade, m.black, [0.057, 0.0064, 0.54], [0, 0, side * 0.27], rot(Z, side * 0.085));
      box(blade, m.bright, [0.046, 0.0066, 0.025], [0, 0, side * 0.556]);
    }
  }
  const panel = part(root, 'solar_panel', [0, 0.433, 0]);
  solar(panel, 0.23, 0.15, 5, 5);
  rod(panel, m.black, [0.105, 0.01, 0.032], [0.107, 0.052, 0.032], 0.0034);
  mount(root, 'mount_carrier', [0, 0.462, 0]);
  return root;
}

function rover(id, { stowed = false, cut = false, carriesHelicopter = false } = {}) {
  const root = node(id);
  const modern = id === 'perseverance';
  placed(root, body(id, modern, cut));
  placed(root, mobility(id, modern));
  placed(root, mast(id, modern, stowed), [0.64, 1.12, 0.64]);
  placed(root, arm(id, modern, stowed), [-0.39, 0.78, 1.25]);
  if (modern) {
    placed(root, radio(undefined, 'perseverance_power_comms', true), [0, 0.95, -0.92]);
    placed(root, percyScience(cut), [0, 0.86, 0]);
    if (cut) placed(root, sampling(), [0, 0.87, 0]);
    if (carriesHelicopter) placed(root, ingenuity(true), [0.1, 0.058, -0.04]);
  } else placed(root, labs(cut), [0, 1.12, 0.05]);
  for (let i = 0; i < 3; i++) mount(root, `mount_bridle_${num(i)}`, polar(0.57, i * tau / 3, 1.16));
  mount(root, 'mount_umbilical', [0.2, 1.17, -0.31]);
  return root;
}

function cruise(modern) {
  const root = node('mars_cruise_stage');
  ring(root, m.alloy, 2.13, 1.22, 0, 0.27);
  ring(root, m.dark, 2.09, 1.22, 0.269, 0.304);
  const count = modern ? 8 : 6;
  for (let i = 0; i < count; i++) {
    const a = (i + 0.5) * tau / count;
    const panel = part(root, `solar_panel_${num(i)}`, polar(1.648, a, 0.31));
    panel.quaternion.copy(yaw(a));
    solar(panel, modern ? 1.09 : 1.44, 0.77, modern ? 12 : 14, 8);
  }
  for (let i = 0; i < 4; i++) {
    const a = i * tau / 4;
    const cluster = part(root, `rcs_${num(i)}`, polar(2.02, a, 0.12), neg(Z));
    cluster.quaternion.copy(yaw(a));
    box(cluster, m.steel, [0.25, 0.205, 0.24]);
    nozzle(cluster, 'thruster_a', [-0.071, 0, 0.1], 0.045, 0.067, Z);
    nozzle(cluster, 'thruster_b', [0.071, 0, 0.1], 0.045, 0.067, [0.56, 0.27, 1]);
  }
  for (const [i, a] of [0.21, 2.6].entries()) {
    const antenna = part(root, `antenna_${num(i)}`, polar(1.8, a, 0.3));
    cylinder(antenna, m.white, i ? 0.079 : 0.22, 0.02, 0.09);
  }
  mount(root, 'mount_aeroshell', [0, 0, 0], neg(Y));
  mount(root, 'mount_launch_adapter', [0, 0.305, 0]);
  return root;
}

function heatshield() {
  const root = node('mars_heatshield');
  const profile = [[0, 0], [0.94, 0.04], [1.57, 0.26], [2.04, 0.62], [2.25, 0.95], [2.246, 1.065],
    [2.2, 1.068], [1.97, 0.72], [1.53, 0.37], [0.91, 0.14], [0, 0.11]];
  lathe(root, m.shield, profile, { segments: 64 });
  ring(root, m.alloy, 2.245, 2.19, 1.024, 1.067);
  for (let i = 0; i < 16; i++) rod(root, m.nickel, polar(1.97, i * tau / 16, 0.723), polar(2.18, i * tau / 16, 1.021), 0.011);
  mount(root, 'mount_backshell', [0, 1.065, 0]);
  return root;
}

function backshell() {
  const root = node('mars_backshell');
  const profile = [[2.25, 0], [2.24, 0.17], [1.93, 0.8], [1.49, 1.29], [0.88, 1.73], [0.63, 1.98]];
  lathe(root, m.bright, profile, { segments: 64 });
  lathe(root, m.gold, [...profile].reverse().map(([r, y]) => [r - 0.05, y]), { segments: 64 });
  for (const [r, y] of [[2.24, 0.12], [1.93, 0.8], [1.49, 1.29], [0.87, 1.73]]) ring(root, m.alloy, r * 1.005, r * 0.98, y, y + 0.032);
  const chute = part(root, 'parachute_cover', [0, 1.93, 0]);
  cylinder(chute, m.white, 0.64, 0, 0.245, undefined, 40, 0.54);
  ring(chute, m.alloy, 0.551, 0.45, 0.245, 0.266);
  for (const side of [-1, 1]) {
    const balance = part(root, side < 0 ? 'balance_mass_l' : 'balance_mass_r', [side * 1.845, 0.74, 0]);
    box(balance, m.dark, [0.23, 0.38, 0.22], [0, 0, 0], rot(Z, side * 0.49));
  }
  mount(root, 'mount_heatshield', [0, 0, 0], neg(Y));
  mount(root, 'mount_cruise', [0, 1.72, 0]);
  mount(root, 'mount_parachute', [0, 2.22, 0]);
  return root;
}

function descent(modern, cables = false) {
  const root = node('mars_descent_stage');
  const frame = node('aluminum_frame', root);
  for (const x of [-0.96, 0.96]) {
    rod(frame, m.alloy, [x, 0.05, -1.13], [x, 0.05, 1.13], 0.05);
    rod(frame, m.alloy, [x, 0.05, -0.92], [x * 0.69, 0.36, 0.12], 0.041);
    rod(frame, m.alloy, [x, 0.05, 0.91], [x * 0.69, 0.36, 0.12], 0.041);
  }
  for (const z of [-1.11, 0, 1.11]) rod(frame, m.alloy, [-0.97, 0.05, z], [0.97, 0.05, z], 0.043);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * tau / 4;
    const pair = part(root, `landing_engines_${num(i)}`, polar(1.53, a, 0.065), neg(Z));
    pair.quaternion.copy(yaw(a));
    box(pair, m.steel, [0.49, 0.17, 0.33]);
    for (const [j, x] of [-0.141, 0.141].entries()) nozzle(pair, `mle_${num(j)}`, [x, -0.01, 0.04], 0.097, 0.23, [x * 0.4, -1, 0.23]);
  }
  const tanks = modern ? [[-0.51, -0.3], [0.55, -0.3], [0, 0.67]] : [[-0.55, -0.33], [0.55, -0.33], [-0.06, 0.65]];
  for (const [i, [x, z]] of tanks.entries()) {
    const tank = part(root, `propellant_tank_${num(i)}`, [x, 0.22, z]);
    sphere(tank, i === 2 ? m.bright : m.gold, [0.34, 0.24, 0.34], [0, 0, 0]);
    ring(tank, m.steel, 0.348, 0.327, -0.019, 0.019);
  }
  const winch = part(root, 'winch', [0, 0.15, -0.03]);
  box(winch, m.steel, [0.39, 0.245, 0.37]);
  rod(winch, m.nickel, [-0.21, -0.025, 0], [0.21, -0.025, 0], 0.085);
  for (let i = 0; i < 3; i++) {
    const origin = polar(0.36, i * tau / 3, 0.01);
    const tether = part(root, `bridle_${num(i)}`, origin, Y);
    if (cables) {
      const end = polar(0.57, i * tau / 3, 1.16 - 7.57).map((v, axis) => v - origin[axis]);
      rod(tether, m.fabric, [0, 0, 0], end, 0.012, 7);
      mount(tether, 'mount_rover', end, neg(Y));
    } else rod(tether, m.fabric, [0, 0, 0], [0.12, -0.07, 0.034], 0.019);
  }
  const link = part(root, 'umbilical', [0.17, 0.0, -0.19], Y);
  if (cables) {
    rod(link, m.dark, [0, 0, 0], [0.18, -2.7, -0.08], 0.014, 8);
    rod(link, m.dark, [0.18, -2.7, -0.08], [0.03, 1.17 - 7.57, -0.12], 0.014, 8);
    mount(link, 'mount_rover', [0.03, 1.17 - 7.57, -0.12], neg(Y));
  } else rod(link, m.dark, [0, 0, 0], [0.063, -0.07, -0.02], 0.016);
  mount(root, 'mount_backshell', [0, 0.51, 0]);
  return root;
}

function spacecraft(id, pose = 'cruise') {
  const root = node(`${id}_spacecraft`);
  const modern = id === 'perseverance';
  placed(root, heatshield());
  const shell = placed(root, backshell(), [0, 1.065, 0]);
  placed(root, rover(id, { stowed: true, carriesHelicopter: modern }), [0, 0.53, 0], yaw(Math.PI / 4));
  placed(root, descent(modern), [0, 1.87, 0], yaw(Math.PI / 4));
  if (pose === 'cruise') placed(root, cruise(modern), [0, 2.785, 0]);
  if (pose === 'parachute') {
    shell.remove(shell.getObjectByName('mars_backshell.parachute_cover'));
    const chute = parachutes(root, 'mars_parachute', 1, 10.75, 30.2);
    chute.position.y = 3.285;
  }
  mount(root, 'mount_launcher', [0, 0, 0], neg(Y));
  return root;
}

export function registerMarsShared(out) {
  registerAtlas(out);
  out.component(cruise(true));
  out.component(backshell());
  out.component(heatshield());
  out.component(descent(true));
  out.component(parachutes(undefined, 'mars_parachute', 1, 10.75, 30.2));
  out.variant('mars_cruise_stage_msl', 'curiosity', cruise(false));
  out.variant('mars_descent_stage_msl', 'curiosity', descent(false));
  out.variant('mars_descent_stage_lowering', 'cables_extended', descent(true, true));
}

export function registerRover(out, id) {
  const modern = id === 'perseverance';
  for (const item of [body(id, modern, false), mobility(id, modern), mast(id, modern, false), arm(id, modern, false), turret(id, modern)]) out.component(item);
  if (modern) {
    out.component(sampling());
    out.component(radio(undefined, 'perseverance_power_comms', true));
    out.component(percyScience());
    out.assembly(ingenuity(), 'rotors_ready');
    out.variant('ingenuity_stowed', 'under_perseverance', ingenuity(true));
    out.assembly(rover(id, { carriesHelicopter: true }), 'ingenuity_attached', 'perseverance_with_ingenuity');
  } else out.component(labs());
  out.assembly(rover(id), 'surface');
  out.assembly(spacecraft(id), 'interplanetary_cruise');
  out.assembly(atlasLaunch(`${id}_atlas_v_541`, spacecraft(id)), 'launch');
  out.variant(`${id}_fairing_open`, 'fairing_halves_separated', atlasLaunch(`${id}_atlas_v_541`, spacecraft(id), true));
  out.variant(`${id}_entry`, 'entry_cruise_stage_separated', spacecraft(id, 'entry'));
  out.variant(`${id}_parachute`, 'parachute_deployed', spacecraft(id, 'parachute'));
  out.variant(`${id}_cutaway`, 'cutaway', rover(id, { cut: true }));
  const skycrane = node(`${id}_sky_crane`);
  placed(skycrane, rover(id, { stowed: true, carriesHelicopter: modern }));
  placed(skycrane, descent(modern, true), [0, 7.57, 0]);
  out.assembly(skycrane, 'sky_crane_lowering');
}
