import {
  ACESFilmicToneMapping, AnimationMixer, Box3, CatmullRomCurve3, Color, DirectionalLight, Fog,
  Group, HemisphereLight, MathUtils, PCFShadowMap, PerspectiveCamera, PMREMGenerator, Scene, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setupBuilder } from './builder.mjs';
import { setupMissionDesigner } from './mission-designer-view.mjs';
import { setupStandardMissionDesigner } from './standard-mission-view.mjs';
import { prepareParts } from './assembly.mjs';
import { clipPose } from './payload-preview.mjs';
import { setupReadyRockets } from './ready-rockets.mjs';
import { kennedyCameras } from './kennedy-layout.mjs';
import { setupLaunchView } from './launch-view.mjs';
import { setupFlightView } from './flight-view.mjs';
import { setupHangarAudio } from './audio-view.mjs';
import { setupVab } from './vab-view.mjs';
import { deckY, defaultRocketBounds, equipmentStand, frameBounds, rocketView } from './vab-layout.mjs';
import { setupEquipmentBench } from './equipment-bench.mjs';
import { setupAssemblyWorkflow } from './assembly-workflow.mjs';
import { decoratePayload, setPayloadDeployment } from './payload-configuration.mjs';
import { partThumbnails } from './part-thumbnails.mjs';
import { readSettings } from './app-settings.mjs';
import { setupMainMenu } from './main-menu.mjs';

const storageKey = 'jugre.assembly-hangar.wordmark';
const viewModes = {
  overview: { position: [28, 16, 38], target: [5, 9, -2], label: 'Hangar' },
  rocket: { label: 'Build' },
  ready: { label: 'Fleet' },
  equipment: { label: 'Payload Lab' },
  launch: { ...kennedyCameras.pad, label: 'Launch Pad' },
};
const rocketDirection = new Vector3(.38, .14, 1);
const profileDirection = new Vector3(.40, .09, 1);
const benchDirection = new Vector3(.64, .39, 1);
const benchBounds = new Box3(new Vector3(...equipmentStand).addScalar(-2.5),
  new Vector3(...equipmentStand).addScalar(2.5));
const meters = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function storedWordmark(defaultText) {
  try {
    return localStorage.getItem(storageKey) || defaultText;
  } catch {
    return defaultText;
  }
}

function updateWordmark(apply, defaultText) {
  const field = document.querySelector('#wordmark');

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
      feedback.textContent = 'Sign saved';
    } catch {
      feedback.textContent = 'Sign updated for this session';
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
  scene.environmentIntensity = .45;
  pmrem.dispose();
  room.dispose();
  scene.add(new HemisphereLight(0xe6f0f7, 0xb2a89a, 1.65));
  const light = (color, intensity, position) => {
    const lamp = new DirectionalLight(color, intensity);
    lamp.position.set(...position);
    scene.add(lamp, lamp.target);
    return lamp;
  };
  const key = light(0xfff1e1, 1.70, [-7, 15, 9]);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = .022;
  key.shadow.bias = -.00014;
  key.shadow.radius = 3;
  light(0xc9e2ff, .75, [8, 9, -11]);
  light(0xe7eefb, .35, [3, 3, 13]);
  const size = new Vector3();
  return (bounds) => {
    bounds.getSize(size);
    const range = Math.max(12, size.length() * .66 + 4);
    bounds.getCenter(key.target.position);
    key.position.copy(key.target.position).addScaledVector(new Vector3(-.48, 1, .60), range);
    Object.assign(key.shadow.camera, { left: -range, right: range, top: range, bottom: -range, near: .1, far: range * 3 });
    key.shadow.camera.updateProjectionMatrix();
  };
}

