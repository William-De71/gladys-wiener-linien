# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Wiener Linien, the U-Bahn,
trams and buses of Vienna: a Node.js service (Node 22+, ESM, no build step)
that runs in its own sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads the official real-time API of Wiener
Linien (`https://www.wienerlinien.at/ogd_realtime`, JSON, version 1.6,
documentation PDF under `/ogd_realtime/doku/`), open data of the City of
Vienna (CC BY 4.0), **without any key**: `monitor` for every followed stop —
three in the form, up to 7 more added with the "Add a stop" button — in ONE
request, and `trafficInfoList` (disruptions, display texts, elevators) every 5
minutes. The names and numbers of the stops and lines come from the open data
files published next to the documentation (`wienerlinien-ogd-haltestellen.csv`,
`-haltepunkte.csv`, `-linien.csv`, read weekly, kept in /data).
Transport: cloud only.

Tried against the real API on 2026-11-12. The answers of the fixtures are
built with the fields and formats recorded that day.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/widgets.test.js          # one file
DEBUG=gladys-integration-sdk npm test     # with the SDK debug logs
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only (new GladysIntegration + createApp)
src/app.js              every handler, registered before connect(); the timers
src/wl-api.js           HTTP client of the API: monitor, trafficInfoList, answers kept 15 s, messageCode errors
src/network.js          the stops, platforms and lines of the open data CSV files, typed names -> numbers
src/departures.js       monitor -> passages (line, mode, destination, forecast and timetable, delay)
src/traffic.js          trafficInfoList -> messages (disruption, notice, elevator), state of a line, messages of a stop
src/events.js           scene trigger transitions, payloads, scene action outputs
src/device.js           the stop and line devices and their states
src/widgets.js          departures and traffic dashboard widgets
src/store.js            /data/wiener-linien.json: network, `seen`
src/time.js             Vienna wall-clock times, times of day (TZ)
src/config.js           configuration (three stops + `added_stops`, lines, elevators, interval, language)
src/i18n.js             runtime texts, en / fr / de / es
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
docs/illustrations/     generated widget images (render.sh, gen.mjs, render.js)
test/fixtures/ogd/      the three CSV files reduced from the real ones (CC BY 4.0)
test/helpers/           the fake Wiener Linien: answers built with the recorded fields
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: device and
  feature external ids (`stop:<codes>_<line slug>_<direction slug>`, e.g.
  `stop:60200657_u1_oberlaa`: the DIVA number(s) of the stop or one StopID
  ("147"), never its name; the line is the typed one without "Linie", "tram",
  "bus"…; `line:<name>`, e.g. `line:u1`, `line:13a`), feature `category` /
  `type` / `unit` / `min` / `max` / `step`, the keys of `config_schema`,
  `actions`, the widgets and their settings, scene triggers (fields, options,
  variables) and scene actions (fields, outputs), and the internal config keys
  `added_stops` (`[{ stop, line, direction }]`, the stop stored as its number
  when it has one) and `last_language`. `test/structure.test.js` compares
  them to `test/fixtures/discovery.baseline.json`: never update the baseline
  to make a test pass without a documented migration.
- **Category / type pairs.** The next passage and the line status are `text` /
  `text`, the waits and the delay `duration` / `integer` in minutes (0-180),
  the counts of messages `counter-sensor` / `integer` (0-20). Without a
  passage the waits are not published (a 0 would announce a train now);
  without a forecast the delay is not published; before the traffic is read,
  the count of a stop is not published.
- **No secret.** The API is open: there is no key, and no field of type
  `secret`. Never add one "for later".
- **Politeness.** One `monitor` request reads every followed stop (`diva` and
  `stopId` repeated); an answer is kept 15 seconds (wl-api.js); the request
  limit reached (`messageCode` 316, or HTTP 429) pauses every request for 5
  minutes. `should_poll` stays false: the integration reads on its own timer
  — the stops every interval (30 s to 5 min, 1 min by default; 10 min while
  no stop announces anything in the next 45 minutes), the traffic every 5
  minutes. A widget or a scene action reuses a reading of less than a minute.
- **Errors come with HTTP 200.** Every answer carries `message.messageCode`:
  1 is a success, 311 / 322 the database, 312 an unknown stop, 316 the limit,
  320 / 321 a parameter. Read it before `data`.
- **Stops.** A stop is a name (every DIVA number of that name: two
  "Kirchengasse"), the name of one of its platforms as the displays write it
  ("Karlsplatz U"), a DIVA number ("60200657", 7 digits or more: the whole
  stop) or a StopID ("4120", the former RBL number: one platform). Searching
  never asks the real-time API. A number typed is accepted even when the
  files cannot be read.
- **Times.** The API writes ISO 8601 times with their offset and no colon
  ("2026-11-12T21:59:00.000+0100"); without one, a Vienna wall-clock time
  (`wallToInstant()`). Never `Date.parse()` them.
- **Real time and delay.** `timeReal` is the forecast, present only when the
  vehicle is followed live; `timePlanned` the timetable. The delay is their
  difference, said from 2 minutes (`LATE_MINUTES`); an early vehicle counts
  as on time. Without `timeReal`, say "(timetable)" (a star in the widget)
  and publish no delay. The API lists no cancelled trip: never invent one.
- **Traffic.** Three channels: `disruption` (`stoerunglang`, written by the
  control centre, one per line: follow-ups of one incident are separate
  messages), `notice` (`stoerungkurz`, the text of one platform display: the
  entries of one text are ONE message) and `elevator` (`aufzugsinfo`, asked
  only when the user follows the elevators). The weight is always read in the
  German text, whatever language is shown. On a line, a notice never weighs
  more than `disrupted`. A stop gets the disruptions of the lines calling
  there and the notices and elevators of its own platforms (`relatedStops`
  are StopIDs). A `resolved` disruption is over. The `time` of an elevator is
  its next maintenance slot, not the outage: ignore it.
- **Events once.** `seen` (in /data) remembers the reminders fired per stop,
  the state and the messages (with their version) of each followed line and
  stop. The first reading is a baseline: nothing fires. The version of a
  message is its German text, not `lastUpdate` (touched every few minutes): a
  disruption fires again only when its words change. A message of a followed
  line fires on the line, not again on a stop. A scene action or a widget
  never fires an event.
- **Data licence.** CC BY 4.0, "Data source: City of Vienna –
  data.wien.gv.at": keep "Wiener Linien" and the time of the reading visible
  in the widgets, and the credit in the README, the docs and NOTICE.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, runtime messages in
  `src/i18n.js`, `docs/*.md`, README) exists in English, French, German and
  Spanish. `test/i18n.test.js` checks it. Names of stops and destinations
  stay as Wiener Linien write them; the traffic messages come in German
  (English when the API gives it and the user reads English).
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  The version stays below 1.0.0 until the maintainer runs the Release workflow
  with `release-as: 1.0.0`.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing.
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language; the file stays under
  100 KB. `gladys_version` is `>=5.3.0` (widgets, scene triggers, catalog
  `keywords` and `countries`). Transport: `["cloud"]`. `countries`: `["AT"]`.
  No permission.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the fake Wiener Linien of
  `test/helpers/fixtures.js`).
