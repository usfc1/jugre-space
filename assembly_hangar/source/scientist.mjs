import {
  AnimationClip, BufferGeometry, CylinderGeometry, Euler, Float32BufferAttribute, MeshStandardMaterial,
  Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack,
} from 'three';
import { box, mesh, node, rod, rot, sphere, X } from '../../original_parts/source/geometry.mjs';

const leg = [0.455, 0.438];
const tau = Math.PI * 2;
const finish = (name, color) => new MeshStandardMaterial({ name, color, roughness: 0.78 });
const coat = finish('Ivory lab coat', 0xe6e8e0);
const fabricShade = finish('Lab coat seams', 0xa5b6b9);
const shoes = finish('Safety footwear', 0x1c252c);
const tablet = finish('Diagnostic tablet', 0x263a45);
const screen = finish('Tablet display', 0x72bec6);
const badge = finish('ID pass', 0x84c0c5);
const lens = finish('Protective glasses', 0x748c96);

export const scientistStyles = [
  { id: 'white_coat_teal', skin: 0xa96446, hair: 0x262226, shirt: 0x497f83, pants: 0x293a4b, glasses: true },
  { id: 'white_coat_blue', skin: 0xe2ab88, hair: 0x4c3328, shirt: 0x466886, pants: 0x35424a },
  { id: 'white_coat_ochre', skin: 0x684333, hair: 0x211f23, shirt: 0x897052, pants: 0x2a313e, glasses: true },
  { id: 'white_coat_burgundy', skin: 0xc28f72, hair: 0x292226, shirt: 0x77576a, pants: 0x2c3b45 },
];

function taper(parent, mat, top, bottom, height, position, depth = 1) {
  return mesh(parent, new CylinderGeometry(top, bottom, height, 20), mat, position, undefined, [1, 1, depth]);
}

function triangle(parent, mat, points) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
  geometry.computeVertexNormals();
  mesh(parent, geometry, mat);
}

function gait(name, bones, run) {
  const period = run ? 0.72 : 1.14;
  const stance = run ? 0.43 : 0.62;
  const speed = run ? 2.9 : 1.3;
  const step = period * stance * speed / 2;
  const tracks = [];
  const times = Array.from({ length: 49 }, (_, i) => i * period / 48);
  const translations = [];
  const angles = new Map();
  const euler = new Euler();
  const rotation = new Quaternion();
  function rotate(bone, x, y = 0, z = 0) {
    rotation.setFromEuler(euler.set(x, y, z));
    if (!angles.has(bone)) angles.set(bone, []);
    angles.get(bone).push(...rotation.toArray());
  }

  for (let i = 0; i < times.length; i++) {
    const phase = (i % (times.length - 1)) / (times.length - 1);
    const cycle = phase % 0.5;
    const sway = Math.cos(phase * tau);
    const hip = run
      ? (cycle < stance ? 0.852 - 0.049 * Math.sin(Math.PI * cycle / stance)
        : 0.852 + 0.10 * Math.sin(Math.PI * (cycle - stance) / (0.5 - stance)))
      : 0.853 - 0.024 * Math.cos(phase * 2 * tau);
    translations.push(0.025 * sway, hip, 0);
    rotate(bones.torso, run ? 0.16 : 0.025, 0.105 * sway, 0.055 * Math.sin(phase * tau));
    rotate(bones.head, run ? -0.11 : 0, -0.07 * sway);

    for (const [index, limb] of bones.limbs.entries()) {
      const p = (phase + 0.5 * index) % 1;
      const swing = Math.max(0, (p - stance) / (1 - stance));
      const ankleZ = p < stance ? step * (1 - 2 * p / stance) : -step * Math.cos(Math.PI * swing);
      const ankleY = 0.077 + (run ? 0.32 : 0.14) * Math.sin(Math.PI * swing);
      const reach = Math.min(Math.hypot(hip - ankleY, ankleZ), leg[0] + leg[1] - 0.0001);
      const thigh = Math.atan2(-ankleZ, hip - ankleY)
        - Math.acos((leg[0] ** 2 + reach ** 2 - leg[1] ** 2) / (2 * leg[0] * reach));
      const knee = Math.PI - Math.acos((leg[0] ** 2 + leg[1] ** 2 - reach ** 2) / (2 * leg[0] * leg[1]));
      rotate(limb.thigh, thigh);
      rotate(limb.shin, knee);
      rotate(limb.foot, -thigh - knee + 0.38 * Math.sin(tau * swing));
      rotate(limb.arm, (run ? 0.71 : 0.35) * Math.cos((p - 0.13) * tau), 0.02, (index ? 1 : -1) * 0.11);
      rotate(limb.elbow, run ? -1.23 : -0.27 - 0.16 * Math.cos((p - 0.13) * tau));
      rotate(limb.hem, 0.46 * thigh - (run ? 0.07 : 0), 0, (index ? 1 : -1) * 0.07);
    }
  }
  tracks.push(new VectorKeyframeTrack(`${bones.pelvis.name}.position`, times, translations));
  for (const [bone, values] of angles) {
    tracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
  }
  return new AnimationClip(name, period, tracks);
}

