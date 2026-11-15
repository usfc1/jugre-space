import {
  AnimationMixer, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DodecahedronGeometry,
  Float32BufferAttribute, Group, InstancedMesh, MathUtils, Matrix4, Mesh, MeshStandardMaterial,
  PlaneGeometry, Quaternion, Scene, Vector3,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerrainGeometry, hash, landingEnvelope, roverTrialRocks, terrainMeshHeight } from './planet-terrain.mjs';
import { createSurfaceAppearance } from './planet-surface-material.mjs';
import { SurfacePhysics } from './surface-physics.mjs';

const material = (color) => new MeshStandardMaterial({ color, roughness: 0.93 });
const white = material(0xe8e4d6);
const lunarPace = .7;

function makeRocks(body, terrainGeometry, site = 0) {
  const heightAt = (x, z) => terrainMeshHeight(terrainGeometry, x, z);
  const group = new Group();
  const finish = new MeshStandardMaterial({ color: body === 'mars' ? 0x867363 : 0x8e8b83,
    roughness: 1, vertexColors: true, transparent: true });
  const matrix = new Matrix4(), normal = new Vector3(), orientation = new Quaternion();
  const spin = new Quaternion(), position = new Vector3(), scale = new Vector3();
  const up = new Vector3(0, 1, 0), tint = new Color();
  for (let variant = 0; variant < 3; variant++) {
    const base = new DodecahedronGeometry(1, variant === 0 ? 1 : 2);
    base.deleteAttribute('normal');
    base.deleteAttribute('uv');
    const geometry = mergeVertices(base);
    base.dispose();
    const vertices = geometry.attributes.position, colors = [];
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
      const shape = .81 + hash(Math.round(x * 40) + variant, Math.round(z * 40) + Math.round(y * 40)) * .33;
      vertices.setXYZ(i, x * shape, y * shape, z * shape);
      const value = .65 + hash(Math.round(y * 9) + variant, 4) * .35;
      colors.push(value, value * .98, value * .94);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const rocks = new InstancedMesh(geometry, finish, 680);
    for (let i = 0; i < rocks.count; i++) {
      const seed = i + variant * 997 + site * 7919;
      const angle = hash(seed, 7) * Math.PI * 2;
      const distance = 7 + hash(seed, 19) ** 2 * 1100;
      let x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
      if (x > 5 && x < 13 && z > 3 && z < 8) z += 9;
      const size = .045 + hash(seed, 31) ** 5 * Math.min(1.9, distance * .035);
      const y = heightAt(x, z);
      normal.set(heightAt(x - .2, z) - heightAt(x + .2, z), .4,
        heightAt(x, z - .2) - heightAt(x, z + .2)).normalize();
      orientation.setFromUnitVectors(up, normal).multiply(spin.setFromAxisAngle(up, hash(seed, 43) * Math.PI * 2));
      position.set(x, y + size * .15, z);
      scale.set(size, size * (.45 + hash(seed, 51) * .4), size * (.7 + hash(seed, 67) * .6));
      matrix.compose(position, orientation, scale);
      rocks.setMatrixAt(i, matrix);
      tint.setScalar(.72 + hash(seed, 91) * .42);
      rocks.setColorAt(i, tint);
    }
    rocks.castShadow = rocks.receiveShadow = true;
    group.add(rocks);
  }
  return { group, finish };
}

