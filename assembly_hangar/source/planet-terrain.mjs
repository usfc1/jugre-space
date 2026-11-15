import { BufferGeometry, Float32BufferAttribute, MathUtils } from 'three';

export const TERRAIN_RADIUS = 65536;
export const planetRadius = { moon: 1737400, mars: 3389500 };
export const hash = (x, z = 0) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + 74.7) * 43758.5453;
  return n - Math.floor(n);
};
export function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const u = x - ix, v = z - iz;
  const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return MathUtils.lerp(MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), a),
    MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), a), b);
}

function craterField(x, z, cell, depth, seed) {
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let height = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ix = cx + dx, iz = cz + dz;
    if (hash(ix + seed, iz) > .64) continue;
    const px = (ix + .18 + hash(ix, iz + seed) * .64) * cell;
    const pz = (iz + .18 + hash(ix + seed, iz + 7) * .64) * cell;
    const radius = cell * (.10 + .22 * hash(ix + 21, iz + seed));
    const r = Math.hypot(x - px, z - pz) / radius;
    if (r > 1.65) continue;
    const bowl = -depth * radius * (1 - MathUtils.smoothstep(r, .22, 1));
    const rim = depth * radius * .32 * Math.exp(-(((r - 1.02) / .13) ** 2));
    const ejecta = depth * radius * .035 * Math.exp(-(((r - 1.2) / .32) ** 2));
    height += bowl + rim + ejecta;
  }
  return height;
}

// One deterministic height field is shared by the mesh and every rock. Metres,
// with a small level touchdown/EVA area and true spherical curvature outside it.
function elevation(body, x, z, site) {
  let h;
  if (body === 'moon') {
    h = (noise(x / 3400 + 8, z / 3400) - .5) * 145
      + (noise(x / 670, z / 670 + 4) - .5) * 22
      + (noise(x / 95 + 3, z / 95) - .5) * 2.6;
    h += craterField(x, z, 4200, .19, 11) + craterField(x, z, 680, .18, 31)
      + craterField(x, z, 115, .16, 53) + craterField(x, z, 19, .14, 79);
  } else {
    const offset = site * 137;
    const warp = noise(x / 1600 + offset, z / 1600) * 650;
    const mesa = noise((x + warp) / 2300 + 17 + offset, z / 2300 + 29);
    const plateaus = MathUtils.smoothstep(mesa, .48, .72);
    const layers = plateaus * 190 + Math.sin(plateaus * 34) * 2.2 * plateaus;
    const hills = (noise(x / 420 + offset, z / 420 + 7) - .5) * 19;
    const ripple = Math.sin(z * .24 + noise(x / 21, z / 31) * 4) * .11;
    h = layers + hills + (noise(x / 47, z / 47) - .5) * 1.4 + ripple;
    h += craterField(x, z, 2200, .085, 101 + site);
  }
  return h;
}

const datums = new Map();
const rockCache = new Map();
export const roverTrialRocks = [
  { x: -2, z: 7, radius: .62, height: .6 }, { x: 2, z: 10, radius: .9, height: .9 },
  { x: 5, z: 14, radius: .8, height: .6 }, { x: 8, z: 5, radius: .65, height: .65 },
  { x: 12, z: -2, radius: 1, height: .75 },
];
export function surfaceRocks(site = 0) {
  if (!rockCache.has(site)) {
    const rocks = [];
    for (let variant = 0; variant < 3; variant++) for (let i = 0; i < 680; i++) {
      const seed = i + variant * 997 + site * 7919, angle = hash(seed, 7) * Math.PI * 2;
      const distance = 7 + hash(seed, 19) ** 2 * 1100;
      let x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
      if (x > 5 && x < 13 && z > 3 && z < 8) z += 9;
      const radius = .045 + hash(seed, 31) ** 5 * Math.min(1.9, distance * .035);
      rocks.push({ x, z, radius, height: radius * (.45 + hash(seed, 51) * .4) });
    }
    rockCache.set(site, rocks);
  }
  return rockCache.get(site);
}
export function terrainHeight(body, x, z, site = 0) {
  const distance = Math.hypot(x, z);
  if (distance <= 13) return 0;
  const key = `${body}-${site}`;
  if (!datums.has(key)) datums.set(key, elevation(body, 0, 0, site));
  const safe = MathUtils.smoothstep(distance, 13, 42);
  const h = elevation(body, x, z, site) - datums.get(key);
  const radius = planetRadius[body];
  const curvature = -(x * x + z * z) / (radius + Math.sqrt(radius * radius - x * x - z * z));
  return h * safe + curvature * MathUtils.smoothstep(distance, 13, 42);
}

