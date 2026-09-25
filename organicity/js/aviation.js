// Airport traffic and regional camera bounds, independent of three.js.
import { N, SERVICES } from './config.js';
export const maxCameraDistance = () => N * 12;
export function cameraBounds(region) {
  const here=region?.tiles?.[region.active], tiles=Object.values(region?.tiles || {});
  if(!here || !tiles.length)return {minX:0,minZ:0,maxX:N,maxZ:N};
  return {minX:(Math.min(...tiles.map(t=>t.x))-here.x)*N,minZ:(Math.min(...tiles.map(t=>t.z))-here.z)*N,maxX:(Math.max(...tiles.map(t=>t.x))-here.x+1)*N,maxZ:(Math.max(...tiles.map(t=>t.z))-here.z+1)*N};
}
export function operationalAirports(world, day) {
  return [...world.buildings.values()].filter(b=>SERVICES[b.svc]?.aviation && !b.abandoned && !(b.constructionUntil>day) && !(b.flood>1) && b.edge>=0 && b.power && b.water);
}
export function flightPose(airport, seconds, slot=0) {
  const spec=SERVICES[airport.svc], half=spec.w*0.43, apron=spec.d*0.1, runway=-spec.d*0.175;
  const t=((seconds+slot*50+(airport.id%7)*3)%100+100)%100;
  const keys=[[0,0,apron,0.8],[8,0,apron,0.8],[16,-half,runway,0.8],[28,half,runway,3],[48,900,runway,180],[60,-900,runway,180],[82,-half,runway,0.8],[94,0,runway,0.8],[100,0,apron,0.8]];
  const i=keys.findIndex((k,j)=>j<keys.length-1 && t>=k[0] && t<keys[j+1][0]),a=keys[Math.max(0,i)],b=keys[Math.max(0,i)+1],f=(t-a[0])/(b[0]-a[0]);
  const u=a[1]+(b[1]-a[1])*f,v=a[2]+(b[2]-a[2])*f,y=a[3]+(b[3]-a[3])*f,fx=airport.fx ?? 0,fz=airport.fz ?? 1,tx=-fz,tz=fx;
  const dx=(b[1]-a[1])*tx+(b[2]-a[2])*fx,dz=(b[1]-a[1])*tz+(b[2]-a[2])*fz;
  return {x:airport.cx+tx*u+fx*v,z:airport.cz+tz*u+fz*v,y:(airport.pad ?? airport.baseY ?? 0)+y,heading:Math.atan2(dx || tx*0.001,dz || tz*0.001),pitch:-Math.atan2(b[3]-a[3],Math.max(1,Math.hypot(dx,dz))),visible:!(t>=48 && t<60),phase:t<16?'taxi':t<48?'departure':t<82?'arrival':'taxi'};
}
