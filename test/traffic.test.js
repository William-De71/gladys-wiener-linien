// trafficInfoList -> messages: the three categories, the weight read in the
// German text, one message per text of the displays, the state of a line and
// the messages of a stop.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTraffic,
  lineTraffic,
  messagesFor,
  messageState,
  messageAt,
  plainText,
  seriousMessages,
} from '../src/traffic.js';
import { INFOS, trafficInfoList, disruption, notice, elevator, NOW } from './helpers/fixtures.js';

const MINUTE = 60 * 1000;
const U4 = { id: 'U4', name: 'U4' };
const U1 = { id: 'U1', name: 'U1' };
const T41 = { id: '41', name: '41' };
const traffic = (infos, language) => parseTraffic(trafficInfoList(infos), language);

test('a disruption, a display text and an elevator', () => {
  const { messages } = traffic(INFOS);
  assert.deepEqual(
    messages.map((m) => [m.id, m.channel, m.state, m.lineIds, m.stopIds, m.title]),
    [
      [
        'I20261112-0058-F01',
        'disruption',
        'disrupted',
        ['U4'],
        ['4416'],
        'U4: Schadhaftes Fahrzeug',
      ],
      [
        'k-gleisbauarbeiten-betrieb-ab-gersthof',
        'notice',
        'disrupted',
        ['41'],
        ['189'],
        'Gleisbauarbeiten Betrieb ab Gersthof',
      ],
      ['ftazS_83', 'elevator', 'info', ['U1'], ['4120', '4109'], 'Karlsplatz: außer Betrieb'],
    ],
  );
  const [long, short, lift] = messages;
  assert.equal(
    long.text,
    'Linie U4: Nach einer Fahrtbehinderung kommt es zu unterschiedlichen Intervallen.',
  );
  assert.deepEqual([long.start, long.end], [NOW - 20 * MINUTE, NOW + 60 * MINUTE]);
  assert.equal(long.notifyUpdates, true);
  assert.equal(short.text, '');
  assert.equal(short.notifyUpdates, false);
  // The `time` of an elevator is its next maintenance slot: not its outage.
  assert.deepEqual([lift.start, lift.end], [null, null]);
  assert.equal(
    lift.text,
    'U1 Bahnsteig Richtung Oberlaa - Passage\nU1 beide Richtungen\nGeplante Wartung wird durchgeführt.',
  );
});

test('the weight is read in the German text, whatever the language shown', () => {
  assert.equal(messageState('disruption', 'Linie 13A: Betrieb eingestellt.'), 'major');
  assert.equal(messageState('disruption', 'U6: Der Betrieb ist unterbrochen'), 'major');
  assert.equal(messageState('disruption', 'Linie 18: unterschiedliche Intervalle'), 'disrupted');
  assert.equal(messageState('notice', 'Verkehrsunfall Derzeit kein Betrieb'), 'major');
  assert.equal(messageState('notice', 'Sperre Bahnsteig Richtung Floridsdorf'), 'major');
  assert.equal(messageState('notice', 'Gleisbauarbeiten Umleitung zum Reumannplatz'), 'disrupted');
  assert.equal(messageState('notice', 'Fahrtbehinderung wegen Rettungseinsatz'), 'disrupted');
  assert.equal(messageState('notice', 'Busse halten Satzingerweg 41'), 'info');
  assert.equal(messageState('elevator', 'außer Betrieb, kein Betrieb'), 'info');
  const english = disruption({
    title: 'U4: Betrieb eingestellt',
    english: ['U4: Technical fault', 'Line U4 is running at irregular intervals.'],
  });
  const [shown] = traffic([english], 'en').messages;
  assert.equal(shown.title, 'U4: Technical fault');
  assert.equal(shown.text, 'Line U4 is running at irregular intervals.');
  assert.equal(shown.state, 'major');
  // French has no text of its own: German.
  assert.equal(traffic([english], 'fr').messages[0].title, 'U4: Betrieb eingestellt');
  assert.equal(
    traffic([english], 'en').messages[0].version,
    traffic([english]).messages[0].version,
  );
});

test('one message per text of the displays, its platforms and lines gathered', () => {
  const text = 'Fahrtbehinderung\nwegen Rettungseinsatz';
  const { messages } = traffic([
    notice({ stop: 304, line: '18', lineId: 118, description: text, start: -10, end: 30 }),
    notice({ stop: 832, line: '18', lineId: 118, description: text, start: -5, end: 40 }),
    notice({ stop: 304, line: '62', lineId: 162, description: text, start: -10, end: 30 }),
  ]);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].lineIds, ['18', '62']);
  assert.deepEqual(messages[0].stopIds, ['304', '832']);
  assert.deepEqual([messages[0].start, messages[0].end], [NOW - 10 * MINUTE, NOW + 40 * MINUTE]);
});

