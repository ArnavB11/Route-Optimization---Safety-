import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationUI } from '../js/navigation-ui.js';
const route={geometry:[[0,0],[.001,0],[.001,.001]],distance_m:222.39,time_s:120,directions:[
 {type:'depart',text:'Head east',distance_m:111.195,time_s:60,distance_from_start_m:0},
 {type:'turn',text:'Turn left',distance_m:111.195,time_s:60,distance_from_start_m:111.195},
 {type:'arrive',text:'Arrive',distance_m:0,time_s:0,distance_from_start_m:222.39}]};
function setup(reroute=async()=>{}){
 const nodes=new Map();
 const element=()=>({textContent:'',hidden:true,dataset:{},disabled:false,focus(){},select(){this.selected=true},setAttribute(){},classList:{add(){},remove(){}}});
 globalThis.document={hidden:false,body:element(),querySelector(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},addEventListener(){}};
 globalThis.window={isSecureContext:true,addEventListener(){}};
 const clear=[], positions=[], follows=[];
 let callback, failure;
 const geo={watchPosition(ok,bad){callback=ok;failure=bad;return 0},clearWatch(id){clear.push(id)}};
 const events={};
 const map={map:{on(name,fn){events[name]=fn}},navigationPosition(...args){positions.push(args)},followPosition(...args){follows.push(args)}};
 let now=20000,changes=0;
 const ui=new NavigationUI({map,geolocation:geo,clock:()=>now,reroute,onRoute(){changes++},toast(){}});
 const trip={result:{mode:'car',routes:{safest:route}},selected:'safest',destination:{lon:.001,lat:.001},safety:.7,detour:.25};
 return {ui,trip,nodes,clear,positions,follows,events,changes:()=>changes,setTime(t){now=t},fix(lon,lat,t,accuracy=5){now=t;callback({coords:{longitude:lon,latitude:lat,accuracy,speed:5},timestamp:t})},fail(code){failure({code})}};
}

test('stop clears watch id zero and timer, and ignores late position callbacks',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));s.ui.start(s.trip);
 s.fix(0,0,20000);assert.equal(s.ui.last.status,'navigating');
 s.ui.stop(false);assert.deepEqual(s.clear,[0]);assert.equal(s.ui.timer,null);assert.equal(s.ui.active,false);
 const before=s.positions.length;s.fix(.001,.001,21000);assert.equal(s.positions.length,before);
});
test('stop aborts an in-flight reroute and prevents late route replacement',async t=>{
 let resolve,signal;
 const s=setup((trip,fix,sig)=>{signal=sig;return new Promise(r=>{resolve=r})});
 t.after(()=>s.ui.stop(false));s.ui.start(s.trip);
 s.fix(.01,.01,20000);s.fix(.01,.01,24000);s.fix(.01,.01,29000);
 assert.ok(signal);s.ui.stop(false);assert.equal(signal.aborted,true);
 resolve({mode:'car',routes:{safest:route},snap_distance_m:[0,0]});await new Promise(r=>setImmediate(r));
 assert.equal(s.changes(),0);
});
test('reroute failure leaves turn guidance paused and respects retry cooldown',async t=>{
 let calls=0;const s=setup(async()=>{calls++;throw new Error('No network')});
 t.after(()=>s.ui.stop(false));s.ui.start(s.trip);
 s.fix(.01,.01,20000);s.fix(.01,.01,24000);s.fix(.01,.01,29000);
 await new Promise(r=>setImmediate(r));assert.equal(s.ui.last.status,'offroute');
 s.fix(.01,.01,30000);assert.equal(calls,1);
});
test('permission denial releases tracking; no false turn guidance is displayed',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));s.ui.start(s.trip);s.fail(1);
 assert.equal(s.ui.last.status,'uncertain');assert.deepEqual(s.clear,[0]);
 assert.ok(s.ui.last.message.includes('permission'));assert.equal(s.ui.timer,null);
});
test('arrival releases the location watch without losing completion feedback',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));s.ui.start(s.trip);s.fix(.001,.001,20000);
 assert.equal(s.ui.last.status,'arrived');assert.deepEqual(s.clear,[0]);assert.equal(s.ui.timer,null);
 assert.equal(s.nodes.get('#nav-stop').textContent,'Done');
});

test('successful reroute keeps the selected route and resumes guidance',async t=>{
 let received;
 const s=setup(async(trip)=>{received=trip;return {mode:'car',routes:{safest:route},snap_distance_m:[0,0]}});
 t.after(()=>s.ui.stop(false));s.ui.start(s.trip);
 // Invoke a confirmed deviation request with a fresh fix at the recalculated start.
 await s.ui.recalculate({lat:0,lon:0,accuracy:5,speed:5,timestamp:20000});
 assert.equal(received.selected,'safest');assert.equal(s.changes(),1);assert.equal(s.ui.last.status,'navigating');
 assert.equal(s.ui.controller,null);
});
test('a reroute snapped far from the GPS position cannot resume turn guidance',async t=>{
 const s=setup(async()=>({mode:'car',routes:{safest:route},snap_distance_m:[200,0]}));
 t.after(()=>s.ui.stop(false));s.ui.start(s.trip);
 await s.ui.recalculate({lat:0,lon:0,accuracy:5,speed:5,timestamp:20000});
 assert.equal(s.changes(),0);assert.equal(s.ui.last.status,'offroute');
 assert.ok(s.ui.last.message.includes('mapped roads'));
});

