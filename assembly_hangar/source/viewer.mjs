import {
  ACESFilmicToneMapping, AnimationMixer, CanvasTexture, CatmullRomCurve3, Color, DirectionalLight, Fog,
  HemisphereLight, MathUtils, Mesh, MeshBasicMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry,
  PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setupBuilder } from './builder.mjs';
import { prepareParts } from './assembly.mjs';

const storageKey = 'jugre.assembly-hangar.wordmark';
const viewModes = {
  overview: { position: [-8.65, 5.3, 15.25], target: [0.05, 4.25, -7], label: 'Общий вид' },
  rocket: { position: [-4.7, 4.05, 9.9], target: [-0.45, 2.85, -4.42], label: 'Сборка ракеты' },
  crew: { position: [-5.4, 2.65, 11.55], target: [-5.4, 1.45, 3.65], label: 'Сотрудники' },
};

function storedWordmark(defaultText) {
  try {
    return localStorage.getItem(storageKey) || defaultText;
  } catch {
    return defaultText;
  }
}

function updateWordmark(root, defaultText) {
  const baked = [...root.children];
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 408;
  const context = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const overlay = new Mesh(new PlaneGeometry(5.7, 1.45), new MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, toneMapped: false,
  }));
  overlay.position.z = 0.016;
  root.add(overlay);
  const field = document.querySelector('#wordmark');
  function apply(text) {
    const isDefault = text === defaultText;
    for (const item of baked) item.visible = isDefault;
    overlay.visible = !isDefault;
    root.userData.text = text;
    if (isDefault) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '800 294px "Segoe UI", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#e9e2cf';
    context.fillText(text, 800, 204, 1550);
    texture.needsUpdate = true;
  }

  const dialog = document.querySelector('#branding');
  const feedback = document.querySelector('#feedback');
  let text = storedWordmark(defaultText);
  apply(text);
  document.querySelector('#edit-brand').addEventListener('click', () => {
    field.value = text;
    dialog.showModal();
    field.select();
  });
  field.addEventListener('input', () => apply(field.value.trim() || defaultText));
  document.querySelector('#reset-brand').addEventListener('click', () => {
    field.value = defaultText;
    apply(defaultText);
    field.focus();
  });
  document.querySelector('#cancel-brand').addEventListener('click', () => dialog.close());
  document.querySelector('#brand-form').addEventListener('submit', (event) => {
    event.preventDefault();
    text = field.value.trim() || defaultText;
    try {
      localStorage.setItem(storageKey, text);
      feedback.textContent = 'Вывеска сохранена';
    } catch {
      feedback.textContent = 'Вывеска обновлена для этого просмотра';
    }
    dialog.close();
  });
  dialog.addEventListener('close', () => apply(text));
}

