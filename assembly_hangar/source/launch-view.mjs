import {
  BackSide, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, Fog,
  Group, HemisphereLight, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, Points,
  Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { makeExhaust, makeGroundSmoke } from './flight-effects.mjs';
import { missions, customMission } from './flight-missions.mjs';
import { kennedyCameras, kennedySites } from './kennedy-layout.mjs';
import { east, launchUp } from './flight-missions.mjs';
import { createEarthCloudLayer } from './earth-clouds.mjs';

const storageKey = 'jugre.launch-complex.rocket.v1';
const skyShader = {
  vertexShader: `varying vec3 direction; void main() { direction = position; vec4 p=projectionMatrix*vec4(mat3(viewMatrix)*position,1.); gl_Position=p.xyww; }`,
  fragmentShader: `
    varying vec3 direction;
    uniform float dusk;
    uniform vec3 sun;
    uniform vec3 fogHorizon;
    uniform sampler2D cloudImage;uniform vec2 cloudViewport;
    void main(){
      vec3 d=normalize(direction);
      float h=max(d.y,0.);
      vec3 horizon=mix(vec3(.74,.85,.84),vec3(.65,.40,.31),dusk);
      vec3 zenith=mix(vec3(.20,.49,.70),vec3(.055,.10,.22),dusk);
      vec3 col=mix(horizon,zenith,pow(h,.48));
      float glow=pow(max(dot(d,sun),0.),9.);
      col+=mix(vec3(.17,.13,.05),vec3(.6,.21,.06),dusk)*glow;
      float disc=smoothstep(.99965,.99985,dot(d,sun));
      col=mix(col,vec3(1.,.89,.61)*1.6,disc);
      vec4 cloud=texture2D(cloudImage,gl_FragCoord.xy/cloudViewport);
      col=col*(1.-cloud.a)+cloud.rgb;
      gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb=mix(fogHorizon,gl_FragColor.rgb,smoothstep(-.01,.12,d.y));
    }`,
};

function waterTest() {
  const coordinates = new Float32Array(780 * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(coordinates, 3));
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(470./-p.z,1.3,12.);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `
      void main(){float a=1.-smoothstep(.22,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.81,.93,.96,a*.7);}`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return {
    points,
    update(time) {
      for (let i = 0; i < coordinates.length / 3; i++) {
        const nozzle = i % 12;
        const angle = nozzle * Math.PI / 6;
        const t = ((i * 0.61803398875 + time * 0.75) % 1);
        const r = 10.8 - 7.8 * t;
        const jitter = Math.sin(i * 29.1 + time) * 0.12 * t;
        coordinates[i * 3] = Math.cos(angle) * r + jitter;
        coordinates[i * 3 + 1] = 8.2 + 4 * t - 10.1 * t * t;
        coordinates[i * 3 + 2] = Math.sin(angle) * r + jitter;
      }
      geometry.attributes.position.needsUpdate = true;
    },
  };
}

function labelSigns(root) {
  root.traverse((item) => {
    if (item.userData.role !== 'outdoorSign') return;
    const { text, widthM, heightM } = item.userData;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e9eee1';
    context.font = '700 122px "Segoe UI",Arial,sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 512, 129, 980);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const sign = new Mesh(new PlaneGeometry(widthM, heightM), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    sign.position.z = 0.105;
    item.add(sign);
  });
}

export function setupLaunchView({ complex, rockets, decode, loader, environment, customCraft, getCustomLayout, fitCamera, anisotropy, validateCustom }) {
  const scene = new Scene();
  const dayFog = new Color(0xb6d5db);
  const eveningFog = new Color(0x886b69);
  scene.background = dayFog;
  scene.fog = new Fog(dayFog, 5400, 36000);
  scene.environment = environment;
  scene.environmentIntensity = 0.65;
  scene.add(complex);
  const terrainMaps = {};
  complex.traverse((item) => {
    if (!item.isMesh) return;
    const tile = item.userData.kennedyTile;
    if (tile) {
      item.material.map.anisotropy = anisotropy;
      terrainMaps[tile] = item.material.map;
    }
    // glTF has no standard environment-intensity or dithering properties.
    if (item.material.name.startsWith('Kennedy aerial ')) {
      item.material.envMapIntensity = 0.2;
      item.material.dithering = true;
    }
    item.castShadow = !tile && !item.name.includes('titusville_lowrise');
    item.receiveShadow = true;
  });
  labelSigns(complex);
  const ambient = new HemisphereLight(0xc7e8ff, 0x8c805f, 1.45);
  const sun = new DirectionalLight(0xffe4bd, 2.55);
  sun.position.set(-150, 270, 110);
  sun.target.position.set(0, 30, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -105, right: 105, top: 105, bottom: -105, near: 1, far: 700 });
  sun.shadow.normalBias = 0.10;
  sun.shadow.bias = -0.00012;
  sun.shadow.radius = 3;
  scene.add(ambient, sun, sun.target);
  const clouds = createEarthCloudLayer();
  clouds.uniforms.earthFrame.value.setFromMatrix4(new Matrix4().makeBasis(east,launchUp,new Vector3().crossVectors(east,launchUp)));
  const cloudViewport = new Vector2();
  function prepareClouds(renderer,camera) {
    camera.updateMatrixWorld();
    const u=clouds.uniforms;
    u.eye.value.copy(camera.position).multiplyScalar(.001);
    u.cameraBasis.value.setFromMatrix4(camera.matrixWorld);
    u.aspect.value=camera.aspect;u.tanFov.value=Math.tan(MathUtils.degToRad(camera.fov*.5));
    renderer.getDrawingBufferSize(cloudViewport);
    clouds.render(renderer);
  }
  const skyMaterial = new ShaderMaterial({
    ...skyShader, uniforms: {
      ...clouds.uniforms, cloudViewport: { value: cloudViewport },
      dusk: { value: 0 },
      fogHorizon: { value: dayFog.getRGB({}, SRGBColorSpace) },
    },
    side: BackSide, depthWrite: false,
  });
  const sky = new Mesh(new SphereGeometry(9000, 36, 20), skyMaterial);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  const spray = waterTest();
  scene.add(spray.points);
  const padRocket = new Group();
  padRocket.name = 'launch_rocket';
  scene.add(padRocket);
  const exhaust = makeExhaust();
  const smoke = makeGroundSmoke();
  exhaust.root.position.set(0, 9.08, 0);
  exhaust.root.visible = false;
  scene.add(exhaust.root, smoke.root);
  const supports = new Group();
  scene.add(supports);
  const supportMetal = new MeshStandardMaterial({ color: 0x748c96, metalness: 0.55, roughness: 0.6 });
  const supportPaint = new MeshStandardMaterial({ color: 0xd6a243, metalness: 0.18, roughness: 0.7 });
  const arms = [];
  const floodlights = [];
  let lift;
  complex.traverse((item) => {
    if (item.userData.role === 'serviceArm') arms.push(item);
    if (item.userData.role === 'serviceLift') lift = item;
    if (item.userData.role === 'outdoorLight') {
      const light = new PointLight(0xffda9b, 0, 110, 1.7);
      light.position.copy(item.position).add(new Vector3(0, 17, 0));
      scene.add(light);
      floodlights.push(light);
    }
  });
  const select = document.querySelector('#launch-rocket');
  select.replaceChildren(new Option('My rocket', 'custom'), ...rockets.map(({ id, name }) => new Option(name, id)));
  const status = document.querySelector('#launch-status');
  const info = document.querySelector('#launch-rocket-info');
  const panel = document.querySelector('#launch-panel');
  const armButton = document.querySelector('#launch-arms');
  const cache = new Map();
  let active = false;
  let request = 0;
  let armsOut = false;
  let armTravel = 0;
  let evening = false;
  let skyBlend = 0;
  let currentHeight = 110;
  let currentWidth = 10;
  let flightHeight = 0;
  let inFlight = false;
  let elapsed = 0;
  let selection = rockets[0].id;
  let designed = null;
  let resumeLayout = null;
  try {
    const previous = localStorage.getItem(storageKey) ?? localStorage.getItem('jugre.assembly-hangar.ready-rocket.v1');
    if (previous === 'custom' || rockets.some(({ id }) => id === previous)) selection = previous;
  } catch { /* Start with Apollo 11 if storage is unavailable. */ }
  select.value = selection;
  const missionBrief = document.querySelector('#launch-mission-brief');
  const missionIndex = document.querySelector('#mission-index');
  for (const mission of Object.values(missions)) {
    const item = document.createElement('li');
    item.textContent = `${mission.title.replace(/^\d+ · /, '')} — ${mission.destination}`;
    missionIndex.append(item);
  }

  function place(model, bounds) {
    const min = new Vector3(...bounds.min);
    const max = new Vector3(...bounds.max);
    model.position.set(-(min.x + max.x) / 2, 9.08 - min.y, -(min.z + max.z) / 2);
    model.traverse((item) => { if (item.isMesh) item.castShadow = item.receiveShadow = true; });
    padRocket.add(model);
    exhaust.bind(model);
    const radius = Math.max(0.7, Math.min(6.8, Math.max(max.x - min.x, max.z - min.z) * 0.44));
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const reach = 9.7 - radius;
      const beam = new Mesh(new BoxGeometry(reach, 0.4, 1.3), supportMetal);
      beam.position.set(Math.cos(angle) * (radius + reach / 2), 8.75, Math.sin(angle) * (radius + reach / 2));
      beam.rotation.y = -angle;
      const shoe = new Mesh(new BoxGeometry(1.65, 0.15, 1.65), supportPaint);
      shoe.position.set(Math.cos(angle) * radius, 9.0, Math.sin(angle) * radius);
      beam.castShadow = shoe.castShadow = true;
      supports.add(beam, shoe);
    }
    currentHeight = max.y - min.y;
    currentWidth = Math.max(max.x - min.x, max.z - min.z);
    const mission = selection === 'designed' ? { title: designed.spec.name, destination: 'Earth orbit' } : missions[selection] ?? customMission;
    missionBrief.textContent = `${mission.title} · ${mission.destination}`;
    document.querySelector('#flight-start').disabled = false;
    for (const [index, arm] of arms.entries()) {
      arm.position.y = 9 + currentHeight * [0.23, 0.48, 0.70, 0.88][index];
      arm.position.y = Math.min(arm.position.y, 121);
      arm.userData.connectedYaw = Math.atan2(arm.position.z, -arm.position.x);
      arm.scale.x = Math.max(0.25, (Math.hypot(arm.position.x, arm.position.z) - radius) / 13);
    }
    info.textContent = `${currentHeight.toLocaleString('en-US', { maximumFractionDigits: 1 })} m`;
    status.textContent = 'Ready on pad';
    status.dataset.ready = 'true';
  }

  async function choose() {
    const token = ++request;
    padRocket.clear();
    for (const part of supports.children) part.geometry.dispose();
    supports.clear();
    status.textContent = 'Loading vehicle…';
    info.textContent = '';
    missionBrief.textContent = '';
    status.dataset.ready = 'false';
    const id = select.value;
    if (inFlight) return;
    document.querySelector('#flight-start').disabled = true;
    selection = id;
    try {
      if (id === 'custom' || id === 'designed' && designed.layout) {
        const craft = customCraft(id === 'designed' ? designed.layout : resumeLayout ?? undefined);
        if (token !== request) return;
        if (!craft) {
          status.textContent = 'Build a rocket first.';
          info.textContent = '';
          return;
        }
        const bounds = new Box3().setFromObject(craft, true);
        place(craft, { min: bounds.min.toArray(), max: bounds.max.toArray() });
      } else {
        const assetId = id === 'designed' ? designed.carrier : id;
        const spec = rockets.find(({ id: key }) => key === assetId);
        if (!cache.has(assetId)) {
          cache.set(assetId, loader.parseAsync(decode(document.getElementById(`rocket-data-${assetId}`).textContent).buffer, '')
            .catch((error) => { cache.delete(assetId); throw error; }));
        }
        const model = await cache.get(assetId);
        if (token !== request) return;
        place(model.scene.clone(true), spec.bounds);
      }
      const blocked = id === 'custom' ? (resumeLayout ? null : validateCustom?.()) : id === 'designed' &&
        designed.checks?.some(check => check.status === 'FAIL') ? 'Resolve failed mission checks.' : null;
      if (blocked) {
        status.textContent = blocked;
        status.dataset.ready = 'false';
        document.querySelector('#flight-start').disabled = true;
      }
      if (id !== 'designed') {
        try { localStorage.setItem(storageKey, selection); } catch { /* The selection is still applied. */ }
      }
    } catch (error) {
      if (token !== request) return;
      console.error(error);
      status.textContent = 'Model unavailable. Select it again.';
    }
  }
  select.addEventListener('change', () => { resumeLayout = null; void choose(); });
  armButton.addEventListener('click', () => {
    armsOut = !armsOut;
    armButton.setAttribute('aria-pressed', String(armsOut));
    armButton.textContent = armsOut ? 'Extend arms' : 'Retract arms';
  });
  document.querySelector('#launch-water').addEventListener('click', (event) => {
    spray.points.visible = !spray.points.visible;
    event.currentTarget.setAttribute('aria-pressed', String(spray.points.visible));
    event.currentTarget.textContent = spray.points.visible ? 'Stop water' : 'Test water';
  });
  document.querySelector('#launch-evening').addEventListener('click', (event) => {
    evening = !evening;
    event.currentTarget.setAttribute('aria-pressed', String(evening));
    event.currentTarget.textContent = evening ? 'Daylight' : 'Dusk';
  });
  const buttons = document.querySelectorAll('[data-launch-view]');
  const labelLayer = document.querySelector('#kennedy-labels');
  const labelSpecs = [
    ['pad39a', 'LC-39A', 148], ['pad39b', 'LC-39B', 186],
    ['vab', 'Assembly Hangar', 166], ['runway', 'Runway', 14],
    ['titusville', 'Titusville', 60],
  ];
  const labels = labelSpecs.map(([id, title, height]) => {
    const element = document.createElement('span');
    element.textContent = title;
    labelLayer.append(element);
    const [x, z] = kennedySites[id];
    return { element, point: new Vector3(x, height, z) };
  });
  const projected = new Vector3();
  let viewId = 'pad';
  function view(id) {
    const base = kennedyCameras[id];
    const height = Math.min(125, Math.max(60, currentHeight));
    const target = [...base.target];
    if (id === 'pad' || id === 'tower') target[1] = 9 + height * 0.38;
    viewId = id;
    fitCamera(base.position, target);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.launchView === id));
  }
  for (const button of buttons) button.addEventListener('click', () => view(button.dataset.launchView));

  return {
    scene, terrainMaps,
    updateLabels(camera) {
      labelLayer.hidden = !active || inFlight || (viewId !== 'overview' && viewId !== 'coast');
      if (labelLayer.hidden) return;
      for (const { element, point } of labels) {
        projected.copy(point).project(camera);
        const { x, y, z } = projected;
        element.hidden = z < -1 || z > 1 || Math.abs(x) > .88 || y < -.9 || y > .73;
        if (element.hidden) continue;
        element.style.left = `${50 + x * 50}%`;
        element.style.top = `${50 - y * 50}%`;
      }
    },
    get flightHeight() { return flightHeight; },
    mountHeight: 9.08,
    render(renderer,camera) {
      prepareClouds(renderer,camera);
      renderer.render(scene,camera);
    },
    renderBackground(renderer, camera) {
      const rocketVisible = padRocket.visible;
      const exhaustVisible = exhaust.root.visible;
      padRocket.visible = exhaust.root.visible = false;
      try {
        prepareClouds(renderer,camera);
        renderer.render(scene, camera);
      } finally {
        padRocket.visible = rocketVisible;
        exhaust.root.visible = exhaustVisible;
      }
    },
    selectDesign(design) {
      designed = structuredClone(design);
      document.querySelector('#launch-flight-length').value = designed.spec.flightLength ?? 'full';
      let option = select.querySelector('option[value="designed"]');
      if (!option) {
        option = new Option('', 'designed');
        select.append(option);
      }
      option.textContent = designed.spec.name;
      select.value = 'designed';
      return choose();
    },
    selectRocket(id, layout = null) {
      if (!rockets.some(rocket => rocket.id === id) && id !== 'custom') throw new Error('Saved vehicle is unavailable.');
      select.value = id;
      resumeLayout = id === 'custom' ? layout : null;
      return choose();
    },
    invalidateAssemblyDesign() {
      if (!designed?.layout) return;
      designed = null;
      select.querySelector('option[value="designed"]')?.remove();
      if (selection === 'designed') {
        select.value = 'custom';
        if (active && !inFlight) void choose();
      }
    },
    snapshotForFlight() {
      const source = padRocket.children[0];
      if (!source || status.dataset.ready !== 'true') return null;
      const model = source.clone(true);
      model.position.set(0, 0, 0);
      model.quaternion.identity();
      return { id: selection, model, design: selection === 'designed' ? structuredClone(designed) : null,
        customLayout: selection === 'custom' ? structuredClone(resumeLayout ?? getCustomLayout?.() ?? []) : null };
    },
    flightTransform() { return { position: padRocket.position.toArray(), quaternion: padRocket.quaternion.toArray() }; },
    prepareFlight() {
      inFlight = true;
      armsOut = true;
      select.disabled = true;
      for (const button of document.querySelectorAll('.launch-controls button, [data-launch-view]')) button.disabled = true;
      armButton.setAttribute('aria-pressed', 'true');
      armButton.textContent = 'Extend arms';
      spray.points.visible = true;
    },
    flightPose(altitude, pitch, power, time, east = 0, south = 0, heading = 0, attitude = null) {
      flightHeight = altitude;
      const center = new Vector3(0, 9.08 + currentHeight * .5, 0);
      if (attitude) padRocket.quaternion.copy(attitude);
      else padRocket.rotation.set(0, MathUtils.degToRad(heading), -MathUtils.degToRad(pitch));
      padRocket.position.set(east, altitude, south).add(center).sub(center.applyQuaternion(padRocket.quaternion));
      exhaust.update(time, power, Math.max(0.7, currentWidth * 0.55), 18 + currentHeight * 0.34);
      smoke.update(time, power);
    },
    flightBackdrop(time) { smoke.update(time, 0); },
    restoreFlight() {
      inFlight = false;
      flightHeight = 0;
      padRocket.position.set(0, 0, 0);
      padRocket.quaternion.identity();
      exhaust.root.visible = false;
      smoke.reset();
      select.disabled = false;
      for (const button of document.querySelectorAll('.launch-controls button, [data-launch-view]')) button.disabled = false;
    },
    setEnabled(value) {
      active = value;
      panel.hidden = !value;
      document.querySelector('#work-area').classList.toggle('launching', value);
      if (value && !inFlight) {
        choose();
        view('pad');
      }
    },
    update(dt) {
      if (!active) return;
      elapsed += dt;
      clouds.uniforms.cloudTime.value = elapsed % 86400;
      armTravel = MathUtils.damp(armTravel, armsOut ? 1 : 0, 3, dt);
      for (const arm of arms) arm.rotation.y = (arm.userData.connectedYaw ?? 0) - armTravel * 1.35;
      if (lift) lift.position.y = 17 + 23 * (1 + Math.sin(elapsed * 0.065));
      skyBlend = MathUtils.damp(skyBlend, evening ? 1 : 0, 2, dt);
      skyMaterial.uniforms.dusk.value = skyBlend;
      const direction = new Vector3(-0.45, MathUtils.lerp(0.8, 0.08, skyBlend), 0.5).normalize();
      skyMaterial.uniforms.sun.value.copy(direction);
      sun.position.copy(direction).multiplyScalar(330);
      sun.intensity = MathUtils.lerp(2.55, 0.65, skyBlend);
      sun.color.setHex(evening ? 0xffb078 : 0xffe4bd);
      ambient.intensity = MathUtils.lerp(1.45, 0.44, skyBlend);
      scene.environmentIntensity = MathUtils.lerp(0.65, 0.27, skyBlend);
      scene.fog.color.copy(dayFog).lerp(eveningFog, skyBlend);
      scene.fog.color.getRGB(skyMaterial.uniforms.fogHorizon.value, SRGBColorSpace);
      for (const light of floodlights) light.intensity = skyBlend * 80;
      if (spray.points.visible) spray.update(elapsed);
    },
  };
}
