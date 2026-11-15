import { Vector3 } from 'three';

// km, km/s, seconds. Universal-variable f/g propagation and zero-revolution
// Lambert, using the same state for position and velocity (NASA/JPL prop2b model).
export const EARTH_GM = 398600.4418;
export const MOON_GM = 4902.800066;
export function stumpff(z) {
  if (Math.abs(z)<1e-5) return {c:.5-z/24+z*z/720-z*z*z/40320,s:1/6-z/120+z*z/5040-z*z*z/362880};
  const x=Math.sqrt(Math.abs(z));
  return z>0 ? {c:(1-Math.cos(x))/z,s:(x-Math.sin(x))/(x*x*x)}
    : {c:(Math.cosh(x)-1)/(-z),s:(Math.sinh(x)-x)/(x*x*x)};
}

export function keplerState(r0, v0, elapsed, mu=EARTH_GM) {
  if(Math.abs(elapsed)<1e-10)return {position:r0.clone(),velocity:v0.clone()};
  if(elapsed<0){const s=keplerState(r0,v0.clone().negate(),-elapsed,mu);s.velocity.negate();return s;}
  const r=r0.length(),sqrtMu=Math.sqrt(mu),radial=r0.dot(v0)/sqrtMu,alpha=2/r-v0.lengthSq()/mu;
  if (!(r > 0 && mu > 0 && Number.isFinite(elapsed) && Number.isFinite(alpha))) throw new Error('Invalid two-body initial state');
  // Removing whole periods improves accuracy when time warp spans many orbits.
  if(alpha>0){const period=2*Math.PI/Math.sqrt(mu*alpha**3);elapsed%=period;}
  const target = sqrtMu * elapsed, curvature = 1 - alpha * r;
  const equation = (x, c, s) => radial * x * x * c + curvature * x * x * x * s + r * x - target;
  const rootAlpha = Math.sqrt(Math.abs(alpha));
  const limit = alpha > 0 ? 2 * Math.PI / rootAlpha : alpha < 0 ? 700 / rootAlpha : Infinity;
  const estimate = target / r;
  let low = 0, high = Math.min(limit, Math.max(estimate, 1));
  if (alpha < 0) high = Math.min(high, Math.max(1, Math.log1p(estimate * rootAlpha) / rootAlpha));
  let bracketed = false;
  for (let i = 0; i < 64; i++) {
    const { c, s } = stumpff(alpha * high * high);
    const value = equation(high, c, s);
    if (!(value < 0)) { bracketed = true; break; }
    low = high;
    high = Math.min(limit, high * 2);
  }
  if (!bracketed) throw new Error('Could not bracket the universal Kepler equation');
  let x = Math.max(low, Math.min(high, estimate)), c, s;
  for (let i = 0; i < 80; i++) {
    const z = alpha * x * x;
    ({ c, s } = stumpff(z));
    const value = equation(x, c, s);
    if (Math.abs(value) <= 8 * Number.EPSILON * target) break;
    if (value < 0) low = x;
    else high = x;
    // The derivative is the propagated radius. Retain the bracket if Newton
    // would leave it or the hyperbolic trial value overflows.
    const radius = x * x * c + radial * x * (1 - z * s) + r * (1 - z * c);
    const next = x - value / radius;
    const candidate = next > low && next < high ? next : low + (high - low) / 2;
    if (candidate === x || candidate === low || candidate === high) {
      if (Number.isFinite(value)) break;
      throw new Error('Universal Kepler equation did not converge');
    }
    if (i === 79) throw new Error('Universal Kepler equation did not converge');
    x = candidate;
  }
  const f=1-x*x/r*c,g=elapsed-x*x*x/sqrtMu*s;
  const position=r0.clone().multiplyScalar(f).addScaledVector(v0,g),radius=position.length();
  const fdot=sqrtMu/(radius*r)*(alpha*x*x*x*s-x),gdot=1-x*x/radius*c;
  return {position,velocity:r0.clone().multiplyScalar(fdot).addScaledVector(v0,gdot)};
}

