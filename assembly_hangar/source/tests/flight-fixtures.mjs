import { FlightState } from '../flight-missions.mjs';
import { assessVehicle } from '../mission-engineering.mjs';
import { planMission } from '../mission-plan.mjs';
import { planetaryMission, playableLunarExpedition } from '../mission-specification.mjs';

export function coastFixture(kind, type = 'orbit') {
  let state;
  if(kind==='apollo')state=new FlightState('apollo_11');
  else {
    const spec=kind==='moon'?playableLunarExpedition('fixture-moon'):planetaryMission(kind,type,`fixture-${kind}`);
    const carrier='artemis_ii',candidate=assessVehicle(planMission(spec),carrier,new Map());
    state=new FlightState('designed','command',{vehicle:candidate.vehicle,design:{spec,carrier,checks:candidate.checks,cabin:candidate.cabin}});
  }
  state.preflight=state.countdown=0;
  const target=kind==='moon'||kind==='apollo'?'moonTransfer':'planetTransfer';
  for(let i=0;i<500 && state.kind!==target && !state.failed;i++)state.update(60,{},500,()=>false);
  if(state.failed||state.kind!==target)throw new Error(`Coast fixture failed: ${state.failureReason}`);
  if(state.path?.burnDuration)while(state.time<=state.path.burnDuration)state.update(1,{},1);
  if(kind==='apollo'){
    while(state.time<5700)state.advanceCoast(Math.min(600,5700-state.time));
    state.report('payloadSeparated');
    state.report('dock',{target:'eagle'},'apolloTransposition');
  }
  state.paused=false;
  return state;
}
export function checkpoint(state) {
  return {version:1,state:state.serialize(),visual:{staged:true,upperStaged:true,boostersReleased:true,recoverySeconds:0},rigid:null,interior:null};
}
