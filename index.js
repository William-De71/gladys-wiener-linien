// -----------------------------------------------------------------------------
// Entry point of the Wiener Linien external integration.
//
// Brings the metro, trams and buses of Vienna into Gladys through the official
// real-time API of Wiener Linien (open data of the City of Vienna, no key):
//   - devices: one per followed stop, with the next passages, the waits, the
//     delay and the count of traffic messages; one per followed line, with
//     its traffic (src/device.js);
//   - scene triggers: departure soon, line disrupted, back to normal, new
//     traffic message;
//   - scene actions: read the next passages of a stop, the traffic of a line;
//   - dashboard widgets: departures, traffic.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Wiener Linien integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
