import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { earthImageryRegions, earthImageryService } from './earth-imagery-config.mjs';

const folder=new URL('../assets/earth-flight/',import.meta.url);
await mkdir(folder,{recursive:true});
const records=[];
for(const region of earthImageryRegions) {
  const cached=await readFile(new URL(region.file,folder)).catch(()=>null);
  if(cached?.subarray(0,8).toString('hex')==='89504e470d0a1a0a' && cached.readUInt32BE(16)===region.width && cached.readUInt32BE(20)===region.height) {
    records.push({...region,service:earthImageryService,projection:'EPSG:4326',attribution:'USDA / USGS The National Map; NAIP, Landsat, Blue Marble',
      downloadedAt:(await stat(new URL(region.file,folder))).mtime.toISOString(),bytes:cached.length,sha256:createHash('sha256').update(cached).digest('hex')});
    console.log(`Reusing verified-size ${region.id}`);continue;
  }
  console.log(`Fetching USGS ${region.id}: ${region.width} × ${region.height}`);
  const query=new URLSearchParams({bbox:region.bounds.join(','),bboxSR:'4326',imageSR:'4326',
    size:`${region.width},${region.height}`,format:'png32',transparent:'true',f:'json'});
  const response=await fetch(`${earthImageryService}/export?${query}`,{signal:AbortSignal.timeout(240000)});
  if(!response.ok)throw new Error(`USGS ${response.status}`);
  const metadata=await response.json();
  if(metadata.error || !metadata.href)throw new Error(JSON.stringify(metadata));
  const extent=metadata.extent;
  const actual=[extent.xmin,extent.ymin,extent.xmax,extent.ymax];
  if(actual.some((value,i)=>Math.abs(value-region.bounds[i])>1e-5))throw new Error(`Unexpected reprojection bounds: ${actual}`);
  const image=await fetch(metadata.href,{signal:AbortSignal.timeout(240000)});
  if(!image.ok)throw new Error(`USGS image ${image.status}`);
  const bytes=Buffer.from(await image.arrayBuffer());
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || bytes.readUInt32BE(16)!==region.width || bytes.readUInt32BE(20)!==region.height)throw new Error('Invalid USGS PNG');
  await writeFile(new URL(region.file,folder),bytes);
  records.push({...region,service:earthImageryService,projection:'EPSG:4326',attribution:'USDA / USGS The National Map; NAIP, Landsat, Blue Marble',
    downloadedAt:new Date().toISOString(),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  console.log(`${region.id}: ${(bytes.length/1024/1024).toFixed(1)} MiB`);
}
await writeFile(new URL('sources.json',folder),JSON.stringify(records,null,2));
