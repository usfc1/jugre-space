import { Matrix3, Matrix4, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector3, MathUtils } from 'three';
import { EARTH_RADIUS, launchUp, east } from './flight-missions.mjs';
import { kennedyTiles } from './kennedy-layout.mjs';
import { earthImageryShader } from './earth-imagery.mjs';
import { cloudFieldShader, createEarthCloudLayer } from './earth-clouds.mjs';
import { shortenedSpaceScale } from './short-flight.mjs';

function localImagery(terrainMaps) {
  const tiles = kennedyTiles.filter(({ id }) => terrainMaps[id]);
  const sampler = (id) => `kennedy_${id}`;
  const uniforms = Object.fromEntries(tiles.map(({ id }) => [sampler(id), { value: terrainMaps[id] }]));
  const declarations = tiles.map(({ id }) => `uniform sampler2D ${sampler(id)};`).join('\n');
  const samples = tiles.map(({ id, bounds }, index) => {
    const [west, north, east, south] = bounds;
    return `{
      vec2 uv=(ground-vec2(${west}.0,${north}.0))/vec2(${east-west}.0,${south-north}.0);
      vec2 edge=min(uv,1.-uv);
      float inside=min(edge.x,edge.y);
      if(inside>0.) {
        vec3 tile=texture2D(${sampler(id)},uv).rgb;
        color=mix(color,tile,smoothstep(0.,.055,inside)*visibility);
      }
    }`;
  }).join('\n');
  return {
    uniforms,
    shader: `${declarations}
      vec3 applyKennedy(vec3 color,vec2 ground,float visibility){
        float land=1.-smoothstep(.005,.04,color.b-max(color.r,color.g));
        visibility*=max(land,1.-smoothstep(12000.,25000.,length(ground)));
        ${samples}
        return color;
      }`,
  };
}

