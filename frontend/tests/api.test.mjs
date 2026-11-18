import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../js/api.js';

function pendingRequest(t) {
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis, 'fetch', (_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once:true});
  }));
}

test('a stalled route request times out so the planner can offer retry', async t => {
  pendingRequest(t);
  const result = assert.rejects(api.route({}), /took too long/);
  t.mock.timers.tick(45000);
  await result;
});

test('replacing a trip preserves cancellation instead of displaying a timeout', async t => {
  pendingRequest(t);
  const controller = new AbortController();
  const result = assert.rejects(api.route({}, controller.signal), {name:'AbortError'});
  controller.abort();
  await result;
});

test('a stalled response body has the same bounded timeout', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis, 'fetch', async (_url, {signal}) => ({
    ok:true, json:() => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {once:true});
    }),
  }));
  const result = assert.rejects(api.cities(), /took too long/);
  await Promise.resolve();
  t.mock.timers.tick(45000);
  await result;
});

test('network failures have a useful connection message', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.cities(), /reach the server/);
});
