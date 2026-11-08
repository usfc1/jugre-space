import { X, Y, Z, m, tau, num, neg, node, part, joint, mount, ports, placed, polar, yaw, rot,
  lathe, cylinder, ring, box, rod, nozzle, sphere, solar, bandedTank, cutawaySkin } from './geometry.mjs';
import { adapter, collars, jacket, solid } from './launchers.mjs';

const sls = { coreRadius: 4.205, coreTop: 64.6, lvsa: 8.4, icpsBase: 64.74, icps: 13.7, osa: 1.48 };
const esmHeight = 4.24;
const cmaHeight = 0.57;
const capsuleHeight = 3.32;

function core(cut = false) {
  const root = node('sls_core');
  const sections = [
    ['engine_section', 3.65, 9.2, m.orange], ['lh2_skin', 9.2, 42.9, m.orange],
    ['intertank', 42.9, 48.62, m.orange], ['lox_skin', 48.62, 60.55, m.orange],
    ['forward_skirt', 60.55, sls.coreTop, m.orange],
  ];
  for (const [id, y0, y1, mat] of sections) {
    const shell = node(id, root);
    jacket(shell, mat, sls.coreRadius, y1, cut, y0);
    collars(shell, sls.coreRadius * 1.004, [y0, y1 - 0.06], 0.06, m.nickel);
    if (id === 'intertank') {
      for (let i = 0; i < 48; i++) {
        const angle = i * tau / 48;
        if (cut && (angle > Math.PI * 1.5 || angle < Math.PI * 0.5)) continue;
        box(shell, m.orange, [0.115, y1 - y0 - 0.12, 0.15], polar(sls.coreRadius, angle, (y0 + y1) / 2), yaw(angle));
      }
    }
  }
  cylinder(root, m.dark, sls.coreRadius * 0.98, 3.55, 3.76);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * tau / 4;
    const engine = nozzle(root, `rs25_${num(i)}`, polar(2.16, a, 3.68), 1.17, 3.68, neg(Y), m.steel);
    cylinder(engine, m.alloy, 0.49, -0.2, 0.25);
  }
  for (const side of [-1, 1]) {
    for (const [label, y] of [['aft', 7.1], ['forward', 47.1]]) {
      mount(root, `mount_srb_${side < 0 ? 'l' : 'r'}_${label}`, [side * 4.415, y, 0], [side, 0, 0]);
      box(root, m.steel, [0.52, 0.88, 0.92], [side * (sls.coreRadius + 0.21), y, 0]);
    }
  }
  for (const z of [4.16, -4.16]) rod(root, m.orange, [0.62, 8.9, z], [0.62, 60.8, z], 0.095);
  if (cut) {
    const interior = node('cutaway', root, undefined, { role: 'cutaway' });
    bandedTank(node('lh2', interior), m.hydrogen, 9.25, 3.98, 33.6);
    bandedTank(node('lox', interior), m.lox, 48.7, 3.96, 11.7);
    rod(interior, m.alloy, [0, 5.3, -2.8], [0, 54.9, -2.8], 0.23);
  }
  ports(root, sls.coreTop);
  return root;
}

function booster(side) {
  const root = solid(`sls_srb_${side}`, 1.855, 53.9, 5, { tapered: false, accent: m.dark });
  for (const y of [2.5, 11.9, 21.5, 31.2, 40.8, 49.4]) collars(root, 1.87, [y], 0.085, m.steel);
  for (const a of [-0.28, 0.28]) {
    for (const y of [1.65, 49.3]) cylinder(root, m.white, 0.16, y, y + 0.47, polar(1.85, a));
  }
  for (const [name, y] of [['aft', 7.1], ['forward', 47.1]]) mount(root, `mount_core_${name}`, [0, y, 1.855], Z);
  return root;
}

