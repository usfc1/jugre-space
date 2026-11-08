import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const tau = Math.PI * 2;
export const Y = [0, 1, 0];
export const Z = [0, 0, 1];
export const X = [1, 0, 0];
export const neg = (values) => values.map((value) => -value);
export const vec = (xyz) => new T.Vector3(...xyz);
export const rot = (axis, radians) => new T.Quaternion().setFromAxisAngle(vec(axis), radians);
export const yaw = (radians) => rot(Y, radians);
export const polar = (radius, angle, y = 0) => [radius * Math.sin(angle), y, radius * Math.cos(angle)];
export const num = (index) => String(index + 1).padStart(2, '0');

function finish(name, color, metalness = 0, roughness = 0.6) {
  return new T.MeshStandardMaterial({ name, color, metalness, roughness });
}

export const m = {
  white: finish('Warm white enamel', 0xefede4, 0.12), bright: finish('Pale thermal blanket', 0xdde0db),
  black: finish('Carbon composite', 0x1d2228, 0.15), dark: finish('Shadowed interior', 0x101720),
  steel: finish('Machined steel', 0x717e89, 0.48, 0.48), alloy: finish('Satin aluminum', 0xbcc6cb, 0.52),
  nickel: finish('Heat-stained alloy', 0x786860, 0.35), orange: finish('Spray-on insulation', 0xc4743c),
  red: finish('Red equipment marking', 0xa82c32), blue: finish('Blue equipment marking', 0x345c84),
  window: finish('Coated optical glass', 0x3a677d, 0.45, 0.18),
  shield: finish('Ablative thermal protection', 0x392a28, 0, 0.86),
  gold: finish('Gold thermal insulation', 0xdca543, 0.35, 0.46),
  foil: [0x92601d, 0xb27c29, 0xe0a944, 0xedbf5f, 0xc19133, 0xeab858]
    .map((color, i) => finish(`Foil facet ${i + 1}`, color, 0.36, 0.5)),
  solar: finish('Indigo solar cells', 0x243b69, 0.32, 0.39),
  solarAlt: finish('Blue photovoltaic cells', 0x365384, 0.32, 0.38),
  solarAmber: finish('Copper photovoltaic substrate', 0x9c6037, 0.29, 0.52),
  fabric: finish('Parachute canopy fabric', 0xf2dec7),
  lox: finish('Cutaway liquid oxygen', 0x5893bf), hydrogen: finish('Cutaway liquid hydrogen', 0x90cbd6),
  fuel: finish('Cutaway propellant', 0xc88657), water: finish('Cutaway water tank', 0x55978a),
};

export function node(id, parent, position = [0, 0, 0], extras = {}) {
  const result = new T.Group();
  result.name = parent ? `${parent.name}.${id}` : id;
  result.position.set(...position);
  result.userData = { partId: result.name, ...extras };
  parent?.add(result);
  return result;
}

export function placed(parent, child, position = [0, 0, 0], quaternion) {
  child.position.set(...position);
  if (quaternion) child.quaternion.copy(quaternion);
  parent.add(child);
  return child;
}

export function mount(parent, id, position = [0, 0, 0], outward = Y) {
  const port = node(id, parent, position, { role: 'mount', outwardAxis: '+Z' });
  port.quaternion.setFromUnitVectors(vec(Z), vec(outward).normalize());
  return port;
}

export function part(parent, id, position, outward = neg(Y)) {
  const result = node(id, parent, position, { standalone: true });
  mount(result, 'mount_parent', [0, 0, 0], outward);
  return result;
}

export function joint(parent, id, position, axis, radians = 0, outward = neg(Y)) {
  const result = part(parent, id, position, outward);
  Object.assign(result.userData, { role: 'hinge', axis, angleRadians: radians });
  result.quaternion.copy(rot(axis, radians));
  return result;
}

export function ports(parent, top, bottom = 0) {
  mount(parent, 'mount_aft', [0, bottom, 0], neg(Y));
  mount(parent, 'mount_forward', [0, top, 0]);
}

export function mesh(parent, geo, mat, position = [0, 0, 0], quaternion, scale) {
  const result = new T.Mesh(geo, mat);
  result.position.set(...position);
  if (quaternion) result.quaternion.copy(quaternion);
  if (scale) result.scale.set(...scale);
  parent.add(result);
  return result;
}

export function box(parent, mat, size, position, quaternion) {
  return mesh(parent, new T.BoxGeometry(...size), mat, position, quaternion);
}

export function lathe(parent, mat, points, { position, quaternion, segments = 40, start = 0, sweep = tau } = {}) {
  return mesh(parent, new T.LatheGeometry(points.map(([x, y]) => new T.Vector2(x, y)), segments, start, sweep),
    mat, position, quaternion);
}

export function cutawaySkin(parent, material, profile, thickness, innerMaterial = m.bright) {
  const options = { start: Math.PI / 2, sweep: Math.PI };
  const inside = profile.map(([radius, y]) => [Math.max(0, radius - thickness), y]);
  lathe(parent, material, profile, options);
  lathe(parent, innerMaterial, [...inside].reverse(), options);
  const coordinates = [];
  for (const sign of [-1, 1]) {
    for (let i = 0; i < profile.length - 1; i++) {
      const points = [inside[i], profile[i], profile[i + 1], inside[i + 1]];
      if (sign < 0) points.reverse();
      for (const index of [0, 1, 2, 0, 2, 3]) coordinates.push(sign * points[index][0], points[index][1], 0);
    }
  }
  const cut = new T.BufferGeometry();
  cut.setAttribute('position', new T.Float32BufferAttribute(coordinates, 3));
  cut.computeVertexNormals();
  mesh(parent, cut, m.steel);
}

