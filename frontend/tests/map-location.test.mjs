import test from 'node:test';
import assert from 'node:assert/strict';
import { MapView } from '../js/map.js';

test('map reuses a rotating arrow at measured coordinates and clears its accuracy circle on stop',()=>{
 const markers=[];
 globalThis.document={createElement(){return {className:'',innerHTML:'',setAttribute(){},classList:{toggle(){}}}}};
 globalThis.maplibregl={Marker:class {
  constructor(options){this.options=options;markers.push(this)}
  getElement(){return this.options.element}
  setRotation(value){this.heading=value;return this}
  setLngLat(value){this.coords=value;return this}
  addTo(){return this}
  remove(){this.removed=true}
 }};
 const map=Object.create(MapView.prototype);map.map={};const sources={};map._set=(key,value)=>{sources[key]=value};
 map.navigationPosition([72.8,21.2],12,false,90);
 assert.equal(markers[0].heading,90);assert.equal(markers[0].options.rotationAlignment,'map');
 assert.match(markers[0].options.element.innerHTML,/<svg/);
 assert.equal(sources.locationAccuracy.features[0].geometry.coordinates[0].length,65);
 map.navigationPosition([72.801,21.2],10,false,180);
 assert.equal(markers.length,1);assert.deepEqual(markers[0].coords,[72.801,21.2]);assert.equal(markers[0].heading,180);
 map.navigationPosition(null);assert.equal(markers[0].removed,true);assert.deepEqual(sources.locationAccuracy.features,[]);
 delete globalThis.document;delete globalThis.maplibregl;
});
