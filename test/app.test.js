// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a
// fake Wiener Linien (test/helpers/fixtures.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  createApp,
  SCENE_ACTIONS,
  ACTIONS,
  IDLE_INTERVAL_MS,
  TRAFFIC_INTERVAL_MS,
} from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS } from '../src/events.js';
import {
  fakeWl,
  storePath,
  silent,
  disruption,
  notice,
  monitor,
  departure,
  NOW,
  TZ,
  API_URL,
  DATA_URL,
  KARLSPLATZ,
  VOLKSOPER,
} from './helpers/fixtures.js';

const CONFIG = {
  stop_1: 'Karlsplatz',
  stop_1_line: 'U1',
  stop_1_direction: 'Oberlaa',
  stop_2: 'Volksoper',
  stop_3: 'Nirgendwo',
  lines: 'U4, 13A, Z9',
  interval: '60',
  language: 'fr',
};
const PREFIX = 'ext:test-integration';
const KARLS_U1 = `${PREFIX}:stop:${KARLSPLATZ}_u1_oberlaa`;
const VOLKS = `${PREFIX}:stop:${VOLKSOPER}`;
const LINE_U4 = `${PREFIX}:line:u4`;
const LINE_13A = `${PREFIX}:line:13a`;
const MINUTE = 60 * 1000;

/**
 * @description The integration, connected to a fake Gladys and a fake Wiener Linien.
 * @param {object} [options] - `{ config, path, logger, api }`.
 * @returns {Promise<object>} `{ gladys, app, api, clock, path }`.
 */
async function startApp({ config = CONFIG, path = storePath(), logger = silent, api } = {}) {
  const clock = { now: NOW };
  const wl = api ?? fakeWl();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: wl,
    baseUrl: API_URL,
    dataUrl: DATA_URL,
    storePath: path,
    now: () => clock.now,
    timeZone: TZ,
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  return { gladys, app, api: wl, clock, path };
}

const created = async (gladys, externalId) => {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  assert.ok(device, `${externalId} is offered`);
  await gladys.fake.deviceCreated(device);
  return device;
};
const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const message = async (gladys, key, fields) => (await gladys.fake.action(key, fields)).data.message;
const widget = async (gladys, key, options) => {
  const answer = await gladys.fake.widgetGet(key, options);
  assert.equal(answer.success, true);
  assert.deepEqual(validateWidgetContent(answer.data.content), [], key);
  return answer.data.content;
};

