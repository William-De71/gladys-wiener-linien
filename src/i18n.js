// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: device and feature names, widget contents, scene
// summaries, messages of the Configuration screen. Vocabulary of the Gladys
// interface (appareil / Gerät / dispositivo, scène / Szene / escena) and of
// public transport (arrêt, ligne, passage, info trafic). The names of stops
// and lines and the destinations stay as Wiener Linien write them; the traffic
// messages come in German (sometimes English).
// -----------------------------------------------------------------------------

import { minutesLeft } from './departures.js';

import { formatTime } from './time.js';

const BRAND = 'Wiener Linien';
// A passage this many minutes behind its timetable is said late.
const LATE_MINUTES = 2;

const LANGUAGES = ['en', 'fr', 'de', 'es'];
const TEXTS = {
  stopDeviceName: {
    en: 'Wiener Linien {stop}',
    fr: 'Wiener Linien {stop}',
    de: 'Wiener Linien {stop}',
    es: 'Wiener Linien {stop}',
  },
  featureNext: {
    en: 'Next passage',
    fr: 'Prochain passage',
    de: 'Nächste Abfahrt',
    es: 'Próximo paso',
  },
  featureWait: {
    en: 'Wait',
    fr: 'Attente',
    de: 'Wartezeit',
    es: 'Espera',
  },
  featureFollowing: {
    en: 'Wait for the following one',
    fr: 'Attente du suivant',
    de: 'Wartezeit der folgenden',
    es: 'Espera del siguiente',
  },
  featureDelay: {
    en: 'Delay of the next passage',
    fr: 'Retard du prochain passage',
    de: 'Verspätung der nächsten Abfahrt',
    es: 'Retraso del próximo paso',
  },
  featureMessages: {
    en: 'Traffic messages of the stop',
    fr: 'Infos trafic de l’arrêt',
    de: 'Verkehrsmeldungen der Haltestelle',
    es: 'Avisos de tráfico de la parada',
  },
  featureStatus: {
    en: 'Traffic',
    fr: 'Trafic',
    de: 'Verkehr',
    es: 'Tráfico',
  },
  featureLineMessages: {
    en: 'Traffic messages',
    fr: 'Infos trafic',
    de: 'Verkehrsmeldungen',
    es: 'Avisos de tráfico',
  },
  tramLineLabel: {
    en: 'Tram {line}',
    fr: 'Tram {line}',
    de: 'Straßenbahn {line}',
    es: 'Tranvía {line}',
  },
  busLineLabel: {
    en: 'Bus {line}',
    fr: 'Bus {line}',
    de: 'Bus {line}',
    es: 'Autobús {line}',
  },
  metroLineLabel: {
    en: '{line}',
    fr: '{line}',
    de: '{line}',
    es: '{line}',
  },
  trainLineLabel: {
    en: '{line}',
    fr: '{line}',
    de: '{line}',
    es: '{line}',
  },
  tramDeviceName: {
    en: 'Wiener Linien tram {line}',
    fr: 'Wiener Linien tram {line}',
    de: 'Wiener Linien Straßenbahn {line}',
    es: 'Wiener Linien tranvía {line}',
  },
  busDeviceName: {
    en: 'Wiener Linien bus {line}',
    fr: 'Wiener Linien bus {line}',
    de: 'Wiener Linien Bus {line}',
    es: 'Wiener Linien autobús {line}',
  },
  metroDeviceName: {
    en: 'Wiener Linien {line}',
    fr: 'Wiener Linien {line}',
    de: 'Wiener Linien {line}',
    es: 'Wiener Linien {line}',
  },
  trainDeviceName: {
    en: 'Wiener Linien {line}',
    fr: 'Wiener Linien {line}',
    de: 'Wiener Linien {line}',
    es: 'Wiener Linien {line}',
  },
  state_unknown: {
    en: 'Unknown',
    fr: 'Inconnu',
    de: 'Unbekannt',
    es: 'Desconocido',
  },
  state_normal: {
    en: 'Normal service',
    fr: 'Trafic normal',
    de: 'Normaler Betrieb',
    es: 'Servicio normal',
  },
  state_info: {
    en: 'Information',
    fr: 'Information',
    de: 'Information',
    es: 'Información',
  },
  state_disrupted: {
    en: 'Disrupted',
    fr: 'Perturbé',
    de: 'Gestört',
    es: 'Alterado',
  },
  state_major: {
    en: 'Heavily disrupted',
    fr: 'Très perturbé',
    de: 'Stark gestört',
    es: 'Muy alterado',
  },
  kind_disruption: {
    en: 'Disruption',
    fr: 'Perturbation',
    de: 'Störung',
    es: 'Incidencia',
  },
  kind_notice: {
    en: 'Stop notice',
    fr: 'Info à l’arrêt',
    de: 'Haltestellenhinweis',
    es: 'Aviso de parada',
  },
  kind_elevator: {
    en: 'Elevator',
    fr: 'Ascenseur',
    de: 'Aufzug',
    es: 'Ascensor',
  },
  stateWithTitle: {
    en: '{state}: {title}',
    fr: '{state} : {title}',
    de: '{state}: {title}',
    es: '{state}: {title}',
  },
  upcomingState: {
    en: 'Coming',
    fr: 'À venir',
    de: 'Demnächst',
    es: 'Próximamente',
  },
  wholeNetwork: {
    en: 'the whole network',
    fr: 'tout le réseau',
    de: 'das gesamte Netz',
    es: 'toda la red',
  },
  wholeNetworkShort: {
    en: 'Network',
    fr: 'Réseau',
    de: 'Netz',
    es: 'Red',
  },
  noPassage: {
    en: 'No passage announced',
    fr: 'Aucun passage annoncé',
    de: 'Keine Abfahrt angekündigt',
    es: 'Ningún paso anunciado',
  },
  minutesValue: {
    en: '{n} min',
    fr: '{n} min',
    de: '{n} Min.',
    es: '{n} min',
  },
  approaching: {
    en: 'Approaching',
    fr: 'À l’approche',
    de: 'Fährt ein',
    es: 'Llegando',
  },
  inMinutes: {
    en: 'in {n} min',
    fr: 'dans {n} min',
    de: 'in {n} Min.',
    es: 'dentro de {n} min',
  },
  atTime: {
    en: 'at {time}',
    fr: 'à {time}',
    de: 'um {time}',
    es: 'a las {time}',
  },
  scheduledMark: {
    en: '(timetable)',
    fr: '(théorique)',
    de: '(Fahrplan)',
    es: '(teórico)',
  },
  delayMark: {
    en: '(+{n} min)',
    fr: '(+{n} min)',
    de: '(+{n} Min.)',
    es: '(+{n} min)',
  },
  summarySoon: {
    en: '{line} towards {destination} leaves {stop} in {minutes} min ({time}).',
    fr: '{line} vers {destination} passe à {stop} dans {minutes} min ({time}).',
    de: '{line} Richtung {destination} fährt an {stop} in {minutes} Min. ab ({time}).',
    es: '{line} hacia {destination} pasa por {stop} dentro de {minutes} min ({time}).',
  },
  summarySoonScheduled: {
    en: '{line} towards {destination} leaves {stop} in {minutes} min ({time}, timetable).',
    fr: '{line} vers {destination} passe à {stop} dans {minutes} min ({time}, horaire théorique).',
    de: '{line} Richtung {destination} fährt an {stop} in {minutes} Min. ab ({time}, laut Fahrplan).',
    es: '{line} hacia {destination} pasa por {stop} dentro de {minutes} min ({time}, horario teórico).',
  },
  summarySoonDelayed: {
    en: '{line} towards {destination} leaves {stop} in {minutes} min ({time}, {delay} min late).',
    fr: '{line} vers {destination} passe à {stop} dans {minutes} min ({time}, {delay} min de retard).',
    de: '{line} Richtung {destination} fährt an {stop} in {minutes} Min. ab ({time}, {delay} Min. verspätet).',
    es: '{line} hacia {destination} pasa por {stop} dentro de {minutes} min ({time}, {delay} min de retraso).',
  },
  summaryMessage: {
    en: 'Wiener Linien {kind} ({lines}): {title}',
    fr: 'Wiener Linien {kind} ({lines}) : {title}',
    de: 'Wiener Linien {kind} ({lines}): {title}',
    es: 'Wiener Linien {kind} ({lines}): {title}',
  },
  summaryMessageUpdated: {
    en: 'Wiener Linien {kind} updated ({lines}): {title}',
    fr: 'Wiener Linien {kind} mise à jour ({lines}) : {title}',
    de: 'Wiener Linien {kind} aktualisiert ({lines}): {title}',
    es: 'Wiener Linien {kind} actualizada ({lines}): {title}',
  },
  summaryDisrupted: {
    en: '{line}: {state}.',
    fr: '{line} : {state}.',
    de: '{line}: {state}.',
    es: '{line}: {state}.',
  },
  summaryDisruptedTitle: {
    en: '{line}: {state}. {title}',
    fr: '{line} : {state}. {title}',
    de: '{line}: {state}. {title}',
    es: '{line}: {state}. {title}',
  },
  summaryRestored: {
    en: '{line}: back to normal ({state}).',
    fr: '{line} : retour à la normale ({state}).',
    de: '{line}: wieder normal ({state}).',
    es: '{line}: vuelta a la normalidad ({state}).',
  },
  summaryLineState: {
    en: '{line}: {state}. {title}',
    fr: '{line} : {state}. {title}',
    de: '{line}: {state}. {title}',
    es: '{line}: {state}. {title}',
  },
  summaryLineStateOnly: {
    en: '{line}: {state}.',
    fr: '{line} : {state}.',
    de: '{line}: {state}.',
    es: '{line}: {state}.',
  },
  outputNext: {
    en: 'Next passage at {stop}: {line} towards {destination} {when}.',
    fr: 'Prochain passage à {stop} : {line} vers {destination} {when}.',
    de: 'Nächste Abfahrt an {stop}: {line} Richtung {destination} {when}.',
    es: 'Próximo paso en {stop}: {line} hacia {destination} {when}.',
  },
  outputFollowing: {
    en: 'The following one {when}.',
    fr: 'Le suivant {when}.',
    de: 'Die folgende {when}.',
    es: 'El siguiente {when}.',
  },
  outputNone: {
    en: 'No passage announced at {stop}.',
    fr: 'Aucun passage annoncé à {stop}.',
    de: 'Keine Abfahrt an {stop} angekündigt.',
    es: 'Ningún paso anunciado en {stop}.',
  },
  readAt: {
    en: 'read at {time}',
    fr: 'lu à {time}',
    de: 'gelesen um {time}',
    es: 'leído a las {time}',
  },
  updatedAt: {
    en: 'Wiener Linien · updated at {time}',
    fr: 'Wiener Linien · mis à jour à {time}',
    de: 'Wiener Linien · aktualisiert um {time}',
    es: 'Wiener Linien · actualizado a las {time}',
  },
  timetableStar: {
    en: '* timetable only',
    fr: '* horaire théorique',
    de: '* nur Fahrplan',
    es: '* horario teórico',
  },
  minutesShort: {
    en: 'min',
    fr: 'min',
    de: 'Min.',
    es: 'min',
  },
  trafficTitle: {
    en: 'Wiener Linien traffic',
    fr: 'Trafic Wiener Linien',
    de: 'Wiener Linien Verkehrslage',
    es: 'Tráfico Wiener Linien',
  },
  periodFromTo: {
    en: '{start} → {end}',
    fr: '{start} → {end}',
    de: '{start} → {end}',
    es: '{start} → {end}',
  },
  periodFrom: {
    en: 'from {start}',
    fr: 'depuis {start}',
    de: 'seit {start}',
    es: 'desde {start}',
  },
  noMessage: {
    en: 'No traffic message under way.',
    fr: 'Aucune info trafic en cours.',
    de: 'Keine aktuelle Verkehrsmeldung.',
    es: 'Ningún aviso de tráfico en curso.',
  },
  widgetNoStop: {
    en: 'No stop is followed: add one on the Configuration screen of the integration, or type one in the widget settings.',
    fr: 'Aucun arrêt n’est suivi : ajoutez-en un dans l’écran Configuration de l’intégration, ou saisissez-en un dans les réglages du widget.',
    de: 'Keine Haltestelle wird verfolgt: Füge eine im Konfigurationsbildschirm der Integration hinzu oder gib eine in den Widget-Einstellungen ein.',
    es: 'No se sigue ninguna parada: añade una en la pantalla Configuración de la integración, o escribe una en los ajustes del widget.',
  },
  widgetNoLine: {
    en: 'No line or stop is followed: add a line or a stop on the Configuration screen of the integration, or type lines in the widget settings.',
    fr: 'Aucune ligne ni aucun arrêt n’est suivi : ajoutez une ligne ou un arrêt dans l’écran Configuration de l’intégration, ou saisissez des lignes dans les réglages du widget.',
    de: 'Keine Linie und keine Haltestelle wird verfolgt: Füge im Konfigurationsbildschirm der Integration eine Linie oder Haltestelle hinzu oder gib Linien in den Widget-Einstellungen ein.',
    es: 'No se sigue ninguna línea ni parada: añade una línea o una parada en la pantalla Configuración de la integración, o escribe líneas en los ajustes del widget.',
  },
  statusThrottled: {
    en: 'The Wiener Linien API asks to slow down: readings resume at {time}.',
    fr: 'L’API des Wiener Linien demande de ralentir : reprise des lectures à {time}.',
    de: 'Die API der Wiener Linien bittet um weniger Anfragen: Abfragen ab {time}.',
    es: 'La API de Wiener Linien pide reducir el ritmo: las lecturas se reanudan a las {time}.',
  },
  statusUnreachable: {
    en: 'The Wiener Linien API does not answer ({detail}). Next try in {minutes} min.',
    fr: 'L’API des Wiener Linien ne répond pas ({detail}). Nouvel essai dans {minutes} min.',
    de: 'Die API der Wiener Linien antwortet nicht ({detail}). Neuer Versuch in {minutes} Min.',
    es: 'La API de Wiener Linien no responde ({detail}). Nuevo intento dentro de {minutes} min.',
  },
  statusConnected: {
    en: 'Connected to Wiener Linien: {stops} stop(s) read every {interval} s, {lines} line(s) followed.',
    fr: 'Connecté aux Wiener Linien : {stops} arrêt(s) lus toutes les {interval} s, {lines} ligne(s) suivie(s).',
    de: 'Mit den Wiener Linien verbunden: {stops} Haltestelle(n) alle {interval} s gelesen, {lines} Linie(n) verfolgt.',
    es: 'Conectado a Wiener Linien: {stops} parada(s) leídas cada {interval} s, {lines} línea(s) seguida(s).',
  },
  statusNotFound: {
    en: 'Unknown or ambiguous: {names}.',
    fr: 'Inconnu ou ambigu : {names}.',
    de: 'Unbekannt oder mehrdeutig: {names}.',
    es: 'Desconocido o ambiguo: {names}.',
  },
  statusNothing: {
    en: 'Ready. Add a stop or a line on the Configuration screen.',
    fr: 'Prêt. Ajoutez un arrêt ou une ligne dans l’écran Configuration.',
    de: 'Bereit. Füge im Konfigurationsbildschirm eine Haltestelle oder Linie hinzu.',
    es: 'Listo. Añade una parada o una línea en la pantalla Configuración.',
  },
  linesUnknown: {
    en: 'Lines unknown to Wiener Linien: {names}.',
    fr: 'Lignes inconnues des Wiener Linien : {names}.',
    de: 'Den Wiener Linien unbekannte Linien: {names}.',
    es: 'Líneas desconocidas para Wiener Linien: {names}.',
  },
  testNetworkOk: {
    en: 'Stops and lines of Wiener Linien read: {stops} stops, {lines} lines',
    fr: 'Arrêts et lignes des Wiener Linien lus : {stops} arrêts, {lines} lignes',
    de: 'Haltestellen und Linien der Wiener Linien gelesen: {stops} Haltestellen, {lines} Linien',
    es: 'Paradas y líneas de Wiener Linien leídas: {stops} paradas, {lines} líneas',
  },
  testStopsError: {
    en: 'Stop list: {error}',
    fr: 'Liste des arrêts : {error}',
    de: 'Haltestellenliste: {error}',
    es: 'Lista de paradas: {error}',
  },
  testTraffic: {
    en: 'traffic: {count} message(s) on the network',
    fr: 'trafic : {count} message(s) sur le réseau',
    de: 'Verkehr: {count} Meldung(en) im Netz',
    es: 'tráfico: {count} aviso(s) en la red',
  },
  testTrafficError: {
    en: 'traffic: {error}',
    fr: 'trafic : {error}',
    de: 'Verkehr: {error}',
    es: 'tráfico: {error}',
  },
  testStop: {
    en: '{stop}: {count} passage(s), next {next}',
    fr: '{stop} : {count} passage(s), prochain {next}',
    de: '{stop}: {count} Abfahrt(en), nächste {next}',
    es: '{stop}: {count} paso(s), próximo {next}',
  },
  testStopError: {
    en: '{stop}: {error}',
    fr: '{stop} : {error}',
    de: '{stop}: {error}',
    es: '{stop}: {error}',
  },
  testNoStop: {
    en: 'no stop followed yet',
    fr: 'aucun arrêt suivi pour l’instant',
    de: 'noch keine Haltestelle verfolgt',
    es: 'aún no se sigue ninguna parada',
  },
  unknownEntry: {
    en: 'unknown or ambiguous: {name}',
    fr: 'inconnu ou ambigu : {name}',
    de: 'unbekannt oder mehrdeutig: {name}',
    es: 'desconocido o ambiguo: {name}',
  },
  errorUnreachable: {
    en: 'the Wiener Linien API does not answer',
    fr: 'l’API des Wiener Linien ne répond pas',
    de: 'die API der Wiener Linien antwortet nicht',
    es: 'la API de Wiener Linien no responde',
  },
  errorBusy: {
    en: 'the Wiener Linien server is busy, try again in a moment',
    fr: 'le serveur des Wiener Linien est occupé, réessayez dans un instant',
    de: 'der Server der Wiener Linien ist ausgelastet, versuche es gleich noch einmal',
    es: 'el servidor de Wiener Linien está ocupado, inténtalo de nuevo en un momento',
  },
  errorThrottled: {
    en: 'the Wiener Linien API asks to slow down',
    fr: 'l’API des Wiener Linien demande de ralentir',
    de: 'die API der Wiener Linien bittet um weniger Anfragen',
    es: 'la API de Wiener Linien pide reducir el ritmo',
  },
  errorInvalid: {
    en: 'the Wiener Linien API refuses the request',
    fr: 'l’API des Wiener Linien refuse la requête',
    de: 'die API der Wiener Linien lehnt die Anfrage ab',
    es: 'la API de Wiener Linien rechaza la petición',
  },
  errorNetwork: {
    en: 'the stops and lines of Wiener Linien cannot be read',
    fr: 'les arrêts et lignes des Wiener Linien ne peuvent pas être lus',
    de: 'die Haltestellen und Linien der Wiener Linien können nicht gelesen werden',
    es: 'las paradas y líneas de Wiener Linien no se pueden leer',
  },
  searchTooShort: {
    en: 'Type at least two letters of the stop name.',
    fr: 'Saisissez au moins deux lettres du nom de l’arrêt.',
    de: 'Gib mindestens zwei Buchstaben des Haltestellennamens ein.',
    es: 'Escribe al menos dos letras del nombre de la parada.',
  },
  searchNone: {
    en: 'No stop matches "{query}".',
    fr: 'Aucun arrêt ne correspond à « {query} ».',
    de: 'Keine Haltestelle passt zu „{query}“.',
    es: 'Ninguna parada coincide con «{query}».',
  },
  searchFound: {
    en: 'Type the name, or the number in brackets (the whole stop, every platform and line):\n{list}',
    fr: 'Saisissez le nom, ou le numéro entre crochets (tout l’arrêt, tous les quais et lignes) :\n{list}',
    de: 'Gib den Namen oder die Nummer in Klammern ein (die ganze Haltestelle, alle Steige und Linien):\n{list}',
    es: 'Escribe el nombre, o el número entre corchetes (toda la parada, todos los andenes y líneas):\n{list}',
  },
  searchMore: {
    en: '… and {n} more: add words to the name.',
    fr: '… et {n} autres : ajoutez des mots au nom.',
    de: '… und {n} weitere: Füge dem Namen Wörter hinzu.',
    es: '… y {n} más: añade palabras al nombre.',
  },
  stopAdded: {
    en: 'Stop added: {name}. {count} stop(s) followed. Its device is offered in the Discover tab.',
    fr: 'Arrêt ajouté : {name}. {count} arrêt(s) suivi(s). Son appareil est proposé dans l’onglet Découvrir.',
    de: 'Haltestelle hinzugefügt: {name}. {count} Haltestelle(n) verfolgt. Ihr Gerät wird im Tab Entdecken angeboten.',
    es: 'Parada añadida: {name}. {count} parada(s) seguida(s). Su dispositivo se ofrece en la pestaña Descubrir.',
  },
  stopAlreadyFollowed: {
    en: '{name} is already followed.',
    fr: '{name} est déjà suivi.',
    de: '{name} wird bereits verfolgt.',
    es: '{name} ya se sigue.',
  },
  stopsFull: {
    en: 'Already {max} stops added: remove one first.',
    fr: 'Déjà {max} arrêts ajoutés : retirez-en un d’abord.',
    de: 'Bereits {max} Haltestellen hinzugefügt: entferne zuerst eine.',
    es: 'Ya hay {max} paradas añadidas: quita una primero.',
  },
  stopRemoved: {
    en: 'Stop removed: {name}. Delete its device in Gladys if you no longer want it.',
    fr: 'Arrêt retiré : {name}. Supprimez son appareil dans Gladys si vous n’en voulez plus.',
    de: 'Haltestelle entfernt: {name}. Lösche ihr Gerät in Gladys, wenn du es nicht mehr brauchst.',
    es: 'Parada quitada: {name}. Borra su dispositivo en Gladys si ya no lo quieres.',
  },
  stopRemoveUnknown: {
    en: 'No added stop matches "{query}": type its number given by "List the stops".',
    fr: 'Aucun arrêt ajouté ne correspond à « {query} » : saisissez son numéro donné par « Lister les arrêts ».',
    de: 'Keine hinzugefügte Haltestelle passt zu „{query}“: gib ihre Nummer aus „Haltestellen auflisten“ ein.',
    es: 'Ninguna parada añadida coincide con «{query}»: escribe su número dado por «Listar las paradas».',
  },
  stopRemoveAmbiguous: {
    en: 'Several added stops match "{query}": type the number given by "List the stops".',
    fr: 'Plusieurs arrêts ajoutés correspondent à « {query} » : saisissez le numéro donné par « Lister les arrêts ».',
    de: 'Mehrere hinzugefügte Haltestellen passen zu „{query}“: gib die Nummer aus „Haltestellen auflisten“ ein.',
    es: 'Varias paradas añadidas coinciden con «{query}»: escribe el número dado por «Listar las paradas».',
  },
  stopInForm: {
    en: '{name} is stop {slot} of the form: empty its field, then save the configuration.',
    fr: '{name} est l’arrêt {slot} du formulaire : videz son champ, puis enregistrez la configuration.',
    de: '{name} ist Haltestelle {slot} des Formulars: leere ihr Feld und speichere dann die Konfiguration.',
    es: '{name} es la parada {slot} del formulario: vacía su campo y guarda la configuración.',
  },
  stopsNone: {
    en: 'No stop followed yet: fill in a stop of the form or press "Add a stop".',
    fr: 'Aucun arrêt suivi pour l’instant : remplissez un arrêt du formulaire ou appuyez sur « Ajouter un arrêt ».',
    de: 'Noch keine Haltestelle verfolgt: fülle eine Haltestelle im Formular aus oder drücke „Haltestelle hinzufügen“.',
    es: 'Aún no se sigue ninguna parada: rellena una parada del formulario o pulsa «Añadir una parada».',
  },
  stopsList: {
    en: '{count} stop(s) followed:\n{list}',
    fr: '{count} arrêt(s) suivi(s) :\n{list}',
    de: '{count} Haltestelle(n) verfolgt:\n{list}',
    es: '{count} parada(s) seguida(s):\n{list}',
  },
  stopFromForm: {
    en: 'form, stop {slot}',
    fr: 'formulaire, arrêt {slot}',
    de: 'Formular, Haltestelle {slot}',
    es: 'formulario, parada {slot}',
  },
  stopUnknownMark: {
    en: 'unknown or ambiguous',
    fr: 'inconnu ou ambigu',
    de: 'unbekannt oder mehrdeutig',
    es: 'desconocido o ambiguo',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the Logs tab ({count} line(s) starting with "Wiener Linien diagnostic").',
    fr: 'Diagnostic écrit dans l’onglet Journaux ({count} ligne(s) commençant par « Wiener Linien diagnostic »).',
    de: 'Diagnose in den Tab Protokolle geschrieben ({count} Zeile(n), beginnend mit „Wiener Linien diagnostic“).',
    es: 'Diagnóstico escrito en la pestaña Registros ({count} línea(s) que empiezan por «Wiener Linien diagnostic»).',
  },
};

