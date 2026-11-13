// -----------------------------------------------------------------------------
// The stops and lines of Wiener Linien, kept in /data.
//
// They come from the open data files of Wiener Linien (City of Vienna,
// CC BY 4.0), published next to the documentation of the real-time API on
// https://www.wienerlinien.at/ogd_realtime/doku/ :
//   wienerlinien-ogd-haltestellen.csv   DIVA;PlatformText;Municipality;…  the stops
//   wienerlinien-ogd-haltepunkte.csv    StopID;DIVA;StopText;…            their platforms
//   wienerlinien-ogd-linien.csv         LineID;LineText;…;MeansOfTransport the lines
// (";" separated, UTF-8 with a BOM). They are read again every seven days.
// Searching and resolving a stop or a line is thus local.
//
// Codes of a stop (as the API documents them):
//   - the DIVA number ("60201510", 8 digits): the whole stop, every platform
//     and line (`diva` of the monitor service);
//   - the StopID ("147", the former RBL number): one platform, one direction
//     (`stopId` of the monitor service).
// A stop is typed by its name ("Karlsplatz"), by words of it when one stop
// only holds them all, by its DIVA number or by a StopID. A name carried by
// several stops (two "Kirchengasse") asks all of them: type the DIVA number
// to keep one.
//
// A line is `{ id, name, mode, color }`: `id` its name in capitals ("U1",
// "13A", "D"), the name the traffic messages use; `mode` metro, tram, bus or
// train. Names are compared folded: no case, no accent, no punctuation.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { isDiva } from './wl-api.js';

const DATA_URL = process.env.WL_DATA_URL || 'https://www.wienerlinien.at/ogd_realtime/doku/ogd';
const FILES = {
  stops: 'wienerlinien-ogd-haltestellen.csv',
  platforms: 'wienerlinien-ogd-haltepunkte.csv',
  lines: 'wienerlinien-ogd-linien.csv',
};
const NETWORK_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 60000;
// The largest file is about 350 kB: anything far beyond is not the list.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const USER_AGENT = `gladys-wiener-linien/${version} (+https://github.com/William-De71/gladys-wiener-linien)`;
const MODES = { METRO: 'metro', TRAM: 'tram', BUS: 'bus', TRAIN: 'train' };
const MODE_ORDER = [MODES.METRO, MODES.TRAM, MODES.BUS, MODES.TRAIN];
// Words a typed line may hold around its name: "Linie 13A", "tram 18", "bus 13A".
const LINE_WORDS =
  /\b(bus|autobus|tram|tramway|strassenbahn|bim|metro|subway|ligne|line|linie|linea|lignes|lines|linien)\b/g;
const HOME_TOWN = 'wien';

class NetworkError extends Error {
  /**
   * @param {string} kind - `unreachable` or `invalid`.
   * @param {string} message - The detail.
   */
  constructor(kind, message) {
    super(message);
    this.name = 'NetworkError';
    this.kind = kind;
  }
}

/**
 * @description Fold a text for comparisons.
 * @param {unknown} value - The text.
 * @returns {string} Lower case, no accent ("ß" as "ss"), words separated by
 * one space.
 * @example
 * fold('Währinger Straße, Volksoper U'); // -> 'wahringer strasse volksoper u'
 */
