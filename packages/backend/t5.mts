import { importRealTerrain } from './src/modules/terrain/importer.ts';
const d=0.005, lat=55.7450, lng=37.6100;
const polygon=[{lat:lat+d,lng:lng-d},{lat:lat+d,lng:lng+d},{lat:lat-d,lng:lng+d},{lat:lat-d,lng:lng-d}];
const r = await importRealTerrain(polygon);
console.log(`ЗДАНИЙ: ${r.buildings.length}`);
const polys = r.water.filter(w=>!w.levels), segs = r.water.filter(w=>w.levels);
console.log(`вода: ${polys.length} полигонов + ${segs.length} сегментов рек`);
const area=(p:[number,number][])=>{let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=(p[j][0]+p[i][0])*(p[j][1]-p[i][1]);return Math.abs(a/2);};
if (polys.length) { const ar=polys.map(w=>area(w.p)).sort((x,y)=>y-x); console.log(`  крупнейшие полигоны воды, м2: ${ar.slice(0,3).map(a=>a.toFixed(0)).join(', ')}`); }
if (segs.length) { let m=0; for(const s of segs) m=Math.max(m,Math.abs(s.levels![0]-s.levels![1])); console.log(`  макс. перепад в сегменте: ${m.toFixed(2)} м`); }
console.log(`лесных массивов: ${r.forests.length}`);
