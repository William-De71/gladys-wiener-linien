// The HTTP client: the parameters of the two services, the answer kept 15
// seconds, the errors the API answers with HTTP 200 and a `messageCode`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWlClient, WlError, kindOf, kindOfCode, isDiva, MAX_AGE_MS } from '../src/wl-api.js';
import { fakeWl, API_URL, NOW, KARLSPLATZ } from './helpers/fixtures.js';

/**
 * @description A client on a fake Wiener Linien.
 * @returns {object} `{ client, api, clock }`.
 */
function setup() {
  const api = fakeWl();
  const clock = { now: NOW };
  const client = createWlClient({ fetch: api, baseUrl: API_URL, now: () => clock.now });
  return { client, api, clock };
}

test('monitor: whole stops as `diva`, platforms as `stopId`, sorted, once each', async () => {
  const { client, api } = setup();
  const answer = await client.monitor({ codes: ['4416', KARLSPLATZ, '147', KARLSPLATZ] });
  assert.equal(answer.message.messageCode, 1);
  assert.equal(api.calls[0].url, `${API_URL}/monitor?diva=${KARLSPLATZ}&stopId=147&stopId=4416`);
  assert.equal(answer.data.monitors.length, 5);
  assert.equal(isDiva(KARLSPLATZ), true);
  assert.equal(isDiva('4416'), false);
  assert.equal(isDiva('abc'), false);
});

test('trafficInfoList: disruptions and display texts; the elevators only when asked', async () => {
  const { client, api } = setup();
  const without = await client.trafficInfoList();
  assert.deepEqual(api.calls[0].names, ['stoerunglang', 'stoerungkurz']);
  assert.equal(without.data.trafficInfos.length, 2);
  const withElevators = await client.trafficInfoList({ elevators: true });
  assert.deepEqual(api.calls[1].names, ['stoerunglang', 'stoerungkurz', 'aufzugsinfo']);
  assert.equal(withElevators.data.trafficInfos.length, 3);
});

test('an answer is kept 15 seconds: asked again, no new request', async () => {
  const { client, api, clock } = setup();
  await client.monitor({ codes: [KARLSPLATZ] });
  clock.now += MAX_AGE_MS - 1000;
  await client.monitor({ codes: [KARLSPLATZ] });
  assert.equal(api.calls.length, 1);
  assert.deepEqual([client.requests.total, client.requests.cached], [1, 1]);
  clock.now += 2000;
  await client.monitor({ codes: [KARLSPLATZ] });
  assert.equal(api.calls.length, 2);
  client.clear();
  await client.monitor({ codes: [KARLSPLATZ] });
  assert.equal(api.calls.length, 3);
});

test('errors: a messageCode under HTTP 200, an HTTP error, a page instead of JSON, no network', async () => {
  const { client, api } = setup();
  api.state.fail = 316;
  await assert.rejects(client.monitor({ codes: ['1'] }), (err) => {
    assert.ok(err instanceof WlError);
    assert.deepEqual([err.kind, err.code, err.status], ['throttled', 316, 200]);
    assert.equal(err.message, '316 Abfragelimit erreicht!');
    return true;
  });
  api.state.fail = 311;
  await assert.rejects(client.monitor({ codes: ['2'] }), { kind: 'busy' });
  api.state.fail = 503;
  await assert.rejects(client.monitor({ codes: ['3'] }), { kind: 'busy', status: 503 });
  api.state.fail = 'network';
  await assert.rejects(client.monitor({ codes: ['4'] }), {
    kind: 'unreachable',
    message: 'ECONNREFUSED',
  });
  api.state.fail = null;
  // No stop asked: the real answer of the API, code 321.
  await assert.rejects(client.monitor({ codes: [] }), { kind: 'invalid', code: 321 });
  const html = createWlClient({
    fetch: async () => new Response('<html>blocked</html>', { status: 200 }),
    baseUrl: API_URL,
  });
  await assert.rejects(html.monitor({ codes: ['5'] }), { kind: 'unreachable' });
  assert.equal(client.requests.failed, 5);
  assert.match(client.requests.lastError, /^invalid: 321/);
  assert.deepEqual([429, 503, 500, 403, 404].map(kindOf), [
    'throttled',
    'busy',
    'unreachable',
    'unreachable',
    'invalid',
  ]);
  assert.deepEqual([316, 311, 322, 312, 320].map(kindOfCode), [
    'throttled',
    'busy',
    'busy',
    'invalid',
    'invalid',
  ]);
});
