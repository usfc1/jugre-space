import {
  ACESFilmicToneMapping, Box3, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute,
  Group, HemisphereLight, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, Points, PointsMaterial,
  RingGeometry, Scene, SphereGeometry, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { instruments } from './spacecraft-design.mjs';
import { planets } from './mission-planets.mjs';
import { schematicPlanetMap } from './planet-appearance.mjs';

export function createMissionPreview({ canvas, loader, decode, textures, environment, customCraft }) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new Scene();
  scene.background = new Color('#080f19');
  scene.environment = environment;
  scene.add(new HemisphereLight(0xc7e5ff, 0x263548, 2.1));
  const light = new DirectionalLight(0xffead7, 4.3);
  light.position.set(-3, 4, 6);
  scene.add(light);
  const rim = new DirectionalLight(0x599cdd, 2.2);
  rim.position.set(4, 1, -2);
  scene.add(rim);
  const camera = new PerspectiveCamera(32, 1, .01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotateSpeed = .65;
  controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = new Group();
  scene.add(root);
  const coordinates = [];
  for (let i = 0; i < 500; i++) {
    const a = i * 2.39996;
    const y = Math.sin(i * 79.17);
    const radius = Math.sqrt(1 - y * y) * 80;
    coordinates.push(Math.cos(a) * radius, y * 80, Math.sin(a) * radius);
  }
  const stars = new Points(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(coordinates, 3)),
    new PointsMaterial({ color: '#a9bdcf', size: .13, transparent: true, opacity: .55, sizeAttenuation: true }));
  scene.add(stars);
  const cache = new Map();
  const images = new Map();
  let serial = 0;
  let current = null;
  let lastWidth = 0;
  let lastHeight = 0;

  function instrumentModel(id) {
    const item = instruments[id];
    const group = new Group();
    const body = new MeshStandardMaterial({ color: '#d3b476', metalness: .65, roughness: .32 });
    const dark = new MeshStandardMaterial({ color: '#263344', metalness: .75, roughness: .27 });
    const glass = new MeshPhysicalMaterial({ color: '#276c94', metalness: .6, roughness: .08, clearcoat: 1 });
    const housing = new Mesh(new BoxGeometry(.7, .6, .65), body);
    group.add(housing);
    if (item.category === 'optical' || item.category === 'spectra') {
      const tube = new Mesh(new CylinderGeometry(.22, .28, .7, 48), dark);
      tube.rotation.x = Math.PI / 2;
      tube.position.z = .48;
      group.add(tube);
      const lens = new Mesh(new CylinderGeometry(.18, .18, .025, 48), glass);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = .84;
      group.add(lens);
    } else {
      const probe = new Mesh(new CylinderGeometry(.025, .025, item.id === 'mag' ? 1.7 : .7, 16), dark);
      probe.rotation.z = -.8;
      probe.position.set(.4, .3, 0);
      group.add(probe);
      const sensor = new Mesh(new SphereGeometry(.15, 24, 20), dark);
      sensor.position.set(.65, .55, 0);
      group.add(sensor);
    }
    for (const x of [-.26, .26]) {
      const mount = new Mesh(new BoxGeometry(.12, .08, .16), dark);
      mount.position.set(x, -.34, 0);
      group.add(mount);
    }
    group.rotation.set(.12, -.32, -.1);
    return group;
  }

  async function asset(kind, id) {
    const key = `${kind}:${id}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        if (kind === 'body') {
          const texture = textures[id] ? await new TextureLoader().loadAsync(textures[id]) : planets[id] ? schematicPlanetMap(id) : null;
          if (!texture) throw new Error('Planet preview unavailable');
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = 4;
          const material = new MeshStandardMaterial({ map: texture, roughness: .92, metalness: 0 });
          const sphere = new Mesh(new SphereGeometry(1.8, 80, 64), material);
          sphere.rotation.y = id === 'earth' ? -1.05 : .5;
          if (id === 'saturn' && textures.rings) {
            const ringMap = await new TextureLoader().loadAsync(textures.rings);
            ringMap.colorSpace = SRGBColorSpace;
            ringMap.anisotropy = 4;
            const inner = 2.3, outer = 4.3;
            const geometry = new RingGeometry(inner, outer, 160);
            const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
            for (let i = 0; i < position.count; i++) {
              uv.setXY(i, (Math.hypot(position.getX(i), position.getY(i)) - inner) / (outer - inner), .5);
            }
            const rings = new Mesh(geometry, new MeshStandardMaterial({ map: ringMap, side: DoubleSide,
              transparent: true, depthWrite: false, roughness: 1 }));
            rings.rotation.x = Math.PI / 2;
            const planet = new Group();
            sphere.scale.y = .902;
            planet.rotation.set(.38, 0, -.22);
            planet.add(sphere, rings);
            return planet;
          }
          return sphere;
        }
        if (kind === 'instrument') return instrumentModel(id);
        const element = document.getElementById(`${kind === 'rocket' ? 'rocket' : 'flight'}-data-${id}`);
        if (!element) throw new Error('3D model unavailable');
        const data = await loader.parseAsync(decode(element.textContent).buffer, '');
        return data.scene;
      })().catch(error => { cache.delete(key); throw error; }));
    }
    return cache.get(key);
  }

  function frame(model, aspect) {
    aspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    root.clear();
    const copy = model.clone(true);
    copy.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(copy);
    const size = bounds.getSize(new Vector3());
    copy.position.sub(bounds.getCenter(new Vector3()));
    root.add(copy);
    const span = Math.max(size.y, size.x / aspect, size.z / aspect, .1);
    const distance = span / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.3;
    camera.aspect = aspect;
    camera.near = distance / 1000;
    camera.far = Math.max(200, distance * 20);
    camera.position.set(distance * .19, distance * .07, distance);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.minDistance = distance * .6;
    controls.maxDistance = distance * 2;
    controls.update();
  }

  return {
    async image(kind, id) {
      const key = `${kind}:${id}`;
      if (images.has(key)) return images.get(key);
      const model = await asset(kind, id);
      const previous = current;
      frame(model, 1.6);
      renderer.setSize(512, 320, false);
      renderer.render(scene, camera);
      const data = canvas.toDataURL('image/webp', .9);
      images.set(key, data);
      lastWidth = lastHeight = 0;
      if (previous) frame(previous, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      return data;
    },
    async show(kind, id) {
      const request = ++serial;
      const model = await asset(kind, id);
      if (request !== serial) return;
      current = model;
      frame(model, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      lastWidth = lastHeight = 0;
    },
    showAssembly(layout) {
      serial++;
      current = customCraft(layout);
      if (!current) throw new Error('Build unavailable');
      frame(current, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      lastWidth = lastHeight = 0;
    },
    render(dt) {
      if (!current) return;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      if (width !== lastWidth || height !== lastHeight) {
        frame(current, width / height);
        renderer.setSize(width, height, false);
        lastWidth = width;
        lastHeight = height;
      }
      controls.update(dt);
      renderer.render(scene, camera);
    },
  };
}
