import {
  BackSide, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial,
  LineSegments, MathUtils, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Points, Scene, ShaderMaterial,
  SphereGeometry, Vector2, Vector3,
} from 'three';
import { reentryProfile } from './reentry-profile.mjs';
import { oceanHeight, oceanShader } from './ocean-surface.mjs';
import { cloudFieldShader, createEarthCloudLayer } from './earth-clouds.mjs';

const clamp = MathUtils.clamp;
const smooth = MathUtils.smoothstep;
const hash = (i) => { const n = Math.sin(i * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

function makeParachutes(count) {
  const root = new Group();
  const rigs = [];
  const finishes = [0xf6eee0, 0xd74a2d].map((color) => new MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.08, roughness: 0.95, side: DoubleSide, transparent: true,
  }));
  const canopyCollapse = { value: 0 };
  for (const finish of finishes) finish.onBeforeCompile = (shader) => {
    shader.uniforms.canopyCollapse = canopyCollapse;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float canopyCollapse;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y+=canopyCollapse*(2.4*sin(position.x*2.7+position.z*1.4)+1.5*sin(position.z*4.));
        transformed.x+=canopyCollapse*.28*sin(position.z*1.7);`);
  };
  const cords = new LineBasicMaterial({ color: 0xdfe5de, transparent: true, opacity: 0.85 });
  for (let i = 0; i < count; i++) {
    const fabric = new Group();
    for (let panel = 0; panel < 16; panel++) {
      const segment = new Mesh(new SphereGeometry(4.2, 6, 12, panel * Math.PI / 8,
        Math.PI / 8, 0.10, Math.PI / 2 - 0.10), finishes[panel % 2]);
      fabric.add(segment);
    }
    const lines = new LineSegments(new BufferGeometry(), cords);
    lines.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(16 * 4 * 3), 3));
    lines.frustumCulled = false;
    root.add(fabric, lines);
    rigs.push({ fabric, lines, angle: i * Math.PI * 2 / count + Math.PI / 6 });
  }
  return {
    root,
    update(time, opening, age, halfHeight, waterY) {
      const collapse = age < 0 ? 0 : smooth(age, 0.25, 3.7);
      canopyCollapse.value = collapse;
      const opacity = age < 0 ? 1 : 1 - smooth(age, 8, 14);
      root.visible = opening > 0 && opacity > 0;
      finishes.forEach((finish) => { finish.opacity = opacity; });
      cords.opacity = 0.85 * opacity;
      for (const { fabric, lines, angle } of rigs) {
        const spread = (4.9 + collapse * 9) * opening;
        const wind = age < 0 ? Math.sin(time * 0.6 + angle) * 0.22 : Math.max(0, age) * 0.55;
        fabric.position.set(Math.cos(angle) * spread + wind,
          MathUtils.lerp(halfHeight + 19, waterY + 0.16, collapse), Math.sin(angle) * spread);
        fabric.scale.set(opening * (1 - collapse * .45), opening * (0.58 - 0.55 * collapse), opening * (1 + collapse * .18));
        fabric.rotation.set(Math.sin(time * 0.8 + angle) * 0.025 * (1 - collapse), 0, 0);
        const positions = lines.geometry.attributes.position;
        for (let j = 0; j < 16; j++) {
          const a = j * Math.PI / 8;
          const start = new Vector3(Math.cos(a) * 0.28 + fabric.position.x * .42 * collapse,
            MathUtils.lerp(halfHeight * 0.85, waterY + 0.08, collapse), Math.sin(a) * 0.28 + fabric.position.z * .42 * collapse);
          const end = new Vector3(Math.cos(a) * 4.2 * fabric.scale.x, 0, Math.sin(a) * 4.2 * fabric.scale.z).add(fabric.position);
          const middle = start.clone().lerp(end, 0.5);
          middle.y = Math.max(waterY + 0.05, middle.y - collapse * 3);
          for (const [k, point] of [start, middle, middle, end].entries()) positions.setXYZ(j * 4 + k, point.x, point.y, point.z);
        }
        positions.needsUpdate = true;
      }
    },
  };
}

const skyLight = `
  const vec3 sunlight=vec3(-.352,.554,.754);
  uniform mat3 earthFrame;uniform float height;
  ${cloudFieldShader}
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
  vec3 skyColor(vec3 d){
    float h=max(0.,d.y);
    vec3 color=mix(vec3(.56,.72,.83),vec3(.105,.31,.58),pow(h,.47));
    color+=vec3(.32,.24,.12)*pow(max(dot(d,sunlight),0.),16.);
    return color;
  }
  vec3 reflectedSky(vec3 d) {
    vec3 color=skyColor(d);
    // A cheap filtered sample of the same cloud field in the water reflection.
    float distance=max(0.,2.7-height)/max(.055,d.y);
    vec3 p=earthFrame*(vec3(0.,6371.+height,0.)+d*distance);
    float density=cloudDensity(p,length(p)-6371.,false);
    float alpha=(1.-exp(-density*7.))*smoothstep(0.,.12,d.y);
    return mix(color,vec3(.78,.83,.85),alpha);
  }
`;

function makeSky() {
  const clouds=createEarthCloudLayer();
  clouds.uniforms.sun.value.set(-.352,.554,.754).normalize();
  const mesh = new Mesh(new SphereGeometry(1000, 32, 20), new ShaderMaterial({
    side: BackSide, depthWrite: false, depthTest: false, transparent: true,
    uniforms: { ...clouds.uniforms, cloudViewport: { value: new Vector2() }, opacity: { value: 0 } },
    vertexShader: `varying vec3 direction;void main(){direction=position;vec4 p=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.);gl_Position=p.xyww;}`,
    fragmentShader: `
      varying vec3 direction;uniform float opacity;
      uniform sampler2D cloudImage;uniform vec2 cloudViewport;
      ${skyLight}
      void main(){
        vec3 d=normalize(direction);
        vec3 color=mix(skyColor(d),vec3(2.4,2.1,1.6),smoothstep(.99965,.99982,dot(d,sunlight)));
        vec4 cloud=texture2D(cloudImage,gl_FragCoord.xy/cloudViewport);
        color=color*(1.-cloud.a)+cloud.rgb;
        gl_FragColor=vec4(color,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  mesh.frustumCulled = false;
  mesh.userData.cloudLayer=clouds;
  return mesh;
}

function makeWater(clouds) {
  const geometry = new PlaneGeometry(60000, 60000, 192, 192).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const spread = (v) => Math.sign(v) * (Math.abs(v) / 30000) ** 3.0 * 30000;
    positions.setX(i, spread(positions.getX(i))); positions.setZ(i, spread(positions.getZ(i)));
  }
  const material = new ShaderMaterial({
    transparent: true,
    uniforms: { ...clouds.uniforms, time: { value: 0 }, impactAge: { value: -1 }, altitude: { value: 3000 }, hull: { value: 2 },
      hullCenter: { value: new Vector2() }, opacity: { value: 0 } },
    vertexShader: `
      varying vec3 world;varying vec3 view;uniform float time;uniform float impactAge;uniform float hull;
      ${oceanShader}
      void main(){vec3 p=position;float r=length(p.xz);
        float swell=1.-smoothstep(85.,520.,r);
        float age=max(0.,impactAge);float edge=r-hull-age*2.9;
        float ripple=.17*sin(edge*4.1)*exp(-edge*edge/5.-age*.46)*step(0.,impactAge);
        p.y+=ocean(p.xz,time).x*swell+ripple;
        vec4 w=modelMatrix*vec4(p,1.);world=w.xyz;view=cameraPosition-w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `
      varying vec3 world;varying vec3 view;
      uniform float time;uniform float impactAge;uniform float altitude;uniform float hull;uniform float opacity;
      uniform vec2 hullCenter;
      ${oceanShader}
      ${skyLight}
      void main(){
        vec2 p=world.xz;float dist=length(view);float r=length(p);
        vec2 footprint=fwidth(p);
        vec3 waves=ocean(p,time,footprint);
        float detail=(1.-smoothstep(40.,230.,dist))*(1.-smoothstep(.20,1.1,max(footprint.x,footprint.y)));
        float farFade=1.-smoothstep(120.,1100.,dist);
        vec2 small=vec2(noise(p*2.8+time*.12),noise(p.yx*2.1-time*.09))-.5;
        float age=max(0.,impactAge), contact=step(0.,impactAge);
        float edge=r-hull-age*2.9;
        float ring=exp(-edge*edge/5.-age*.42)*contact;
        vec2 slope=(waves.yz*.85+small*.18*detail)*farFade+normalize(p+vec2(.001))*(ring*.19*cos(edge*4.1));
        vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
        vec3 v=normalize(view);
        float fresnel=.025+.975*pow(1.-max(dot(n,v),0.),5.);
        vec3 reflected=reflect(-v,n);
        vec3 sky=reflectedSky(reflected);
        vec3 water=mix(vec3(.008,.071,.115),vec3(.018,.17,.216),clamp(waves.x*1.5+.45,0.,1.));
        vec3 color=mix(water,sky,fresnel);
        float sun=max(dot(reflected,sunlight),0.);
        color+=vec3(2.,1.65,1.09)*(pow(sun,170.)*.62+pow(sun,35.)*.11);
        float hullDistance=length(p-hullCenter);
        color*=1.-.56*exp(-hullDistance*hullDistance/(hull*hull*1.4))*(1.-smoothstep(0.,8.,altitude));
        float breakUp=noise(p*3.4+vec2(time*.22,-time*.10));
        float wake=exp(-pow((hullDistance-hull)/.49,2.))*smoothstep(.27,.68,breakUp);
        float crests=smoothstep(.265,.348,waves.x)*smoothstep(.43,.76,breakUp)*.38*detail;
        float foam=clamp(crests+contact*wake*(.24+.54*exp(-age*.27))+ring*smoothstep(.3,.7,breakUp)*.88,0.,.95);
        color=mix(color,vec3(.82,.93,.93),foam);
        color=mix(color,vec3(.56,.72,.83),1.-exp(-dist*.00058));
        gl_FragColor=vec4(color,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}

function makeSpray() {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(560 * 3);
  const alphas = new Float32Array(560);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('alpha', new Float32BufferAttribute(alphas, 1));
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'attribute float alpha;varying float a;void main(){a=alpha;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(125./max(1.,-p.z),1.,13.);gl_Position=projectionMatrix*p;}',
    fragmentShader: 'varying float a;void main(){float f=1.-smoothstep(.13,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.87,.96,1.,a*f);}',
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { points, update(age, radius, waterY) {
    points.visible = age >= 0 && age < 2.2;
    if (!points.visible) return;
    const p = geometry.attributes.position;
    const alpha = geometry.attributes.alpha;
    for (let i = 0; i < p.count; i++) {
      const t = age - hash(i + 22) * .22;
      const a = i * 2.399963;
      const r = radius * .82 + t * (1.5 + hash(i) * 6.6);
      const y = (2 + hash(i + 42) * 6.8) * t - 4.905 * t * t;
      alpha.setX(i, t > 0 && y > 0 ? (1 - smooth(t, .26, 1.7)) * (.48 + hash(i + 2) * .42) : 0);
      p.setXYZ(i, Math.cos(a) * r, waterY + y, Math.sin(a) * r);
    }
    p.needsUpdate = alpha.needsUpdate = true;
  } };
}

export function createRecoveryView() {
  const group = new Group();
  const background = new Scene();
  const sky = makeSky();
  const clouds=sky.userData.cloudLayer;
  background.add(sky);
  const water = makeWater(clouds);
  const spray = makeSpray();
  const chutes = new Map();
  group.add(water.mesh, spray.points);
  group.visible = false;
  let hitTime = null;
  let cameraStage = null;
  let cameraAutomatic = true;
  let active = false;
  let skyBlend = 0;
  let buoyancy = 0;
  let velocity = 0;
  const slope = new Vector3();
  const recoveryEye = new Vector3();
  const recoveryLook = new Vector3();
  return {
    group, background,
    get active() { return active; },
    get skyBlend() { return skyBlend; },
    renderClouds(renderer,camera) {
      camera.updateMatrixWorld();
      const u=clouds.uniforms;
      u.eye.value.copy(camera.position).multiplyScalar(.001);
      u.cameraBasis.value.setFromMatrix4(camera.matrixWorld);
      u.aspect.value=camera.aspect;u.tanFov.value=Math.tan(MathUtils.degToRad(camera.fov*.5));
      renderer.getDrawingBufferSize(sky.material.uniforms.cloudViewport.value);
      clouds.render(renderer);
    },
    reset() {
      hitTime = cameraStage = null;
      cameraAutomatic = true; active = group.visible = false;
      skyBlend = buoyancy = velocity = 0;
      for (const chute of chutes.values()) chute.root.visible = false;
    },
    releaseCamera() { cameraAutomatic = false; },
    update(state, ship, halfHeight, width, time, dt, camera, controls) {
      const entry = state.lunar?.entry;
      const profile = state.lunar ? { altitude: state.altitude, landed: entry?.landed ?? false, opening: entry?.opening ?? 0 } : reentryProfile(state.progress);
      skyBlend = state.kind === 'reentry' ? 1 - smooth(profile.altitude, 2.7, 20) : 0;
      active = group.visible = skyBlend > 0;
      if (!active) return;
      const radial=state.position.clone().normalize();
      const east=new Vector3(0,1,0).cross(radial).normalize();
      clouds.uniforms.earthFrame.value.setFromMatrix4(new Matrix4().makeBasis(east,radial,east.clone().cross(radial)));
      clouds.uniforms.height.value=profile.altitude;
      clouds.uniforms.cloudTime.value=state.totalTime%86400;
      ship.position.set(0, 0, 0);
      sky.material.uniforms.opacity.value = skyBlend;
      water.material.uniforms.opacity.value = skyBlend;
      water.material.transparent = skyBlend < 1;
      const count = state.mission.capsule === 'dragon' ? 4 : 3;
      if (!chutes.has(count)) {
        const chute = makeParachutes(count); chutes.set(count, chute); group.add(chute.root);
      }
      for (const [n, chute] of chutes) if (n !== count) chute.root.visible = false;
      if (profile.landed && hitTime === null) { hitTime = time; velocity = -1.9; }
      const age = hitTime === null ? -1 : Math.max(0, time - hitTime);
      const waterY = -halfHeight - profile.altitude * 1000;
      water.mesh.position.y = waterY;
      water.material.uniforms.time.value = time;
      water.material.uniforms.impactAge.value = age;
      water.material.uniforms.altitude.value = profile.altitude * 1000;
      water.material.uniforms.hull.value = width * 0.42;
      if (profile.landed) {
        ship.position.x = .63 * (1 - Math.exp(-age * .7)) + .045 * age;
        ship.position.z = -.34 * (1 - Math.exp(-age));
        const equilibrium = oceanHeight(ship.position.x, ship.position.z, time, slope) - .34;
        const steps = Math.max(1, Math.ceil(dt / .016));
        for (let i = 0; i < steps; i++) {
          velocity += (16 * (equilibrium - buoyancy) - 4.2 * velocity) * dt / steps;
          buoyancy += velocity * dt / steps;
        }
        ship.position.y = buoyancy;
        ship.rotation.x = -Math.atan(slope.z) * .72 + .11 * Math.exp(-age * 1.6) * Math.sin(age * 6);
        ship.rotation.z = Math.atan(slope.x) * .72 - .038;
      }
      water.material.uniforms.hullCenter.value.set(ship.position.x, ship.position.z);
      chutes.get(count).update(time, profile.opening, age, halfHeight, waterY);
      spray.update(age, width * 0.42, waterY);
      if (camera && controls) {
        if (cameraStage === null) {
          cameraStage = 'descent';
          controls.minDistance = 8; controls.maxDistance = 170;
          controls.minPolarAngle = 0.08; controls.maxPolarAngle = Math.PI * .49;
          camera.far = 30000; camera.updateProjectionMatrix(); controls.update();
        }
        if (cameraAutomatic) {
          const t = 1 - Math.exp(-clamp(dt, 0, .1) * (profile.landed ? 1.45 : .96));
          recoveryEye.set(profile.landed ? 12 : 24, profile.landed ? 4.7 : 13, profile.landed ? 21 : 43);
          recoveryLook.set(ship.position.x, profile.landed ? .5 : 6.2, ship.position.z);
          camera.position.lerp(recoveryEye, t);
          controls.target.lerp(recoveryLook, t);
          controls.update();
        }
      }
    },
  };
}
