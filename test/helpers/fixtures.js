// A fake Wiener Linien for the tests, served through the `fetch` option of
// the integration: the open data files (stops, platforms and lines, reduced
// from the real ones of 2026-11-12, CC BY 4.0) and the real-time API (monitor,
// trafficInfoList).
//
// The answers of the API are built with the fields, the formats and the
// error answers recorded from the real API on 2026-11-12 (version 1.6): the
// times with their "+0100" offset, the HTTP 200 of an error with its
// `messageCode`, the categories of the traffic infos. Tests never touch the
// network.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 2026-11-12 21:30:00 in Vienna: the time of the answers.
const NOW = Date.parse('2026-11-12T20:30:00Z');
const TZ = 'Europe/Vienna';
const API_URL = 'https://www.wienerlinien.at/ogd_realtime';
const DATA_URL = 'https://www.wienerlinien.at/ogd_realtime/doku/ogd';

const text = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const STOPS_CSV = text('ogd/wienerlinien-ogd-haltestellen.csv');
const PLATFORMS_CSV = text('ogd/wienerlinien-ogd-haltepunkte.csv');
const LINES_CSV = text('ogd/wienerlinien-ogd-linien.csv');
const FILES = {
  'wienerlinien-ogd-haltestellen.csv': STOPS_CSV,
  'wienerlinien-ogd-haltepunkte.csv': PLATFORMS_CSV,
  'wienerlinien-ogd-linien.csv': LINES_CSV,
};

const KARLSPLATZ = '60200657';
const VOLKSOPER = '60201510';

/**
 * @description A temporary path for the file kept in /data.
 * @returns {string} The path (its directory exists, the file does not).
 */
const storePath = () => join(mkdtempSync(join(tmpdir(), 'wiener-linien-')), 'wiener-linien.json');

/**
 * @description "2026-11-12T21:35:00.000+0100": a time of the API, minutes after NOW.
 * @param {number} minutes - Minutes after NOW (21:30 in Vienna).
 * @returns {string} The time, Vienna wall clock with its offset.
 */
function at(minutes) {
  const wall = new Date(NOW + 3600000 + minutes * 60000).toISOString().slice(0, 19);
  return `${wall}.000+0100`;
}

/**
 * @description A departure of a monitor line.
 * @param {number} minutes - Minutes after NOW of its forecast.
 * @param {object} [options] - `{ delay, realtime, vehicle }`: minutes behind
 * the timetable, followed live or not, what differs from the line.
 * @returns {object} The departure.
 */
function departure(minutes, { delay = 0, realtime = true, vehicle = null } = {}) {
  const departureTime = { timePlanned: at(minutes - delay), countdown: minutes };
  if (realtime) {
    departureTime.timeReal = at(minutes);
  }
  return vehicle ? { departureTime, vehicle } : { departureTime };
}

/**
 * @description A monitor: one platform and one line.
 * @param {object} [options] - What differs from the U1 towards Oberlaa at
 * Karlsplatz (platform 4120).
 * @returns {object} The monitor.
 */
function monitor({
  diva = KARLSPLATZ,
  rbl = 4120,
  title = 'Karlsplatz',
  name = 'U1',
  towards = 'Oberlaa',
  direction = 'H',
  type = 'ptMetro',
  lineId = 301,
  barrierFree = true,
  departures = [departure(3, { delay: 1 }), departure(9)],
} = {}) {
  return {
    locationStop: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [16.3689933, 48.2012308] },
      properties: {
        name: diva,
        title,
        municipality: 'Wien',
        municipalityId: 49000001,
        type: 'stop',
        coordName: 'WGS84',
        attributes: { rbl },
      },
    },
    lines: [
      {
        name,
        // The displays pad the destinations.
        towards: `${towards}   `,
        direction,
        platform: '1',
        richtungsId: direction === 'H' ? '1' : '2',
        barrierFree,
        realtimeSupported: true,
        trafficjam: false,
        departures: { departure: departures },
        type,
        lineId,
      },
    ],
    attributes: {},
  };
}

const message = (extra = {}) => ({ value: 'OK', messageCode: 1, serverTime: at(0), ...extra });

const CATEGORIES = [
  { id: 1, refTrafficInfoCategoryGroupId: 1, name: 'aufzugsinfo', title: 'Aufzugsstörungen' },
  { id: 2, refTrafficInfoCategoryGroupId: 1, name: 'stoerunglang', title: 'Störung Lang' },
  { id: 3, refTrafficInfoCategoryGroupId: 1, name: 'stoerungkurz', title: 'Störung Kurz' },
];

