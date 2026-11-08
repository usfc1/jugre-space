import { AnimationClip, QuaternionKeyframeTrack, MeshStandardMaterial } from 'three';
import { X, Y, Z, m, tau, num, node, neg, polar, yaw, rot, lathe, cylinder, ring, box, rod, sphere,
  optics, solar, rtg, nozzle } from './geometry.mjs';
import { payload } from './model-io.mjs';
import { names } from './reference.mjs';

const material = (name, color, metalness = 0.18) => new MeshStandardMaterial({ name, color, metalness, roughness: 0.55 });
const finish = {
  offwhite: material('JUGRE ceramic shell', 0xe5dfd0), graphite: material('JUGRE graphite', 0x26323a),
  amber: material('JUGRE amber panels', 0xd37734), teal: material('JUGRE survey teal', 0x238181),
  tire: material('JUGRE flexible wheel material', 0x30343a, 0.03),
};

function pivot(parent, id, position, axis, role = 'hinge') {
  return node(id, parent, position, { role, axis });
}

function key(object, axis, angles, times) {
  return new QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, angles.flatMap((angle) => rot(axis, angle).toArray()));
}

function labelPlate(parent, id, position, width, height, color) {
  const tag = node(id, parent, position);
  box(tag, finish.graphite, [width, height, 0.013]);
  for (let i = 0; i < 3; i++) box(tag, color, [width * 0.08, height * 0.6, 0.006],
    [(-0.31 + 0.15 * i) * width, 0, 0.008], rot(Z, -0.4));
  box(tag, m.white, [width * 0.26, height * 0.12, 0.005], [width * 0.24, -height * 0.23, 0.008]);
}

function wheel(host, suffix, at, r, width, steering, color) {
  const knuckle = steering ? pivot(host, `steer_${suffix}`, at, Y) : node(`knuckle_${suffix}`, host, at);
  box(knuckle, m.steel, [width * 0.74, r * 0.53, r * 0.54]);
  const axle = pivot(knuckle, `wheel_${suffix}`, [0, 0, 0], X, 'wheel');
  const q = rot(Z, -Math.PI / 2);
  const tireProfile = [[r * 0.5, -width / 2], [r * 0.86, -width * 0.53], [r * 0.95, -width * 0.42],
    [r * 0.95, width * 0.42], [r * 0.86, width * 0.53], [r * 0.5, width / 2]];
  lathe(axle, finish.tire, tireProfile, { quaternion: q, segments: 40 });
  const count = r > 0.28 ? 30 : 24;
  for (let i = 0; i < count; i++) {
    const a = i * tau / count;
    for (const side of [-1, 1]) {
      const twist = rot(X, a).multiply(rot(Y, 0.23 * side));
      box(axle, finish.graphite, [width * 0.49, r * 0.075, r * 0.14],
        [side * width * 0.235, r * 0.958 * Math.cos(a), r * 0.958 * Math.sin(a)], twist);
    }
  }
  for (const side of [-1, 1]) {
    const at = side * width * 0.52;
    rod(axle, m.alloy, [at, 0, 0], [at + side * 0.027, 0, 0], r * 0.52, 24);
    rod(axle, color, [at + side * 0.026, 0, 0], [at + side * 0.038, 0, 0], r * 0.33, 20);
    for (let i = 0; i < 6; i++) {
      const a = i * tau / 6;
      const [y, z] = [r * 0.41 * Math.cos(a), r * 0.41 * Math.sin(a)];
      rod(axle, m.dark, [at + side * 0.026, y, z], [at + side * 0.035, y, z], 0.013, 6);
    }
  }
}

