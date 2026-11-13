// -----------------------------------------------------------------------------
// HTTP client of the official real-time API of Wiener Linien (Vienna):
// https://www.wienerlinien.at/ogd_realtime, described by
// https://www.wienerlinien.at/ogd_realtime/doku/ogd/wienerlinien-echtzeitdaten-dokumentation.pdf
// (version 1.6, JSON only). Open data of the City of Vienna (CC BY 4.0),
// without any key or account.
//
// Services used:
//   monitor            the departures of the next 70 minutes of some stops:
//                      `diva` (a whole stop, every platform) and `stopId` (one
//                      platform, the former "RBL number"), both repeated — one
//                      request reads every followed stop;
//   trafficInfoList    the disruptions of the control centre (`stoerunglang`),
//                      the special texts of the stop displays (`stoerungkurz`)
//                      and the elevators out of service (`aufzugsinfo`).
//
// Every answer is `{ data, message: { value, messageCode, serverTime } }`,
// with HTTP 200 even for an error: `messageCode` 1 is a success, 311 the
// database out of reach, 312 an unknown stop, 316 the request limit reached,
// 320 / 321 a wrong or missing parameter, 322 no data.
//
// The API publishes no cache header: an answer is kept 15 seconds, so a widget
// and a timer asking together make one request.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const BASE_URL = process.env.WL_API_URL || 'https://www.wienerlinien.at/ogd_realtime';
const TIMEOUT_MS = 20000;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const USER_AGENT = `gladys-wiener-linien/${version} (+https://github.com/William-De71/gladys-wiener-linien)`;
const MAX_AGE_MS = 15000;
const OK_CODE = 1;
const CATEGORIES = { LONG: 'stoerunglang', SHORT: 'stoerungkurz', ELEVATOR: 'aufzugsinfo' };
// A DIVA number (a whole stop) has 8 digits, a StopID (one platform) 1 to 5.
const DIVA_MIN_DIGITS = 7;

class WlError extends Error {
  /**
   * @param {string} kind - `throttled`, `busy`, `unreachable` or `invalid`.
   * @param {string} message - The detail.
   * @param {object} [extra] - `{ status, code }`.
   */
  constructor(kind, message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'WlError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/**
 * @description The kind of an HTTP error answer.
 * @param {number} status - The HTTP status.
 * @returns {string} WlError kind.
 */
function kindOf(status) {
  if (status === 429) {
    return 'throttled';
  }
  if (status === 503 || status === 504) {
    return 'busy';
  }
  return status >= 500 || status === 403 ? 'unreachable' : 'invalid';
}

/**
 * @description The kind of a `messageCode` of the API.
 * @param {number} code - The code (1 is a success).
 * @returns {string} WlError kind.
 * @example
 * kindOfCode(316); // -> 'throttled'
 */
function kindOfCode(code) {
  if (code === 316) {
    return 'throttled';
  }
  if (code === 311 || code === 322) {
    return 'busy';
  }
  return 'invalid';
}

/**
 * @description Whether a code is a DIVA number (a whole stop).
 * @param {unknown} code - "60201510" or "147".
 * @returns {boolean} True for a DIVA number.
 */
const isDiva = (code) => /^\d+$/.test(String(code ?? '')) && String(code).length >= DIVA_MIN_DIGITS;

/**
 * @description A client of the API.
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - The fetch function (tests).
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {string} [options.baseUrl] - The API root (tests).
 * @returns {object} `{ monitor, trafficInfoList, requests, clear }`.
 */
function createWlClient({
  fetch: fetchFn = globalThis.fetch,
  now = () => Date.now(),
  baseUrl = BASE_URL,
} = {}) {
  // Requests made, for the diagnostic.
  const requests = { total: 0, cached: 0, failed: 0, last: null, lastError: null };
  // URL -> { json, until }: the answers still valid.
  const cache = new Map();

  /**
   * @description GET a service, or its answer kept while still valid.
   * @param {string} path - "monitor".
   * @param {URLSearchParams} query - The parameters.
   * @returns {Promise<object>} The JSON answer (`{ data, message }`).
   */
  async function get(path, query) {
    const url = `${baseUrl}/${path}?${query}`;
    const kept = cache.get(url);
    if (kept && kept.until > now()) {
      requests.cached += 1;
      return kept.json;
    }
    requests.total += 1;
    requests.last = now();
    const failure = (kind, message, extra) => {
      requests.failed += 1;
      const error = new WlError(kind, message, extra);
      requests.lastError = `${kind}: ${error.message}`;
      return error;
    };
    let response;
    try {
      response = await fetchFn(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw failure('unreachable', err.cause?.code ?? err.message);
    }
    const body = await response.text().catch(() => '');
    let json;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    const code = Number(json?.message?.messageCode);
    const said = String(json?.message?.value ?? '').slice(0, 160);
    if (!response.ok) {
      const detail = [`HTTP ${response.status}`, said].filter(Boolean).join(' ');
      throw failure(
        Number.isFinite(code) && code !== OK_CODE ? kindOfCode(code) : kindOf(response.status),
        detail,
        { status: response.status, code: Number.isFinite(code) ? code : null },
      );
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      // A page of the web protection instead of the API.
      throw failure('unreachable', `${path}: not a JSON object`);
    }
    if (Number.isFinite(code) && code !== OK_CODE) {
      throw failure(kindOfCode(code), `${code} ${said}`.trim(), { status: response.status, code });
    }
    cache.set(url, { json, until: now() + MAX_AGE_MS });
    // Old answers go: the stops change with the configuration.
    for (const [address, entry] of cache) {
      if (entry.until <= now()) {
        cache.delete(address);
      }
    }
    return json;
  }

  /**
   * @description The departures of some stops, in one request.
   * @param {object} options - Options.
   * @param {string[]} options.codes - DIVA numbers ("60201510", a whole stop)
   * and StopIDs ("147", one platform).
   * @returns {Promise<object>} The answer (`data.monitors`, `message.serverTime`).
   */
  function monitor({ codes }) {
    const query = new URLSearchParams();
    const wanted = [...new Set(codes.map(String))].sort();
    wanted.filter(isDiva).forEach((code) => query.append('diva', code));
    wanted.filter((code) => !isDiva(code)).forEach((code) => query.append('stopId', code));
    return get('monitor', query);
  }

  /**
   * @description The disruptions, the texts of the stop displays and, when
   * asked, the elevators out of service.
   * @param {object} [options] - Options.
   * @param {boolean} [options.elevators] - With the elevators.
   * @returns {Promise<object>} The answer (`data.trafficInfos`,
   * `data.trafficInfoCategories`).
   */
  function trafficInfoList({ elevators = false } = {}) {
    const query = new URLSearchParams();
    query.append('name', CATEGORIES.LONG);
    query.append('name', CATEGORIES.SHORT);
    if (elevators) {
      query.append('name', CATEGORIES.ELEVATOR);
    }
    return get('trafficInfoList', query);
  }

  return { requests, monitor, trafficInfoList, clear: () => cache.clear() };
}

export {
  BASE_URL,
  USER_AGENT,
  MAX_AGE_MS,
  CATEGORIES,
  WlError,
  kindOf,
  kindOfCode,
  isDiva,
  createWlClient,
};
