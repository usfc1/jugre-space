import { BoxGeometry, CylinderGeometry, Quaternion, Vector3 } from 'three';
import { mesh, node, seal } from '../../original_parts/source/geometry.mjs';
import { MeshStandardMaterial } from 'three';
import { deckY, equipmentStand } from './vab-layout.mjs';

const finish = (name, color, metalness = 0, roughness = .78) =>
  new MeshStandardMaterial({ name, color, metalness, roughness });
const concrete = [0x62666a, 0x66696b, 0x686b6e, 0x64696b].map((color, i) => finish(`Concrete ${i + 1}`, color));
const enamel = [0x73808a, 0x7c878e, 0x697781].map((color, i) => finish(`Galvanized cladding ${i + 1}`, color, .18));
const steel = finish('Painted steel', 0x324451, .3);
const iron = finish('Graphite steel', 0x233039, .3);
const zinc = finish('Satin zinc', 0x8799a2, .55, .54);
const navy = finish('JUGRE equipment enamel', 0x294759, .24);
const amber = finish('Amber safety enamel', 0xba7431, .18);
const yellow = finish('Ochre floor paint', 0xcaa055);
const ivory = finish('Ivory floor paint', 0xc8ccc0);
const glass = finish('Workshop glazing', 0x567889, .48, .36);
const rubber = finish('Cable insulation', 0x192127);
const diffuser = new MeshStandardMaterial({
  name: 'Industrial strip diffuser', color: 0xa4b5bc, emissive: 0xbad7e5, emissiveIntensity: .68,
});
const cube = new BoxGeometry(1, 1, 1);
const cylinder = new CylinderGeometry(.5, .5, 1, 12);
const octagon = new CylinderGeometry(.5, .5, 1, 8);
const up = new Vector3(0, 1, 0);
const block = (parent, material, size, position, rotation) => mesh(parent, cube, material, position, rotation, size);
const slab = (parent, material, [x, z], [w, d], level = .025) =>
  block(parent, material, [w, .015, d], [x, level, z]);
const rail = (parent, material, start, end, thickness) => {
  const from = new Vector3(...start);
  const to = new Vector3(...end);
  const axis = to.clone().sub(from);
  return block(parent, material, [thickness, axis.length(), thickness], from.lerp(to, .5).toArray(),
    new Quaternion().setFromUnitVectors(up, axis.normalize()));
};
const section = (parent, name, position) => node(name, parent, position, { occluder: true });
const west = -27, east = 35, back = -19, front = 53, roofY = 136;
const levels = [3.3, 7.7, 14, 23, 35, 49, 65, 82, 99, 115, 126];

function placard(parent, name, position, width, height, lines, rotation = 0, floor = false) {
  const sign = node(name, parent, position, { sign: { width, height, lines } });
  if (floor) sign.rotation.x = -Math.PI / 2;
  else sign.rotation.y = rotation;
  return sign;
}

function buildFloor(root) {
  const floor = node('concrete_slab', root);
  const span = east - west;
  block(floor, iron, [span + 1, .32, front - back + 1], [(west + east) / 2, -.42, (back + front) / 2]);
  for (let ix = 0; ix < 8; ix++) {
    for (let iz = 0; iz < 9; iz++) {
      const width = span / 8, depth = (front - back) / 9;
      block(floor, concrete[(ix + iz * 3 + (ix * iz) % 3) % 4], [width - .035, .25, depth - .035],
        [west + width * (ix + .5), -.125, back + depth * (iz + .5)]);
    }
  }
  // Recessed transporter tracks and pedestrian boundaries.
  for (const x of [-8.8, 8.8]) {
    slab(floor, steel, [x, 32.5], [.22, 39]);
    slab(floor, zinc, [x, 32.5], [.045, 39], .036);
  }
  for (const x of [-11, 11]) slab(floor, yellow, [x, 15], [.11, 70]);
  for (const z of [-9.25, 9.25]) slab(floor, yellow, [0, z], [22, .11]);
  for (const sign of [-1, 1]) {
    for (const z of [-7.8, 0, 7.8]) {
      slab(floor, ivory, [sign * 10.5, z], [.55, .16]);
      slab(floor, ivory, [sign * 10.8, z], [.14, 1.35]);
    }
  }
  for (let i = 0; i < 32; i++) {
    const x = -22 + (i * 7.47) % 49;
    const z = 11 + (i * 5.21) % 37;
    slab(floor, concrete[i % 4], [x, z], [.07 + (i % 3) * .065, .15 + (i % 7) * .11], .011);
  }
  placard(floor, 'vehicle_lane', [0, .045, 12.25], 7.5, 2.3, ['VAB / 01', 'VEHICLE ASSEMBLY'], 0, true);
  placard(floor, 'equipment_lane', [19, .045, 15.7], 7, 2, ['02', 'PAYLOAD LAB'], 0, true);
}

