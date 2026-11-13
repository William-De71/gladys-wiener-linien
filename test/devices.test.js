// The traps of the Gladys core that the fake Gladys does not catch
// (community feedback, thread 11005): a device is only polled with
// should_poll AND poll_frequency, every feature needs min / max / read_only /
// has_feedback, a wrong category / type pair shows no icon nor label, and a
// single invalid field rejects the whole discovery batch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import * as sdk from '@gladysassistant/integration-sdk';

import {
  stopKey,
  lineKey,
  followedName,
  parseExternalId,
  buildStopDevice,
  buildStopStates,
  buildLineDevice,
  buildLineStates,
  lineStatusText,
} from '../src/device.js';
import { parsePassages } from '../src/departures.js';
import { parseTraffic, lineTraffic } from '../src/traffic.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  fakeGladys,
  NOW,
  TZ,
  at,
  MONITORS,
  INFOS,
  trafficInfoList,
  monitor,
  departure,
  KARLSPLATZ,
} from './helpers/fixtures.js';

/**
 * @description A followed stop.
 * @param {object} stop - `{ id, name, codes }`.
 * @param {string} line - The typed line.
 * @param {string} direction - The typed direction.
 * @returns {object} The followed stop.
 */
function followed(stop, line, direction) {
  const entry = { stop, line, direction, key: stopKey(stop, line, direction) };
  return { ...entry, name: followedName(entry) };
}

const answer = (monitors) => ({
  data: { monitors },
  message: { value: 'OK', messageCode: 1, serverTime: at(0) },
});
const KARLS = { id: KARLSPLATZ, name: 'Karlsplatz', codes: [KARLSPLATZ] };
const KARLS_U1 = followed(KARLS, 'U1', 'Oberlaa');
const KARLS_ALL = followed(KARLS, '', '');
const LINE_U4 = { id: 'U4', name: 'U4', mode: 'metro' };
const LINE_13A = { id: '13A', name: '13A', mode: 'bus' };
const LINE_18 = { id: '18', name: '18', mode: 'tram' };
const devices = (language) => [
  buildStopDevice(fakeGladys, KARLS_U1, language),
  buildStopDevice(fakeGladys, KARLS_ALL, language),
  buildLineDevice(fakeGladys, LINE_U4, language),
  buildLineDevice(fakeGladys, LINE_13A, language),
];
const { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES, DEVICE_FEATURE_UNITS } = sdk;
const TEXT = [DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, undefined];
const MINUTES = [
  DEVICE_FEATURE_CATEGORIES.DURATION,
  DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  DEVICE_FEATURE_UNITS.MINUTES,
];
const COUNTER = [
  DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  undefined,
];

test('external ids: the number of the stop, the typed line and direction; the name of a line', () => {
  assert.equal(KARLS_U1.key, '60200657_u1_oberlaa');
  assert.equal(stopKey({ id: '60200678-60201237' }, '', ''), '60200678-60201237');
  assert.equal(
    stopKey({ id: '147' }, 'Linie 41', 'Pötzleinsdorf | Gersthof'),
    '147_41_potzleinsdorf-gersthof',
  );
  assert.equal(lineKey(LINE_13A), '13a');
  const [stop, , line] = devices('en');
  assert.equal(stop.external_id, 'ext:wiener-linien:stop:60200657_u1_oberlaa');
  assert.equal(line.external_id, 'ext:wiener-linien:line:u4');
  assert.deepEqual(parseExternalId(`${stop.external_id}:next`), {
    type: 'stop',
    key: '60200657_u1_oberlaa',
  });
  assert.deepEqual(parseExternalId(line.external_id), { type: 'line', key: 'u4' });
  assert.equal(parseExternalId('ext:other:thing'), null);
});

test('devices are never polled by Gladys: the integration has its own timer', () => {
  for (const device of devices('en')) {
    assert.equal(device.should_poll, false, device.external_id);
    assert.equal(device.poll_frequency, undefined);
  }
});

test('every feature carries min, max, read_only and has_feedback, in every language', () => {
  for (const language of LANGUAGES) {
    for (const device of devices(language)) {
      for (const feature of device.features) {
        for (const key of ['min', 'max', 'read_only', 'has_feedback']) {
          assert.notEqual(feature[key], undefined, `${feature.external_id}.${key}`);
        }
        assert.equal(feature.read_only, true);
      }
    }
  }
});

test('category / type pairs and units come from the SDK', () => {
  const pairs = (device) =>
    device.features.map((feature) => [
      feature.external_id.split(':').pop(),
      feature.category,
      feature.type,
      feature.unit,
    ]);
  const [stop, , line] = devices('en');
  assert.deepEqual(pairs(stop), [
    ['next', ...TEXT],
    ['wait', ...MINUTES],
    ['following', ...MINUTES],
    ['delay', ...MINUTES],
    ['messages', ...COUNTER],
  ]);
  assert.deepEqual(pairs(line), [
    ['status', ...TEXT],
    ['messages', ...COUNTER],
  ]);
  for (const feature of stop.features.filter((entry) => entry.unit)) {
    assert.deepEqual([feature.min, feature.max], [0, 180], feature.external_id);
  }
  const table = sdk.DEVICE_FEATURE_UNITS_BY_CATEGORY;
  if (table) {
    assert.ok(table[DEVICE_FEATURE_CATEGORIES.DURATION].includes(DEVICE_FEATURE_UNITS.MINUTES));
  }
});

