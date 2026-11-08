import { X, Y, Z, m, tau, num, neg, node, part, joint, mount, ports, placed, polar, yaw, rot,
  lathe, cylinder, ring, box, rod, nozzle, bandedTank, cutawaySkin } from './geometry.mjs';

export function jacket(parent, material, radius, top, cut = false, base = 0) {
  const profile = [[radius, base], [radius, top]];
  if (cut) cutawaySkin(parent, material, profile, Math.min(0.05, radius * 0.03), m.steel);
  else lathe(parent, material, profile);
}

export function collars(parent, radius, levels, width, material = m.alloy) {
  for (const y of levels) ring(parent, material, radius, radius * 0.97, y, y + width);
}

export function adapter(id, radius, upper, height, material = m.white) {
  const root = node(id);
  lathe(root, material, [[radius * 0.97, 0], [radius, 0], [radius, 0.12],
    [upper, height - 0.1], [upper, height], [upper * 0.966, height],
    [upper * 0.966, height - 0.1], [radius * 0.97, 0]]);
  collars(root, radius * 1.007, [0.1], 0.035);
  collars(root, upper * 1.008, [height - 0.14], 0.035);
  ports(root, height);
  return root;
}

export function fairing(id, radius, height, side, bodyFraction = 0.49, fullBase = false) {
  const root = node(id);
  const start = side < 0 ? Math.PI : 0;
  const profile = [[radius * (fullBase ? 1 : 0.72), 0], [radius * (fullBase ? 1 : 0.96), height * 0.15], [radius, height * 0.24],
    [radius, height * bodyFraction], [radius * 0.95, height * 0.68], [radius * 0.71, height * 0.85],
    [radius * 0.31, height * 0.98], [0.022, height]];
  const options = { start, sweep: Math.PI, segments: 36 };
  lathe(root, m.white, profile, options);
  lathe(root, m.alloy, [...profile].reverse().map(([r, y]) => [Math.max(0.013, r - 0.035), y]), options);
  for (const [lo, hi] of [[0.15, 0.24], [0.24, bodyFraction]]) {
    for (const sign of [-1, 1]) {
      const rad = (fraction) => !fullBase && fraction === 0.15 ? radius * 0.965 : radius * 1.001;
      rod(root, m.steel, [0, height * lo, sign * rad(lo)], [0, height * hi, sign * rad(hi)], 0.026);
    }
  }
  mount(root, 'mount_aft', [0, 0, 0], neg(Y));
  return root;
}

export function solid(id, radius, height, segments, { shroud = m.white, tapered = true, accent = m.steel } = {}) {
  const root = node(id);
  const shoulder = height - radius * (tapered ? 3.3 : 2.05);
  cylinder(root, shroud, radius, 1, shoulder);
  const tip = part(root, 'nose', [0, shoulder, 0]);
  const cone = height - shoulder;
  lathe(tip, shroud, [[0, 0], [radius, 0], [radius * 0.99, cone * 0.17],
    [radius * 0.8, cone * 0.53], [radius * 0.35, cone * 0.91], [0.018, cone]]);
  for (let i = 1; i < segments; i++) {
    collars(root, radius * 1.012, [2 + (shoulder - 2) * i / segments], Math.min(0.15, radius * 0.1), accent);
  }
  const skirt = part(root, 'aft_skirt', [0, 1, 0]);
  lathe(skirt, shroud, [[radius * 1.13, -0.65], [radius * 1.13, -0.37], [radius, 0.2], [radius, 0.9]]);
  collars(skirt, radius * 1.14, [-0.68], 0.08, accent);
  nozzle(root, 'nozzle', [0, 0.67, 0], radius * 0.63, 0.67, neg(Y), m.black);
  for (const y of [2.7, shoulder - 1]) {
    box(root, m.steel, [radius * 0.71, 0.36, 0.42], [0, y, radius]);
    mount(root, y < 3 ? 'mount_lower' : 'mount_upper', [0, y, radius + 0.21], Z);
  }
  return root;
}

const atlas = { radius: 1.905, coreTop: 32.46, upperBase: 35.4, fairingBase: 39.35, fairingHeight: 20.7 };
const atlasSrbRadius = 0.79;
const atlasSrbHeight = 20.1;
const atlasSrbBase = 0.55;
const atlasSrbAttach = [['lower', atlasSrbBase + 2.7], ['upper', atlasSrbBase + atlasSrbHeight - atlasSrbRadius * 3.3 - 1]];
// Atlas 500-series SRBs are clocked asymmetrically around the core.
const atlasClocking = [33.8, 101.3, 168.8, 258.8].map((degrees) => degrees * Math.PI / 180);