// Camera-relative ray/sphere intersection gives a continuous horizon all the
// way from the launch coast to orbit, without giant low-altitude globe facets.
export function createAscentView(day, terrainMaps = {}, earthPhotoMaps = {}, lights = null) {
  const imagery = localImagery(terrainMaps);
  const earthPhotos=earthImageryShader(earthPhotoMaps);
  const scene = new Scene();
  const clouds = createEarthCloudLayer();
  const material = new ShaderMaterial({
    depthTest: false, depthWrite: false, transparent: true,
    uniforms: {
      ...imagery.uniforms,
      ...earthPhotos.uniforms,
      day: { value: day }, lights: { value: lights ?? day }, hasNightMap: { value: Boolean(lights) },
      eye: { value: new Vector3() }, cameraBasis: { value: new Matrix3() },
      frame: { value: new Matrix3() }, earthFrame: { value: new Matrix3() }, radial: { value: new Vector3(0,1,0) },
      launchOffset: { value: new Vector3() }, east: { value: new Vector3() }, north: { value: new Vector3() },
      sun: { value: new Vector3() }, height: { value: 0 }, aspect: { value: 1 }, tanFov: { value: .445 },
      opacity: { value: 1 },
      ...clouds.uniforms,
    },
    vertexShader: 'varying vec2 screen;void main(){screen=position.xy;gl_Position=vec4(position.xy,.999999,1.);}',
    fragmentShader: `
      varying vec2 screen;
      uniform sampler2D day;uniform sampler2D lights;uniform bool hasNightMap;
      uniform vec3 eye;uniform vec3 radial;uniform mat3 cameraBasis;uniform mat3 frame;uniform mat3 earthFrame;
      uniform vec3 launchOffset;uniform vec3 east;uniform vec3 north;uniform vec3 sun;
      uniform float height;uniform float aspect;uniform float tanFov;uniform float opacity;
      uniform sampler2D cloudImage;
      ${cloudFieldShader}
      ${imagery.shader}
      ${earthPhotos.shader}
      const float R=6371.;const float PI=3.14159265359;
      float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
      float hitSphere(vec3 ray,float shell){
        float b=dot(eye,ray)+(R+height)*dot(ray,radial);
        float c=(height-shell)*(2.*R+height+shell)+2.*(R+height)*dot(eye,radial)+dot(eye,eye);
        float d=b*b-c;if(d<0.)return -1.;
        float farHit=-b+sqrt(d);
        if(farHit<=0.)return -1.;
        return c>0.?c/farHit:farHit;
      }
      vec3 sky(vec3 ray){float air=exp(-height/25.);float y=max(dot(ray,radial),0.);
        vec3 daylight=mix(vec3(.49,.69,.84),vec3(.055,.22,.50),pow(y,.36));
        vec3 color=mix(vec3(.001,.003,.009),daylight,air);
        float glow=pow(max(dot(ray,sun),0.),12.);color+=vec3(.32,.23,.11)*glow*air;
        color+=vec3(2.,1.8,1.5)*smoothstep(.99965,.99985,dot(ray,sun));
        float stars=step(.9988,hash(floor((frame*ray)*1100.)))*smoothstep(75.,160.,height);color+=stars*.7;
        return color;}
      void main(){
        vec3 ray=normalize(cameraBasis*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
        vec3 center=-radial*(R+height);float distance=hitSphere(ray,0.);
        vec3 color=sky(ray);
        if(distance>0.){
          vec3 p=eye+ray*distance;vec3 n=normalize(p-center);vec3 globeNormal=normalize(earthFrame*n);
          vec2 uv=vec2((atan(-globeNormal.z,globeNormal.x)+PI)/(2.*PI),asin(clamp(globeNormal.y,-1.,1.))/PI+.5);
          vec3 map=applyEarthImagery(texture2D(day,uv).rgb,globeNormal);
          vec3 relative=p+launchOffset;
          vec2 ground=vec2(dot(relative,east),-dot(relative,north))*1000.;
          map=applyKennedy(map,ground,1.-smoothstep(80.,200.,height));
          float facing=dot(n,sun),daylight=smoothstep(-.12,.18,facing);
          vec3 night=hasNightMap?texture2D(lights,uv).rgb*vec3(1.15,.91,.63)*1.45:vec3(0.);
          color=map*(.10+1.2*max(facing,0.))*mix(.1,1.,daylight)+night*(1.-daylight);
          color*=cloudSurfaceShadow(globeNormal*R,normalize(earthFrame*sun),globeNormal);
          float haze=(1.-exp(-distance/(48.+height*4.)))*exp(-height/31.);
          color=mix(color,vec3(.38,.57,.73),haze*.78);
        }
        vec4 cloud=texture2D(cloudImage,screen*.5+.5);
        color=color*(1.-cloud.a)+cloud.rgb;
        float tangent=length(cross(eye-center,ray));
        float limb=(1.-smoothstep(R,R+25.,tangent))*step(R,tangent)*step(0.,-dot(eye-center,ray));
        color+=vec3(.08,.22,.42)*limb*smoothstep(12.,70.,height);
        float dip = sqrt(max(0., 2. * (height + dot(eye,radial)) / R));
        float horizonHaze = (1. - smoothstep(0., .052, abs(dot(ray,radial) + dip))) * exp(-height / 26.);
        color = mix(color, vec3(.48, .65, .77), .58 * horizonHaze);
        gl_FragColor=vec4(color,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const backdrop = new Mesh(new PlaneGeometry(2, 2), material);
  backdrop.frustumCulled = false;
  scene.add(backdrop);
  const launchPoint = launchUp.clone().multiplyScalar(EARTH_RADIUS);
  const north = new Vector3().crossVectors(launchUp, east).normalize();
  const basis = new Matrix4();
  const earthBasis = new Matrix4();
  return {
    scene,
    renderClouds: renderer => clouds.render(renderer),
    update(state, camera, rotation, sun, originHeightM, opacity) {
      camera.updateMatrixWorld();
      const worldToFlight = rotation.clone().invert();
      const origin = state.position.clone();
      if (state.kind === 'ascent') {
        origin.setLength(EARTH_RADIUS + (origin.length() - EARTH_RADIUS) * shortenedSpaceScale(state));
      }
      origin.addScaledVector(state.position.clone().normalize(), originHeightM * .001);
      const { uniforms } = material;
      uniforms.height.value = origin.length() - EARTH_RADIUS;
      uniforms.eye.value.copy(camera.position).multiplyScalar(.001);
      uniforms.cameraBasis.value.setFromMatrix4(camera.matrixWorld);
      uniforms.frame.value.setFromMatrix4(basis.makeRotationFromQuaternion(rotation));
      // The departure frame stops following the local vertical at TLI. Keep
      // the same Earth horizon while its radial direction moves in that frame.
      uniforms.radial.value.copy(origin).normalize().applyQuaternion(worldToFlight);
      const earthAngle=state.earthRotationEpoch==null?0:7.292115e-5*(state.totalTime-state.earthRotationEpoch);
      uniforms.earthFrame.value.setFromMatrix4(earthBasis.makeRotationY(-earthAngle).multiply(basis));
      uniforms.launchOffset.value.copy(origin).sub(launchPoint).applyQuaternion(worldToFlight);
      uniforms.east.value.copy(east).applyQuaternion(worldToFlight);
      uniforms.north.value.copy(north).applyQuaternion(worldToFlight);
      uniforms.sun.value.copy(sun).applyQuaternion(worldToFlight);
      uniforms.aspect.value = camera.aspect;
      uniforms.tanFov.value = Math.tan(MathUtils.degToRad(camera.fov * .5));
      uniforms.opacity.value = opacity;
      uniforms.cloudTime.value = state.totalTime % 86400;
    },
  };
}