function roverSuspension(root, heavy) {
  const bodyHalf = heavy ? 0.92 : 0.52;
  const wheelX = heavy ? 1.12 : 0.70;
  const r = heavy ? 0.31 : 0.23;
  const height = heavy ? 0.69 : 0.44;
  for (const side of [-1, 1]) {
    const rocker = pivot(root, side < 0 ? 'rocker_left' : 'rocker_right', [side * bodyHalf, height, 0], X);
    const at = (z) => [side * (wheelX - bodyHalf), r - height, z];
    const f = heavy ? 1.04 : 0.69;
    const armTop = [side * 0.15, 0.05, f * 0.43];
    rod(rocker, m.steel, [0, 0, 0], armTop, heavy ? 0.056 : 0.039);
    rod(rocker, m.alloy, armTop, at(f), heavy ? 0.061 : 0.041);
    rod(rocker, finish.graphite, [0, -0.043, 0], at(f), heavy ? 0.038 : 0.024);
    wheel(rocker, 'front', at(f), r, heavy ? 0.24 : 0.18, true, heavy ? finish.amber : finish.teal);
    if (heavy) {
      const p = [side * 0.11, -0.13, -0.42];
      rod(rocker, m.alloy, [0, 0, 0], p, 0.061);
      const bogie = pivot(rocker, 'bogie', p, X);
      for (const [name, z] of [['middle', -0.02], ['rear', -1.04]]) {
        const relative = at(z).map((n, i) => n - p[i]);
        rod(bogie, m.steel, [0, 0, 0], relative, 0.048);
        wheel(bogie, name, relative, r, 0.24, name === 'rear', finish.amber);
      }
    } else {
      rod(rocker, m.alloy, [0, 0, 0], at(-f), 0.042);
      rod(rocker, finish.graphite, [0, 0.048, -0.01], at(-f), 0.028);
      wheel(rocker, 'rear', at(-f), r, 0.18, true, finish.teal);
    }
  }
}

function dish(parent, radius, length) {
  const curve = Array.from({ length: 16 }, (_, i) => {
    const a = i / 15;
    return [radius * a, 0.046 + length * 0.19 * a * a];
  });
  lathe(parent, m.bright, [...curve].reverse(), { segments: 52 });
  lathe(parent, m.alloy, curve.map(([r, y]) => [r, y - 0.013]), { segments: 52 });
  ring(parent, finish.graphite, radius, radius - 0.017, curve.at(-1)[1] - 0.01, curve.at(-1)[1] + 0.008);
  const h = 0.046 + length * 0.41;
  cylinder(parent, m.gold, radius * 0.14, h - 0.047, h + 0.021, undefined, 16);
  for (let i = 0; i < 3; i++) rod(parent, m.steel, polar(radius * 0.82, i * tau / 3, curve[12][1]),
    polar(radius * 0.09, i * tau / 3, h), radius * 0.032, 8);
}

function drillArm(root, at) {
  const shoulder = pivot(root, 'arm_azimuth', at, Y);
  shoulder.quaternion.copy(yaw(-0.34));
  cylinder(shoulder, m.steel, 0.126, -0.07, 0.07, undefined, 24);
  const elevation = pivot(shoulder, 'arm_shoulder', [0, 0.026, 0.104], X);
  elevation.quaternion.copy(rot(X, -0.39));
  rod(elevation, finish.amber, [0, 0, 0], [0, 0, 0.63], 0.071);
  rod(elevation, finish.graphite, [0.081, 0.017, 0.023], [0.081, 0.016, 0.57], 0.023);
  const elbow = pivot(elevation, 'arm_elbow', [0, 0, 0.63], X);
  elbow.quaternion.copy(rot(X, 0.99));
  rod(elbow, m.steel, [-0.10, 0, 0], [0.10, 0, 0], 0.091, 18);
  rod(elbow, finish.offwhite, [0, 0, 0], [0, 0, 0.47], 0.055);
  const wrist = pivot(elbow, 'arm_wrist', [0, 0, 0.49], X);
  wrist.quaternion.copy(rot(X, -0.36));
  box(wrist, finish.graphite, [0.35, 0.18, 0.26]);
  box(wrist, finish.amber, [0.19, 0.092, 0.20], [0, -0.115, 0.02]);
  const drill = pivot(wrist, 'drill', [0, -0.08, 0.055], Y, 'spindle');
  cylinder(drill, m.nickel, 0.057, -0.25, 0.026, undefined, 18);
  for (let i = 0; i < 5; i++) ring(drill, m.steel, 0.066, 0.056, -0.231 + i * 0.036, -0.217 + i * 0.036);
  optics(node('sample_camera', wrist, [-0.12, -0.029, 0.134]), 0.045, 0.049);
}

