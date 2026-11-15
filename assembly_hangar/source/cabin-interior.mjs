import {
  AnimationMixer, BoxGeometry, CanvasTexture, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight,
  MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Path, Scene, Shape, ShapeGeometry, SRGBColorSpace, TorusGeometry, Vector3,
} from 'three';
import { findPart } from './flight-layout.mjs';
import { InteriorPhysics } from './flight-rigid.mjs';

const surface = (color, roughness = .67, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness });
const panel = surface(0x27313b);
const hull = surface(0xc8cfcb);
const inset = surface(0x8697a0, .77);
const cushion = surface(0x394f5d, .88);
const belt = surface(0xc88742, .69);
const metal = surface(0x7d8994, .4, .45);
const lens = new MeshBasicMaterial({ color: 0x80b6cc, side: DoubleSide, transparent: true, opacity: .10, depthWrite: false });
const lamp = new MeshBasicMaterial({ color: 0xc9edff });
const profiles = {
  apollo_cm: { name: 'COLUMBIA · COMMAND MODULE', size: 1, bottom: .33, seats: 3, display: 'APOLLO / CM', tone: 0xa9b8ab },
  orion_cm: { name: 'ORION · CABIN', size: 1.18, bottom: .24, seats: 4, display: 'ORION / GNC', tone: 0xb7c3ce },
  eagle_ascent: { name: 'EAGLE · ASCENT CABIN', size: .95, bottom: .10, seats: 0, display: 'EAGLE / PGNS', tone: 0x839494 },
  pk_2_kontur: { name: 'CONTOUR · CABIN', size: .70, bottom: .25, seats: 2, display: 'JUGRE / PK-2', tone: 0x92a4aa },
};

function box(parent, finish, size, at, tilt = 0) {
  const item = new Mesh(new BoxGeometry(...size), finish);
  item.position.set(...at);
  item.rotation.x = tilt;
  parent.add(item);
  return item;
}