function fold(value) {
  return String(value ?? '')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @description A slug for an external id.
 * @param {unknown} value - The text.
 * @param {number} [max] - The longest slug.
 * @returns {string} "karlsplatz-u".
 */
function slug(value, max = 40) {
  return fold(value).replace(/ /g, '-').slice(0, max).replace(/-+$/, '');
}

/**
 * @description Whether a typed text is a stop code (DIVA number or StopID).
 * @param {string} typed - The text.
 * @returns {boolean} True for "60201510" or "147".
 */
const isStopCode = (typed) => /^\d{1,8}$/.test(String(typed ?? '').trim());

/**
 * @description The rows of a ";" separated file, as objects by column name.
 * @param {string|Buffer} csv - The file (a BOM and CRLF line ends allowed).
 * @returns {object[]} The rows.
 * @example
 * parseCsv('A;B\r\n1;"x;y"'); // -> [{ A: '1', B: 'x;y' }]
 */
function parseCsv(csv) {
  const text = String(csv ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (cells.some((value) => value !== '')) {
      rows.push(cells);
    }
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ';') {
      endCell();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      cell += char;
    }
  }
  endRow();
  const [header = [], ...lines] = rows;
  const names = header.map((name) => name.trim());
  return lines.map((line) =>
    Object.fromEntries(names.map((name, index) => [name, (line[index] ?? '').trim()])),
  );
}

/**
 * @description The stops of the two files, one per DIVA number.
 * @param {string|Buffer} stopsCsv - wienerlinien-ogd-haltestellen.csv.
 * @param {string|Buffer} platformsCsv - wienerlinien-ogd-haltepunkte.csv.
 * @returns {Array<[string, string, string[], string, string[]]>} `[name, DIVA
 * number, StopIDs, town, other names]`, sorted by name; the town is '' in
 * Vienna; the other names are those of its platforms when they differ (the
 * displays say "Währinger Straße, Volksoper U", the stop list "Währinger
 * Straße-Volksoper").
 */
function parseStops(stopsCsv, platformsCsv) {
  const numeric = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  const clean = (value) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const town = (value) => (fold(value) === HOME_TOWN ? '' : clean(value));
  const byDiva = new Map();
  for (const row of parseCsv(stopsCsv)) {
    const diva = clean(row.DIVA);
    const name = clean(row.PlatformText);
    if (/^\d+$/.test(diva) && name) {
      byDiva.set(diva, {
        name,
        town: town(row.Municipality),
        sides: new Set(),
        names: new Set(),
      });
    }
  }
  for (const row of parseCsv(platformsCsv)) {
    const diva = clean(row.DIVA);
    const id = clean(row.StopID);
    if (!/^\d+$/.test(diva) || !/^\d+$/.test(id)) {
      continue;
    }
    // A stop known by its platforms only takes the name of the first one.
    const name = clean(row.StopText);
    if (!byDiva.has(diva) && name) {
      byDiva.set(diva, {
        name,
        town: town(row.Municipality),
        sides: new Set(),
        names: new Set(),
      });
    }
    const entry = byDiva.get(diva);
    if (entry) {
      entry.sides.add(id);
      if (name && fold(name) !== fold(entry.name)) {
        entry.names.add(name);
      }
    }
  }
  return [...byDiva.entries()]
    .map(([diva, entry]) => [
      entry.name,
      diva,
      [...entry.sides].sort(numeric),
      entry.town,
      [...entry.names].sort(),
    ])
    .sort((a, b) => a[0].localeCompare(b[0], 'de') || numeric(a[1], b[1]));
}

/**
 * @description The mode of a `MeansOfTransport` (or vehicle `type`) of
 * Wiener Linien.
 * @param {unknown} type - ptMetro, ptTram, ptTramWLB, ptBusCity, ptBusNight,
 * ptRufBus, ptTrainS…
 * @returns {string} MODES ('bus' when unknown).
 * @example
 * modeOfType('ptTramWLB'); // -> 'tram'
 */
function modeOfType(type) {
  const text = String(type ?? '').toLowerCase();
  if (text.startsWith('ptmetro')) {
    return MODES.METRO;
  }
  if (text.startsWith('pttram')) {
    return MODES.TRAM;
  }
  if (text.startsWith('pttrain')) {
    return MODES.TRAIN;
  }
  return MODES.BUS;
}

/**
 * @description The mode a line name suggests, for a line the list ignores.
 * @param {string} name - "U1", "S45", "18", "D", "13A".
 * @returns {string} MODES.
 */