function atlasCore(cut = false) {
  const root = node('atlas_v_core');
  jacket(root, m.orange, atlas.radius, atlas.coreTop, cut, 2.9);
  jacket(root, m.alloy, atlas.radius + 0.014, atlas.coreTop, cut, 30.95);
  jacket(root, m.white, atlas.radius + 0.02, 4.9, cut, 2.9);
  collars(root, atlas.radius * 1.014, [3.05, 4.8, 12.2, 18.7, 26.65, 30.9, 32.34], 0.1, m.nickel);
  const frame = part(root, 'rd180', [0, 3.5, 0]);
  box(frame, m.steel, [2.5, 0.46, 1.42]);
  for (const [index, x] of [-0.78, 0.78].entries()) nozzle(frame, `chamber_${num(index)}`, [x, 0, 0], 0.79, 3.45);
  for (const [index, angle] of atlasClocking.entries()) {
    for (const [role, y] of atlasSrbAttach) {
      mount(root, `mount_srb_${num(index)}_${role}`, polar(atlas.radius, angle, y), polar(1, angle));
      const foot = polar(atlas.radius - 0.04, angle, y);
      rod(root, m.steel, foot, polar(atlas.radius + 0.2, angle, y), 0.13);
    }
  }
  rod(root, m.bright, [0, 5.2, 1.915], [0, 31, 1.915], 0.052);
  if (cut) {
    const inside = node('cutaway', root, undefined, { role: 'cutaway' });
    bandedTank(inside, m.fuel, 4.45, 1.77, 9.05);
    bandedTank(inside, m.lox, 13.6, 1.77, 16.94);
  }
  ports(root, atlas.coreTop);
  return root;
}

function atlasSrb(index) {
  return solid(`atlas_v_srb_${num(index)}`, atlasSrbRadius, atlasSrbHeight, 1, { accent: m.nickel });
}

function atlasBoattail() {
  const root = adapter('atlas_v_boattail', atlas.radius, 2.7, atlas.fairingBase - atlas.coreTop, m.white);
  collars(root, 2.711, [atlas.fairingBase - atlas.coreTop - 0.19], 0.075);
  return root;
}

function centaur(id, radius, height, engines) {
  const root = node(id);
  const engineY = height * 0.28;
  const deck = part(root, 'equipment_deck', [0, height - 0.76, 0]);
  cylinder(deck, m.dark, radius, 0, 0.63, undefined, 48, radius * 0.84);
  for (const angle of [0, 1.4, 3, 4.9]) box(deck, m.alloy, [0.34, 0.34, 0.22], polar(radius * 0.82, angle, 0.38), yaw(angle));
  cylinder(root, m.bright, radius, engineY, height - 0.76);
  collars(root, radius * 1.01, [engineY, engineY + 0.4, height - 1.63, height - 0.86], 0.076, m.alloy);
  for (let i = 0; i < engines; i++) {
    const x = engines === 1 ? 0 : (i - 0.5) * radius * 1.03;
    nozzle(root, `rl10_${num(i)}`, [x, engineY + 0.08, 0], radius * (engines === 1 ? 0.56 : 0.44), engineY);
  }
  const payload = part(root, 'payload_adapter', [0, height - 0.22, 0]);
  cylinder(payload, m.alloy, radius * 0.67, 0, 0.22, undefined, 36, radius * 0.53);
  ports(root, height);
  return root;
}

export function atlasLaunch(id, payload, open = false) {
  const root = node(id);
  const core = placed(root, atlasCore());
  atlasClocking.forEach((angle, index) => {
    const radius = atlas.radius + atlasSrbRadius + 0.21;
    placed(root, atlasSrb(index), polar(radius, angle, atlasSrbBase), yaw(angle + Math.PI));
  });
  placed(root, adapter('atlas_v_interstage', atlas.radius, 1.54, 2.94, m.white), [0, core.position.y + atlas.coreTop, 0]);
  placed(root, atlasBoattail(), [0, atlas.coreTop, 0]);
  placed(root, centaur('atlas_v_centaur', 1.525, 12.65, 1), [0, atlas.upperBase, 0]);
  placed(root, payload, [0, 48.05, 0]);
  for (const [i, side] of [-1, 1].entries()) {
    placed(root, fairing(`atlas_v_fairing_${i === 0 ? 'l' : 'r'}`, 2.7, atlas.fairingHeight, side, 0.47, true),
      [open ? side * 4.3 : 0, atlas.fairingBase, 0]);
  }
  return root;
}

