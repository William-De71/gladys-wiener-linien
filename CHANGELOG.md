# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-11-13

### Added

- One device per followed stop of Wiener Linien in Vienna (three in the form and up to 7 more with the "Add a stop" button, typed by name or by number, filtered by line and direction): the next departure as text, the wait of the next two departures, the delay of the next one and the number of traffic messages about the stop, in real time, from the official open data API of Wiener Linien (no key).
- One device per followed line (U-Bahn, trams, buses): its traffic state (normal, information, disrupted, heavily disrupted) and its number of traffic messages, from the disruptions of the control centre and the special texts of the stop displays.
- Optional follow-up of the elevators out of service, counted among the traffic messages of the stops and lines.
- Scene triggers: departure soon (2 to 20 minutes before, with the delay), line disrupted, back to normal, and a new traffic message about a followed line or stop (filter by kind; a disruption whose text changes fires again).
- Scene actions: read the next departures of a stop, and the traffic of a line, each with a ready-made sentence.
- Dashboard widgets: the next departures of one or several stops, like the displays of the stops (any stop can be typed in the widget); the traffic of the followed lines (or of the U-Bahn lines) with their messages under way and coming.
- Configuration actions: test the connection, find a stop by name (from the open data files of Wiener Linien, without asking the real-time API), add, list and remove stops, and a diagnostic written to the Logs tab.
- Polite with the API: one request for all the followed stops, answers kept 15 seconds, a pause of 5 minutes when the request limit is reached, fewer readings at night.
- Cloud transport: the real-time API of Wiener Linien (open data of the City of Vienna, CC BY 4.0) and its stop and line files, read weekly and kept in /data.
- English, French, German and Spanish everywhere: settings, devices, widgets, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-wiener-linien/releases/tag/v0.1.0