function icps(cut = false) {
  const root = node('icps');
  const h = sls.icps;
  jacket(root, m.orange, 2.55, h - 2.1, cut, 4.8);
  jacket(root, m.white, 2.56, h - 0.46, cut, h - 2.2);
  lathe(root, m.alloy, [[1.65, 3.78], [2.55, 4.82]], cut ? { start: Math.PI / 2, sweep: Math.PI } : undefined);
  collars(root, 2.57, [4.8, 5.18, 10.8, h - 2.14, h - 0.48], 0.085);
  nozzle(root, 'rl10', [0, 4.27, 0], 1.03, 4.27);
  cylinder(root, m.alloy, 2.27, h - 0.46, h, undefined, 48, 2.21);
  const target = part(root, 'proximity_target', [0.86, 11.77, 2.46], neg(Z));
  box(target, m.white, [0.59, 0.59, 0.045]);
  box(target, m.dark, [0.037, 0.45, 0.014], [0, 0, 0.031]);
  box(target, m.dark, [0.45, 0.037, 0.014], [0, 0, 0.031]);
  if (cut) {
    const inside = node('cutaway', root, undefined, { role: 'cutaway' });
    bandedTank(node('hydrogen', inside), m.hydrogen, 4.9, 2.31, 4.05);
    bandedTank(node('oxygen', inside), m.lox, 9.05, 2.12, 3.19);
  }
  ports(root, h, sls.coreTop + sls.lvsa - sls.icpsBase);
  return root;
}

function orionCma() {
  return adapter('orion_cma', 2.43, 2.51, cmaHeight, m.white);
}

function orionEsm(deployed = true, cut = false) {
  const root = node('orion_esm');
  jacket(root, m.alloy, 2.07, esmHeight, cut, 0.95);
  collars(root, 2.12, [1.01, 1.13, esmHeight - 0.18], 0.095, m.white);
  nozzle(root, 'main_engine', [0, 1.15, 0], 0.79, 1.15);
  for (let i = 0; i < 8; i++) nozzle(root, `aux_thruster_${num(i)}`, polar(1.48, i * tau / 8, 1.1), 0.14, 0.39);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * tau / 4;
    const rcs = part(root, `rcs_cluster_${num(i)}`, polar(2.065, a, 1.67), neg(Z));
    rcs.quaternion.copy(yaw(a));
    box(rcs, m.alloy, [0.43, 0.32, 0.16], [0, 0, 0.035]);
    for (const [k, x] of [-0.14, 0, 0.14].entries()) nozzle(rcs, `nozzle_${num(k)}`, [x, 0, 0.08], 0.059, 0.09, [x * 3, 0, 1]);
    const panel = part(root, `radiator_${num(i)}`, polar(2.027, a + 0.39, 2.9), neg(Z));
    panel.quaternion.copy(yaw(a + 0.39));
    box(panel, m.white, [0.75, 2.14, 0.12]);
    for (let x = -3; x <= 3; x++) box(panel, m.bright, [0.019, 2.05, 0.009], [x * 0.1, 0, 0.065]);
    const wing = joint(root, `wing_${num(i)}`, polar(2.16, a, 2.04), X, 0, neg(Z));
    const wingAngle = deployed ? 0.15 : -Math.PI / 2;
    wing.quaternion.copy(yaw(a).multiply(rot(X, wingAngle)));
    wing.userData.angleRadians = Math.PI / 2 + 0.15;
    rod(wing, m.steel, [0, 0, 0], [0, 0, deployed ? 0.71 : 0.27], 0.087);
    let host = wing;
    for (let segment = 0; segment < 3; segment++) {
      const folded = deployed ? 0 : (segment % 2 ? Math.PI - 0.04 : -Math.PI + 0.04);
      const pivot = joint(host, `panel_${num(segment)}`, [0, segment && !deployed ? 0.038 : 0,
        segment ? 1.74 : deployed ? 0.65 : 0.24], X, segment ? folded : 0);
      const cells = node('cells', pivot, [0, 0, 0.87]);
      solar(cells, 1.65, 1.7, 9, 11);
      host = pivot;
    }
  }
  if (cut) {
    const inside = node('cutaway', root, undefined, { role: 'cutaway' });
    for (const [i, a] of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI].entries()) {
      const tank = node(`propellant_${num(i)}`, inside, polar(0.94, a, 1.35));
      bandedTank(tank, i % 2 ? m.fuel : m.lox, 0, 0.61, 2.42);
    }
    bandedTank(node('water', inside, [0, 1.6, 0]), m.water, 0, 0.26, 1.44);
    sphere(node('oxygen', inside), m.lox, [0.26, 0.29, 0.26], [0, 3.42, 0]);
  }
  ports(root, esmHeight);
  return root;
}

