import test from 'node:test';
import assert from 'node:assert/strict';
import {LocationTracker} from '../js/location.js';

function setup(t, permissions) {
 let now=20000;
 const watches=[],bootstrap=[],cleared=[],positions=[],statuses=[];
 const geolocation={watchPosition(ok,bad,options){watches.push({ok,bad,options});return watches.length-1},clearWatch(id){cleared.push(id)},getCurrentPosition(ok,bad,options){bootstrap.push({ok,bad,options})}};
 const tracker=new LocationTracker({geolocation,permissions,onPosition:p=>positions.push(p),onStatus:s=>statuses.push(s),clock:()=>now});
 t.after(()=>tracker.stop());tracker.start();
 return {tracker,watches,bootstrap,cleared,positions,statuses,now(t){now=t},fix(t,accuracy=5){return {timestamp:t,coords:{latitude:22,longitude:73,accuracy,speed:0}}}};
}

test('acquires high-accuracy watch plus network bootstrap',t=>{
 const s=setup(t);
 assert.equal(s.watches[0].options.enableHighAccuracy,true);assert.equal(s.bootstrap[0].options.enableHighAccuracy,false);
 assert.equal(s.statuses[0].kind,'acquiring');
 s.bootstrap[0].ok(s.fix(20000));assert.equal(s.positions.length,1);
});
test('permission denial survives timer ticks and has no automatic retries',t=>{
 const s=setup(t);s.watches[0].bad({code:1});s.now(120000);s.tracker.tick();
 assert.equal(s.statuses.at(-1).kind,'denied');assert.deepEqual(s.cleared,[0]);assert.equal(s.watches.length,1);assert.equal(s.tracker.timer,null);
});
test('first-fix timeout never falsely claims a lost GPS signal',t=>{
 const s=setup(t);s.now(47000);s.tracker.tick();
 assert.equal(s.statuses.at(-1).kind,'timeout');assert.ok(!s.statuses.at(-1).message.includes('lost'));
});
test('unavailable errors are not overwritten by the watchdog',t=>{
 const s=setup(t);s.watches[0].bad({code:2});s.now(47000);s.tracker.tick();assert.equal(s.statuses.at(-1).kind,'unavailable');
});
test('approximate position is displayed without being used for turn guidance, then recovers',t=>{
 const s=setup(t);s.bootstrap[0].ok(s.fix(20000,700));
 assert.equal(s.positions.length,0);assert.equal(s.statuses.at(-1).kind,'approximate');assert.ok(s.statuses.at(-1).message.includes('700 m'));
 s.now(21000);s.watches[0].ok(s.fix(21000,8));assert.equal(s.positions.length,1);
});
test('late bootstrap errors and worse fixes do not hide a working precise location',t=>{
 const s=setup(t);s.watches[0].ok(s.fix(20000));const before=s.statuses.length;
 s.bootstrap[0].bad({code:3});s.bootstrap[0].ok(s.fix(19000,1000));
 assert.equal(s.statuses.length,before);assert.equal(s.positions.length,1);
});
test('duplicate and out-of-order fixes do not pause valid stationary guidance',t=>{
 const s=setup(t);s.watches[0].ok(s.fix(20000));const before=s.statuses.length;
 s.watches[0].ok(s.fix(20000));s.watches[0].ok(s.fix(19000));
 assert.equal(s.positions.length,1);assert.equal(s.statuses.length,before);
});
test('expired location reconnects with bounded retries and stale callbacks are ignored',t=>{
 const s=setup(t);s.watches[0].ok(s.fix(20000));s.now(51000);s.tracker.tick();
 assert.equal(s.watches.length,2);assert.deepEqual(s.cleared,[0]);
 s.watches[0].ok(s.fix(51000));assert.equal(s.positions.length,1);
 s.now(112000);s.tracker.tick();assert.equal(s.watches.length,3);
 s.now(220000);s.tracker.tick();assert.equal(s.watches.length,3);
});
test('stop/retry invalidates old one-shot callbacks and releases watches',t=>{
 const s=setup(t);s.tracker.stop();s.tracker.start();
 s.bootstrap[0].ok(s.fix(20000));s.watches[0].ok(s.fix(20000));assert.equal(s.positions.length,0);
 s.watches[1].ok(s.fix(20000));assert.equal(s.positions.length,1);
});
test('an unanswered permission prompt offers browser handoff without request loops',async t=>{
 const s=setup(t,{query:async()=>({state:'prompt',addEventListener(){},removeEventListener(){}})});
 await new Promise(r=>setImmediate(r));s.now(120000);s.tracker.tick();
 assert.equal(s.statuses.at(-1).kind,'permission-stalled');assert.equal(s.watches.length,1);
 s.watches[0].bad({code:3});assert.equal(s.statuses.at(-1).kind,'permission-stalled');
 s.watches[0].ok(s.fix(120000));assert.equal(s.positions.length,1);
});
test('permission allowed after a stalled prompt resumes the existing watch',async t=>{
 let changed;const permission={state:'prompt',addEventListener(_,fn){changed=fn},removeEventListener(){}};
 const s=setup(t,{query:async()=>permission});await new Promise(r=>setImmediate(r));
 s.now(46000);s.tracker.tick();assert.equal(s.statuses.at(-1).kind,'permission-stalled');
 permission.state='granted';changed();assert.equal(s.statuses.at(-1).kind,'acquiring');
 s.watches[0].ok(s.fix(46000));assert.equal(s.positions.length,1);assert.equal(s.watches.length,1);
});
test('asynchronous permission queries cannot overwrite a stopped session',async t=>{
 let resolve;const s=setup(t,{query:()=>new Promise(r=>{resolve=r})});
 await new Promise(r=>setImmediate(r));s.tracker.stop();const before=s.statuses.length;
 resolve({state:'denied'});await new Promise(r=>setImmediate(r));assert.equal(s.statuses.length,before);
});

test('quiet stationary watches are refreshed before their last fix becomes stale',t=>{
 const s=setup(t);s.watches[0].ok(s.fix(20000));s.now(31000);s.tracker.tick();
 assert.equal(s.bootstrap.length,2);assert.equal(s.bootstrap[1].options.maximumAge,0);
 assert.equal(s.bootstrap[1].options.enableHighAccuracy,true);
 s.bootstrap[1].ok(s.fix(31000));assert.equal(s.positions.length,2);
 s.now(40000);s.tracker.tick();assert.ok(s.tracker.precise());
 assert.ok(!s.statuses.some(status=>status.kind==='stale'));
});
test('an old invalid response does not erase a fresh approximate location',t=>{
 const s=setup(t);s.bootstrap[0].ok(s.fix(20000,500));const before=s.statuses.length;
 s.watches[0].ok(s.fix(1000));assert.equal(s.statuses.length,before);
 assert.equal(s.statuses.at(-1).kind,'approximate');
});
