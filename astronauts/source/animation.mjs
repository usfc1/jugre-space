import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';

const tau = Math.PI * 2;
const angles = new Euler();
const quaternion = new Quaternion();

function sampleClip(name, duration, pose, count = 32) {
  const times = Array.from({ length: count + 1 }, (_, i) => i * duration / count);
  const positions = new Map();
  const rotations = new Map();
  for (let i = 0; i <= count; i++) {
    const { move = {}, turn } = pose(i / count);
    for (const [part, values] of Object.entries(move)) {
      if (!positions.has(part)) positions.set(part, []);
      positions.get(part).push(...values);
    }
    for (const [part, values] of Object.entries(turn)) {
      if (!rotations.has(part)) rotations.set(part, []);
      quaternion.setFromEuler(angles.set(values[0], values[1] ?? 0, values[2] ?? 0));
      rotations.get(part).push(...quaternion.toArray());
    }
  }
  return new AnimationClip(name, duration, [
    ...[...positions].map(([part, values]) => new VectorKeyframeTrack(`${part}.position`, times, values)),
    ...[...rotations].map(([part, values]) => new QuaternionKeyframeTrack(`${part}.quaternion`, times, values)),
  ]);
}

function walk(p) {
  const t = p * tau;
  const hipY = 0.571 + 0.005 * Math.sin(t * 2);
  const turn = { torso: [0.074, -0.085 * Math.cos(t), -0.030 * Math.sin(t)], head: [-0.054, 0.052 * Math.cos(t)] };
  const stance = 0.60;
  const step = 0.172;
  const thigh = 0.235;
  const shin = 0.224;
  for (const [label, s, offset] of [['L', 1, 0], ['R', -1, 0.5]]) {
    const phase = (p + offset) % 1;
    const swing = Math.max(0, (phase - stance) / (1 - stance));
    const ankleZ = phase < stance ? step * (1 - 2 * phase / stance) : -step * Math.cos(Math.PI * swing);
    const ankleY = 0.113 + 0.105 * Math.sin(Math.PI * swing);
    const dy = hipY - 0.043 - ankleY;
    const reach = Math.hypot(dy, ankleZ);
    const a = -Math.atan2(ankleZ, dy) - Math.acos((thigh ** 2 + reach ** 2 - shin ** 2) / (2 * thigh * reach));
    const b = Math.PI - Math.acos((thigh ** 2 + shin ** 2 - reach ** 2) / (2 * thigh * shin));
    turn[`thigh_${label}`] = [a];
    turn[`shin_${label}`] = [b];
    turn[`boot_${label}`] = [-a - b];
    turn[`upper_arm_${label}`] = [0.38 * Math.cos(phase * tau), 0, s * 0.088];
    turn[`forearm_${label}`] = [-0.27 + 0.12 * Math.sin(phase * tau)];
  }
  return { move: { pelvis: [0, hipY, 0] }, turn };
}

function pilot(p) {
  const t = p * tau;
  return {
    move: { pelvis: [0, 0.473, 0] },
    turn: {
      torso: [-0.16, 0.034 * Math.sin(t)], head: [0.15 + 0.07 * Math.cos(t), 0.16 * Math.sin(t)],
      thigh_L: [-1.32, 0, 0.09], thigh_R: [-1.36, 0, -0.10],
      shin_L: [1.40], shin_R: [1.47], boot_L: [-0.08], boot_R: [-0.10],
      upper_arm_L: [-0.69, -0.17, -0.08], forearm_L: [-0.80 - 0.08 * Math.sin(t)], glove_L: [0.14, 0.16],
      upper_arm_R: [-0.63 - 0.12 * Math.sin(t), 0.23, 0.09],
      forearm_R: [-0.75 + 0.08 * Math.sin(t)], glove_R: [0.21, -0.20 + 0.17 * Math.sin(t)],
    },
  };
}

function eva(p) {
  const t = p * tau;
  const a = Math.sin(t);
  const b = Math.cos(t);
  return {
    move: { pelvis: [0, 0.83 + 0.058 * a, 0.018 * b] },
    turn: {
      pelvis: [0.17 + 0.08 * b, 0.10 * a, 0.09 * b],
      torso: [0.025 * a, 0.13 * b], head: [-0.12, -0.19 * b],
      thigh_L: [-0.20 + 0.12 * a, 0, 0.11], shin_L: [0.38 - 0.13 * b], boot_L: [0.13],
      thigh_R: [-0.38 - 0.14 * a, 0, -0.14], shin_R: [0.52 + 0.15 * b], boot_R: [0.09],
      upper_arm_L: [-1.03 + 0.24 * a, -0.29, 0.24], forearm_L: [-0.54 - 0.20 * b],
      glove_L: [0.13, 0.34 * b],
      upper_arm_R: [-0.56 - 0.22 * a, 0.11, -0.49], forearm_R: [-0.68 + 0.18 * b],
      glove_R: [0.17, 0.15 * a],
    },
  };
}

function idle(p) {
  const t = p * tau;
  return {
    turn: {
      torso: [0.014 * Math.sin(t), 0.028 * Math.sin(t), 0.013 * Math.cos(t)],
      head: [0.022 * Math.sin(t), -0.10 * Math.sin(t)],
      upper_arm_L: [-0.035, 0, 0.10], upper_arm_R: [-0.035, 0, -0.10],
      forearm_L: [-0.045], forearm_R: [-0.045],
    },
  };
}

export const visorOpenAngle = -1.76;
export const clips = {
  idle: { duration: 3.6, loop: true },
  walk: { duration: 1.12, loop: true, speedMps: 0.512 },
  pilot: { duration: 3.2, loop: true },
  eva: { duration: 4.0, loop: true },
  visor_open: { duration: 0.52, loop: false },
  visor_close: { duration: 0.52, loop: false },
};

export function astronautClips() {
  const visor = (p, close) => ({ turn: { visor: [visorOpenAngle * (close ? 1 - p : p)] } });
  return [
    sampleClip('idle', clips.idle.duration, idle),
    sampleClip('walk', clips.walk.duration, walk, 48),
    sampleClip('pilot', clips.pilot.duration, pilot),
    sampleClip('eva', clips.eva.duration, eva),
    sampleClip('visor_open', clips.visor_open.duration, p => visor(p, false), 2),
    sampleClip('visor_close', clips.visor_close.duration, p => visor(p, true), 2),
  ];
}
