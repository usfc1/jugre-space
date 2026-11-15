const spectrum = [
  [23.0, .19, .46, .4], [12.5, .12, 2.27, 1.6], [7.2, .072, -.78, 4.4],
  [3.6, .047, 1.53, 2.3], [1.7, .018, -.16, 0],
].map(([length, amplitude, angle, phase]) => {
  const wave = 2 * Math.PI / length;
  return { amplitude, x: Math.cos(angle) * wave, z: Math.sin(angle) * wave, speed: Math.sqrt(9.81 * wave), phase };
});

export function oceanHeight(x, z, time, gradient) {
  let height = 0;
  let dx = 0;
  let dz = 0;
  for (const wave of spectrum) {
    const phase = x * wave.x + z * wave.z - time * wave.speed + wave.phase;
    height += wave.amplitude * Math.sin(phase);
    const slope = wave.amplitude * Math.cos(phase);
    dx += wave.x * slope;
    dz += wave.z * slope;
  }
  gradient?.set(dx, 0, dz);
  return height;
}

const decimal = n => n.toFixed(6);
export const oceanShader = `
  vec3 ocean(vec2 p,float t,vec2 footprint){
    vec3 result=vec3(0.);
    ${spectrum.map(w => `{
      vec2 k=vec2(${decimal(w.x)},${decimal(w.z)});
      float a=dot(p,k)-t*${decimal(w.speed)}+${decimal(w.phase)};
      float bandWeight=1.-smoothstep(.7,3.14,dot(abs(k),footprint));
      result+=${decimal(w.amplitude)}*vec3(sin(a),k*cos(a))*bandWeight;
    }`).join('\n')}
    return result;
  }
  vec3 ocean(vec2 p,float t){return ocean(p,t,vec2(0.));}
`;