export function registerAtlas(out) {
  out.component(atlasCore());
  for (let i = 0; i < 4; i++) out.component(atlasSrb(i));
  out.component(centaur('atlas_v_centaur', 1.525, 12.65, 1));
  out.component(adapter('atlas_v_interstage', atlas.radius, 1.54, 2.94));
  out.component(atlasBoattail());
  for (const [id, side] of [['l', -1], ['r', 1]]) out.component(fairing(`atlas_v_fairing_${id}`, 2.7, atlas.fairingHeight, side, 0.47, true));
  out.variant('atlas_v_core_cutaway', 'cutaway', atlasCore(true));
}

export const falcon = { radius: 1.83, firstTop: 39.6, interstage: 3.45, secondTop: 56.85, fairing: 13.15 };

function falconLeg(root, index, angle, deployed) {
  const radius = falcon.radius;
  const leg = joint(root, `landing_leg_${num(index)}`, polar(radius - 0.04, angle, 1.28), X, 0);
  leg.quaternion.copy(yaw(angle).multiply(rot(X, deployed ? 1.87 : 0)));
  leg.userData.angleRadians = 1.87;
  const length = 6.35;
  const rail = node('shell', leg);
  box(rail, m.black, [0.91, length * 0.47, 0.19], [0, length * 0.235, 0.1]);
  for (const x of [-0.35, 0.35]) rod(rail, m.black, [x, 0, 0.11], [0, length - 0.15, 0.13], 0.107);
  box(rail, m.black, [0.38, 0.53, 0.31], [0, length - 0.15, 0.12]);
  const piston = part(leg, 'strut', [0, 2.3, 0.03]);
  rod(piston, m.alloy, [0, 0, 0], [0, 2.97, 0.055], 0.081);
}

function falconFirst(deployed = false) {
  const root = node('falcon9_stage_1');
  cylinder(root, m.white, falcon.radius, 2.85, falcon.firstTop);
  cylinder(root, m.dark, falcon.radius * 0.97, 2.58, 3.02);
  collars(root, falcon.radius * 1.007, [2.92, 3.75, 12.3, 19.8, 29.1, 37.9, falcon.firstTop - 0.1], 0.053, m.alloy);
  for (const a of [0, Math.PI]) {
    rod(root, m.white, polar(1.85, a, 4.6), polar(1.85, a, 37.85), 0.048);
    for (const y of [8, 20, 32]) box(root, m.steel, [0.22, 0.17, 0.09], polar(1.85, a, y), yaw(a));
  }
  nozzle(root, 'merlin_01', [0, 2.72, 0], 0.45, 2.72);
  for (let i = 0; i < 8; i++) nozzle(root, `merlin_${num(i + 1)}`, polar(1.19, i * tau / 8, 2.72), 0.433, 2.72);
  for (let i = 0; i < 4; i++) falconLeg(root, i, (i + 0.5) * tau / 4, deployed);
  ports(root, falcon.firstTop);
  return root;
}

function falconInterstage(deployed = false) {
  const root = adapter('falcon9_interstage', falcon.radius, falcon.radius, falcon.interstage, m.black);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * tau / 4;
    const fin = joint(root, `grid_fin_${num(i)}`, polar(falcon.radius + 0.055, a, 1.2), X, 0);
    fin.quaternion.copy(yaw(a).multiply(rot(X, deployed ? Math.PI / 2 : 0)));
    fin.userData.angleRadians = Math.PI / 2;
    const width = 0.91;
    const height = 1.15;
    for (let column = 0; column <= 6; column++) box(fin, m.steel, [0.045, height, 0.091], [(column / 6 - 0.5) * width, height / 2, 0]);
    for (let row = 0; row <= 7; row++) box(fin, m.steel, [width, 0.042, 0.091], [0, row * height / 7, 0]);
  }
  return root;
}

function falconSecond() {
  const root = node('falcon9_stage_2');
  const height = falcon.secondTop - falcon.firstTop - falcon.interstage;
  cylinder(root, m.white, falcon.radius, 0.03, height - 0.38);
  collars(root, falcon.radius * 1.005, [0.04, 0.52, 3.27, height - 0.51], 0.066);
  nozzle(root, 'merlin_vac', [0, 0.21, 0], 1.31, 3.11, neg(Y), m.steel);
  const top = part(root, 'payload_adapter', [0, height - 0.38, 0]);
  cylinder(top, m.dark, falcon.radius, 0, 0.38, undefined, 40, 1.35);
  ports(root, height);
  return root;
}