function buildShell(root) {
  const shell = node('shell', root);
  for (let level = 0; level < 8; level++) {
    const base = level * 17;
    for (let i = 0; i < 7; i++) {
      const span = (east - west) / 7, x = west + (i + .5) * span;
      const panel = section(shell, `rear_${level}_${i}`, [x, base, back]);
      block(panel, enamel[(i + level) % 3], [span - .03, 16.97, .56], [0, 8.5, 0]);
      block(panel, steel, [.72, 17, 1.4], [-span / 2 + .36, 8.5, .73]);
      for (const y of [1, 5.1, 9.2, 13.3, 16.7]) block(panel, iron, [span, .095, .10], [0, y, .31]);
      if (level === 0) {
        block(panel, navy, [span - .06, 3.45, .14], [0, 1.73, .35]);
        block(panel, amber, [span - .06, .10, .16], [0, 3.46, .36]);
      }
      if (i === 3 && level === 0) {
        block(panel, iron, [8.65, 3.45, .21], [-2.2, 6.7, .48]);
        placard(panel, 'brand', [-2.2, 6.72, .60], 8.4, 3.2, ['JUGRE', 'VEHICLE ASSEMBLY BUILDING'])
          .userData.wordmark = true;
      }
      if (i === 3 && (level === 2 || level === 5)) {
        placard(panel, 'level', [-1.4, 9, .32], 6, 4, [String(level * 17).padStart(2, '0'), 'SERVICE LEVEL']);
      }
    }
    for (const x of [west, east]) {
      for (let i = 0; i < 6; i++) {
        const z = back + 6 + i * 12;
        const panel = section(shell, `side_${x}_${level}_${i}`, [x, base, z]);
        block(panel, enamel[(i + level + 1) % 3], [.58, 16.97, 11.97], [0, 8.5, 0]);
        block(panel, steel, [1.8, 17, .68], [0, 8.5, -5.72]);
        for (const y of [1, 6, 11, 16.7]) block(panel, iron, [.13, .115, 11.9], [x === west ? .32 : -.32, y, 0]);
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const z = back + 6 + i * 12;
    const bay = section(shell, `roof_bay_${i}`, [0, roofY, z]);
    block(bay, steel, [east - west, .55, 11.98], [(east + west) / 2, .28, 0]);
    for (const x of [-24, -12, 0, 12, 24, 34]) {
      block(bay, iron, [.26, .9, 11.9], [x, -.5, 0]);
      block(bay, diffuser, [.36, .14, 4.7], [x, -1.04, 1.4]);
    }
    for (let x = west; x < east; x += 6.2) {
      rail(bay, zinc, [x, -4.1, -5.85], [x + 6.2, -.7, -5.85], .27);
    }
    block(bay, zinc, [62, .35, .36], [4, -4.1, -5.85]);
  }
}

function buildGate(root) {
  const gate = node('sectional_gate', root);
  for (let level = 0; level < 9; level++) {
    const y = level * 15;
    const jamb = section(gate, `jamb_${level}`, [0, y, front]);
    for (const x of [west + 1, -14.6, 14.6, east - 1]) {
      block(jamb, steel, [1.6, 15, 2.25], [x, 7.5, 0]);
    }
    for (const [x, width] of [[-20.6, 12.8], [24.7, 20.6]]) {
      const wing = section(gate, `facade_${x}_${level}`, [x, y, front]);
      block(wing, enamel[level % 3], [width, 14.96, .7], [0, 7.5, 0]);
      block(wing, iron, [width, .14, .78], [0, 1.3, 0]);
    }
    for (const side of [-1, 1]) {
      const leaf = section(gate, `leaf_${level}_${side}`, [side * 7.2, y, front]);
      leaf.userData.gateSlide = side * 14.6;
      block(leaf, navy, [14.35, 14.96, .66], [0, 7.5, 0]);
      for (let dy = 1.2; dy < 15; dy += 1.48) block(leaf, steel, [14.34, .16, .84], [0, dy, 0]);
      block(leaf, amber, [.16, 14.98, .88], [-side * 7.08, 7.5, 0]);
    }
  }
}

function buildPlatform(root) {
  const platform = node('mounting_platform', root, [0, 0, 0], { rocketDeck: true });
  for (const [material, diameter, height, y] of [
    [iron, 7.85, .16, .08], [steel, 7.45, .54, .41], [yellow, 7.49, .07, .69], [navy, 7.36, .075, deckY - .0375],
  ]) mesh(platform, octagon, material, [0, y, 0], undefined, [diameter, height, diameter]);
  for (let i = 0; i < 8; i++) {
    const angle = (i + .5) * Math.PI / 4;
    const x = Math.sin(angle), z = Math.cos(angle);
    mesh(platform, cylinder, zinc, [x * 3.24, deckY + .018, z * 3.24], undefined, [.19, .036, .19]);
    block(platform, diffuser, [.18, .09, .29], [x * 3.45, .39, z * 3.45]);
  }
}

function guardrail(parent, x1, x2, y, z) {
  for (const dy of [.51, 1.03]) block(parent, amber, [x2 - x1, .075, .075], [(x1 + x2) / 2, y + dy, z]);
  for (let x = x1 + .09; x < x2; x += 1.32) block(parent, amber, [.075, 1.06, .075], [x, y + .52, z]);
}

function buildService(root) {
  const towers = node('service_platforms', root);
  const bridges = node('retractable_bridges', root);
  for (const side of [-1, 1]) {
    for (let i = 0; i < levels.length; i++) {
      const y = levels[i], previous = levels[i - 1] ?? 0;
      const tower = section(towers, `tower_${side}_${i}`, [side * 14, y, -4.3]);
      const tier = y - previous;
      for (const x of [-1.65, 1.65]) {
        for (const z of [-3, 1.4]) {
          block(tower, steel, [.52, tier + .02, .56], [x, -tier / 2, z]);
          block(tower, zinc, [.75, .18, .78], [x, -.22, z]);
        }
        rail(tower, steel, [x, -tier, -3], [x, 0, 1.4], .19);
      }
      block(tower, steel, [4.2, .27, 5.4], [0, -.11, -.65]);
      block(tower, iron, [3.9, .06, 5.1], [0, .04, -.65]);
      guardrail(tower, -2.05, 2.05, 0, 1.9);
      guardrail(tower, -2.05, 2.05, 0, -3.25);
      block(tower, diffuser, [1.8, .11, .21], [0, -.31, 1.51]);
      block(tower, navy, [1.03, 1.5, .4], [side * 1.29, .82, -2.72]);
      if (i < 3) {
        block(tower, iron, [1.42, .61, .13], [0, -.05, 2.01]);
        placard(tower, 'access_level', [0, -.05, 2.085], 1.32, .53, [`L${i + 1}`]);
      }

      const bridge = section(bridges, `bridge_${side}_${i}`, [side * 11.65, y, -4.25]);
      bridge.userData.bridgeSlide = side * 6.1;
      block(bridge, iron, [7.05, .23, 1.62], [-side * 3.25, -.12, 0]);
      block(bridge, zinc, [6.88, .06, 1.48], [-side * 3.25, .025, 0]);
      for (const z of [-.78, .78]) guardrail(bridge, -side * 3.25 - 3.48, -side * 3.25 + 3.48, 0, z);
      block(bridge, amber, [1.07, .13, 1.68], [-side * 6.21, -.07, 0]);
    }
  }
}

function buildCrane(root) {
  const rails = section(root, 'crane_runway', [0, 130, 0]);
  for (const x of [west + 2.3, east - 2.3]) {
    block(rails, steel, [.9, .75, 70.8], [x, 0, 17]);
    block(rails, zinc, [.27, .18, 70.8], [x, .44, 17]);
  }
  const crane = section(root, 'bridge_crane', [4, 130.85, 17]);
  for (const z of [-1.75, 1.75]) {
    block(crane, amber, [57.6, 1.5, .72], [0, .48, z]);
    block(crane, iron, [57.6, .2, 1.02], [0, -.3, z]);
  }
  for (const x of [-28.3, 28.3]) block(crane, iron, [1.5, .83, 5.6], [x, -.18, 0]);
  const carriage = node('trolley', crane, [-1, 1.1, 0]);
  block(carriage, amber, [2.73, .86, 4.2], [0, .2, 0]);
  const hook = node('hoist_hook', carriage, [0, -5, 0]);
  for (const x of [-.25, .25]) block(hook, rubber, [.07, 4.8, .07], [x, 2.4, 0]);
  block(hook, iron, [1.02, .46, .58], [0, 0, 0]);
  for (const [a, b] of [[[0, 0, 0], [0, -.75, 0]], [[0, -.75, 0], [.46, -.89, 0]], [[.46, -.89, 0], [.65, -.53, 0]]]) {
    rail(hook, amber, a, b, .16);
  }
}

function buildEquipment(root) {
  const utilities = section(root, 'ventilation_and_cable_trays', [0, 0, -17.3]);
  block(utilities, zinc, [37.5, .91, 1.04], [1.7, 9.75, 0]);
  block(utilities, iron, [1.35, 4.2, .9], [20.5, 7.7, 0]);
  for (let x = -15; x <= 18; x += 3.3) {
    block(utilities, steel, [.09, 1.02, 1.12], [x, 9.75, 0]);
    block(utilities, iron, [.18, .22, .66], [x, 3.73, .38]);
  }
  for (const y of [3.62, 3.76]) block(utilities, rubber, [37, .075, .14], [1.7, y, .51]);

  for (const [x, z] of [[-8.6, -12.1], [7.9, -12.1], [22, -10], [22, 1.8]]) {
    const cabinets = section(root, `technical_cabinets_${x}_${z}`, [x, 0, z]);
    block(cabinets, iron, [4.05, .19, 1.04], [0, .095, 0]);
    for (const dx of [-1.31, 0, 1.31]) {
      block(cabinets, steel, [1.28, 2.09, 1], [dx, 1.2, 0]);
      block(cabinets, navy, [1.15, 1.93, .1], [dx, 1.23, .525]);
      block(cabinets, glass, [.56, .36, .034], [dx, 1.71, .586]);
      block(cabinets, zinc, [.07, .26, .05], [dx + .43, 1.22, .595]);
      for (let i = 0; i < 4; i++) block(cabinets, iron, [.63, .037, .04], [dx, .42 + i * .11, .59]);
    }
  }
  const lab = node('payload_lab', root);
  const [x, y, z] = equipmentStand;
  block(lab, navy, [11.1, .1, 9], [x, .062, z]);
  for (const dx of [-5.44, 5.44]) slab(lab, yellow, [x + dx, z], [.11, 8.87], .12);
  for (const dz of [-4.4, 4.4]) slab(lab, yellow, [x, z + dz], [10.91, .11], .12);
  const stand = node('equipment_stand', lab, equipmentStand);
  for (const [material, diameter, height, offset] of [[iron, 5.9, .16, -.97], [steel, 4.7, .72, -.56], [zinc, 5.75, .19, -.095]]) {
    mesh(stand, octagon, material, [0, offset, 0], undefined, [diameter, height, diameter]);
  }
  for (const dx of [-1, 1]) {
    block(stand, amber, [1.08, .085, .36], [dx * 1.87, -.12, 2.09]);
    block(stand, zinc, [1.54, .18, .12], [dx * 1.02, -.49, 2.26]);
  }
  placard(lab, 'stand_label', [x, y - .45, z + 2.36], 2, .43, ['PAYLOAD / 02']);
  const booth = section(lab, 'service_room', [x, 0, z - 5.2]);
  block(booth, steel, [10.9, 4.72, .31], [0, 2.37, 0]);
  for (const dx of [-3.5, 3.5]) {
    block(booth, glass, [2.28, 1.42, .07], [dx, 2.35, .17]);
    block(booth, zinc, [.055, 1.43, .075], [dx, 2.35, .23]);
  }
  block(booth, iron, [2.03, 2.74, .075], [0, 1.4, .17]);
  block(booth, navy, [1.8, 2.6, .15], [0, 1.36, .20]);
  block(booth, diffuser, [9.35, .105, .21], [0, 3.65, .32]);
  placard(booth, 'payload_lab_sign', [0, 4.17, .18], 5.6, .72, ['PAYLOAD LAB']);
}

export function buildHangar() {
  const root = node('jugre_vab');
  buildFloor(root);
  buildShell(root);
  buildGate(root);
  buildPlatform(root);
  buildService(root);
  buildCrane(root);
  buildEquipment(root);
  return seal(root);
}
