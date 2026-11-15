import { Matrix3, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, ShaderMaterial, Vector3 } from 'three';
import { planetRadius, TERRAIN_RADIUS } from './planet-terrain.mjs';

// Shared by the curved mesh and the analytic horizon. Detail is filtered by its
// screen footprint so gravel and dune ripples don't shimmer during approach.
const surfaceGLSL = `
  uniform float surfaceMars;uniform float surfaceAir;uniform sampler2D orbitalMap;
  uniform mat3 mapFrame;uniform float surfaceRadius;uniform vec3 surfaceSun;
  float shash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
  float snoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(shash(i),shash(i+vec2(1,0)),f.x),mix(shash(i+vec2(0,1)),shash(i+1.),f.x),f.y);}
  vec2 sphereUV(vec3 n){return vec2((atan(-n.z,n.x)+3.14159265359)/6.28318530718,asin(clamp(n.y,-1.,1.))/3.14159265359+.5);}
  vec3 surfaceColor(vec3 p,vec3 n,float range){
    vec2 q=p.xz;float footprint=max(length(dFdx(q)),length(dFdy(q)));
    float broad=snoise(q*.0031)+.45*snoise(q*.013+17.);
    float grit=(snoise(q*7.3)-.5)*(1.-smoothstep(.035,.24,footprint));
    float dust=snoise(q*.18)+.4*snoise(q*1.7);
    vec3 lunar=mix(vec3(.13,.13,.128),vec3(.29,.29,.282),clamp(broad*.57+dust*.16,0.,1.));
    lunar+=grit*.055;
    float strata=.5+.5*sin(p.y*1.4+snoise(q*.025)*5.);
    float exposed=smoothstep(.06,.42,1.-n.y);
    vec3 sand=mix(vec3(.245,.119,.061),vec3(.46,.278,.141),clamp(broad*.48+dust*.15,0.,1.));
    vec3 rock=mix(vec3(.19,.116,.078),vec3(.37,.238,.153),strata*.4+broad*.3);
    vec3 mars=mix(sand,rock,exposed*.8)+grit*vec3(.065,.045,.025);
    float ripples=sin(q.y*4.8+snoise(q*.15)*5.);
    mars+=ripples*.009*(1.-exposed)*(1.-smoothstep(.08,.7,footprint));
    vec3 normal=normalize(vec3(p.x,surfaceRadius+p.y,p.z));
    vec3 globe=texture2D(orbitalMap,sphereUV(normalize(mapFrame*normal))).rgb;
    return mix(mix(lunar,mars,surfaceMars),globe*.55,smoothstep(20000.,180000.,range));
  }
  vec3 surfaceHaze(vec3 color,float range){
    float haze=(1.-exp(-range/7400.))*surfaceAir*.86;
    return mix(color,vec3(.38,.235,.145),haze);
  }
`;

