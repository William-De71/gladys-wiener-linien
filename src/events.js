// -----------------------------------------------------------------------------
// Scene triggers (pure logic) and scene action outputs.
//
// Triggers (one event per transition, never a periodic snapshot):
//   - `departure_soon`    a vehicle of a followed stop leaves in N minutes
//                         (2, 3, 5, 10, 15 or 20), counted on its estimate:
//                         checked on each reading and every 30 seconds on the
//                         last one, fired close to the mark, once per passage.
//                         A passage is matched by its trip, or by line,
//                         destination and time (± 2 min);
//   - `line_disrupted`    a followed line becomes disrupted or heavily
//                         disrupted;
//   - `line_restored`     a followed line that was disrupted is back to normal;
//   - `traffic_message`   a new traffic message about a followed line or the
//                         stop (the disruptions of its lines, the notices of
//                         its displays, its elevators when followed); a
//                         disruption whose text changes fires again.
//
// What was seen is kept in /data (`seen`): a restart never fires the same
// event twice, and the first reading of a stop or a line is a baseline (no
// event replays what was already there). A scene action or a widget never
// fires an event.
// -----------------------------------------------------------------------------

import { t, passageWhen, lineLabel, lineStateText, kindText, LATE_MINUTES } from './i18n.js';
import { routeOf, minutesLeft, upcomingPassages } from './departures.js';
import { lineTraffic, seriousMessages, SERIOUS } from './traffic.js';
import { formatTime, localClock } from './time.js';

const TRIGGERS = {
  DEPARTURE_SOON: 'departure_soon',
  LINE_DISRUPTED: 'line_disrupted',
  LINE_RESTORED: 'line_restored',
  TRAFFIC_MESSAGE: 'traffic_message',
};
const REMINDER_MINUTES = [2, 3, 5, 10, 15, 20];
const REMINDER_MATCH_MS = 2 * 60 * 1000;
const REMINDER_KEEP_MS = 10 * 60 * 1000;
// A message seen is remembered this long after it disappeared: a message the
// API drops for a moment must not fire again.
const MESSAGE_KEEP_MS = 7 * 24 * 3600 * 1000;
// At most this many new messages fire per stop or line and reading.
const MAX_MESSAGES_PER_SUBJECT = 5;
const SUMMARY_MAX = 1000;
const MESSAGE_MAX = 1000;
const OUTPUT_MAX = 10000;
const NEXT_DEPARTURES_OUTPUTS = [
  'stop_name',
  'found',
  'line',
  'destination',
  'minutes',
  'time',
  'realtime',
  'delay',
  'following_minutes',
  'summary',
];
const LINE_TRAFFIC_OUTPUTS = [
  'line_name',
  'state',
  'state_label',
  'disrupted',
  'message_count',
  'title',
  'message',
  'summary',
];

/**
 * @description Truncate a text, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description How close to a mark a reminder may fire (minutes before it).
 * @param {number} mark - The mark (minutes).
 * @returns {number} The tolerance: the marks never overlap.
 */
function tolerance(mark) {
  if (mark <= 3) {
    return 1;
  }
  return mark <= 5 ? 1.5 : 3;
}

/**
 * @description The reminders due on the passages of a stop.
 * @param {object} options - Options.
 * @param {object[]} options.passages - The passages of the stop.
 * @param {object[]} [options.fired] - The reminders already fired `[{ route, mark, at }]`,
 * undefined before the first reading of the stop: a baseline, the reminders
 * already due are remembered without firing (a busy stop would fire dozens).
 * @param {number} options.now - Now (ms).
 * @returns {{ due: Array<{ passage: object, mark: number }>, fired: object[] }}
 * The reminders to fire and the memory to keep.
 */
