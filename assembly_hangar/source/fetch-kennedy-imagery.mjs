import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { kennedyAnchor, kennedyImagerySource, kennedyTiles } from './kennedy-layout.mjs';

const folder = new URL('../assets/kennedy/', import.meta.url);
const cache = new URL('../diagnostics/kennedy-imagery/', import.meta.url);
await mkdir(cache, { recursive: true });
const radius = 6378137;
const latitude = kennedyAnchor.latitude * Math.PI / 180;
const anchorX = radius * kennedyAnchor.longitude * Math.PI / 180;
const anchorY = radius * Math.log(Math.tan(Math.PI / 4 + latitude / 2));
const mercatorScale = 1 / Math.cos(latitude);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const records = [];
try {
  for (const [index, tile] of kennedyTiles.entries()) {
    if (!tile.width) continue;
    const { id, bounds, width, featherM } = tile;
    const [west, north, east, south] = bounds;
    const bbox = [anchorX + west * mercatorScale, anchorY - south * mercatorScale,
      anchorX + east * mercatorScale, anchorY - north * mercatorScale];
    const request = new URLSearchParams({
      bbox: bbox.join(','), bboxSR: '3857', imageSR: '3857', size: `${width},${width}`,
      format: 'jpg', compressionQuality: '96', interpolation: 'RSP_BilinearInterpolation', f: 'pjson',
    });
    const url = `${kennedyImagerySource}/exportImage?${request}`;
    const rasterFile = new URL(`source-${id}.jpg`, cache);
    const metadataFile = new URL(`source-${id}.json`, cache);
    let jpeg, metadata;
    try {
      metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
      if (metadata.url === url) jpeg = await readFile(rasterFile);
    } catch { /* Missing or stale cache is fetched below. */ }
    if (!jpeg) {
      console.log(`Fetching original USGS aerial ${id}: ${width} × ${width}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!response.ok) throw new Error(`USGS ${id}: HTTP ${response.status}`);
      const result = await response.json();
      if (!result.href || result.error) throw new Error(JSON.stringify(result));
      const actual = [result.extent.xmin, result.extent.ymin, result.extent.xmax, result.extent.ymax];
      if (result.width !== width || result.height !== width || actual.some((v, i) => Math.abs(v - bbox[i]) > .05)) {
        throw new Error(`USGS changed ${id} raster dimensions or geographic bounds`);
      }
      const image = await fetch(result.href, { signal: AbortSignal.timeout(90000) });
      if (!image.ok) throw new Error(`USGS ${id} raster: HTTP ${image.status}`);
      jpeg = Buffer.from(await image.arrayBuffer());
      if (jpeg.readUInt16BE(0) !== 0xffd8) throw new Error(`USGS ${id}: expected a JPEG raster`);
      metadata = { url, extent: result.extent, downloadedAt: new Date().toISOString() };
      await writeFile(rasterFile, jpeg);
      await writeFile(metadataFile, JSON.stringify(metadata, null, 2));
    }
    const parent = kennedyTiles[index - 1];
    const parentBytes = await readFile(new URL(`${parent.id}.jpg`, folder));
    // Feather in geographic coordinates, keeping the parent pixels exactly at
    // the outer edge so different survey years never leave a hard rectangle.
    const processed = await page.evaluate(async ({ source, parentSource, tile, parent }) => {
      const decode = async data => {
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      };
      const [image, background] = await Promise.all([decode(source), decode(parentSource)]);
      if (image.width !== tile.width || image.height !== tile.width) throw new Error('Source JPEG dimensions do not match the requested detail');
      const canvas = new OffscreenCanvas(tile.width, tile.width);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.imageSmoothingQuality = 'high';
      const [west, north, east, south] = tile.bounds;
      const [pw, pn, pe, ps] = parent.bounds;
      context.drawImage(background, (west - pw) / (pe - pw) * background.width,
        (north - pn) / (ps - pn) * background.height,
        (east - west) / (pe - pw) * background.width, (south - north) / (ps - pn) * background.height,
        0, 0, tile.width, tile.width);
      const base = context.getImageData(0, 0, tile.width, tile.width).data;
      context.drawImage(image, 0, 0);
      const detail = context.getImageData(0, 0, tile.width, tile.width);
      const spacing = (east - west) / tile.width;
      for (let y = 0; y < tile.width; y++) for (let x = 0; x < tile.width; x++) {
        const distance = Math.min(x, y, tile.width - 1 - x, tile.width - 1 - y) * spacing;
        if (distance >= tile.featherM) continue;
        const t = Math.max(0, distance / tile.featherM);
        const weight = t * t * (3 - 2 * t);
        const offset = (y * tile.width + x) * 4;
        for (let c = 0; c < 3; c++) detail.data[offset + c] = base[offset + c] * (1 - weight) + detail.data[offset + c] * weight;
      }
      context.putImageData(detail, 0, 0);
      image.close(); background.close();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .96 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return btoa(binary);
    }, { source: jpeg.toString('base64'), parentSource: parentBytes.toString('base64'), tile, parent });
    const bytes = Buffer.from(processed, 'base64');
    await writeFile(new URL(`${id}.jpg`, folder), bytes);
    records.push({ id, bounds, width, height: width, sampleSpacingM: (east - west) / width,
      service: kennedyImagerySource, attribution: 'USDA / USGS The National Map: NAIP and high resolution orthoimagery',
      projection: 'EPSG:3857', anchor: kennedyAnchor, featherM, ...metadata,
      sourceSHA256: createHash('sha256').update(jpeg).digest('hex'),
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    console.log(`${id}: ${(bytes.length / 1048576).toFixed(1)} MiB; ${(east - west) / width} m per texture pixel`);
  }
  await writeFile(new URL('sources.json', folder), JSON.stringify(records, null, 2) + '\n');
} finally {
  await browser.close();
}
