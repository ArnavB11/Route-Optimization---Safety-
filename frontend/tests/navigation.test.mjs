import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationSession, prepareRoute, projectPosition, pointAt, positionHeading, metres } from '../js/navigation.js';
const route = {geometry:[[0,0],[.001,0],[.001,.001]], distance_m:222.39,time_s:120,directions:[
 {type:'depart',text:'Head east',distance_m:111.195,time_s:60,distance_from_start_m:0},
 {type:'turn',modifier:'left',text:'Turn left onto Test Road',distance_m:111.195,time_s:60,distance_from_start_m:111.195},
 {type:'arrive',text:'Arrive at your destination',distance_m:0,time_s:0,distance_from_start_m:222.39},
]};
const destination={lon:.001,lat:.001};
const fix=(lon,lat,time=20000,accuracy=5)=>({lon,lat,timestamp:time,accuracy,speed:5});

test('projects on segments, including duplicate geometry points',()=>{
 const r=prepareRoute({...route,geometry:[[0,0],[0,0],[.001,0],[.001,.001]]},destination);
 const p=projectPosition(r,[.0005,.0001]);
 assert.ok(Math.abs(p.progress-55.6)<1); assert.ok(Math.abs(p.distance-11.1)<1);
 assert.ok(metres(pointAt(r,111.195),[.001,0])<1);
});
test('advances to the next manoeuvre only after passing the turn',()=>{
 const s=new NavigationSession(route,'walk',destination);
 s.update(fix(.0009,0),20000);
 const after=s.update(fix(.001,.0002,30000),30000);
 assert.equal(after.step.type,'arrive'); assert.ok(after.remaining<100);
});
test('inaccurate, stale, invalid and backwards fixes never advance guidance',()=>{
 for(const f of [fix(.001,.001,20000,80),fix(.001,.001,1000),fix(NaN,0),fix(0,0,20000,-1)]) {
  const s=new NavigationSession(route,'car',destination);
  assert.equal(s.update(f,20000).status,'uncertain'); assert.equal(s.progress,0);
 }
 const s=new NavigationSession(route,'car',destination);s.update(fix(0,0),20000);
 assert.equal(s.update(fix(.001,.001,19000),20000).status,'uncertain');assert.equal(s.progress,0);
});
test('rerouting requires several reliable off-route fixes and elapsed time',()=>{
 const s=new NavigationSession(route,'car',destination);
 assert.equal(s.update(fix(.01,.01,20000),20000).reroute,false);
 assert.equal(s.update(fix(.01,.01,24000),24000).reroute,false);
 assert.equal(s.update(fix(.01,.01,29000),29000).reroute,true);
 assert.equal(s.update(fix(0,0,30000),30000).status,'navigating');assert.equal(s.offCount,0);
});
test('arrival completes tracking, and an unmapped destination is never called arrival',()=>{
 const s=new NavigationSession(route,'walk',destination);
 assert.equal(s.update(fix(.001,.001),20000).status,'arrived');
 assert.equal(s.finished,true);
 const far=new NavigationSession(route,'walk',{lon:.002,lat:.001});
 assert.equal(far.route.steps.at(-1).text,'Reach the end of the mapped route');
 const end=far.update(fix(.001,.001),20000);
 assert.equal(end.status,'route-end');assert.ok(!end.message.includes('arrived'));
});
test('crossings cannot jump progress to a distant part of the route',()=>{
 const geometry=[[0,0],[.001,0],[.001,.001],[0,.001],[0,0],[.002,0]];
 const s=new NavigationSession({...route,geometry,distance_m:667},'car',{lon:.002,lat:0});
 s.update(fix(.0001,0),20000);
 const before=s.progress;
 s.update(fix(0,0,21000),21000);
 assert.equal(s.progress,before);
});
test('duplicate off-route GPS timestamps cannot confirm a deviation',()=>{
 const s=new NavigationSession(route,'car',destination);
 s.update(fix(.01,.01,20000),20000);
 assert.equal(s.update(fix(.01,.01,20000),24000).status,'uncertain');
 assert.equal(s.update(fix(.01,.01,20000),29000).status,'uncertain');
 assert.equal(s.offCount,0);
});

test('arrival requires a fix more precise than its arrival radius',()=>{
 const s=new NavigationSession(route,'walk',destination);
 const near=s.update(fix(.001,.001,20000,30),20000);
 assert.equal(near.status,'uncertain');assert.equal(s.finished,false);
 const precise=s.update(fix(.001,.001,21000,5),21000);
 assert.equal(precise.status,'arrived');
});

test('a nearby destination just beyond the snapped endpoint is not completed early',()=>{
 const dest={lon:.001,lat:.00115};
 const s=new NavigationSession(route,'car',dest);
 const before=s.update(fix(.001,.00085),20000);
 assert.equal(before.status,'navigating');assert.equal(s.finished,false);
 const end=s.update(fix(.001,.00112,21000),21000);
 assert.equal(end.status,'arrived');
});

test('arrow heading follows movement while staying stable at rest or with coarse readings',()=>{
 const p=(lon,lat,accuracy=5,heading=null,speed=0)=>({coords:{longitude:lon,latitude:lat,accuracy,heading,speed}});
 assert.equal(positionHeading(null,p(0,0),45),45);
 assert.ok(Math.abs(positionHeading(p(0,0),p(.001,0))-90)<.1);
 assert.ok(Math.abs(positionHeading(p(0,0),p(0,.001)))<.1);
 assert.equal(positionHeading(p(0,0),p(.000001,0),90),90);
 assert.equal(positionHeading(p(0,0),p(.01,0,800),45),45);
 assert.equal(positionHeading(p(0,0),p(.001,0,5,270,5)),270);
 assert.equal(positionHeading(p(0,0),p(.000001,0,5,270,0),90),90);
});