export function cylinder(parent, mat, radius, y0, y1, position = [0, 0, 0], segments = 40, top = radius) {
  return mesh(parent, new T.CylinderGeometry(top, radius, y1 - y0, segments), mat,
    [position[0], position[1] + (y0 + y1) / 2, position[2]]);
}

export function ring(parent, mat, outer, inner, y0, y1, options) {
  return lathe(parent, mat, [[inner, y0], [outer, y0], [outer, y1], [inner, y1], [inner, y0]], options);
}

export function sphere(parent, mat, size, position, segments = 24) {
  return mesh(parent, new T.SphereGeometry(1, segments, 14), mat, position, undefined, size);
}

export function rod(parent, mat, a, b, radius, segments = 12, top = radius) {
  const delta = vec(b).sub(vec(a));
  const midpoint = vec(a).addScaledVector(delta, 0.5).toArray();
  const orientation = new T.Quaternion().setFromUnitVectors(vec(Y), delta.clone().normalize());
  return mesh(parent, new T.CylinderGeometry(top, radius, delta.length(), segments), mat, midpoint, orientation);
}

export function bandedTank(parent, mat, y, radius, length) {
  const dome = Math.min(radius * 0.55, length * 0.24);
  cylinder(parent, mat, radius, y + dome, y + length - dome);
  for (const height of [y + dome, y + length - dome]) sphere(parent, mat, [radius, dome, radius], [0, height, 0]);
  for (const height of [y + dome, y + length - dome]) ring(parent, m.alloy, radius * 1.017, radius * 0.97, height - 0.04, height + 0.04);
}

export function bell(parent, radius, length, mat = m.nickel) {
  const outer = [[1, 0], [0.84, 0.2], [0.63, 0.42], [0.43, 0.67], [0.28, 0.86], [0.28, 1]];
  lathe(parent, mat, outer.map(([r, y]) => [r * radius, y * length]), { segments: 32 });
  lathe(parent, m.dark, [...outer].reverse().map(([r, y]) => [(r - 0.035) * radius, y * length]), { segments: 32 });
  ring(parent, m.steel, radius * 1.012, radius * 0.96, 0, length * 0.022, { segments: 32 });
  cylinder(parent, m.dark, radius * 0.26, length * 0.89, length * 0.92, undefined, 24);
  for (const [r, y] of outer.slice(1, -1)) {
    ring(parent, mat, (r + 0.018) * radius, r * radius, y * length, y * length + length * 0.019, { segments: 32 });
  }
}

export function nozzle(parent, id, xyz, radius, length, direction = neg(Y), mat) {
  const engine = part(parent, id, xyz, Y);
  engine.quaternion.setFromUnitVectors(vec(Y), vec(neg(direction)).normalize());
  const skirt = node('bell', engine, [0, -length, 0]);
  bell(skirt, radius, length, mat);
  return engine;
}

// Thin removable cell laminate in the local XZ plane.
export function solar(parent, width, length, columns, rows, mat = m.solar) {
  box(parent, m.alloy, [width, 0.021, length]);
  const cellWidth = width * 0.95 / columns;
  const cellLength = length * 0.95 / rows;
  const cell = new T.PlaneGeometry(cellWidth * 0.966, cellLength * 0.94).rotateX(-Math.PI / 2);
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const x = (column - (columns - 1) / 2) * cellWidth;
      const z = (row - (rows - 1) / 2) * cellLength;
      mesh(parent, cell, mat, [x, 0.012, z]);
    }
  }
}

export function optics(parent, radius, depth, mat = m.steel) {
  const direction = rot(X, Math.PI / 2);
  lathe(parent, mat, [[0, 0], [radius, 0], [radius, depth], [radius * 0.77, depth],
    [radius * 0.77, depth * 0.7], [0, depth * 0.7]], { quaternion: direction, segments: 24 });
  const lens = node('lens', parent, [0, 0, depth * 0.8]);
  sphere(lens, m.window, [radius * 0.74, radius * 0.74, depth * 0.11], [0, 0, 0], 16);
}

export function rtg(parent, length, radius, fins = 8) {
  cylinder(parent, m.black, radius * 0.76, 0, length);
  for (const y of [0, length - 0.06]) cylinder(parent, m.steel, radius, y, y + 0.06);
  for (let i = 0; i < fins; i++) {
    const a = i * tau / fins;
    box(parent, m.nickel, [0.012, length * 0.88, radius * 0.53], polar(radius * 0.94, a, length / 2), yaw(a));
  }
}

export function seal(root) {
  root.traverse((group) => {
    if (!group.isGroup) return;
    const byMaterial = new Map();
    for (const child of group.children.filter((item) => item.isMesh)) {
      if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
      byMaterial.get(child.material).push(child);
    }
    for (const [material, meshes] of byMaterial) {
      const list = meshes.map((item) => {
        item.updateMatrix();
        const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone();
        geometry.deleteAttribute('uv');
        return geometry.applyMatrix4(item.matrix);
      });
      const geometry = mergeVertices(mergeGeometries(list), 0.000001);
      const merged = new T.Mesh(geometry, material);
      merged.name = `${group.name}.mesh_${material.name.replaceAll(' ', '_')}`;
      group.remove(...meshes).add(merged);
    }
  });
  return root;
}
