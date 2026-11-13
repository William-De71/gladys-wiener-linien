// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The two widgets on a Thursday evening at Karlsplatz: the answers of
// test/helpers/fixtures.js (built with the fields recorded from the real API,
// the stop and line names of the real open data files of Wiener Linien) go
// through the real parsers (src/departures.js, src/traffic.js) and the real
// widget builders (src/widgets.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildDeparturesWidget, buildTrafficWidget } = await load('src/widgets.js');
const { parsePassages } = await load('src/departures.js');
const { parseTraffic, lineTraffic } = await load('src/traffic.js');
const { parseLines } = await load('src/network.js');
const { LANGUAGES } = await load('src/i18n.js');
const fixtures = await load('test/helpers/fixtures.js');
const { NOW, TZ, KARLSPLATZ, MONITORS, at, monitor, departure, disruption, notice, elevator } =
  fixtures;
const { trafficInfoList } = fixtures;
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const lines = parseLines(fixtures.LINES_CSV);
const lineById = (id) => lines.find((line) => line.id === id) ?? null;
const passages = parsePassages(
  {
    data: {
      monitors: [
        ...MONITORS,
        monitor({
          rbl: 4421,
          name: 'U4',
          towards: 'Heiligenstadt',
          direction: 'R',
          lineId: 304,
          departures: [departure(2), departure(8)],
        }),
        monitor({
          rbl: 4202,
          name: 'U2',
          towards: 'Seestadt',
          lineId: 302,
          departures: [departure(5), departure(11, { delay: 2 })],
        }),
      ],
    },
    message: { value: 'OK', messageCode: 1, serverTime: at(0) },
  },
  { codes: [KARLSPLATZ] },
);
const traffic = (language) =>
  parseTraffic(
    trafficInfoList([
      disruption({
        english: [
          'U4: Defective vehicle',
          'Line U4: after an obstruction, trains run at irregular intervals.',
        ],
      }),
      disruption({
        name: 'I20261112-0061-F01',
        title: '18: Rettungseinsatz',
        description:
          'Linie 18: Betrieb nur zwischen Schlachthausgasse und Quartier Belvedere. Ersatz: Linien O und 62.',
        lines: ['18'],
        stops: [],
        start: -35,
        end: 45,
      }),
      disruption({
        name: 'I20261020-0029',
        title: '1: Gleisbauarbeiten',
        description:
          'Linie 1: Betrieb nur zwischen Prater Hauptallee und Knöllgasse. Ersatz: Linien 7A und 65A.',
        lines: ['1'],
        stops: [],
        start: 60 * 30,
        end: 60 * 24 * 20,
      }),
      notice({ stop: 189, line: '41', lineId: 141 }),
      elevator(),
    ]),
    language,
  );
const followed = ['U1', 'U4', '18', '41', '13A'].map(lineById);

const contents = {};
for (const language of LANGUAGES) {
  const read = traffic(language);
  contents[language] = {
    departures: buildDeparturesWidget({
      title: 'Karlsplatz',
      passages,
      readAt: NOW,
      count: 6,
      language,
      now: NOW,
      timeZone: TZ,
    }),
    traffic: buildTrafficWidget({
      lines: followed.map((line) => ({ line, traffic: lineTraffic(read, line, NOW) })),
      readAt: NOW,
      language,
      now: NOW,
      timeZone: TZ,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