function rover(heavy) {
  const id = heavy ? 'barkhan_6' : 'barkhan_4';
  const root = node(id);
  const w = heavy ? 1.86 : 1.04;
  const l = heavy ? 2.30 : 1.48;
  const deck = heavy ? 1.02 : 0.68;
  const floor = heavy ? 0.48 : 0.32;
  const color = heavy ? finish.amber : finish.teal;
  box(root, finish.graphite, [w * 0.89, 0.12, l * 0.95], [0, floor, 0]);
  box(root, finish.offwhite, [w, deck - floor, l], [0, (deck + floor) / 2, 0]);
  box(root, m.alloy, [w * 1.027, 0.06, l * 1.021], [0, deck, 0]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = (i - 1) * l * 0.30;
      box(root, i === 1 ? color : m.steel, [0.057, (deck - floor) * 0.65, l * 0.265], [side * w * 0.507, (deck + floor) / 2, z]);
      for (const dy of [-0.067, 0.025]) box(root, finish.graphite, [0.013, 0.025, l * 0.2], [side * (w * 0.507 + 0.031), (deck + floor) / 2 + dy, z]);
    }
    rod(root, m.steel, [side * w * 0.42, deck + 0.06, -l * 0.36], [side * w * 0.42, deck + 0.06, l * 0.36], 0.027, 10);
    const head = node(`hazcam_${side < 0 ? 'left' : 'right'}`, root, [side * w * 0.29, floor + 0.15, l / 2 + 0.039]);
    head.quaternion.copy(yaw(side * 0.22));
    box(head, finish.graphite, [0.19, 0.14, 0.074]);
    optics(head, 0.050, 0.073);
    rod(root, color, [side * w * 0.37, floor - 0.04, l * 0.45], [side * w * 0.41, floor + 0.03, l * 0.57], 0.038, 10);
  }
  rod(root, color, [-w * 0.41, floor + 0.03, l * 0.57], [w * 0.41, floor + 0.03, l * 0.57], 0.035, 10);
  labelPlate(root, 'jugre_mark', [0, (deck + floor) / 2, l / 2 + 0.012], w * 0.26, 0.14, color);
  roverSuspension(root, heavy);
  const mast = pivot(root, 'mast_deployment', [heavy ? 0.52 : 0.17, deck + 0.15, l * 0.25], X);
  const mastLength = heavy ? 0.83 : 0.51;
  cylinder(mast, m.steel, heavy ? 0.108 : 0.092, -0.079, 0.082);
  rod(mast, finish.offwhite, [0, 0.06, 0], [0, mastLength, 0.016], heavy ? 0.047 : 0.034);
  rod(mast, finish.graphite, [0.05, 0.09, 0], [0.05, mastLength - 0.066, 0.016], 0.016);
  const turret = pivot(mast, 'camera_azimuth', [0, mastLength, 0.016], Y);
  const camera = pivot(turret, 'camera_elevation', [0, 0.073, 0.037], X);
  box(camera, color, [heavy ? 0.45 : 0.32, 0.195, 0.214]);
  box(camera, finish.graphite, [heavy ? 0.40 : 0.29, 0.139, 0.037], [0, 0, 0.118]);
  for (const x of [-0.088, 0.088]) optics(node(x < 0 ? 'lens_left' : 'lens_right', camera, [x, 0.006, 0.147]), 0.048, 0.058);
  if (heavy) {
    const optic = node('survey_optics', camera, [0, 0.13, 0.027]);
    box(optic, m.bright, [0.207, 0.116, 0.177]);
    optics(node('survey_lens', optic, [0, 0, 0.087]), 0.052, 0.035);
    drillArm(root, [-0.39, floor + 0.25, l / 2]);
    for (const x of [-0.46, 0.06]) {
      const sample = node(x < 0 ? 'sample_case' : 'sample_transfer', root, [x, deck + 0.13, 0.08]);
      box(sample, finish.graphite, [0.43, 0.20, 0.37]);
      box(sample, color, [0.38, 0.072, 0.32], [0, 0.114, 0]);
    }
    const generator = node('rear_power_unit', root, [0.64, floor + 0.16, -l / 2 - 0.21]);
    generator.quaternion.copy(rot(Z, Math.PI / 2));
    rtg(generator, 0.68, 0.19, 9);
  } else {
    const cells = node('deck_cells', root, [0, deck + 0.062, -0.23]);
    solar(cells, 0.86, 0.74, 8, 7);
  }
  const antenna = pivot(root, 'antenna_azimuth', [-w * 0.32, deck + 0.064, -l * 0.29], Y);
  cylinder(antenna, m.steel, 0.047, 0, 0.134);
  const face = pivot(antenna, 'antenna_elevation', [0, 0.142, 0], X);
  face.quaternion.copy(rot(X, 0.39));
  dish(face, heavy ? 0.23 : 0.142, heavy ? 0.25 : 0.18);
  payload(root, 0);
  const clip = new AnimationClip('mast_deployment', 1, [key(mast, X, [-Math.PI / 2, 0], [0, 1])]);
  const stats = heavy ? { massKg: 540, topSpeedKmh: 4.2, batteryKWh: 9.6, wheelCount: 6, tools: ['stereoCamera', 'sampleDrill', 'sampleStorage'] }
    : { massKg: 185, topSpeedKmh: 6.0, batteryKWh: 2.4, wheelCount: 4, tools: ['stereoCamera', 'surfaceImaging'] };
  return { id, root, category: 'payload', origin: 'jugre', representation: 'original', ready: true, vehicle: 'rover', program: [],
    name: heavy ? names('Бархан-6 · научный ровер', 'Barkhan-6 science rover') : names('Бархан-4 · разведывательный ровер', 'Barkhan-4 scout rover'),
    clips: [clip], gameStats: stats, transportClip: 'mast_deployment' };
}