export function buildScientist(style) {
  const root = node('scientist', null, [0, 0, 0], { role: 'npc', forward: '+Z' });
  const skin = finish('Skin', style.skin);
  const hair = finish('Hair', style.hair);
  const shirt = finish('Collared shirt', style.shirt);
  const pants = finish('Trousers', style.pants);
  const pelvis = node('pelvis', root, [0, 0.853, 0]);
  const torso = node('torso', pelvis, [0, 0.09, 0]);
  taper(torso, coat, 0.216, 0.171, 0.46, [0, 0.16, 0], 0.62);
  sphere(torso, coat, [0.217, 0.087, 0.127], [0, 0.375, 0], 18);
  taper(torso, skin, 0.054, 0.065, 0.128, [0, 0.453, 0.011], 0.92);
  triangle(torso, shirt, [[-0.104, 0.431, 0.098], [0, 0.215, 0.131], [0.104, 0.431, 0.098]]);
  triangle(torso, fabricShade, [[-0.117, 0.42, 0.113], [-0.069, 0.277, 0.14], [0, 0.215, 0.142]]);
  triangle(torso, fabricShade, [[0.117, 0.42, 0.113], [0, 0.215, 0.142], [0.069, 0.277, 0.14]]);
  box(torso, fabricShade, [0.009, 0.261, 0.009], [0.004, 0.081, 0.119]);
  box(torso, fabricShade, [0.078, 0.066, 0.013], [0.113, 0.237, 0.114]);
  box(torso, badge, [0.06, 0.082, 0.014], [0.118, 0.269, 0.125]);
  box(torso, shoes, [0.034, 0.014, 0.012], [0.118, 0.282, 0.137]);

  const head = node('head', torso, [0, 0.505, 0.014]);
  sphere(head, skin, [0.106, 0.134, 0.095], [0, 0.086, 0.008], 20);
  sphere(head, hair, [0.108, 0.095, 0.092], [0, 0.144, -0.011], 18);
  sphere(head, hair, [0.104, 0.082, 0.054], [0, 0.091, -0.056], 16);
  sphere(head, skin, [0.022, 0.031, 0.021], [0, 0.082, 0.103], 12);
  box(head, hair, [0.039, 0.007, 0.009], [0, 0.04, 0.099]);
  for (const side of [-1, 1]) {
    sphere(head, skin, [0.018, 0.03, 0.017], [side * 0.103, 0.077, 0.002], 12);
    sphere(head, hair, [0.012, 0.009, 0.005], [side * 0.042, 0.109, 0.093], 12);
    if (style.glasses) {
      box(head, lens, [0.061, 0.026, 0.013], [side * 0.042, 0.109, 0.101]);
      rod(head, shoes, [side * 0.071, 0.111, 0.106], [side * 0.106, 0.095, 0.012], 0.005, 6);
    }
  }
  if (style.glasses) box(head, shoes, [0.035, 0.007, 0.012], [0, 0.114, 0.111]);

  const limbs = [-1, 1].map((side, i) => {
    const label = side < 0 ? 'L' : 'R';
    const thigh = node(`thigh_${label}`, pelvis, [side * 0.098, 0, 0]);
    taper(thigh, pants, 0.092, 0.064, 0.48, [0, -0.192, 0], 0.91);
    const shin = node(`shin_${label}`, thigh, [0, -leg[0], 0]);
    taper(shin, pants, 0.069, 0.047, 0.451, [0, -0.202, 0], 0.9);
    const foot = node(`foot_${label}`, shin, [0, -leg[1], 0]);
    sphere(foot, shoes, [0.067, 0.056, 0.135], [0, -0.023, 0.048], 16);
    box(foot, shoes, [0.111, 0.018, 0.212], [0, -0.071, 0.042]);

    const arm = node(`arm_${label}`, torso, [side * 0.206, 0.373, 0]);
    sphere(arm, coat, [0.083, 0.091, 0.082], [side * 0.012, -0.026, 0], 16);
    taper(arm, coat, 0.081, 0.056, 0.268, [side * 0.016, -0.139, 0]);
    const elbow = node(`elbow_${label}`, arm, [side * 0.019, -0.27, 0]);
    taper(elbow, coat, 0.058, 0.044, 0.219, [0, -0.099, 0]);
    taper(elbow, fabricShade, 0.045, 0.044, 0.033, [0, -0.214, 0]);
    sphere(elbow, skin, [0.045, 0.071, 0.036], [0, -0.272, 0.007], 16);
    if (i === 0 && style.id === 'white_coat_ochre') {
      box(elbow, tablet, [0.173, 0.236, 0.029], [-0.018, -0.256, 0.053], rot(X, 0.16));
      box(elbow, screen, [0.143, 0.201, 0.008], [-0.018, -0.257, 0.072], rot(X, 0.16));
    }
    const hem = node(`coat_hem_${label}`, torso, [side * 0.078, -0.005, 0]);
    const front = box(hem, coat, [0.145, 0.306, 0.025], [side * 0.009, -0.134, 0.112]);
    front.rotation.x = 0.09;
    const back = box(hem, coat, [0.182, 0.318, 0.042], [side * 0.023, -0.133, -0.102]);
    back.rotation.x = -0.11;
    const flank = box(hem, coat, [0.04, 0.286, 0.195], [side * 0.097, -0.132, 0.0]);
    flank.rotation.z = side * 0.17;
    box(hem, fabricShade, [0.074, 0.013, 0.016], [side * 0.021, -0.105, 0.133]);
    return { thigh, shin, foot, arm, elbow, hem };
  });
  const bones = { pelvis, torso, head, limbs };
  const clips = [gait('walk', bones, false), gait('run', bones, true)];
  return { root, clips };
}