test('names in every language; a line reads "U4", "bus 13A", "Straßenbahn 18"', () => {
  assert.equal(devices('fr')[0].name, 'Wiener Linien Karlsplatz (U1 → Oberlaa)');
  assert.equal(devices('fr')[2].name, 'Wiener Linien U4');
  assert.equal(devices('fr')[3].name, 'Wiener Linien bus 13A');
  assert.equal(devices('es')[3].name, 'Wiener Linien autobús 13A');
  assert.equal(buildLineDevice(fakeGladys, LINE_18, 'de').name, 'Wiener Linien Straßenbahn 18');
  assert.equal(buildLineDevice(fakeGladys, LINE_18, 'en').name, 'Wiener Linien tram 18');
  assert.deepEqual(devices('en')[0].params, [
    { name: 'WL_STOP', value: KARLSPLATZ },
    { name: 'WL_LINE', value: 'U1' },
    { name: 'WL_DIRECTION', value: 'Oberlaa' },
  ]);
  assert.equal(devices('en')[0].model, 'Wiener Linien');
});

test('the fake Gladys accepts the whole discovery batch and every state', async () => {
  const gladys = createFakeGladys({});
  await gladys.connect();
  const batch = [
    buildStopDevice(gladys, KARLS_ALL, 'fr'),
    buildStopDevice(gladys, KARLS_U1, 'fr'),
    buildLineDevice(gladys, LINE_U4, 'fr'),
    buildLineDevice(gladys, LINE_13A, 'fr'),
  ];
  await gladys.publishDiscoveredDevices(batch);
  for (const device of batch) {
    await gladys.fake.deviceCreated(device);
  }
  const passages = parsePassages(answer(MONITORS), { codes: [KARLSPLATZ] });
  const states = [
    ...buildStopStates(
      gladys,
      KARLS_ALL,
      { passages, messages: [{}, {}] },
      { language: 'fr', now: NOW, timeZone: TZ },
    ),
    ...buildLineStates(
      gladys,
      LINE_U4,
      lineTraffic(parseTraffic(trafficInfoList(INFOS)), LINE_U4, NOW),
      'fr',
    ),
  ];
  await gladys.publishStates(states);
  const id = (key) => `ext:test-integration:stop:${KARLSPLATZ}:${key}`;
  assert.equal(gladys.fake.lastState(id('next')), 'U1 → Oberlaa · 3 min');
  assert.equal(gladys.fake.lastState(id('wait')), 3);
  assert.equal(gladys.fake.lastState(id('following')), 4);
  assert.equal(gladys.fake.lastState(id('delay')), 1);
  assert.equal(gladys.fake.lastState(id('messages')), 2);
  assert.equal(
    gladys.fake.lastState('ext:test-integration:line:u4:status'),
    'Perturbé : U4: Schadhaftes Fahrzeug',
  );
  await gladys.fake.shutdown();
});

test('without a passage the waits are left alone; without traffic, the count too', () => {
  const options = { language: 'en', now: NOW, timeZone: TZ };
  const states = buildStopStates(fakeGladys, KARLS_ALL, { passages: [], messages: null }, options);
  assert.deepEqual(states, [
    {
      device_feature_external_id: `ext:wiener-linien:stop:${KARLSPLATZ}:next`,
      text: 'No passage announced',
    },
  ]);
  // The timetable only: said so, and no delay published.
  const timetable = parsePassages(answer(MONITORS), { codes: ['2610'] });
  const fromTimetable = buildStopStates(
    fakeGladys,
    KARLS_ALL,
    { passages: timetable, messages: [] },
    options,
  );
  assert.equal(fromTimetable[0].text, '4A → Wittelsbachstraße · 12 min (timetable)');
  assert.deepEqual(
    fromTimetable.map((state) => state.device_feature_external_id.split(':').pop()),
    ['next', 'wait', 'messages'],
  );
  assert.equal(lineStatusText({ state: 'normal', messages: [] }, 'es'), 'Servicio normal');
});

test('the delay: said from 2 minutes; an early vehicle counts as on time', () => {
  const options = { language: 'de', now: NOW, timeZone: TZ };
  const states = (delay) =>
    buildStopStates(
      fakeGladys,
      KARLS_ALL,
      {
        passages: parsePassages(answer([monitor({ departures: [departure(5, { delay })] })])),
        messages: null,
      },
      options,
    );
  const late = states(4);
  assert.equal(late[0].text, 'U1 → Oberlaa · 5 Min. (+4 Min.)');
  assert.equal(late.at(-1).state, 4);
  const early = states(-1);
  assert.equal(early[0].text, 'U1 → Oberlaa · 5 Min.');
  assert.equal(early.at(-1).state, 0);
});
