// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// "Wiener Linien <stop> (<line> → <direction>)": one per followed stop.
// Read-only features:
//   - `next`        text: the next passage, "U1 → Oberlaa · 3 min";
//   - `wait`        duration (minutes): the wait of the next passage;
//   - `following`   duration (minutes): the wait of the one after;
//   - `delay`       duration (minutes): how late the next passage runs on its
//                   timetable (0 when on time or early);
//   - `messages`    counter: the traffic messages under way about the stop —
//                   the disruptions of the lines calling there (as filtered
//                   by line and direction), the notices of its displays and,
//                   when followed, its elevators out of service.
// "Wiener Linien U1", "Wiener Linien tram 18": one per followed line.
// Read-only features:
//   - `status`      text: its state and its heaviest message under way,
//                   "Disrupted: 18: Rettungseinsatz";
//   - `messages`    counter: its traffic messages under way.
//
// External ids: the codes of the stop, then the typed line and direction as
// slugs (`ext:wiener-linien:stop:60200657_u1_oberlaa`); the name of a line
// (`ext:wiener-linien:line:u1`, `…:line:13a`).
// `should_poll` stays false: the integration reads on its own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { t, passageText, lineLabel, lineDeviceName, lineStateText } from './i18n.js';
import { slug, typedLine } from './network.js';
import { minutesLeft, upcomingPassages } from './departures.js';

const DEVICE_TYPES = { STOP: 'stop', LINE: 'line' };
const FEATURE_KEYS = {
  NEXT: 'next',
  WAIT: 'wait',
  FOLLOWING: 'following',
  DELAY: 'delay',
  MESSAGES: 'messages',
  STATUS: 'status',
};
const MAX_WAIT = 180;
const MAX_COUNT = 20;
const TEXT_MAX = 250;

/**
 * @description The identifier of a followed stop.
 * @param {{ id: string }} stop - The resolved stop.
 * @param {string} line - The line typed, '' when none.
 * @param {string} direction - The direction typed, '' when none.
 * @returns {string} "60200657_u1_oberlaa".
 * @example
 * stopKey({ id: '60200657' }, 'U1', ''); // '60200657_u1'
 */
function stopKey(stop, line, direction) {
  const parts = [String(stop.id)];
  const lineSlug = line ? slug(typedLine(line), 16) : '';
  if (lineSlug) {
    parts.push(lineSlug);
  }
  const words = slug(direction, 24);
  if (words) {
    parts.push(words);
  }
  return parts.join('_');
}

/**
 * @description The key of a followed line: its name.
 * @param {{ id: string }} line - The line.
 * @returns {string} "u1", "13a".
 */
const lineKey = (line) => slug(line.id, 24) || 'line';

/**
 * @description The name of a followed stop: "Karlsplatz (U1 → Oberlaa)".
 * @param {object} followed - `{ stop, line, direction }`.
 * @returns {string} The name.
 */
function followedName({ stop, line, direction }) {
  const detail = [line, direction && `→ ${direction}`].filter(Boolean).join(' ');
  return detail ? `${stop.name} (${detail})` : stop.name;
}

/**
 * @description The external ids of a device.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} type - DEVICE_TYPES.
 * @param {string} key - The stop or line key.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const idsOf = (gladys, type, key) => gladys.externalIds(type, String(key).toLowerCase());

/**
 * @description What a device external id stands for.
 * @param {unknown} externalId - A device (or feature) external id.
 * @returns {{ type: string, key: string }|null} The type and key.
 * @example
 * parseExternalId('ext:wiener-linien:stop:147_41'); // { type: 'stop', key: '147_41' }
 */
function parseExternalId(externalId) {
  // A feature id ends with ":<feature key>": the device key stops before it.
  const match = /:(stop|line):([a-z0-9_-]+)(?::[a-z_]+)?$/.exec(String(externalId ?? ''));
  return match ? { type: match[1], key: match[2] } : null;
}

/**
 * @description A read-only feature.
 * @param {object} feature - Its fields.
 * @returns {object} The feature.
 */
const sensor = (feature) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...feature,
});

const textShape = {
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  keep_history: false,
  min: 0,
  max: 0,
};
const minutesShape = {
  category: DEVICE_FEATURE_CATEGORIES.DURATION,
  type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  unit: DEVICE_FEATURE_UNITS.MINUTES,
  keep_history: false,
  min: 0,
  max: MAX_WAIT,
};
const counterShape = {
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  min: 0,
  max: MAX_COUNT,
};

/**
 * @description Build the device of a followed stop.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} followed - The followed stop (`key`, `name`, `stop`, `line`).
 * @param {string} [language] - Language of the names.
 * @returns {object} The discovered device.
 */
