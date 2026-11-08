import {
  bell, box, cylinder, ellipsoid, flag, group, hinge, label, m, mount, numbered,
  part, polar, polygon, profile, rad, ring, skin, strut, tau, vector, yaw,
} from './geometry.mjs';

export const stack = {
  s_ic: 0,
  interstage_1_2: 42.0624,
  s_ii: 47.8,
  interstage_2_3: 67.1,
  s_ivb: 72.5,
  instrument_unit: 84.7344,
  sla: 85.6488,
  apollo_sm: 94.1832,
  apollo_cm: 99.3832,
  launch_escape: 99.3832,
  tip: 110.6424,
};
export const wide = 5.0292;
export const narrow = 3.302;
export const cmRadius = 1.9558;
export const slaLength = stack.apollo_sm - stack.sla;
export const lmInSla = -0.56;
export const lmClocking = Math.PI / 4;

const quadrants = [0, 1, 2, 3].map((index) => index * Math.PI / 2);
const section = { start: rad(55), sweep: rad(250), segments: 72 };

function axialBand(node, radius, bottom, top, marks, cutaway = false) {
  if (cutaway) {
    skin(node, m.white, radius, radius, bottom, top, section);
    return;
  }
  if (!marks) {
    skin(node, m.white, radius, radius, bottom, top, { segments: 96 });
    return;
  }
  for (const angle of quadrants) {
    skin(node, m.black, radius, radius, bottom, top, { start: angle, sweep: Math.PI / 4, segments: 12 });
    skin(node, m.white, radius, radius, bottom, top,
      { start: angle + Math.PI / 4, sweep: Math.PI / 4, segments: 12 });
  }
}

function ribs(node, r0, r1, y0, y1, count, cutaway = false, striped = false) {
  const { start, sweep } = cutaway ? section : { start: 0, sweep: tau };
  for (let i = 0; i < count; i++) {
    const angle = start + (i + 0.5) * sweep / count;
    const finish = striped && angle % (Math.PI / 2) < Math.PI / 4 ? m.black : m.white;
    strut(node, finish, polar(r0, angle, y0), polar(r1, angle, y1), 0.031, 4);
  }
}

function endStructure(node, radius, y, cutaway) {
  const scope = cutaway ? section : { segments: 80 };
  ring(node, m.steel, radius - 0.015, radius - 0.3, y - 0.06, y + 0.06, scope);
  ring(node, m.aluminum, radius - 0.28, radius - 0.5, y - 0.055, y + 0.055, scope);
}

function tanks(node, radius, definitions) {
  const cutaway = part(node, 'cutaway', undefined, { role: 'cutaway' });
  for (const [name, finish, y0, y1, dome] of definitions) {
    const tank = part(cutaway, name, [0, y0, 0]);
    const height = y1 - y0;
    const points = [[0, 0]];
    for (let i = 1; i <= 10; i++) {
      const angle = i * Math.PI / 20;
      points.push([radius * Math.sin(angle), dome * (1 - Math.cos(angle))]);
    }
    points.push([radius, height - dome]);
    for (let i = 1; i <= 10; i++) {
      const angle = i * Math.PI / 20;
      points.push([radius * Math.cos(angle), height - dome + dome * Math.sin(angle)]);
    }
    profile(tank, finish, points);
    for (const y of [dome, height - dome]) {
      ring(tank, m.aluminum, radius + 0.015, radius - 0.035, y - 0.065, y + 0.065);
    }
  }
  for (const angle of [rad(68), rad(278)]) {
    strut(cutaway, m.steel, polar(radius + 0.15, angle, definitions[0][2]),
      polar(radius + 0.15, angle, definitions.at(-1)[3]), 0.095);
  }
}

function liquidEngine(parent, id, position, type) {
  const f1 = type === 'F-1';
  const radius = f1 ? 1.83 : 1.015;
  const length = f1 ? 2.92 : 2.03;
  const engine = part(parent, id, position, { role: 'engine', engineType: type, standalone: true });
  mount(engine, 'mount_gimbal', [0, 0, 0]);
  const nozzle = part(engine, 'nozzle', [0, -length - 0.77, 0]);
  bell(nozzle, radius, length, f1 ? m.nickel : m.steel, 48);
  cylinder(engine, m.nickel, radius * 0.36, -0.8, -0.16);
  ring(engine, m.steel, radius * 0.43, radius * 0.25, -0.22, -0.02);
  ellipsoid(engine, m.steel, [radius * 0.48, -0.37, 0], [radius * 0.32, 0.34, radius * 0.24]);
  for (const angle of [rad(76), rad(128), rad(249)]) {
    const a = polar(radius * 0.56, angle, -0.32);
    const b = polar(radius * 0.75, angle, -0.85);
    const c = polar(radius * 0.45, angle, -length * 0.64);
    strut(engine, f1 ? m.bronze : m.aluminum, a, b, radius * 0.056);
    strut(engine, f1 ? m.bronze : m.aluminum, b, c, radius * 0.056);
  }
  return engine;
}

