import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute,
  LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry,
  TubeGeometry, CatmullRomCurve3, Vector2, Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const surface = (name, roughness, metalness) => new MeshStandardMaterial({
  name, vertexColors: true, roughness, metalness,
});
const finishes = {
  polymer: surface('Molded polymer', 0.32, 0),
  rubber: surface('Flexible seals', 0.61, 0),
  alloy: surface('Anodized fittings', 0.32, 0.68),
};
const buckets = new WeakMap();
const position = new Vector3();
const rotation = new Quaternion();
const scale = new Vector3();
const transform = new Matrix4();
const euler = new Euler();

function add(part, geometry, color, at = [0, 0, 0], angles = [0, 0, 0], size = [1, 1, 1], finish = 'polymer') {
  rotation.setFromEuler(euler.set(...angles));
  geometry.applyMatrix4(transform.compose(position.set(...at), rotation, scale.set(...size)));
  geometry.deleteAttribute('uv');
  geometry.clearGroups();
  const rgb = new Color(color).toArray();
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set(rgb, i);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (!buckets.has(part)) buckets.set(part, new Map());
  const batches = buckets.get(part);
  const material = finishes[finish] ?? finish;
  if (!batches.has(material)) batches.set(material, []);
  batches.get(material).push(geometry.index ? geometry.toNonIndexed() : geometry);
}

export function finishPart(part) {
  const batches = buckets.get(part);
  if (!batches) return;
  const packed = mergeGeometries([...batches.values()].map(geometries => mergeGeometries(geometries)), true);
  const mesh = new Mesh(mergeVertices(packed), [...batches.keys()]);
  mesh.name = `${part.name}_geo`;
  part.add(mesh);
  buckets.delete(part);
}

function triangles(points, indices) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex(indices);
  return geometry;
}

// Four chamfered octagonal rings. Bottom and top can have different widths.
export function block(part, color, [w, h, d], at, bevel = 0.015, angles, finish, topWidth = w) {
  if (!bevel) return add(part, new BoxGeometry(w, h, d), color, at, angles, undefined, finish);
  const b = Math.min(bevel, h * 0.32, d * 0.22, w * 0.22);
  const rings = [[w / 2 - b, -h / 2, d / 2 - b, b * 0.25],
    [w / 2, -h / 2 + b, d / 2, b], [topWidth / 2, h / 2 - b, d / 2, b],
    [topWidth / 2 - b, h / 2, d / 2 - b, b * 0.25]];
  const points = rings.flatMap(([x, y, z, c]) => [
    [-x + c, y, z], [x - c, y, z], [x, y, z - c], [x, y, -z + c],
    [x - c, y, -z], [-x + c, y, -z], [-x, y, -z + c], [-x, y, z - c],
  ]);
  const indices = [];
  for (let i = 1; i < 7; i++) indices.push(0, i + 1, i, 24, 24 + i, 25 + i);
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < 8; i++) {
      const a = ring * 8 + i;
      const b = ring * 8 + (i + 1) % 8;
      indices.push(a, b, b + 8, a, b + 8, a + 8);
    }
  }
  const geometry = triangles(points, indices).toNonIndexed();
  geometry.computeVertexNormals();
  add(part, geometry, color, at, angles, undefined, finish);
}

export function cylinder(part, color, radius, length, at, angles, finish, sides = 12, base = radius) {
  add(part, new CylinderGeometry(radius, base, length, sides), color, at, angles, undefined, finish);
}

export function turn(part, color, profile, at, sides = 24, finish) {
  const geometry = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), sides);
  add(part, geometry, color, at, undefined, undefined, finish);
}

export function bubble(part, color, size, at, finish, segments = 12) {
  add(part, new SphereGeometry(1, segments, 8), color, at, undefined, size, finish);
}

export function line(part, color, points, radius, finish, segments = 12, sides = 6) {
  const path = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
  add(part, new TubeGeometry(path, segments, radius, sides), color, undefined, undefined, undefined, finish);
}

export function panel(part, color, points, finish) {
  const indices = [];
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
  const geometry = triangles(points, indices);
  geometry.computeVertexNormals();
  add(part, geometry, color, undefined, undefined, undefined, finish);
}

export function grid(part, color, rows, columns, point, normal, finish, reverse = false) {
  const vertices = [];
  const normals = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const v = row / rows;
      vertices.push(point(u, v));
      normals.push(...normal(u, v));
      if (!row || !column) continue;
      const d = row * (columns + 1) + column;
      const c = d - 1;
      const b = d - columns - 1;
      const a = b - 1;
      indices.push(...(reverse ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  }
  const geometry = triangles(vertices, indices);
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  add(part, geometry, color, undefined, undefined, undefined, finish);
}

export function claw(part, color, side) {
  const points = [];
  const indices = [];
  const slices = 12;
  const start = side > 0 ? 4.18 : 0.725;
  const sweep = 4.52;
  const outline = [
    [0.080, -0.037], [0.082, -0.026], [0.082, 0.028], [0.075, 0.044],
    [0.045, 0.044], [0.038, 0.032], [0.038, -0.029], [0.044, -0.037],
  ];
  for (let i = 0; i <= slices; i++) {
    const a = start + i * sweep / slices;
    for (const [radius, z] of outline) points.push([radius * Math.cos(a), -0.083 + radius * Math.sin(a), z + 0.022]);
  }
  for (let i = 0; i < slices; i++) {
    for (let j = 0; j < 8; j++) {
      const a = i * 8 + j;
      const b = i * 8 + (j + 1) % 8;
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  }
  for (let i = 1; i < 7; i++) indices.push(0, i, i + 1, slices * 8, slices * 8 + i + 1, slices * 8 + i);
  const geometry = triangles(points, indices);
  geometry.computeVertexNormals();
  add(part, geometry, color);
}