test('a resolved disruption is over; follow-ups of one incident are one message per line', () => {
  const { messages } = traffic([
    disruption({ name: 'I1-F01', title: '62: Schadhaftes Fahrzeug', lines: ['62'] }),
    disruption({ name: 'I1-F02', title: 'Badner Bahn: Schadhaftes Fahrzeug', lines: ['LB'] }),
    disruption({ name: 'I1-F03', lines: ['59A'], status: 'resolved' }),
  ]);
  assert.deepEqual(
    messages.map((m) => [m.id, m.lineIds]),
    [
      ['I1-F01', ['62']],
      ['I1-F02', ['LB']],
    ],
  );
  assert.deepEqual(parseTraffic({}), { messages: [] });
  assert.deepEqual(parseTraffic({ data: { trafficInfos: [{ refTrafficInfoCategoryId: 9 }] } }), {
    messages: [],
  });
});

test('the state of a line: its heaviest message under way; a display text never closes it', () => {
  assert.deepEqual(lineTraffic(null, U4, NOW), {
    state: 'unknown',
    since: null,
    messages: [],
    upcoming: [],
  });
  const read = traffic([
    ...INFOS,
    notice({
      stop: 147,
      line: '41',
      lineId: 141,
      description: 'Verkehrsunfall\nDerzeit kein Betrieb',
    }),
    disruption({ name: 'SOON', title: 'U4: Bauarbeiten', start: 60 * 24, end: 60 * 48 }),
    disruption({ name: 'FAR', title: 'U4: Sommerpause', start: 60 * 24 * 10, end: 60 * 24 * 20 }),
    disruption({ name: 'OVER', title: 'U4: vorbei', start: -120, end: -5 }),
    disruption({
      name: 'I-41',
      title: '41: Gleisbauarbeiten',
      description: 'Linie 41: Betrieb nur bis Gersthof.',
      lines: ['41'],
      stops: [],
    }),
  ]);
  const u4 = lineTraffic(read, U4, NOW);
  assert.equal(u4.state, 'disrupted');
  assert.equal(u4.since, NOW - 20 * MINUTE);
  assert.deepEqual(
    u4.messages.map((m) => m.id),
    ['I20261112-0058-F01'],
  );
  assert.deepEqual(
    u4.upcoming.map((m) => m.id),
    ['SOON'],
  );
  // "Kein Betrieb" at one platform: disrupted, not major; what the control
  // centre wrote for the line comes first.
  const t41 = lineTraffic(read, T41, NOW);
  assert.equal(t41.state, 'disrupted');
  assert.deepEqual(
    t41.messages.map((m) => [m.channel, m.state]),
    [
      ['disruption', 'disrupted'],
      ['notice', 'disrupted'],
      ['notice', 'disrupted'],
    ],
  );
  assert.equal(seriousMessages(t41).length, 3);
  // An elevator is an information.
  assert.equal(lineTraffic(read, U1, NOW).state, 'info');
  assert.equal(lineTraffic(read, { id: '13A', name: '13A' }, NOW).state, 'normal');
  assert.equal(messageAt({ end: NOW - 1 }, NOW), null);
  assert.equal(messageAt({ start: NOW + 1 }, NOW).coming, true);
});

test('the messages of a stop: the disruptions of its lines, the texts and elevators of its platforms', () => {
  const read = traffic([
    ...INFOS,
    notice({ stop: 9999, line: 'U1', lineId: 301, description: 'Züge halten\nanderswo' }),
    disruption({ name: 'NET', title: 'Demonstration am Ring', lines: [], stops: [] }),
  ]);
  // Karlsplatz, the U1 towards Oberlaa (platform 4120).
  assert.deepEqual(
    messagesFor(read, [U1], NOW, ['4120']).map((m) => [m.id, m.lines]),
    [
      ['NET', []],
      ['ftazS_83', ['U1']],
    ],
  );
  // The whole stop: the disruption of the U4 too.
  assert.deepEqual(
    messagesFor(read, [U1, U4], NOW, new Set(['4120', '4416'])).map((m) => m.id),
    ['I20261112-0058-F01', 'NET', 'ftazS_83'],
  );
  // The text of a display belongs to its platform, not to its line elsewhere.
  assert.deepEqual(
    messagesFor(read, [T41], NOW, ['189']).map((m) => m.channel),
    ['disruption', 'notice'],
  );
  assert.deepEqual(
    messagesFor(read, [T41], NOW, ['147']).map((m) => m.id),
    ['NET'],
  );
  assert.deepEqual(messagesFor(null, [U1], NOW), []);
});

test('plain texts: tags and entities of the HTML descriptions', () => {
  assert.equal(plainText('<p>Linie 18: <br>Nach &amp; vor</p>'), 'Linie 18:\nNach & vor');
  assert.equal(plainText(null), '');
  assert.equal(elevator().attributes.status, 'außer Betrieb');
});