function cluster(parent, type, radius, y) {
  const id = type.toLowerCase().replace('-', '');
  liquidEngine(parent, `${id}_01`, [0, y, 0], type);
  quadrants.forEach((angle, index) => {
    liquidEngine(parent, `${id}_${numbered(index + 1)}`, polar(radius, angle, y), type);
  });
}

function baseFairing(parent, angle, index) {
  const node = part(parent, `engine_fairing_${numbered(index)}`, polar(wide - 0.32, angle, 0.44),
    { standalone: true });
  node.quaternion.copy(yaw(angle));
  profile(node, m.black, [[1.78, 0], [1.69, 0.65], [1.35, 2.1], [0.92, 3.75],
    [0.46, 5.5], [0.2, 6.43], [0, 6.83]], { start: -Math.PI / 2, sweep: Math.PI, segments: 32 });
  const fin = part(node, 'fin', [0, 0.12, 1.45], { standalone: true });
  const contour = [[0.08, -0.05], [1.24, -0.05], [1.1, 0.57], [-0.56, 2.3], [-0.85, 2.3]];
  for (const side of [-1, 1]) {
    const face = contour.map(([z, y]) => [side * 0.065, y, z]);
    polygon(fin, m.aluminum, side < 0 ? face : face.reverse());
  }
  for (let i = 0; i < contour.length; i++) {
    const [z0, y0] = contour[i];
    const [z1, y1] = contour[(i + 1) % contour.length];
    polygon(fin, m.gray, [[-0.065, y0, z0], [0.065, y0, z0],
      [0.065, y1, z1], [-0.065, y1, z1]]);
  }
}

export function firstStage(cutaway = false) {
  const node = group('s_ic');
  const shell = part(node, 'skin');
  const top = stack.interstage_1_2;
  for (const [a, b, marked] of [[0.7, 9.0, true], [9.0, 36.55, false], [36.55, top, true]]) {
    axialBand(shell, wide, a, b, marked, cutaway);
  }
  const scope = cutaway ? section : { segments: 96 };
  ring(node, m.black, wide + 0.025, wide - 0.25, 0.42, 0.72, scope);
  ring(node, m.steel, wide - 0.28, wide - 0.51, 0.61, 0.82, scope);
  ribs(shell, wide, wide, 0.72, 3.95, 168, cutaway, true);
  ribs(shell, wide, wide, 16.8, 21.2, 144, cutaway);
  ribs(shell, wide, wide, 37.2, top - 0.14, 168, cutaway, true);
  endStructure(node, wide, top - 0.058, cutaway);
  const thrust = part(node, 'thrust_structure');
  cylinder(thrust, m.steel, wide - 0.25, 3.41, 3.78);
  for (const angle of quadrants) {
    strut(thrust, m.steel, polar(1.24, angle, 3.18), polar(4.56, angle, 3.48), 0.27, 8);
    if (!cutaway || (angle > section.start && angle < section.start + section.sweep)) {
      baseFairing(node, angle, quadrants.indexOf(angle));
      box(shell, m.white, [0.28, 10.7, 0.18], polar(wide + 0.065, angle + 0.42, 26.6),
        yaw(angle + 0.42));
    }
  }
  cluster(node, 'F-1', 3.33, 3.69);
  if (cutaway) {
    tanks(node, 4.59, [['rp1_tank', m.rp1, 4.0, 19.35, 2.05], ['lox_tank', m.lox, 19.65, 40.65, 2.19]]);
  } else {
    const markings = part(node, 'markings');
    for (const angle of [rad(65), rad(245)]) {
      const map = (x, y) => polar(wide + 0.03, angle + x / wide, y);
      flag(markings, 2.28, 1.27, (x, y) => map(x - 1.14, y + 32.75));
      const letters = 'UNITEDSTATES';
      [...letters].forEach((letter, index) => {
        label(markings, m.red, letter, 0.89, (x, y) => map(x - 0.318, y + 30.95 - index * 1.25));
      });
    }
  }
  mount(node, 'mount_forward', [0, top, 0]);
  return node;
}

