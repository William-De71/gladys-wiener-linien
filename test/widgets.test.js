// The widget contents pass the validator of the SDK (what the core would
// drop or truncate), in every language.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildDeparturesWidget,
  buildTrafficWidget,
  messageContent,
  readCount,
  routeValue,
  shortDate,
  dateText,
  BOARD_COUNT,
} from '../src/widgets.js';
import { parsePassages } from '../src/departures.js';
import { parseTraffic, lineTraffic } from '../src/traffic.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  NOW,
  TZ,
  at,
  trafficInfoList,
  disruption,
  monitor,
  departure,
  MONITORS,
  INFOS,
  KARLSPLATZ,
  VOLKSOPER,
} from './helpers/fixtures.js';

const MINUTE = 60 * 1000;
const answer = (monitors) => ({
  data: { monitors },
  message: { value: 'OK', messageCode: 1, serverTime: at(0) },
});
const KARLS = parsePassages(answer(MONITORS), { codes: [KARLSPLATZ] });
const VOLKS = parsePassages(answer(MONITORS), { codes: [VOLKSOPER] });
const LINES = [
  { id: 'U4', name: 'U4', mode: 'metro' },
  { id: '41', name: '41', mode: 'tram' },
  { id: 'U1', name: 'U1', mode: 'metro' },
  { id: '13A', name: '13A', mode: 'bus' },
];

/**
 * @description Assert that the core would keep the content whole.
 * @param {object} content - The content.
 * @param {string} label - For the message.
 */
function assertValid(content, label) {
  assert.deepEqual(validateWidgetContent(content), [], label);
}

const departures = (options) =>
  buildDeparturesWidget({ count: 6, now: NOW, timeZone: TZ, readAt: NOW, ...options });

test('departures widget: one compact row per route, soonest first, in every language', () => {
  for (const language of LANGUAGES) {
    assertValid(departures({ title: 'Karlsplatz', passages: KARLS, language }), language);
  }
  const content = departures({ title: 'Karlsplatz', passages: KARLS, language: 'fr' });
  const [heading, caption, status] = content.components;
  assert.equal(heading.text, 'Karlsplatz');
  assert.equal(caption.text, 'Wiener Linien · mis à jour à 21:30 · * horaire théorique');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['U1 → Oberlaa', '3 · 9 min', 'success'],
      ['U1 → Leopoldau', '4 min', 'success'],
      ['U4 → Hütteldorf', '6 min', 'success'],
      // The timetable only: a star, a neutral row.
      ['4A → Wittelsbachstraße', '12* min', 'neutral'],
    ],
  );
});

test('departures widget: times beyond an hour, approaching, nothing announced', () => {
  const later = parsePassages(answer([monitor({ departures: [departure(0.5), departure(65)] })]));
  const content = departures({ title: 'Karlsplatz', passages: later, language: 'en' });
  assertValid(content, 'far');
  assert.equal(content.components[2].items[0].value, 'Approaching · 22:35');
  const empty = departures({ title: 'Karlsplatz', passages: [], language: 'de' });
  assertValid(empty, 'empty');
  assert.equal(
    empty.components[1].text,
    'Keine Abfahrt angekündigt. Wiener Linien · aktualisiert um 21:30.',
  );
  assert.equal(routeValue([], { language: 'en', now: NOW, timeZone: TZ }), '');
});

