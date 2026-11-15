import { earthImageryRegions } from './earth-imagery-config.mjs';

// Shared by the ray/sphere ascent view and the orbit globe, so changing views
// cannot move coastlines or fall back to a different blurry surface.
export function earthImageryShader(maps = {}) {
  const regions=earthImageryRegions.filter(region=>maps[region.id]);
  const sampler=id=>`earth_photo_${id}`;
  const uniforms=Object.fromEntries(regions.map(({id})=>[sampler(id),{value:maps[id]}]));
  const declarations=regions.map(({id})=>`uniform sampler2D ${sampler(id)};`).join('\n');
  const samples=regions.map(({id,bounds})=>{
    const [west,south,east,north]=bounds;
    return `{
      vec2 uv=(geographic-vec2(${west.toFixed(6)},${south.toFixed(6)}))/vec2(${(east-west).toFixed(6)},${(north-south).toFixed(6)});
      float edge=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));
      if(edge>0.){
        vec4 photo=texture2D(${sampler(id)},uv);
        // The USGS service has opaque black/white no-data blocks offshore.
        // Keep the base ocean there, including coarse bathymetry tile edges.
        float valid=smoothstep(.0002,.001,max(photo.r,max(photo.g,photo.b)));
        valid*=1.-smoothstep(.975,.999,min(photo.r,min(photo.g,photo.b)));
        float ocean=photo.b-max(photo.r,photo.g);
        valid*=1.-smoothstep(.015,.07,ocean);
        color=mix(color,photo.rgb,photo.a*valid*land*smoothstep(0.,.085,edge));
      }
    }`;
  }).join('\n');
  return {uniforms,shader:`${declarations}
    vec3 applyEarthImagery(vec3 color,vec3 normal){
      vec3 n=normalize(normal);
      vec2 geographic=vec2(atan(-n.z,n.x),asin(clamp(n.y,-1.,1.)))*57.29577951308232;
      float land=1.-smoothstep(.005,.04,color.b-max(color.r,color.g));
      ${samples}
      return color;
    }`,info:{projection:'EPSG:4326',regions:regions.map(({id,bounds})=>({id,bounds,width:maps[id].image.width,height:maps[id].image.height}))}};
}