function modeOfName(name) {
  const text = String(name ?? '')
    .trim()
    .toUpperCase();
  if (/^U\d/.test(text)) {
    return MODES.METRO;
  }
  if (/^S\d/.test(text)) {
    return MODES.TRAIN;
  }
  return /^(\d{1,2}|[DO])$/.test(text) ? MODES.TRAM : MODES.BUS;
}

/**
 * @description The lines of wienerlinien-ogd-linien.csv.
 * @param {string|Buffer} csv - The file.
 * @returns {Array<{ id: string, name: string, mode: string, color: string }>}
 * The lines: metro, trams, buses, then trains, each by name.
 */
function parseLines(csv) {
  const byId = new Map();
  for (const row of parseCsv(csv)) {
    const name = String(row.LineText ?? '').trim();
    const id = name.toUpperCase();
    if (id && !byId.has(id)) {
      byId.set(id, { id, name, mode: modeOfType(row.MeansOfTransport), color: '' });
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) ||
      a.name.localeCompare(b.name, 'de', { numeric: true }),
  );
}

/**
 * @description The stop of a group of codes.
 * @param {string} name - Its name.
 * @param {string[]} codes - The codes asked (DIVA numbers or one StopID).
 * @param {string[]} [sides] - The StopIDs of its platforms, when known.
 * @returns {{ id: string, name: string, codes: string[], sides: string[] }}
 * The stop: `id` the codes joined by "-" ("60201510", "147").
 */
function stopOf(name, codes, sides = []) {
  return { id: codes.join('-').toLowerCase(), name, codes, sides };
}

/**
 * @description The stop made of some rows of the list (one name).
 * @param {Array} rows - parseStops() rows of the same name.
 * @returns {object} The stop.
 */
/**
 * @description The folded names of a row of the list: its own, then those of
 * its platforms.
 * @param {Array} row - A parseStops() row.
 * @returns {string[]} The names.
 */
const namesOfRow = (row) => [row[0], ...(row[4] ?? [])].map(fold);

/**
 * @description Whether a name of a row holds every word.
 * @param {Array} row - A parseStops() row.
 * @param {string[]} words - Folded words.
 * @returns {boolean} True when one of its names does.
 */
const holds = (row, words) =>
  namesOfRow(row).some((name) => words.every((word) => ` ${name} `.includes(` ${word}`)));

const stopOfRows = (rows) =>
  stopOf(
    rows[0][0],
    rows.map(([, diva]) => diva),
    rows.flatMap(([, , sides]) => sides),
  );

/**
 * @description Find a stop among the known ones.
 * @param {Array} stops - parseStops().
 * @param {string} typed - Its code, its name, or words of its name.
 * @returns {object|null} The stop, null when unknown or when the words fit
 * several stops.
 */
function findStop(stops, typed) {
  const text = String(typed ?? '').trim();
  if (!text) {
    return null;
  }
  if (isStopCode(text)) {
    // A code the list does not know (a new stop) is still asked to the API.
    if (isDiva(text)) {
      const known = stops.find(([, diva]) => diva === text);
      return stopOf(known?.[0] ?? text, [text], known?.[2] ?? []);
    }
    const known = stops.find(([, , sides]) => sides.includes(text));
    return stopOf(known?.[0] ?? text, [text], [text]);
  }
  const wanted = fold(text);
  const exact = stops.filter(([name]) => fold(name) === wanted);
  if (exact.length > 0) {
    return stopOfRows(exact);
  }
  // The name read on a display, when one stop only carries it.
  const alias = stops.filter((row) => namesOfRow(row).includes(wanted));
  if (alias.length === 1) {
    return stopOfRows(alias);
  }
  const words = wanted.split(' ').filter(Boolean);
  const holding = stops.filter((row) => holds(row, words));
  // Several rows of one name are one stop to the user.
  const names = new Set(holding.map(([name]) => fold(name)));
  return names.size === 1 ? stopOfRows(holding) : null;
}