const cmProfile = [[2.51, 0.12], [2.48, 0.31], [2.32, 0.52], [1.66, 1.51], [0.88, 2.76], [0.78, 3.04]];

export function parachutes(parent, prefix, count, size, length) {
  const root = node(prefix, parent, undefined, { standalone: true });
  mount(root, 'mount_parent', [0, 0, 0], neg(Y));
  for (let i = 0; i < count; i++) {
    const spread = count > 1 ? size * 1.22 : 0;
    const [x, , z] = polar(spread, i * tau / count);
    const chute = part(root, `main_${num(i)}`, [x, length, z]);
    const profile = [[0, size * 0.43], [size * 0.36, size * 0.42], [size * 0.77, size * 0.31],
      [size * 0.96, size * 0.13], [size, 0]];
    for (let sector = 0; sector < 16; sector++) {
      const options = { start: sector * tau / 16, sweep: tau / 16, segments: 4 };
      const color = sector % 4 < 2 ? m.fabric : m.orange;
      lathe(chute, color, [...profile].reverse(), options);
      lathe(chute, color, profile.map(([r, y]) => [r, y - 0.018]), options);
    }
    for (let k = 0; k < 12; k++) {
      rod(root, m.fabric, [0, 0, 0], [x + size * Math.sin(k * tau / 12), length, z + size * Math.cos(k * tau / 12)], size * 0.003, 5);
    }
  }
  return root;
}