function buildStopDevice(gladys, followed, language = 'en') {
  const ids = idsOf(gladys, DEVICE_TYPES.STOP, followed.key);
  const params = [{ name: 'WL_STOP', value: followed.stop.codes.join(', ') }];
  if (followed.line) {
    params.push({ name: 'WL_LINE', value: followed.line });
  }
  if (followed.direction) {
    params.push({ name: 'WL_DIRECTION', value: followed.direction });
  }
  return {
    name: t('stopDeviceName', language, { stop: followed.name }),
    external_id: ids.device,
    model: 'Wiener Linien',
    should_poll: false,
    params,
    features: [
      sensor({
        name: t('featureNext', language),
        external_id: ids.feature(FEATURE_KEYS.NEXT),
        ...textShape,
      }),
      sensor({
        name: t('featureWait', language),
        external_id: ids.feature(FEATURE_KEYS.WAIT),
        ...minutesShape,
      }),
      sensor({
        name: t('featureFollowing', language),
        external_id: ids.feature(FEATURE_KEYS.FOLLOWING),
        ...minutesShape,
      }),
      sensor({
        name: t('featureDelay', language),
        external_id: ids.feature(FEATURE_KEYS.DELAY),
        ...minutesShape,
      }),
      sensor({
        name: t('featureMessages', language),
        external_id: ids.feature(FEATURE_KEYS.MESSAGES),
        ...counterShape,
      }),
    ],
  };
}

/**
 * @description The states of a followed stop. Without a passage (the night),
 * the waits are left untouched: a 0 would fake a train now.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} followed - The followed stop.
 * @param {object} snapshot - Its last reading: `{ passages, messages }`
 * (`messages` null while the traffic is unknown).
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {object[]} The states.
 */
function buildStopStates(gladys, followed, snapshot, { language, now, timeZone }) {
  const ids = idsOf(gladys, DEVICE_TYPES.STOP, followed.key);
  const upcoming = upcomingPassages(snapshot.passages, now);
  const states = [
    {
      device_feature_external_id: ids.feature(FEATURE_KEYS.NEXT),
      text: (upcoming[0]
        ? passageText(upcoming[0], { language, now, timeZone })
        : t('noPassage', language)
      ).slice(0, TEXT_MAX),
    },
  ];
  [FEATURE_KEYS.WAIT, FEATURE_KEYS.FOLLOWING].forEach((key, index) => {
    if (upcoming[index]) {
      states.push({
        device_feature_external_id: ids.feature(key),
        state: Math.min(MAX_WAIT, minutesLeft(upcoming[index], now)),
      });
    }
  });
  // Only a passage followed live has a delay; early counts as on time.
  if (upcoming[0] && Number.isFinite(upcoming[0].delay)) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_KEYS.DELAY),
      state: Math.min(MAX_WAIT, Math.max(0, upcoming[0].delay)),
    });
  }
  if (Array.isArray(snapshot.messages)) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE_KEYS.MESSAGES),
      state: Math.min(MAX_COUNT, snapshot.messages.length),
    });
  }
  return states;
}

/**
 * @description Build the device of a followed line.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {{ id: string, name: string, mode: string }} line - The resolved line.
 * @param {string} [language] - Language of the names.
 * @returns {object} The discovered device.
 */
function buildLineDevice(gladys, line, language = 'en') {
  const ids = idsOf(gladys, DEVICE_TYPES.LINE, lineKey(line));
  return {
    name: lineDeviceName(line, language),
    external_id: ids.device,
    model: 'Wiener Linien',
    should_poll: false,
    params: [{ name: 'WL_LINE', value: line.name }],
    features: [
      sensor({
        name: t('featureStatus', language),
        external_id: ids.feature(FEATURE_KEYS.STATUS),
        ...textShape,
      }),
      sensor({
        name: t('featureLineMessages', language),
        external_id: ids.feature(FEATURE_KEYS.MESSAGES),
        ...counterShape,
      }),
    ],
  };
}

/**
 * @description The one-line status of a line: "Disrupted: 18: Rettungseinsatz".
 * @param {{ state: string, messages: object[] }} traffic - lineTraffic().
 * @param {string} language - The language.
 * @returns {string} The status.
 */
function lineStatusText(traffic, language) {
  const state = lineStateText(traffic.state, language);
  const [latest] = traffic.messages;
  return latest?.title ? t('stateWithTitle', language, { state, title: latest.title }) : state;
}

/**
 * @description The states of a followed line.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {{ id: string }} line - The resolved line.
 * @param {object} traffic - Its traffic (lineTraffic).
 * @param {string} language - Language of the text.
 * @returns {object[]} The states.
 */
function buildLineStates(gladys, line, traffic, language) {
  const ids = idsOf(gladys, DEVICE_TYPES.LINE, lineKey(line));
  return [
    {
      device_feature_external_id: ids.feature(FEATURE_KEYS.STATUS),
      text: lineStatusText(traffic, language).slice(0, TEXT_MAX),
    },
    {
      device_feature_external_id: ids.feature(FEATURE_KEYS.MESSAGES),
      state: Math.min(MAX_COUNT, traffic.messages.length),
    },
  ];
}

export {
  DEVICE_TYPES,
  FEATURE_KEYS,
  MAX_WAIT,
  MAX_COUNT,
  stopKey,
  lineKey,
  followedName,
  idsOf,
  parseExternalId,
  buildStopDevice,
  buildStopStates,
  buildLineDevice,
  lineStatusText,
  buildLineStates,
  lineLabel,
};