function display(profile, index) {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 192;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0a1b22'; g.fillRect(0, 0, 384, 192);
  g.fillStyle = '#8ce8d8'; g.font = 'bold 19px monospace'; g.fillText(profile.display, 14, 29);
  g.strokeStyle = '#24525a';
  for (let y = 48; y < 168; y += 20) { g.beginPath(); g.moveTo(15, y); g.lineTo(369, y); g.stroke(); }
  for (let x = 15; x < 369; x += 34) { g.beginPath(); g.moveTo(x, 48); g.lineTo(x, 158); g.stroke(); }
  g.strokeStyle = '#93f0c8'; g.lineWidth = 2; g.beginPath();
  for (let x = 16; x < 369; x += 4) {
    const y = 104 + 19 * Math.sin(x * .022 + index) + 5 * Math.sin(x * .17);
    if (x === 16) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#e1c18c'; g.font = '14px monospace';
  g.fillText(['ATT REF   /   NOMINAL', 'GUIDANCE  /   ACTIVE', 'COMMS     /   READY'][index], 14, 179);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  return new MeshBasicMaterial({ map: texture });
}

function seat(root, x, z) {
  box(root, metal, [.46, .12, .56], [x, .20, z]);
  box(root, cushion, [.43, .11, .48], [x, .31, z]);
  box(root, cushion, [.44, .55, .10], [x, .56, z - .23], -.20);
  box(root, cushion, [.26, .16, .12], [x, .92, z - .29], -.20);
  for (const side of [-1, 1]) {
    box(root, metal, [.037, .58, .04], [x + side * .22, .54, z - .20], -.20);
    box(root, belt, [.033, .49, .018], [x + side * .11, .57, z - .17], -.20);
    box(root, panel, [.045, .057, .31], [x + side * .23, .49, z - .03]);
  }
}

function windowWall(root, profile) {
  const wall = new Shape();
  wall.moveTo(-1.32, 0); wall.lineTo(1.32, 0); wall.lineTo(1.32, 1.78); wall.lineTo(-1.32, 1.78);
  wall.closePath();
  const panes = profile.seats === 4 ? [-.81, -.28, .28, .81] : [-.52, .52];
  for (const x of panes) {
    const w = profile.seats === 4 ? .22 : .44;
    const points = profile.seats === 0 ? [[x-w,.89],[x+w,.89],[x+Math.sign(x)*.30,1.47]]
      : [[x-w,.90],[x+w,.90],[x+w*.87,1.42],[x-w*.87,1.42]];
    const hole = new Path();
    const glass = new Shape();
    for (const [i, [xx, y]] of points.entries()) {
      if (i) { hole.lineTo(xx,y); glass.lineTo(xx,y); }
      else { hole.moveTo(xx,y); glass.moveTo(xx,y); }
      const [nx, ny] = points[(i + 1) % points.length];
      const edge = box(root, panel, [Math.hypot(nx - xx, ny - y) + .035, .044, .074],
        [(xx + nx) / 2, (y + ny) / 2, 1.275]);
      edge.rotation.z = Math.atan2(ny - y, nx - xx);
    }
    hole.closePath(); glass.closePath();
    wall.holes.push(hole);
    const pane = new Mesh(new ShapeGeometry(glass), lens);
    pane.position.z = 1.33;
    root.add(pane);
  }
  const facade = new Mesh(new ShapeGeometry(wall), new MeshStandardMaterial({
    color: profile.tone, roughness: .68, side: DoubleSide,
  }));
  facade.position.z = 1.31;
  root.add(facade);
}

function makeCabin(profile) {
  const root = new Group();
  root.scale.setScalar(profile.size);
  const paint = surface(profile.tone);
  box(root, panel, [2.76, .11, 2.68], [0, -.06, -.04]);
  box(root, hull, [2.62, .12, 2.55], [0, 1.79, -.07]);
  box(root, hull, [2.65, 1.76, .10], [0, .87, -1.36]);
  box(root, metal, [.87, 1.31, .055], [0, .89, -1.29]);
  const rim = new Mesh(new TorusGeometry(.37, .035, 8, 40), metal);
  rim.position.set(0, 1.07, -1.24);
  root.add(rim);
  for (const side of [-1, 1]) {
    box(root, paint, [.12, 1.69, 2.62], [side * 1.34, .86, 0]);
    box(root, panel, [.17, .45, 1.65], [side * 1.23, .36, -.15]);
    for (const z of [-.81, -.28, .25, .78]) {
      box(root, inset, [.07, .40, .45], [side * 1.24, 1.29, z]);
      box(root, metal, [.07, .025, .19], [side * 1.18, 1.28, z]);
    }
    box(root, lamp, [.045, .035, 1.71], [side * .86, 1.70, -.09]);
  }
  windowWall(root, profile);

  box(root, panel, [2.41, .46, .34], [0, .54, 1.02], -.22);
  box(root, cushion, [2.41, .046, .46], [0, .77, .94], -.22);
  for (const [i, x] of [-.75, 0, .75].entries()) {
    box(root, metal, [.57, .31, .052], [x, .62, .83], -.22);
    box(root, display(profile, i), [.49, .24, .014], [x, .64, .796], -.22);
    for (let k = 0; k < 6; k++) {
      box(root, k === 3 ? belt : inset, [.043, .024, .027], [x - .19 + k * .073, .47, .85]);
    }
  }
  for (const x of [-.61, .61]) {
    const stick = new Mesh(new CylinderGeometry(.031, .025, .22, 12), metal);
    stick.position.set(x, .49, .64); stick.rotation.x = -.24;
    root.add(stick);
    box(root, panel, [.082, .084, .07], [x, .61, .61]);
  }
  const positions = profile.seats === 4 ? [[-.6, -.68], [.6, -.68], [-.6, .04], [.6, .04]]
    : profile.seats === 3 ? [[-.63, -.49], [0, -.49], [.63, -.49]]
      : profile.seats === 2 ? [[-.52, -.45], [.52, -.45]] : [];
  for (const [x, z] of positions) seat(root, x, z);
  return root;
}

export function createCabinInteriors(suits) {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xe6f4ff, 0x66696c, 2.4));
  const light = new DirectionalLight(0xffeacb, 2.0);
  light.position.set(.4, 4, 4);
  scene.add(light);
  const cabins = new Map();
  const eye = new Vector3();
  const direction = new Vector3();
  let active;
  let runtime;
  let yaw = .075;
  let pitch = -.035;

  function get(id) {
    if (cabins.has(id)) return cabins.get(id);
    const profile = profiles[id];
    const root = makeCabin(profile);
    root.visible = false;
    const suit = id === 'orion_cm' ? suits.artemis : suits.apollo;
    const crew = suit.scene.clone(true);
    crew.scale.setScalar(id === 'eagle_ascent' ? .82 : .73);
    crew.position.set(.64, id === 'eagle_ascent' ? .01 : .035, id === 'orion_cm' ? .03 : -.37);
    root.add(crew);
    const mixer = new AnimationMixer(crew);
    mixer.clipAction(suit.animations.find(clip => clip.name === (id === 'eagle_ascent' ? 'idle' : 'pilot'))).play();
    const physics = new InteriorPhysics(runtime, root, profile.size);
    for (const [index, position] of [[0, [-.44, 1.32, -.18]], [1, [.16, 1.42, .28]]]) {
      const item = new Mesh(new BoxGeometry(.13, .13, .13), index ? belt : metal);
      item.name = index ? 'Loose instrument' : 'Loose tool';
      physics.addLoose(item, new Vector3(...position));
    }
    const entry = { root, profile, mixer, physics };
    cabins.set(id, entry);
    scene.add(root);
    return entry;
  }
  return {
    scene,
    initializePhysics(value) { this.disposePhysics(); runtime = value; },
    disposePhysics() {
      this.hide();
      for (const entry of cabins.values()) {
        entry.physics.dispose(); entry.root.removeFromParent();
        for (const mesh of entry.root.children.filter(n=>n.isMesh)) {
          mesh.geometry.dispose();
          if (mesh.material.map?.isCanvasTexture) { mesh.material.map.dispose(); mesh.material.dispose(); }
        }
      }
      cabins.clear();
    },
    resetPhysics() { for (const entry of cabins.values()) entry.physics.reset(); },
    physicsStep(dt, motion, visual) {
      const id = Object.keys(profiles).find(key => findPart(visual, key));
      if (id) get(id).physics.advance(dt, motion);
    },
    coast(dt,visual) {
      const id=Object.keys(profiles).find(key=>findPart(visual,key));
      if(id)get(id).physics.coast(dt);
    },
    push() { active?.physics.push(); },
    physicsSnapshot() { return Object.fromEntries([...cabins].map(([id, entry]) => [id, entry.physics.snapshot()])); },
    serializePhysics() { return Object.fromEntries([...cabins].map(([id, entry]) => [id, entry.physics.serialize()])); },
    restorePhysics(saved) { for (const [id, values] of Object.entries(saved ?? {})) if (profiles[id]) get(id).physics.restore(values); },
    get name() { return active?.profile.name; },
    look(dx, dy) {
      yaw = MathUtils.clamp(yaw + dx * .0046, -1.55, 1.55);
      pitch = MathUtils.clamp(pitch + dy * .0046, -.71, .48);
    },
    centerView() { yaw = .075; pitch = -.035; },
    hide() {
      if (active) active.root.visible = false;
      active = undefined;
    },
    pose(visual, preferEagle, camera, controls, padOffset, padRotation) {
      this.hide();
      const keys = preferEagle ? ['eagle_ascent', 'apollo_cm', 'orion_cm', 'pk_2_kontur']
        : ['apollo_cm', 'orion_cm', 'pk_2_kontur', 'eagle_ascent'];
      for (const id of keys) {
        const host = findPart(visual, id);
        if (!host) continue;
        active = get(id);
        const { root, profile } = active;
        host.getWorldQuaternion(root.quaternion);
        host.getWorldPosition(root.position).add(eye.set(0, profile.bottom, 0).applyQuaternion(root.quaternion));
        if (padOffset) {
          root.position.applyQuaternion(padRotation).add(padOffset);
          root.quaternion.premultiply(padRotation);
        }
        root.visible = true;
        root.updateMatrixWorld(true);
        eye.set(-.30, 1.17, -1.19);
        direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        controls.target.copy(root.localToWorld(direction.multiplyScalar(3).add(eye)));
        camera.position.copy(root.localToWorld(eye));
        camera.up.set(0, 1, 0).applyQuaternion(root.quaternion);
        camera.lookAt(controls.target);
        camera.up.set(0, 1, 0);
        return true;
      }
      return false;
    },
    update(dt) { active?.mixer.update(dt); },
  };
}
