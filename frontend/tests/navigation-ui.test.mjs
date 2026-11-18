import test from 'node:test';
import assert from 'node:assert/strict';
import { RoutePreview } from '../js/navigation-ui.js';

const route={geometry:[[0,0],[.001,0],[.001,.001]],distance_m:222.39,time_s:120,directions:[
 {type:'depart',text:'Head east',distance_m:111.195,time_s:60,distance_from_start_m:0},
 {type:'turn',text:'Turn left',distance_m:111.195,time_s:60,distance_from_start_m:111.195},
 {type:'arrive',text:'Arrive',distance_m:0,time_s:0,distance_from_start_m:222.39}]};

function setup(t, mode='car') {
 t.mock.timers.enable({apis:['setInterval','Date'],now:20000});
 const nodes=new Map(), events={}, positions=[], follows=[], messages=[];
 const element=()=>({textContent:'',hidden:true,dataset:{},focus(){this.focused=true},classList:{add(){},remove(){}}});
 globalThis.document={body:element(),querySelector(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)}};
 globalThis.window={addEventListener(name,fn){events[name]=fn}};
 const map={map:{on(name,fn){events[name]=fn}},navigationPosition(...args){positions.push(args)},followPosition(point){follows.push(point)}};
 const ui=new RoutePreview({map,toast:message=>messages.push(message)});
 const trip={result:{mode,routes:{safest:route}},selected:'safest',destination:{lon:.001,lat:.001}};
 t.after(()=>{ui.stop(false);delete globalThis.document;delete globalThis.window});
 return {ui,trip,nodes,events,positions,follows,messages};
}

test('preview starts without geolocation or browser permissions and moves its arrow',t=>{
 const s=setup(t);s.ui.start(s.trip);
 assert.equal(s.nodes.get('#navigation').hidden,false);
 assert.deepEqual(s.positions.at(-1)[0],[0,0]);
 t.mock.timers.tick(1000);
 assert.ok(s.positions.at(-1)[0][0]>0);
 assert.equal(s.positions.at(-1)[1],0);
 assert.match(s.nodes.get('#nav-instruction').textContent,/Simulated/);
});

test('ending preview stops movement and restores focus to its button',t=>{
 const s=setup(t);s.ui.start(s.trip);s.ui.stop();
 const count=s.positions.length;t.mock.timers.tick(5000);
 assert.equal(s.positions.length,count);assert.equal(s.positions.at(-1)[0],null);
 assert.equal(s.ui.timer,null);assert.equal(s.nodes.get('#navigation').hidden,true);
 assert.equal(s.nodes.get('#btn-preview-route').focused,true);
});

test('preview can be explored and recentered without interrupting its movement',t=>{
 const s=setup(t);s.ui.start(s.trip);s.events.dragstart();
 const count=s.follows.length;t.mock.timers.tick(1000);
 assert.equal(s.follows.length,count);
 assert.equal(s.nodes.get('#nav-follow').textContent,'Recenter');
 s.nodes.get('#nav-follow').onclick();assert.deepEqual(s.follows.at(-1),s.positions.at(-1)[0]);
});

test('preview completion stops its timer and keeps clear completion feedback',t=>{
 const s=setup(t);s.ui.start(s.trip);
 for(let i=0;i<15;i++)t.mock.timers.tick(1000);
 assert.equal(s.ui.timer,null);assert.equal(s.nodes.get('#nav-stop').textContent,'Done');
 assert.equal(s.nodes.get('#nav-time').textContent,'Preview complete');
});

test('restarting a preview replaces its previous timer and page exit stops it',t=>{
 const s=setup(t);s.ui.start(s.trip);s.ui.start(s.trip);
 const count=s.positions.length;t.mock.timers.tick(1000);
 assert.equal(s.positions.length,count+1);
 s.events.pagehide();assert.equal(s.ui.active,false);assert.equal(s.ui.timer,null);
});

test('an invalid preview leaves route planning available and shows the error',t=>{
 const s=setup(t);s.ui.start({...s.trip,result:{mode:'car',routes:{safest:{}}}});
 assert.equal(s.ui.active,false);assert.match(s.messages[0],/instructions/);
});