export function firstInterstage() {
  const node = group('interstage_1_2');
  const height = stack.s_ii - stack.interstage_1_2;
  axialBand(node, wide, 0, height, true);
  skin(node, m.steel, wide - 0.14, wide - 0.14, height, 0);
  ribs(node, wide, wide, 0.13, height - 0.13, 168, false, true);
  endStructure(node, wide, 0.058, false);
  endStructure(node, wide, height - 0.058, false);
  for (const angle of quadrants) {
    const pod = part(node, `ullage_motor_${numbered(quadrants.indexOf(angle))}`,
      polar(wide + 0.07, angle + 0.35, 2.07));
    pod.quaternion.copy(yaw(angle + 0.35));
    box(pod, m.black, [0.53, 2.0, 0.29], [0, 0, 0.04]);
    cylinder(pod, m.steel, 0.165, -1.14, -0.76, [0, 0, 0.15], 16);
  }
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  mount(node, 'mount_forward', [0, height, 0]);
  return node;
}

export function secondStage(cutaway = false) {
  const node = group('s_ii');
  const top = stack.interstage_2_3 - stack.s_ii;
  const shell = part(node, 'skin');
  const scope = cutaway ? section : { segments: 96 };
  axialBand(shell, wide, 0, 4.0, true, cutaway);
  axialBand(shell, wide, 4.0, top, false, cutaway);
  ribs(shell, wide, wide, 0.05, 2.9, 168, cutaway, true);
  ribs(shell, wide, wide, top - 1.43, top - 0.09, 144, cutaway);
  endStructure(node, wide, 0.058, cutaway);
  endStructure(node, wide, top - 0.058, cutaway);
  const thrust = part(node, 'thrust_structure');
  profile(thrust, m.steel, [[0, -1.28], [3.7, -1.28], [4.65, -0.55], [4.89, 0.14]], scope);
  cluster(node, 'J-2', 2.68, -1.27);
  if (cutaway) {
    tanks(node, 4.56, [['lox_tank', m.lox, 0.52, 5.4, 1.55], ['lh2_tank', m.lh2, 5.65, top - 0.35, 1.9]]);
  } else {
    for (const angle of [rad(65), rad(245)]) {
      flag(shell, 1.68, 0.95, (x, y) => polar(wide + 0.028, angle + (x - 0.84) / wide, y + 14.1));
      label(shell, m.red, 'USA', 0.76, (x, y) => polar(wide + 0.025, angle + (x - 0.92) / wide, y + 12.66));
    }
  }
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  mount(node, 'mount_forward', [0, top, 0]);
  return node;
}

export function secondInterstage() {
  const node = group('interstage_2_3');
  const height = stack.s_ivb - stack.interstage_2_3;
  for (const angle of quadrants) {
    skin(node, m.black, wide, narrow, 0, height, { start: angle, sweep: Math.PI / 4, segments: 12 });
    skin(node, m.white, wide, narrow, 0, height,
      { start: angle + Math.PI / 4, sweep: Math.PI / 4, segments: 12 });
  }
  skin(node, m.steel, narrow - 0.12, wide - 0.12, height, 0, { segments: 96 });
  ribs(node, wide, narrow, 0, height, 144, false, true);
  endStructure(node, wide, 0.058, false);
  endStructure(node, narrow, height - 0.058, false);
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  mount(node, 'mount_forward', [0, height, 0]);
  return node;
}

export function thirdStage(cutaway = false) {
  const node = group('s_ivb');
  const top = stack.instrument_unit - stack.s_ivb;
  const shell = part(node, 'skin');
  const scope = cutaway ? section : { segments: 96 };
  axialBand(shell, narrow, 0, 1.64, true, cutaway);
  axialBand(shell, narrow, 1.64, top, false, cutaway);
  ribs(shell, narrow, narrow, 0.06, 1.63, 104, cutaway, true);
  ribs(shell, narrow, narrow, top - 1.24, top - 0.08, 104, cutaway);
  endStructure(node, narrow, 0.058, cutaway);
  endStructure(node, narrow, top - 0.058, cutaway);
  profile(node, m.steel, [[0, -1.8], [1.22, -1.8], [3.19, 0.03]], scope);
  liquidEngine(node, 'j2_01', [0, -1.8, 0], 'J-2');
  for (const [index, angle] of [rad(110), rad(290)].entries()) {
    const aps = part(node, `aps_${numbered(index)}`, polar(narrow - 0.035, angle, 0.67),
      { standalone: true });
    aps.quaternion.copy(yaw(angle));
    ellipsoid(aps, m.gray, [0, 0.04, 0.17], [0.48, 0.95, 0.36]);
    box(aps, m.steel, [0.53, 0.48, 0.24], [0, 0.04, 0.41]);
    for (const side of [-1, 1]) {
      strut(aps, m.nozzle, [side * 0.18, -0.05, 0.48], [side * 0.35, -0.2, 0.55], 0.09);
    }
    mount(aps, 'mount_aps', [0, 0, 0], [0, 0, -1]);
  }
  if (cutaway) {
    tanks(node, 2.96, [['lox_tank', m.lox, 0.54, 3.47, 1.15], ['lh2_tank', m.lh2, 3.62, top - 0.29, 1.39]]);
  }
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  mount(node, 'mount_forward', [0, top, 0]);
  return node;
}

