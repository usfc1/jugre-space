import {
  AdditiveBlending, BufferGeometry, Color, DirectionalLight, DodecahedronGeometry,
  Float32BufferAttribute, Group, HemisphereLight, InstancedMesh, MathUtils, MeshStandardMaterial,
  Object3D, PerspectiveCamera, Points, Raycaster, Scene, ShaderMaterial, Sprite,
  Vector3,
} from 'three';
import { findPart } from './flight-layout.mjs';
import { starField } from './space-world.mjs';
import { DART_AFTERMATH_TIME, DART_APPROACH_TIME, dartRange } from './dart-course.mjs';

const incoming = new Vector3(0, 0, 1);

// Sample the leading surface of the actual spacecraft, including the ROSA arrays.
// The earliest ray intersection determines the first mesh-to-mesh contact.
export function findDartContact(dart, target, offsetX = -10, offsetY = 8) {
  dart.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const samples = new Map();
  const vertex = new Vector3();
  dart.traverse(mesh => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      const key = `${Math.round(vertex.x / .45)},${Math.round(vertex.y / .45)}`;
      if (!samples.has(key) || samples.get(key).z < vertex.z) samples.set(key, vertex.clone());
    }
  });
  const ray = new Raycaster();
  let contact;
  let first = Infinity;
  for (const sample of samples.values()) {
    ray.set(new Vector3(offsetX + sample.x, offsetY + sample.y, -5000), incoming);
    const hit = ray.intersectObject(target, true)[0];
    if (hit && hit.point.z - sample.z < first) {
      first = hit.point.z - sample.z;
      contact = hit;
    }
  }
  if (!contact) return null;
  const normal = contact.face.normal.clone().transformDirection(contact.object.matrixWorld);
  if (normal.dot(incoming) > 0) normal.negate();
  return { origin: new Vector3(offsetX, offsetY, first), point: contact.point.clone(), normal };
}