// Logarithmic rings resolve decimetres at touchdown and kilometres at the edge.
// All scales remain resident: descent never inserts or swaps a terrain tile.
export function buildTerrainGeometry(body, site = 0, rings = 240, sectors = 256) {
  const vertices = [0, 0, 0], indices = [];
  const logRadius = Math.log1p(TERRAIN_RADIUS / 3);
  for (let row = 1; row <= rings; row++) {
    const radius = 3 * Math.expm1(logRadius * row / rings);
    for (let col = 0; col < sectors; col++) {
      const angle = col / sectors * Math.PI * 2;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      vertices.push(x, terrainHeight(body, x, z, site), z);
      const current = 1 + (row - 1) * sectors + col;
      const next = 1 + (row - 1) * sectors + (col + 1) % sectors;
      if (row === 1) indices.push(0, next, current);
      else {
        const inner = current - sectors, innerNext = next - sectors;
        indices.push(inner, next, current, inner, innerNext, next);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.terrainGrid = { rings, sectors };
  return geometry;
}

// Sample the rendered triangles, rather than the higher-frequency source field.
// This keeps even tiny pebbles seated where distant mesh resolution is coarser.
export function terrainMeshHeight(geometry, x, z) {
  if (x === 0 && z === 0) return 0;
  const { rings, sectors } = geometry.userData.terrainGrid;
  const step = Math.PI * 2 / sectors;
  const angle = MathUtils.euclideanModulo(Math.atan2(z, x), Math.PI * 2);
  const col = Math.min(sectors - 1, Math.floor(angle / step));
  const polygonRadius = Math.hypot(x, z) * Math.cos(angle - (col + .5) * step) / Math.cos(step / 2);
  const row = Math.max(1, Math.min(rings, Math.ceil(Math.log1p(polygonRadius / 3) / Math.log1p(TERRAIN_RADIUS / 3) * rings)));
  const outer = 1 + (row - 1) * sectors + col;
  const next = 1 + (row - 1) * sectors + (col + 1) % sectors;
  const p = geometry.attributes.position;
  function triangle(a, b, c) {
    const ax = p.getX(a), az = p.getZ(a);
    const bx = p.getX(b), bz = p.getZ(b), cx = p.getX(c), cz = p.getZ(c);
    const divisor = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / divisor;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / divisor;
    return { inside: u >= -1e-5 && v >= -1e-5 && u + v <= 1.00001,
      height: u * p.getY(a) + v * p.getY(b) + (1 - u - v) * p.getY(c) };
  }
  if (row === 1) return triangle(0, next, outer).height;
  const first = triangle(outer - sectors, next, outer);
  return first.inside ? first.height : triangle(outer - sectors, next - sectors, next).height;
}

export function landingEnvelope(state) {
  const lunar = ['moonLanding', 'moonSurface', 'rendezvous'].includes(state.kind);
  const mars = ['marsLanding', 'marsSurface'].includes(state.kind);
  const descending = state.kind === 'moonLanding' || state.kind === 'marsLanding';
  const height = descending ? Math.max(0, state.altitude - .004) * 1000
    : state.kind === 'rendezvous' ? state.altitude * 1000 : 0;
  const blend = lunar || mars ? 1 - MathUtils.smoothstep(height, 28000, mars ? 110000 : 80000) : 0;
  return { body: mars ? 'mars' : 'moon', height, blend,
    air: mars ? 1 - MathUtils.smoothstep(height, 1500, 70000) : 0 };
}
