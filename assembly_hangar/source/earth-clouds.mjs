import {
  Camera, Color, Data3DTexture, DataTexture, LinearFilter, Matrix3, Mesh, PlaneGeometry,
  RepeatWrapping, RGBAFormat, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,
} from 'three';

// One deterministic weather field for the pad, ascent and distant Earth. All
// distances in the shaders are kilometres; density is a volume, not a decal.
let textures;
const fade = x => x * x * (3 - 2 * x);
const mix = (a, b, t) => a + (b - a) * t;
function hash(x, y, z) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, z, period = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const h = (a, b, c) => hash(period ? ((a % period) + period) % period : a,
    period ? ((b % period) + period) % period : b, period ? ((c % period) + period) % period : c);
  return mix(mix(mix(h(ix, iy, iz), h(ix + 1, iy, iz), fx),
    mix(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), fx), fy),
  mix(mix(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), fx),
    mix(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}

export function earthCloudTextures() {
  if (textures) return textures;
  const size = 64, data = new Uint8Array(size ** 3 * 4);
  let index = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sample = (f, offset = 0) => noise((x + .5) / size * f + offset,
      (y + .5) / size * f + offset, (z + .5) / size * f + offset, f);
    data[index++] = Math.round(255 * (sample(4) * .68 + sample(8) * .23 + sample(16) * .09));
    data[index++] = Math.round(255 * (sample(16, 19) * .65 + sample(32, 7) * .35));
    data[index++] = Math.round(255 * sample(4, 31));
    data[index++] = 255;
  }
  const volume = new Data3DTexture(data, size, size, size);
  volume.format = RGBAFormat;
  volume.minFilter = volume.magFilter = LinearFilter;
  volume.wrapS = volume.wrapT = volume.wrapR = RepeatWrapping;
  volume.needsUpdate = true;

  const width = 1024, height = 512, weatherData = new Uint8Array(width * height * 4);
  index = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const lat = ((y + .5) / height - .5) * Math.PI;
    const lon = ((x + .5) / width - .5) * Math.PI * 2;
    const nx = Math.cos(lat) * Math.cos(lon), ny = Math.sin(lat), nz = -Math.cos(lat) * Math.sin(lon);
    const sample = (f, offset = 0) => noise(nx * f + offset, ny * f + offset, nz * f + offset);
    const warp = sample(3.7, 17) * 2.8;
    const front = noise(nx * 7 + warp, ny * 9 + 23, nz * 7 - warp);
    const regional = front * .62 + sample(23, 11) * .26 + sample(71, 5) * .12;
    const coverage = Math.max(0, Math.min(1, (regional - .32) / .40));
    weatherData[index++] = Math.round(255 * coverage);
    weatherData[index++] = Math.round(255 * sample(14, 43));
    weatherData[index++] = Math.round(255 * Math.max(0, (sample(18, 61) - .52) * 2.8));
    weatherData[index++] = 255;
  }
  const weather = new DataTexture(weatherData, width, height, RGBAFormat);
  weather.minFilter = weather.magFilter = LinearFilter;
  weather.wrapS = RepeatWrapping;
  weather.needsUpdate = true;
  textures = { cloudVolume: { value: volume }, cloudWeather: { value: weather } };
  return textures;
}

export const cloudFieldShader = `
  uniform highp sampler3D cloudVolume;
  uniform sampler2D cloudWeather;
  uniform float cloudTime;
  uniform float cloudLod;
  vec3 cloudWeatherAt(vec3 n) {
    return texture2D(cloudWeather,vec2(atan(-n.z,n.x)/6.28318530718+.5,
      asin(clamp(n.y,-1.,1.))/3.14159265359+.5)).rgb;
  }
  float cloudDensity(vec3 p,float altitude,bool detail) {
    vec3 weather=cloudWeatherAt(normalize(p));
    float base=1.35+weather.g*.45;
    float top=3.1+weather.g*4.8;
    float h=(altitude-base)/(top-base);
    if(h<=0.||h>=1.||weather.r<.17)return 0.;
    vec3 wind=vec3(cloudTime*.00027,0.,cloudTime*.00013);
    vec3 uv=p*.045+wind;
    vec4 shape=texture(cloudVolume,uv);
    float largeShape=texture(cloudVolume,p*.0197+vec3(5.1,11.8,3.7)+wind*.63).r;
    // An incommensurate second scale breaks the small volume's repetition.
    float broad=texture(cloudVolume,p*.0031+vec3(13.2,7.1,19.7)+wind*.31).b;
    float profile=smoothstep(0.,.13,h)*(1.-smoothstep(.40,1.,h));
    float threshold=mix(.76,.40,weather.r)+(1.-profile)*.32;
    threshold+=smoothstep(.40,.68,broad)*.13;
    float billows=mix(shape.r,largeShape,smoothstep(.30,.74,weather.g));
    float density=max(0.,billows-threshold);
    if(detail&&density>0.)density=max(0.,density-(1.-shape.g)*.10*(1.-profile*.4));
    density=min(1.,density*4.2)*smoothstep(.17,.36,weather.r);
    // Individual kilometre-wide billows become subpixel from the globe camera.
    // Integrate their coverage into smooth weather fronts instead of aliasing
    // thousands of bright specks. The regional field remains Earth-fixed.
    float regional=smoothstep(.43,.75,weather.r)*profile*.32;
    return mix(density,regional,cloudLod);
  }
  float cloudSurfaceShadow(vec3 p,vec3 light,vec3 normal) {
    float elevation=dot(normal,light);
    if(elevation<.08)return 1.;
    float d=2.7/max(.18,elevation);
    float density=cloudDensity(p+light*d,2.7,false);
    return mix(1.,exp(-density*2.1),smoothstep(.08,.3,elevation));
  }
`;