/**
 * @description Search stops by name, for the "Find a stop" button.
 * @param {Array} stops - parseStops().
 * @param {string} query - Words of the name.
 * @param {number} [max] - The longest list.
 * @returns {{ found: Array<{ name: string, codes: string[], town: string }>, total: number }}
 * The best matches first (the name starting with the words), and their count.
 */
function searchStops(stops, query, max = 12) {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) {
    return { found: [], total: 0 };
  }
  const wanted = words.join(' ');
  const matches = stops
    .filter((row) => holds(row, words))
    .map(([name, diva, , town]) => {
      const folded = fold(name);
      let score = 2;
      if (folded === wanted) {
        score = 0;
      } else if (folded.startsWith(wanted) || folded.includes(` ${wanted}`)) {
        score = 1;
      }
      return { name, codes: [diva], town: town ?? '', score };
    })
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'de'));
  return {
    found: matches.slice(0, max).map(({ name, codes, town }) => ({ name, codes, town })),
    total: matches.length,
  };
}

/**
 * @description A typed line, folded, without the words around its name.
 * @param {string} typed - "Linie 13A", "tram 18", "U-Bahn U1".
 * @returns {string} "13a", "18", "u1".
 */
function typedLine(typed) {
  const folded = fold(typed);
  const bare = folded
    .replace(/\b[us] bahn\b/g, ' ')
    .replace(LINE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return bare || folded;
}

/**
 * @description Find a line.
 * @param {Array} lines - parseLines().
 * @param {string} typed - Its name ("U1", "Linie 13A", "tram 18", "D").
 * @returns {object|null} The line.
 */
function findLine(lines, typed) {
  const wanted = typedLine(typed);
  if (!wanted) {
    return null;
  }
  return (
    lines.find((line) => fold(line.name) === wanted) ??
    // "U 1" for "U1".
    lines.find((line) => fold(line.name) === wanted.replace(/ /g, '')) ??
    null
  );
}

/**
 * @description Split a typed list of lines: "U1, 13A, D" or "U1 13A D".
 * @param {string} raw - The list.
 * @returns {string[]} The lines typed.
 */
function splitLines(raw) {
  return String(raw ?? '')
    .split(/[,;|]+/)
    .flatMap((part) => {
      const trimmed = part.trim();
      // "U1 13A D" without commas: each word is a line, unless it reads "tram 18".
      const named = typedLine(trimmed) !== fold(trimmed);
      return /\s/.test(trimmed) && !named ? trimmed.split(/\s+/) : [trimmed];
    })
    .filter(Boolean);
}

/**
 * @description The stops and lines, read from the open data files and kept
 * in the store.
 * @param {object} options - Options.
 * @param {object} options.store - The store (`data.network`, `save()`).
 * @param {Function} [options.fetch] - The fetch function (tests).
 * @param {Function} options.now - `() => number` in ms.
 * @param {object} [options.logger] - Logger.
 * @param {string} [options.dataUrl] - The folder of the files (tests).
 * @returns {object} `{ load, resolveStop, searchStops, resolveLine, lineById, lines }`.
 */
function createNetwork({
  store,
  fetch: fetchFn = globalThis.fetch,
  now,
  logger,
  dataUrl = DATA_URL,
}) {
  let pending = null;

  /**
   * @description Read one file.
   * @param {string} name - Its name.
   * @returns {Promise<string>} Its text.
   */
  async function file(name) {
    let response;
    try {
      response = await fetchFn(`${dataUrl}/${name}`, {
        headers: { accept: 'text/csv, text/plain, */*', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new NetworkError('unreachable', err.cause?.code ?? err.message);
    }
    if (!response.ok) {
      throw new NetworkError(
        response.status >= 500 ? 'unreachable' : 'invalid',
        `${name}: HTTP ${response.status}`,
      );
    }
    const text = await response.text();
    if (text.length > MAX_FILE_BYTES) {
      throw new NetworkError('invalid', `${name}: ${text.length} characters`);
    }
    return text;
  }

  /**
   * @description Read the stops and lines.
   * @returns {Promise<{ stops: Array, lines: Array }>} The network.
   */
  async function download() {
    const stops = parseStops(await file(FILES.stops), await file(FILES.platforms));
    const lines = parseLines(await file(FILES.lines));
    if (stops.length === 0) {
      throw new NetworkError('invalid', 'no stop in the stop list');
    }
    logger?.info(`${stops.length} stops and ${lines.length} lines read from ${dataUrl}`);
    return { stops, lines };
  }

  /**
   * @description The network, read again when older than seven days (or when
   * forced). A failed reading keeps the network already known.
   * @param {boolean} [force] - Read again now.
   * @returns {Promise<{ stops: Array, lines: Array }>} The network.
   */
  async function load(force = false) {
    const kept = store.data.network;
    const known = Array.isArray(kept.stops) && kept.stops.length > 0;
    if (known && !force && now() - (kept.readAt ?? 0) < NETWORK_MAX_AGE_MS) {
      return kept;
    }
    if (!pending) {
      pending = download()
        .then(async (read) => {
          store.data.network = { ...read, readAt: now() };
          await store.save();
          return store.data.network;
        })
        .finally(() => {
          pending = null;
        });
    }
    try {
      return await pending;
    } catch (err) {
      if (known && !force) {
        logger?.warn(`Network not read again (${err.kind ?? 'error'}): ${err.message}`);
        return kept;
      }
      throw err;
    }
  }

  const keptLines = () => (Array.isArray(store.data.network.lines) ? store.data.network.lines : []);

  return {
    load,
    /**
     * @description Resolve a typed stop. A code is accepted even when the
     * list cannot be read.
     * @param {string} typed - Its code or name.
     * @returns {Promise<object|null>} The stop.
     */
    resolveStop: async (typed) => {
      if (isStopCode(typed)) {
        const known = store.data.network.stops ?? [];
        if (known.length === 0) {
          try {
            return findStop((await load()).stops, typed);
          } catch {
            return findStop([], typed);
          }
        }
        return findStop(known, typed);
      }
      return findStop((await load()).stops, typed);
    },
    searchStops: async (query, max) => searchStops((await load()).stops, query, max),
    /**
     * @description Resolve a typed line. Unknown to the list (or the list out
     * of reach): the line as typed, its mode guessed from its name.
     * @param {string} typed - "U1", "Linie 13A", "tram 18".
     * @returns {Promise<object|null>} The line, null when nothing was typed.
     */
    resolveLine: async (typed) => {
      const wanted = typedLine(typed);
      if (!wanted) {
        return null;
      }
      let lines = keptLines();
      if (lines.length === 0) {
        lines = await load()
          .then((network) => network.lines ?? [])
          .catch(() => []);
      }
      const name = wanted.replace(/ /g, '').toUpperCase();
      return (
        findLine(lines, typed) ?? {
          id: name,
          name,
          mode: modeOfName(name),
          color: '',
          unknown: true,
        }
      );
    },
    /**
     * @description A line by its id, without reading anything.
     * @param {string} id - "U1", "13A".
     * @returns {object|null} The line.
     */
    lineById: (id) =>
      keptLines().find((line) => line.id === String(id ?? '').toUpperCase()) ?? null,
    lines: keptLines,
  };
}

export {
  DATA_URL,
  FILES,
  NETWORK_MAX_AGE_MS,
  MODES,
  NetworkError,
  fold,
  slug,
  isStopCode,
  parseCsv,
  parseStops,
  modeOfType,
  modeOfName,
  parseLines,
  stopOf,
  findStop,
  searchStops,
  typedLine,
  findLine,
  splitLines,
  createNetwork,
};
