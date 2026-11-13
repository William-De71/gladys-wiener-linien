// The stops and lines of the open data files: parsing, typed names -> codes,
// the weekly reading kept in the store.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fold,
  slug,
  isStopCode,
  parseCsv,
  parseStops,
  parseLines,
  modeOfType,
  modeOfName,
  findStop,
  searchStops,
  typedLine,
  findLine,
  splitLines,
  createNetwork,
  NetworkError,
  NETWORK_MAX_AGE_MS,
} from '../src/network.js';
import {
  fakeWl,
  DATA_URL,
  NOW,
  STOPS_CSV,
  PLATFORMS_CSV,
  LINES_CSV,
  KARLSPLATZ,
  VOLKSOPER,
  silent,
} from './helpers/fixtures.js';

const STOPS = parseStops(STOPS_CSV, PLATFORMS_CSV);
const LINES = parseLines(LINES_CSV);

test('folding: no case, no accent, ß as ss; slugs', () => {
  assert.equal(fold('Währinger Straße, Volksoper U'), 'wahringer strasse volksoper u');
  assert.equal(fold(' Nußdorf '), 'nussdorf');
  assert.equal(slug('Oberlaa | Reumannplatz'), 'oberlaa-reumannplatz');
  assert.equal(isStopCode('60200657'), true);
  assert.equal(isStopCode('147'), true);
  assert.equal(isStopCode('U1'), false);
});

test('the files: ";" separated, a BOM, CRLF, quotes', () => {
  assert.deepEqual(parseCsv('\uFEFFA;B\r\n1;"x;y"\r\n\r\n2;"say ""hi"""\r\n'), [
    { A: '1', B: 'x;y' },
    { A: '2', B: 'say "hi"' },
  ]);
  assert.deepEqual(parseCsv(''), []);
});

test('stops: one per DIVA number, with its platforms and the names of its displays', () => {
  assert.equal(STOPS.length, 8);
  const karlsplatz = STOPS.find(([, diva]) => diva === KARLSPLATZ);
  assert.equal(karlsplatz[0], 'Karlsplatz');
  assert.equal(karlsplatz[2].length, 15);
  assert.ok(karlsplatz[2].includes('4120'));
  assert.equal(karlsplatz[3], '');
  assert.deepEqual(karlsplatz[4], ['Karlsplatz / Lothringerstraße', 'Karlsplatz U']);
  // Outside Vienna: its town.
  assert.equal(STOPS.find(([, diva]) => diva === '60203506')[3], 'Gerasdorf bei Wien');
});

test('a stop by its name, words of it, the name of a display, its DIVA number or a StopID', () => {
  assert.deepEqual(findStop(STOPS, 'karlsplatz').codes, [KARLSPLATZ]);
  assert.equal(findStop(STOPS, 'Volksoper').name, 'Währinger Straße-Volksoper');
  assert.deepEqual(findStop(STOPS, 'Währinger Straße, Volksoper U').codes, [VOLKSOPER]);
  const whole = findStop(STOPS, VOLKSOPER);
  assert.deepEqual([whole.id, whole.name, whole.sides.length], [VOLKSOPER, whole.name, 12]);
  // One platform.
  assert.deepEqual(findStop(STOPS, '147'), {
    id: '147',
    name: 'Währinger Straße-Volksoper',
    codes: ['147'],
    sides: ['147'],
  });
  // Two stops named Kirchengasse in Vienna: both are asked.
  assert.deepEqual(findStop(STOPS, 'Kirchengasse').codes, ['60200678', '60201237']);
  assert.equal(findStop(STOPS, 'Kirchengasse').id, '60200678-60201237');
  // Words fitting several stops, an unknown name.
  assert.equal(findStop(STOPS, 'gasse'), null);
  assert.equal(findStop(STOPS, 'Nirgendwo'), null);
  assert.equal(findStop(STOPS, ''), null);
  // A number the list ignores is still asked to the API.
  assert.deepEqual(findStop(STOPS, '60209999'), {
    id: '60209999',
    name: '60209999',
    codes: ['60209999'],
    sides: [],
  });
});

test('searching: best matches first, the town of a stop outside Vienna', () => {
  const { found, total } = searchStops(STOPS, 'kirchengasse');
  assert.equal(total, 3);
  assert.deepEqual(found, [
    { name: 'Kirchengasse', codes: ['60200678'], town: '' },
    { name: 'Kirchengasse', codes: ['60201237'], town: '' },
    { name: 'Kirchengasse/Rathaus', codes: ['60203506'], town: 'Gerasdorf bei Wien' },
  ]);
  assert.equal(searchStops(STOPS, 'kirchengasse', 1).found.length, 1);
  // A word is looked for at the start of the words of a name.
  assert.equal(searchStops(STOPS, 'platz').total, 0);
  assert.equal(searchStops(STOPS, 'karl').total, 1);
  assert.deepEqual(searchStops(STOPS, '  '), { found: [], total: 0 });
});

