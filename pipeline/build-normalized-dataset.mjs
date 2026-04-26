import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'data', 'events');
const sourceManifestPath = path.join(sourceRoot, 'manifest.json');
const outputDir = path.join(projectRoot, 'data');

const REQUIRED_RESULT_FIELDS = ['Date', 'EventType', 'Event', 'Rank', 'Player', 'Deck', 'Wins', 'Losses'];

const CANONICAL_EVENT_METADATA = new Map([
  [
    'MTGO Challenge',
    { displayName: 'Challenge', series: 'Challenge', sourceSystem: 'mtgo' }
  ],
  [
    'MTGO Challenge 64',
    { displayName: 'Challenge 64', series: 'Challenge', sourceSystem: 'mtgo' }
  ],
  [
    'MTGO Qualifier',
    { displayName: 'Qualifier', series: 'Qualifier', sourceSystem: 'mtgo' }
  ],
  [
    'MTGO Showcase',
    { displayName: 'Showcase', series: 'Showcase', sourceSystem: 'mtgo' }
  ],
  [
    'MTGO Super',
    { displayName: 'Super', series: 'Super', sourceSystem: 'mtgo' }
  ],
  [
    'Paupergeddon Pisa',
    { displayName: 'Paupergeddon Pisa', series: 'Paupergeddon Pisa', sourceSystem: 'paupergeddon' }
  ],
  [
    'Upstate NY Pauper Open',
    { displayName: 'Upstate NY Pauper Open', series: 'Upstate NY Pauper Open', sourceSystem: 'upstate_ny' }
  ]
]);

const WORD_EXCEPTIONS = new Map([
  ['mtgo', 'MTGO'],
  ['ny', 'NY']
]);

function readSourceDataset() {
  const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  const years = Array.isArray(manifest?.years) ? manifest.years : [];
  const cleanedData = years.flatMap(year => {
    const relativePath = String(manifest?.event_files_by_year?.[year] || '').trim();
    if (!relativePath) {
      return [];
    }

    const filePath = path.join(sourceRoot, relativePath);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  });

  return {
    generatedFrom: path.relative(projectRoot, sourceManifestPath).replace(/\\/g, '/'),
    lastUpdatedDate: String(manifest?.last_updated_date || ''),
    cleanedData
  };
}

function normalizeWhitespace(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function titleCaseWord(word) {
  const lowerWord = word.toLowerCase();
  if (WORD_EXCEPTIONS.has(lowerWord)) {
    return WORD_EXCEPTIONS.get(lowerWord);
  }

  if (/^\d+$/.test(word)) {
    return word;
  }

  return `${lowerWord.charAt(0).toUpperCase()}${lowerWord.slice(1)}`;
}

function toDisplayTitleCase(value) {
  return normalizeWhitespace(value)
    .split(' ')
    .map(segment => titleCaseWord(segment))
    .join(' ');
}

function stripDateSuffix(eventName) {
  return normalizeWhitespace(eventName).replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '');
}

function normalizeBaseEventName(eventName) {
  return toDisplayTitleCase(stripDateSuffix(eventName));
}

function formatDisplayEventName(eventName) {
  return toDisplayTitleCase(normalizeBaseEventName(eventName).replace(/^MTGO\s+/i, ''));
}

