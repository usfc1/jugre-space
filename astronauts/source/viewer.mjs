import {
  ACESFilmicToneMapping, AnimationMixer, CircleGeometry, Color, CylinderGeometry,
  DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, PMREMGenerator, RingGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { startRagdoll } from './ragdoll.mjs';

const byId = id => document.getElementById(id);
const options = ['helmet', 'backpack', 'head'];
const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 });
const motionButtons = [...document.querySelectorAll('[data-motion]')];
const deck = document.querySelector('.deck');
const setPressed = (element, value) => element.setAttribute('aria-pressed', String(value));
const hue = value => `#${value.toString(16).padStart(6, '0')}`;

function platform(radius, accent, large) {
  const model = new Group();
  const base = new Mesh(new CylinderGeometry(radius, radius * 1.035, 0.072, 80),
    new MeshStandardMaterial({ color: 0x172736, metalness: 0.33, roughness: 0.50 }));
  base.position.y = -0.037;
  base.receiveShadow = true;
  model.add(base);
  const inlay = new Mesh(new RingGeometry(radius * 0.91, radius * 0.923, 80), new MeshBasicMaterial({
    color: new Color(accent).lerp(new Color(0x7894ad), 0.46), transparent: true, opacity: 0.64,
  }));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.001;
  model.add(inlay);
  if (large) {
    for (const r of [radius + 0.16, radius + 0.28]) {
      const ring = new Mesh(new RingGeometry(r, r + 0.004, 100), new MeshBasicMaterial({
        color: 0x7493a8, transparent: true, opacity: 0.31,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.073;
      model.add(ring);
    }
  }
  return { model, inlay };
}

export async function launch(manifest, bytes) {
  const stage = byId('stage');
  const status = byId('status');
  try {
    await setup(stage, status, manifest, bytes);
  } catch (error) {
    status.hidden = false;
    status.textContent = 'Ошибка 3D-просмотра. Файлы моделей находятся в папке models.';
    console.error(error);
  }
}

async function setup(stage, status, manifest, bytes) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.04, 35);
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  stage.prepend(renderer.domElement);

  const pmrem = new PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = pmrem.fromScene(environment, 0.045).texture;
  scene.environmentIntensity = 0.78;
  scene.environmentRotation.y = -0.43;
  environment.dispose();
  pmrem.dispose();

  const sky = new HemisphereLight(0xebf4ff, 0x526075, 1.12);
  const key = new DirectionalLight(0xfff0dc, 1.75);
  key.position.set(-3.5, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3.8, right: 3.8, top: 3.5, bottom: -3.5, near: 0.3, far: 13 });
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 3;
  const rim = new DirectionalLight(0xb3dfff, 1.58);
  rim.position.set(4, 3.9, -4);
  scene.add(sky, key, rim);

  const ground = new Mesh(new CircleGeometry(4.2, 96),
    new MeshStandardMaterial({ color: 0x162331, roughness: 0.86, transparent: true, opacity: 0.40 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.074;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 0.26;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1.38;
  controls.maxDistance = 18;

  const loader = new GLTFLoader();
  const variants = Object.entries(manifest.suits);
  const load = file => loader.parseAsync(Uint8Array.from(atob(bytes[file]), c => c.charCodeAt(0)).buffer, '');
  const catalog = Object.fromEntries(await Promise.all(variants.map(async ([id, spec]) => {
    const [model, tool] = await Promise.all([load(spec.file), load(spec.accessory.file)]);
    return [id, { spec, model, tool }];
  })));

  for (const [id, { spec, model, tool }] of Object.entries(catalog)) {
    for (const asset of [model, tool]) {
      asset.scene.traverse(node => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
    }
    const button = document.createElement('button');
    button.className = 'suit';
    button.type = 'button';
    button.dataset.suit = id;
    const color = id === 'apollo' ? '#ffc472' : id === 'artemis' ? '#77dadf' : id === 'iss' ? '#91b9ee' : '#ff9862';
    button.style.setProperty('--suit', color);
    button.innerHTML = `<span class="num">${spec.code}</span><span><b>${spec.title}</b><small>${spec.role}</small></span>`;
    byId('suits').append(button);
    for (const name of options) byId(name).add(new Option(name === 'head' ? spec.expression : spec.title, id));
  }

  const stageModel = new Group();
  scene.add(stageModel);
  const mainPlatform = platform(0.92, 0xffc472, true);
  stageModel.add(mainPlatform.model);
  const lineup = new Group();
  const formation = new Group();
  formation.add(lineup);
  scene.add(formation);
  for (const [i, [id]] of variants.entries()) {
    const { spec, model } = catalog[id];
    const stand = new Group();
    stand.position.x = (i - 1.5) * 1.37;
    const figure = model.scene.clone();
    figure.rotation.y = [0.06, -0.27, 0.29, -0.04][i];
    const base = platform(0.56, spec.accent, false);
    stand.add(base.model, figure);
    lineup.add(stand);
  }

  let character, mixer, accessory, simulation;
  let visorAngle = 0;
  let state = {};
  let isLineup = false;
  function frameCamera() {
    if (isLineup) {
      const narrow = camera.aspect < 1.12;
      for (const [i, stand] of lineup.children.entries()) {
        stand.position.set(narrow ? (i % 2 - 0.5) * 1.58 : (i - 1.5) * 1.37,
          narrow && i < 2 ? 0.65 : 0, narrow ? (i < 2 ? -2.0 : 0.48) : 0);
      }
      controls.target.set(0, narrow ? 1.19 : 0.84, narrow ? -0.64 : 0);
      const distance = narrow ? Math.max(5.2, 1.62 / (Math.tan(Math.PI * camera.fov / 360) * camera.aspect))
        : Math.max(4.1, 2.92 / (Math.tan(Math.PI * camera.fov / 360) * camera.aspect));
      camera.position.set(narrow ? 0.12 : 0.18, narrow ? 3.53 : 1.55, distance);
    } else {
      controls.target.set(0, 0.91, 0);
      camera.position.set(1.43, 1.53, 3.51);
    }
    controls.update();
  }

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const wasNarrow = camera.aspect < 1.12;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (isLineup && wasNarrow !== (camera.aspect < 1.12)) frameCamera();
  }
  new ResizeObserver(resize).observe(stage);
  resize();
  frameCamera();

  function showLineup(value) {
    if (value && simulation) spawn();
    isLineup = value;
    deck.classList.toggle('lineup', value);
    setPressed(byId('lineup'), value);
    setPressed(byId('single'), !value);
    stageModel.visible = !value;
    formation.visible = value;
    for (const button of byId('suits').children) setPressed(button, !value && button.dataset.suit === state.id);
    byId('hudMode').textContent = value ? 'STUDIO / 04 CREW' : `STUDIO / ${catalog[state.id].spec.code}`;
    resize();
    frameCamera();
  }

  function replacePart(name, id) {
    const target = character.getObjectByName(name);
    const current = target.getObjectByName(`${name}_geo`);
    const source = catalog[id].model.scene.getObjectByName(`${name}_geo`);
    current.removeFromParent();
    target.add(source.clone());
  }

  function mountAccessory() {
    accessory?.removeFromParent();
    accessory = null;
    if (state.tool) {
      accessory = catalog[state.id].tool.scene.clone();
      character.getObjectByName('grip_L').add(accessory);
    }
    setPressed(byId('tool'), state.tool);
    byId('tool').textContent = state.tool ? 'Убрать инструмент' : 'Взять инструмент';
  }

  function motion(name) {
    state.motion = name;
    mixer.stopAllAction();
    const { model } = catalog[state.id];
    mixer.clipAction(model.animations.find(clip => clip.name === name)).play();
    mixer.update(0);
    for (const button of motionButtons) setPressed(button, button.dataset.motion === name);
  }

  function setLocked(locked) {
    for (const button of [...motionButtons, byId('visor'), byId('tool'), ...options.map(byId)]) button.disabled = locked;
    byId('ragdoll').disabled = locked;
    byId('impact').disabled = locked;
  }

  function spawn() {
    simulation?.dispose();
    simulation = null;
    mixer?.stopAllAction();
    character?.removeFromParent();
    const { model } = catalog[state.id];
    character = model.scene.clone();
    stageModel.add(character);
    mixer = new AnimationMixer(character);
    visorAngle = state.visor ? manifest.mounts.visor.openAngleRad : 0;
    character.getObjectByName('visor').rotation.x = visorAngle;
    for (const name of options) {
      replacePart(name, state[name]);
      if (name === 'helmet') replacePart('visor', state.helmet);
    }
    mountAccessory();
    setLocked(false);
    setPressed(byId('ragdoll'), false);
    setPressed(byId('impact'), false);
    byId('hudMode').textContent = `STUDIO / ${catalog[state.id].spec.code}`;
    motion(state.motion);
  }

  const urls = new Map();
  function fileLink(element, file) {
    if (!urls.has(file)) {
      const data = Uint8Array.from(atob(bytes[file]), c => c.charCodeAt(0));
      urls.set(file, URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' })));
    }
    element.href = urls.get(file);
    element.download = file.split('/').at(-1);
  }

  function select(id) {
    state = { id, helmet: id, backpack: id, head: id, tool: false, visor: false, motion: 'idle' };
    const { spec } = catalog[id];
    for (const field of ['title', 'era', 'role', 'note']) byId(field).textContent = spec[field];
    byId('triangles').textContent = number.format(spec.triangles);
    byId('bodies').textContent = Object.keys(spec.physics.bodies).length;
    byId('height').textContent = `${number.format(spec.bounds.max[1] - spec.bounds.min[1])} м`;
    byId('visor').textContent = 'Поднять визор';
    setPressed(byId('visor'), false);
    byId('tool').title = spec.toolName;
    for (const name of options) byId(name).value = state[name];
    fileLink(byId('modelFile'), spec.file);
    fileLink(byId('toolFile'), spec.accessory.file);
    document.documentElement.style.setProperty('--accent', hue(spec.accent));
    mainPlatform.inlay.material.color.setHex(spec.accent).lerp(new Color(0x7894ad), 0.46);
    for (const button of byId('suits').children) setPressed(button, button.dataset.suit === id);
    spawn();
    if (isLineup) showLineup(false);
  }

  function drop(impact) {
    if (simulation) return;
    const spec = catalog[state.id].spec.physics;
    const bodies = { ...spec.bodies };
    for (const part of ['helmet', 'backpack']) bodies[part] = catalog[state[part]].spec.physics.bodies[part];
    simulation = startRagdoll(scene, character, { ...spec, bodies });
    simulation.kick('torso', [0.31, 0.54, -0.78], [0.8, -0.52, -0.45]);
    if (impact) {
      simulation.detach('helmet', [0.88, 2.4, 0.52], [-1.55, 1.72, -0.58]);
      simulation.detach('backpack', [-1.28, 1.14, -0.76], [1.65, -1.07, 1.68]);
      simulation.detach('forearm_L', [1.32, 1.39, 0.82], [-1.17, 1.10, -2.27]);
      camera.position.sub(controls.target).multiplyScalar(1.22);
      controls.target.y = 0.75;
      camera.position.add(controls.target);
      controls.update();
    }
    byId('hudMode').textContent = impact ? 'IMPACT / 03 JOINTS RELEASED' : `RAGDOLL / ${simulation.count} BODIES`;
    setPressed(byId(impact ? 'impact' : 'ragdoll'), true);
    setLocked(true);
  }

  byId('suits').addEventListener('click', event => {
    const button = event.target.closest('[data-suit]');
    if (button) select(button.dataset.suit);
  });
  byId('single').addEventListener('click', () => showLineup(false));
  byId('lineup').addEventListener('click', () => showLineup(true));
  for (const button of motionButtons) button.addEventListener('click', () => motion(button.dataset.motion));
  for (const name of options) {
    byId(name).addEventListener('change', event => {
      state[name] = event.target.value;
      replacePart(name, state[name]);
      if (name === 'helmet') replacePart('visor', state.helmet);
    });
  }
  byId('visor').addEventListener('click', () => {
    state.visor = !state.visor;
    setPressed(byId('visor'), state.visor);
    byId('visor').textContent = state.visor ? 'Опустить визор' : 'Поднять визор';
  });
  byId('tool').addEventListener('click', () => {
    state.tool = !state.tool;
    mountAccessory();
  });
  byId('ragdoll').addEventListener('click', () => drop(false));
  byId('impact').addEventListener('click', () => drop(true));
  byId('reset').addEventListener('click', () => {
    state.motion = 'idle';
    spawn();
    frameCamera();
  });
  select(variants[0][0]);
  showLineup(false);
  status.hidden = true;

  let lastTime = performance.now();
  renderer.setAnimationLoop(time => {
    const dt = Math.min(Math.max((time - lastTime) / 1000, 0), 0.054);
    lastTime = time;
    if (simulation) {
      simulation.step(dt);
    } else if (!isLineup) {
      mixer.update(dt);
      const target = state.visor ? manifest.mounts.visor.openAngleRad : 0;
      visorAngle += (target - visorAngle) * (1 - Math.exp(-13 * dt));
      character.getObjectByName('visor').rotation.x = visorAngle;
    }
    controls.update();
    renderer.render(scene, camera);
  });
}