function orionCm(pose = 'flight') {
  const root = node('orion_cm');
  const cut = pose === 'cutaway';
  const panelOptions = cut ? { start: Math.PI / 2, sweep: Math.PI } : undefined;
  if (cut) cutawaySkin(root, m.bright, cmProfile, 0.065, m.alloy);
  else lathe(root, m.bright, cmProfile);
  for (const y of [0.63, 1.25, 1.95, 2.52]) {
    const r = 2.65 - y * 0.628;
    lathe(root, m.alloy, [[r, y], [r - 0.018, y + 0.028]], panelOptions);
  }
  const shield = part(root, 'heat_shield', [0, 0, 0], Y);
  lathe(shield, m.shield, [[0, 0], [1.78, 0.034], [2.38, 0.073], [2.51, 0.12], [2.49, 0.21], [2.37, 0.25]]);
  const hatch = joint(root, 'side_hatch', [-0.63, 1.37, 1.75], Y, 0, neg(Z));
  const tilt = rot(X, -0.57);
  if (!cut) {
    box(hatch, m.steel, [0.87, 0.96, 0.088], [0, 0, 0.055], tilt);
    box(hatch, m.white, [0.78, 0.85, 0.078], [0, 0, 0.098], tilt);
    box(hatch, m.window, [0.25, 0.22, 0.03], [0, 0.18, 0.09], tilt);
    for (const [i, a] of [-0.46, -0.15, 0.15, 0.46].entries()) {
      const window = part(root, `window_${num(i)}`, polar(1.52, a, 1.85), neg(Z));
      window.quaternion.copy(yaw(a).multiply(tilt));
      box(window, m.black, [0.42, 0.38, 0.062]);
      box(window, m.window, [0.34, 0.29, 0.02], [0, 0, 0.038]);
    }
  } else {
    // Export the hatch with geometry even when omitted from the classroom section.
    root.remove(hatch);
  }
  const top = part(root, 'upper_hatch', [0, 2.9, 0]);
  cylinder(top, m.alloy, 0.56, 0.03, 0.14);
  ring(top, m.steel, 0.65, 0.52, 0.1, 0.23);
  if (pose !== 'recovery') {
    const cover = part(root, 'forward_cover', [0, 3.01, 0]);
    lathe(cover, m.white, [[0.78, 0], [0.69, 0.18], [0.49, 0.31], [0, 0.31]]);
    const packs = part(root, 'parachutes_packed', [0, 2.82, 0]);
    for (let i = 0; i < 3; i++) box(packs, m.fabric, [0.27, 0.14, 0.24], polar(0.54, i * tau / 3));
  } else {
    const chute = parachutes(root, 'parachutes_deployed', 3, 17.65, 32);
    chute.position.y = 3.09;
  }
  for (const [i, a] of [0.87, 2.31, 4.01, 5.41].entries()) {
    const unit = part(root, `rcs_${num(i)}`, polar(2.08, a, 0.8), neg(Z));
    unit.quaternion.copy(yaw(a));
    for (const [j, x] of [-0.125, 0.125].entries()) nozzle(unit, `nozzle_${num(j)}`, [x, 0, 0.12], 0.056, 0.11, [0, -0.15, 1]);
  }
  if (cut) {
    const interior = node('cutaway', root, undefined, { role: 'cutaway' });
    cylinder(interior, m.steel, 2.27, 0.23, 0.36);
    for (const [i, x] of [-1.35, -0.46, 0.46, 1.35].entries()) {
      const seat = part(interior, `seat_${num(i)}`, [x, 0.44, -0.08]);
      box(seat, m.steel, [0.55, 0.1, 0.69]);
      box(seat, m.blue, [0.55, 0.64, 0.13], [0, 0.27, -0.34], rot(X, -0.25));
      for (const width of [-0.16, 0.16]) box(seat, m.black, [0.043, 0.61, 0.036], [width, 0.26, -0.24]);
    }
    const console = node('flight_console', interior, [0, 1.38, -0.76]);
    box(console, m.dark, [2.13, 0.32, 0.41], undefined, rot(X, 0.23));
    for (let i = -1; i <= 1; i++) box(console, m.window, [0.49, 0.2, 0.029], [i * 0.59, 0, 0.207]);
    const life = node('life_support', interior, [0, 0.48, -1.25]);
    box(life, m.bright, [1.65, 0.67, 0.41]);
    for (let i = -1; i <= 1; i++) rod(life, m.water, [i * 0.4, 0.17, 0.23], [i * 0.4, 0.49, 0.23], 0.046);
  }
  mount(root, 'mount_aft', [0, 0, 0], neg(Y));
  mount(root, 'mount_las', [0, capsuleHeight, 0]);
  return root;
}

function las(cut = false) {
  const root = node('orion_las');
  const shroud = [[2.61, 0], [2.57, 0.47], [1.9, 1.42], [1.1, 2.73], [0.55, 3.85], [0.48, 4.66]];
  const tower = [[0.48, 4.3], [0.48, 12.81], [0.36, 13.13], [0.043, 13.41]];
  for (const profile of [shroud, tower]) {
    if (cut) cutawaySkin(root, m.white, profile, 0.028, m.alloy);
    else lathe(root, m.white, profile);
  }
  for (const y of [4.71, 6.92, 9.27, 11.2, 12.61]) collars(root, 0.488, [y], 0.065, m.alloy);
  for (let i = 0; i < 4; i++) {
    const angle = i * tau / 4;
    nozzle(root, `abort_nozzle_${num(i)}`, polar(0.45, angle, 9.58), 0.141, 0.31, polar(1, angle, -0.33));
  }
  if (cut) {
    const inside = node('cutaway', root, undefined, { role: 'cutaway' });
    for (const [id, y, height, mat] of [['jettison_motor', 4.98, 1.7, m.alloy],
      ['abort_motor', 7.03, 2.43, m.fuel], ['attitude_motor', 10.65, 1.7, m.lox]]) {
      cylinder(node(id, inside), mat, 0.39, y, y + height);
    }
  }
  mount(root, 'mount_capsule', [0, capsuleHeight, 0], neg(Y));
  return root;
}