/**
 * @description Whether a value is a supported language.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, its placeholders filled.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The placeholder values.
 * @returns {string} The text.
 * @example
 * t('inMinutes', 'fr', { n: 3 }); // -> 'dans 3 min'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string} key - A TEXTS key.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description When a passage comes, in a sentence: "in 3 min", "at 10:32".
 * @param {object} passage - The passage.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {string} The words.
 */
function passageWhen(passage, { language, now, timeZone }) {
  const minutes = minutesLeft(passage, now);
  if (minutes >= 60) {
    return t('atTime', language, { time: formatTime(passage.at, timeZone) });
  }
  return minutes === 0
    ? t('approaching', language).toLowerCase()
    : t('inMinutes', language, { n: minutes });
}

/**
 * @description The short time of a passage, as on the screens of the stops:
 * "3 min", "10:32", "Approaching".
 * @param {object} passage - The passage.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {string} The time.
 */
function passageShort(passage, { language, now, timeZone }) {
  const minutes = minutesLeft(passage, now);
  if (minutes >= 60) {
    return formatTime(passage.at, timeZone);
  }
  return minutes === 0 ? t('approaching', language) : t('minutesValue', language, { n: minutes });
}

/**
 * @description One line for a passage: "U1 → Oberlaa · 3 min", "(timetable)"
 * when it is not followed live, "(+4 min)" when it runs late.
 * @param {object|null} passage - The passage, null when none.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {string} The text.
 */