test('departures widget: several stops in one list, a row per stop then its routes', () => {
  const content = buildDeparturesWidget({
    boards: [
      { title: 'Karlsplatz (U1)', label: 'Karlsplatz', passages: KARLS, readAt: NOW },
      { title: 'Währinger Straße-Volksoper', passages: VOLKS, readAt: NOW - MINUTE },
    ],
    count: 6,
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(content, 'several');
  const [heading, caption, status] = content.components;
  assert.equal(heading.text, 'Karlsplatz · Währinger Straße-Volksoper');
  assert.equal(caption.text, 'Wiener Linien · * horaire théorique');
  assert.deepEqual(
    status.items.filter((item) => item.icon === 'map-pin').map((item) => item.value),
    ['lu à 21:30', 'lu à 21:29'],
  );
  assert.ok(status.items.some((item) => item.label === '41 → Pötzleinsdorf'));
});

test('traffic widget: a status row per line, one card per message, in every language', () => {
  const traffic = parseTraffic(
    trafficInfoList([
      ...INFOS,
      disruption({
        name: 'I-13A',
        title: '13A: Verkehrsunfall',
        description: 'Linie 13A: Betrieb eingestellt.',
        lines: ['13A'],
        stops: [],
        start: -5,
        end: null,
      }),
      disruption({
        name: 'SOON',
        title: 'U4: Bauarbeiten',
        description: 'Linie U4: Betrieb nur zwischen Hütteldorf und Karlsplatz.',
        start: 60 * 24,
        end: 60 * 30,
      }),
    ]),
  );
  const lines = LINES.map((line) => ({ line, traffic: lineTraffic(traffic, line, NOW) }));
  for (const language of LANGUAGES) {
    assertValid(
      buildTrafficWidget({ lines, readAt: NOW, language, now: NOW, timeZone: TZ }),
      language,
    );
  }
  const content = buildTrafficWidget({
    lines,
    readAt: NOW,
    language: 'fr',
    now: NOW,
    timeZone: TZ,
  });
  const [heading, status, list, caption] = content.components;
  assert.equal(heading.text, 'Trafic Wiener Linien');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['U4', 'Perturbé', 'warning'],
      ['Tram 41', 'Perturbé', 'warning'],
      ['U1', 'Information', 'info'],
      ['Bus 13A', 'Très perturbé', 'danger'],
    ],
  );
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge?.text]),
    [
      ['13A: Verkehrsunfall', 'Perturbation · depuis 21:25', '13A'],
      ['U4: Schadhaftes Fahrzeug', 'Perturbation · 21:10 → 22:30', 'U4'],
      ['Gleisbauarbeiten Betrieb ab Gersthof', 'Info à l’arrêt · 11:30 → 13/11 07:30', '41'],
      ['Karlsplatz: außer Betrieb', 'Ascenseur', 'U1'],
      ['U4: Bauarbeiten', 'À venir · 13/11 21:30 → 14/11 03:30', 'U4'],
    ],
  );
  // The full text opens on a tap; a display text has none.
  assert.equal(list.items[0].description, 'Linie 13A: Betrieb eingestellt.');
  assert.equal(list.items[2].description, undefined);
  assert.equal(caption.text, 'Wiener Linien · mis à jour à 21:30');
});

test('traffic widget: nothing under way', () => {
  const quiet = parseTraffic(trafficInfoList([]));
  const content = buildTrafficWidget({
    lines: LINES.map((line) => ({ line, traffic: lineTraffic(quiet, line, NOW) })),
    readAt: NOW,
    language: 'en',
    now: NOW,
    timeZone: TZ,
  });
  assertValid(content, 'quiet');
  assert.equal(
    content.components[2].text,
    'No traffic message under way. Wiener Linien · updated at 21:30.',
  );
});

test('messages and settings', () => {
  assertValid(messageContent('Hello'), 'message');
  assert.equal(readCount(undefined, BOARD_COUNT), BOARD_COUNT.default);
  assert.equal(readCount('99', BOARD_COUNT), BOARD_COUNT.max);
  assert.equal(readCount(0, BOARD_COUNT), BOARD_COUNT.min);
  assert.equal(shortDate(Date.parse('2026-12-31T22:59:00Z'), TZ), '31/12');
  assert.equal(shortDate(null, TZ), '');
  assert.equal(dateText(Date.parse('2026-11-12T15:48:00Z'), NOW, TZ), '16:48');
  assert.equal(dateText(Date.parse('2026-11-06T20:31:00Z'), NOW, TZ), '06/11 21:31');
  assert.equal(dateText(null, NOW, TZ), '');
});
