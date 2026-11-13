// -----------------------------------------------------------------------------
// Configuration of the Wiener Linien integration. The API needs no key.
//
// Fields of the config_schema:
//   - `stop_<n>`              a followed stop (`<n>` from 1 to 3): its name
//                             ("Karlsplatz"), its DIVA number ("60200657",
//                             the whole stop) or a StopID ("4101", one
//                             platform);
//   - `stop_<n>_line`         only this line ("U1", "13A", "D"), or a mode
//                             ("U-Bahn", "tram", "bus"); empty for every line;
//   - `stop_<n>_direction`    only the destinations holding these words
//                             ("Oberlaa | Reumannplatz"), empty for both
//                             directions;
//   - `lines`                 the lines followed for their traffic, one
//                             device each ("U1, U4, 13A");
//   - `elevators`             count the elevators out of service among the
//                             traffic messages (off by default);
//   - `interval`              seconds between two readings of the stops;
//   - `language`              language of the texts Gladys does not ask for in
//                             a language (device names, scene summaries):
//                             `auto` follows the last widget request.
//
// Internal keys, outside the config_schema (never shown in the UI, stored by
// setConfig):
//   - `added_stops`           the stops added with the "Add a stop" button,
//                             `[{ stop, line, direction }]`: as many as the
//                             user wants (MAX_ADDED_STOPS), next to the three
//                             of the form. Kept in the Gladys database, so
//                             they follow its backups;
//   - `last_language`         language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';
import { splitLines } from './network.js';

const MAX_STOPS = 3;
// Every followed stop is read in one request: a home, a workplace, a school
// and a few more.
const MAX_ADDED_STOPS = 7;
const MAX_LINES = 10;
const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { addedStops: 'added_stops', language: 'last_language' };
const INTERVALS = [30, 60, 120, 300];
const DEFAULT_INTERVAL = 60;

const readString = (raw) => (typeof raw === 'string' ? raw.trim() : '');

/**
 * @description Read the reading interval.
 * @param {unknown} raw - The raw value ("60", 60).
 * @returns {number} Seconds, one of INTERVALS.
 */
function readInterval(raw) {
  const value = Number(raw);
  return INTERVALS.includes(value) ? value : DEFAULT_INTERVAL;
}

/**
 * @description Read the stops added with the configuration buttons.
 * @param {unknown} raw - The stored value: an array (or its JSON text).
 * @returns {Array<{ stop: string, line: string, direction: string }>} The
 * valid entries, MAX_ADDED_STOPS at most.
 * @example
 * parseAddedStops([{ stop: '60200657', line: '', direction: '' }]);
 */
function parseAddedStops(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return (Array.isArray(list) ? list : [])
    .filter((entry) => entry && typeof entry === 'object' && readString(entry.stop))
    .map((entry) => ({
      stop: readString(entry.stop),
      line: readString(entry.line),
      direction: readString(entry.direction),
    }))
    .slice(0, MAX_ADDED_STOPS);
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ stops: [{ slot, stop, line, direction }],
 * addedStops, lines, elevators, interval, language }`; a slot without a stop is left
 * out. `stops` holds the three slots of the form, then the added stops
 * (`slot` null, `added` their position from 1).
 * @example
 * normalizeConfig({ stop_1: 'Karlsplatz', stop_1_line: 'U1' });
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const stops = [];
  for (let slot = 1; slot <= MAX_STOPS; slot += 1) {
    const stop = readString(config[`stop_${slot}`]);
    if (stop) {
      stops.push({
        slot,
        stop,
        line: readString(config[`stop_${slot}_line`]),
        direction: readString(config[`stop_${slot}_direction`]),
      });
    }
  }
  const addedStops = parseAddedStops(config[INTERNAL_KEYS.addedStops]);
  addedStops.forEach((entry, index) => stops.push({ slot: null, added: index + 1, ...entry }));
  return {
    stops,
    addedStops,
    lines: [...new Set(splitLines(config.lines))].slice(0, MAX_LINES),
    elevators: config.elevators === true || config.elevators === 'true',
    interval: readInterval(config.interval),
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

/**
 * @description Read the stored language of the last request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 * @example
 * readLanguage({ last_language: 'fr' }, 'en'); // -> 'fr'
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : fallback;
}

export {
  MAX_STOPS,
  MAX_ADDED_STOPS,
  MAX_LINES,
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  INTERVALS,
  DEFAULT_INTERVAL,
  readInterval,
  parseAddedStops,
  normalizeConfig,
  readLanguage,
};