const rayShader = `
  uniform vec3 eye;uniform vec3 radial;uniform float height;
  uniform mat3 cameraBasis;uniform mat3 earthFrame;uniform vec3 sun;
  uniform float aspect;uniform float tanFov;
  const float CLOUD_R=6371.;
  // Stable roots also when the eye is centimetres above the ground. Returning
  // both roots lets the camera pass through the layer without a fade-out trick.
  vec2 cloudSphere(vec3 ray,float shell) {
    float b=dot(eye,ray)+(CLOUD_R+height)*dot(ray,radial);
    float c=(height-shell)*(2.*CLOUD_R+height+shell)+2.*(CLOUD_R+height)*dot(eye,radial)+dot(eye,eye);
    float discriminant=b*b-c;
    if(discriminant<0.)return vec2(-1.);
    float root=sqrt(discriminant);
    float q=-b-(b<0.?-root:root);
    if(abs(q)<.000001)return vec2(-b);
    return vec2(min(q,c/q),max(q,c/q));
  }
  vec4 cloudRadiance(vec3 ray) {
    vec2 outer=cloudSphere(ray,8.);
    float start=max(0.,outer.x),end=outer.y;
    if(end<=start)return vec4(0.);
    vec2 inner=cloudSphere(ray,1.35);
    float eyeAltitude=height+dot(eye,radial);
    if(eyeAltitude<1.35)start=max(start,inner.y);
    else if(inner.x>0.)end=min(end,inner.x);
    vec2 ground=cloudSphere(ray,0.);
    if(ground.x>0.)end=min(end,ground.x);
    if(end<=start)return vec4(0.);
    // The distant end is obscured by atmospheric scattering near the surface.
    end=min(end,start+240.);
    float count=mix(44.,28.,smoothstep(20.,300.,height));
    float stride=(end-start)/count;
    float jitter=fract(dot(gl_FragCoord.xy,vec2(.754877666,.569840296)));
    vec3 origin=radial*(CLOUD_R+height)+eye;
    vec3 light=normalize(earthFrame*sun);
    float forward=pow(max(0.,dot(ray,sun)),12.);
    vec3 accumulated=vec3(0.);float transmittance=1.;
    for(int i=0;i<44;i++) {
      if(float(i)>=count||transmittance<.018)break;
      float distance=start+(float(i)+.35+jitter*.3)*stride;
      vec3 local=origin+ray*distance;
      float altitude=length(local)-CLOUD_R;
      vec3 p=earthFrame*local;
      float density=cloudDensity(p,altitude,true);
      if(density<.002)continue;
      float shadow=0.;
      for(int j=0;j<3;j++) {
        float stepKm=.35+float(j)*.85;
        vec3 probe=p+light*stepKm;
        shadow+=cloudDensity(probe,length(probe)-CLOUD_R,false)*(.55+float(j)*.45);
      }
      float sunlight=exp(-shadow*1.65);
      float elevation=dot(normalize(p),light);
      float daylight=smoothstep(-.13,.16,elevation);
      float top=smoothstep(1.4,6.,altitude);
      vec3 ambient=mix(vec3(.30,.39,.51),vec3(.64,.72,.81),top)*mix(.035,.65,daylight);
      vec3 tint=mix(vec3(1.,.57,.30),vec3(1.,.97,.90),smoothstep(.04,.40,elevation));
      vec3 lighting=ambient+tint*sunlight*(.72+forward*.38)*daylight;
      float alpha=1.-exp(-density*stride*1.8);
      float haze=(1.-exp(-distance/100.))*exp(-max(0.,eyeAltitude)/26.);
      lighting=mix(lighting,vec3(.48,.65,.79)*daylight,haze*.8);
      accumulated+=transmittance*alpha*lighting;
      transmittance*=1.-alpha;
    }
    return vec4(accumulated,1.-transmittance);
  }
`;

export function createEarthCloudLayer() {
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  target.texture.name = 'Earth volumetric cloud radiance';
  const uniforms = {
    ...earthCloudTextures(), cloudTime: { value: 0 }, cloudLod: { value: 0 }, cloudImage: { value: target.texture },
    eye: { value: new Vector3() }, radial: { value: new Vector3(0, 1, 0) }, height: { value: 0 },
    cameraBasis: { value: new Matrix3() }, earthFrame: { value: new Matrix3() },
    sun: { value: new Vector3(0, 1, 0) }, aspect: { value: 1 }, tanFov: { value: .445 },
  };
  const material = new ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 screen;void main(){screen=position.xy;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `varying vec2 screen;${cloudFieldShader}${rayShader}
      void main(){vec3 ray=normalize(cameraBasis*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
        gl_FragColor=cloudRadiance(ray);}`,
  });
  const scene = new Scene();
  const camera = new Camera();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const size = new Vector2(), clearColor = new Color();
  return {
    uniforms,
    render(renderer) {
      const lod=Math.max(0,Math.min(1,(uniforms.height.value-250)/2250));
      uniforms.cloudLod.value=fade(lod);
      renderer.getDrawingBufferSize(size);
      const scale = Math.min(.5, 960 / size.x, 540 / size.y);
      const width = Math.max(1, Math.ceil(size.x * scale)), height = Math.max(1, Math.ceil(size.y * scale));
      if (target.width !== width || target.height !== height) target.setSize(width, height);
      const previousTarget = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      renderer.getClearColor(clearColor);
      const clearAlpha = renderer.getClearAlpha();
      try {
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = true;
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColor, clearAlpha);
        renderer.autoClear = autoClear;
      }
    },
    dispose() { target.dispose(); material.dispose(); quad.geometry.dispose(); },
  };
}
