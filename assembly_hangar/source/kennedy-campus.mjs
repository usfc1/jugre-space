import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Path, Shape, ShapeGeometry } from 'three';
import { box, cylinder, mesh, node, rod, rot, sphere, X, yaw } from '../../original_parts/source/geometry.mjs';
import { kennedySites, kennedyTiles } from './kennedy-layout.mjs';

const paint = (name, color) => new MeshStandardMaterial({ name, color, roughness: 0.87 });
const wall = paint('VAB aluminium siding', 0xc9cac3);
const ribs = paint('VAB siding shadows', 0xb4b8b4);
const cap = paint('Concrete and light roofs', 0xb9bdba);
const gravel = paint('Crawlerway river gravel', 0x9e9b8b);
const doors = paint('High bay door panels', 0x898e89);
const window = paint('Control centre glazing', 0x34515e);
const truss = paint('Tower galvanised steel', 0xbcc4c3);
const orange = paint('Safety markings', 0xa84932);
const flagBlue = paint('Flag and NASA roundel blue', 0x153a76);
const white = paint('White markings', 0xefeee7);

function at(parent, name, [x, z], extras) {
  return node(name, parent, [x, 0, z], extras);
}

export function kennedyTerrain(root) {
  const ground = node('kennedy_aerial_imagery', root);
  for (const [index, { id, bounds }] of kennedyTiles.entries()) {
    const inner = kennedyTiles[index + 1]?.bounds;
    const [west, north, east, south] = bounds;
    const positions = [];
    const uv = [];
    const rect = (left, top, right, bottom) => {
      for (const [x, z] of [[left, top], [left, bottom], [right, bottom], [left, top], [right, bottom], [right, top]]) {
        positions.push(x, -0.08, z);
        uv.push((x - west) / (east - west), (z - north) / (south - north));
      }
    };
    if (inner) {
      const [left, top, right, bottom] = inner;
      rect(west, north, east, top);
      rect(west, bottom, east, south);
      rect(west, top, left, bottom);
      rect(right, top, east, bottom);
    } else {
      rect(...bounds);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    const material = paint(`Kennedy aerial ${id}`, 0xffffff);
    // Aerial imagery already contains sunlight and shadows. Keep the strong
    // scene lights from bleaching the concrete and vegetation a second time.
    material.color.setScalar(0.5);
    material.roughness = 1;
    material.envMapIntensity = 0.2;
    material.dithering = true;
    const tile = mesh(ground, geometry, material);
    tile.name = `kennedy_aerial_${id}`;
    tile.userData.kennedyTile = id;
    if (id === 'pad39a') {
      const slopes = new BufferGeometry();
      const xyz = [
        46, 1.6, -55, 46, 1.6, 28, 85, 0, 66,
        46, 1.6, -55, 85, 0, 66, 86, 0, -36,
        -46, 1.6, -55, -85, 0, 66, -46, 1.6, 28,
        -46, 1.6, -55, -86, 0, -36, -85, 0, 66,
      ];
      const st = [];
      for (let i = 0; i < xyz.length; i += 3) {
        st.push((xyz[i] - west) / (east - west), (xyz[i + 2] - north) / (south - north));
      }
      slopes.setAttribute('position', new Float32BufferAttribute(xyz, 3));
      slopes.setAttribute('uv', new Float32BufferAttribute(st, 2));
      slopes.computeVertexNormals();
      mesh(ground, slopes, material).name = 'kennedy_pad_berms';
    }
  }
}

function facility(parent, name, point, [width, height, length], angle = 0) {
  const building = at(parent, name, point);
  building.rotation.y = angle;
  box(building, wall, [width, height, length], [0, height / 2, 0]);
  box(building, cap, [width + 1, 0.7, length + 1], [0, height, 0]);
  return building;
}

function vehicleAssembly(parent) {

  const ivory = paint('VAB warm aluminium panels', 0xd6d6ce);
  const panelShades = [0xcacdc7, 0xd0d2cc, 0xd4d5cf, 0xcdd0ca].map((color, index) => paint(`VAB cladding tone ${index}`, color));
  const joint = paint('VAB recessed panel joints', 0x939b98);
  const recess = paint('VAB door recesses', 0x343e41);
  const doorPanel = paint('VAB sliding door skin', 0xaab4b2);
  const roof = paint('VAB weathered roof membrane', 0x929b98);
  const flagRed = paint('VAB flag crimson', 0xa1353d);
  const nasaRed = paint('VAB NASA vector red', 0xb93832);
  const vab = at(parent, 'vehicle_assembly_building', kennedySites.vab);
  vab.rotation.y = -0.27;

  // High bay 158 x 135 x 160 m, with an 83 m low-bay extension to the south.
  box(vab, ivory, [158, 160, 135], [0, 80, 0]);
  box(vab, roof, [156.8, .32, 133.8], [0, 160.05, 0]);
  for (const side of [-1, 1]) {
    box(vab, ivory, [158, 1.1, .65], [0, 160.25, side * 67.35]);
    box(vab, ivory, [.65, 1.1, 135], [side * 78.85, 160.25, 0]);
  }

  // Shallow panel variation and fine vertical seams avoid oversized ribbing.
  for (const side of [-1, 1]) {
    const facade = node(`vab_end_cladding_${side}`, vab, [0, 0, side * 67.72]);
    facade.rotation.y = side < 0 ? Math.PI : 0;
    for (let col = 0; col < 36; col++) {
      const x = -76.6 + col * 4.38;
      for (let row = 0; row < 10; row++) {
        const y = 8 + row * 16;
        box(facade, panelShades[(col * 7 + row * 3) % 4], [4.35, 15.96, .045], [x, y, 0]);
      }
    }
    // Central transfer-aisle elevation framed by the broad plain corner walls.
    box(facade, joint, [58, 160, .10], [0, 80, .42]);
    box(facade, doorPanel, [42, 96, .13], [0, 90, .65]);
    for (const x of [-25.7, 25.7]) box(facade, ivory, [7, 108, .18], [x, 87, .85]);
    box(facade, ivory, [58.3, 8, .18], [0, 138, .85]);
    for (let y = 46; y < 136; y += 4.8) box(facade, joint, [42, .09, .05], [0, y, .86]);
  }

  // Each east/west face has two inverted-T doorways and seven lift sections.
  for (const side of [-1, 1]) {
    const elevation = node(`vab_high_bay_doors_${side}`, vab, [side * 79.05, 0, 0]);
    elevation.rotation.y = side * Math.PI / 2;
    for (const center of [-34, 34]) {
      box(elevation, recess, [29, 140, .22], [center, 70, .11]);
      box(elevation, recess, [47, 35, .24], [center, 17.5, .15]);
      for (let level = 0; level < 7; level++) {
        const y = 35 + (level + .5) * (104 / 7);
        box(elevation, doorPanel, [25.2, 104 / 7 - .6, .3], [center, y, .43 + level * .07]);
        box(elevation, ribs, [25.3, .3, .4], [center, y - 7.0, 1.08 + level * .07]);

      }
      for (let panel = 0; panel < 8; panel++) {
        const x = center - 20.1 + panel * 5.74;
        box(elevation, doorPanel, [5.63, 34.3, .32], [x, 17.2, .45]);
        for (const y of [8.5, 17, 25.5]) box(elevation, joint, [5.6, .09, .08], [x, y, .82]);
      }
      for (const offset of [-16, 16]) {
        box(elevation, ivory, [4.6, 160, 3.8], [center + offset, 80, 1.7]);
        box(elevation, joint, [.5, 139, .65], [center + Math.sign(offset) * 13.2, 69.5, 1.2]);
      }
      box(elevation, ivory, [37, 19, 3.8], [center, 150.5, 1.7]);
      box(elevation, cap, [51, .18, 17], [center, .04, 10]);
      for (const offset of [-20, 20]) box(elevation, joint, [.12, .045, 16], [center + offset, .15, 10]);
    }
    for (const edge of [-65.9, 0, 65.9]) box(elevation, ivory, [3.5, 160, 4.2], [edge, 80, 1.7]);
  }

  // The low bay has a tall central aisle above lower workshop roofs.
  box(vab, ivory, [134.7, 27, 83.2], [0, 13.5, 109.1]);
  box(vab, roof, [133.9, .35, 82.5], [0, 27.1, 109.1]);
  box(vab, ivory, [42, 64, 83.2], [0, 32, 109.1]);
  box(vab, roof, [41.4, .35, 82.5], [0, 64.1, 109.1]);
  const entrance = node('vab_low_bay_entrance', vab, [0, 0, 150.78]);
  box(entrance, doorPanel, [31.5, 37, .15], [0, 44.5, 0]);
  for (let y = 28; y < 63; y += 4) box(entrance, joint, [31.5, .08, .08], [0, y, .13]);
  box(entrance, recess, [33, 16.2, .18], [0, 8.1, .12]);
  for (const x of [-12.2, 12.2]) box(entrance, doorPanel, [8.1, 16, .3], [x, 8, .3]);
  box(entrance, cap, [38, .55, 5], [0, 17.3, 2]);
  for (const side of [-1, 1]) {
    box(vab, ivory, [45, 1, .5], [side * 44.5, 27.5, 150.6]);
    box(vab, ivory, [.5, 1, 83], [side * 67.1, 27.5, 109]);
    box(vab, ivory, [.5, 1, 83], [side * 20.8, 64.5, 109]);
    for (let x = 25; x < 65; x += 7.6) {
      box(entrance, window, [4.5, 1.6, .16], [side * x, 6.8, .12]);
      box(entrance, ribs, [4.8, .22, .55], [side * x, 5.8, .35]);
    }
    box(entrance, joint, [2.3, 3, .16], [side * 56, 1.5, .12]);
  }

  // Paintwork on the south high-bay wall. The flag hangs vertically.
  const flag = node('vab_south_flag', vab, [-52, 113.8, 68.35]);
  for (let stripe = 0; stripe < 13; stripe++) {
    box(flag, stripe % 2 ? white : flagRed, [33.5 / 13, 63.7, .035], [-16.75 + (stripe + .5) * 33.5 / 13, 0, 0]);
  }
  box(flag, flagBlue, [18.04, 25.48, .045], [-7.73, 19.11, .24]);
  const star = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 ? .22 : .52;
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    if (i === 0) star.moveTo(x, y); else star.lineTo(x, y);
  }
  star.closePath();
  const starGeometry = new ShapeGeometry(star);
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < (row % 2 ? 5 : 6); col++) {
      mesh(flag, starGeometry, white, [-15.2 + col * 2.98 + (row % 2) * 1.49, 29.4 - row * 2.57, .43]);
    }
  }

  const badge = node('vab_south_nasa', vab, [51, 123, 68.45]);
  cylinder(badge, flagBlue, 16.75, -.025, .025, [0, 0, 0], 96).quaternion.copy(rot(X, Math.PI / 2));
  for (let i = 0; i < 43; i++) {
    const a = i * 2.39996, r = 3 + Math.sqrt((i * 19 % 43) / 43) * 12.4;
    mesh(badge, starGeometry, white, [Math.cos(a) * r, Math.sin(a) * r, .22], undefined, [.28, .28, .28]);
  }
  for (let i = 0; i < 90; i++) {
    const a = i * Math.PI * 2 / 90, b = (i + 1) * Math.PI * 2 / 90;
    const point = (t) => [Math.cos(t) * 5.5 + Math.sin(t) * 7, Math.sin(t) * 12.7, .38];
    rod(badge, white, point(a), point(b), .065, 5);
  }
  const swoosh = new Shape();
  swoosh.moveTo(-20, -12);
  swoosh.bezierCurveTo(-3, -1, 13, 1, 23, 19);
  swoosh.bezierCurveTo(17, 5, 6, 0, -20, -12);
  mesh(badge, new ShapeGeometry(swoosh, 30), nasaRed, [0, 0, .56]);

  const glyphs = [
    [[0,0],[0,7],[1.6,7],[5.1,1.8],[5.1,7],[6.1,7],[6.1,0],[4.5,0],[1,5.4],[1,0]],
    [[0,0],[2.6,7],[4.2,7],[6.8,0],[5.1,0],[4.5,1.9],[2,1.9],[1.4,0]],
    [[.1,.4],[.1,2],[1.8,.8],[3.7,.8],[4.6,1.5],[4.5,2.4],[.8,3.6],[0,4.7],[.3,6.2],[1.5,7],[4.7,7],[5.7,6.5],[5.7,5],[4,6.1],[2.1,6.1],[1.3,5.4],[1.6,4.6],[5,3.4],[5.8,2.3],[5.7,1],[4.5,0],[1.4,0]],
  ];
  for (const [index, type] of [0,1,2,1].entries()) {
    const outline = new Shape();
    glyphs[type].forEach(([x,y], i) => i ? outline.lineTo(x,y) : outline.moveTo(x,y));
    outline.closePath();
    if (type === 1) {
      const hole = new Path();
      hole.moveTo(2.35,2.85); hole.lineTo(4.15,2.85); hole.lineTo(3.25,5.5); hole.closePath();
      outline.holes.push(hole);
    }
    mesh(badge, new ShapeGeometry(outline), white, [-13.2 + index * 7.05, -3.5, .77]);
  }

  // Roof equipment, parapets and small antennas give scale without tall boxes.
  for (const x of [-57, 57]) {
    for (const z of [-43, 0, 43]) {
      box(vab, cap, [8.4, 2.2, 10.6], [x, 161.2, z]);
      for (let n = -3; n <= 3; n++) box(vab, recess, [6.6, .12, .27], [x, 162.35, z + n * 1.1]);
    }
  }
  for (const x of [-69, -25, 26, 68]) {
    rod(vab, truss, [x, 160.4, 63], [x, 163.8, 63], .065, 6);
  }
  for (const side of [-1, 1]) {
    for (const z of [83, 122, 143]) {
      box(vab, cap, [10, 2.7, 7], [side * 43, 28.6, z]);
      for (let n = 0; n < 5; n++) box(vab, recess, [8.5, .12, .3], [side * 43, 30, z - 2 + n]);
    }
  }

  const control = facility(parent, 'launch_control_center', kennedySites.lcc, [72, 27, 55], -0.27);
  for (const y of [8, 14, 20]) {
    box(control, window, [72, 3.4, 0.23], [0, y, 27.62]);
    box(control, window, [0.23, 3.4, 53], [36.12, y, 0]);
  }
  node('lcc_name', control, [0, 4, 27.8], { role: 'outdoorSign', text: 'LAUNCH CONTROL CENTER', widthM: 32, heightM: 3.4 });
  facility(parent, 'orbiter_processing_facility', [-4890, 2335], [122, 29, 92], -0.27);
  facility(parent, 'operations_support_building', [-4970, 2200], [87, 19, 55], -0.27);
  facility(parent, 'logistics_building', [-4714, 2980], [94, 14, 52], -0.13);
  facility(parent, 'press_site', [-4225, 2700], [64, 8, 23], -0.4);
  facility(parent, 'runway_operations', [-7190, 1250], [66, 15, 42], 0.48);
  facility(parent, 'hangar_by_runway', [-7215, 1105], [91, 23, 66], 0.48);
}