export function makeLandingGround(apolloSuit) {
  const group = new Group();
  const appearance = createSurfaceAppearance();
  const trialSky = new Scene(); trialSky.background = new Color(0x8fbbce);
  const trialGround = new Group(); trialGround.visible = false; group.add(trialGround);
  const dirt = new Mesh(new PlaneGeometry(250, 250), material(0x88996a)); dirt.rotation.x = -Math.PI / 2; dirt.receiveShadow = true; trialGround.add(dirt);
  const track = new Mesh(new PlaneGeometry(6, 32), material(0x998769));
  track.rotation.x = -Math.PI / 2; track.position.set(0, .005, 8); trialGround.add(track);
  for (const r of roverTrialRocks) {
    const rock = new Mesh(new DodecahedronGeometry(r.radius), material(0x625c50)); rock.scale.y = r.height / r.radius;
    rock.position.set(r.x, r.height * .2, r.z); rock.castShadow = true; trialGround.add(rock);
  }
  const terrains = new Map();
  let envelope = landingEnvelope({ kind: '', altitude: 0 });
  let current;
  let halfHeight = 0;
  function terrain(body, site) {
    const key = body + '-' + site;
    if (!terrains.has(key)) {
      const root = new Group();
      root.visible = false;
      const mesh = new Mesh(buildTerrainGeometry(body, site), appearance.material);
      mesh.name = key + '-continuous-terrain';
      mesh.receiveShadow = true;
      const rocks = makeRocks(body, mesh.geometry, site);
      root.add(mesh, rocks.group);
      group.add(root);
      terrains.set(key, { root, rocks });
    }
    return terrains.get(key);
  }
  const walk = apolloSuit.animations.find(clip => clip.name === 'walk');
  const crew = [
    [[8, 4], [10, 4], [11.5, 4.7], [10.4, 5.2], [8.2, 5.1]],
    [[7.4, 6.8], [6.4, 6.3], [5.9, 4.9], [7.1, 4.4]],
  ].map((points) => {
    const model = apolloSuit.scene.clone(true);
    model.visible = false;
    const mixer = new AnimationMixer(model);
    mixer.clipAction(walk).play();
    const path = new CatmullRomCurve3(points.map(([x, z]) => new Vector3(x, .005, z)), true);
    group.add(model);
    return { model, mixer, path, length: path.getLength() };
  });
  const explorer = crew[0].model;
  const helmet = explorer.getObjectByName('helmet');
  const heading = new Vector3();
  const flag = new Group();
  const pole = new Mesh(new CylinderGeometry(0.026, 0.026, 2.5, 8), white);
  pole.position.y = 1.25;
  flag.add(pole);
  const flagCanvas = document.createElement('canvas');
  flagCanvas.width = 380; flagCanvas.height = 200;
  const c = flagCanvas.getContext('2d');
  for (let i = 0; i < 13; i++) {
    c.fillStyle = i % 2 ? '#f8f5e9' : '#af2f3d';
    c.fillRect(0, i * 200 / 13, 380, 200 / 13 + 1);
  }
  c.fillStyle = '#263765'; c.fillRect(0, 0, 152, 108);
  c.fillStyle = '#f8f5e9';
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) {
    c.fillRect(9 + col * 25 + (row % 2 ? 12 : 0), 8 + row * 11, 4, 4);
  }
  const fabric = new Mesh(new PlaneGeometry(1.4, 0.74), new MeshStandardMaterial({ map: new CanvasTexture(flagCanvas), side: 2, roughness: 1 }));
  fabric.position.set(0.72, 2.08, 0);
  flag.add(fabric);
  flag.position.set(11, 0, 6);
  group.add(flag);
  group.visible = false;
  let lastStep;
  let runtime, surfacePhysics, expedition;
  const markers = new Group(); group.add(markers);
  const markerMeshes = new Map();
  const surfaceModels = new Map();
  return {
    group, explorer, helmet,
    get background() { return envelope.body === 'earth' ? trialSky : appearance.scene; },
    setModels(models) {
      for (const m of surfaceModels.values()) m.removeFromParent(); surfaceModels.clear();
      for (const id of ['perseverance', 'curiosity', 'ingenuity', 'barkhan_4', 'barkhan_6']) if (models.has(id)) {
        const m = models.get(id).clone(true); m.visible = false; group.add(m); surfaceModels.set(id, m);
      }
    },
    setRuntime(value) { runtime = value; surfacePhysics?.dispose(); surfacePhysics = null; expedition = null; },
    physicsStep(state, dt) {
      const e = state.surfaceExpedition; if (!e || !['moonSurface', 'marsSurface'].includes(state.kind)) return;
      if (expedition !== e) {
        surfacePhysics?.dispose(); expedition = e;
        if (runtime) surfacePhysics = new SurfacePhysics(runtime, e);
        for (const m of markerMeshes.values()) { m.geometry.dispose(); m.material.dispose(); } markerMeshes.clear(); markers.clear();
        for (const o of e.objects) {
          const mesh = new Mesh(new DodecahedronGeometry(o.kind === 'sample' ? .16 : .25), material(o.kind === 'sample' ? 0xc3a56a : 0x6adbd4));
          mesh.name = o.title; markers.add(mesh); markerMeshes.set(o.id, mesh);
        }
      }
      if (dt > 0) surfacePhysics?.advance(dt);
    },
    get marsAir() { return envelope.air; },
    get blend() { return envelope.blend; },
    prepareMission(id) {
      if (id === 'apollo_11') terrain('moon', 0);
      if (id === 'mars_2020' || id === 'mars_science_laboratory') terrain('mars', id === 'mars_science_laboratory' ? 1 : 0);
    },
    prepareRender(camera, frame, space, sun) {
      if (!group.visible || envelope.body === 'earth') return;
      const body = space.bodies.find(item => item.name === (envelope.body === 'mars' ? 'Mars' : 'Moon'));
      // The analytic sphere supplies the limb once fully blended. Leaving the
      // coarse orbital sphere underneath exposes its polygon edges at low altitude.
      if (envelope.blend === 1) body.mesh.visible = false;
      appearance.update(camera, frame, body, envelope, halfHeight, sun);
    },
    update(state, vesselHalfHeight, time) {
      envelope = landingEnvelope(state);
      if (state.sceneSurfaceTrial) envelope = { body: 'earth', height: 0, blend: 1, air: 0 };
      halfHeight = vesselHalfHeight;
      group.visible = envelope.blend > 0;
      trialGround.visible = envelope.body === 'earth';
      if (!group.visible) {
        lastStep = undefined;
        return false;
      }
      const site = envelope.body === 'mars' && state.id === 'mars_science_laboratory' ? 1 : 0;
      const next = envelope.body === 'earth' ? null : terrain(envelope.body, site);
      if (current !== next) {
        if (current) current.root.visible = false;
        current = next;
        if (current) current.root.visible = true;
      }
      if (current) current.rocks.finish.opacity = envelope.blend;
      group.position.y = -halfHeight - envelope.height;
      flag.visible = state.kind === 'moonSurface';
      const manualSurface = state.surfaceExpedition && ['moonSurface', 'marsSurface'].includes(state.kind);
      if (manualSurface) {
        const e = state.surfaceExpedition;
        flag.visible = e.objects.find(o => o.id === 'flag')?.done ?? false;
        markers.visible = true;
        for (const o of e.objects) { const m = markerMeshes.get(o.id); if (m) { m.position.set(o.p[0], e.height(o.p[0], o.p[2]) + .25, o.p[2]); m.visible = !o.done; } }
        for (const [i, { model, mixer }] of crew.entries()) {
          const a = e.actors[i]; model.visible = a?.profile === 'astronaut'; if (!model.visible) continue;
          model.position.copy(a.p); model.rotation.set(a.fallen ? Math.PI / 2 : 0, a.yaw, 0);
          mixer.setTime(e.elapsed * (a.v.length() > .05 ? .7 : .05));
        }
        for (const [id, model] of surfaceModels) {
          const a = e.actors.find(a => a.id === id); model.visible = Boolean(a);
          if (a) {
            model.position.copy(a.p);
            if (a.nativeQ) model.quaternion.fromArray(a.nativeQ);
            else model.rotation.set(0, a.yaw, 0);
            let index = 0;
            model.traverse(part => {
              if (/^wheel_[a-z_]+$/.test(part.userData.partId ?? part.name) && !part.isMesh) {
                part.rotation.x = a.nativeWheels?.[index++]?.rotationAngle ?? a.distanceM / .25;
              }
              if ((part.userData.partId ?? part.name) === 'ingenuity' && id === 'perseverance') part.visible = !e.ingenuityDeployed;
            });
            if (id === 'ingenuity') model.visible = e.ingenuityDeployed;
          }
        }
        return false;
      }
      markers.visible = false;
      for (const m of surfaceModels.values()) m.visible = false;
      const walkTime = time * lunarPace;
      for (const [i, { model, mixer, path, length }] of crew.entries()) {
        model.visible = flag.visible;
        if (!model.visible) continue;
        const distance = (walkTime * apolloSuit.walkSpeed / length) % 1;
        path.getPointAt(distance, model.position);
        path.getTangentAt(distance, heading);
        model.rotation.y = Math.atan2(heading.x, heading.z);
        mixer.setTime(walkTime + i * walk.duration / 3);
      }
      if (!flag.visible) {
        lastStep = undefined;
        return false;
      }
      const step = Math.floor(2 * walkTime / walk.duration);
      const contact = lastStep !== undefined && step !== lastStep;
      lastStep = step;
      return contact;
    },
  };
}
