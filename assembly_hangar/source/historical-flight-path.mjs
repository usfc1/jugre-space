import { Vector3 } from 'three';
import { ephemerisPosition, ephemerisVelocity } from './planet-ephemeris.mjs';
import { keplerState, lambertState } from './orbital-propagator.mjs';
import { SUN_GM, planets } from './mission-planets.mjs';
import { earthDeparture } from './earth-departure.mjs';
import { surfaceToInertialVelocity } from './flight-coordinates.mjs';

const cache = new Map();
export const solarHistoricalKinds = new Set(['marsTransfer','jupiterTransfer','saturnTransfer','asteroidTransfer','dartRelease','dartCruise']);
export function historicalBody(state, id, seconds = state.totalTime) {
  const epoch=Date.parse(state.mission.history.launchUtc);
  if(id==='sun')return ephemerisPosition('earth',epoch).negate();
  return ephemerisPosition(id,epoch+seconds*1000).sub(ephemerisPosition('earth',epoch));
}
export function historicalSolarPath(state, kind) {
  const history=state.mission.history;
  const epoch=Date.parse(history.launchUtc),origin=ephemerisPosition('earth',epoch);
  const targetId=kind.startsWith('mars')?'mars':kind.startsWith('jupiter')?'jupiter':kind.startsWith('saturn')?'saturn':null;
  if(state.id==='dart' && state.historicalCoast) {
    const stored=state.historicalCoast;
    return solarPath(state,stored.start,stored.velocity,origin,stored.startGET,stored.duration,true);
  }
  const endGET=state.phase.endGET;
  const endEpoch=epoch+(state.id==='dart'?(Date.parse(history.endUtc)-epoch)/1000:endGET)*1000;
  let target;
  if(targetId) {
    target=ephemerisPosition(targetId,endEpoch);
    const range=targetId==='mars'?3389.5+125:targetId==='jupiter'?645000:101000;
    target.addScaledVector(target.clone().normalize(),range);
  } else {
    // Reference impact distance only; asteroid geometry is approximate.
    target=ephemerisPosition('earth',endEpoch).addScaledVector(new Vector3(.84,.13,-.527).normalize(),11e6);
    state.dartImpactOrigin.copy(target).sub(origin);
  }
  const start=state.position.clone().add(origin);
  const duration=(endEpoch-(epoch+state.phaseStartTime*1000))/1000;
  const key=JSON.stringify([start.toArray(),target.toArray(),duration]);
  let solution=cache.get(key);
  if(!solution){solution=lambertState(start,target,duration,SUN_GM,start.clone().cross(target).y<0);cache.set(key,solution);if(cache.size>24)cache.delete(cache.keys().next().value);}
  if(state.id==='dart')state.historicalCoast={start:start.toArray(),velocity:solution.departureVelocity.toArray(),startGET:state.phaseStartTime,duration};
  return solarPath(state,start.toArray(),solution.departureVelocity.toArray(),origin,state.phaseStartTime,duration,kind!=='saturnTransfer');
}
function solarPath(state,start,velocity,origin,departureTime,duration,fromEarth) {
  const r=new Vector3().fromArray(start),v=new Vector3().fromArray(velocity);
  const offset=state.phaseStartTime-departureTime;
  const solar=time=>{const sample=keplerState(r,v,time,SUN_GM);sample.position.sub(origin);return sample;};
  const earth=time=>historicalBody(state,'earth',departureTime+time);
  const departureEpoch=Date.parse(state.mission.history.launchUtc)+departureTime*1000;
  const sampleRoute=fromEarth ? earthDeparture(r.clone().sub(origin).sub(earth(0)),
    v.clone().sub(ephemerisVelocity('earth',departureEpoch)),duration,earth,solar,
    surfaceToInertialVelocity(state.launch.positionM, state.launch.velocityMps)) : solar;
  return {physical:true,model:'historical-solar-reconstruction',burnDuration:0,duration,isPowered:()=>false,
    departureExcessMps: fromEarth ? v.clone().sub(ephemerisVelocity('earth', departureEpoch)).length() * 1000 : null,
    sample(time){const s=sampleRoute(Math.max(0,Math.min(duration,offset+time)));
      return {...s,proper:new Vector3(),reference:s.center?'earth':'sun',solarOrigin:origin};}};
}
export function historicalFlybyPath(state,id) {
  const epoch=Date.parse(state.mission.history.launchUtc)+state.phaseStartTime*1000;
  const center=historicalBody(state,id,state.phaseStartTime),local=state.position.clone().sub(center);
  const excess=state.segmentVelocity.clone().sub(ephemerisVelocity(id,epoch));
  // Patched-conic closest-approach reference: gravitational focusing changes
  // the heliocentric excess speed to the local hyperbolic periapsis speed.
  const radial=local.clone().normalize();
  const tangent=excess.clone().addScaledVector(radial,-excess.dot(radial)).normalize();
  const velocity=tangent.multiplyScalar(Math.sqrt(excess.lengthSq()+2*planets[id].mu/local.length()));
  return {physical:true,model:'historical-planet-kepler',burnDuration:0,isPowered:()=>false,
    sample(time){const c=historicalBody(state,id,state.phaseStartTime+time),cv=ephemerisVelocity(id,epoch+time*1000);
      const s=keplerState(local,velocity,time,planets[id].mu);s.position.add(c);s.velocity.add(cv);
      return {...s,proper:new Vector3(),reference:id,center:c,centerVelocity:cv};}};
}