function esmFairing(index, deployed = false) {
  const root = node(`esm_fairing_${num(index)}`);
  const a = index * tau / 3;
  const center = polar(2.44, a);
  const panel = joint(root, 'panel', center, X, 0);
  panel.quaternion.copy(yaw(a).multiply(rot(X, deployed ? 1.08 : 0)));
  panel.userData.angleRadians = 1.08;
  const skin = node('skin', panel, [0, 0, -2.44]);
  const profile = [[2.54, 0], [2.56, 0.37], [2.53, 3.85], [2.49, esmHeight + cmaHeight]];
  const options = { start: -tau / 6 + 0.008, sweep: tau / 3 - 0.016, segments: 25 };
  lathe(skin, m.white, profile, options);
  lathe(skin, m.alloy, [...profile].reverse().map(([r, y]) => [r - 0.039, y]), options);
  mount(root, 'mount_osa', [0, 0, 0], neg(Y));
  return root;
}

function orion(cut = false) {
  const root = node('orion_integrity');
  placed(root, orionEsm(true, cut));
  placed(root, orionCma(), [0, esmHeight, 0]);
  placed(root, orionCm(cut ? 'cutaway' : 'flight'), [0, esmHeight + cmaHeight, 0]);
  mount(root, 'mount_aft', [0, 0, 0], neg(Y));
  return root;
}

function launch() {
  const root = node('artemis_ii_launch');
  placed(root, core());
  for (const [side, label] of [[-1, 'l'], [1, 'r']]) {
    placed(root, booster(label), [side * 6.27, 0, 0], yaw(-side * Math.PI / 2));
  }
  placed(root, adapter('lvsa', sls.coreRadius, 2.57, sls.lvsa, m.orange), [0, sls.coreTop, 0]);
  placed(root, icps(), [0, sls.icpsBase, 0]);
  const osaY = sls.icpsBase + sls.icps;
  placed(root, adapter('osa', 2.57, 2.54, sls.osa), [0, osaY, 0]);
  const esmY = osaY + sls.osa;
  placed(root, orionEsm(false), [0, esmY, 0]);
  placed(root, orionCma(), [0, esmY + esmHeight, 0]);
  const cmY = esmY + esmHeight + cmaHeight;
  placed(root, orionCm(), [0, cmY, 0]);
  for (let i = 0; i < 3; i++) placed(root, esmFairing(i), [0, esmY, 0]);
  placed(root, las(), [0, cmY, 0]);
  return root;
}

export function registerArtemis(out) {
  for (const item of [core(), booster('l'), booster('r'), adapter('lvsa', sls.coreRadius, 2.57, sls.lvsa, m.orange),
    icps(), adapter('osa', 2.57, 2.54, sls.osa), orionCma(), orionEsm(), orionCm(), las()]) out.component(item);
  const shroud = node('esm_fairing');
  for (let i = 0; i < 3; i++) placed(shroud, esmFairing(i));
  out.component(shroud);
  for (let i = 0; i < 3; i++) out.component(esmFairing(i));
  out.assembly(launch(), 'launch');
  out.assembly(orion(), 'solar_wings_deployed');
  out.variant('sls_core_cutaway', 'cutaway', core(true));
  out.variant('icps_cutaway', 'cutaway', icps(true));
  out.variant('orion_esm_stowed', 'wings_stowed', orionEsm(false));
  out.variant('orion_esm_cutaway', 'cutaway', orionEsm(true, true));
  out.variant('orion_cutaway', 'cutaway', orion(true));
  out.variant('orion_las_cutaway', 'cutaway', las(true));
  out.variant('orion_recovery', 'parachutes_deployed', orionCm('recovery'));
  const removed = node('esm_fairing');
  for (let i = 0; i < 3; i++) placed(removed, esmFairing(i, true), polar(0.51, i * tau / 3));
  out.variant('esm_fairing_open', 'panels_jettisoned', removed);
  const proximity = node('artemis_ii_icps_proximity');
  placed(proximity, icps());
  placed(proximity, orion(), [0, 31, 2.2], rot(X, Math.PI));
  out.assembly(proximity, 'proximity_without_docking');
}
