import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerLocation } from '../js/planner-location.js';

function setup(t, options={}) {
 let now=20000;const watches=[],requests=[],cleared=[],states=[],selected=[];
 const geolocation={watchPosition(ok,bad){watches.push({ok,bad});return watches.length-1},getCurrentPosition(ok,bad){requests.push({ok,bad})},clearWatch(id){cleared.push(id)}};
 const planner=new PlannerLocation({geolocation,onState:s=>states.push(s),onLocation:p=>selected.push(p),clock:()=>now,...options});
 t.after(()=>planner.cancel());planner.start();
 return {planner,watches,requests,cleared,states,selected,time:value=>{now=value},fix:(accuracy=5,timestamp=now)=>({timestamp,coords:{latitude:21.17,longitude:72.8,accuracy}})};
}

test('planner recovers from a high-accuracy error using a network reading without silently selecting a coarse origin',t=>{
 const s=setup(t);s.watches[0].bad({code:3});s.requests[0].ok(s.fix(600));
 assert.equal(s.states.at(-1).kind,'approximate');assert.equal(s.selected.length,0);
 s.planner.choose();assert.equal(s.selected.length,1);assert.equal(s.selected[0].coords.accuracy,600);
 assert.equal(s.planner.active,false);assert.deepEqual(s.cleared,[0]);
});
test('a precise planner reading selects once and releases all acquisition resources',t=>{
 const s=setup(t);s.watches[0].ok(s.fix());s.requests[0].ok(s.fix());
 assert.equal(s.selected.length,1);assert.equal(s.states.at(-1).kind,'selected');assert.equal(s.planner.deadline,null);
});
test('cancel and manual-origin replacement prevent late callbacks from choosing a location',t=>{
 const s=setup(t);s.planner.cancel();s.watches[0].ok(s.fix());s.requests[0].ok(s.fix());
 assert.equal(s.selected.length,0);assert.equal(s.states.at(-1).kind,'idle');
});
test('expired approximate readings cannot be used as the current origin',t=>{
 const s=setup(t);s.requests[0].ok(s.fix(800));s.time(40000);s.planner.choose();
 assert.equal(s.selected.length,0);assert.equal(s.states.at(-1).kind,'stale');
});
test('a browser that never finishes permission cannot keep the origin request busy forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const s=setup(t,{permissions:{query:async()=>({state:'prompt'})}});
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(35000);
 assert.equal(s.planner.active,false);assert.equal(s.states.at(-1).kind,'permission-stalled');
 s.watches[0].ok(s.fix());assert.equal(s.selected.length,0);
});
test('permission denial has an actionable persistent state and releases the request',t=>{
 const s=setup(t);s.watches[0].bad({code:1});
 assert.equal(s.states.at(-1).kind,'denied');assert.equal(s.planner.active,false);assert.equal(s.planner.deadline,null);
 s.planner.start();s.watches[1].ok(s.fix());assert.equal(s.selected.length,1);
});
test('insecure pages explain the secure-context requirement without requesting location',t=>{
 const s=setup(t,{secure:false});assert.equal(s.states.at(-1).kind,'unsupported');assert.equal(s.watches.length,0);
});