export function createDartEncounter(dartModel, binaryModel) {
  const scene = new Scene();
  scene.background = new Color(0x010208);
  const stars = starField();
  scene.add(stars);
  const key = new DirectionalLight(0xfff1df, 3.4);
  key.position.set(-220, 150, -360);
  scene.add(key, new HemisphereLight(0x8094b5, 0x11131a, .48));
  const binary = binaryModel.clone(true);
  const system = new Group();
  system.rotation.y = 1.08;
  system.add(binary);
  scene.add(system);
  system.updateMatrixWorld(true);
  const dimorphos = findPart(binary, 'dimorphos');
  if (!dimorphos) throw new Error('The Dimorphos model is missing');
  system.position.sub(dimorphos.getWorldPosition(new Vector3()));
  system.updateMatrixWorld(true);
  const spacecraft = dartModel.clone(true);
  const contact = findDartContact(spacecraft, dimorphos);
  if (!contact) throw new Error('The DART approach does not intersect Dimorphos');
  scene.add(spacecraft);
  const camera = new PerspectiveCamera(48, 1, .04, 80000);
  const cameraPosition = new Vector3();
  const cameraTarget = new Vector3();
  const sidePosition = contact.origin.clone().add(new Vector3(115, 53, -145));
  const sideTarget = contact.point.clone().add(new Vector3(-7, 0, -7));
  const axisX = new Vector3().crossVectors(contact.normal, new Vector3(0, 1, 0)).normalize();
  const axisY = new Vector3().crossVectors(contact.normal, axisX).normalize();
  let seed = 20220926;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const particles = [];
  for (let i = 0; i < 1040; i++) {
    const angle = random() * Math.PI * 2;
    const speed = 5 + random() ** 2 * 42;
    const spread = .28 + random() * .92;
    const velocity = contact.normal.clone().multiplyScalar(speed)
      .addScaledVector(axisX, Math.cos(angle) * speed * spread)
      .addScaledVector(axisY, Math.sin(angle) * speed * spread);
    particles.push({ velocity, size: .12 + random() ** 3 * 1.5, spin: random() * 6.28,
      offset: new Vector3(random() - .5, random() - .5, random() - .5).multiplyScalar(1.4) });
  }
  const debris = new InstancedMesh(new DodecahedronGeometry(1, 0),
    new MeshStandardMaterial({ color: 0x9c968b, roughness: .97 }), 140);
  debris.frustumCulled = false;
  const dustGeometry = new BufferGeometry();
  const dustPositions = new Float32Array(900 * 3);
  dustGeometry.setAttribute('position', new Float32BufferAttribute(dustPositions, 3));
  const dustMaterial = new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { opacity: { value: .65 } },
    vertexShader: 'void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(1300./max(1.,-p.z),1.,18.);gl_Position=projectionMatrix*p;}',
    fragmentShader: 'uniform float opacity;void main(){float a=1.-smoothstep(.08,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.71,.67,.59,a*opacity);}',
  });
  const dust = new Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  const flash = new Sprite(new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { strength: { value: 0 } },
    vertexShader: 'varying vec2 st;void main(){st=uv;vec4 p=modelViewMatrix*vec4(0.,0.,0.,1.);p.xy+=position.xy*vec2(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz));gl_Position=projectionMatrix*p;}',
    fragmentShader: 'varying vec2 st;uniform float strength;void main(){float r=length(st-.5)*2.;float a=exp(-r*r*9.)*(1.-smoothstep(.4,1.,r))*strength;gl_FragColor=vec4(1.,.89,.66,a);}',
  }));
  flash.position.copy(contact.point).addScaledVector(contact.normal, .8);
  scene.add(debris, dust, flash);
  const transform = new Object3D();
  const particlePosition = new Vector3();
  let replayTime = null;
  let range = dartRange(0);
  let aftermath = false;

  function update(state, dt, onboard) {
    aftermath = state.kind === 'dartAftermath';
    let progress = aftermath ? 1 : state.progress;
    let time = aftermath ? state.time : 0;
    if (replayTime !== null) {
      replayTime += state.paused ? 0 : dt;
      aftermath = replayTime >= 5;
      progress = aftermath ? 1 : 1 - (5 - replayTime) / DART_APPROACH_TIME;
      time = Math.max(0, replayTime - 5);
      if (time >= DART_AFTERMATH_TIME) replayTime = null;
    }
    range = aftermath ? 0 : dartRange(progress);
    spacecraft.position.copy(contact.origin).addScaledVector(incoming, -range);
    const steering = state.objectivesEnabled ? state.historicalOperations?.dart : null;
    if (steering && !aftermath && replayTime === null) { spacecraft.position.x += steering.dispersionM.x; spacecraft.position.y += steering.dispersionM.y; }
    spacecraft.visible = !aftermath;
    debris.visible = dust.visible = flash.visible = aftermath;
    if (aftermath) {
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        particlePosition.copy(contact.point).add(particle.offset).addScaledVector(particle.velocity, time);
        if (i < debris.count) {
          transform.position.copy(particlePosition);
          transform.rotation.set(particle.spin + time * .8, time * .37, particle.spin - time * .52);
          transform.scale.setScalar(particle.size);
          transform.updateMatrix();
          debris.setMatrixAt(i, transform.matrix);
        } else dust.geometry.attributes.position.setXYZ(i - debris.count, particlePosition.x, particlePosition.y, particlePosition.z);
      }
      debris.instanceMatrix.needsUpdate = true;
      dust.geometry.attributes.position.needsUpdate = true;
      dustMaterial.uniforms.opacity.value = .66 * (1 - MathUtils.smoothstep(time, 5, 12));
      flash.material.uniforms.strength.value = 3 * Math.exp(-time * 11);
      flash.scale.setScalar(7 + time * 38);
    }
    if (onboard && !aftermath) {
      camera.position.copy(spacecraft.position).add(new Vector3(-.35, .82, 1.5));
      camera.lookAt(contact.point);
      camera.fov = 32;
    } else {
      const blend = MathUtils.smoothstep(progress, .30, .72);
      cameraPosition.copy(spacecraft.position).add(new Vector3(27, 13, -38)).lerp(sidePosition, blend);
      cameraTarget.copy(spacecraft.position).add(new Vector3(0, 0, 22)).lerp(sideTarget, blend);
      if (aftermath) cameraPosition.addScaledVector(new Vector3(.65, .25, -1), time * 3.5);
      camera.position.copy(cameraPosition);
      camera.lookAt(cameraTarget);
      camera.fov = 48;
    }
  }
  return {
    impactOrigin: contact.origin,
    get range() { return range; },
    get aftermath() { return aftermath; },
    get replaying() { return replayTime !== null; },
    replay() { replayTime = 0; },
    update,
    measureImpact(dispersion) {
      const old = spacecraft.position.clone(); spacecraft.position.set(0, 0, 0);
      const x = contact.origin.x + dispersion.x, y = contact.origin.y + dispersion.y;
      const hit = findDartContact(spacecraft, dimorphos, x, y);
      const primary = findPart(binary, 'didymos');
      const other = primary && findDartContact(spacecraft, primary, x, y);
      spacecraft.position.copy(old);
      return { target: hit && (!other || hit.origin.z < other.origin.z) ? 'dimorphos' : other ? 'didymos' : 'miss',
        missM: Math.hypot(x, y) };
    },
    cubeFrame(state, cameraIndex, aimDeg) {
      if (state.kind !== 'dartAftermath' || !state.historicalOperations?.dart?.impact || !Number.isFinite(aimDeg)) return null;
      // Cinematic time is compressed. Closest approach occurs at +180 MET seconds.
      const passTimeS = state.progress * 360;
      const origin = new Vector3(55000, cameraIndex === 2 ? -5000 : 5000, (passTimeS - 180) * 6100);
      const motion = new Vector3(0, 0, 1);
      const boresight = origin.clone().negate().normalize().applyAxisAngle(new Vector3(0, 1, 0), aimDeg * Math.PI / 180);
      const target = contact.point.clone().sub(origin);
      const errorDeg = boresight.angleTo(target) * 180 / Math.PI;
      if (target.length() > 90000 || errorDeg > 6 || cameraIndex < 0 || cameraIndex > 3) return null;
      return { cameraIndex, frame: true, passTimeS, rangeKm: target.length() / 1000, pointingDeg: errorDeg,
        opposite: cameraIndex === 3 && motion.dot(target) < 0 };
    },
    render(renderer, aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.autoClear = true;
      renderer.render(scene, camera);
    },
    dispose() {
      // Models share cached GLTF buffers. Release only the encounter's generated resources.
      for (const object of [debris, dust, flash, stars]) {
        object.traverse(node => {
          node.geometry?.dispose();
          if (node.material?.map) node.material.map.dispose();
          node.material?.dispose();
        });
      }
    },
  };
}
