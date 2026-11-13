// -----------------------------------------------------------------------------
// The traffic of the lines and stops, read every 5 minutes from the
// trafficInfoList service of Wiener Linien. `data.trafficInfos[]`, each of a
// category (`refTrafficInfoCategoryId` -> `data.trafficInfoCategories[].name`):
//   - `stoerunglang`  a disruption written by the control centre: `name` (its
//     id; follow-ups of one incident share `parentName`, one per line),
//     `title` ("18: Rettungseinsatz"), `description`, `time.start` / `.end`,
//     `status` (active, resolved), `relatedLines`, `relatedStops` (StopIDs),
//     `languages` (the texts in German, sometimes English)
//                     -> channel `disruption`;
//   - `stoerungkurz`  the special text shown on the display of one platform
//     ("Gleisbauarbeiten\nBetrieb ab Knöllgasse"), one entry per platform
//     (`relatedStops`) and line: the entries of one text are one message
//                     -> channel `notice`;
//   - `aufzugsinfo`   an elevator out of service: `title` the station,
//     `attributes.location`, `.status`, `.reason`, `relatedLines`,
//     `relatedStops` — asked only when the user follows the elevators
//                     -> channel `elevator`.
// Weight of a message, always from its German text:
//   - a disruption is `disrupted`, `major` when it says the line does not run
//     ("kein Betrieb", "eingestellt", "unterbrochen", "gesperrt"…);
//   - a notice is `major` with those words, `disrupted` when it tells of a
//     diversion, a delay, a shortened run…, else `info` (a moved stop);
//   - an elevator is `info`.
// States of a line, from the mildest: `unknown` (nothing read yet), `normal`,
// `info`, `disrupted`, `major`: the heaviest message under way. On a line, a
// notice never weighs more than `disrupted`: it speaks of one platform.
// A stop gets the disruptions of the lines calling there, and the notices
// and elevators of its own platforms.
// -----------------------------------------------------------------------------

import { MINUTE_MS } from './time.js';
import { asList, parseInstant } from './departures.js';
import { fold, slug } from './network.js';
import { CATEGORIES } from './wl-api.js';

const STATES = ['unknown', 'normal', 'info', 'disrupted', 'major'];
const SERIOUS = ['disrupted', 'major'];
const CHANNELS = {
  [CATEGORIES.LONG]: 'disruption',
  [CATEGORIES.SHORT]: 'notice',
  [CATEGORIES.ELEVATOR]: 'elevator',
};
// The languages of the texts the API may give.
const TEXT_LANGUAGES = ['de', 'en'];
// A message starting this soon is shown as coming.
const UPCOMING_MS = 3 * 24 * 60 * MINUTE_MS;
const TEXT_MAX = 2000;
const TITLE_MAX = 140;
const MAJOR_WORDS =
  /(^|[^\p{L}])(kein(en)? betrieb|betrieb (ist )?eingestellt|eingestellt|unterbrochen|unterbrechung|gesperrt|sperre|f[äa]hrt nicht|fahren nicht|verkehrt nicht|verkehren nicht|kein(e)? (z[uü]ge|busse|verkehr)|no service|suspended|interrupted)(?=$|[^\p{L}])/iu;
const DISRUPTED_WORDS =
  /(^|[^\p{L}])(umleitung(en)?|umgeleitet|versp[äa]tung(en)?|fahrtbehinderung(en)?|unregelm[äa][ßs]s?ig(e|en)?|unterschiedlichen intervallen|l[äa]ngere(n)? (intervalle|wartezeit(en)?)|kurzf[üu]hrung|kurzgef[üu]hrt|geteilt gef[üu]hrt|ersatz(bus|busse|verkehr|linie)?|schienenersatzverkehr|betrieb (nur|ab|bis)|st[öo]rung|verkehrsunfall|schadhafte[rs]? (zug|fahrzeug)|(rettungs|feuerwehr|polizei)einsatz|delays?|diverted|diversion)(?=$|[^\p{L}])/iu;

/**
 * @description A plain text: no tags, blank lines dropped.
 * @param {unknown} value - The text.
 * @param {number} [max] - Its longest length.
 * @returns {string} The text.
 */
function plainText(value, max = TEXT_MAX) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
}

/**
 * @description A short title.
 * @param {string} title - The title of the message.
 * @param {string} text - Its text.
 * @returns {string} The title, or the first sentence of the text, at most TITLE_MAX characters.
 */
