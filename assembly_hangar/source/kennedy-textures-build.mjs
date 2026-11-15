import { readFile } from 'node:fs/promises';
import { kennedyTiles } from './kennedy-layout.mjs';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const padding = (length) => (4 - length % 4) % 4;

function chunk(type, payload, fill = 0) {
  const result = Buffer.alloc(8 + payload.length + padding(payload.length), fill);
  result.writeUInt32LE(result.length - 8, 0);
  result.writeUInt32LE(type, 4);
  payload.copy(result, 8);
  return result;
}

// GLTFExporter runs under Node, so add the encoded JPEGs without a browser canvas.
export async function embedKennedyTextures(glb) {
  const binaryOffset = 20 + glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== JSON_CHUNK || glb.readUInt32LE(binaryOffset + 4) !== BIN_CHUNK) {
    throw new Error('Expected JSON and BIN chunks in the Kennedy GLB');
  }
  const document = JSON.parse(glb.toString('utf8', 20, binaryOffset));
  const binary = glb.subarray(binaryOffset + 8);
  const segments = [binary];
  let byteOffset = binary.length;
  document.samplers ??= [];
  document.images ??= [];
  document.textures ??= [];
  const sampler = document.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }) - 1;
  const assets = await Promise.all(kennedyTiles.map(async ({ id }) => ({
    id,
    jpeg: await readFile(new URL(`../assets/kennedy/${id}.jpg`, import.meta.url)),
  })));
  for (const { id, jpeg } of assets) {
    const name = `Kennedy aerial ${id}`;
    const material = document.materials.find((entry) => entry.name === name);
    if (!material) throw new Error(`Missing terrain material ${name}`);
    const bufferView = document.bufferViews.push({ buffer: 0, byteOffset, byteLength: jpeg.length }) - 1;
    const source = document.images.push({ name, bufferView, mimeType: 'image/jpeg' }) - 1;
    const texture = document.textures.push({ source, sampler }) - 1;
    material.pbrMetallicRoughness.baseColorTexture = { index: texture };
    const pad = padding(jpeg.length);
    segments.push(jpeg, Buffer.alloc(pad));
    byteOffset += jpeg.length + pad;
  }
  document.buffers[0].byteLength = byteOffset;
  const json = chunk(JSON_CHUNK, Buffer.from(JSON.stringify(document)), 0x20);
  const bin = chunk(BIN_CHUNK, Buffer.concat(segments));
  const header = Buffer.from(glb.subarray(0, 12));
  header.writeUInt32LE(header.length + json.length + bin.length, 8);
  return Buffer.concat([header, json, bin]);
}