function detectReminders({ passages, fired, now }) {
  const baseline = !Array.isArray(fired);
  const memory = (fired ?? []).filter((entry) => entry.at > now - REMINDER_KEEP_MS);
  const due = [];
  for (const passage of upcomingPassages(passages, now)) {
    const left = (passage.at - now) / 60000;
    const route = routeOf(passage);
    for (const mark of REMINDER_MINUTES) {
      if (left > mark || left <= mark - tolerance(mark)) {
        continue;
      }
      const known = memory.some(
        (entry) =>
          entry.mark === mark &&
          ((passage.trip && entry.trip === passage.trip) ||
            (entry.route === route && Math.abs(entry.at - passage.at) <= REMINDER_MATCH_MS)),
      );
      if (!known) {
        memory.push({ route, mark, at: passage.at, trip: passage.trip });
        if (!baseline) {
          due.push({ passage, mark });
        }
      }
    }
  }
  return { due, fired: memory };
}

/**
 * @description The new (or updated: a disruption whose text changed)
 * messages among some.
 * @param {object[]} messages - The messages under way and coming.
 * @param {object} [seen] - `{ <id>: { at, version } }`, undefined before the
 * first reading: a baseline.
 * @param {number} now - Now (ms).
 * @returns {{ due: Array<{ message: object, updated: boolean }>, seen: object }}
 * The messages to fire and the memory to keep.
 */
function freshMessages(messages, seen, now) {
  const baseline = !seen || typeof seen !== 'object';
  const memory = {};
  for (const [id, entry] of Object.entries(seen ?? {})) {
    if (entry && typeof entry === 'object' && entry.at > now - MESSAGE_KEEP_MS) {
      memory[id] = entry;
    }
  }
  const due = [];
  for (const message of messages) {
    const known = memory[message.id];
    if (!known) {
      due.push({ message, updated: false });
    } else if (known.version !== message.version && message.notifyUpdates) {
      due.push({ message, updated: true });
    }
    memory[message.id] = { at: now, version: message.version };
  }
  return {
    due: baseline
      ? []
      : due
          .sort((a, b) => (a.message.start ?? 0) - (b.message.start ?? 0))
          .slice(0, MAX_MESSAGES_PER_SUBJECT),
    seen: memory,
  };
}

/**
 * @description What changed on the followed lines since the last reading.
 * @param {object} options - Options.
 * @param {object[]} options.lines - The followed lines (`id`, `name`).
 * @param {object} options.traffic - parseTraffic().
 * @param {object} [options.seen] - Per line id `{ state, messages }`.
 * @param {number} options.now - Now (ms).
 * @returns {{ changes: object[], seen: object }} `{ key, line, traffic,
 * message?, updated? }` per event, and the memory to keep.
 */
function detectLineChanges({ lines, traffic, seen = {}, now }) {
  const changes = [];
  const next = {};
  for (const line of lines) {
    const current = lineTraffic(traffic, line, now);
    const before = seen[line.id];
    const fresh = freshMessages(
      [...current.messages, ...current.upcoming],
      before ? (before.messages ?? {}) : undefined,
      now,
    );
    const { state } = current;
    next[line.id] = { state, messages: fresh.seen };
    if (!before) {
      continue;
    }
    const wasSerious = SERIOUS.includes(before.state);
    const isSerious = SERIOUS.includes(state);
    if (isSerious && !wasSerious) {
      changes.push({
        key: TRIGGERS.LINE_DISRUPTED,
        line,
        traffic: current,
        message: seriousMessages(current)[0] ?? null,
      });
    } else if (wasSerious && !isSerious) {
      changes.push({ key: TRIGGERS.LINE_RESTORED, line, traffic: current });
    }
    fresh.due.forEach(({ message, updated }) => {
      changes.push({ key: TRIGGERS.TRAFFIC_MESSAGE, line, traffic: current, message, updated });
    });
  }
  return { changes, seen: next };
}