test('stops and lines become devices; unknown names are reported; one request for every stop', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.external_id, device.name]),
    [
      [KARLS_U1, 'Wiener Linien Karlsplatz (U1 → Oberlaa)'],
      [VOLKS, 'Wiener Linien Währinger Straße-Volksoper'],
      [LINE_U4, 'Wiener Linien U4'],
      [LINE_13A, 'Wiener Linien bus 13A'],
    ],
  );
  // The three files, ONE monitor request for both stops, the traffic once
  // (without the elevators).
  assert.deepEqual(
    api.calls.map((call) => [call.service, call.divas, call.names]),
    [
      ['wienerlinien-ogd-haltestellen.csv', [], []],
      ['wienerlinien-ogd-haltepunkte.csv', [], []],
      ['wienerlinien-ogd-linien.csv', [], []],
      ['monitor', [KARLSPLATZ, VOLKSOPER], []],
      ['trafficInfoList', [], ['stoerunglang', 'stoerungkurz']],
    ],
  );
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.equal(
    status.message.fr,
    'Connecté aux Wiener Linien : 2 arrêt(s) lus toutes les 60 s, 2 ligne(s) suivie(s). Inconnu ou ambigu : Nirgendwo. Lignes inconnues des Wiener Linien : Z9.',
  );
  // The first readings are a baseline: nothing fires.
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('created devices get their states, sent again after the creation', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, KARLS_U1);
  await created(gladys, VOLKS);
  await created(gladys, LINE_U4);
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:next`), 'U1 → Oberlaa · 3 min');
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:wait`), 3);
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:following`), 9);
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:delay`), 1);
  // The U4 is disrupted, but this device follows the U1 only.
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:messages`), 0);
  // The display of the platform of the 41 carries a notice.
  assert.equal(gladys.fake.lastState(`${VOLKS}:messages`), 1);
  assert.equal(gladys.fake.lastState(`${LINE_U4}:status`), 'Perturbé : U4: Schadhaftes Fahrzeug');
  assert.equal(gladys.fake.lastState(`${LINE_U4}:messages`), 1);
  // Later: the U1 runs 4 minutes late, then by the timetable only.
  clock.now += 2 * MINUTE;
  api.state.monitors[0] = monitor({ departures: [departure(13, { delay: 4 })] });
  await app.readStops();
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:wait`), 11);
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:delay`), 4);
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:next`), 'U1 → Oberlaa · 11 min (+4 min)');
  clock.now += 2 * MINUTE;
  api.state.monitors[0] = monitor({ departures: [departure(13, { realtime: false })] });
  await app.readStops();
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:next`), 'U1 → Oberlaa · 9 min (théorique)');
  // Without a forecast there is no delay: the last one stays.
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:delay`), 4);
  // Nothing more announced: the waits keep their last value.
  clock.now += 2 * MINUTE;
  api.state.monitors[0] = monitor({ departures: [] });
  await app.readStops();
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:next`), 'Aucun passage annoncé');
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:wait`), 9);
});

test('departure soon fires once per passage and mark', async (t) => {
  const { gladys, app, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  clock.now += MINUTE;
  await app.readStops();
  await app.checkReminders();
  const soon = eventsOf(gladys, TRIGGERS.DEPARTURE_SOON);
  assert.deepEqual(
    soon.map((event) => [
      event.data.stop,
      event.data.minutes,
      event.data.line,
      event.data.time,
      event.data.delay,
    ]),
    [[KARLS_U1, '2', 'U1', '21:33', 1]],
  );
  assert.equal(soon[0].data.summary, 'U1 vers Oberlaa passe à Karlsplatz dans 2 min (21:33).');
  clock.now += 20 * 1000;
  await app.checkReminders();
  assert.equal(eventsOf(gladys, TRIGGERS.DEPARTURE_SOON).length, 1);
  // Volksoper: the 40 at 21:37, 5 minutes before.
  clock.now += 40 * 1000;
  await app.checkReminders();
  assert.deepEqual(
    eventsOf(gladys, TRIGGERS.DEPARTURE_SOON).map((event) => [event.data.stop, event.data.minutes]),
    [
      [KARLS_U1, '2'],
      [VOLKS, '5'],
    ],
  );
});

test('traffic: a line disrupted, a new message, back to normal; a stop gets its own', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, LINE_13A);
  assert.equal(gladys.fake.lastState(`${LINE_13A}:status`), 'Trafic normal');
  // An accident on the 13A, an incident on the 40 (Volksoper), read 5 min later.
  api.state.infos.push(
    disruption({
      name: 'I20261112-0070',
      title: '13A: Verkehrsunfall',
      description: 'Linie 13A: Betrieb eingestellt.',
      lines: ['13A'],
      stops: [],
      start: 2,
      end: null,
    }),
    disruption({
      name: 'I20261112-0071',
      title: '40: Rettungseinsatz',
      description: 'Linie 40: Es kommt zu Verspätungen.',
      lines: ['40'],
      stops: [147],
      start: 2,
    }),
  );
  clock.now += TRAFFIC_INTERVAL_MS;
  await app.readTraffic();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [
      event.key,
      event.data.line ?? event.data.device,
      event.data.title,
    ]),
    [
      [TRIGGERS.LINE_DISRUPTED, LINE_13A, '13A: Verkehrsunfall'],
      [TRIGGERS.TRAFFIC_MESSAGE, LINE_13A, '13A: Verkehrsunfall'],
      [TRIGGERS.TRAFFIC_MESSAGE, VOLKS, '40: Rettungseinsatz'],
    ],
  );
  const [disrupted, lineMessage, stopMessage] = gladys.fake.sceneEvents;
  assert.equal(disrupted.data.state, 'major');
  assert.equal(lineMessage.data.kind, 'disruption');
  assert.equal(lineMessage.data.summary, 'Wiener Linien Perturbation (13A) : 13A: Verkehrsunfall');
  assert.equal(stopMessage.data.lines, '40');
  assert.equal(gladys.fake.lastState(`${LINE_13A}:status`), 'Très perturbé : 13A: Verkehrsunfall');
  // Read again: nothing new, even though the control centre touched it.
  clock.now += TRAFFIC_INTERVAL_MS;
  await app.readTraffic();
  assert.equal(gladys.fake.sceneEvents.length, 3);
  // Its text changes: the message fires again, as an update.
  api.state.infos.find((info) => info.name === 'I20261112-0070').description =
    'Linie 13A: Betrieb nur zwischen Hauptbahnhof und Neubaugasse.';
  clock.now += TRAFFIC_INTERVAL_MS;
  await app.readTraffic();
  assert.deepEqual(
    eventsOf(gladys, TRIGGERS.TRAFFIC_MESSAGE)
      .slice(2)
      .map((event) => [event.data.device, event.data.updated, event.data.state]),
    [[LINE_13A, true, 'disrupted']],
  );
  // Then the control centre marks it resolved.
  api.state.infos.find((info) => info.name === 'I20261112-0070').status = 'resolved';
  clock.now += TRAFFIC_INTERVAL_MS;
  await app.readTraffic();
  assert.deepEqual(
    eventsOf(gladys, TRIGGERS.LINE_RESTORED).map((event) => [event.data.line, event.data.state]),
    [[LINE_13A, 'normal']],
  );
  // Within 5 minutes, not read again.
  const asked = api.apiCalls('trafficInfoList').length;
  clock.now += MINUTE;
  await app.readTraffic();
  assert.equal(api.apiCalls('trafficInfoList').length, asked);
});