export function createSurfaceAppearance() {
  const uniforms = {
    surfaceMars: { value: 0 }, surfaceAir: { value: 0 }, orbitalMap: { value: null },
    mapFrame: { value: new Matrix3() }, surfaceRadius: { value: planetRadius.moon },
    surfaceSun: { value: new Vector3() }, surfaceBlend: { value: 0 },
    eye: { value: new Vector3() }, cameraBasis: { value: new Matrix3() },
    height: { value: 0 }, aspect: { value: 1 }, tanFov: { value: .445 },
  };
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 surfacePoint;varying vec3 surfaceNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nsurfacePoint=position;surfaceNormal=normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      `#include <common>\nvarying vec3 surfacePoint;varying vec3 surfaceNormal;uniform float surfaceBlend;\n${surfaceGLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb*=surfaceColor(surfacePoint,normalize(surfaceNormal),length(vViewPosition));
        diffuseColor.a*=surfaceBlend*(1.-smoothstep(${(TERRAIN_RADIUS * .72).toFixed(1)},${TERRAIN_RADIUS.toFixed(1)},length(surfacePoint.xz)));`)
      .replace('#include <opaque_fragment>', `
        outgoingLight=surfaceHaze(outgoingLight,length(vViewPosition));
        #include <opaque_fragment>`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float footprint=max(length(dFdx(surfacePoint.xz)),length(dFdy(surfacePoint.xz)));
        float grain=(snoise(surfacePoint.xz*4.1)*.025+snoise(surfacePoint.xz*23.)*.004)
          *(1.-smoothstep(.03,.35,footprint));
        vec3 sigmaX=dFdx(-vViewPosition),sigmaY=dFdy(-vViewPosition);
        vec3 r1=cross(sigmaY,normal),r2=cross(normal,sigmaX);
        float determinant=dot(sigmaX,r1);
        vec3 gradient=sign(determinant)*(dFdx(grain)*r1+dFdy(grain)*r2);
        normal=normalize(max(abs(determinant),1e-9)*normal-gradient);`);
  };
  material.customProgramCacheKey = () => 'planet-regolith-v1';
  const backdropMaterial = new ShaderMaterial({
    depthTest: false, depthWrite: false, transparent: true, uniforms,
    vertexShader: 'varying vec2 screen;void main(){screen=position.xy;gl_Position=vec4(position.xy,.999999,1.);}',
    fragmentShader: `
      varying vec2 screen;uniform vec3 eye;uniform mat3 cameraBasis;
      uniform float height;uniform float aspect;uniform float tanFov;uniform float surfaceBlend;
      ${surfaceGLSL}
      void main(){
        vec3 ray=normalize(cameraBasis*vec3(screen.x*aspect*tanFov,screen.y*tanFov,-1.));
        float R=surfaceRadius*.001;float h=height*.001;vec3 e=eye*.001;
        // Stable quadratic avoids cancellation near the surface; units are km.
        float b=dot(e,ray)+(R+h)*ray.y;
        float c=h*(2.*R+h)+2.*(R+h)*e.y+dot(e,e);
        float discriminant=b*b-c;float distance=-1.;
        if(discriminant>=0.){float farHit=-b+sqrt(discriminant);if(farHit>0.)distance=c>0.?c/farHit:farHit;}
        float elevation=max(0.,ray.y);
        vec3 color=mix(vec3(.43,.275,.18),vec3(.23,.145,.105),pow(elevation,.42));
        color+=vec3(.12,.18,.26)*pow(max(dot(ray,surfaceSun),0.),32.);
        color=mix(vec3(.0002),color,surfaceMars);
        color+=vec3(4.,3.8,3.4)*smoothstep(.99975,.99985,dot(ray,surfaceSun));
        float alpha=mix(1.,surfaceAir,surfaceMars);
        if(distance>0.){
          vec3 p=(e+ray*distance+vec3(0.,h,0.))*1000.;
          vec3 n=normalize(vec3(p.x,surfaceRadius+p.y,p.z));
          color=surfaceColor(p,n,distance*1000.)*(mix(.035,.12,surfaceMars)+.83*max(dot(n,surfaceSun),0.));
          color=surfaceHaze(color,distance*1000.);alpha=1.;
        }
        gl_FragColor=vec4(color,alpha*surfaceBlend);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const scene = new Scene();
  const backdrop = new Mesh(new PlaneGeometry(2, 2), backdropMaterial);
  backdrop.frustumCulled = false;
  scene.add(backdrop);
  const rotation = new Matrix4();
  return {
    material, scene, uniforms,
    update(camera, frame, body, envelope, halfHeight, sun) {
      uniforms.surfaceMars.value = envelope.body === 'mars' ? 1 : 0;
      uniforms.surfaceAir.value = envelope.air;
      uniforms.surfaceRadius.value = planetRadius[envelope.body];
      uniforms.surfaceBlend.value = envelope.blend;
      uniforms.orbitalMap.value = body.mesh.material.map;
      rotation.makeRotationFromQuaternion(body.mesh.quaternion.clone().invert().multiply(frame));
      uniforms.mapFrame.value.setFromMatrix4(rotation);
      uniforms.surfaceSun.value.copy(sun);
      uniforms.eye.value.copy(camera.position);
      uniforms.cameraBasis.value.setFromMatrix4(camera.matrixWorld);
      uniforms.height.value = envelope.height + halfHeight;
      uniforms.aspect.value = camera.aspect;
      uniforms.tanFov.value = Math.tan(camera.fov * Math.PI / 360);
    },
  };
}