/**
 * @description The new messages about a stop.
 * @param {object} options - Options.
 * @param {object[]} options.messages - The messages of the stop (messagesFor).
 * @param {object} [options.seen] - `{ <id>: { at, version } }`, undefined
 * before the first reading: a baseline.
 * @param {number} options.now - Now (ms).
 * @returns {{ due: Array<{ message: object, updated: boolean }>, seen: object }}
 * The messages to fire and the memory to keep.
 */
function detectStopMessages({ messages, seen, now }) {
  return freshMessages(messages, seen, now);
}

// --- Payloads ------------------------------------------------------------------------

/**
 * @description A date of a message: "27/10 22:30".
 * @param {number|null} instant - The instant (ms).
 * @param {string} [timeZone] - IANA timezone.
 * @returns {string} The day and time, '' when none.
 */
function messageDate(instant, timeZone) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  const [, month, day] = localClock(instant, timeZone).date.split('-');
  return `${day}/${month} ${formatTime(instant, timeZone)}`;
}

/**
 * @description The data of a `departure_soon` event.
 * @param {object} followed - The followed stop (`name`, `deviceId`, `stop`).
 * @param {object} passage - The passage.
 * @param {number} mark - The minutes of the reminder.
 * @param {object} options - `{ language, timeZone }`.
 * @returns {object} Flat scalars.
 */
function reminderData(followed, passage, mark, { language, timeZone }) {
  const time = formatTime(passage.at, timeZone);
  const late = Math.max(0, passage.delay ?? 0);
  let summaryKey = 'summarySoonScheduled';
  if (passage.realtime) {
    summaryKey = late >= LATE_MINUTES ? 'summarySoonDelayed' : 'summarySoon';
  }
  return {
    stop: followed.deviceId,
    minutes: String(mark),
    stop_name: followed.name,
    line: passage.line,
    destination: passage.destination,
    time,
    realtime: passage.realtime,
    delay: late,
    summary: clip(
      t(summaryKey, language, {
        delay: late,
        line: passage.line,
        destination: passage.destination,
        stop: followed.stop.name,
        minutes: mark,
        time,
      }),
      SUMMARY_MAX,
    ),
  };
}

/**
 * @description The data of a `traffic_message` event.
 * @param {object} subject - `{ deviceId, name }`: the line or stop device.
 * @param {object} message - The message.
 * @param {object} options - `{ language, timeZone, updated, lines }`: `lines`
 * the names of the lines concerned.
 * @returns {object} Flat scalars.
 */
function messageData(subject, message, { language, timeZone, updated = false, lines = '' }) {
  const names = message.network ? t('wholeNetwork', language) : lines;
  return {
    device: subject.deviceId,
    subject_name: subject.name,
    lines: names,
    kind: message.channel,
    state: message.state,
    updated,
    title: clip(message.title, 200),
    message: clip(message.text, MESSAGE_MAX),
    start: messageDate(message.start, timeZone),
    end: messageDate(message.end, timeZone),
    summary: clip(
      t(updated ? 'summaryMessageUpdated' : 'summaryMessage', language, {
        kind: kindText(message.channel, language),
        lines: names,
        title: message.title,
      }),
      SUMMARY_MAX,
    ),
  };
}

/**
 * @description The data of a line event.
 * @param {object} change - From detectLineChanges, with `deviceId` on its line.
 * @param {object} options - `{ language, timeZone }`.
 * @returns {{ key: string, data: object }} The event.
 */