test('lines: metro, trams, buses, then trains; a name once', () => {
  assert.deepEqual(
    LINES.map((line) => `${line.name}:${line.mode}`),
    [
      'U1:metro',
      'U2:metro',
      'U3:metro',
      'U4:metro',
      'U6:metro',
      '1:tram',
      '18:tram',
      '26E:tram',
      '40:tram',
      '41:tram',
      '62:tram',
      'D:tram',
      'LB:tram',
      'O:tram',
      '4A:bus',
      '13A:bus',
      '59A:bus',
      'N25:bus',
      'S45:train',
    ],
  );
  assert.deepEqual(
    ['ptMetro', 'ptTram', 'ptTramWLB', 'ptBusCity', 'ptBusNight', 'ptRufBus', 'ptTrainS', ''].map(
      modeOfType,
    ),
    ['metro', 'tram', 'tram', 'bus', 'bus', 'bus', 'train', 'bus'],
  );
  assert.deepEqual(['U5', 'S7', '49', 'D', '57A', 'N29'].map(modeOfName), [
    'metro',
    'train',
    'tram',
    'tram',
    'bus',
    'bus',
  ]);
});

test('a line as typed: "Linie 13A", "tram 18", "U-Bahn U1", "u 4"', () => {
  assert.deepEqual(['Linie 13A', 'tram 18', 'U-Bahn U1', 'Straßenbahn D', 'bus'].map(typedLine), [
    '13a',
    '18',
    'u1',
    'd',
    'bus',
  ]);
  assert.equal(findLine(LINES, 'Linie 13A').id, '13A');
  assert.equal(findLine(LINES, 'u 4').id, 'U4');
  assert.equal(findLine(LINES, 'd').mode, 'tram');
  assert.equal(findLine(LINES, 'Z9'), null);
  assert.deepEqual(splitLines('U1, 13A; D'), ['U1', '13A', 'D']);
  assert.deepEqual(splitLines('U1 13A D'), ['U1', '13A', 'D']);
  assert.deepEqual(splitLines('tram 18, Linie 13A'), ['tram 18', 'Linie 13A']);
});

test('the network is read once a week, kept in the store, and survives a failed reading', async () => {
  const api = fakeWl();
  const clock = { now: NOW };
  const store = { data: { network: { stops: null, lines: null, readAt: 0 } }, saved: 0 };
  store.save = async () => {
    store.saved += 1;
  };
  const network = createNetwork({
    store,
    fetch: api,
    now: () => clock.now,
    logger: silent,
    dataUrl: DATA_URL,
  });
  assert.equal((await network.resolveStop('Karlsplatz')).id, KARLSPLATZ);
  assert.equal(api.calls.length, 3);
  assert.equal(store.saved, 1);
  assert.equal((await network.resolveLine('u4')).mode, 'metro');
  assert.equal(network.lineById('13a').name, '13A');
  await network.searchStops('schottentor');
  assert.equal(api.calls.length, 3);
  // A line the list ignores: as typed, its mode guessed.
  assert.deepEqual(await network.resolveLine('U5'), {
    id: 'U5',
    name: 'U5',
    mode: 'metro',
    color: '',
    unknown: true,
  });
  assert.equal(await network.resolveLine(' '), null);
  // A week later the files cannot be read: the known network stays.
  clock.now += NETWORK_MAX_AGE_MS + 1000;
  api.state.failFiles = 502;
  assert.equal((await network.load()).stops.length, 8);
  await assert.rejects(network.load(true), (err) => err instanceof NetworkError);
});

test('without the list: a number still resolves, a name fails', async () => {
  const api = fakeWl();
  api.state.failFiles = 404;
  const store = {
    data: { network: { stops: null, lines: null, readAt: 0 } },
    save: async () => {},
  };
  const network = createNetwork({ store, fetch: api, now: () => NOW, dataUrl: DATA_URL });
  assert.deepEqual((await network.resolveStop('4120')).codes, ['4120']);
  await assert.rejects(network.resolveStop('Karlsplatz'), { kind: 'invalid' });
  assert.equal((await network.resolveLine('18')).mode, 'tram');
});
