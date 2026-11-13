// The answer of the monitor service -> passages: times with their offset, the
// forecast and the timetable (delay), the vehicle overriding the line, the
// filters by stop, line and direction.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInstant,
  parsePassages,
  directionTerms,
  matchesLine,
  minutesLeft,
  upcomingPassages,
  routeOf,
} from '../src/departures.js';
import {
  MONITORS,
  monitor,
  departure,
  at,
  NOW,
  KARLSPLATZ,
  VOLKSOPER,
} from './helpers/fixtures.js';

const answer = (monitors, extra = {}) => ({
  data: { monitors },
  message: { value: 'OK', messageCode: 1, serverTime: at(0), ...extra },
});
const ALL = answer(MONITORS);

test('the times of the API: "+0100" without a colon, milliseconds, Vienna time without offset', () => {
  assert.equal(parseInstant('2026-11-12T21:59:00.000+0100'), Date.parse('2026-11-12T20:59:00Z'));
  assert.equal(parseInstant('2026-07-01T12:00:00.000+0200'), Date.parse('2026-07-01T10:00:00Z'));
  assert.equal(parseInstant('2026-11-12T20:59:00Z'), Date.parse('2026-11-12T20:59:00Z'));
  assert.equal(parseInstant('2026-11-12T21:59:00'), Date.parse('2026-11-12T20:59:00Z'));
  assert.equal(parseInstant('12.11.2026 22:00'), null);
  assert.equal(parseInstant(undefined), null);
});

test('passages of a whole stop: soonest first, the forecast, the delay, the mode', () => {
  const passages = parsePassages(ALL, { codes: [KARLSPLATZ] });
  assert.deepEqual(
    passages.map((p) => [p.line, p.destination, p.stopCode, (p.at - NOW) / 60000, p.delay, p.mode]),
    [
      ['U1', 'Oberlaa', '4120', 3, 1, 'metro'],
      ['U1', 'Leopoldau', '4109', 4, 0, 'metro'],
      ['U4', 'Hütteldorf', '4416', 6, 4, 'metro'],
      ['U1', 'Oberlaa', '4120', 9, 0, 'metro'],
      ['4A', 'Wittelsbachstraße', '2610', 12, null, 'bus'],
    ],
  );
  const [first, , , , bus] = passages;
  assert.deepEqual(
    [first.lineId, first.diva, first.stopName, first.realtime, first.barrierFree, first.direction],
    ['U1', KARLSPLATZ, 'Karlsplatz', true, true, 'H'],
  );
  assert.equal(first.planned, NOW + 2 * 60000);
  // The timetable only: no forecast, no delay.
  assert.deepEqual([bus.realtime, bus.delay, bus.planned], [false, null, NOW + 12 * 60000]);
});

test('filters: one platform, a line, a mode, words of the destination', () => {
  assert.deepEqual(
    parsePassages(ALL, { codes: ['147'] }).map((p) => `${p.line}>${p.destination}`),
    ['40>Schottentor U'],
  );
  assert.equal(parsePassages(ALL, { codes: [VOLKSOPER] }).length, 2);
  assert.equal(parsePassages(ALL).length, 7);
  const u1 = { id: 'U1', name: 'U1', mode: 'metro' };
  assert.equal(parsePassages(ALL, { codes: [KARLSPLATZ], line: u1 }).length, 3);
  assert.deepEqual(
    parsePassages(ALL, { codes: [KARLSPLATZ], line: u1, direction: 'oberlaa | reumannplatz' }).map(
      (p) => p.destination,
    ),
    ['Oberlaa', 'Oberlaa'],
  );
  assert.equal(parsePassages(ALL, { codes: [KARLSPLATZ], line: { modeOnly: 'bus' } }).length, 1);
  assert.deepEqual(directionTerms(' Oberlaa |  | Nußdorf'), ['oberlaa', 'nussdorf']);
  assert.equal(matchesLine({ lineId: '13A', line: '13A' }, { id: 'X', name: 'Linie 13a' }), true);
  assert.equal(matchesLine({ lineId: '13A', line: '13A' }, null), true);
});

test('the vehicle, when given, overrides the line: a short run, another type', () => {
  const short = monitor({
    departures: [
      departure(5, { vehicle: { name: 'U1', towards: 'Alaudagasse', barrierFree: false } }),
      departure(8),
    ],
  });
  const passages = parsePassages(answer([short]));
  assert.deepEqual(
    passages.map((p) => [p.destination, p.barrierFree]),
    [
      ['Alaudagasse', false],
      ['Oberlaa', true],
    ],
  );
});

test('a countdown alone counts from the time of the server; nothing usable is skipped', () => {
  const only = monitor({
    departures: [{ departureTime: { countdown: 6 } }, { departureTime: {} }, {}],
  });
  const passages = parsePassages(answer([only]));
  assert.deepEqual(
    passages.map((p) => [(p.at - NOW) / 60000, p.realtime, p.planned]),
    [[6, false, null]],
  );
  assert.deepEqual(parsePassages(answer([only], { serverTime: undefined })), []);
  // A platform asked by its stop and by its own number: its passages once.
  assert.equal(parsePassages(answer([MONITORS[0], MONITORS[0]])).length, 2);
  assert.deepEqual(parsePassages({}), []);
  assert.deepEqual(parsePassages({ data: { monitors: [{ lines: [{}] }] } }), []);
});

test('minutes left round down; a passage stays 30 seconds after its time', () => {
  const [first] = parsePassages(ALL, { codes: [KARLSPLATZ] });
  assert.equal(minutesLeft(first, NOW + 30000), 2);
  assert.equal(minutesLeft(first, NOW + 10 * 60000), 0);
  assert.equal(upcomingPassages([first], NOW + 3 * 60000 + 20000).length, 1);
  assert.equal(upcomingPassages([first], NOW + 3 * 60000 + 40000).length, 0);
  assert.equal(routeOf(first), 'u1|oberlaa');
});
