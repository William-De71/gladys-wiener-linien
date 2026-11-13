import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeConfig,
  readLanguage,
  readInterval,
  parseAddedStops,
  DEFAULT_INTERVAL,
  MAX_ADDED_STOPS,
  MAX_LINES,
} from '../src/config.js';

test('stops, lines, elevators, interval and language from the raw config', () => {
  const config = normalizeConfig({
    stop_1: ' Karlsplatz ',
    stop_1_line: 'U1',
    stop_1_direction: 'Oberlaa',
    stop_2: '',
    stop_3: '60201510',
    lines: 'U1, U4, 13A, U1',
    elevators: true,
    interval: '30',
    language: 'de',
  });
  assert.deepEqual(config, {
    stops: [
      { slot: 1, stop: 'Karlsplatz', line: 'U1', direction: 'Oberlaa' },
      { slot: 3, stop: '60201510', line: '', direction: '' },
    ],
    addedStops: [],
    lines: ['U1', 'U4', '13A'],
    elevators: true,
    interval: 30,
    language: 'de',
  });
  assert.deepEqual(normalizeConfig(null), {
    stops: [],
    addedStops: [],
    lines: [],
    elevators: false,
    interval: DEFAULT_INTERVAL,
    language: 'auto',
  });
  // No key at all: the API is open.
  assert.equal(normalizeConfig({ token: 'x' }).key, undefined);
  assert.equal(normalizeConfig({ elevators: 'true' }).elevators, true);
  assert.equal(normalizeConfig({ elevators: 'no' }).elevators, false);
  const many = Array.from({ length: 15 }, (_, n) => `${n}A`).join(', ');
  assert.equal(normalizeConfig({ lines: many }).lines.length, MAX_LINES);
});

test('bounds: the intervals offered, the stored language', () => {
  assert.equal(readInterval(30), 30);
  assert.equal(readInterval(45), DEFAULT_INTERVAL);
  assert.equal(readInterval(600), DEFAULT_INTERVAL);
  assert.equal(readInterval('300'), 300);
  assert.equal(readLanguage({ last_language: 'es' }, 'fr'), 'es');
  assert.equal(readLanguage({ last_language: 'español' }, 'fr'), 'fr');
  assert.equal(readLanguage(undefined, 'en'), 'en');
});

test('the stops added with the buttons follow the three of the form', () => {
  const added = [
    { stop: '60201184', line: 'D', direction: '' },
    { stop: ' Stephansplatz ', line: '', direction: 'Ottakring' },
    { stop: '', line: 'U3' },
    'Karlsplatz',
  ];
  const config = normalizeConfig({ stop_2: 'Karlsplatz', added_stops: added });
  assert.deepEqual(config.stops, [
    { slot: 2, stop: 'Karlsplatz', line: '', direction: '' },
    { slot: null, added: 1, stop: '60201184', line: 'D', direction: '' },
    { slot: null, added: 2, stop: 'Stephansplatz', line: '', direction: 'Ottakring' },
  ]);
  assert.equal(config.addedStops.length, 2);
  // Stored as JSON text by an older core: read the same.
  assert.deepEqual(parseAddedStops(JSON.stringify(added)), config.addedStops);
  assert.deepEqual(parseAddedStops('not json'), []);
  assert.deepEqual(parseAddedStops(undefined), []);
  const many = Array.from({ length: 20 }, (_, n) => ({ stop: `S${n}` }));
  assert.equal(parseAddedStops(many).length, MAX_ADDED_STOPS);
});