test('a notice of a display fires on its stop', async (t) => {
  const { gladys, app, api, clock } = await startApp();
  t.after(() => gladys.fake.shutdown());
  api.state.infos.push(
    notice({
      stop: 147,
      line: '40',
      lineId: 140,
      description: 'Verkehrsunfall\nDerzeit kein Betrieb',
    }),
    // Another platform, far away: not ours.
    notice({ stop: 9999, line: '40', lineId: 140, description: 'Züge halten\nNußdorfer Straße 1' }),
  );
  clock.now += TRAFFIC_INTERVAL_MS;
  await app.readTraffic();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [
      event.key,
      event.data.device,
      event.data.kind,
      event.data.state,
      event.data.title,
    ]),
    [[TRIGGERS.TRAFFIC_MESSAGE, VOLKS, 'notice', 'major', 'Verkehrsunfall Derzeit kein Betrieb']],
  );
});

test('the elevators are asked and counted only when followed', async (t) => {
  const { gladys, api } = await startApp({ config: { ...CONFIG, elevators: true } });
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(api.apiCalls('trafficInfoList')[0].names, [
    'stoerunglang',
    'stoerungkurz',
    'aufzugsinfo',
  ]);
  await created(gladys, KARLS_U1);
  // The elevator of the platform of the U1 towards Oberlaa.
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:messages`), 1);
});

test('a restart remembers what fired', async (t) => {
  const path = storePath();
  const first = await startApp({ path });
  first.clock.now += MINUTE;
  await first.app.readStops();
  await first.gladys.fake.shutdown();
  const second = await startApp({ path });
  t.after(() => second.gladys.fake.shutdown());
  second.clock.now += MINUTE;
  await second.app.readStops();
  await second.app.readTraffic({ force: true });
  assert.deepEqual(second.gladys.fake.sceneEvents, []);
});

test('nothing to configure: without a stop the status says what to do, nothing is asked', async (t) => {
  const { gladys, api } = await startApp({ config: {} });
  t.after(() => gladys.fake.shutdown());
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Ready. Add a stop or a line on the Configuration screen.',
  );
  assert.deepEqual(api.apiCalls('monitor'), []);
  assert.deepEqual(api.apiCalls('trafficInfoList'), []);
  const content = await widget(gladys, WIDGETS.DEPARTURES, { language: 'en' });
  assert.match(content.components[0].text, /^No stop is followed/);
});

test('the request limit (code 316): every request pauses for 5 minutes', async (t) => {
  const { gladys, app, clock, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  api.state.fail = 316;
  clock.now += MINUTE;
  await app.readStops();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.fr,
    /demande de ralentir : reprise des lectures à 21:36/,
  );
  const asked = api.calls.length;
  api.state.fail = null;
  clock.now += 2 * MINUTE;
  await app.readStops();
  await app.readTraffic({ force: true });
  assert.equal(api.calls.length, asked);
  clock.now += 4 * MINUTE;
  await app.readStops();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the API out of reach: disconnected, the last readings stay, tried again at the next interval', async (t) => {
  const { gladys, app, clock, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  await created(gladys, KARLS_U1);
  api.state.fail = 503;
  clock.now += MINUTE;
  await app.readStops();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer \(HTTP 503\)/);
  assert.equal(gladys.fake.lastState(`${KARLS_U1}:wait`), 3);
  const asked = api.apiCalls('monitor').length;
  clock.now += 20 * 1000;
  await app.readStops();
  assert.equal(api.apiCalls('monitor').length, asked);
  api.state.fail = null;
  clock.now += 40 * 1000;
  await app.readStops();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('at night (nothing announced within 45 minutes), the stops are read every 10 minutes', async (t) => {
  const api = fakeWl();
  api.state.monitors = [monitor({ departures: [departure(65)] })];
  const { gladys, app, clock } = await startApp({ api });
  t.after(() => gladys.fake.shutdown());
  const before = api.apiCalls('monitor').length;
  clock.now += 5 * MINUTE;
  await app.readStops();
  assert.equal(api.apiCalls('monitor').length, before);
  clock.now += IDLE_INTERVAL_MS - 5 * MINUTE;
  await app.readStops();
  assert.equal(api.apiCalls('monitor').length, before + 1);
});

test('widgets: departures of a followed, a typed and several stops; traffic of the followed lines', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const followed = await widget(gladys, WIDGETS.DEPARTURES, { language: 'fr', settings: {} });
  assert.equal(followed.components[0].text, 'Karlsplatz (U1 → Oberlaa)');
  assert.deepEqual(
    followed.components[2].items.map((item) => [item.label, item.value]),
    [['U1 → Oberlaa', '3 · 9 min']],
  );
  // A widget within a minute reuses the reading.
  assert.equal(api.apiCalls('monitor').length, 1);
  const typed = await widget(gladys, WIDGETS.DEPARTURES, {
    language: 'en',
    settings: { stop_name: '4416' },
  });
  assert.equal(typed.components[0].text, 'Karlsplatz');
  assert.deepEqual(api.apiCalls('monitor').at(-1).stopIds, ['4416']);
  assert.deepEqual(
    typed.components[2].items.map((item) => [item.label, item.value]),
    [['U4 → Hütteldorf', '6 min']],
  );
  // The whole stop, typed as the displays write it: a star for the timetable.
  const whole = await widget(gladys, WIDGETS.DEPARTURES, {
    language: 'en',
    settings: { stop_name: 'Karlsplatz U' },
  });
  assert.deepEqual(
    whole.components[2].items.map((item) => [item.label, item.value]),
    [
      ['U1 → Oberlaa', '3 · 9 min'],
      ['U1 → Leopoldau', '4 min'],
      ['U4 → Hütteldorf', '6 min'],
      ['4A → Wittelsbachstraße', '12* min'],
    ],
  );
  assert.match(whole.components[1].text, /\* timetable only$/);
  const several = await widget(gladys, WIDGETS.DEPARTURES, {
    language: 'fr',
    settings: { stops: [KARLS_U1, VOLKS] },
  });
  assert.equal(several.components[0].text, 'Karlsplatz · Währinger Straße-Volksoper');
  const unknown = await widget(gladys, WIDGETS.DEPARTURES, {
    language: 'fr',
    settings: { stop_name: 'Nirgendwo' },
  });
  assert.equal(unknown.components[0].text, 'Inconnu ou ambigu : Nirgendwo.');
  const traffic = await widget(gladys, WIDGETS.TRAFFIC, { language: 'fr', settings: {} });
  assert.deepEqual(
    traffic.components[1].items.map((item) => [item.label, item.value]),
    [
      ['U4', 'Perturbé'],
      ['Bus 13A', 'Trafic normal'],
    ],
  );
  assert.deepEqual(
    traffic.components[2].items.map((item) => [item.title, item.badge.text]),
    [['U4: Schadhaftes Fahrzeug', 'U4']],
  );
  const typedLines = await widget(gladys, WIDGETS.TRAFFIC, {
    language: 'de',
    settings: { lines: '41, U1' },
  });
  assert.deepEqual(
    typedLines.components[1].items.map((item) => [item.label, item.value]),
    [
      ['Straßenbahn 41', 'Gestört'],
      ['U1', 'Normaler Betrieb'],
    ],
  );
});

test('the traffic widget without anything followed shows the U-Bahn lines', async (t) => {
  const { gladys } = await startApp({ config: {} });
  t.after(() => gladys.fake.shutdown());
  const content = await widget(gladys, WIDGETS.TRAFFIC, { language: 'en', settings: {} });
  assert.deepEqual(
    content.components[1].items.map((item) => item.label),
    ['U1', 'U2', 'U3', 'U4', 'U6'],
  );
});

test('scene actions: the next passages of a stop, the traffic of a line', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const next = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_NEXT_DEPARTURES, { stop: VOLKS });
  assert.equal(next.success, true);
  assert.deepEqual(next.data.outputs ?? next.data, {
    stop_name: 'Währinger Straße-Volksoper',
    found: true,
    line: '40',
    destination: 'Schottentor U',
    minutes: 7,
    time: '21:37',
    realtime: true,
    delay: 0,
    following_minutes: 10,
    summary:
      'Prochain passage à Währinger Straße-Volksoper : 40 vers Schottentor U dans 7 min. Le suivant dans 10 min.',
  });
  const line = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_LINE_TRAFFIC, { line: LINE_U4 });
  const outputs = line.data.outputs ?? line.data;
  assert.equal(outputs.line_name, 'U4');
  assert.equal(outputs.state, 'disrupted');
  assert.equal(outputs.disrupted, true);
  assert.equal(outputs.title, 'U4: Schadhaftes Fahrzeug');
  const other = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_LINE_TRAFFIC, { line_name: 'D' });
  assert.equal((other.data.outputs ?? other.data).line_name, 'Tram D');
});

test('find, add, list and remove stops; the search asks nothing to the API', async (t) => {
  const { gladys, api } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const asked = api.calls.length;
  const found = await message(gladys, ACTIONS.SEARCH_STOP, { query: 'kirchengasse' });
  assert.equal(
    found.fr,
    'Saisissez le nom, ou le numéro entre crochets (tout l’arrêt, tous les quais et lignes) :\n• Kirchengasse [60200678]\n• Kirchengasse [60201237]\n• Kirchengasse/Rathaus (Gerasdorf bei Wien) [60203506]',
  );
  assert.equal(api.calls.length, asked);
  const added = await message(gladys, ACTIONS.ADD_STOP, { stop: 'Schottentor', line: 'D' });
  assert.match(added.en, /^Stop added: Schottentor \(D\)\. 3 stop\(s\) followed/);
  assert.deepEqual(gladys.fake.config.added_stops, [
    { stop: '60201184', line: 'D', direction: '' },
  ]);
  assert.ok(
    gladys.fake.discoveredDevices.some((d) => d.external_id === `${PREFIX}:stop:60201184_d`),
  );
  // Only the new stop is read.
  assert.deepEqual(api.apiCalls('monitor').at(-1).divas, ['60201184']);
  const again = await message(gladys, ACTIONS.ADD_STOP, { stop: '60201184', line: 'D' });
  assert.match(again.en, /already followed/);
  const list = await message(gladys, ACTIONS.LIST_STOPS);
  assert.equal(
    list.en,
    '4 stop(s) followed:\n1. Karlsplatz (U1 → Oberlaa) (form, stop 1)\n2. Währinger Straße-Volksoper (form, stop 2)\n3. Nirgendwo (form, stop 3, unknown or ambiguous)\n4. Schottentor (D)',
  );
  const inForm = await message(gladys, ACTIONS.REMOVE_STOP, { stop: '1' });
  assert.match(inForm.en, /stop 1 of the form/);
  const removed = await message(gladys, ACTIONS.REMOVE_STOP, { stop: '4' });
  assert.match(removed.en, /^Stop removed: Schottentor \(D\)/);
  assert.deepEqual(gladys.fake.config.added_stops, []);
});

test('test the connection: network, stops, traffic', async (t) => {
  const { gladys } = await startApp();
  t.after(() => gladys.fake.shutdown());
  const answer = await message(gladys, ACTIONS.TEST_CONNECTION);
  assert.match(answer.fr, /^Arrêts et lignes des Wiener Linien lus : 8 arrêts, 19 lignes · /);
  assert.match(answer.fr, /Karlsplatz \(U1 → Oberlaa\) : 2 passage\(s\), prochain U1 dans 3 min/);
  assert.match(answer.fr, /trafic : 2 message\(s\) sur le réseau/);
  assert.match(
    answer.fr,
    /inconnu ou ambigu : Nirgendwo · Lignes inconnues des Wiener Linien : Z9\.$/,
  );
});

test('the diagnostic goes to the logs', async (t) => {
  const lines = [];
  const logger = {
    info: (...args) => lines.push(args.join(' ')),
    warn: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.map(String).join(' ')),
    debug() {},
  };
  const { gladys } = await startApp({ logger });
  t.after(() => gladys.fake.shutdown());
  const answer = await message(gladys, ACTIONS.DIAGNOSTIC);
  assert.match(answer.en, /Wiener Linien diagnostic/);
  const report = lines.find((line) => line.includes('Wiener Linien diagnostic 1/'));
  assert.ok(report);
  assert.match(report, /"key":"60200657_u1_oberlaa"/);
  assert.match(report, /"sides":\["4120"\]/);
  assert.match(report, /U1>Oberlaa 4120 20:33Z \+1/);
});

test('the stop list cannot be read: a stop typed by its number still works', async (t) => {
  const api = fakeWl();
  api.state.failFiles = 502;
  const { gladys } = await startApp({
    api,
    config: { stop_1: KARLSPLATZ, stop_2: 'Karlsplatz' },
  });
  t.after(() => gladys.fake.shutdown());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    [`Wiener Linien ${KARLSPLATZ}`],
  );
  assert.deepEqual(
    api.apiCalls('monitor').map((call) => call.divas),
    [[KARLSPLATZ]],
  );
  assert.equal(gladys.fake.connectionStatus.connected, false);
});
