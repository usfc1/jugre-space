import {
  AdditiveBlending, BackSide, BufferGeometry, CanvasTexture, Color, DirectionalLight,
  Float32BufferAttribute, Group, HemisphereLight, Line, LineBasicMaterial, MathUtils, Mesh, MeshBasicMaterial,
  Matrix4, MeshStandardMaterial, PerspectiveCamera, Points, PointsMaterial, RingGeometry, Scene, ShaderMaterial,
  SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TextureLoader, Vector2, Vector3, RepeatWrapping,
} from 'three';
import { EARTH_RADIUS, FLORIDA, geoVector, JUPITER, launchUp, MARS, MOON, MOON_RADIUS, moonUp, SATURN } from './flight-missions.mjs';
import { earthImageryRegions } from './earth-imagery-config.mjs';
import { earthImageryShader } from './earth-imagery.mjs';
import { bodyNames, nominalTransferS, planetPosition, planets } from './mission-planets.mjs';
import { schematicPlanetMap } from './planet-appearance.mjs';
import { cloudFieldShader, createEarthCloudLayer } from './earth-clouds.mjs';
import { displayedSpaceScale } from './short-flight.mjs';

export const SPACE_SCALE = 0.01;
export function spaceCameraNear(bodies, eye) {
  let nearest = Infinity;
  for (const { mesh, radius, clipRadii = [] } of bodies) {
    if (!mesh.visible) continue;
    const distance = eye.distanceTo(mesh.position);
    nearest = Math.min(nearest, Math.abs(distance - radius * SPACE_SCALE));
    for (const shell of clipRadii) nearest = Math.min(nearest, Math.abs(distance - shell * SPACE_SCALE));
  }
  return Math.max(0.000001, Math.min(1, nearest * .16));
}
export const frameRotation = new Group().quaternion.setFromUnitVectors(new Vector3(0, 1, 0), launchUp);
const sunDirection = new Vector3(0.65, 0.35, 0.68).normalize();
const fract = (x) => x - Math.floor(x);
const noise = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

