// -----------------------------------------------------------------------------
// The answer of the monitor service -> the passages of a stop.
//
// `data.monitors[]`, one per platform and line, each with:
//   - `locationStop.properties`: `name` the DIVA number of the stop, `title`
//     its name, `attributes.rbl` the StopID of the platform;
//   - `lines[]`: `name` ("U1", "13A"), `towards` (the destination), `direction`
//     ("H" out, "R" back), `platform`, `type` (ptMetro, ptTram, ptBusCity…),
//     `barrierFree`, `realtimeSupported`, `trafficjam`, and
//     `departures.departure[]`:
//       `departureTime.timePlanned`   the time of the timetable;
//       `departureTime.timeReal`      the forecast, only when followed live;
//       `departureTime.countdown`     the minutes left;
//       `vehicle`                     only when it differs from the line (a
//                                     short run to another destination, a
//                                     vehicle without low floor…).
// The delay of a passage is its forecast minus its timetable time. The API
// lists no cancelled trip. Its times are ISO 8601 with their offset
// ("2026-11-12T21:59:00.000+0100"); without one, Vienna time.
// -----------------------------------------------------------------------------

import { fold, typedLine, modeOfType, MODES } from './network.js';
import { wallToInstant } from './time.js';

/**
 * @description A value that may be a list or one element.
 * @param {unknown} value - The value.
 * @returns {Array} The list ([] when absent).
 */
function asList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value && typeof value === 'object' ? [value] : [];
}

/**
 * @description The instant of an ISO date and time of the API.
 * @param {unknown} value - "2026-11-12T21:59:00.000+0100" (Vienna time without offset).
 * @returns {number|null} The instant (ms).
 * @example
 * parseInstant('2026-11-12T21:59:00.000+0100'); // -> 2026-11-12T20:59:00Z
 */
function parseInstant(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      String(value ?? '').trim(),
    );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second = '0', zone] = match;
  const wall = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (!zone) {
    return wallToInstant(wall);
  }
  if (zone === 'Z') {
    return wall;
  }
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  return wall - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60000;
}

/**
 * @description A name as shown: the displays pad the destinations with spaces.
 * @param {unknown} value - "Karlsplatz U   ".
 * @returns {string} "Karlsplatz U".
 */
const cleanName = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * @description Split a typed direction into the words to look for.
 * @param {string} direction - "Oberlaa | Reumannplatz".
 * @returns {string[]} The folded alternatives.
 */
function directionTerms(direction) {
  return String(direction ?? '')
    .split('|')
    .map(fold)
    .filter(Boolean);
}

/**
 * @description Whether a passage is of a line.
 * @param {object} passage - The passage (`lineId`, `line`, `mode`).
 * @param {object|null} line - The resolved line, null for every line; a mode
 * alone ("U-Bahn", "tram", "bus") as `{ modeOnly }`.
 * @returns {boolean} True when it is.
 */
function matchesLine(passage, line) {
  if (!line) {
    return true;
  }
  if (line.modeOnly) {
    return passage.mode === line.modeOnly;
  }
  return (
    passage.lineId === line.id ||
    fold(passage.line) === fold(line.name) ||
    fold(passage.line) === typedLine(line.name)
  );
}

/**
 * @description The passages of an answer of the monitor service, soonest first.
 * @param {object} answer - The answer.
 * @param {object} [filter] - `{ codes, line, direction }`: the codes of the
 * stop (DIVA numbers or StopIDs; every monitor when absent), the resolved
 * line, the typed direction.
 * @returns {object[]} The passages: `{ lineId, line, mode, destination,
 * direction, stopCode, diva, stopName, platform, at, planned, delay, realtime,
 * barrierFree, jam, trip }`.
 */
function parsePassages(answer, { codes, line = null, direction = '' } = {}) {
  const terms = directionTerms(direction);
  const wanted = codes ? new Set(codes.map(String)) : null;
  const serverTime = parseInstant(answer?.message?.serverTime);
  const passages = [];
  const seen = new Set();
  for (const monitor of asList(answer?.data?.monitors)) {
    const properties = monitor?.locationStop?.properties ?? {};
    const diva = String(properties.name ?? '').trim();
    const stopCode = String(properties.attributes?.rbl ?? '').trim();
    if (wanted && !wanted.has(diva) && !wanted.has(stopCode)) {
      continue;
    }
    for (const row of asList(monitor?.lines)) {
      for (const departure of asList(row?.departures?.departure)) {
        const time = departure?.departureTime ?? {};
        // The vehicle, when given, says what differs from the line.
        const vehicle = { ...row, ...(departure?.vehicle ?? {}) };
        const planned = parseInstant(time.timePlanned);
        const real = parseInstant(time.timeReal);
        const countdown = Number(time.countdown);
        let at = real ?? planned;
        if (!Number.isFinite(at) && Number.isFinite(countdown) && Number.isFinite(serverTime)) {
          at = serverTime + countdown * 60000;
        }
        if (!Number.isFinite(at)) {
          continue;
        }
        const name = cleanName(vehicle.name);
        const passage = {
          lineId: name.toUpperCase(),
          line: name,
          mode: vehicle.type ? modeOfType(vehicle.type) : MODES.BUS,
          destination: cleanName(vehicle.towards),
          direction: ['H', 'R'].includes(vehicle.direction) ? vehicle.direction : null,
          stopCode,
          diva,
          stopName: cleanName(properties.title),
          platform: cleanName(vehicle.platform),
          at,
          planned: Number.isFinite(planned) ? planned : null,
          delay:
            Number.isFinite(real) && Number.isFinite(planned)
              ? Math.round((real - planned) / 60000)
              : null,
          realtime: Number.isFinite(real),
          barrierFree: vehicle.barrierFree === true,
          jam: vehicle.trafficjam === true,
          trip: '',
        };
        // A platform asked by its stop and by its own code lists a visit once.
        const id = `${passage.lineId}|${passage.destination}|${stopCode}|${passage.planned ?? at}`;
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        passages.push(passage);
      }
    }
  }
  return passages
    .filter((passage) => matchesLine(passage, line))
    .filter((passage) => {
      if (terms.length === 0) {
        return true;
      }
      const target = fold(passage.destination);
      return terms.some((term) => target.includes(term));
    })
    .sort((a, b) => a.at - b.at);
}

/**
 * @description The minutes left before a passage.
 * @param {object} passage - The passage.
 * @param {number} now - Now (ms).
 * @returns {number} Whole minutes (rounded down, like the screens).
 */
function minutesLeft(passage, now) {
  return Math.max(0, Math.floor((passage.at - now) / 60000));
}

/**
 * @description The passages not gone yet.
 * @param {object[]} passages - The passages.
 * @param {number} now - Now (ms).
 * @returns {object[]} The passages to come.
 */
const upcomingPassages = (passages, now) => passages.filter((passage) => passage.at > now - 30000);

/**
 * @description Who a passage is, across readings: line and destination.
 * @param {object} passage - The passage.
 * @returns {string} "u1|oberlaa".
 */
const routeOf = (passage) => `${fold(passage.line)}|${fold(passage.destination)}`;

export {
  MODES,
  asList,
  parseInstant,
  cleanName,
  directionTerms,
  matchesLine,
  parsePassages,
  minutesLeft,
  upcomingPassages,
  routeOf,
};
