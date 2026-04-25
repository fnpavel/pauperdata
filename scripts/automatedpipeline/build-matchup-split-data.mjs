import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const legacyInputPath = path.join(projectRoot, 'data', 'matchups.json');
const outputRoot = path.join(projectRoot, 'data', 'matchups');

function getYearFromDate(dateValue = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '').trim())
    ? String(dateValue).slice(0, 4)
    : 'unknown';
}

function groupRowsByYear(rows = []) {
  return rows.reduce((groups, row) => {
    const year = getYearFromDate(row?.date || row?.Date);
    if (!groups.has(year)) {
      groups.set(year, []);
    }

    groups.get(year).push(row);
    return groups;
  }, new Map());
}

function sortYears(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function normalizeText(text = '') {
  return String(text).replace(/\r\n/g, '\n');
}

async function removeStaleSplitFiles(rootPath, desiredNames) {
  await fs.mkdir(rootPath, { recursive: true });
  const entries = await fs.readdir(rootPath, { withFileTypes: true });

  await Promise.all(entries.map(async entry => {
    if (!entry.isFile()) {
      return;
    }

    if (
      /^(manifest|events|matches-\d{4}|rounds-\d{4}|matches-unknown|rounds-unknown)\.json$/i.test(entry.name)
      && !desiredNames.has(entry.name)
    ) {
      await fs.unlink(path.join(rootPath, entry.name));
    }
  }));
}

async function writeJsonFileIfChanged(filePath, payload) {
  const nextText = `${JSON.stringify(payload)}\n`;

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

async function loadSourcePayload() {
  try {
    const rawText = await fs.readFile(legacyInputPath, 'utf8');
    return JSON.parse(rawText);
  } catch (error) {
    const manifestPath = path.join(outputRoot, 'manifest.json');
    const manifestText = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    const eventsText = await fs.readFile(path.join(outputRoot, String(manifest.events_file || 'events.json')), 'utf8');
    const years = Array.isArray(manifest.years) ? manifest.years : [];
    const rounds = [];
    const matches = [];

    for (const year of years) {
      const roundFile = String((manifest.round_files_by_year || {})[year] || '').trim();
      const matchFile = String((manifest.match_files_by_year || {})[year] || '').trim();

      if (roundFile) {
        rounds.push(...JSON.parse(await fs.readFile(path.join(outputRoot, roundFile), 'utf8')));
      }

      if (matchFile) {
        matches.push(...JSON.parse(await fs.readFile(path.join(outputRoot, matchFile), 'utf8')));
      }
    }

    return {
      generated_at: manifest.generated_at || '',
      generated_from: manifest.generated_from || 'scripts/automatedpipeline/build-matchup-split-data.mjs',
      last_updated_date: manifest.last_updated_date || '',
      events: JSON.parse(eventsText),
      rounds,
      matches
    };
  }
}

async function main() {
  const payload = await loadSourcePayload();
  const events = Array.isArray(payload.events) ? payload.events : [];
  const rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const roundsByYear = groupRowsByYear(rounds);
  const matchesByYear = groupRowsByYear(matches);
  const years = sortYears([
    ...roundsByYear.keys(),
    ...matchesByYear.keys()
  ]);

  const desiredNames = new Set(['events.json', 'manifest.json']);
  years.forEach(year => {
    desiredNames.add(`rounds-${year}.json`);
    desiredNames.add(`matches-${year}.json`);
  });

  await removeStaleSplitFiles(outputRoot, desiredNames);
  await writeJsonFileIfChanged(path.join(outputRoot, 'events.json'), events);

  const manifest = {
    generated_at: payload.generated_at || '',
    generated_from: payload.generated_from || 'scripts/automatedpipeline/build-matchup-split-data.mjs',
    last_updated_date: payload.last_updated_date || '',
    event_count: events.length,
    round_count: rounds.length,
    match_count: matches.length,
    years,
    events_file: 'events.json',
    round_files_by_year: Object.fromEntries(years.map(year => [year, `rounds-${year}.json`])),
    match_files_by_year: Object.fromEntries(years.map(year => [year, `matches-${year}.json`])),
    round_counts_by_year: Object.fromEntries(years.map(year => [year, (roundsByYear.get(year) || []).length])),
    match_counts_by_year: Object.fromEntries(years.map(year => [year, (matchesByYear.get(year) || []).length]))
  };

  await Promise.all(years.flatMap(year => ([
    writeJsonFileIfChanged(path.join(outputRoot, `rounds-${year}.json`), roundsByYear.get(year) || []),
    writeJsonFileIfChanged(path.join(outputRoot, `matches-${year}.json`), matchesByYear.get(year) || [])
  ])));
  await writeJsonFileIfChanged(path.join(outputRoot, 'manifest.json'), manifest);

  console.log(`Built split matchup data in ${path.relative(projectRoot, outputRoot)}`);
  console.log(`Years: ${years.join(', ')}`);
  console.log(`Events: ${events.length}`);
  console.log(`Rounds: ${rounds.length}`);
  console.log(`Matches: ${matches.length}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
