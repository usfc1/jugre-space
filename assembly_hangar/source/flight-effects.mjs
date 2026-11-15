import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group,
  Mesh, PointLight, Points, ShaderMaterial, MathUtils, Quaternion, Vector3,
} from 'three';
import { activeNozzles } from './engine-nozzles.mjs';
import { WorldSmokeTrail } from './ascent-trail.mjs';

export function makeExhaust() {
  const root = new Group();
  root.visible = false;
  let nozzles = null;
  const shader = new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
    uniforms: { time: { value: 0 }, power: { value: 0 }, vacuum: { value: 0 } },
    vertexShader: `
      varying vec2 uvFlame;
      varying vec3 viewNormal;varying vec3 viewDirection;
      uniform float time;uniform float vacuum;
      void main(){
        uvFlame=uv;
        vec3 p=position;
        float tail=1.-uv.y;
        p.xz*=(1.+tail*(.5+vacuum*1.5))*(1.+tail*.025*sin(uv.y*17.-time*13.+position.x*4.));
        vec4 view=modelViewMatrix*vec4(p,1.);
        viewNormal=normalize(normalMatrix*normal);viewDirection=-view.xyz;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader: `
      varying vec2 uvFlame;varying vec3 viewNormal;varying vec3 viewDirection;
      uniform float time; uniform float power; uniform float vacuum;
      void main(){
        float t=1.-uvFlame.y;
        float edge=pow(abs(dot(normalize(viewNormal),normalize(viewDirection))),.8);
        float flow=.85+.07*sin(t*15.-time*18.+uvFlame.x*9.);
        float alpha=pow(1.-t,1.15)*edge*flow*power*.7;
        alpha*=1.-smoothstep(.72,1.,t);
        vec3 core=vec3(2.1,1.8,1.35);
        vec3 flame=mix(vec3(2.3,.42,.035),vec3(.16,.36,1.35),vacuum);
        vec3 color=mix(core,flame,smoothstep(.02,.48,t));
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const cones = [];
  const geometry = new CylinderGeometry(1, 1, 1, 32, 16, true).translate(0, -0.5, 0);
  function addCone() {
    const cone = new Mesh(geometry, shader);
    root.add(cone);
    cones.push(cone);
  }
  for (let i = 0; i < 5; i++) addCone();
  const glow = new PointLight(0xffad53, 0, 100, 1.2);
  glow.position.y = -3;
  root.add(glow);
  return {
    root,
    get nozzleCount() { return nozzles?.length ?? 0; },
    get clearance() { return nozzles?.reduce((maximum, nozzle) => Math.max(maximum, MathUtils.clamp(nozzle.radius * 13, 2, 36)), 0) ?? 0; },
    bind(model, activeParts = null) {
      nozzles = activeNozzles(model, activeParts);
      while (cones.length < nozzles.length) addCone();
      root.position.set(0, 0, 0);root.quaternion.identity();
      root.visible = false;
    },
    emitterWorld(out) {
      out.set(0, 0, 0);
      for (const nozzle of nozzles ?? []) out.add(nozzle.node.localToWorld(nozzle.point.clone()));
      return nozzles?.length ? out.divideScalar(nozzles.length) : root.getWorldPosition(out);
    },
    update(time, power, width, length, vacuum = 0, engineCount = 5) {
      const count = nozzles ? nozzles.length : engineCount;
      root.visible = power > 0.01 && count > 0;
      if (!root.visible) { glow.intensity = 0; return; }
      shader.uniforms.time.value = time;
      shader.uniforms.power.value = power;
      shader.uniforms.vacuum.value = vacuum;
      root.updateWorldMatrix(true, false);
      const rotation = root.getWorldQuaternion(new Quaternion()).invert();
      const scale = root.getWorldScale(new Vector3());
      const lightCenter = new Vector3();
      for (const [i, cone] of cones.entries()) {
        cone.visible = i < count;
        if (!cone.visible) continue;
        if (nozzles) {
          const { node, point, radius } = nozzles[i];
          node.updateWorldMatrix(true, false);
          cone.position.copy(root.worldToLocal(node.localToWorld(point.clone())));
          cone.quaternion.copy(rotation).multiply(node.getWorldQuaternion(new Quaternion()));
          const engineScale = node.getWorldScale(new Vector3());
          const r = radius * Math.max(Math.abs(engineScale.x / scale.x), Math.abs(engineScale.z / scale.z));
          const plumeLength = MathUtils.clamp(r * (10 + vacuum * 3), 2, 36) * (.7 + .3 * power);
          cone.scale.set(r * .9, plumeLength, r * .9);
          lightCenter.add(cone.position);
          continue;
        }
        const angle = i * Math.PI * 2 / 5;
        cone.position.set(engineCount === 1 ? 0 : Math.cos(angle) * width * 0.31, 0,
          engineCount === 1 ? 0 : Math.sin(angle) * width * 0.31);
        cone.scale.set(width * 0.2, length, width * 0.2);
      }
      if (nozzles) glow.position.copy(lightCenter.divideScalar(count));
      glow.color.setHex(vacuum > .6 ? 0x739fff : 0xffad53);
      glow.intensity = power * 65;
    },
  };
}

function smokeField(count, maxSize) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacity = new Float32Array(count);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('size', new BufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new BufferAttribute(opacity, 1));
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute float size; attribute float alpha; varying float opacity;
      void main(){opacity=alpha;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(size*1060./max(1.,-p.z),1.,${maxSize}.);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `
      varying float opacity;
      void main(){
        vec2 p=gl_PointCoord-.5;
        float billows=sin(p.x*21.+sin(p.y*13.))*sin(p.y*17.+p.x*7.)*.045;
        float a=1.-smoothstep(.09,.5,length(p)+billows);
        float grain=.83+.17*sin(p.x*35.)*sin(p.y*29.);
        vec3 shade=mix(vec3(.48,.51,.52),vec3(.91,.90,.83),clamp(smoothstep(-.28,.41,-p.y)+.14*a,0.,1.));
        gl_FragColor=vec4(shade,a*opacity*grain);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const root = new Points(geometry, material);
  root.frustumCulled = false;
  root.visible = false;
  return {
    root, positions, sizes, opacity,
    show(visible) {
      root.visible = visible > 0;
      geometry.setDrawRange(0, visible);
      geometry.attributes.position.needsUpdate = geometry.attributes.size.needsUpdate = geometry.attributes.alpha.needsUpdate = true;
    },
  };
}

export function makeGroundSmoke() {
  const count = 520;
  const field = smokeField(count, 205);
  const { root, positions, sizes, opacity } = field;
  let ignition = null;
  return {
    root,
    reset() { ignition = null; field.show(0); },
    update(time, power) {
      if (power > 0 && ignition === null) ignition = time;
      if (ignition === null) return;
      const since = time - ignition;
      let visible = 0;
      for (let i = 0; i < count; i++) {
        const seed = i * .61803398875 % 1;
        const bank = i % 2 ? -1 : 1;
        const age = since - (i / count) ** 1.5 * 9;
        if (age < 0 || age > 34) continue;
        const spread = age * (5 + seed * 10);
        const trench = bank * (7 + age * (7 + seed * 3));
        const heading = i * 2.399963;
        const row = visible++;
        positions[row * 3] = Math.cos(heading) * spread * .8 + age * 3.2;
        positions[row * 3 + 1] = 4 + (2.3 + seed * 3.2) * age + Math.sin(i * 8.1) * age * .65;
        positions[row * 3 + 2] = trench + Math.sin(heading) * spread;
        sizes[row] = 5 + seed * 9 + age * (2.1 + seed * 1.4);
        opacity[row] = MathUtils.smoothstep(age, 0, .8) * (1 - MathUtils.smoothstep(age, 11, 34)) * .56;
      }
      field.show(visible);
    },
  };
}

export function makeAscentSmoke() {
  const count = 124;
  const field = smokeField(count, 160);
  const trail = new WorldSmokeTrail(count);
  const offset = new Vector3();
  const nozzleM = new Vector3(), originM = new Vector3();
  return {
    root: field.root,
    reset() { trail.reset(); field.show(0); },
    breakEmission() { trail.last = null; },
    update(time, emit, nozzle, origin, inverseFrame) {
      nozzleM.copy(nozzle).multiplyScalar(1000); originM.copy(origin).multiplyScalar(1000);
      trail.sample(time, emit, nozzleM);
      let visible = 0;
      for (const puff of trail.points) {
        const age = time - puff.time;
        trail.renderPosition(puff, time, originM, inverseFrame, offset);
        if (offset.lengthSq() > 22000 ** 2) continue;
        const row = visible++;
        field.positions[row * 3] = offset.x;
        field.positions[row * 3 + 1] = offset.y;
        field.positions[row * 3 + 2] = offset.z;
        field.sizes[row] = 19 + age * 6.7;
        field.opacity[row] = (.46 + .12 * Math.sin(puff.time * 11)) * (1 - MathUtils.smoothstep(age, 6, 26));
      }
      field.show(visible);
    },
  };
}
