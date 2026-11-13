// -----------------------------------------------------------------------------
// The Wiener Linien integration: every handler, registered on a Gladys client.
//
// Brings the metro, trams and buses of Vienna into Gladys through the official
// real-time API of Wiener Linien (open data, no key):
//   - devices (device.js): one per followed stop — the three of the form and
//     the ones added with the "Add a stop" button, filtered by line and
//     direction — with the next passage, the waits, its delay and the count
//     of traffic messages; one per followed line with its traffic state;
//   - scene triggers (events.js): departure soon, line disrupted, back to
//     normal, new traffic message;
//   - scene actions: read the next passages of a stop, the traffic of a line;
//   - dashboard widgets (widgets.js): departures, traffic.
//
// The API has no push: every followed stop is read in ONE monitor request
// every `interval` (30 s to 5 min, 1 min by default; 10 min while no stop
// announces anything in the next 45 minutes), the traffic (trafficInfoList)
// every 5 minutes, on the integration's own timers, never on a Gladys poll.
// An answer is kept 15 seconds (wl-api.js). The names of the stops and lines
// come from the open data files of Wiener Linien, kept in /data (network.js).
// Transport: cloud only.
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK (test/app.test.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
  MAX_ADDED_STOPS,
} from './config.js';
import { createWlClient } from './wl-api.js';
import { createNetwork, fold, splitLines, typedLine } from './network.js';
import { createStore, DEFAULT_PATH } from './store.js';
import { parsePassages, upcomingPassages, routeOf } from './departures.js';
import { parseTraffic, lineTraffic, messagesFor } from './traffic.js';
import {
  DEVICE_TYPES,
  stopKey,
  lineKey,
  followedName,
  idsOf,
  parseExternalId,
  buildStopDevice,
  buildStopStates,
  buildLineDevice,
  buildLineStates,
} from './device.js';
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
  TRIGGERS,
  NEXT_DEPARTURES_OUTPUTS,
  LINE_TRAFFIC_OUTPUTS,
} from './events.js';
import {
  WIDGETS,
  BOARD_COUNT,
  messageContent,
  readCount,
  buildDeparturesWidget,
  buildTrafficWidget,
} from './widgets.js';
import { defaultTimeZone, formatTime, MINUTE_MS } from './time.js';
import { t, all, passageWhen, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  SEARCH_STOP: 'search_stop',
  ADD_STOP: 'add_stop',
  REMOVE_STOP: 'remove_stop',
  LIST_STOPS: 'list_stops',
  DIAGNOSTIC: 'diagnostic',
};
const SCENE_ACTIONS = {
  GET_NEXT_DEPARTURES: 'get_next_departures',
  GET_LINE_TRAFFIC: 'get_line_traffic',
};
// While no stop announces anything in QUIET_HORIZON_MS (the night), the stops
// are read this often.
const IDLE_INTERVAL_MS = 10 * MINUTE_MS;
const QUIET_HORIZON_MS = 45 * MINUTE_MS;
const TRAFFIC_INTERVAL_MS = 5 * MINUTE_MS;
// After the request limit is reached (code 316, or a 429), nothing is asked.
const THROTTLE_PAUSE_MS = 5 * MINUTE_MS;
const REMINDER_TICK_MS = 30 * 1000;
const TIMER_TICK_MS = 15 * 1000;
// A widget or a scene action reuses a reading this fresh.
const SNAPSHOT_MAX_AGE_MS = MINUTE_MS;
const BOARD_MAX_AGE_MS = MINUTE_MS;
// Names that could not be resolved for a network reason are tried again.
const RESOLVE_RETRY_MS = 15 * MINUTE_MS;
const DIAGNOSTIC_CHUNK = 3000;
const ACTION_TEXT_MAX = 1500;
// Wiener Linien write their messages in German, sometimes in English too.
const MESSAGE_LANGUAGES = ['de', 'en'];
// A mode typed instead of a line keeps every line of that mode (folded words).
const MODE_WORDS = {
  'u bahn': 'metro',
  ubahn: 'metro',
  metro: 'metro',
  subway: 'metro',
  tram: 'tram',
  tramway: 'tram',
  strassenbahn: 'tram',
  bim: 'tram',
  bus: 'bus',
  autobus: 'bus',
  's bahn': 'train',
  sbahn: 'train',
};
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/**
 * @description Cut a text of several lines at a line break, under a bound.
 * @param {string} text - The text.
 * @param {number} max - The bound.
 * @returns {string} The whole lines that fit, then "…".
 */
function clipLines(text, max) {
  if (text.length <= max) {
    return text;
  }
  const cut = text.lastIndexOf('\n', max - 2);
  return `${text.slice(0, cut > 0 ? cut : max - 2)}\n…`;
}

/**
 * @description The language of the texts of Wiener Linien for a user language.
 * @param {string} language - The user language.
 * @returns {string} de or en.
 */
