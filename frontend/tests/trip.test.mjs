import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalTime, parsePoint, routeReasons, savedTrips, tripKey } from '../js/trip.js';

test('shared coordinates reject blank, nonfinite, out of range and extra values', () => {
  for (const value of ['', ',73', '22,', '91,73', '22,181', 'NaN,73', '22,73,4', null]) assert.equal(parsePoint(value), null);
  assert.deepEqual(parsePoint(' 22.3, 73.2 '), {lat:22.3,lon:73.2});
});

test('arrival rolls across midnight and noon correctly', () => {
  assert.equal(arrivalTime(23.5, 3600), '12:30 AM next day');
  assert.equal(arrivalTime(11.5, 1800), '12:00 PM');
  assert.equal(arrivalTime(0, 60), '12:01 AM');
});

const fast = {risk:10, blackspot_ids:['one','two'], exposure:{unlit_km:2,right_turns:5,uncontrolled_junctions:6}};
const safe = {risk:7, blackspot_ids:['two'], exposure:{unlit_km:.8,right_turns:2,uncontrolled_junctions:3}};
test('route reasons use observed differences and distinguish estimated lighting', () => {
  assert.deepEqual(routeReasons(safe, fast, true), ['Avoids 1 mapped crash location', '1.2 km less road with estimated poor lighting', '3 fewer right turns across traffic']);
  assert.ok(!routeReasons(safe, fast, false).some((r) => r.includes('lighting')));
  assert.deepEqual(routeReasons(fast, fast, true), ['Lowest estimated travel time for this trip']);
});

test('saved trips reject broken storage and cap at five', () => {
  const trip = {city:'surat',mode:'car',origin:{lat:21.1,lon:72.8},destination:{lat:21.2,lon:72.9}};
  assert.deepEqual(savedTrips({}), []);
  assert.equal(savedTrips([null, {...trip, origin:{}}, trip]).length, 1);
  assert.equal(savedTrips(Array(8).fill(trip)).length, 5);
  assert.notEqual(tripKey(trip), tripKey({...trip,origin:trip.destination,destination:trip.origin}));
});