/**
 * @description A disruption of the control centre (`stoerunglang`).
 * @param {object} [options] - What differs from an incident on the U4.
 * @returns {object} The traffic info.
 */
function disruption({
  name = 'I20261112-0058-F01',
  parent = name.replace(/-F\d+$/, ''),
  title = 'U4: Schadhaftes Fahrzeug',
  description = 'Linie U4: Nach einer Fahrtbehinderung kommt es zu unterschiedlichen Intervallen.',
  lines = ['U4'],
  stops = [4416],
  start = -20,
  end = 60,
  status = 'active',
  english = null,
} = {}) {
  const languages = [{ de: { title, descriptionPlain: description } }];
  if (english) {
    languages.push({ en: { title: english[0], descriptionPlain: english[1] } });
  }
  return {
    refTrafficInfoCategoryId: 2,
    alertCauseId: 255,
    alertCause: 'undefined alert cause',
    reasonId: 0,
    reasonName: 'undefined',
    name,
    parentName: parent,
    priority: '1',
    owner: 'WL',
    title,
    description,
    descriptionHTML: `<p>${description}</p>`,
    languages,
    time: {
      start: at(start),
      end: end === null ? undefined : at(end),
      created: at(start),
      lastUpdate: at(0),
    },
    status,
    relatedLines: lines,
    relatedStops: stops,
  };
}

/**
 * @description The special text of the display of one platform (`stoerungkurz`).
 * @param {object} [options] - What differs from works on the 41 at platform 189.
 * @returns {object} The traffic info.
 */
function notice({
  stop = 189,
  line = '41',
  lineId = 141,
  description = 'Gleisbauarbeiten\nBetrieb ab Gersthof',
  start = -600,
  end = 600,
} = {}) {
  return {
    refTrafficInfoCategoryId: 3,
    alertCauseId: 255,
    alertCause: 'undefined alert cause',
    reasonId: 0,
    reasonName: 'undefined',
    name: `R${stop}-${lineId}`,
    parentName: `R${stop}-${lineId}`,
    priority: '1',
    owner: 'WL',
    title: description,
    description,
    time: { start: at(start), end: at(end) },
    relatedLines: line ? [line] : [],
    relatedStops: [stop],
  };
}

/**
 * @description An elevator out of service (`aufzugsinfo`).
 * @param {object} [options] - What differs from an elevator of the U1 at Karlsplatz.
 * @returns {object} The traffic info.
 */
function elevator({
  name = 'ftazS_83',
  station = 'Karlsplatz',
  location = 'U1 Bahnsteig Richtung Oberlaa - Passage',
  lines = ['U1'],
  stops = [4120, 4109],
  reason = 'Geplante Wartung wird durchgeführt.',
} = {}) {
  return {
    refTrafficInfoCategoryId: 1,
    alertCauseId: 255,
    alertCause: 'undefined alert cause',
    reasonId: 0,
    reasonName: 'undefined',
    name,
    parentName: name,
    title: station,
    description: location,
    elevatorId: 'KP 04',
    attributes: {
      reason,
      relatedLines: lines,
      station,
      location,
      towards: `${lines[0]} beide Richtungen`,
      relatedStops: stops,
      status: 'außer Betrieb',
    },
    // The next maintenance slot, not the outage.
    time: { start: at(60 * 24 * 5), end: at(60 * 24 * 5 + 240) },
    relatedLines: lines,
    relatedStops: stops,
  };
}

/**
 * @description An answer of trafficInfoList.
 * @param {object[]} infos - The traffic infos.
 * @returns {object} The answer.
 */
function trafficInfoList(infos) {
  const used = new Set(infos.map((info) => info.refTrafficInfoCategoryId));
  return {
    data: {
      trafficInfos: infos,
      trafficInfoCategories: CATEGORIES.filter((category) => used.has(category.id)).map(
        (category) => ({
          ...category,
          trafficInfoNameList: infos
            .filter((info) => info.refTrafficInfoCategoryId === category.id)
            .map((info) => info.name)
            .join(', '),
        }),
      ),
      trafficInfoCategoryGroups: [
        { id: 1, name: 'betriebsinformationechtzeit', title: 'Betriebsinformation (Echtzeit)' },
      ],
    },
    message: message(),
  };
}