async function start() {
  const { hangar, launchComplex, scientists, manifest, catalog } = window.hangarData;
  let settingsStorage;
  try { settingsStorage = window.localStorage; } catch { /* Settings remain session-only. */ }
  const initialSettings = readSettings(settingsStorage);
  const canvas = document.querySelector('canvas');
  const viewport = document.querySelector('#viewport');
  const renderer = new WebGLRenderer({ canvas, antialias: initialSettings.antialias });
  const query = new URLSearchParams(location.search);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  const scene = new Scene();
  scene.background = new Color(0x273641);
  scene.fog = new Fog(0x697781, 115, 420);
  const camera = new PerspectiveCamera(48, 1, 0.08, 90);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.13;
  controls.zoomSpeed = 0.65;
  const lightRocket = lightScene(scene, renderer);

  const loader = new GLTFLoader();
  const decode = (bytes) => Uint8Array.fromBase64
    ? Uint8Array.fromBase64(bytes)
    : Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0));
  const parse = (bytes) => loader.parseAsync(decode(bytes).buffer, '');
  const modelFiles = Object.entries(catalog);
  const partClips = new Map();
  const [asset, people, partModels, complex, suits] = await Promise.all([
    parse(hangar), Promise.all(scientists.map(parse)),
    Promise.all(modelFiles.map(async ([id, { glb, clip }]) => {
      const { scene: model, animations } = await parse(glb);
      if (clip) {
        const animation = animations.find(({ name }) => name === clip);
        if (!animation) throw new Error(`Missing ${clip} in ${id}`);
        partClips.set(id, animation);
        clipPose(model, animation)(0);
      }
      return [id, model];
    })),
    parse(launchComplex),
    Promise.all(manifest.flight.astronauts.map(async (spec) => {
      const model = await parse(document.getElementById(`flight-data-${spec.model}`).textContent);
      model.scene.traverse((item) => {
        if (!item.isMesh) return;
        item.castShadow = item.receiveShadow = true;
        for (const material of [item.material].flat()) {
          material.envMap = scene.environment;
          material.envMapIntensity = .55;
        }
      });
      return { ...spec, ...model };
    })),
  ]);
  delete window.hangarData;
  scene.add(asset.scene);
  const vab = setupVab(asset.scene);
  updateWordmark(vab.paintWordmark, manifest.wordmark.default);
  const crew = people.map((npc, index) => {
    npc.scene.traverse((item) => {
      if (item.isMesh) item.castShadow = item.receiveShadow = true;
    });
    return mountScientist(npc, manifest.scientists[index], manifest.locomotionMps);
  });
  for (const person of crew) scene.add(person.character);
  let transition;
  let currentView;
  let paused = false;
  let customBounds = defaultRocketBounds();
  let readyBounds = defaultRocketBounds();
  let focusBounds = customBounds;
  let cameraPreset = 'whole';
  const cameraBar = document.querySelector('#vab-cameras');
  const altitude = document.querySelector('#vab-altitude');
  const altitudeValue = document.querySelector('#vab-altitude-value');
  const zone = document.querySelector('#vab-zone');
  const gate = document.querySelector('#vab-gate');
  const cameraButtons = [...document.querySelectorAll('[data-vab-view]')];
  const atRocket = () => currentView === 'rocket' || currentView === 'ready';
  const activeBounds = () => currentView === 'ready' ? readyBounds : customBounds;

  function moveCamera({ position, target }, immediate = false) {
    if (immediate) {
      transition = undefined;
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      return;
    }
    transition = { start: performance.now(), from: camera.position.clone(), look: controls.target.clone(), position, target };
  }

  function focus(bounds, direction, immediate, fill) {
    focusBounds = bounds;
    const frame = frameBounds(bounds, direction, camera.fov, camera.aspect, fill);
    moveCamera(frame, immediate);
  }

  function markPreset(id) {
    cameraPreset = id;
    for (const button of cameraButtons) button.setAttribute('aria-pressed', String(button.dataset.vabView === id));
  }

  function focusRocket(id, immediate = false) {
    markPreset(id);
    const bounds = rocketView(activeBounds(), id);
    altitude.max = String(Math.max(6, activeBounds().max.y + .8));
    focus(bounds, id === 'whole' ? rocketDirection : profileDirection, immediate, id === 'whole' ? .84 : .71);
  }

  for (const button of cameraButtons) button.addEventListener('click', () => focusRocket(button.dataset.vabView));
  altitude.addEventListener('input', () => {
    transition = undefined;
    markPreset();
    const offset = Number(altitude.value) - controls.target.y;
    controls.target.y += offset;
    camera.position.y += offset;
    focusBounds = activeBounds();
  });
  zone.addEventListener('click', () => selectView(currentView === 'equipment' ? 'rocket' : 'equipment'));
  gate.addEventListener('click', () => {
    const open = gate.getAttribute('aria-pressed') !== 'true';
    gate.setAttribute('aria-pressed', String(open));
    gate.textContent = open ? 'Close doors' : 'Open doors';
    vab.setGate(open);
  });
  const readyRockets = setupReadyRockets({
    scene, rockets: manifest.readyRockets, decode,
    load: (bytes) => loader.parseAsync(bytes.buffer, ''),
    onDisplay(bounds) {
      readyBounds = bounds;
      vab.setRocket(bounds);
      lightRocket(bounds);
      focusRocket(cameraPreset ?? 'whole');
    },
  });
  const specs = prepareParts(Object.fromEntries(modelFiles.map(([id, { glb, ...spec }]) => [id, spec])));
  const models = new Map(partModels);
  let assemblyChanged = () => {};
  const builder = setupBuilder({
    scene, camera, controls, canvas, specs, models, clips: partClips, thumbnails: partThumbnails(models),
    onGrip() { transition = undefined; },
    onPreview(points, bounds) {
      for (const point of points) bounds.expandByPoint(point);
      focus(bounds.expandByScalar(.7), camera.position.clone().sub(controls.target), false, .52);
    },
    onLayout(bounds) {
      customBounds = bounds;
      if (currentView === 'rocket' || currentView === 'overview') {
        vab.setRocket(bounds);
        lightRocket(bounds);
        if (currentView === 'rocket' && cameraPreset) focusRocket(cameraPreset);
        else focusBounds = bounds;
      }
      assemblyChanged();
    },
    onInspect(piece, kind, releaseM = 0) {
      markPreset();
      const bounds = new Box3().setFromObject(piece.visual, true);
      if (releaseM) bounds.expandByPoint(piece.object.localToWorld(new Vector3(-releaseM - .55, 0, 0)));
      const direction = kind === 'bay' ? new Vector3(-1, .17, .76)
        : camera.position.clone().sub(controls.target);
      focus(bounds, direction, false, .55);
    },
    onPreset() { selectView('rocket', true); },
  });
  const bench = setupEquipmentBench({
    scene, specs, models, clips: partClips, camera, canvas,
    loadEagle: async () => (await parse(document.querySelector('#flight-data-eagle').textContent)).scene,
    onFocus(bounds, direction = benchDirection) { lightRocket(bounds); focus(bounds, direction, false, .68); },
    canInstall: (part) => builder.canInstallPayload(part),
    onInstall(part, configuration) {
      selectView('rocket', true);
      builder.stagePayload(part, configuration);
    },
    onEdit(key, configuration) { builder.configurePayload(key, configuration); },
    onApollo() {
      selectView('ready', true);
      readyRockets.select('apollo_11');
    },
  });
  const launch = setupLaunchView({
    complex: complex.scene, rockets: manifest.readyRockets, decode, loader, environment: scene.environment,
    customCraft: layout => builder.snapshotCraft(layout), anisotropy: Math.min(16, renderer.capabilities.getMaxAnisotropy()),
    getCustomLayout: () => builder.getLayout(),
    validateCustom: () => workflow.validate(),
    fitCamera(position, target) {
      camera.position.set(...position);
      controls.target.set(...target);
      controls.update();
    },
  });
  const outdoorRoutes = [
    [[-162, 117], [-150, 117], [-150, 106], [-162, 106]],
    [[134, 17], [144, 17], [144, 6], [134, 6]],
    [[-38, 31], [-28, 31], [-28, 39], [-38, 39]],
    [[-197, 118], [-180, 118], [-180, 125], [-197, 125]],
  ];
  const outdoorCrew = people.map((npc, index) => mountScientist({
    scene: npc.scene.clone(true), animations: npc.animations,
  }, { route: { start: index * 0.14, runOffset: null, points: outdoorRoutes[index] } }, manifest.locomotionMps));
  for (const person of outdoorCrew) {
    person.update(0, 0);
    launch.scene.add(person.character);
  }
  const audio = setupHangarAudio(decode);
  const designer = setupMissionDesigner({ specs, builder, launch, showLaunch: () => selectView('launch', true) });
  const workflow = setupAssemblyWorkflow({
    builder, specs, designer, launch, cameraControls: controls,
    showRocket: () => selectView('rocket', true),
    showEquipment(entry) { bench.edit(entry, workflow.mission.spacecraft); selectView('equipment'); },
    showLaunch: () => selectView('launch', true),
  });
  assemblyChanged = () => { launch.invalidateAssemblyDesign(); designer.assemblyChanged(); };
  const flight = setupFlightView({
    getCustomLayout: () => builder.getLayout(),
    payloadForFlight(entry) {
      const model = models.get(entry.part).clone(true);
      decoratePayload(model, entry.spacecraft);
      if (partClips.has(entry.part)) clipPose(model, partClips.get(entry.part))(1);
      setPayloadDeployment(model, 1);
      return model;
    },
    launch, camera, controls, loader, decode, audio, suits: Object.fromEntries(suits.map(suit => [suit.id, suit])),
    textures: window.flightTextures,
    onDesignTelemetry: designer.renderFlight,
    onStart() {
      document.querySelector('#open-main-menu').hidden = true;
      transition = undefined;
      document.querySelector('.scene-activity').hidden = true;
      document.querySelector('#launch-panel').hidden = true;
      const area = document.querySelector('#work-area');
      area.classList.remove('launching');
      area.classList.add('flying');
      document.querySelectorAll('.shell > header nav button').forEach((button) => { button.disabled = true; });
      document.querySelector('#current-view').textContent = 'Flight';
      document.querySelector('#location-tag').textContent = 'LC-39A';
    },
    onStop() {
      document.querySelector('#open-main-menu').hidden = false;
      document.querySelector('.scene-activity').hidden = false;
      document.querySelector('#work-area').classList.remove('flying');
      document.querySelectorAll('.shell > header nav button').forEach((button) => { button.disabled = false; });
      selectView('launch', true);
    },
  });
  const standard = setupStandardMissionDesigner({
    engineering: designer,
    previewOptions: { specs, loader, decode, textures: window.flightTextures,
      environment: scene.environment, customCraft: layout => builder.snapshotCraft(layout) },
    async startFlight(design) {
      selectView('launch', true);
      await launch.selectDesign(design);
      if (!launch.snapshotForFlight()) throw new Error('Could not prepare the vehicle.');
      await flight.start();
      if (!flight.active) throw new Error('Launch unavailable. Check the vehicle on the pad.');
    },
  });
  delete window.flightTextures;
  if (query.has('vabDebug')) window.vabDebug = {
    scene, camera, controls, renderer, builder, workflow, bench, audio, flight,
    get bounds() { return activeBounds(); },
  };

  function resize() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const framing = currentView === 'rocket' || currentView === 'ready' ? 1.35 : 1;
    const baseFov = flight.active ? 24 : currentView === 'launch' ? 23 : 24;
    camera.fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(baseFov)) * Math.max(1, framing / camera.aspect)));
    camera.updateProjectionMatrix();
    if (atRocket() && cameraPreset) focusRocket(cameraPreset, true);
  }
  new ResizeObserver(resize).observe(viewport);
  resize();

  function selectView(id, immediate = false) {
    if (id !== currentView) {
      document.querySelector('#assembly-settings').open = false;
      document.querySelector('#launch-options').open = false;
    }
    const view = viewModes[id];
    currentView = id;
    const building = id === 'rocket';
    const ready = id === 'ready';
    const outside = id === 'launch';
    const atStand = building || ready;
    builder.setEnabled(building);
    builder.setCraftVisible(!ready);
    if (!ready) vab.setRocket(customBounds);
    controls.minDistance = outside ? 35 : .65;
    controls.maxDistance = outside ? 24000 : 350;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = .03;
    controls.maxPolarAngle = outside ? 1.51 : Math.PI - .03;
    camera.far = outside ? 65000 : 700;
    camera.near = outside ? 0.8 : 0.08;
    controls.enablePan = true;
    launch.setEnabled(outside);
    document.querySelector('#location-tag').textContent = outside ? 'LC-39A' : id === 'equipment' ? 'Workbench' : 'JUGRE';
    document.querySelector('#edit-brand').hidden = outside;
    resize();
    cameraBar.hidden = outside;
    for (const button of cameraButtons) button.hidden = !atStand;
    altitude.parentElement.hidden = !atStand;
    zone.textContent = id === 'equipment' ? 'Back to rocket' : 'Payload Lab';
    if (atStand) {
      vab.setRocket(activeBounds());
      lightRocket(activeBounds());
      focusRocket('whole', immediate);
    } else if (id === 'equipment') {
      focus(benchBounds, benchDirection, immediate);
    } else {
      focusBounds = customBounds;
      moveCamera({ position: new Vector3(...view.position), target: new Vector3(...view.target) }, immediate || outside);
    }
    readyRockets.setEnabled(ready);
    if (id === 'equipment') bench.useMission(workflow.mission.spacecraft);
    bench.setEnabled(id === 'equipment');
    document.querySelectorAll('[data-view]').forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.view === id)));
    document.querySelector('#current-view').textContent = view.label;
  }
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
  controls.addEventListener('start', () => { transition = undefined; markPreset(); });
  selectView(location.hash === '#launch' ? 'launch' : 'rocket', true);
  resize();
  const mainMenu = setupMainMenu({ initial: initialSettings, renderer, controls, audio, flight, selectView, designer, standard, storage: settingsStorage });

  function keepCameraInside() {
    // The inspection camera can cross structural bays. Nearby structures are
    // hidden by setupVab so orbit and pan remain continuous around tall vehicles.
    for (const [axis, lower, upper] of [['x', -180, 180], ['y', .22, 170], ['z', -180, 240]]) {
      camera.position[axis] = MathUtils.clamp(camera.position[axis], lower, upper);
    }
    controls.target.y = MathUtils.clamp(controls.target.y, deckY, 132);
  }

  const play = document.querySelector('#pause');
  play.addEventListener('click', () => {
    paused = !paused;
    play.setAttribute('aria-pressed', String(paused));
    play.querySelector('span').textContent = paused ? 'Resume' : 'Pause';
    document.querySelector('#activity').classList.toggle('paused', paused);
  });

  let last = performance.now();
  let elapsed = 0;
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  for (const person of crew) person.update(0, elapsed);
  renderer.setAnimationLoop((now) => {
    const wallDt = Math.max((now - last) / 1000, 0);
    const dt = Math.min(wallDt, 0.08);
    last = now;
    if (mainMenu.visible) return;
    if (!paused) {
      elapsed += dt;
      for (const person of crew) person.update(dt, elapsed);
      if (currentView === 'launch') for (const person of outdoorCrew) person.update(dt, elapsed);
    }
    if (transition) {
      const p = Math.min((now - transition.start) / 560, 1);
      const eased = p * p * (3 - 2 * p);
      camera.position.lerpVectors(transition.from, transition.position, eased);
      controls.target.lerpVectors(transition.look, transition.target, eased);
      if (p === 1) transition = undefined;
    }
    controls.update();
    if (currentView !== 'launch') keepCameraInside();
    camera.updateMatrixWorld();
    if (currentView !== 'launch') {
      vab.update(dt, camera.position, focusBounds, builder.installingLargePart);
      bench.update(dt);
      altitude.value = String(controls.target.y);
      altitudeValue.textContent = meters.format(controls.target.y) + ' m';
    }
    builder.update(dt);
    launch.update(dt);
    launch.updateLabels(camera);
    // FlightState substeps the elapsed time; do not slow its clock at low FPS.
    flight.update(wallDt);
    audio.tick();
    if (!standard.render(dt) && !flight.render(renderer)) {
      if(currentView === 'launch')launch.render(renderer,camera);
      else renderer.render(scene,camera);
    }
  });
  document.querySelector('#loading').hidden = true;
  document.querySelectorAll('.shell nav button, #pause, #edit-brand').forEach((button) => { button.disabled = false; });
}

start().catch((error) => {
  console.error(error);
  document.querySelector('#loading').textContent = 'Could not load the scene. Try a browser with WebGL.';
  document.querySelector('#menu-save-status').textContent = 'Could not initialize the simulator. Check WebGL and restart.';
});
