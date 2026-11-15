import test from 'node:test';
import assert from 'node:assert/strict';
import { earthImageryRegions, geographicImageryUV } from '../earth-imagery-config.mjs';
import { earthImageryShader } from '../earth-imagery.mjs';

test('satellite footprints cover LC-39A at every level and map north upward without stretching a tangent plane',()=>{
  const cape=[-80.6042,28.6084];
  for(const region of earthImageryRegions) {
    const [u,v]=geographicImageryUV(...cape,region.bounds);
    assert.ok(u>0&&u<1&&v>0&&v<1);
    assert.deepEqual(geographicImageryUV(region.bounds[0],region.bounds[3],region.bounds),[0,1]);
    assert.deepEqual(geographicImageryUV(region.bounds[2],region.bounds[1],region.bounds),[1,0]);
    const sourcePixelsPerDegree=region.width/(region.bounds[2]-region.bounds[0]);
    assert.ok(sourcePixelsPerDegree>8192/360*8,'Regional imagery must improve on the global map');
  }
});

test('missing geographic tiles preserve the base globe; decoded maps share the same shader in both views',()=>{
  assert.deepEqual(earthImageryShader().info.regions,[]);
  const maps=Object.fromEntries(earthImageryRegions.map(r=>[r.id,{image:{width:r.width,height:r.height}}]));
  const imagery=earthImageryShader(maps);
  assert.equal(imagery.info.projection,'EPSG:4326');
  assert.deepEqual(imagery.info.regions.map(r=>r.id),earthImageryRegions.map(r=>r.id));
  assert.equal(Object.keys(imagery.uniforms).length,3);
});
