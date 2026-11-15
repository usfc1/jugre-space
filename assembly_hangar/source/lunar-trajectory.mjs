import { Vector3 } from 'three';
import { EARTH_GM, MOON_GM, integrateBurn, keplerState, lambertState, orbitShape, sampleBurn, timeToPeriapsis } from './orbital-propagator.mjs';

export const LUNAR_TIMING = {
  apollo_11:{ tliGET:2*3600+44*60+16.2,tliBurn:346.83,arrivalGET:75*3600+49*60+50.4,captureBurn:357.5,parkingFallback:2.5*3600,returnCoast:60*3600,extractionDelay:28*60,extractionDuration:3600 },
  artemis_ii:{ tliGET:25*3600,tliBurn:360,arrivalGET:4*86400,captureBurn:0,parkingFallback:24*3600,returnCoast:4*86400,extractionDelay:0,extractionDuration:0 },
};
const sphereOfInfluence=66000;
const transferCache=new Map();

function encounter(start, target, seconds, periapsis, longWay) {
  const inward=target.clone().normalize().negate();
  const side=start.clone().addScaledVector(inward,-start.dot(inward)).normalize();
  const at=b=>{
    const local=inward.clone().multiplyScalar(Math.sqrt(sphereOfInfluence**2-b*b)).addScaledVector(side,b);
    const arrival=target.clone().add(local),transfer=lambertState(start,arrival,seconds,EARTH_GM,longWay);
    const shape=orbitShape(local,transfer.arrivalVelocity,MOON_GM);
    return {local,arrival,...transfer,shape,error:shape.periapsis-periapsis};
  };
  let previous=at(-sphereOfInfluence*.82),candidate=null;
  for(let i=1;i<=64;i++){
    const b=-sphereOfInfluence*.82+sphereOfInfluence*1.64*i/64,current=at(b);
    if(previous.error*current.error<=0){
      let low=b-sphereOfInfluence*1.64/64,high=b,lo=previous;
      for(let j=0;j<55;j++){const mid=(low+high)/2,c=at(mid);if(lo.error*c.error<=0)high=mid;else{low=mid;lo=c;}}
      const c=at((low+high)/2);
      if(c.shape.energy>0 && c.local.dot(c.arrivalVelocity)<0){candidate=c;break;}
    }
    previous=current;
  }
  if(!candidate)throw new Error('Could not target lunar periapsis');
  return {...candidate,moonTime:timeToPeriapsis(candidate.local,candidate.arrivalVelocity)};
}

export function timedEncounter(start,moon,coastSeconds,periapsis,longWay = false) {
  let earthTime=coastSeconds-16*3600,result;
  for(let i=0;i<40;i++){
    result=encounter(start,moon,earthTime,periapsis,longWay);
    const next=coastSeconds-result.moonTime;
    if(next<=3600)throw new Error('Lunar transfer duration is too short');
    if(Math.abs(next-earthTime)<1e-5)break;
    earthTime=(earthTime+next)/2;
  }
  return {...result,earthTime};
}

export function createLunarTransfer(start, velocity, moon, duration, burnDuration=346.83,periapsis=1857.4) {
  const key=JSON.stringify([start.toArray(),velocity.toArray(),moon.toArray(),duration,burnDuration,periapsis]);
  if(transferCache.has(key))return transferCache.get(key);
  const coastSeconds=duration-burnDuration;
  let acceleration=new Vector3(),burn=integrateBurn(start,velocity,burnDuration,acceleration,EARTH_GM),target;
  for(let i=0;i<48;i++){
    target=timedEncounter(burn.position,moon,coastSeconds,periapsis);
    const error=target.departureVelocity.clone().sub(burn.velocity);
    if(error.length()<1e-8)break;
    acceleration.addScaledVector(error,1/burnDuration);
    burn=integrateBurn(start,velocity,burnDuration,acceleration,EARTH_GM);
  }
  target=timedEncounter(burn.position,moon,coastSeconds,periapsis);
  const velocityError=target.departureVelocity.distanceTo(burn.velocity);
  if(velocityError>1e-5)throw new Error(`TLI shooting residual ${velocityError} km/s`);
  const plan={physical:true,model:'patched-conic',duration,burnDuration,earthTime:target.earthTime,moonTime:target.moonTime,
    soiEntryS:burnDuration+target.earthTime,
    injectionDeltaV:acceleration.length()*burnDuration,velocityError,
    isPowered:time=>time<burnDuration,
    sample(time){
      time=Math.max(0,Math.min(duration,time));
      if(time<burnDuration)return {...sampleBurn(burn.samples,time),proper:acceleration.clone(),reference:'earth'};
      const t=time-burnDuration;
      if(time<plan.soiEntryS)return {...keplerState(burn.position,target.departureVelocity,t),proper:new Vector3(),reference:'earth'};
      const s=keplerState(target.local,target.arrivalVelocity,t-target.earthTime,MOON_GM);
      s.position.add(moon);return {...s,proper:new Vector3(),reference:'moon'};
    },
  };
  transferCache.set(key,plan);if(transferCache.size>16)transferCache.delete(transferCache.keys().next().value);
  return plan;
}

