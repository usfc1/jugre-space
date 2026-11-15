import {
  Box3, CanvasTexture, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry, Ray, SRGBColorSpace, Vector3,
} from 'three';
import { bridgeClearance, defaultRocketBounds } from './vab-layout.mjs';

function makeSign(node, { width, height, lines }) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = Math.max(64, Math.round(768 * height / width));
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const sign = new Mesh(new PlaneGeometry(width, height), material);
  node.add(sign);
  const paint = (title) => {
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e2e3d7';
    ctx.font = `800 ${Math.min(h * (lines.length > 1 ? .53 : .8), w * .24)}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(title, w / 2, h * (lines.length > 1 ? .41 : .52), w * .95);
    if (lines.length > 1) {
      ctx.fillStyle = '#e1b078';
      ctx.font = `700 ${h * .125}px Consolas, monospace`;
      ctx.fillText(lines[1], w / 2, h * .81, w * .92);
    }
    texture.needsUpdate = true;
  };
  paint(lines[0]);
  return paint;
}

export function setupVab(root) {
  const staticSections = [];
  const movingSections = [];
  const signNodes = [];
  let platform;
  let paintWordmark;
  let gateOpen = false;
  let rocketBounds = defaultRocketBounds();
  let focusBounds;
  let previousFocus;
  let deckScale = 1;
  const previousCamera = new Vector3(Infinity, Infinity, Infinity);
  const ray = new Ray();
  const hit = new Vector3();
  const cameraBox = new Box3();
  const probes = Array.from({ length: 45 }, () => new Vector3());

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const { sign, wordmark, occluder, bridgeSlide, gateSlide, rocketDeck } = object.userData;
    if (sign) signNodes.push({ object, sign, wordmark });
    if (rocketDeck) platform = object;
    if (object.isMesh) object.receiveShadow = true;
    if (!occluder) return;
    const section = { object, bounds: new Box3().setFromObject(object), previousX: object.position.x };
    if (bridgeSlide || gateSlide) {
      Object.assign(section, {
        start: object.position.x, slide: bridgeSlide ?? gateSlide, bridge: !!bridgeSlide,
        baseBounds: section.bounds.clone(), progress: 0,
      });
      movingSections.push(section);
    } else staticSections.push(section);
  });
  for (const { object, sign, wordmark } of signNodes) {
    const paint = makeSign(object, sign);
    if (wordmark) paintWordmark = paint;
  }

  function scan(section, camera) {
    const bounds = section.bounds;
    const exterior = (bounds.min.z > 51 && camera.z > 56) ||
      (bounds.max.z < -18 && camera.z < -22) ||
      (bounds.min.x > 34 && camera.x > 38) ||
      (bounds.max.x < -26 && camera.x < -30);
    if (exterior) {
      section.object.visible = false;
      return;
    }
    cameraBox.copy(bounds).expandByScalar(.38);
    let blocked = cameraBox.containsPoint(camera);
    if (!blocked) {
      ray.origin.copy(camera);
      for (const probe of probes) {
        ray.direction.subVectors(probe, camera);
        const distance = ray.direction.length();
        if (distance < .01) continue;
        ray.direction.divideScalar(distance);
        const intersects = ray.intersectBox(bounds, hit);
        if (intersects && hit.distanceToSquared(camera) < (distance - .025) ** 2) {
          blocked = true;
          break;
        }
      }
    }
    section.object.visible = !blocked;
  }

  return {
    paintWordmark,
    setGate(open) { gateOpen = open; },
    setRocket(bounds) {
      rocketBounds = bounds;
      const x = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
      const z = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
      deckScale = Math.max(1, (Math.hypot(x, z) + .75) / 3.4);
    },
    update(dt, camera, focus, installingLargePart) {
      focusBounds = focus;
      const cameraMoved = !camera.equals(previousCamera) || focusBounds !== previousFocus;
      if (cameraMoved) {
        previousCamera.copy(camera);
        previousFocus = focusBounds;
        let i = 0;
        for (const y of [0, .25, .5, .75, 1]) {
          for (const x of [0, .5, 1]) {
            for (const z of [0, .5, 1]) {
              probes[i++].set(MathUtils.lerp(focus.min.x, focus.max.x, x),
                MathUtils.lerp(focus.min.y, focus.max.y, y), MathUtils.lerp(focus.min.z, focus.max.z, z));
            }
          }
        }
        for (const section of staticSections) scan(section, camera);
      }
      const scale = MathUtils.damp(platform.scale.x, deckScale, 8, dt);
      platform.scale.set(scale, 1, scale);
      for (const section of movingSections) {
        const { object, slide, bridge, start } = section;
        const command = bridge ? installingLargePart ? 1 :
          bridgeClearance(rocketBounds, object.position.y, object.position.z, Math.sign(slide)) : Number(gateOpen);
        section.progress = MathUtils.damp(section.progress, command, bridge ? 7 : 2.1, dt);
        object.position.x = start + slide * section.progress;
        const moved = Math.abs(object.position.x - section.previousX) > .008;
        if (moved) {
          section.previousX = object.position.x;
          section.bounds.copy(section.baseBounds);
          section.bounds.min.x += slide * section.progress;
          section.bounds.max.x += slide * section.progress;
        }
        if (moved || cameraMoved) scan(section, camera);
      }
    },
  };
}