function satellite(survey) {
  const id = survey ? 'mayak_s' : 'mayak_k';
  const root = node(id);
  const w = survey ? 1.03 : 0.66;
  const depth = survey ? 1.13 : 0.69;
  const h = survey ? 1.05 : 0.72;
  box(root, finish.graphite, [w, h - 0.088, depth], [0, h / 2, 0]);
  for (const y of [0.041, h - 0.038]) box(root, m.alloy, [w * 1.064, 0.082, depth * 1.05], [0, y, 0]);
  for (const side of [-1, 1]) {
    for (const [i, z] of [-0.29 * depth, 0, 0.29 * depth].entries()) {
      box(root, i === 1 && survey ? m.alloy : m.foil[(i + (side < 0 ? 0 : 1)) % m.foil.length],
        [0.023, h * 0.75, depth * 0.27], [side * w * 0.505, h / 2, z]);
      if (i === 1) for (let k = 0; k < 7; k++) box(root, finish.graphite, [0.011, 0.017, depth * 0.20],
        [side * (w * 0.505 + 0.017), h * (0.29 + k * 0.06), z]);
    }
    for (const x of [-w * 0.44, w * 0.44]) rod(root, m.steel, [x, 0.09, side * depth * 0.497], [x, h - 0.084, side * depth * 0.497], 0.028, 8);
  }
  const cover = node('front_equipment', root, [0, 0.48 * h, depth * 0.514]);
  box(cover, finish.offwhite, [w * 0.72, h * 0.70, 0.068]);
  labelPlate(cover, 'jugre_mark', [0, -h * 0.23, 0.04], w * 0.34, 0.11, finish.teal);
  if (survey) {
    const gimbal = pivot(cover, 'telescope_gimbal', [0, h * 0.086, 0.042], Y);
    box(gimbal, finish.graphite, [0.57, 0.47, 0.33], [0, 0, 0.151]);
    box(gimbal, m.alloy, [0.49, 0.42, 0.088], [0, 0, 0.324]);
    optics(node('survey_telescope', gimbal, [0, 0, 0.362]), 0.184, 0.16, finish.graphite);
    const star = node('star_tracker', cover, [0.33, h * 0.28, 0.062]);
    star.quaternion.copy(rot(X, -0.63));
    optics(star, 0.066, 0.079, finish.teal);
  } else {
    const antenna = pivot(root, 'relay_azimuth', [0, h + 0.013, 0.043], Y);
    cylinder(antenna, m.steel, 0.093, 0, 0.135);
    const face = pivot(antenna, 'relay_elevation', [0, 0.145, 0], X);
    face.quaternion.copy(rot(X, -0.57));
    dish(face, 0.31, 0.44);
    optics(node('star_tracker', cover, [0.154, h * 0.168, 0.042]), 0.048, 0.08, finish.teal);
  }
  const length = survey ? 1.45 : 0.81;
  const width = survey ? 0.78 : 0.49;
  const tracks = [];
  for (const side of [-1, 1]) {
    const carrier = node(side < 0 ? 'left_wing_carrier' : 'right_wing_carrier', root, [side * (w / 2 + 0.05), h * 0.49, 0]);
    carrier.quaternion.copy(yaw(side * Math.PI / 2));
    const fold = pivot(carrier, 'wing_deployment', [0, 0, 0], X);
    rod(fold, m.steel, [-0.19, 0, 0.033], [0.19, 0, 0.033], 0.035, 14);
    rod(fold, m.alloy, [0, 0, 0], [0, 0, 0.23], 0.04, 10);
    const first = node('inner_panel', fold, [0, 0, 0.216]);
    const outer = pivot(first, 'panel_fold', [0, 0.050, length + 0.015], X);
    for (const joint of [first, outer]) {
      const panel = node('cells', joint, [0, 0, length / 2]);
      solar(panel, width, length, survey ? 11 : 8, survey ? 18 : 11);
      for (const side of [-1, 1]) box(panel, finish.graphite, [0.036, 0.047, length], [side * width * 0.49, 0, 0]);
    }
    tracks.push(key(fold, X, [-Math.PI / 2, 0, 0], [0, 0.65, 1.4]));
    tracks.push(key(outer, X, [Math.PI, Math.PI, 0], [0, 0.55, 1.4]));
    for (const z of [-depth * 0.39, depth * 0.39]) {
      nozzle(root, `rcs_${side < 0 ? 'l' : 'r'}_${z < 0 ? 'aft' : 'front'}`, [side * w * 0.4, 0.1, z], 0.037, 0.07, [side, -0.2, Math.sign(z) * 0.41]);
    }
  }
  ring(root, m.steel, survey ? 0.36 : 0.25, survey ? 0.29 : 0.194, 0, 0.039);
  payload(root);
  const stats = survey ? { massKg: 410, batteryKWh: 4.8, peakPowerKW: 1.25, purpose: 'mapping' }
    : { massKg: 92, batteryKWh: 1.35, peakPowerKW: 0.46, purpose: 'relay' };
  return { id, root, category: 'payload', origin: 'jugre', representation: 'original', ready: true, vehicle: 'satellite', program: [],
    name: survey ? names('Маяк-С · картографический спутник', 'Mayak-S mapping satellite') : names('Маяк-К · спутник-ретранслятор', 'Mayak-K relay satellite'),
    clips: [new AnimationClip('deployment', 1.4, tracks)], gameStats: stats, transportClip: 'deployment' };
}

export function originalPayloads() {
  return [rover(false), rover(true), satellite(false), satellite(true)];
}