export function createLunarOrbit(start, velocity, moon, captureDuration=357.5) {
  const r0=start.clone().sub(moon),normal=r0.clone().cross(velocity).normalize();
  let acceleration=new Vector3(),burn=integrateBurn(r0,velocity,captureDuration,acceleration,MOON_GM);
  for(let i=0;i<20;i++){
    const desired=new Vector3().crossVectors(normal,burn.position).normalize().multiplyScalar(Math.sqrt(MOON_GM/burn.position.length()));
    const error=desired.sub(burn.velocity);if(error.length()<1e-9)break;
    acceleration.addScaledVector(error,1/captureDuration);burn=integrateBurn(r0,velocity,captureDuration,acceleration,MOON_GM);
  }
  return {physical:true,model:'lunar-kepler',burnDuration:captureDuration,isPowered:t=>t<captureDuration,
    sample(time){const s=time<captureDuration?sampleBurn(burn.samples,time):keplerState(burn.position,burn.velocity,time-captureDuration,MOON_GM);s.position.add(moon);return {...s,proper:time<captureDuration?acceleration.clone():new Vector3(),reference:'moon'};}};
}

export function createEarthReturn(start,velocity,arrival,duration,burnDuration=150) {
  let acceleration=new Vector3(),burn=integrateBurn(start,velocity,burnDuration,acceleration,EARTH_GM),transfer;
  for(let i=0;i<18;i++){
    transfer=lambertState(burn.position,arrival,duration-burnDuration);
    const error=transfer.departureVelocity.clone().sub(burn.velocity);if(error.length()<1e-9)break;
    acceleration.addScaledVector(error,1/burnDuration);burn=integrateBurn(start,velocity,burnDuration,acceleration,EARTH_GM);
  }
  transfer=lambertState(burn.position,arrival,duration-burnDuration);
  return {physical:true,model:'earth-kepler',burnDuration,isPowered:t=>t<burnDuration,
    sample(time){return time<burnDuration?{...sampleBurn(burn.samples,time),proper:acceleration.clone(),reference:'earth'}
      : {...keplerState(burn.position,transfer.departureVelocity,time-burnDuration),proper:new Vector3(),reference:'earth'};}};
}

export function createLunarEntryReturn(start, velocity, duration, burnDuration = 150) {
  const radial = start.clone().normalize();
  const normal = start.clone().cross(velocity).normalize();
  if (!normal.lengthSq()) throw new Error('Return plane unavailable');
  const test = angle => {
    const point = radial.clone().applyAxisAngle(normal, angle).multiplyScalar(6491);
    const path = createEarthReturn(start, velocity, point, duration, burnDuration);
    const end = path.sample(duration);
    const gamma = Math.asin(end.velocity.dot(end.position.clone().normalize()) / end.velocity.length()) * 180 / Math.PI;
    return { path, gamma, angle };
  };
  let nearest = null, previous = null, bracket;
  for (let i = 0; i <= 16; i++) {
    const angle = -Math.PI + .005 + i * (2 * Math.PI - .01) / 16;
    try {
      const result = test(angle);
      if (!nearest || Math.abs(result.gamma + 5.9) < Math.abs(nearest.gamma + 5.9)) nearest = result;
      if (previous && Math.abs(previous.gamma - result.gamma) < 45 && (previous.gamma + 5.9) * (result.gamma + 5.9) < 0) {
        bracket = [previous, result]; break;
      }
      previous = result;
    } catch { previous = null; }
  }
  if (bracket) {
    let [lo, hi] = bracket;
    for (let i = 0; i < 14; i++) {
      const current = test((lo.angle + hi.angle) / 2);
      nearest = current;
      if ((lo.gamma + 5.9) * (current.gamma + 5.9) <= 0) hi = current;
      else lo = current;
    }
  }
  if (!nearest || nearest.gamma < -6.7 || nearest.gamma > -5.2) throw new Error('Return outside entry corridor');
  return nearest.path;
}