function crawlerway(parent) {
  const group = node('crawlerway', parent);
  const junction = [-1360, 1210];
  const routes = [
    [[-4530, 2315], [-4210, 2390], [-3755, 2290], [-2840, 1865], junction, [-250, 735], [-5, 600], [-5, 235]],
    [junction, [-1300, 1010], [-1590, 320], [-1625, -1160], [-1625, -1930]],
  ];
  for (const points of routes) {
    for (let i = 1; i < points.length; i++) {
      const [x1, z1] = points[i - 1];
      const [x2, z2] = points[i];
      const angle = Math.atan2(x2 - x1, z2 - z1);
      const length = Math.hypot(x2 - x1, z2 - z1);
      for (const offset of [-12.5, 12.5]) {
        box(group, gravel, [11.5, 0.08, length + 2.0], [
          (x1 + x2) / 2 + Math.cos(angle) * offset, -0.024, (z1 + z2) / 2 - Math.sin(angle) * offset,
        ], yaw(angle));
      }
    }
  }
}

function padB(parent) {
  const pad = at(parent, 'launch_pad_39b', kennedySites.pad39b);
  box(pad, cap, [80, 2.8, 94], [0, 1.4, 0]);
  box(pad, doors, [17, 0.12, 94], [0, 2.85, 0]);
  for (const x of [-23, 23]) box(pad, cap, [12, 10, 38], [x, 7, 0]);
  box(pad, cap, [38, 0.7, 132], [0, 0.35, 99]);
  facility(pad, 'pad_b_equipment_room', [67, 71], [28, 7, 17], 0.45);
  facility(pad, 'pad_b_operations', [-61, 103], [22, 6, 13], -0.43);
  const towers = [[-94, -70], [92, -58], [1, 108]];
  for (const [x, z] of towers) {
    const mast = at(pad, 'lightning_tower_39b', [x, z]);
    box(mast, cap, [15, 2, 15], [0, 1, 0]);
    const top = 151;
    const width = (y) => 4.6 - y * 3.6 / top;
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        rod(mast, truss, [a * width(0), 2, b * width(0)], [a * width(top), top, b * width(top)], 0.35, 8);
      }
    }
    for (let y = 5; y < top; y += 12) {
      const next = Math.min(y + 12, top);
      const w = width(y);
      const wn = width(next);
      const metal = y > 107 && y % 24 < 12 ? orange : truss;
      for (const side of [-1, 1]) {
        rod(mast, metal, [-w, y, w * side], [wn, next, wn * side], .19, 6);
        rod(mast, metal, [w * side, y, w], [wn * side, next, -wn], .19, 6);
        rod(mast, truss, [-w, y, w * side], [w, y, w * side], .18, 6);
        rod(mast, truss, [w * side, y, -w], [w * side, y, w], .18, 6);
      }
    }
    rod(mast, truss, [0, 147, 0], [0, 183, 0], 0.41, 10);
    sphere(mast, orange, [.58, .58, .58], [0, 176, 0], 10);
  }
  for (const [index, [x, z]] of towers.entries()) {
    const [nx, nz] = towers[(index + 1) % towers.length];
    rod(pad, truss, [x, 170, z], [(x + nx) / 2, 159, (z + nz) / 2], .13, 6);
    rod(pad, truss, [(x + nx) / 2, 159, (z + nz) / 2], [nx, 170, nz], .13, 6);
  }
}

function distantDevelopment(parent) {
  const group = node('titusville_lowrise', parent);
  const roofs = [cap, wall, doors, paint('Warm urban roofs', 0x9a8473)];
  const random = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  // Low-rise blocks on the mainland, west of the Indian River.
  for (const [zone, [x0, z0, width, length]] of [
    [-24200, -3250, 2800, 2650], [-23500, 180, 3200, 3300], [-22800, 3770, 2750, 2050],
    [-22950, 12060, 5350, 4600], [-19850, 16950, 2050, 1600],
  ].entries()) {
    for (let i = 0; i < 62; i++) {
      const key = zone * 191 + i * 7;
      const height = 4 + random(key + 5) ** 3 * 21;
      const size = 10 + random(key + 4) * 23;
      box(group, roofs[i % roofs.length], [size, height, size * (0.55 + random(key + 2))], [
        x0 + width * random(key), height / 2, z0 + length * random(key + 1),
      ], yaw(zone < 3 ? -.12 : 0));
    }
  }
}

export function buildKennedyCampus(root) {
  const campus = node('kennedy_campus', root);
  vehicleAssembly(campus);
  crawlerway(campus);
  padB(campus);
  distantDevelopment(campus);
}