test('a wake lock resolved after stopping is released immediately',async t=>{
 const s=setup();let resolve,released=0;
 s.ui.wakeLock={request:()=>new Promise(r=>{resolve=r})};
 t.after(()=>s.ui.stop(false));s.ui.start(s.trip);s.ui.stop(false);
 resolve({async release(){released++},addEventListener(){}});
 await new Promise(r=>setImmediate(r));assert.equal(released,1);assert.equal(s.ui.wake,null);
});

test('approximate locations move the arrow without advancing route progress',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));s.ui.start(s.trip);
 s.fix(0,0,20000,800);
 assert.equal(s.ui.last.locationState,'approximate');assert.equal(s.ui.session.progress,0);
 assert.equal(s.nodes.get('#nav-location-actions').hidden,false);
 assert.deepEqual(s.positions.at(-1).slice(0,3),[[0,0],800,true]);
 s.fix(.001,0,20500,800);assert.deepEqual(s.positions.at(-1)[0],[.001,0]);
 s.fix(0,0,21000,5);
 assert.equal(s.ui.last.status,'navigating');assert.equal(s.nodes.get('#nav-location-actions').hidden,true);
});
test('retry restarts location acquisition without replacing the selected trip',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));s.ui.start(s.trip);s.fail(1);
 s.nodes.get('#nav-location-retry').onclick();
 assert.equal(s.ui.trip.selected,'safest');assert.equal(s.ui.last.locationState,'acquiring');
 s.fix(0,0,21000);assert.equal(s.ui.last.status,'navigating');
});
test('preview recovery is explicit, labelled, and releases real location tracking',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));s.ui.start(s.trip);s.fail(2);
 s.nodes.get('#nav-location-preview').onclick();
 assert.equal(s.ui.preview,true);assert.deepEqual(s.clear,[0]);
 assert.ok(s.nodes.get('#nav-label').textContent.includes('SIMULATED'));
 assert.equal(s.ui.last.status,'navigating');
});

test('Windows browser handoff preserves the entire trip and stops its old watch',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));
 const url='http://127.0.0.1:8880/?city=surat&o=21%2C72&mode=walk&s=0.7&route=safest';
 s.ui.pageURL=()=>url;s.ui.userAgent='Windows NT 10.0';s.ui.start(s.trip);
 assert.equal(s.nodes.get('#nav-open-browser').hidden,false);
 assert.equal(s.nodes.get('#nav-open-browser').href,'microsoft-edge:'+url);
 assert.equal(s.nodes.get('#nav-location-url').value,url);
 s.nodes.get('#nav-open-browser').onclick();assert.deepEqual(s.clear,[0]);
 assert.equal(s.ui.last.locationState,'handoff');assert.equal(s.ui.preview,false);
});
test('copying a trip supports clipboard permission failure without losing the address',async t=>{
 const s=setup();t.after(()=>s.ui.stop(false));const url='https://example.test/?route=safest';
 s.ui.pageURL=()=>url;s.ui.userAgent='iPhone';let copied;
 s.ui.clipboard={async writeText(value){copied=value}};s.ui.start(s.trip);
 assert.equal(s.nodes.get('#nav-open-browser').hidden,true);
 await s.nodes.get('#nav-location-copy').onclick();assert.equal(copied,url);
 s.ui.clipboard={async writeText(){throw new Error('blocked')}};
 await s.nodes.get('#nav-location-copy').onclick();
 assert.equal(s.nodes.get('#nav-location-url').selected,true);
 assert.equal(s.nodes.get('#nav-location-url').value,url);
});

test('location arrow follows measured movement, supports map exploration and recenters',t=>{
 const s=setup();t.after(()=>s.ui.stop(false));s.ui.start(s.trip);
 s.fix(0,0,20000);s.fix(.0005,0,21000);
 assert.deepEqual(s.positions.at(-1)[0],[.0005,0]);assert.ok(Math.abs(s.positions.at(-1)[3]-90)<.1);
 s.events.dragstart();const before=s.follows.length;s.fix(.0006,0,22000);
 assert.equal(s.follows.length,before);assert.deepEqual(s.positions.at(-1)[0],[.0006,0]);
 s.nodes.get('#nav-follow').onclick();assert.deepEqual(s.follows.at(-1)[0],[.0006,0]);
});
