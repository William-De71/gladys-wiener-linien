// Scene triggers (transitions, once, baselines) and their payloads, and the
// outputs of the scene actions: flat scalars within the limits of the core.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectReminders,
  detectLineChanges,
  detectStopMessages,
  reminderData,
  messageData,
  lineEvent,
  nextDeparturesOutputs,
  lineTrafficOutputs,
  pick,
  tolerance,
  TRIGGERS,
  NEXT_DEPARTURES_OUTPUTS,
  LINE_TRAFFIC_OUTPUTS,
  MESSAGE_KEEP_MS,
} from '../src/events.js';
import { parsePassages } from '../src/departures.js';
import { parseTraffic, lineTraffic, messagesFor } from '../src/traffic.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  trafficInfoList,
  disruption,
  notice,
  MONITORS,
  INFOS,
  at,
  NOW,
  TZ,
  KARLSPLATZ,
} from './helpers/fixtures.js';

const MINUTE = 60 * 1000;
const PASSAGES = parsePassages(
  { data: { monitors: MONITORS }, message: { messageCode: 1, serverTime: at(0) } },
  { codes: [KARLSPLATZ] },
);
const FOLLOWED = {
  name: 'Karlsplatz (U1)',
  deviceId: 'ext:wiener-linien:stop:60200657_u1',
  stop: { id: KARLSPLATZ, name: 'Karlsplatz', codes: [KARLSPLATZ] },
};
const LINE_U4 = { id: 'U4', name: 'U4', mode: 'metro', deviceId: 'ext:wiener-linien:line:u4' };
const LINE_18 = { id: '18', name: '18', mode: 'tram', deviceId: 'ext:wiener-linien:line:18' };
const traffic = (infos) => parseTraffic(trafficInfoList(infos));
const ACCIDENT = disruption({
  name: 'I-18',
  title: '18: Verkehrsunfall',
  description: 'Linie 18: Betrieb eingestellt.',
  lines: ['18'],
  stops: [],
  start: -5,
  end: null,
});

/**
 * @description Assert a payload fits the scene events of the core.
 * @param {object} data - The payload.
 */
function assertFlat(data) {
  const entries = Object.entries(data);
  assert.ok(entries.length <= 30, `${entries.length} keys`);
  for (const [key, value] of entries) {
    const type = typeof value;
    assert.ok(
      value === null ||
        type === 'boolean' ||
        (type === 'number' && Number.isFinite(value)) ||
        (type === 'string' && value.length <= 1000),
      `${key}: ${JSON.stringify(value)}`,
    );
  }
}

test('reminders: the first reading is a baseline, then once per passage and mark', () => {
  const first = detectReminders({ passages: PASSAGES, fired: undefined, now: NOW });
  assert.deepEqual(first.due, []);
  // 21:30: the U1 in 3 min was due at the 3 mark; remembered, not fired.
  assert.ok(first.fired.some((entry) => entry.mark === 3));
  const later = detectReminders({ passages: PASSAGES, fired: first.fired, now: NOW + MINUTE });
  assert.deepEqual(
    later.due.map(({ passage, mark }) => [passage.line, passage.destination, mark]),
    [
      ['U1', 'Oberlaa', 2],
      ['U1', 'Leopoldau', 3],
      ['U4', 'Hütteldorf', 5],
    ],
  );
  const again = detectReminders({
    passages: PASSAGES,
    fired: later.fired,
    now: NOW + MINUTE + 20000,
  });
  assert.deepEqual(again.due, []);
  assert.deepEqual([2, 3, 5, 10].map(tolerance), [1, 1, 1.5, 3]);
});

test('lines: disrupted, back to normal, new messages; the first reading is a baseline', () => {
  const quiet = traffic([]);
  const lines = [LINE_U4, LINE_18];
  const first = detectLineChanges({ lines, traffic: quiet, seen: {}, now: NOW });
  assert.deepEqual(first.changes, []);
  const busy = traffic([...INFOS, ACCIDENT]);
  const second = detectLineChanges({ lines, traffic: busy, seen: first.seen, now: NOW + MINUTE });
  assert.deepEqual(
    second.changes.map((change) => [change.key, change.line.id, change.message?.id ?? null]),
    [
      [TRIGGERS.LINE_DISRUPTED, 'U4', 'I20261112-0058-F01'],
      [TRIGGERS.TRAFFIC_MESSAGE, 'U4', 'I20261112-0058-F01'],
      [TRIGGERS.LINE_DISRUPTED, '18', 'I-18'],
      [TRIGGERS.TRAFFIC_MESSAGE, '18', 'I-18'],
    ],
  );
  // Read again: nothing new.
  const third = detectLineChanges({
    lines,
    traffic: busy,
    seen: second.seen,
    now: NOW + 2 * MINUTE,
  });
  assert.deepEqual(third.changes, []);
  // The accident on the 18 is over.
  const fourth = detectLineChanges({
    lines: [LINE_18],
    traffic: traffic(INFOS),
    seen: third.seen,
    now: NOW + 3 * MINUTE,
  });
  assert.deepEqual(
    fourth.changes.map((change) => [change.key, change.traffic.state]),
    [[TRIGGERS.LINE_RESTORED, 'normal']],
  );
});