// Karlsplatz: the U1 both ways, the U4, the bus 4A from the timetable only.
// Währinger Straße-Volksoper: the trams 40 and 41, one platform each.
const MONITORS = [
  monitor(),
  monitor({ rbl: 4109, towards: 'Leopoldau', direction: 'R', departures: [departure(4)] }),
  monitor({
    rbl: 4416,
    name: 'U4',
    towards: 'Hütteldorf',
    lineId: 304,
    departures: [departure(6, { delay: 4 })],
  }),
  monitor({
    rbl: 2610,
    title: 'Karlsplatz U',
    name: '4A',
    towards: 'Wittelsbachstraße',
    type: 'ptBusCity',
    lineId: 404,
    departures: [departure(12, { realtime: false })],
  }),
  monitor({
    diva: VOLKSOPER,
    rbl: 147,
    title: 'Währinger Straße, Volksoper U',
    name: '40',
    towards: 'Schottentor U',
    direction: 'R',
    type: 'ptTram',
    lineId: 140,
    departures: [departure(7)],
  }),
  monitor({
    diva: VOLKSOPER,
    rbl: 189,
    title: 'Währinger Straße, Volksoper U',
    name: '41',
    towards: 'Pötzleinsdorf',
    type: 'ptTram',
    lineId: 141,
    departures: [departure(10)],
  }),
];
const INFOS = [disruption(), notice(), elevator()];

/**
 * @description The fake Wiener Linien.
 * @returns {Function} A fetch function, with `.calls` and `.state`.
 */
function fakeWl() {
  const state = {
    monitors: clone(MONITORS),
    infos: clone(INFOS),
    // 'network', an HTTP status or a messageCode (3xx), for every API request.
    fail: null,
    failFiles: null,
  };
  const calls = [];

  /**
   * @description The fetch function.
   * @param {string} url - The URL.
   * @returns {Promise<Response>} The answer.
   */
  async function fetchFn(url) {
    const parsed = new URL(url);
    const service = parsed.pathname.split('/').pop();
    calls.push({
      url,
      path: parsed.pathname,
      service,
      divas: parsed.searchParams.getAll('diva'),
      stopIds: parsed.searchParams.getAll('stopId'),
      names: parsed.searchParams.getAll('name'),
    });
    if (url.startsWith(`${DATA_URL}/`)) {
      if (state.failFiles) {
        return new Response('Bad Gateway', { status: state.failFiles });
      }
      return FILES[service]
        ? new Response(FILES[service], { status: 200, headers: { 'content-type': 'text/csv' } })
        : new Response('Not Found', { status: 404 });
    }
    if (!url.startsWith(API_URL)) {
      return new Response('Not Found', { status: 404 });
    }
    if (state.fail === 'network') {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    if (typeof state.fail === 'number' && state.fail >= 400) {
      return new Response('<html>Service Unavailable</html>', { status: state.fail });
    }
    if (typeof state.fail === 'number') {
      // The API answers its errors with HTTP 200.
      return Response.json({
        message: message({ value: 'Abfragelimit erreicht!', messageCode: state.fail }),
      });
    }
    if (service === 'monitor') {
      const divas = parsed.searchParams.getAll('diva');
      const stopIds = parsed.searchParams.getAll('stopId');
      if (divas.length === 0 && stopIds.length === 0) {
        return Response.json({
          message: message({
            value: 'GET Anfrage Parameter fehlt (stopId oder diva)!',
            messageCode: 321,
          }),
        });
      }
      const monitors = state.monitors.filter(
        (entry) =>
          divas.includes(entry.locationStop.properties.name) ||
          stopIds.includes(String(entry.locationStop.properties.attributes.rbl)),
      );
      return Response.json({ data: { monitors }, message: message() });
    }
    if (service === 'trafficInfoList') {
      const names = parsed.searchParams.getAll('name');
      const wanted = new Set(
        CATEGORIES.filter((category) => names.length === 0 || names.includes(category.name)).map(
          (category) => category.id,
        ),
      );
      return Response.json(
        trafficInfoList(state.infos.filter((info) => wanted.has(info.refTrafficInfoCategoryId))),
      );
    }
    return new Response('Not Found', { status: 404 });
  }
  fetchFn.calls = calls;
  fetchFn.state = state;
  fetchFn.apiCalls = (service) => calls.filter((call) => call.service === service);
  return fetchFn;
}

/**
 * @description A minimal Gladys client for the pure builders.
 */
const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:wiener-linien:${type}:${id}`,
    feature: (key) => `ext:wiener-linien:${type}:${id}:${key}`,
  }),
};

export {
  NOW,
  TZ,
  API_URL,
  DATA_URL,
  KARLSPLATZ,
  VOLKSOPER,
  STOPS_CSV,
  PLATFORMS_CSV,
  LINES_CSV,
  MONITORS,
  INFOS,
  silent,
  storePath,
  clone,
  at,
  departure,
  monitor,
  disruption,
  notice,
  elevator,
  trafficInfoList,
  fakeWl,
  fakeGladys,
};