const messageLanguage = (language) => (MESSAGE_LANGUAGES.includes(language) ? language : 'de');

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {string} [options.dataUrl] - The folder of the stop and line files (tests).
 * @param {string} [options.storePath] - The file kept in /data.
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {string} [options.timeZone] - IANA timezone of the times (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timers (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    baseUrl,
    dataUrl,
    storePath = DEFAULT_PATH,
    now = () => Date.now(),
    timeZone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  let config = normalizeConfig();
  // The raw values last read, internal keys included: the base of setConfig.
  let rawConfig = {};
  // The stops added with the buttons, one change at a time.
  let writingStops = Promise.resolve();
  // Language of the last widget request: the fallback of the texts Gladys does
  // not ask for in a language, when the `language` setting is `auto`. German
  // until a widget is shown: the language of the stop names.
  let language = 'de';
  let createdDevices = new Set();
  // The followed stops and lines, resolved, and what the lists do not know.
  let stops = [];
  let lines = [];
  // config.stops[i] -> its followed stop (null when unknown), for
  // "List the stops".
  let entries = [];
  let notFound = [];
  let linesNotFound = [];
  // stop key -> { passages, readAt } of its last reading; stop key -> the
  // lines seen calling there ({ id, name }) and the platforms (StopIDs) they
  // use, kept across the night.
  const snapshots = new Map();
  const stopLines = new Map();
  const stopSides = new Map();
  let stopsError = null;
  let stopsReadAt = 0;
  // The last answer of trafficInfoList, its time, its error.
  let trafficAnswer = null;
  let trafficReadAt = 0;
  let trafficError = null;
  // typed stop -> { passages, readAt }, for the widgets of other stops.
  const boards = new Map();
  let throttledUntil = 0;
  let resolveError = null;
  let lastStatus = null;
  let lastDiscovery = null;
  let stopTimer = null;
  let reminderTimer = null;
  let resolveTimer = null;
  let readingStops = null;
  let readingTraffic = null;
  let stopped = false;

  const api = createWlClient({
    now,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });
  const store = createStore({ path: storePath, logger });
  const network = createNetwork({
    store,
    now,
    logger,
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(dataUrl ? { dataUrl } : {}),
  });

  /**
   * @description Remember the language of a request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (typeof next !== 'string' || !/^[a-z]{2}$/.test(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  /**
   * @description The traffic in a language.
   * @param {string} lang - The user language.
   * @returns {object|null} parseTraffic(), null before the first reading.
   */
  const trafficIn = (lang) =>
    trafficAnswer ? parseTraffic(trafficAnswer, messageLanguage(lang)) : null;

  /**
   * @description The message of an error, for a user.
   * @param {Error} err - The error.
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    if (err?.name === 'NetworkError') {
      return t('errorNetwork', lang);
    }
    const key = {
      busy: 'errorBusy',
      throttled: 'errorThrottled',
      invalid: 'errorInvalid',
    }[err?.kind];
    return t(key ?? 'errorUnreachable', lang);
  }

  /**
   * @description Whether the API asked to slow down, and until when.
   * @returns {number} The end of the pause (ms), 0 when none.
   */
  const throttled = () => (throttledUntil > now() ? throttledUntil : 0);

  /**
   * @description Note an error of the API: the limit reached pauses every request.
   * @param {Error} err - The error.
   */
  function noteError(err) {
    if (err?.kind === 'throttled') {
      throttledUntil = now() + THROTTLE_PAUSE_MS;
    }
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const signature = JSON.stringify([connected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status from the last readings.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    const pause = throttled();
    if (pause) {
      await reportStatus(false, all('statusThrottled', { time: formatTime(pause, timeZone) }));
      return;
    }
    const failure = (stops.length && stopsError) || (lines.length && trafficError) || resolveError;
    if (failure) {
      await reportStatus(
        false,
        all('statusUnreachable', {
          detail: String(failure?.message ?? '').slice(0, 80),
          minutes: Math.max(1, Math.round(config.interval / 60)),
        }),
      );
      return;
    }
    const unknown = (l) =>
      [
        notFound.length ? ` ${t('statusNotFound', l, { names: notFound.join(', ') })}` : '',
        linesNotFound.length ? ` ${t('linesUnknown', l, { names: linesNotFound.join(', ') })}` : '',
      ].join('');
    if (stops.length === 0 && lines.length === 0) {
      await reportStatus(
        true,
        Object.fromEntries(LANGUAGES.map((l) => [l, `${t('statusNothing', l)}${unknown(l)}`])),
      );
      return;
    }
    await reportStatus(
      true,
      Object.fromEntries(
        LANGUAGES.map((l) => [
          l,
          `${t('statusConnected', l, { stops: stops.length, interval: config.interval, lines: lines.length })}${unknown(l)}`,
        ]),
      ),
    );
  }

  /**
   * @description Refresh the list of the devices the user created.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdDevices = new Set(devices.map((device) => device.external_id));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   * @param {string[]} keys - The widget keys.
   */
  function refreshWidgets(keys) {
    for (const key of keys) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`${data.stop_name ?? data.line_name ?? data.subject_name}: ${key}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Stops and lines ---------------------------------------------------------------

  /**
   * @description Resolve the line typed for a stop: a mode alone ("U-Bahn",
   * "tram", "bus") keeps every line of that mode.
   * @param {string} typed - The line typed, '' for every line.
   * @returns {Promise<object|null>} The line, `{ modeOnly }`, or null.
   */
  async function lineFilter(typed) {
    if (!typed) {
      return null;
    }
    const mode = MODE_WORDS[fold(typed)];
    return mode ? { modeOnly: mode } : network.resolveLine(typed);
  }

  /**
   * @description Resolve one stop of the configuration.
   * @param {object} entry - `{ slot, added, stop, line, direction }`.
   * @returns {Promise<object>} The followed stop, or `{ unknown }`: the typed
   * stop the list does not know (or words fitting several stops).
   */
  async function resolveEntry(entry) {
    const stop = await network.resolveStop(entry.stop);
    if (!stop) {
      return { unknown: entry.stop };
    }
    const key = stopKey(stop, entry.line, entry.direction);
    const followed = {
      slot: entry.slot,
      added: entry.added ?? null,
      stop,
      line: entry.line,
      direction: entry.direction,
      filter: await lineFilter(entry.line),
      key,
    };
    return {
      ...followed,
      name: followedName(followed),
      deviceId: idsOf(gladys, DEVICE_TYPES.STOP, key).device,
    };
  }

  /**
   * @description Resolve the configured stops and lines. A name that cannot
   * be resolved because the stop list is out of reach is tried again later; the
   * other stops are followed meanwhile.
   * @returns {Promise<void>}
   */
  async function resolveConfig() {
    clearTimeout(resolveTimer);
    const resolvedStops = [];
    const resolvedEntries = [];
    const unknown = [];
    let failure = null;
    for (const entry of config.stops) {
      let followed;
      try {
        followed = await resolveEntry(entry);
      } catch (err) {
        // The stop list cannot be read: this name waits; a code still works.
        failure = err;
        resolvedEntries.push(null);
        continue;
      }
      if (followed.unknown) {
        unknown.push(followed.unknown);
        resolvedEntries.push(null);
        continue;
      }
      const known = resolvedStops.find((other) => other.key === followed.key);
      if (!known) {
        resolvedStops.push(followed);
      }
      resolvedEntries.push(known ?? followed);
    }
    const resolvedLines = [];
    const unknownLines = [];
    const listKnown = network.lines().length > 0;
    for (const typed of config.lines) {
      const line = await network.resolveLine(typed);
      if (!line) {
        continue;
      }
      // Unknown to a list read: a typo, not a new line.
      if (line.unknown && listKnown) {
        unknownLines.push(typed);
        continue;
      }
      if (!resolvedLines.some((other) => other.id === line.id)) {
        resolvedLines.push({
          ...line,
          deviceId: idsOf(gladys, DEVICE_TYPES.LINE, lineKey(line)).device,
        });
      }
    }
    resolveError = failure;
    if (failure) {
      logger.warn(`Unable to read the stop list (${failure.kind ?? 'error'}): ${failure.message}`);
      if (timers && !stopped) {
        resolveTimer = setTimeout(() => {
          applyConfig().catch(() => {});
        }, RESOLVE_RETRY_MS);
        resolveTimer.unref?.();
      }
    }
    stops = resolvedStops;
    entries = resolvedEntries;
    notFound = unknown;
    lines = resolvedLines;
    linesNotFound = unknownLines;
    for (const key of [...snapshots.keys()]) {
      if (!stops.some((followed) => followed.key === key)) {
        snapshots.delete(key);
        stopLines.delete(key);
        stopSides.delete(key);
      }
    }
  }

  /**
   * @description Offer a device per stop and line on the Discovery screen,
   * when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = [
      ...stops.map((followed) => buildStopDevice(gladys, followed, lang)),
      ...lines.map((line) => buildLineDevice(gladys, line, lang)),
    ];
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  // --- Traffic -----------------------------------------------------------------------

  /**
   * @description The lines of a followed stop: its line filter, and the ones
   * seen calling there.
   * @param {object} followed - The followed stop.
   * @returns {Array<{ id: string, name: string }>} The lines.
   */
  function linesOfStop(followed) {
    const seen = [...(stopLines.get(followed.key)?.values() ?? [])];
    if (followed.filter && !followed.filter.modeOnly) {
      return [followed.filter, ...seen.filter((line) => line.id !== followed.filter.id)];
    }
    return seen;
  }

  /**
   * @description The platforms (StopIDs) of a followed stop: the ones its
   * passages use (as filtered by line and direction), else all of them.
   * @param {object} followed - The followed stop.
   * @returns {string[]} The StopIDs.
   */
  function sidesOfStop(followed) {
    const seen = stopSides.get(followed.key);
    return seen?.size ? [...seen] : (followed.stop.sides ?? []);
  }

  /**
   * @description The traffic messages under way about a stop: the disruptions
   * of its lines, the notices and elevators of its platforms.
   * @param {object} followed - The followed stop.
   * @param {object|null} traffic - parseTraffic().
   * @returns {object[]|null} The messages, null before the traffic is read.
   */
  function stopMessages(followed, traffic) {
    if (!traffic) {
      return null;
    }
    return messagesFor(traffic, linesOfStop(followed), now(), sidesOfStop(followed));
  }

  /**
   * @description Publish the states of the followed lines whose device exists.
   * @returns {Promise<void>}
   */
  async function publishLineStates() {
    const lang = textLanguage();
    const traffic = trafficIn(lang);
    if (!traffic) {
      return;
    }
    const states = lines
      .filter((line) => createdDevices.has(line.deviceId))
      .flatMap((line) => buildLineStates(gladys, line, lineTraffic(traffic, line, now()), lang));
    if (states.length) {
      await gladys
        .publishChangedStates(states)
        .catch((err) => logger.warn(`Unable to publish the states of the lines: ${err.message}`));
    }
  }

  /**
   * @description The events of a new reading of the traffic: the lines that
   * changed, the new messages of each line and stop.
   * @returns {object[]} The events.
   */
  function trafficEvents() {
    const lang = textLanguage();
    const options = { language: lang, timeZone };
    const traffic = trafficIn(lang);
    const { seen } = store.data;
    const current = now();
    seen.lines ??= {};
    seen.stops ??= {};
    const lineChanges = detectLineChanges({ lines, traffic, seen: seen.lines, now: current });
    seen.lines = lineChanges.seen;
    const events = lineChanges.changes.map((change) => lineEvent(change, options));
    // A message about a followed line fires there; the stops add the others.
    const announced = new Set(
      events
        .filter((event) => event.key === TRIGGERS.TRAFFIC_MESSAGE)
        .map((event) => event.data.title),
    );
    const known = new Set(
      lines.flatMap((line) => lineTraffic(traffic, line, current).messages.map((m) => m.id)),
    );
    const stopSeen = {};
    for (const followed of stops) {
      if (!snapshots.has(followed.key)) {
        if (seen.stops[followed.key]) {
          stopSeen[followed.key] = seen.stops[followed.key];
        }
        continue;
      }
      const messages = stopMessages(followed, traffic) ?? [];
      const fresh = detectStopMessages({ messages, seen: seen.stops[followed.key], now: current });
      stopSeen[followed.key] = fresh.seen;
      for (const { message, updated } of fresh.due) {
        if (known.has(message.id) || announced.has(message.title)) {
          continue;
        }
        announced.add(message.title);
        events.push({
          key: TRIGGERS.TRAFFIC_MESSAGE,
          data: messageData({ deviceId: followed.deviceId, name: followed.name }, message, {
            ...options,
            updated,
            lines: message.lines.join(', '),
          }),
        });
      }
    }
    seen.stops = stopSeen;
    return events;
  }

  /**
   * @description Read the traffic when due (one reading at a time).
   * @param {object} [options] - `{ force, widget }`: read even when not due,
   * even when nothing is followed (a widget shows the metro lines).
   * @returns {Promise<void>}
   */
  function readTraffic({ force = false, widget = false } = {}) {
    if (!readingTraffic) {
      readingTraffic = (async () => {
        const due = force || now() - trafficReadAt >= TRAFFIC_INTERVAL_MS - 1000;
        const idle = stops.length === 0 && lines.length === 0 && !widget;
        if (throttled() || !due || idle) {
          return;
        }
        try {
          trafficAnswer = await api.trafficInfoList({ elevators: config.elevators });
          trafficReadAt = now();
          trafficError = null;
        } catch (err) {
          noteError(err);
          trafficError = err;
          trafficReadAt = now();
          logger.warn(`Wiener Linien traffic (${err.kind ?? 'error'}): ${err.message}`);
          return;
        }
        const events = gladys.connected !== false ? trafficEvents() : [];
        await store.save();
        await publishEvents(events);
        await publishLineStates();
        for (const followed of stops) {
          await publishStopStates(followed);
        }
        refreshWidgets([WIDGETS.TRAFFIC]);
      })().finally(() => {
        readingTraffic = null;
      });
    }
    return readingTraffic;
  }

  // --- Reading the stops -------------------------------------------------------------

  /**
   * @description Publish the states of a stop, when its device exists.
   * @param {object} followed - The followed stop.
   * @returns {Promise<void>}
   */
  async function publishStopStates(followed) {
    const snapshot = snapshots.get(followed.key);
    if (!snapshot || !createdDevices.has(followed.deviceId)) {
      return;
    }
    const lang = textLanguage();
    await gladys
      .publishChangedStates(
        buildStopStates(
          gladys,
          followed,
          { ...snapshot, messages: stopMessages(followed, trafficIn(lang)) },
          { language: lang, now: now(), timeZone },
        ),
      )
      .catch((err) =>
        logger.warn(`Unable to publish the states of ${followed.name}: ${err.message}`),
      );
  }

  /**
   * @description The reminders due on the last reading of a stop.
   * @param {object} followed - The followed stop.
   * @returns {object[]} The events.
   */
  function stopEvents(followed) {
    const snapshot = snapshots.get(followed.key);
    if (!snapshot) {
      return [];
    }
    const options = { language: textLanguage(), timeZone };
    const { seen } = store.data;
    seen.reminders ??= {};
    const reminders = detectReminders({
      passages: snapshot.passages,
      fired: seen.reminders[followed.key],
      now: now(),
    });
    seen.reminders[followed.key] = reminders.fired;
    return reminders.due.map(({ passage, mark }) => ({
      key: TRIGGERS.DEPARTURE_SOON,
      data: reminderData(followed, passage, mark, options),
    }));
  }

  /**
   * @description A snapshot of an answer for one followed (or typed) stop.
   * @param {object} answer - The answer of the monitor service.
   * @param {object} followed - `{ stop, filter, direction }`.
   * @param {number} readAt - The time of the reading.
   * @returns {object} `{ passages, readAt }`.
   */
  function snapshotOf(answer, { stop, filter = null, direction = '' }, readAt) {
    const passages = parsePassages(answer, { codes: stop.codes, line: filter, direction });
    return { passages, readAt };
  }

  /**
   * @description Remember the lines seen calling at a stop, and their platforms.
   * @param {object} followed - The followed stop.
   * @param {object[]} passages - Its passages.
   */
  function learnLines(followed, passages) {
    const known = stopLines.get(followed.key) ?? new Map();
    for (const passage of passages) {
      if (passage.lineId && !known.has(passage.lineId)) {
        known.set(passage.lineId, {
          id: passage.lineId,
          name: passage.line,
          mode: passage.mode,
        });
      }
    }
    stopLines.set(followed.key, known);
    const sides = stopSides.get(followed.key) ?? new Set();
    passages.forEach((passage) => passage.stopCode && sides.add(passage.stopCode));
    stopSides.set(followed.key, sides);
  }

  /**
   * @description Read some followed stops now, all in one request. When it
   * fails, the stops keep their last reading and the error is thrown.
   * @param {object[]} list - The followed stops.
   * @returns {Promise<void>}
   */
  async function readFollowed(list) {
    let failure = null;
    const read = [];
    if (list.length > 0) {
      try {
        const answer = await api.monitor({
          codes: list.flatMap((followed) => followed.stop.codes),
        });
        const readAt = now();
        for (const followed of list) {
          const snapshot = snapshotOf(answer, followed, readAt);
          snapshots.set(followed.key, snapshot);
          learnLines(followed, snapshot.passages);
          read.push(followed);
        }
      } catch (err) {
        noteError(err);
        failure = err;
      }
    }
    stopsError = failure;
    if (read.length > 0 || failure) {
      stopsReadAt = now();
    }
    const events =
      gladys.connected !== false ? read.flatMap((followed) => stopEvents(followed)) : [];
    await store.save();
    await publishEvents(events);
    for (const followed of read) {
      await publishStopStates(followed);
    }
    if (failure) {
      throw failure;
    }
  }

  /**
   * @description Whether the stops are due for a reading.
   * @returns {boolean} True when due.
   */
  function stopsDue() {
    if (throttled()) {
      return false;
    }
    const age = now() - stopsReadAt;
    const interval = config.interval * 1000;
    if (stopsError) {
      // A failure is tried again at the next interval, not at each tick.
      return age >= interval - 1000;
    }
    if (stops.some((followed) => !snapshots.has(followed.key))) {
      return true;
    }
    // At night no stop announces anything soon: read them less often.
    const quiet = stops.every((followed) =>
      upcomingPassages(snapshots.get(followed.key).passages, now()).every(
        (passage) => passage.at - now() > QUIET_HORIZON_MS,
      ),
    );
    return age >= (quiet ? Math.max(IDLE_INTERVAL_MS, interval) : interval) - 1000;
  }

  /**
   * @description Read every followed stop when due (one reading at a time).
   * @param {object} [options] - `{ force }`: read even when not due.
   * @returns {Promise<void>}
   */
  function readStops({ force = false } = {}) {
    if (!readingStops) {
      readingStops = (async () => {
        if (stops.length > 0 && !throttled() && (force || stopsDue())) {
          try {
            await readFollowed(stops);
            refreshWidgets([WIDGETS.DEPARTURES]);
          } catch (err) {
            logger.warn(`Wiener Linien stops (${err.kind ?? 'error'}): ${err.message}`);
          }
        }
        await refreshStatus();
      })().finally(() => {
        readingStops = null;
      });
    }
    return readingStops;
  }

  /**
   * @description The snapshots of followed stops, read again (together) when
   * older than `maxAgeMs`. A stop that cannot be read again keeps its last
   * reading when it has one.
   * @param {object[]} list - The followed stops.
   * @param {number} maxAgeMs - The freshness wanted.
   * @returns {Promise<object[]>} Their snapshots, in the same order.
   */
  async function snapshotsOf(list, maxAgeMs) {
    const stale = list.filter((followed) => {
      const snapshot = snapshots.get(followed.key);
      return !snapshot || now() - snapshot.readAt > maxAgeMs;
    });
    if (stale.length > 0 && !throttled()) {
      try {
        await readFollowed(stale);
      } catch (err) {
        if (list.some((followed) => !snapshots.has(followed.key))) {
          throw err;
        }
      }
    }
    if (list.some((followed) => !snapshots.has(followed.key))) {
      const err = new Error('the Wiener Linien API asks to slow down');
      err.kind = 'throttled';
      throw err;
    }
    return list.map((followed) => snapshots.get(followed.key));
  }

  /**
   * @description Check the reminders on the last readings (between readings).
   * @returns {Promise<void>}
   */
  async function checkReminders() {
    // Disconnected, the event would be lost while marked as fired.
    if (gladys.connected === false) {
      return;
    }
    const events = stops.flatMap((followed) => stopEvents(followed));
    if (events.length) {
      await store.save();
      await publishEvents(events);
    }
  }

  // --- Timers ------------------------------------------------------------------------

  /**
   * @description (Re)arm the timers.
   */
  function schedule() {
    clearInterval(stopTimer);
    clearInterval(reminderTimer);
    if (!timers || stopped) {
      return;
    }
    // A short tick: stopsDue() and readTraffic() decide what is due.
    stopTimer = setInterval(() => {
      readStops().catch((err) => logger.error('Stops', err));
      readTraffic().catch((err) => logger.error('Traffic', err));
    }, TIMER_TICK_MS);
    reminderTimer = setInterval(() => {
      checkReminders().catch((err) => logger.warn(`Reminders: ${err.message}`));
    }, REMINDER_TICK_MS);
    [stopTimer, reminderTimer].forEach((timer) => timer.unref?.());
  }

  /**
   * @description Resolve the configuration, offer the devices, read everything.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await resolveConfig();
    logger.info(
      `${stops.length} stop(s): ${stops.map((followed) => followed.name).join(', ') || 'none'}` +
        (notFound.length ? `; unknown: ${notFound.join(', ')}` : '') +
        `; ${lines.length} line(s): ${lines.map((line) => line.name).join(', ') || 'none'}` +
        (linesNotFound.length ? `; unknown lines: ${linesNotFound.join(', ')}` : '') +
        `; interval ${config.interval} s`,
    );
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await readStops({ force: stops.some((followed) => !snapshots.has(followed.key)) });
    await readTraffic({ force: !trafficAnswer });
    await refreshStatus();
    schedule();
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The followed stop a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {object|null} The followed stop, the first one by default.
   */
  function target(externalId) {
    const parsed = parseExternalId(externalId);
    const found =
      parsed?.type === DEVICE_TYPES.STOP ? stops.find((item) => item.key === parsed.key) : null;
    return found ?? stops[0] ?? null;
  }

  /**
   * @description The passages of a stop typed in a widget.
   * @param {string} typed - The stop.
   * @param {string} typedLineName - Its optional line.
   * @param {string} lang - The language.
   * @returns {Promise<object>} `{ title, passages, readAt }` or `{ message }`.
   */
  async function typedBoard(typed, typedLineName, lang) {
    const stop = await network.resolveStop(typed);
    if (!stop) {
      return { message: t('statusNotFound', lang, { names: typed.slice(0, 60) }) };
    }
    const key = stopKey(stop, typedLineName, '');
    let board = boards.get(key);
    if (!board || now() - board.readAt > BOARD_MAX_AGE_MS) {
      if (throttled() && board) {
        return { title: followedName({ stop, line: typedLineName, direction: '' }), ...board };
      }
      const answer = await api.monitor({ codes: stop.codes }).catch((err) => {
        noteError(err);
        throw err;
      });
      board = snapshotOf(answer, { stop, filter: await lineFilter(typedLineName) }, now());
      boards.set(key, board);
    }
    return { title: followedName({ stop, line: typedLineName, direction: '' }), ...board };
  }

  /**
   * @description The followed stops chosen in a `multi_select` setting.
   * @param {unknown} raw - Device external ids.
   * @returns {object[]} The followed stops, in the order chosen.
   */
  function chosenStops(raw) {
    const ids = Array.isArray(raw) ? raw : [];
    const chosen = [];
    for (const id of ids) {
      const parsed = parseExternalId(id);
      const followed =
        parsed?.type === DEVICE_TYPES.STOP ? stops.find((item) => item.key === parsed.key) : null;
      if (followed && !chosen.includes(followed)) {
        chosen.push(followed);
      }
    }
    return chosen;
  }

  /**
   * @description The boards of several followed stops, grouped by stop: the
   * devices of one stop (one per line and direction) make one board.
   * @param {object[]} chosen - The followed stops.
   * @returns {Promise<object[]>} `[{ title, label, passages, readAt }]`.
   */
  async function followedBoards(chosen) {
    const groups = new Map();
    for (const followed of chosen) {
      groups.set(followed.stop.id, [...(groups.get(followed.stop.id) ?? []), followed]);
    }
    await snapshotsOf(chosen, SNAPSHOT_MAX_AGE_MS);
    const result = [];
    for (const members of groups.values()) {
      const read = members.map((followed) => snapshots.get(followed.key)).filter(Boolean);
      if (read.length === 0) {
        continue;
      }
      // A route of two chosen devices (all the lines and one of them) once.
      const passages = new Map();
      for (const passage of read.flatMap((snapshot) => snapshot.passages)) {
        passages.set(`${routeOf(passage)}|${passage.stopCode}|${passage.at}`, passage);
      }
      const [first] = members;
      result.push({
        title: members.length > 1 ? first.stop.name : first.name,
        label: first.stop.name,
        passages: [...passages.values()].sort((a, b) => a.at - b.at),
        readAt: Math.min(...read.map((snapshot) => snapshot.readAt)),
      });
    }
    return result;
  }

  gladys.onWidgetGet(WIDGETS.DEPARTURES, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    const count = readCount(settings.count, BOARD_COUNT);
    const typed = typeof settings.stop_name === 'string' ? settings.stop_name.trim() : '';
    const typedLineName = typeof settings.line === 'string' ? settings.line.trim() : '';
    try {
      let board;
      if (typed) {
        board = await typedBoard(typed, typedLineName, lang);
        if (board.message) {
          return messageContent(board.message);
        }
      } else {
        const several = await followedBoards(chosenStops(settings.stops));
        if (several.length > 1) {
          board = { boards: several };
        } else if (several.length === 1) {
          board = several[0];
        } else {
          const followed = target(settings.stop);
          if (!followed) {
            return messageContent(t('widgetNoStop', lang));
          }
          const [snapshot] = await snapshotsOf([followed], SNAPSHOT_MAX_AGE_MS);
          board = { title: followed.name, ...snapshot };
        }
      }
      return buildDeparturesWidget({ ...board, count, language: lang, now: now(), timeZone });
    } catch (err) {
      logger.warn(`Widget: unable to read the passages: ${err.message}`);
      return messageContent(errorText(err, lang), 60);
    }
  });

  /**
   * @description The lines typed in the traffic widget, resolved.
   * @param {string} raw - "U1, U4, 13A".
   * @returns {Promise<object[]>} The lines.
   */
  async function typedLines(raw) {
    const found = [];
    for (const typed of splitLines(raw)) {
      const line = await network.resolveLine(typed);
      if (line && !found.some((other) => other.id === line.id)) {
        found.push(line);
      }
    }
    return found;
  }

  gladys.onWidgetGet(WIDGETS.TRAFFIC, async ({ settings = {}, language: lang }) => {
    rememberLanguage(lang);
    const typed = typeof settings.lines === 'string' ? settings.lines.trim() : '';
    let chosen = typed ? await typedLines(typed) : lines;
    if (chosen.length === 0) {
      // Nothing followed nor typed: the metro lines.
      await network.load().catch(() => null);
      chosen = network.lines().filter((line) => line.mode === 'metro');
    }
    if (chosen.length === 0) {
      return messageContent(t('widgetNoLine', lang));
    }
    if (!trafficAnswer || now() - trafficReadAt > TRAFFIC_INTERVAL_MS + MINUTE_MS) {
      await readTraffic({ force: true, widget: true });
    }
    const traffic = trafficIn(lang);
    if (!traffic) {
      return messageContent(errorText(trafficError, lang), 60);
    }
    const current = now();
    return buildTrafficWidget({
      lines: chosen.map((line) => ({ line, traffic: lineTraffic(traffic, line, current) })),
      readAt: trafficReadAt,
      language: lang,
      now: current,
      timeZone,
    });
  });

  // --- Scene actions -----------------------------------------------------------------
  gladys.onSceneAction(SCENE_ACTIONS.GET_NEXT_DEPARTURES, async (fields = {}) => {
    const followed = target(fields.stop);
    if (!followed) {
      throw new Error('No Wiener Linien stop is followed');
    }
    const [snapshot] = await snapshotsOf([followed], SNAPSHOT_MAX_AGE_MS);
    return pick(
      nextDeparturesOutputs({
        followed,
        passages: snapshot.passages,
        now: now(),
        language: textLanguage(),
        timeZone,
      }),
      NEXT_DEPARTURES_OUTPUTS,
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_LINE_TRAFFIC, async (fields = {}) => {
    const parsed = parseExternalId(fields.line);
    let line =
      parsed?.type === DEVICE_TYPES.LINE
        ? lines.find((item) => lineKey(item) === parsed.key)
        : null;
    const typed = typeof fields.line_name === 'string' ? fields.line_name.trim() : '';
    if (!line && typed) {
      line = await network.resolveLine(typed);
    }
    line ??= lines[0];
    if (!line) {
      throw new Error('No Wiener Linien line is followed or typed');
    }
    if (!trafficAnswer || now() - trafficReadAt > TRAFFIC_INTERVAL_MS) {
      await readTraffic({ force: true, widget: true });
    }
    const lang = textLanguage();
    const traffic = trafficIn(lang);
    if (!traffic) {
      throw new Error(
        `Wiener Linien traffic unavailable: ${trafficError?.message ?? 'not read yet'}`,
      );
    }
    return pick(
      lineTrafficOutputs({ line, traffic: lineTraffic(traffic, line, now()), language: lang }),
      LINE_TRAFFIC_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    const messages = [];
    try {
      const known = await network.load(true);
      messages.push(
        all('testNetworkOk', { stops: known.stops.length, lines: (known.lines ?? []).length }),
      );
    } catch (err) {
      messages.push(all('testStopsError', (l) => ({ error: errorText(err, l) })));
    }
    await resolveConfig();
    await publishDiscoveredDevices().catch(() => {});
    api.clear();
    throttledUntil = 0;
    let failure = null;
    if (stops.length > 0) {
      try {
        await readFollowed(stops);
      } catch (err) {
        failure = err;
      }
    } else {
      messages.push(all('testNoStop'));
    }
    for (const followed of stops) {
      const snapshot = snapshots.get(followed.key);
      if (!snapshot || (failure && now() - snapshot.readAt > SNAPSHOT_MAX_AGE_MS)) {
        messages.push(
          all('testStopError', (l) => ({ stop: followed.name, error: errorText(failure, l) })),
        );
        continue;
      }
      const [first] = upcomingPassages(snapshot.passages, now());
      messages.push(
        all('testStop', (l) => ({
          stop: followed.name,
          count: snapshot.passages.length,
          next: first
            ? `${first.line} ${passageWhen(first, { language: l, now: now(), timeZone })}`
            : '–',
        })),
      );
    }
    await readTraffic({ force: true });
    if (trafficError) {
      messages.push(all('testTrafficError', (l) => ({ error: errorText(trafficError, l) })));
    } else if (trafficAnswer) {
      messages.push(all('testTraffic', { count: trafficIn('de').messages.length }));
    }
    notFound.forEach((name) => messages.push(all('unknownEntry', { name })));
    if (linesNotFound.length) {
      messages.push(all('linesUnknown', { names: linesNotFound.join(', ') }));
    }
    refreshWidgets(Object.values(WIDGETS));
    await refreshStatus();
    return Object.fromEntries(
      LANGUAGES.map((l) => [
        l,
        messages
          .map((entry) => entry[l])
          .join(' · ')
          .slice(0, 1000),
      ]),
    );
  });

  gladys.onAction(ACTIONS.SEARCH_STOP, async (fields = {}) => {
    const query = typeof fields.query === 'string' ? fields.query.trim() : '';
    if (query.length < 2) {
      return all('searchTooShort');
    }
    let result;
    try {
      result = await network.searchStops(query);
    } catch (err) {
      return all('testStopsError', (l) => ({ error: errorText(err, l) }));
    }
    if (result.found.length === 0) {
      return all('searchNone', { query: query.slice(0, 60) });
    }
    const list = result.found
      .map(
        (stop) => `• ${stop.name}${stop.town ? ` (${stop.town})` : ''} [${stop.codes.join(', ')}]`,
      )
      .join('\n');
    const more = result.total - result.found.length;
    return all('searchFound', (l) => ({
      list: clipLines(
        more > 0 ? `${list}\n${t('searchMore', l, { n: more })}` : list,
        ACTION_TEXT_MAX - 200,
      ),
    }));
  });

  // --- Stops added with the buttons -------------------------------------------------

  const field = (value) => (typeof value === 'string' ? value.trim() : '');

  /**
   * @description Change the added stops, one change after the other: two quick
   * buttons never lose a stop. Applied in memory once Gladys saved it.
   * @param {Function} change - `(added) => Promise<{ next?, message }>`: the new
   * list (none: nothing to save) and the answer, or a function of nothing
   * giving it once the stops are read.
   * @returns {Promise<object>} The answer.
   */
  function changeAddedStops(change) {
    const run = writingStops.then(async () => {
      const { next, message } = await change(config.addedStops);
      if (next) {
        await gladys.setConfig({ [INTERNAL_KEYS.addedStops]: next });
        rawConfig = { ...rawConfig, [INTERNAL_KEYS.addedStops]: next };
        config = normalizeConfig(rawConfig);
        await resolveConfig();
        await publishDiscoveredDevices().catch((err) =>
          logger.warn(`Unable to offer the devices: ${err.message}`),
        );
        // Only the new stop is due: it has no reading yet.
        const fresh = stops.filter((followed) => !snapshots.has(followed.key));
        if (fresh.length > 0 && !throttled()) {
          await readFollowed(fresh).catch((err) =>
            logger.warn(`Wiener Linien stop (${err.kind ?? 'error'}): ${err.message}`),
          );
          await refreshStatus();
        }
      }
      return typeof message === 'function' ? message() : message;
    });
    writingStops = run.catch(() => {});
    return run;
  }

  /**
   * @description How a stop of the configuration reads in "List the stops".
   * @param {object} entry - A stop of `config.stops`.
   * @param {number} index - Its position.
   * @param {string} lang - The language.
   * @returns {string} "2. Karlsplatz (U1) (formulaire, arrêt 2)".
   */
  function entryText(entry, index, lang) {
    const followed = entries[index];
    const typed = [entry.stop, entry.line, entry.direction && `→ ${entry.direction}`]
      .filter(Boolean)
      .join(' ');
    const notes = [
      entry.slot ? t('stopFromForm', lang, { slot: entry.slot }) : '',
      entries.length && !followed ? t('stopUnknownMark', lang) : '',
    ].filter(Boolean);
    const name = followed?.name ?? typed;
    return `${index + 1}. ${name}${notes.length ? ` (${notes.join(', ')})` : ''}`;
  }

  gladys.onAction(ACTIONS.ADD_STOP, async (fields = {}) => {
    const entry = {
      stop: field(fields.stop),
      line: field(fields.line),
      direction: field(fields.direction),
    };
    if (entry.stop.length < 2 && !/^\d$/.test(entry.stop)) {
      return all('searchTooShort');
    }
    return changeAddedStops(async (added) => {
      if (added.length >= MAX_ADDED_STOPS) {
        return { message: all('stopsFull', { max: MAX_ADDED_STOPS }) };
      }
      let followed;
      try {
        followed = await resolveEntry(entry);
      } catch (err) {
        return { message: all('testStopsError', (l) => ({ error: errorText(err, l) })) };
      }
      if (followed.unknown) {
        return { message: all('statusNotFound', { names: followed.unknown.slice(0, 60) }) };
      }
      if (stops.some((other) => other.key === followed.key)) {
        return { message: all('stopAlreadyFollowed', { name: followed.name }) };
      }
      // Stored as resolved: the codes of the stop (a name may be renamed).
      const stored = {
        stop: followed.stop.codes.length === 1 ? followed.stop.codes[0] : entry.stop,
        line: entry.line,
        direction: entry.direction,
      };
      logger.info(`Stop added: ${followed.name}`);
      return {
        next: [...added, stored],
        message: () => all('stopAdded', { name: followed.name, count: stops.length }),
      };
    });
  });

  gladys.onAction(ACTIONS.REMOVE_STOP, async (fields = {}) => {
    const query = field(fields.stop);
    if (!query) {
      return all('stopRemoveUnknown', { query });
    }
    return changeAddedStops(async () => {
      const number =
        /^#?\d+$/.test(query) && query.length <= 2 ? Number(query.replace('#', '')) : null;
      let found;
      if (number !== null && config.stops[number - 1]) {
        found = [number - 1];
      } else {
        const wanted = fold(query);
        found = config.stops
          .map((entry, index) => ({ entry, index, followed: entries[index] }))
          .filter(
            ({ entry, followed }) =>
              fold(entry.stop) === wanted ||
              (followed && (fold(followed.name) === wanted || fold(followed.stop.name) === wanted)),
          )
          .map(({ index }) => index);
        // The same name in the form and in the added stops: the added one.
        const fromButtons = found.filter((index) => !config.stops[index].slot);
        found = fromButtons.length > 0 ? fromButtons : found;
      }
      if (found.length === 0) {
        return { message: all('stopRemoveUnknown', { query: query.slice(0, 60) }) };
      }
      if (found.length > 1) {
        return { message: all('stopRemoveAmbiguous', { query: query.slice(0, 60) }) };
      }
      const entry = config.stops[found[0]];
      const name = entries[found[0]]?.name ?? entry.stop;
      if (entry.slot) {
        return { message: all('stopInForm', { name, slot: entry.slot }) };
      }
      logger.info(`Stop removed: ${name}`);
      return {
        next: config.addedStops.filter((_, index) => index !== entry.added - 1),
        message: all('stopRemoved', { name }),
      };
    });
  });

  gladys.onAction(ACTIONS.LIST_STOPS, async () => {
    if (config.stops.length === 0) {
      return all('stopsNone');
    }
    return all('stopsList', (l) => ({
      count: config.stops.length,
      list: clipLines(
        config.stops.map((entry, index) => entryText(entry, index, l)).join('\n'),
        ACTION_TEXT_MAX - 100,
      ),
    }));
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const traffic = trafficIn('de');
    const report = {
      version: VERSION,
      timeZone: timeZone ?? null,
      elevators: config.elevators,
      interval: config.interval,
      language: config.language,
      stops: stops.map((followed) => {
        const snapshot = snapshots.get(followed.key);
        return {
          slot: followed.slot,
          added: followed.added,
          key: followed.key,
          stop: followed.stop,
          line: followed.line || null,
          direction: followed.direction,
          created: createdDevices.has(followed.deviceId),
          readAt: snapshot ? new Date(snapshot.readAt).toISOString() : null,
          lines: linesOfStop(followed).map((line) => line.id),
          sides: sidesOfStop(followed),
          passages: snapshot?.passages
            .slice(0, 6)
            .map(
              (p) =>
                `${p.line}>${p.destination} ${p.stopCode} ${new Date(p.at).toISOString().slice(11, 16)}Z` +
                `${p.realtime ? ` ${p.delay >= 0 ? '+' : ''}${p.delay}` : ' sched'}`,
            ),
        };
      }),
      lines: lines.map((line) => ({
        id: line.id,
        name: line.name,
        mode: line.mode,
        created: createdDevices.has(line.deviceId),
        state: traffic ? lineTraffic(traffic, line, now()).state : null,
      })),
      stopsError: stopsError ? `${stopsError.kind ?? 'error'}: ${stopsError.message}` : null,
      trafficError: trafficError
        ? `${trafficError.kind ?? 'error'}: ${trafficError.message}`
        : null,
      traffic: traffic
        ? {
            readAt: new Date(trafficReadAt).toISOString(),
            messages: traffic.messages.slice(0, 12).map((m) => ({
              id: m.id,
              channel: m.channel,
              state: m.state,
              lines: m.network ? 'network' : m.lineIds,
              stops: m.stopIds.length,
              title: m.title.slice(0, 80),
            })),
          }
        : null,
      notFound,
      linesNotFound,
      throttledUntil: throttled() ? new Date(throttledUntil).toISOString() : null,
      network: {
        stops: store.data.network.stops?.length ?? null,
        lines: store.data.network.lines?.length ?? null,
        readAt: store.data.network.readAt
          ? new Date(store.data.network.readAt).toISOString()
          : null,
      },
      resolveError: resolveError?.message ?? null,
      requests: api.requests,
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `Wiener Linien diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    await resolveConfig();
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    for (const followed of stops) {
      await publishStopStates(followed);
    }
    await publishLineStates();
    refreshWidgets(Object.values(WIDGETS));
  });

  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      rawConfig = raw ?? {};
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        // The form values may lack the internal keys: never forget the added
        // stops, the next button would save the list without them.
        rawConfig = {
          [INTERNAL_KEYS.addedStops]: rawConfig[INTERNAL_KEYS.addedStops],
          ...fallback,
        };
        config = normalizeConfig(rawConfig);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (raw) => {
    await loadConfig(raw);
    lastDiscovery = null;
    boards.clear();
    snapshots.clear();
    stopSides.clear();
    api.clear();
    stopsError = null;
    trafficError = null;
    trafficAnswer = null;
    throttledUntil = 0;
    logger.info('Configuration updated');
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await loadConfig();
      await store.load();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(stopTimer);
    clearInterval(reminderTimer);
    clearTimeout(resolveTimer);
    await store.save();
  });

  return {
    store,
    api,
    network,
    readStops,
    readTraffic,
    checkReminders,
    applyConfig,
    getConfig: () => config,
    getStops: () => stops,
    getLines: () => lines,
    getSnapshot: (key) => snapshots.get(key),
    whenReady: () => startup,
  };
}

export {
  createApp,
  ACTIONS,
  SCENE_ACTIONS,
  IDLE_INTERVAL_MS,
  TRAFFIC_INTERVAL_MS,
  SNAPSHOT_MAX_AGE_MS,
  typedLine,
};