function titleOf(title, text) {
  const [firstLine = ''] = text.split('\n');
  const sentence = title || (/^(.+?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine);
  return sentence.length > TITLE_MAX ? `${sentence.slice(0, TITLE_MAX - 1)}…` : sentence;
}

/**
 * @description The texts of a traffic info in a language, when the API gives
 * them (`languages: [{ de: { title, descriptionPlain } }, { en: … }]`).
 * @param {object} raw - The traffic info.
 * @param {string} language - "de", "en".
 * @returns {{ title: string, text: string }|null} The texts, null when none.
 */
function textsIn(raw, language) {
  for (const entry of asList(raw?.languages)) {
    const texts = entry?.[language];
    if (texts && typeof texts === 'object' && (texts.title || texts.descriptionPlain)) {
      return {
        title: String(texts.title ?? ''),
        text: String(texts.descriptionPlain ?? texts.description ?? ''),
      };
    }
  }
  return null;
}

/**
 * @description The weight of a message.
 * @param {string} channel - disruption, notice, elevator.
 * @param {string} text - Its German title and text.
 * @returns {string} `info`, `disrupted` or `major`.
 * @example
 * messageState('notice', 'Verkehrsunfall Derzeit kein Betrieb'); // -> 'major'
 */
function messageState(channel, text) {
  if (channel === 'elevator') {
    return 'info';
  }
  if (MAJOR_WORDS.test(text)) {
    return 'major';
  }
  if (channel === 'disruption') {
    return 'disrupted';
  }
  return DISRUPTED_WORDS.test(text) ? 'disrupted' : 'info';
}

/**
 * @description The distinct names of a list, in capitals.
 * @param {unknown} list - Line names or StopIDs.
 * @returns {string[]} The names.
 */
const namesOf = (list) => [
  ...new Set(
    (Array.isArray(list) ? list : [])
      .map((value) =>
        String(value ?? '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  ),
];

/**
 * @description What is kept of a traffic info.
 * @param {object} raw - The traffic info.
 * @param {string} channel - Its channel.
 * @param {string} [language] - The language of the texts.
 * @returns {object|null} `{ id, version, channel, state, lineIds, stopIds,
 * network, title, text, period, start, end, notifyUpdates }`, null when empty
 * or resolved.
 */
function messageOf(raw, channel, language = 'de') {
  if (!raw || typeof raw !== 'object' || String(raw.status ?? '').toLowerCase() === 'resolved') {
    return null;
  }
  const attributes = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {};
  const lineIds = namesOf(raw.relatedLines ?? attributes.relatedLines);
  const stopIds = namesOf(raw.relatedStops ?? attributes.relatedStops);
  const german = {
    title: plainText(raw.title, TITLE_MAX * 2).replace(/\n/g, ' '),
    text: plainText(raw.description),
  };
  let title;
  let text;
  let id = String(raw.name ?? '').slice(0, 120);
  let start = parseInstant(raw.time?.start);
  let end = parseInstant(raw.time?.end);
  if (channel === 'elevator') {
    // "Volkstheater: außer Betrieb", then where the elevator is and why.
    const station = plainText(attributes.station ?? raw.title, 80);
    const status = plainText(attributes.status, 60);
    title = [station, status].filter(Boolean).join(': ');
    text = [
      plainText(attributes.location ?? raw.description, 300),
      plainText(attributes.towards, 200),
      plainText(attributes.reason, 400),
    ]
      .filter(Boolean)
      .join('\n');
    // Its `time` is the next maintenance slot, not the outage.
    start = null;
    end = null;
  } else if (channel === 'notice') {
    // The two lines of a display: one sentence.
    title = titleOf(german.text.replace(/\n/g, ' '), '');
    text = '';
    id = `k-${slug(german.text, 80)}`;
  } else {
    const shown = (TEXT_LANGUAGES.includes(language) && textsIn(raw, language)) || null;
    text = shown ? plainText(shown.text) : german.text;
    title = titleOf(
      shown ? plainText(shown.title, TITLE_MAX * 2).replace(/\n/g, ' ') : german.title,
      text,
    );
  }
  if (!id || (!title && !text)) {
    return null;
  }
  const germanText = `${german.title} ${german.text}`;
  return {
    id,
    // The text, not `lastUpdate`: the control centre touches a message every
    // few minutes without changing a word.
    version: fold(germanText).slice(0, 300),
    channel,
    state: messageState(channel, germanText),
    lineIds,
    stopIds,
    // A disruption tied to nothing speaks of the whole network.
    network: channel === 'disruption' && lineIds.length === 0 && stopIds.length === 0,
    title,
    text: text === title ? '' : text,
    period: '',
    start,
    end,
    notifyUpdates: channel === 'disruption',
  };
}

/**
 * @description Read the traffic.
 * @param {object} answer - The answer of trafficInfoList.
 * @param {string} [language] - The language of the texts.
 * @returns {{ messages: object[] }} The messages: one per disruption and
 * elevator, one per text of the stop displays.
 */
function parseTraffic(answer, language = 'de') {
  const categories = new Map(
    asList(answer?.data?.trafficInfoCategories).map((category) => [
      String(category?.id),
      CHANNELS[String(category?.name ?? '').toLowerCase()] ?? null,
    ]),
  );
  const byId = new Map();
  for (const raw of asList(answer?.data?.trafficInfos)) {
    const channel = categories.get(String(raw?.refTrafficInfoCategoryId));
    const message = channel ? messageOf(raw, channel, language) : null;
    if (!message) {
      continue;
    }
    const known = byId.get(message.id);
    if (!known) {
      byId.set(message.id, message);
      continue;
    }
    // The same text on several platforms: one message, the widest period.
    known.lineIds = [...new Set([...known.lineIds, ...message.lineIds])];
    known.stopIds = [...new Set([...known.stopIds, ...message.stopIds])];
    const starts = [known.start, message.start];
    const ends = [known.end, message.end];
    known.start = starts.every(Number.isFinite) ? Math.min(...starts) : null;
    known.end = ends.every(Number.isFinite) ? Math.max(...ends) : null;
  }
  return { messages: [...byId.values()] };
}

/**
 * @description The rank of a state, for comparisons.
 * @param {string} state - A state.
 * @returns {number} Its position in STATES.
 */
const rank = (state) => STATES.indexOf(state);

/**
 * @description A message as it stands at an instant: under way, coming or over.
 * @param {object} message - The message.
 * @param {number} now - Now (ms).
 * @returns {object|null} The message with `coming`, null when over.
 */
function messageAt(message, now) {
  if (Number.isFinite(message.end) && message.end <= now) {
    return null;
  }
  if (Number.isFinite(message.start) && message.start > now) {
    return { ...message, coming: true };
  }
  return { ...message, coming: false };
}

/**
 * @description Whether a message concerns a line.
 * @param {object} message - The message.
 * @param {{ id: string, name: string }} line - The line.
 * @returns {boolean} True when it does.
 */
function concerns(message, line) {
  if (message.network) {
    return true;
  }
  return message.lineIds.some((id) => id === line.id || fold(id) === fold(line.name));
}

/**
 * @description The traffic of one line.
 * @param {object|null} traffic - parseTraffic().
 * @param {{ id: string, name: string }} line - The line.
 * @param {number} now - Now (ms).
 * @returns {{ state: string, since: number|null, messages: object[], upcoming: object[] }}
 * Its state, the messages under way (heaviest, then latest start first) and
 * the ones coming in the next three days (soonest first).
 */
function lineTraffic(traffic, line, now) {
  if (!traffic) {
    return { state: 'unknown', since: null, messages: [], upcoming: [] };
  }
  const own = traffic.messages
    .filter((message) => concerns(message, line))
    .map((message) => messageAt(message, now))
    .filter(Boolean)
    // The text of one platform never closes the whole line.
    .map((message) =>
      message.channel === 'notice' && message.state === 'major'
        ? { ...message, state: 'disrupted' }
        : message,
    );
  // The heaviest first; among equals, what the control centre wrote for the
  // line before the text of one display.
  const written = (message) => Number(message.channel === 'disruption');
  const messages = own
    .filter((message) => !message.coming)
    .sort(
      (a, b) =>
        rank(b.state) - rank(a.state) || written(b) - written(a) || (b.start ?? 0) - (a.start ?? 0),
    );
  const upcoming = own
    .filter((message) => message.coming && message.start - now <= UPCOMING_MS)
    .sort((a, b) => a.start - b.start);
  const state = messages[0]?.state ?? 'normal';
  return {
    state,
    since: SERIOUS.includes(state) ? (messages[0].start ?? null) : null,
    messages,
    upcoming,
  };
}

/**
 * @description The messages under way about a stop, heaviest first: the
 * disruptions of the lines calling there (and of the whole network), the
 * notices and elevators of its own platforms.
 * @param {object|null} traffic - parseTraffic().
 * @param {Array<{ id: string, name: string }>} lines - The lines of the stop.
 * @param {number} now - Now (ms).
 * @param {Iterable<string>} [sides] - The StopIDs of its platforms.
 * @returns {object[]} The messages, with `lines`: the names of those concerned.
 */
function messagesFor(traffic, lines, now, sides = []) {
  if (!traffic) {
    return [];
  }
  const platforms = new Set([...sides].map(String));
  return traffic.messages
    .map((message) => messageAt(message, now))
    .filter((message) => message && !message.coming)
    .map((message) => {
      if (message.channel === 'disruption') {
        return {
          ...message,
          lines: message.network
            ? []
            : lines.filter((line) => concerns(message, line)).map((line) => line.name),
        };
      }
      const here = message.stopIds.some((id) => platforms.has(id));
      return { ...message, here, lines: here ? message.lineIds : [] };
    })
    .filter((message) => message.network || message.here || message.lines.length > 0)
    .sort((a, b) => rank(b.state) - rank(a.state) || (b.start ?? 0) - (a.start ?? 0));
}

/**
 * @description The messages of a line about a disruption under way.
 * @param {{ messages: object[] }} line - lineTraffic().
 * @returns {object[]} The messages.
 */
const seriousMessages = (line) => line.messages.filter((m) => SERIOUS.includes(m.state));

export {
  STATES,
  SERIOUS,
  CHANNELS,
  UPCOMING_MS,
  plainText,
  titleOf,
  textsIn,
  messageState,
  messageOf,
  parseTraffic,
  rank,
  messageAt,
  concerns,
  lineTraffic,
  messagesFor,
  seriousMessages,
};