function lineEvent(change, { language, timeZone }) {
  const { line, traffic, message } = change;
  const label = lineLabel(line, language);
  const stateLabel = lineStateText(traffic.state, language);
  if (change.key === TRIGGERS.TRAFFIC_MESSAGE) {
    return {
      key: change.key,
      data: messageData({ deviceId: line.deviceId, name: label }, message, {
        language,
        timeZone,
        updated: change.updated,
        lines: line.name,
      }),
    };
  }
  const base = { line: line.deviceId, line_name: label, state: traffic.state };
  if (change.key === TRIGGERS.LINE_RESTORED) {
    return {
      key: change.key,
      data: {
        ...base,
        summary: clip(
          t('summaryRestored', language, { line: label, state: stateLabel }),
          SUMMARY_MAX,
        ),
      },
    };
  }
  const title = message?.title ?? '';
  return {
    key: change.key,
    data: {
      ...base,
      title,
      message: clip(message?.text ?? '', MESSAGE_MAX),
      start: message ? messageDate(message.start, timeZone) : '',
      end: message ? messageDate(message.end, timeZone) : '',
      summary: clip(
        t(title ? 'summaryDisruptedTitle' : 'summaryDisrupted', language, {
          line: label,
          state: stateLabel,
          title,
        }),
        SUMMARY_MAX,
      ),
    },
  };
}

// --- Scene action outputs ------------------------------------------------------------

/**
 * @description The outputs of `get_next_departures`.
 * @param {object} options - Options.
 * @param {object} options.followed - The followed stop.
 * @param {object[]} options.passages - Its passages.
 * @param {number} options.now - Now (ms).
 * @param {string} options.language - Language of the summary.
 * @param {string} [options.timeZone] - IANA timezone.
 * @returns {object} The outputs.
 */
function nextDeparturesOutputs({ followed, passages, now, language, timeZone }) {
  const [first, second] = upcomingPassages(passages, now);
  const outputs = {
    stop_name: followed.name,
    found: Boolean(first),
    line: first?.line ?? '',
    destination: first?.destination ?? '',
    minutes: first ? minutesLeft(first, now) : -1,
    time: first ? formatTime(first.at, timeZone) : '',
    realtime: Boolean(first?.realtime),
    delay: Math.max(0, first?.delay ?? 0),
    following_minutes: second ? minutesLeft(second, now) : -1,
  };
  let summary;
  if (first) {
    summary = t('outputNext', language, {
      stop: followed.stop.name,
      line: first.line,
      destination: first.destination,
      when: passageWhen(first, { language, now, timeZone }),
    });
    if (second) {
      summary += ` ${t('outputFollowing', language, { when: passageWhen(second, { language, now, timeZone }) })}`;
    }
  } else {
    summary = t('outputNone', language, { stop: followed.stop.name });
  }
  return { ...outputs, summary: clip(summary, OUTPUT_MAX) };
}

/**
 * @description The outputs of `get_line_traffic`.
 * @param {object} options - `{ line, traffic, language }`.
 * @returns {object} The outputs.
 */
function lineTrafficOutputs({ line, traffic, language }) {
  const [first] = traffic.messages;
  const label = lineLabel(line, language);
  const stateLabel = lineStateText(traffic.state, language);
  const summary = first?.title
    ? t('summaryLineState', language, { line: label, state: stateLabel, title: first.title })
    : t('summaryLineStateOnly', language, { line: label, state: stateLabel });
  return {
    line_name: label,
    state: traffic.state,
    state_label: stateLabel,
    disrupted: SERIOUS.includes(traffic.state),
    message_count: traffic.messages.length,
    title: first?.title ?? '',
    message: clip(first?.text ?? '', OUTPUT_MAX),
    summary: clip(summary, OUTPUT_MAX),
  };
}

/**
 * @description Keep only the declared outputs.
 * @param {object} outputs - The outputs.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The outputs.
 */
const pick = (outputs, keys) => Object.fromEntries(keys.map((key) => [key, outputs[key]]));

export {
  TRIGGERS,
  REMINDER_MINUTES,
  MESSAGE_KEEP_MS,
  NEXT_DEPARTURES_OUTPUTS,
  LINE_TRAFFIC_OUTPUTS,
  tolerance,
  detectReminders,
  freshMessages,
  detectLineChanges,
  detectStopMessages,
  messageDate,
  reminderData,
  messageData,
  lineEvent,
  nextDeparturesOutputs,
  lineTrafficOutputs,
  pick,
};