export function falconLaunch(id, payload, fairingPose = 'none') {
  const root = node(id);
  placed(root, falconFirst());
  placed(root, falconInterstage(), [0, falcon.firstTop, 0]);
  placed(root, falconSecond(), [0, falcon.firstTop + falcon.interstage, 0]);
  placed(root, payload, [0, falcon.secondTop, 0]);
  if (fairingPose !== 'none') {
    for (const [label, side] of [['l', -1], ['r', 1]]) {
      const x = fairingPose === 'open' ? 4.1 * side : 0;
      placed(root, fairing(`falcon9_fairing_${label}`, 2.6, falcon.fairing, side, 0.43), [x, falcon.secondTop, 0]);
    }
  }
  return root;
}

export function registerFalcon(out) {
  out.component(falconFirst());
  out.component(falconInterstage());
  out.component(falconSecond());
  for (const [label, side] of [['l', -1], ['r', 1]]) out.component(fairing(`falcon9_fairing_${label}`, 2.6, falcon.fairing, side, 0.43));
  const returning = node('falcon9_booster');
  placed(returning, falconFirst(true));
  placed(returning, falconInterstage(true), [0, falcon.firstTop, 0]);
  out.variant('falcon9_booster_landing', 'gear_and_grid_fins_deployed', returning);
}

function titanStage(index) {
  const root = node(`titan_stage_${index}`);
  const height = index === 1 ? 22.3 : 7.9;
  const engineY = index === 1 ? 2.65 : 1.66;
  cylinder(root, m.white, 1.525, engineY - 0.13, height);
  jacket(root, m.alloy, 1.534, height - 0.08, false, height - 2.1);
  collars(root, 1.54, [engineY, engineY + 0.72, height - 2.14, height - 0.14], 0.09, m.dark);
  if (index === 1) {
    for (const [i, x] of [-0.65, 0.65].entries()) nozzle(root, `lr87_${num(i)}`, [x, engineY, 0], 0.64, engineY);
    for (const side of [-1, 1]) {
      for (const y of [3.1, 19.2]) mount(root, `mount_srb_${side < 0 ? 'l' : 'r'}_${y < 4 ? 'lower' : 'upper'}`,
        [side * 1.525, y, 0], [side, 0, 0]);
    }
  } else nozzle(root, 'lr91', [0, engineY, 0], 0.77, engineY);
  ports(root, height);
  return root;
}

function titanSrb(id) {
  const root = solid(`titan_srb_${id}`, 1.52, 25.9, 5, { shroud: m.bright, accent: m.steel });
  const tank = part(root, 'injection_tank', [1.05, 1.1, 0]);
  cylinder(tank, m.orange, 0.18, 0, 1.96, undefined, 20);
  for (const [label, y] of [['lower', 4.6], ['upper', 20.7]]) mount(root, `mount_core_${label}`, [0, y, 1.52], Z);
  return root;
}

function titanFairings() {
  return [['l', -1], ['r', 1]].map(([label, side]) => fairing(`titan_centaur_fairing_${label}`, 2.135, 17.1, side, 0.57));
}

export function titanLaunch(payload, open = false) {
  const root = node('voyager_2_launch');
  placed(root, titanStage(1), [0, 1.5, 0]);
  placed(root, titanStage(2), [0, 23.8, 0]);
  placed(root, titanSrb('l'), [-3.03, 0, 0], yaw(Math.PI / 2));
  placed(root, titanSrb('r'), [3.03, 0, 0], yaw(-Math.PI / 2));
  placed(root, centaur('titan_centaur', 1.525, 9.05, 2), [0, 31.7, 0]);
  placed(root, payload, [0, 40.75, 0]);
  titanFairings().forEach((item, i) => placed(root, item, [open ? (i * 2 - 1) * 3.6 : 0, 31.7, 0]));
  return root;
}

export function registerTitan(out) {
  out.component(titanStage(1));
  out.component(titanStage(2));
  out.component(titanSrb('l'));
  out.component(titanSrb('r'));
  out.component(centaur('titan_centaur', 1.525, 9.05, 2));
  titanFairings().forEach(out.component);
}