export function instrumentUnit() {
  const node = group('instrument_unit');
  const height = stack.sla - stack.instrument_unit;
  ring(node, m.black, narrow, narrow - 0.16, 0, height, { segments: 96 });
  ring(node, m.aluminum, narrow - 0.005, narrow - 0.21, 0.07, 0.112, { segments: 96 });
  ring(node, m.aluminum, narrow - 0.005, narrow - 0.21, height - 0.1, height - 0.057, { segments: 96 });
  for (let i = 0; i < 12; i++) {
    const angle = tau * i / 12;
    box(node, i % 2 ? m.steel : m.aluminum, [0.62, 0.48, 0.25], polar(narrow - 0.25, angle, height / 2), yaw(angle));
  }
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  mount(node, 'mount_forward', [0, height, 0]);
  return node;
}

const slaHingeY = 2.09;
const radiusAtSla = (y) => narrow + (cmRadius - narrow) * y / slaLength;

export function adapter(open = false) {
  const node = group('sla');
  const hingeRadius = radiusAtSla(slaHingeY);
  profile(node, m.white, [[narrow - 0.09, 0], [narrow, 0], [hingeRadius, slaHingeY],
    [hingeRadius - 0.085, slaHingeY], [narrow - 0.09, 0]], { segments: 96 });
  for (const [index, angle] of quadrants.entries()) {
    const axis = polar(1, angle + Math.PI / 2);
    const pivot = polar(hingeRadius, angle, slaHingeY);
    const panel = hinge(node, `panel_${numbered(index)}`, pivot, axis, rad(45), Number(open));
    panel.userData.standalone = true;
    const gap = rad(0.27);
    const start = angle - Math.PI / 4 + gap;
    const sweep = Math.PI / 2 - 2 * gap;
    const xyz = pivot.map((value) => -value);
    const face = [[hingeRadius, slaHingeY], [cmRadius, slaLength]];
    profile(panel, m.white, face, { start, sweep, xyz, segments: 24 });
    profile(panel, m.aluminum, face.map(([r, y]) => [r - 0.085, y]).reverse(), { start, sweep, xyz, segments: 24 });
    for (const edge of [start, start + sweep]) {
      const a = vector(polar(hingeRadius, edge, slaHingeY)).add(vector(xyz)).toArray();
      const b = vector(polar(cmRadius, edge, slaLength)).add(vector(xyz)).toArray();
      strut(panel, m.gray, a, b, 0.042, 6);
    }
    for (let i = 1; i <= 3; i++) {
      const theta = start + i * sweep / 4;
      const a = vector(polar(hingeRadius - 0.09, theta, slaHingeY)).add(vector(xyz)).toArray();
      const b = vector(polar(cmRadius - 0.09, theta, slaLength)).add(vector(xyz)).toArray();
      strut(panel, m.steel, a, b, 0.034, 6);
    }
    for (const y of [slaHingeY, slaLength]) {
      ring(panel, m.aluminum, radiusAtSla(y) + 0.006, radiusAtSla(y) - 0.09,
        y === slaHingeY ? y : y - 0.055, y === slaHingeY ? y + 0.055 : y,
        { start, sweep, xyz, segments: 24 });
    }
    mount(panel, 'mount_hinge', [0, 0, 0], axis);
    const attachAngle = angle + lmClocking;
    const knee = polar(1.72, attachAngle, lmInSla + 2.96);
    const collar = part(node, `eagle_support_${numbered(index)}`, knee);
    collar.quaternion.copy(yaw(attachAngle));
    box(collar, m.steel, [0.26, 0.22, 0.44], [0, -0.03, 0.12]);
    const attachment = mount(node, `mount_eagle_${numbered(index)}`, knee, [0, 1, 0]);
    attachment.userData.matesWith = `eagle_descent.mount_sla_${numbered(index)}`;
    for (const side of [-1, 1]) {
      strut(node, m.steel, polar(2.97, attachAngle + side * 0.15, 1.28), knee, 0.063, 8);
    }
  }
  mount(node, 'mount_aft', [0, 0, 0], [0, -1, 0]);
  mount(node, 'mount_forward', [0, slaLength, 0]);
  return node;
}
