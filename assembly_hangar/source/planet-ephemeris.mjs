import { Vector3 } from 'three';
// JPL approximate Keplerian elements, table 2 (3000 BC–3000 AD).
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
// UTC approximates TDB; these are low-precision reference positions, not Horizons.
const AU = 149597870.7, rad = Math.PI / 180;
const elements = {
  mercury: [[.38709843,.20563661,7.00559432,252.25166724,77.45771895,48.33961819],[0,.00002123,-.00590158,149472.67486623,.15940013,-.12214182]],
  venus: [[.72332102,.00676399,3.39777545,181.97970850,131.76755713,76.67261496],[-.00000026,-.00005107,.00043494,58517.81560260,.05679648,-.27274174]],
  earth: [[1.00000018,.01673163,-.00054346,100.46691572,102.93005885,-5.11260389],[-.00000003,-.00003661,-.01337178,35999.37306329,.31795260,-.24123856]],
  mars: [[1.52371243,.09336511,1.85181869,-4.56813164,-23.91744784,49.71320984],[.00000097,.00009149,-.00724757,19140.29934243,.45223625,-.26852431]],
  jupiter: [[5.20248019,.04853590,1.29861416,34.33479152,14.27495244,100.29282654],[-.00002864,.00018026,-.00322699,3034.90371757,.18199196,.13024619],[-.00012452,.06064060,-.35635438,38.35125]],
  saturn: [[9.54149883,.05550825,2.49424102,50.07571329,92.86136063,113.63998702],[-.00003065,-.00032044,.00451969,1222.11494724,.54179478,-.25015002],[.00025899,-.13434469,.87320147,38.35125]],
  uranus: [[19.18797948,.04685740,.77298127,314.20276625,172.43404441,73.96250215],[-.00020455,-.00001550,-.00180155,428.49512595,.09266985,.05739699],[.00058331,-.97731848,.17689245,7.67025]],
  neptune: [[30.06952752,.00895439,1.77005520,304.22289287,46.68158724,131.78635853],[.00006447,.00000818,.000224,218.46515314,.01009938,-.00606302],[-.00041348,.68346318,-.10162547,7.67025]],
};
export function ephemerisPosition(id, utcMs) {
  if (!elements[id] || !Number.isFinite(utcMs)) throw new Error('Unknown body or epoch');
  const T = (utcMs - Date.UTC(2000,0,1,12)) / (36525*86400000);
  if (Math.abs(T) > 50) throw new Error('Date outside approximate JPL ephemeris range');
  const [base, rates, extra] = elements[id];
  const [a,e,i,L,peri,node] = base.map((value,index)=>value+rates[index]*T);
  const correction = extra ? extra[0]*T*T + extra[1]*Math.cos(extra[3]*T*rad) + extra[2]*Math.sin(extra[3]*T*rad) : 0;
  const M = ((L-peri+correction+180)%360+360)%360*rad-Math.PI;
  let E=M;
  for(let j=0;j<15;j++) E-=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
  const x=a*AU*(Math.cos(E)-e),y=a*AU*Math.sqrt(1-e*e)*Math.sin(E);
  const w=(peri-node)*rad,O=node*rad,I=i*rad;
  const X=(Math.cos(w)*Math.cos(O)-Math.sin(w)*Math.sin(O)*Math.cos(I))*x+(-Math.sin(w)*Math.cos(O)-Math.cos(w)*Math.sin(O)*Math.cos(I))*y;
  const Y=(Math.cos(w)*Math.sin(O)+Math.sin(w)*Math.cos(O)*Math.cos(I))*x+(-Math.sin(w)*Math.sin(O)+Math.cos(w)*Math.cos(O)*Math.cos(I))*y;
  const Z=Math.sin(w)*Math.sin(I)*x+Math.cos(w)*Math.sin(I)*y;
  return new Vector3(X,Z,-Y);
}
export function ephemerisVelocity(id, utcMs) {
  return ephemerisPosition(id,utcMs+30000).sub(ephemerisPosition(id,utcMs-30000)).divideScalar(60);
}