function inferSourceSystem(normalizedBaseName, eventType) {
  if (normalizedBaseName.startsWith('MTGO ')) {
    return 'mtgo';
  }

  if (normalizedBaseName === 'Paupergeddon Pisa') {
    return 'paupergeddon';
  }

  if (normalizedBaseName === 'Upstate NY Pauper Open') {
    return 'upstate_ny';
  }

  return eventType === 'offline' ? 'paper' : 'unknown';
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateSourceRow(row, index) {
  const missingFields = REQUIRED_RESULT_FIELDS.filter(field => {
    return row[field] === undefined || row[field] === null || row[field] === '';
  });

  if (missingFields.length > 0) {
    throw new Error(`Row ${index + 1} is missing required fields: ${missingFields.join(', ')}`);
  }

  if (!['online', 'offline'].includes(String(row.EventType).toLowerCase())) {
    throw new Error(`Row ${index + 1} has unsupported EventType: ${row.EventType}`);
  }

  const expectedWinRate =
    Number(row.Wins) + Number(row.Losses) > 0 ? Number(row.Wins) / (Number(row.Wins) + Number(row.Losses)) : 0;
  const actualWinRate = Number(row['Win Rate']);

  if (Number.isFinite(actualWinRate) && Math.abs(actualWinRate - expectedWinRate) > 0.000001) {
    throw new Error(`Row ${index + 1} has an inconsistent Win Rate for event ${row.Event}`);
  }
}

function getCanonicalEventMetadata(rawEventName, eventType, date) {
  const rawBaseName = stripDateSuffix(rawEventName);
  const canonicalBaseName = normalizeBaseEventName(rawEventName);
  const knownMetadata = CANONICAL_EVENT_METADATA.get(canonicalBaseName);

  const metadata = knownMetadata || {
    displayName: formatDisplayEventName(rawEventName),
    series: formatDisplayEventName(rawEventName),
    sourceSystem: inferSourceSystem(canonicalBaseName, eventType)
  };

  const displayName = metadata.displayName;

  return {
    rawBaseName,
    canonicalBaseName,
    displayName,
    series: metadata.series,
    sourceSystem: metadata.sourceSystem,
    eventId: `${eventType}-${slugify(displayName)}-${date}`
  };
}

function writePrettyJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const { generatedFrom, lastUpdatedDate, cleanedData } = readSourceDataset();

  const eventAggregates = new Map();
  const eventNameAliases = new Map();

  cleanedData.forEach((row, index) => {
    validateSourceRow(row, index);

    const eventType = String(row.EventType).toLowerCase();
    const metadata = getCanonicalEventMetadata(row.Event, eventType, row.Date);
    const eventKey = `${eventType}|||${row.Date}|||${row.Event}`;
    const currentEvent = eventAggregates.get(eventKey);

    if (!currentEvent) {
      eventAggregates.set(eventKey, {
        event_id: metadata.eventId,
        source_event_name: row.Event,
        display_name: metadata.displayName,
        series: metadata.series,
        source_system: metadata.sourceSystem,
        event_type: eventType,
        date: row.Date,
        year: Number(row.Date.slice(0, 4)),
        month: Number(row.Date.slice(5, 7)),
        total_players: 1
      });
    } else {
      currentEvent.total_players += 1;
    }

    if (metadata.rawBaseName !== metadata.canonicalBaseName) {
      eventNameAliases.set(metadata.rawBaseName, {
        raw_name: metadata.rawBaseName,
        canonical_name: metadata.canonicalBaseName,
        display_name: metadata.displayName,
        series: metadata.series,
        source_system: metadata.sourceSystem
      });
    }
  });

  const events = Array.from(eventAggregates.values()).sort((a, b) => {
    return b.date.localeCompare(a.date) || a.display_name.localeCompare(b.display_name);
  });
  const latestEvent = events[0] || null;

  const eventIdBySourceKey = new Map(
    events.map(event => [`${event.event_type}|||${event.date}|||${event.source_event_name}`, event.event_id])
  );

  const results = cleanedData
    .map(row => {
      const eventType = String(row.EventType).toLowerCase();
      const eventId = eventIdBySourceKey.get(`${eventType}|||${row.Date}|||${row.Event}`);

      if (!eventId) {
        throw new Error(`Could not resolve event_id for row: ${row.Event} / ${row.Date}`);
      }

      return {
        event_id: eventId,
        player: normalizeWhitespace(row.Player),
        deck: normalizeWhitespace(row.Deck),
        rank: Number(row.Rank),
        wins: Number(row.Wins),
        losses: Number(row.Losses)
      };
    })
    .sort((a, b) => a.event_id.localeCompare(b.event_id) || a.rank - b.rank || a.player.localeCompare(b.player));

  const aliases = {
    generated_from: generatedFrom,
    last_updated_date: lastUpdatedDate,
    last_updated_event_type: latestEvent?.display_name || '',
    last_updated_event_date: latestEvent?.date || '',
    event_name_aliases: Array.from(eventNameAliases.values()).sort((a, b) => {
      return a.canonical_name.localeCompare(b.canonical_name) || a.raw_name.localeCompare(b.raw_name);
    }),
    player_aliases: [],
    deck_aliases: []
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writePrettyJson(path.join(outputDir, 'events.json'), events);
  writePrettyJson(path.join(outputDir, 'results.json'), results);
  writePrettyJson(path.join(outputDir, 'aliases.json'), aliases);

  console.log(`Normalized dataset written to ${path.relative(projectRoot, outputDir)}`);
  console.log(`- lastUpdatedDate: ${lastUpdatedDate}`);
  console.log(`- events: ${events.length}`);
  console.log(`- results: ${results.length}`);
  console.log(`- event aliases: ${aliases.event_name_aliases.length}`);
}

main();