function passageText(passage, options) {
  if (!passage) {
    return t('noPassage', options.language);
  }
  const head = passage.destination ? `${passage.line} → ${passage.destination}` : passage.line;
  let mark = '';
  if (!passage.realtime) {
    mark = ` ${t('scheduledMark', options.language)}`;
  } else if (passage.delay >= LATE_MINUTES) {
    mark = ` ${t('delayMark', options.language, { n: passage.delay })}`;
  }
  return `${head} · ${passageShort(passage, options)}${mark}`;
}

/**
 * @description The text key of a mode.
 * @param {{ mode: string }} line - The line.
 * @returns {string} metro, tram, train or bus.
 */
const modeKey = (line) => (['metro', 'tram', 'train'].includes(line.mode) ? line.mode : 'bus');

/**
 * @description How a line reads: "U1", "Tram 18", "Bus 13A".
 * @param {{ name: string, mode: string }} line - The line.
 * @param {string} language - The language.
 * @returns {string} The label.
 */
function lineLabel(line, language) {
  return t(`${modeKey(line)}LineLabel`, language, { line: line.name });
}

/**
 * @description The name of the device of a line: "Wiener Linien U1", "Wiener Linien tram 18".
 * @param {{ name: string, mode: string }} line - The line.
 * @param {string} language - The language.
 * @returns {string} The name.
 */
function lineDeviceName(line, language) {
  return t(`${modeKey(line)}DeviceName`, language, { line: line.name });
}

/**
 * @description The label of a state of a line.
 * @param {string} state - unknown, normal, info, disrupted, major.
 * @param {string} language - The language.
 * @returns {string} The label.
 */
const lineStateText = (state, language) => t(`state_${state}`, language);

/**
 * @description The label of a kind of message.
 * @param {string} channel - disruption, notice, elevator.
 * @param {string} language - The language.
 * @returns {string} The label.
 */
const kindText = (channel, language) => t(`kind_${channel}`, language);

export {
  BRAND,
  LATE_MINUTES,
  LANGUAGES,
  TEXTS,
  isLanguage,
  t,
  all,
  passageWhen,
  passageShort,
  passageText,
  lineLabel,
  lineDeviceName,
  lineStateText,
  kindText,
};