export function lambertState(start, arrival, seconds, mu=EARTH_GM, longWay=false) {
  const r1=start.length(),r2=arrival.length(),cos=Math.max(-1,Math.min(1,start.dot(arrival)/(r1*r2)));
  const sin=start.clone().cross(arrival).length()/(r1*r2)*(longWay?-1:1);
  const a=sin*Math.sqrt(r1*r2/(1-cos));
  if(Math.abs(a)<1e-7 || seconds<=0)throw new Error('Degenerate Lambert boundary');
  const evaluate=z=>{
    const {c,s}=stumpff(z),y=r1+r2+a*(z*s-1)/Math.sqrt(c);
    if(y<0)return {time:-Infinity,y,c,s};
    return {time:((y/c)**1.5*s+a*Math.sqrt(y))/Math.sqrt(mu),y,c,s};
  };
  let low=-4*Math.PI*Math.PI,high=4*Math.PI*Math.PI-1e-5;
  for(let i=0;i<90;i++){const mid=(low+high)/2;if(evaluate(mid).time>seconds)high=mid;else low=mid;}
  const {y}=evaluate((low+high)/2),f=1-y/r1,g=a*Math.sqrt(y/mu),gdot=1-y/r2;
  const departureVelocity=arrival.clone().addScaledVector(start,-f).divideScalar(g);
  const arrivalVelocity=arrival.clone().multiplyScalar(gdot).sub(start).divideScalar(g);
  if(![...departureVelocity.toArray(),...arrivalVelocity.toArray()].every(Number.isFinite))throw new Error('Lambert did not converge');
  return {departureVelocity,arrivalVelocity};
}

export function orbitShape(position, velocity, mu) {
  const r=position.length(),h=position.clone().cross(velocity),energy=velocity.lengthSq()/2-mu/r;
  const eccentricity=Math.sqrt(Math.max(0,1+2*energy*h.lengthSq()/mu**2));
  return {energy,eccentricity,h,periapsis:h.lengthSq()/(mu*(1+eccentricity)),a:-mu/(2*energy)};
}

export function timeToPeriapsis(position, velocity, mu=MOON_GM) {
  const shape=orbitShape(position,velocity,mu),a=-shape.a;
  if(shape.energy<=0)throw new Error('Lunar approach must be hyperbolic');
  const H=Math.acosh(Math.max(1,(position.length()/a+1)/shape.eccentricity));
  return (shape.eccentricity*Math.sinh(H)-H)/Math.sqrt(mu/a**3);
}

export function integrateBurn(start, velocity, duration, acceleration, mu, step=2) {
  let p=start.clone(),v=velocity.clone(),time=0;
  const samples=[{time,p:p.clone(),v:v.clone()}];
  const force=r=>r.clone().multiplyScalar(-mu/r.length()**3).add(acceleration);
  while(time<duration-1e-9){
    const dt=Math.min(step,duration-time),a1=force(p),v2=v.clone().addScaledVector(a1,dt/2),p2=p.clone().addScaledVector(v,dt/2),a2=force(p2);
    const v3=v.clone().addScaledVector(a2,dt/2),p3=p.clone().addScaledVector(v2,dt/2),a3=force(p3);
    const v4=v.clone().addScaledVector(a3,dt),p4=p.clone().addScaledVector(v3,dt),a4=force(p4);
    p.addScaledVector(v,dt/6).addScaledVector(v2,dt/3).addScaledVector(v3,dt/3).addScaledVector(v4,dt/6);
    v.addScaledVector(a1,dt/6).addScaledVector(a2,dt/3).addScaledVector(a3,dt/3).addScaledVector(a4,dt/6);
    time+=dt;samples.push({time,p:p.clone(),v:v.clone()});
  }
  return {position:p,velocity:v,samples};
}

// Cubic Hermite interpolation of an integrated burn. The reported velocity is
// its analytic derivative, rather than a separate telemetry animation.
export function sampleBurn(samples,time) {
  const index=Math.min(samples.length-2,Math.max(0,Math.floor(time/(samples[1].time||2)))),a=samples[index],b=samples[index+1];
  const dt=b.time-a.time,u=Math.max(0,Math.min(1,(time-a.time)/dt));
  const position=a.p.clone().multiplyScalar(2*u**3-3*u*u+1).addScaledVector(a.v,(u**3-2*u*u+u)*dt)
    .addScaledVector(b.p,-2*u**3+3*u*u).addScaledVector(b.v,(u**3-u*u)*dt);
  const velocity=a.p.clone().multiplyScalar((6*u*u-6*u)/dt).addScaledVector(a.v,3*u*u-4*u+1)
    .addScaledVector(b.p,(-6*u*u+6*u)/dt).addScaledVector(b.v,3*u*u-2*u);
  return {position,velocity};
}
