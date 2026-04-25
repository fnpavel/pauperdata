import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const matchupRoot = path.join(projectRoot, 'data', 'matchups');
const matchupManifestPath = path.join(matchupRoot, 'manifest.json');
const outputDir = path.join(projectRoot, 'data', 'elo-data');

const MATCH_FIELDS = [
  'event_id',
  'event',
  'date',
  'event_type',
  'round',
  'pair_key',
  'player_a',
  'player_a_key',
  'deck_a',
  'player_b',
  'player_b_key',
  'deck_b',
  'outcome',
  'result_type',
  'is_bye',
  'pairing_quality',
  'games_a',
  'games_b'
];

function getYearFromDate(dateValue = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '').trim())
    ? String(dateValue).slice(0, 4)
    : '';
}

function sortDates(values = []) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function pickMatchFields(match = {}) {
  return MATCH_FIELDS.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(match, key)) {
      result[key] = match[key];
    }

    return result;
  }, {});
}

function buildModuleText(constName, value) {
  return `export const ${constName} = ${JSON.stringify(value, null, 2)};\n`;
}

function normalizeText(text = '') {
  return String(text).replace(/\r\n/g, '\n');
}

function parseExportedConstJson(text = '', constName = '') {
  const normalizedText = normalizeText(text);
  const prefix = `export const ${constName} = `;
  if (!normalizedText.startsWith(prefix)) {
    return null;
  }

  let payloadText = normalizedText.slice(prefix.length).trim();
  if (payloadText.endsWith(';')) {
    payloadText = payloadText.slice(0, -1);
  }

  try {
    return JSON.parse(payloadText);
  } catch (error) {
    return null;
  }
}

function buildArrayBodyText(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  const arrayText = JSON.stringify(items, null, 2);
  return arrayText.slice(2, -2);
}

function isPrefixArray(existingItems = [], nextItems = []) {
  if (!Array.isArray(existingItems) || !Array.isArray(nextItems)) {
    return false;
  }

  if (existingItems.length === 0 || existingItems.length >= nextItems.length) {
    return false;
  }

  return JSON.stringify(existingItems) === JSON.stringify(nextItems.slice(0, existingItems.length));
}

async function writeTextFileIfChanged(filePath, nextText) {
  try {
    const existingText = await fs.readFile(filePath, 'utf8');
    if (normalizeText(existingText) === nextText) {
      return false;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(filePath, nextText, 'utf8');
  return true;
}

async function writeEloYearModule(filePath, yearMatches = []) {
  const moduleText = buildModuleText('eloMatches', yearMatches);

  try {
    const existingText = await fs.readFile(filePath, 'utf8');
    const normalizedExistingText = normalizeText(existingText);
    if (normalizedExistingText === moduleText) {
      return false;
    }

    const existingMatches = parseExportedConstJson(normalizedExistingText, 'eloMatches');
    if (
      isPrefixArray(existingMatches, yearMatches)
      && normalizedExistingText.endsWith('\n];\n')
    ) {
      const appendedMatches = yearMatches.slice(existingMatches.length);
      const appendedBodyText = buildArrayBodyText(appendedMatches);
      if (appendedBodyText) {
        const appendedModuleText = `${normalizedExistingText.slice(0, -4)},\n${appendedBodyText}\n];\n`;
        await fs.writeFile(filePath, appendedModuleText, 'utf8');
        return true;
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(filePath, moduleText, 'utf8');
  return true;
}

async function main() {
  const sourceManifestText = await fs.readFile(matchupManifestPath, 'utf8');
  const sourceManifest = JSON.parse(sourceManifestText);
  const matchupYears = Array.isArray(sourceManifest.years) ? sourceManifest.years : [];
  const matchFileMap = sourceManifest.match_files_by_year || {};
  const matchGroups = await Promise.all(
    matchupYears.map(async year => {
      const relativePath = String(matchFileMap[year] || '').trim();
      if (!relativePath) {
        return [];
      }

      const rawText = await fs.readFile(path.join(matchupRoot, relativePath), 'utf8');
      const rows = JSON.parse(rawText);
      return Array.isArray(rows) ? rows : [];
    })
  );
  const matches = matchGroups.flat();
  const minimalMatches = matches.map(pickMatchFields);
  const matchesByYear = new Map();
  const datesByEventType = new Map();

  minimalMatches.forEach(match => {
    const year = getYearFromDate(match.date) || 'unknown';
    if (!matchesByYear.has(year)) {
      matchesByYear.set(year, []);
    }
    matchesByYear.get(year).push(match);

    const eventType = String(match.event_type || '').trim().toLowerCase() || 'unknown';
    if (!datesByEventType.has(eventType)) {
      datesByEventType.set(eventType, []);
    }
    datesByEventType.get(eventType).push(String(match.date || '').trim());
  });

  const sortedYears = [...matchesByYear.keys()]
    .filter(year => year !== 'unknown')
    .sort((a, b) => a.localeCompare(b));

  await fs.mkdir(outputDir, { recursive: true });
  const desiredNames = new Set(['manifest.js', ...sortedYears.map(year => `${year}.js`)]);
  const existingOutputFiles = await fs.readdir(outputDir, { withFileTypes: true });
  await Promise.all(existingOutputFiles.map(async entry => {
    if (!entry.isFile()) {
      return;
    }

    if (/^(\d{4}|manifest)\.js$/i.test(entry.name) && !desiredNames.has(entry.name)) {
      await fs.unlink(path.join(outputDir, entry.name));
    }
  }));

  for (const year of sortedYears) {
    const yearMatches = matchesByYear.get(year) || [];
    await writeEloYearModule(path.join(outputDir, `${year}.js`), yearMatches);
  }

  const availableDatesByEventType = Object.fromEntries(
    [...datesByEventType.entries()]
      .map(([eventType, dates]) => [eventType, sortDates(dates)])
  );

  const manifest = {
    generatedAt: sourceManifest.generated_at || '',
    lastUpdatedDate: sourceManifest.last_updated_date || '',
    totalMatchCount: minimalMatches.length,
    years: sortedYears,
    filesByYear: Object.fromEntries(sortedYears.map(year => [year, `./${year}.js`])),
    matchCountsByYear: Object.fromEntries(sortedYears.map(year => [year, (matchesByYear.get(year) || []).length])),
    availableDatesByEventType
  };

  const manifestModuleText = buildModuleText('eloManifest', manifest);
  await writeTextFileIfChanged(path.join(outputDir, 'manifest.js'), manifestModuleText);

  console.log(`Built Elo data modules in ${path.relative(projectRoot, outputDir)}`);
  console.log(`Years: ${sortedYears.join(', ')}`);
  console.log(`Matches: ${minimalMatches.length}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