test('a disruption fires again when its text changes; a display text never does', () => {
  const seen = detectStopMessages({ messages: [], seen: undefined, now: NOW }).seen;
  const of = (infos) => messagesFor(traffic(infos), [LINE_18], NOW, ['304']);
  const first = detectStopMessages({ messages: of([ACCIDENT]), seen, now: NOW });
  assert.equal(first.due.length, 1);
  // Touched by the control centre, the same words: silent.
  const touched = { ...ACCIDENT, time: { ...ACCIDENT.time, lastUpdate: at(3) } };
  const second = detectStopMessages({
    messages: of([touched]),
    seen: first.seen,
    now: NOW + MINUTE,
  });
  assert.deepEqual(second.due, []);
  const reworded = { ...ACCIDENT, description: 'Linie 18: Betrieb nur bis Burggasse.' };
  const third = detectStopMessages({
    messages: of([reworded]),
    seen: second.seen,
    now: NOW + 2 * MINUTE,
  });
  assert.deepEqual(
    third.due.map(({ message, updated }) => [message.id, updated, message.state]),
    [['I-18', true, 'disrupted']],
  );
  // A new text on the display of the platform is a new message, not an update.
  const display = detectStopMessages({
    messages: of([notice({ stop: 304, line: '18', lineId: 118 })]),
    seen: third.seen,
    now: NOW + 3 * MINUTE,
  });
  assert.deepEqual(
    display.due.map(({ message, updated }) => [message.channel, updated]),
    [['notice', false]],
  );
  // Forgotten a week after it disappeared.
  const later = detectStopMessages({
    messages: [],
    seen: display.seen,
    now: NOW + MESSAGE_KEEP_MS + 4 * MINUTE,
  });
  assert.deepEqual(later.seen, {});
});

test('payloads: flat scalars, a summary in every language', () => {
  const [first] = PASSAGES;
  const busy = traffic(INFOS);
  const u4 = lineTraffic(busy, LINE_U4, NOW);
  for (const language of LANGUAGES) {
    const soon = reminderData(FOLLOWED, first, 3, { language, timeZone: TZ });
    assertFlat(soon);
    assert.equal(soon.time, '21:33');
    assert.equal(soon.minutes, '3');
    assert.equal(soon.delay, 1);
    const message = messageData({ deviceId: LINE_U4.deviceId, name: 'U4' }, u4.messages[0], {
      language,
      timeZone: TZ,
      lines: 'U4',
    });
    assertFlat(message);
    assert.deepEqual(
      [message.kind, message.state, message.updated, message.start, message.end],
      ['disruption', 'disrupted', false, '12/11 21:10', '12/11 22:30'],
    );
    assert.equal(message.priority, undefined);
    const disrupted = lineEvent(
      { key: TRIGGERS.LINE_DISRUPTED, line: LINE_U4, traffic: u4, message: u4.messages[0] },
      { language, timeZone: TZ },
    );
    assertFlat(disrupted.data);
    const restored = lineEvent(
      {
        key: TRIGGERS.LINE_RESTORED,
        line: LINE_U4,
        traffic: lineTraffic(traffic([]), LINE_U4, NOW),
      },
      { language, timeZone: TZ },
    );
    assert.deepEqual(Object.keys(restored.data), ['line', 'line_name', 'state', 'summary']);
  }
  const [, display] = busy.messages;
  const fr = messageData({ deviceId: 'x', name: 'Volksoper' }, display, {
    language: 'fr',
    timeZone: TZ,
    lines: '41',
  });
  assert.equal(fr.kind, 'notice');
  assert.equal(
    fr.summary,
    'Wiener Linien Info à l’arrêt (41) : Gleisbauarbeiten Betrieb ab Gersthof',
  );
  assert.equal(
    reminderData(FOLLOWED, PASSAGES[4], 10, { language: 'fr', timeZone: TZ }).summary,
    '4A vers Wittelsbachstraße passe à Karlsplatz dans 10 min (21:42, horaire théorique).',
  );
  // The U4 runs 4 minutes late.
  assert.equal(
    reminderData(FOLLOWED, PASSAGES[2], 5, { language: 'de', timeZone: TZ }).summary,
    'U4 Richtung Hütteldorf fährt an Karlsplatz in 5 Min. ab (21:36, 4 Min. verspätet).',
  );
});

test('scene action outputs: only the declared keys', () => {
  const outputs = pick(
    nextDeparturesOutputs({
      followed: FOLLOWED,
      passages: PASSAGES,
      now: NOW,
      language: 'fr',
      timeZone: TZ,
    }),
    NEXT_DEPARTURES_OUTPUTS,
  );
  assert.deepEqual(outputs, {
    stop_name: 'Karlsplatz (U1)',
    found: true,
    line: 'U1',
    destination: 'Oberlaa',
    minutes: 3,
    time: '21:33',
    realtime: true,
    delay: 1,
    following_minutes: 4,
    summary: 'Prochain passage à Karlsplatz : U1 vers Oberlaa dans 3 min. Le suivant dans 4 min.',
  });
  const none = nextDeparturesOutputs({
    followed: FOLLOWED,
    passages: [],
    now: NOW,
    language: 'en',
    timeZone: TZ,
  });
  assert.deepEqual(
    [none.found, none.minutes, none.following_minutes, none.delay],
    [false, -1, -1, 0],
  );
  const line = pick(
    lineTrafficOutputs({
      line: LINE_U4,
      traffic: lineTraffic(traffic(INFOS), LINE_U4, NOW),
      language: 'fr',
    }),
    LINE_TRAFFIC_OUTPUTS,
  );
  assert.deepEqual(Object.keys(line), LINE_TRAFFIC_OUTPUTS);
  assert.equal(line.state, 'disrupted');
  assert.equal(line.disrupted, true);
  assert.equal(line.message_count, 1);
  assert.equal(line.summary, 'U4 : Perturbé. U4: Schadhaftes Fahrzeug');
});