function mountScientist(asset, spec, speeds) {
  const route = new CatmullRomCurve3(spec.route.points.map(([x, z]) => new Vector3(x, 0.021, z)), true);
  route.arcLengthDivisions = 500;
  const length = route.getLength();
  const character = asset.scene;
  const mixer = new AnimationMixer(character);
  const actions = Object.fromEntries(asset.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  const position = new Vector3();
  const heading = new Vector3();
  let distance = spec.route.start * length;
  let current = 'walk';
  let speed = speeds.walk;
  actions.walk.play();
  actions.walk.time = spec.route.start * 1.14;
  mixer.update(0);

  return {
    character,
    update(dt, elapsed) {
      const runOffset = spec.route.runOffset;
      const gait = runOffset !== null && (elapsed + runOffset) % 18 < 6 ? 'run' : 'walk';
      if (gait !== current) {
        actions[current].fadeOut(0.21);
        actions[gait].reset().fadeIn(0.21).play();
        current = gait;
      }
      speed = MathUtils.damp(speed, speeds[current], 12, dt);
      distance = (distance + speed * dt) % length;
      route.getPointAt(distance / length, position);
      route.getTangentAt(distance / length, heading);
      character.position.copy(position);
      character.rotation.y = Math.atan2(heading.x, heading.z);
      mixer.update(dt);
    },
  };
}

function lightScene(scene, renderer) {
  const room = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const reflection = pmrem.fromScene(room, 0.03);
  scene.environment = reflection.texture;
  scene.environmentIntensity = 0.52;
  pmrem.dispose();
  room.dispose();
  scene.add(new HemisphereLight(0xe5f1ff, 0xa49b87, 1.75));
  const light = (color, intensity, position) => {
    const lamp = new DirectionalLight(color, intensity);
    lamp.position.set(...position);
    lamp.target.position.set(0, 0, -4);
    scene.add(lamp, lamp.target);
    return lamp;
  };
  const key = light(0xffe8cf, 2.25, [-5.5, 9.6, 3.3]);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -17;
  key.shadow.camera.right = 17;
  key.shadow.camera.top = 15;
  key.shadow.camera.bottom = -15;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 38;
  key.shadow.normalBias = 0.028;
  key.shadow.bias = -0.00015;
  key.shadow.radius = 3.5;
  light(0xb4dfff, 1.06, [7, 8.1, -12.8]);
  light(0xd6e8ff, 0.48, [1, 3.8, 13]);
}

async function start() {
  const { hangar, scientists, manifest, catalog } = window.hangarData;
  const canvas = document.querySelector('canvas');
  const viewport = document.querySelector('#viewport');
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  const scene = new Scene();
  scene.background = new Color(0x192633);
  scene.fog = new Fog(0x596d7c, 24, 58);
  const camera = new PerspectiveCamera(48, 1, 0.08, 90);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.13;
  controls.zoomSpeed = 0.65;
  lightScene(scene, renderer);

  const loader = new GLTFLoader();
  const parse = (bytes) => loader.parseAsync(Uint8Array.fromBase64
    ? Uint8Array.fromBase64(bytes).buffer
    : Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0)).buffer, '');
  const modelFiles = Object.entries(catalog);
  const [asset, people, partModels] = await Promise.all([
    parse(hangar), Promise.all(scientists.map(parse)),
    Promise.all(modelFiles.map(async ([id, { glb }]) => {
      const { scene: model } = await parse(glb);
      return [id, model];
    })),
  ]);
  delete window.hangarData;
  let brand;
  let bakedRocket;
  asset.scene.traverse((item) => {
    const id = item.userData.partId;
    if (id === manifest.wordmark.node) brand = item;
    if (id === manifest.hangar.exampleAssembly) bakedRocket = item;
    if (!item.isMesh) return;
    const group = item.parent?.userData.partId ?? '';
    item.receiveShadow = true;
    item.castShadow = !/floor|roof|wall|us_flag|brand_frame/.test(group);
  });
  if (!brand || !bakedRocket) throw new Error('An expected hangar node is missing');
  bakedRocket.removeFromParent();
  scene.add(asset.scene);
  updateWordmark(brand, manifest.wordmark.default);
  const crew = people.map((npc, index) => {
    npc.scene.traverse((item) => {
      if (item.isMesh) item.castShadow = item.receiveShadow = true;
    });
    return mountScientist(npc, manifest.scientists[index], manifest.locomotionMps);
  });
  for (const person of crew) scene.add(person.character);

  let transition;
  let currentView;
  const specs = prepareParts(Object.fromEntries(modelFiles.map(([id, { glb, ...spec }]) => [id, spec])));
  const builder = setupBuilder({
    scene, camera, controls, canvas, specs, models: new Map(partModels),
    onGrip() { transition = undefined; },
  });

  function resize() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const framing = currentView === 'rocket' ? 1.35 : 1;
    camera.fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(24)) * Math.max(1, framing / camera.aspect)));
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);
  resize();

  function selectView(id, immediate = false) {
    const view = viewModes[id];
    const position = new Vector3(...view.position);
    const target = new Vector3(...view.target);
    currentView = id;
    const building = id === 'rocket';
    builder.setEnabled(building);
    controls.minDistance = 2.8;
    controls.maxDistance = id === 'overview' ? 24.6 : building ? 21 : 12.7;
    controls.minAzimuthAngle = building ? -Infinity : -0.66;
    controls.maxAzimuthAngle = building ? Infinity : 0.66;
    controls.minPolarAngle = building ? 1.04 : 1.37;
    controls.maxPolarAngle = building ? 1.68 : 1.64;
    if (immediate) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
    } else {
      transition = { start: performance.now(), from: camera.position.clone(), look: controls.target.clone(), position, target };
    }
    document.querySelectorAll('[data-view]').forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.view === id)));
    document.querySelector('#current-view').textContent = view.label;
  }
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
  controls.addEventListener('start', () => { transition = undefined; });
  selectView('rocket', true);
  resize();

  const offset = new Vector3();
  function keepCameraInside() {
    offset.copy(camera.position).sub(controls.target);
    let limit = 1;
    for (const [axis, lower, upper] of [['x', -14.3, 14.3], ['y', 0.85, 10.25], ['z', -15.3, 16.6]]) {
      if (camera.position[axis] > upper) limit = Math.min(limit, (upper - controls.target[axis]) / offset[axis]);
      if (camera.position[axis] < lower) limit = Math.min(limit, (lower - controls.target[axis]) / offset[axis]);
    }
    if (limit < 1) camera.position.copy(controls.target).addScaledVector(offset, limit);
  }

  let paused = false;
  const play = document.querySelector('#pause');
  play.addEventListener('click', () => {
    paused = !paused;
    play.setAttribute('aria-pressed', String(paused));
    play.querySelector('span').textContent = paused ? 'Продолжить' : 'Пауза';
    document.querySelector('#crew-status').textContent = paused ? 'Движение на паузе' : '04 сотрудника';
    document.querySelector('#activity').classList.toggle('paused', paused);
  });

  let last = performance.now();
  let elapsed = 0;
  for (const person of crew) person.update(0, elapsed);
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.08);
    last = now;
    if (!paused) {
      elapsed += dt;
      for (const person of crew) person.update(dt, elapsed);
    }
    if (transition) {
      const p = Math.min((now - transition.start) / 560, 1);
      const eased = p * p * (3 - 2 * p);
      camera.position.lerpVectors(transition.from, transition.position, eased);
      controls.target.lerpVectors(transition.look, transition.target, eased);
      if (p === 1) transition = undefined;
    }
    controls.update();
    if (currentView === 'rocket') keepCameraInside();
    camera.updateMatrixWorld();
    builder.update();
    renderer.render(scene, camera);
  });
  document.querySelector('#loading').hidden = true;
  document.querySelectorAll('nav button, #pause, #edit-brand').forEach((button) => { button.disabled = false; });
}

start().catch((error) => {
  console.error(error);
  document.querySelector('#loading').textContent = 'Не удалось открыть 3D-сцену. Перезагрузите страницу в браузере с поддержкой WebGL.';
});