async function loadMap(loader, dataUrl) {
  const separator = dataUrl.indexOf(',');
  const raw = dataUrl.slice(separator + 1);
  const bytes = Uint8Array.fromBase64 ? Uint8Array.fromBase64(raw)
    : Uint8Array.from(atob(raw), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(';')) }));
  try {
    const texture = await loader.loadAsync(url);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function starField() {
  const group = new Group();
  const coordinates = [];
  const colors = [];
  for (let i = 0; i < 12500; i++) {
    const phi = noise(i, 7) * Math.PI * 2;
    const band = i > 6500;
    const y = band ? (noise(i, 9) - 0.5) * 0.21 : noise(i, 8) * 2 - 1;
    const r = Math.sqrt(1 - y * y);
    coordinates.push(Math.cos(phi) * r * 35000, y * 35000, Math.sin(phi) * r * 35000);
    const brightness = band ? 0.15 + noise(i, 4) * 0.35 : 0.28 + noise(i, 4) * 0.72;
    const tint = noise(i, 1);
    colors.push(brightness * (tint > 0.6 ? 0.70 : 1), brightness * 0.88, brightness * (tint < 0.2 ? 0.63 : 1));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(coordinates, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const stars = new Points(geometry, new PointsMaterial({ size: 1.15, sizeAttenuation: false, vertexColors: true, toneMapped: false, depthWrite: false }));
  stars.rotation.set(0.54, -0.21, 0.38);
  group.add(stars);
  const haze = new Mesh(new SphereGeometry(36000, 32, 20), new ShaderMaterial({
    side: BackSide, depthWrite: false,
    vertexShader: 'varying vec3 d; void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 d;void main(){vec3 n=normalize(d);float band=exp(-pow(n.y*8.+sin(n.x*3.)*.5,2.));float dust=.7+.3*sin(n.x*55.+sin(n.z*19.));gl_FragColor=vec4(vec3(.003,.004,.009)+vec3(.018,.014,.025)*band*dust,1.);}`,
  }));
  haze.rotation.copy(stars.rotation);
  haze.renderOrder = -2;
  stars.renderOrder = -1;
  group.add(haze);
  const glow = document.createElement('canvas');
  glow.width = glow.height = 128;
  const context = glow.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(0.10, '#fff3c2');
  gradient.addColorStop(0.19, '#ecb46b88'); gradient.addColorStop(1, '#ba844000');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const sun = new Sprite(new SpriteMaterial({ map: new CanvasTexture(glow), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  sun.name = 'solar_disc';
  sun.position.copy(sunDirection).multiplyScalar(30000);
  sun.scale.setScalar(1700);
  group.add(sun);
  return group;
}

export async function createSpaceWorld(textures) {
  const scene = new Scene();
  scene.background = new Color(0x010208);
  const loader = new TextureLoader();
  const [day, lights, moonMap, marsMap, jupiterMap, saturnMap, ringMap] = await Promise.all(
    ['earth', 'lights', 'moon', 'mars', 'jupiter', 'saturn', 'rings'].map(async key => {
      try { return await loadMap(loader, textures[key]); }
      catch (error) {
        if (key === 'earth' || key === 'lights') throw error;
        console.warn(`Could not decode the ${key} map`, error);
        return null;
      }
    }),
  );
  for (const texture of [day, lights, moonMap, marsMap, jupiterMap, saturnMap]) if (texture) texture.wrapS = RepeatWrapping;
  const earthPhotoMaps=Object.fromEntries(await Promise.all(earthImageryRegions.map(async({id})=>[id,await loadMap(loader,textures[`earth_${id}`])])));
  const earthPhotos=earthImageryShader(earthPhotoMaps);
  const clouds=createEarthCloudLayer();
  const cloudViewport=new Vector2();
  const camera = new PerspectiveCamera(48, 1, 0.05, 100000);
  const stars = starField();
  scene.add(stars);
  const sun = new DirectionalLight(0xfff1df, 3.1);
  sun.position.copy(sunDirection).multiplyScalar(50000);
  scene.add(sun, new HemisphereLight(0x6c7a99, 0x11131b, 0.16));
  const earth = new Mesh(new SphereGeometry(EARTH_RADIUS * SPACE_SCALE, 192, 128), new ShaderMaterial({
    uniforms: { ...earthPhotos.uniforms, ...clouds.uniforms, day: { value: day }, lights: { value: lights }, sun: { value: sunDirection } },
    vertexShader: 'varying vec2 st;varying vec3 n;varying vec3 localN;void main(){st=uv;localN=normal;n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `
      varying vec2 st;varying vec3 n;varying vec3 localN;uniform sampler2D day;uniform sampler2D lights;uniform vec3 sun;
      uniform mat3 earthFrame;
      ${earthPhotos.shader}
      ${cloudFieldShader}
      void main(){
        float facing=dot(normalize(n),sun);
        float daylight=smoothstep(-.12,.18,facing);
        vec3 surface=applyEarthImagery(texture2D(day,st).rgb,localN)*(.10+1.2*max(facing,0.));
        vec3 night=texture2D(lights,st).rgb*vec3(1.15,.91,.63)*1.45;
        vec3 col=surface*mix(.1,1.,daylight)+night*(1.-daylight);
        col*=cloudSurfaceShadow(normalize(localN)*6371.,normalize(earthFrame*sun),normalize(localN));
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(earth);
  const cloudShell=new Mesh(new SphereGeometry((EARTH_RADIUS+8)*SPACE_SCALE,192,128),new ShaderMaterial({
    transparent:true,depthWrite:false,
    uniforms:{cloudImage:clouds.uniforms.cloudImage,cloudViewport:{value:cloudViewport}},
    vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D cloudImage;uniform vec2 cloudViewport;
      void main(){vec4 cloud=texture2D(cloudImage,gl_FragCoord.xy/cloudViewport);
        if(cloud.a<.001)discard;gl_FragColor=vec4(cloud.rgb/max(.001,cloud.a),cloud.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  cloudShell.name='earth_volumetric_clouds';cloudShell.renderOrder=1;
  scene.add(cloudShell);
  const atmosphere = new Mesh(new SphereGeometry(EARTH_RADIUS * SPACE_SCALE * 1.012, 100, 72), new ShaderMaterial({
    side: BackSide, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { sun: { value: sunDirection } },
    vertexShader: 'varying vec3 n;varying vec3 v;void main(){vec4 p=modelMatrix*vec4(position,1.);n=normalize(mat3(modelMatrix)*normal);v=cameraPosition-p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}',
    fragmentShader: 'varying vec3 n;varying vec3 v;uniform vec3 sun;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.4);float lit=.24+.76*max(0.,dot(normalize(n),sun));gl_FragColor=vec4(.18,.45,1.,rim*lit*.7);}',
  }));
  scene.add(atmosphere);
  atmosphere.renderOrder=2;
  const marker = new Mesh(new SphereGeometry(0.045, 12, 8), new MeshBasicMaterial({ color: 0xf4b660, toneMapped: false }));
  marker.position.copy(launchUp).multiplyScalar((EARTH_RADIUS + 8) * SPACE_SCALE);
  scene.add(marker);
  const shipMarker = new Mesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: 0x8bf1cc, toneMapped: false }));
  shipMarker.visible = false;
  scene.add(shipMarker);

  const bodies = [];
  const planet = (name, origin, radius, map, fallback, flatten = 1, relief = 0) => {
    const material = new MeshStandardMaterial({ map, color: map ? 0xffffff : fallback,
      bumpMap: relief ? map : null, bumpScale: relief, roughness: 1 });
    const mesh = new Mesh(new SphereGeometry(radius * SPACE_SCALE, 160, 96), material);
    mesh.scale.y = flatten;
    mesh.position.copy(origin).multiplyScalar(SPACE_SCALE);
    scene.add(mesh);
    bodies.push({ id: Object.keys(bodyNames).find(id => bodyNames[id] === name), name, origin, baseOrigin: origin.clone(), radius, mesh, image: map?.image });
    return mesh;
  };
  const moon = planet('Moon', MOON.clone(), MOON_RADIUS, moonMap, 0x8b8680, 1, .018);
  moon.quaternion.setFromUnitVectors(geoVector(0.674, 23.473), moonUp);
  planet('Mars', MARS, 3389.5, marsMap, 0xb66445, .994, .035);
  const jupiter = planet('Jupiter', JUPITER, 69911, jupiterMap, 0xb99a7c, .935);
  jupiter.rotation.z = MathUtils.degToRad(3.1);
  const saturn = planet('Saturn', SATURN, 58232, saturnMap, 0xc7aa75, .902);
  saturn.rotation.z = MathUtils.degToRad(-26.7);
  if (ringMap) {
    const rings = new Mesh(new RingGeometry(746, 1402, 192), new ShaderMaterial({
      side: 2, transparent: true, depthWrite: false,
      uniforms: { banding: { value: ringMap }, sun: { value: sunDirection }, center: { value: saturn.position } },
      vertexShader: 'varying vec3 p;varying vec3 w;void main(){p=position;vec4 q=modelMatrix*vec4(position,1.);w=q.xyz;gl_Position=projectionMatrix*viewMatrix*q;}',
      fragmentShader: `
        varying vec3 p;varying vec3 w;uniform sampler2D banding;uniform vec3 sun;uniform vec3 center;
        void main(){
          float r=(length(p.xy)-746.)/656.;vec4 grains=texture2D(banding,vec2(r,.5));vec3 offset=w-center;
          float shadow=step(dot(offset,sun),0.)*(1.-smoothstep(530.,605.,length(cross(offset,sun))));
          gl_FragColor=vec4(grains.rgb*(.85-.70*shadow),grains.a*.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    rings.rotation.x = -Math.PI / 2;
    saturn.add(rings);
  }
  for (const [id, body] of Object.entries(planets)) if (!bodies.some(item => item.id === id)) {
    planet(body.name, planetPosition(id, 0, nominalTransferS(id)), body.radiusKm, schematicPlanetMap(id), body.color);
  }
  bodies.push({ id: 'earth', name: 'Earth', origin: new Vector3(), baseOrigin: new Vector3(), radius: EARTH_RADIUS,
    clipRadii: [EARTH_RADIUS + 8, EARTH_RADIUS * 1.012], mesh: earth, image: day.image });
  const trailGeometry = new BufferGeometry();
  const trail = new Line(trailGeometry, new LineBasicMaterial({ color: 0xe9b96c, transparent: true, opacity: 0.58, depthWrite: false }));
  scene.add(trail);
  const history = [];
  let lastTrack = 0;
  let bodyState, bodyEpoch, bodyPhase;
  function updateBodyOrigins(state) {
    if (bodyState === state && bodyEpoch === state.totalTime && bodyPhase === state.phaseIndex) return;
    bodyState = state; bodyEpoch = state.totalTime; bodyPhase = state.phaseIndex;
    const data = state.interplanetary;
    const planetaryEarth = data?.departed && planetPosition('earth', state.totalTime - data.epoch, data.route.transferS, data.route);
    const historicalEarth = state.solarFlight && state.bodyCenter('earth');
    const moonCenter = state.moonCenter;
    for (const body of bodies) {
      if (body.id === 'earth' && (historicalEarth || planetaryEarth)) body.origin.copy(historicalEarth || planetaryEarth);
      else if (body.id === 'moon') {
        body.origin.copy(moonCenter);
        if (historicalEarth || planetaryEarth) body.origin.add(historicalEarth || planetaryEarth);
      } else if (state.solarFlight) body.origin.copy(state.bodyCenter(body.id));
      else if (data?.departed) body.origin.copy(planetPosition(body.id, state.totalTime - data.epoch, data.route.transferS, data.route));
      else body.origin.copy(body.baseOrigin);
    }
  }
  return {
    scene, camera, dayTexture: day, nightTexture: lights, earthPhotoMaps, imageryInfo:earthPhotos.info, bodies, sunDirection, updateBodyOrigins,
    renderClouds(renderer) {
      if(!earth.visible)return;
      renderer.getDrawingBufferSize(cloudViewport);
      clouds.render(renderer);
    },
    update(state, nearCamera, overview = null, flightFrame = null) {
      const atMoon = ['moonOrbit', 'lunarFlyby', 'separate', 'moonLanding', 'moonSurface', 'rendezvous'].includes(state.kind);
      const earthClimb = state.kind === 'ascent' || state.kind === 'orbit';
      const vertical = earthClimb ? state.position.clone().normalize() : atMoon ? state.position.clone().sub(state.moonCenter).normalize()
        : state.kind === 'marsLanding' || state.kind === 'marsSurface' ? state.position.clone().sub(MARS).normalize()
          : launchUp;
      frameRotation.setFromUnitVectors(new Vector3(0, 1, 0), vertical);
      if (flightFrame) frameRotation.copy(flightFrame);
      const lunarMission = state.id === 'apollo_11' || state.id === 'artemis_ii' || Boolean(state.lunar);
      const lunarLight = atMoon ? 1 : state.kind === 'moonTransfer' ? MathUtils.smoothstep(state.progress, 0.65, 1)
        : state.kind === 'earthReturn' && lunarMission ? 1 - MathUtils.smoothstep(state.progress, 0, 0.6) : 0;
      sunDirection.set(0.65, 0.35, 0.68).lerp(new Vector3(-0.86, 0.48, -0.16), lunarLight).normalize();
      sun.position.copy(sunDirection).multiplyScalar(50000);
      stars.getObjectByName('solar_disc').position.copy(sunDirection).multiplyScalar(30000);
      const airglow = !overview && ['ascent', 'reentry'].includes(state.kind) ? 1 - MathUtils.smoothstep(state.altitude, 20, 115) : 0;
      scene.background.setRGB(0.01 + airglow * 0.08, 0.01 + airglow * 0.22, 0.02 + airglow * 0.40);
      stars.visible = airglow < 0.8;
      camera.aspect = nearCamera.aspect;
      camera.fov = nearCamera.fov;
      // Subtract large ephemeris coordinates in JS doubles before uploading to
      // the GPU. Otherwise metres disappear at lunar/interplanetary distances.
      const origin = state.position;
      earth.rotation.y=state.earthRotationEpoch===null?0:7.292115e-5*(state.totalTime-state.earthRotationEpoch);
      updateBodyOrigins(state);
      const distanceScale = overview ? 1 : displayedSpaceScale(state);
      for (const body of bodies) {
        body.mesh.position.copy(body.origin).sub(origin).multiplyScalar(SPACE_SCALE);
        if (distanceScale < 1) {
          const distance = body.mesh.position.length();
          const radius = body.radius * SPACE_SCALE;
          const height = Math.max(0, distance - radius);
          if (height > 0) {
            body.mesh.position.setLength(radius + height * distanceScale);
          }
        }
      }
      atmosphere.position.copy(earth.position);
      marker.position.copy(launchUp).applyQuaternion(earth.quaternion).multiplyScalar((EARTH_RADIUS + 8) * SPACE_SCALE).add(earth.position);
      const focus = overview ? bodies.find(({ name }) => name === overview) : null;
      const routeBody = state.interplanetary?.departed ? bodyNames[state.design.spec.destination] : state.kind.startsWith('mars') ? 'Mars' : state.kind.startsWith('jupiter') ? 'Jupiter'
        : state.kind.startsWith('saturn') || state.kind === 'escape' ? 'Saturn' : null;
      const ephemerisFlight = state.solarFlight || state.interplanetary?.departed;
      for (const body of bodies) {
        body.mesh.visible = focus ? body === focus : ephemerisFlight
          ? (body.id === 'earth' || body.name === routeBody) && body.mesh.position.length() - body.radius * SPACE_SCALE < camera.far
          : body.name === routeBody || distanceScale < 1 && (body.id === 'earth' || body.id === 'moon' && lunarMission)
            || !routeBody && (body.name === 'Earth' || lunarMission && body.name === 'Moon');
      }
      atmosphere.visible = earth.visible;
      cloudShell.position.copy(earth.position);cloudShell.visible=earth.visible;
      marker.visible = earth.visible;
      if (focus) {
        camera.position.copy(nearCamera.position).multiplyScalar(focus.radius * SPACE_SCALE / 30)
          .add(focus.mesh.position);
        camera.quaternion.copy(nearCamera.quaternion);
      } else {
        camera.position.copy(nearCamera.position).applyQuaternion(frameRotation).multiplyScalar(0.00001);
        camera.quaternion.copy(frameRotation).multiply(nearCamera.quaternion);
      }
      shipMarker.visible = !!focus;
      shipMarker.position.set(0, 0, 0);
      shipMarker.scale.setScalar(focus ? focus.radius * SPACE_SCALE * 0.005 : 1);
      // Clip against the displayed surfaces after route compression and camera
      // movement. Original ephemeris distances can cut away the nearby globe.
      camera.near = focus ? 0.05 : spaceCameraNear(bodies, camera.position);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const cloudEye=camera.position.clone().sub(earth.position).multiplyScalar(1/SPACE_SCALE);
      clouds.uniforms.radial.value.copy(cloudEye).normalize();
      clouds.uniforms.height.value=cloudEye.length()-EARTH_RADIUS;
      clouds.uniforms.cameraBasis.value.setFromMatrix4(camera.matrixWorld);
      clouds.uniforms.earthFrame.value.setFromMatrix4(new Matrix4().makeRotationY(-earth.rotation.y));
      clouds.uniforms.sun.value.copy(sunDirection);
      clouds.uniforms.aspect.value=camera.aspect;
      clouds.uniforms.tanFov.value=Math.tan(MathUtils.degToRad(camera.fov*.5));
      clouds.uniforms.cloudTime.value=state.totalTime%86400;
      stars.position.copy(camera.position);
      trail.visible = !!focus;
      if (state.totalTime - lastTrack > 0.65) {
        history.push(state.position.clone());
        if (history.length > 1300) history.shift();
        trail.geometry.dispose();
        lastTrack = state.totalTime;
      }
      if (focus) {
        trail.geometry.dispose();
        trail.geometry = new BufferGeometry().setFromPoints(history.map((point) => point.clone().sub(origin).multiplyScalar(SPACE_SCALE)));
      }
    },
    reset() {
      bodyState = undefined;
      frameRotation.setFromUnitVectors(new Vector3(0, 1, 0), launchUp);
      history.length = 0;
      lastTrack = 0;
      trail.geometry.dispose();
      trail.geometry = new BufferGeometry();
    },
  };
}
