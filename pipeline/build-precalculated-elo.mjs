import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MATCHUP_ROOT = path.join(PROJECT_ROOT, 'data', 'matchups');
const MATCHUP_MANIFEST_PATH = path.join(MATCHUP_ROOT, 'manifest.json');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'data', 'precalculated-elo');
const PLAYER_SEASONAL_DIR = path.join(OUTPUT_ROOT, 'player', 'seasonal');
const PLAYER_MULTI_YEAR_DIR = path.join(OUTPUT_ROOT, 'player', 'multi-year');
const PLAYER_ON_DECK_SEASONAL_DIR = path.join(OUTPUT_ROOT, 'player-on-deck', 'seasonal');
const PLAYER_ON_DECK_MULTI_YEAR_DIR = path.join(OUTPUT_ROOT, 'player-on-deck', 'multi-year');
const STATE_DIR = path.join(OUTPUT_ROOT, 'state');
const MANIFEST_PATH = path.join(OUTPUT_ROOT, 'manifest.json');
const META_PATH = path.join(OUTPUT_ROOT, 'meta.json');
const OVERALL_STATE_PATH = path.join(STATE_DIR, 'ratings-overall.json');
const DECK_STATE_PATH = path.join(STATE_DIR, 'ratings-by-deck.json');

const STARTING_RATING = 1500;
const K_FACTOR = 16;
const UNKNOWN_EVENT_ID = '__unknown_event__';
const UNKNOWN_DATE = '';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeEntityMode(value) {
  return String(value || 'player').trim().toLowerCase() === 'player_on_deck'
    ? 'player_on_deck'
    : 'player';
}

function isPlayerOnDeckMode(entityMode) {
  return normalizeEntityMode(entityMode) === 'player_on_deck';
}

function getMatchDate(match) {
  return normalizeText(match?.date || match?.Date);
}

function getMatchYear(match) {
  const date = getMatchDate(match);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(0, 4)) : null;
}

function getRoundValue(match) {
  const roundValue = Number(match?.round);
  return Number.isFinite(roundValue) ? roundValue : Number.POSITIVE_INFINITY;
}

function getSortValue(match, keys) {
  for (const key of keys) {
    const value = normalizeText(match?.[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function compareMatches(a, b) {
  return (
    getMatchDate(a.match).localeCompare(getMatchDate(b.match)) ||
    getSortValue(a.match, ['event_id', 'eventId', 'event']).localeCompare(getSortValue(b.match, ['event_id', 'eventId', 'event'])) ||
    getRoundValue(a.match) - getRoundValue(b.match) ||
    getSortValue(a.match, ['pair_key', 'pairKey']).localeCompare(getSortValue(b.match, ['pair_key', 'pairKey'])) ||
    a.index - b.index
  );
}

function getResultScore(match) {
  const outcome = normalizeText(match?.outcome).toLowerCase();
  if (outcome === 'player_a_win') {
    return 1;
  }
  if (outcome === 'player_b_win') {
    return 0;
  }
  if (outcome === 'draw') {
    return 0.5;
  }

  const resultType = normalizeText(match?.result_type).toLowerCase();
  if (resultType === 'win') {
    return 1;
  }
  if (resultType === 'loss') {
    return 0;
  }
  if (resultType === 'draw') {
    return 0.5;
  }

  const gamesA = Number(match?.games_a);
  const gamesB = Number(match?.games_b);
  if (Number.isFinite(gamesA) && Number.isFinite(gamesB)) {
    if (gamesA > gamesB) {
      return 1;
    }
    if (gamesA < gamesB) {
      return 0;
    }
    return 0.5;
  }

  return null;
}

function getEntityDetails(match, side, entityMode) {
  const normalizedSide = side === 'b' ? 'b' : 'a';
  const playerKey = normalizeText(
    normalizedSide === 'a'
      ? match?.player_a_key || match?.player_key
      : match?.player_b_key || match?.opponent_key
  );
  const playerName = normalizeText(
    normalizedSide === 'a'
      ? match?.player_a || match?.player
      : match?.player_b || match?.opponent
  );
  const deck = normalizeText(
    normalizedSide === 'a'
      ? match?.deck_a || match?.deck
      : match?.deck_b || match?.opponent_deck
  );

  if (isPlayerOnDeckMode(entityMode)) {
    return {
      entityKey: playerKey && deck ? `${playerKey}:::${deck}` : '',
      playerKey,
      playerName: playerName || playerKey,
      deck,
      displayName: deck ? `${playerName || playerKey} (${deck})` : (playerName || playerKey)
    };
  }

  return {
    entityKey: playerKey,
    playerKey,
    playerName: playerName || playerKey,
    deck,
    displayName: playerName || playerKey
  };
}

function isRatedMatch(match, entityMode) {
  const playerA = getEntityDetails(match, 'a', entityMode);
  const playerB = getEntityDetails(match, 'b', entityMode);
  const resultType = normalizeText(match?.result_type).toLowerCase();
  const outcome = normalizeText(match?.outcome).toLowerCase();
  const pairingQuality = normalizeText(match?.pairing_quality).toLowerCase();

  if (!playerA.entityKey || !playerB.entityKey || playerA.entityKey === playerB.entityKey) {
    return false;
  }

  if (match?.is_bye || resultType === 'bye' || resultType === 'unknown' || outcome === 'unknown') {
    return false;
  }

  if (pairingQuality === 'conflict') {
    return false;
  }

  if (isPlayerOnDeckMode(entityMode) && (!playerA.deck || !playerB.deck)) {
    return false;
  }

  return getResultScore(match) !== null;
}

function calculateEloDelta(ratingA, ratingB, scoreA) {
  const expectedScoreA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return K_FACTOR * (scoreA - expectedScoreA);
}

function ensureSeasonState(seasonStates, seasonKey, seasonYear, entityDetails) {
  const stateKey = `${seasonKey}:::${entityDetails.entityKey}`;
  if (!seasonStates.has(stateKey)) {
    seasonStates.set(stateKey, {
      seasonKey,
      seasonYear,
      playerKey: entityDetails.entityKey,
      displayName: entityDetails.displayName || entityDetails.entityKey,
      basePlayerKey: entityDetails.playerKey,
      basePlayerName: entityDetails.playerName || entityDetails.displayName || entityDetails.entityKey,
      deck: entityDetails.deck,
      rating: STARTING_RATING,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      lastActiveDate: '',
      eloGain: 0,
      eventKeys: new Set()
    });
  }

  const state = seasonStates.get(stateKey);
  if (entityDetails.displayName) {
    state.displayName = entityDetails.displayName;
  }
  if (entityDetails.playerKey) {
    state.basePlayerKey = entityDetails.playerKey;
  }
  if (entityDetails.playerName) {
    state.basePlayerName = entityDetails.playerName;
  }
  if (entityDetails.deck) {
    state.deck = entityDetails.deck;
  }
  return state;
}

function getResultTypeFromScore(score) {
  if (score === 1) {
    return 'win';
  }
  if (score === 0) {
    return 'loss';
  }
  if (score === 0.5) {
    return 'draw';
  }
  return 'unknown';
}

function buildBatches(matches, seasonKeyGetter, entityMode) {
  const sortedMatches = matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => isRatedMatch(match, entityMode))
    .sort(compareMatches)
    .map(({ match }) => ({
      match,
      seasonKey: seasonKeyGetter(match),
      seasonYear: getMatchYear(match)
    }));

  const batches = [];
  let currentBatch = null;

  for (const entry of sortedMatches) {
    const batchKey = [
      entry.seasonKey,
      getMatchDate(entry.match),
      getSortValue(entry.match, ['event_id', 'eventId', 'event']),
      String(getRoundValue(entry.match))
    ].join('|||');

    if (!currentBatch || currentBatch.batchKey !== batchKey) {
      currentBatch = {
        batchKey,
        seasonKey: entry.seasonKey,
        seasonYear: entry.seasonYear,
        matches: []
      };
      batches.push(currentBatch);
    }

    currentBatch.matches.push(entry.match);
  }

  return {
    batches,
    ratedMatchCount: sortedMatches.length
  };
}

function processWindow(matches, { entityMode, seasonKeyGetter, seasonYearGetter = null }) {
  const seasonStates = new Map();
  const { batches, ratedMatchCount } = buildBatches(matches, seasonKeyGetter, entityMode);

  for (const batch of batches) {
    const pendingUpdates = batch.matches.map(match => {
      const playerA = getEntityDetails(match, 'a', entityMode);
      const playerB = getEntityDetails(match, 'b', entityMode);
      const seasonYear = typeof seasonYearGetter === 'function'
        ? seasonYearGetter(batch)
        : batch.seasonYear;
      const stateA = ensureSeasonState(seasonStates, batch.seasonKey, seasonYear, playerA);
      const stateB = ensureSeasonState(seasonStates, batch.seasonKey, seasonYear, playerB);
      const ratingABefore = stateA.rating;
      const ratingBBefore = stateB.rating;
      const scoreA = getResultScore(match);
      const deltaA = calculateEloDelta(ratingABefore, ratingBBefore, scoreA);

      return {
        match,
        stateA,
        stateB,
        ratingAAfter: ratingABefore + deltaA,
        ratingBAfter: ratingBBefore - deltaA,
        scoreA,
        scoreB: 1 - scoreA
      };
    });

    for (const update of pendingUpdates) {
      const matchDate = getMatchDate(update.match);
      const eventId = getSortValue(update.match, ['event_id', 'eventId', 'event']) || UNKNOWN_EVENT_ID;
      const eventKey = `${matchDate || UNKNOWN_DATE}|||${eventId}`;
      update.stateA.rating = update.ratingAAfter;
      update.stateB.rating = update.ratingBAfter;
      update.stateA.matches += 1;
      update.stateB.matches += 1;
      update.stateA.lastActiveDate = matchDate;
      update.stateB.lastActiveDate = matchDate;
      update.stateA.eloGain = update.stateA.rating - STARTING_RATING;
      update.stateB.eloGain = update.stateB.rating - STARTING_RATING;
      update.stateA.eventKeys.add(eventKey);
      update.stateB.eventKeys.add(eventKey);

      const resultTypeA = getResultTypeFromScore(update.scoreA);
      const resultTypeB = getResultTypeFromScore(update.scoreB);

      if (resultTypeA === 'win') {
        update.stateA.wins += 1;
      } else if (resultTypeA === 'loss') {
        update.stateA.losses += 1;
      } else {
        update.stateA.draws += 1;
      }

      if (resultTypeB === 'win') {
        update.stateB.wins += 1;
      } else if (resultTypeB === 'loss') {
        update.stateB.losses += 1;
      } else {
        update.stateB.draws += 1;
      }
    }
  }

  const rows = Array.from(seasonStates.values())
    .filter(row => row.matches > 0)
    .map(row => ({
      seasonKey: row.seasonKey,
      seasonYear: row.seasonYear,
      playerKey: row.playerKey,
      displayName: row.displayName,
      basePlayerKey: row.basePlayerKey,
      basePlayerName: row.basePlayerName,
      deck: isPlayerOnDeckMode(entityMode) ? (row.deck || '') : '',
      rating: roundRating(row.rating),
      matches: row.matches,
      wins: row.wins,
      losses: row.losses,
      winRate: row.matches > 0 ? roundRatio(row.wins / row.matches) : 0,
      lastActiveDate: row.lastActiveDate,
      eloGain: roundRating(row.eloGain),
      eventCount: row.eventKeys.size
    }))
    .sort(compareRows);

  return {
    rows,
    ratedMatchCount
  };
}

function flattenResetRows(yearRowsList) {
  return yearRowsList
    .flatMap(rows => Array.isArray(rows) ? rows : [])
    .sort(compareRows);
}

function compareRows(a, b) {
  return (
    b.rating - a.rating ||
    b.matches - a.matches ||
    b.wins - a.wins ||
    a.displayName.localeCompare(b.displayName) ||
    a.playerKey.localeCompare(b.playerKey)
  );
}

function roundRating(value) {
  return Number(value.toFixed(3));
}

function roundRatio(value) {
  return Number(value.toFixed(6));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue;
    }
    throw error;
  }
}

function writePrettyJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonIfChanged(filePath, value) {
  const nextText = `${JSON.stringify(value, null, 2)}\n`;
  let currentText = null;
  try {
    currentText = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (currentText === nextText) {
    return false;
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, nextText, 'utf8');
  return true;
}

function pruneOutputDirectory(dirPath, keepFileNames) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (!keepFileNames.has(entry.name)) {
      fs.unlinkSync(path.join(dirPath, entry.name));
    }
  }
}

function loadMatchDataset() {
  const manifest = JSON.parse(fs.readFileSync(MATCHUP_MANIFEST_PATH, 'utf8'));
  const years = Array.isArray(manifest?.years) ? [...manifest.years].sort((a, b) => a.localeCompare(b)) : [];
  const fileMap = manifest?.match_files_by_year || {};
  const matches = [];

  for (const year of years) {
    const relativePath = normalizeText(fileMap[year]);
    if (!relativePath) {
      continue;
    }

    const filePath = path.join(MATCHUP_ROOT, relativePath);
    const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(rows)) {
      matches.push(...rows);
    }
  }

  return {
    sourceManifest: manifest,
    buildStamp: normalizeText(manifest?.last_updated_at || manifest?.generated_at || manifest?.last_updated_date),
    matches: matches
      .map((match, index) => ({ match, index }))
      .sort(compareMatches)
      .map(entry => entry.match)
  };
}

function buildEventSequence(matches) {
  const ordered = [];
  const seen = new Set();

  for (const match of matches) {
    const eventId = getSortValue(match, ['event_id', 'eventId']) || UNKNOWN_EVENT_ID;
    const eventDate = getMatchDate(match) || UNKNOWN_DATE;
    const key = `${eventDate}|||${eventId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push({
      key,
      eventId,
      date: eventDate
    });
  }

  return ordered;
}

function buildYearSet(matches) {
  const years = new Set();
  for (const match of matches) {
    const year = getMatchYear(match);
    if (Number.isInteger(year)) {
      years.add(year);
    }
  }
  return [...years].sort((a, b) => a - b);
}

function buildRangeDescriptors(years) {
  const ranges = [];

  for (let startIndex = 0; startIndex < years.length; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < years.length; endIndex += 1) {
      const startYear = years[startIndex];
      const endYear = years[endIndex];
      ranges.push({
        startYear,
        endYear,
        key: `${startYear}-${endYear}`
      });
    }
  }

  return ranges;
}

function filterMatchesForYear(matches, year) {
  return matches.filter(match => getMatchYear(match) === year);
}

function filterMatchesForRange(matches, startYear, endYear) {
  return matches.filter(match => {
    const year = getMatchYear(match);
    return Number.isInteger(year) && year >= startYear && year <= endYear;
  });
}

function buildSeasonalPayload(scope, year, rows, ratedMatchCount, selectedMatchCount, buildStamp) {
  return {
    scope,
    window: {
      type: 'seasonal',
      year
    },
    generatedAt: buildStamp,
    matchCount: ratedMatchCount,
    selectedMatchCount,
    rows: rows.map(row => ({
      ...row,
      seasonKey: row.seasonKey || String(year),
      seasonYear: row.seasonYear || String(year)
    }))
  };
}

function buildMultiYearPayload(scope, startYear, endYear, mode, rows, ratedMatchCount, selectedMatchCount, buildStamp) {
  return {
    scope,
    window: {
      type: 'multi-year',
      startYear,
      endYear,
      mode
    },
    generatedAt: buildStamp,
    matchCount: ratedMatchCount,
    selectedMatchCount,
    rows: rows.map(row => ({
      ...row,
      seasonKey: row.seasonKey || (mode === 'continuous' ? `${startYear}-${endYear}` : String(row.seasonYear || '')),
      seasonYear: row.seasonYear || (mode === 'continuous' ? 'All-time' : '')
    }))
  };
}

function buildPrecalculatedManifest(sourceManifest, buildStamp, years, ranges) {
  const seasonalByYear = Object.fromEntries(
    years.map(year => [String(year), `player/seasonal/${year}.json`])
  );
  const playerOnDeckSeasonalByYear = Object.fromEntries(
    years.map(year => [String(year), `player-on-deck/seasonal/${year}.json`])
  );
  const multiYearByRange = Object.fromEntries(
    ranges.map(range => [range.key, {
      continuous: `player/multi-year/${range.key}_continuous.json`,
      reset: `player/multi-year/${range.key}_reset.json`
    }])
  );
  const playerOnDeckMultiYearByRange = Object.fromEntries(
    ranges.map(range => [range.key, {
      continuous: `player-on-deck/multi-year/${range.key}_continuous.json`,
      reset: `player-on-deck/multi-year/${range.key}_reset.json`
    }])
  );

  return {
    generatedAt: buildStamp,
    sourceGeneratedAt: normalizeText(sourceManifest?.generated_at || sourceManifest?.last_updated_at || sourceManifest?.last_updated_date),
    sourceMatchCount: Number(sourceManifest?.match_count) || 0,
    years: years.map(year => String(year)),
    available_dates_by_event_type: sourceManifest?.available_dates_by_event_type || {},
    scopes: {
      player: {
        seasonal_by_year: seasonalByYear,
        multi_year_by_range: multiYearByRange
      },
      'player-on-deck': {
        seasonal_by_year: playerOnDeckSeasonalByYear,
        multi_year_by_range: playerOnDeckMultiYearByRange
      }
    }
  };
}

function toSortedStateObject(stateMap) {
  const entries = [...stateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(entries.map(([key, value]) => [key, value]));
}

function createEmptyState() {
  return {
    entities: {}
  };
}

function cloneStateMapFromFile(fileState) {
  const entities = fileState && typeof fileState === 'object' && fileState.entities && typeof fileState.entities === 'object'
    ? fileState.entities
    : {};
  return new Map(
    Object.keys(entities)
      .sort((a, b) => a.localeCompare(b))
      .map(key => [key, { ...entities[key] }])
  );
}

function ensureRollingStateEntry(stateMap, entityDetails) {
  if (!stateMap.has(entityDetails.entityKey)) {
    stateMap.set(entityDetails.entityKey, {
      playerKey: entityDetails.entityKey,
      displayName: entityDetails.displayName,
      basePlayerKey: entityDetails.playerKey,
      basePlayerName: entityDetails.playerName,
      deck: entityDetails.deck,
      rating: STARTING_RATING,
      lastActiveDate: ''
    });
  }

  const state = stateMap.get(entityDetails.entityKey);
  if (entityDetails.displayName) {
    state.displayName = entityDetails.displayName;
  }
  if (entityDetails.playerKey) {
    state.basePlayerKey = entityDetails.playerKey;
  }
  if (entityDetails.playerName) {
    state.basePlayerName = entityDetails.playerName;
  }
  if (entityDetails.deck) {
    state.deck = entityDetails.deck;
  }
  return state;
}

function applyMatchesToRollingState(stateMap, matches, entityMode) {
  const { batches } = buildBatches(matches, () => 'all-time', entityMode);

  for (const batch of batches) {
    const pendingUpdates = batch.matches.map(match => {
      const playerA = getEntityDetails(match, 'a', entityMode);
      const playerB = getEntityDetails(match, 'b', entityMode);
      const stateA = ensureRollingStateEntry(stateMap, playerA);
      const stateB = ensureRollingStateEntry(stateMap, playerB);
      const scoreA = getResultScore(match);
      const deltaA = calculateEloDelta(stateA.rating, stateB.rating, scoreA);

      return {
        match,
        stateA,
        stateB,
        ratingAAfter: stateA.rating + deltaA,
        ratingBAfter: stateB.rating - deltaA
      };
    });

    for (const update of pendingUpdates) {
      const matchDate = getMatchDate(update.match);
      update.stateA.rating = update.ratingAAfter;
      update.stateB.rating = update.ratingBAfter;
      update.stateA.lastActiveDate = matchDate;
      update.stateB.lastActiveDate = matchDate;
    }
  }
}

function buildRollingStatePayload(stateMap) {
  const normalized = new Map();
  for (const [key, value] of stateMap.entries()) {
    normalized.set(key, {
      playerKey: value.playerKey,
      displayName: value.displayName,
      basePlayerKey: value.basePlayerKey,
      basePlayerName: value.basePlayerName,
      deck: value.deck || '',
      rating: roundRating(value.rating),
      lastActiveDate: value.lastActiveDate || ''
    });
  }

  return {
    entities: toSortedStateObject(normalized)
  };
}

function deriveIncrementalContext(matches, existingMeta) {
  const events = buildEventSequence(matches);
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const activeYear = latestEvent && latestEvent.date ? Number(latestEvent.date.slice(0, 4)) : null;
  const lastProcessedEventId = normalizeText(existingMeta?.lastProcessedEventId);
  const lastProcessedDate = normalizeText(existingMeta?.lastProcessedDate);

  if (!latestEvent) {
    return {
      activeYear: null,
      latestEvent: null,
      newMatches: [],
      canIncrementallyApplyState: true
    };
  }

  if (!lastProcessedEventId || !lastProcessedDate) {
    return {
      activeYear,
      latestEvent,
      newMatches: matches,
      canIncrementallyApplyState: false
    };
  }

  const targetKey = `${lastProcessedDate}|||${lastProcessedEventId}`;
  const eventIndex = events.findIndex(event => event.key === targetKey);
  if (eventIndex === -1) {
    return {
      activeYear,
      latestEvent,
      newMatches: matches,
      canIncrementallyApplyState: false
    };
  }

  const nextEvent = events[eventIndex + 1];
  if (!nextEvent) {
    return {
      activeYear,
      latestEvent,
      newMatches: [],
      canIncrementallyApplyState: true
    };
  }

  const newMatches = matches.filter(match => {
    const date = getMatchDate(match) || UNKNOWN_DATE;
    const eventId = getSortValue(match, ['event_id', 'eventId']) || UNKNOWN_EVENT_ID;
    return `${date}|||${eventId}` > targetKey;
  });

  return {
    activeYear,
    latestEvent,
    newMatches,
    canIncrementallyApplyState: true
  };
}

function writeFullOutputs(allMatches, activeYear, buildStamp, sourceManifest) {
  const years = buildYearSet(allMatches);
  const ranges = buildRangeDescriptors(years);
  const keepPlayerSeasonal = new Set();
  const keepPlayerOnDeckSeasonal = new Set();
  const keepPlayerMultiYear = new Set();
  const keepPlayerOnDeckMultiYear = new Set();

  ensureDir(PLAYER_SEASONAL_DIR);
  ensureDir(PLAYER_MULTI_YEAR_DIR);
  ensureDir(PLAYER_ON_DECK_SEASONAL_DIR);
  ensureDir(PLAYER_ON_DECK_MULTI_YEAR_DIR);
  ensureDir(STATE_DIR);

  for (const year of years) {
    const yearMatches = filterMatchesForYear(allMatches, year);
    const playerResult = processWindow(yearMatches, {
      entityMode: 'player',
      seasonKeyGetter: () => String(year),
      seasonYearGetter: () => String(year)
    });
    const deckResult = processWindow(yearMatches, {
      entityMode: 'player_on_deck',
      seasonKeyGetter: () => String(year),
      seasonYearGetter: () => String(year)
    });

    const seasonalFileName = `${year}.json`;
    keepPlayerSeasonal.add(seasonalFileName);
    keepPlayerOnDeckSeasonal.add(seasonalFileName);
    writeJsonIfChanged(
      path.join(PLAYER_SEASONAL_DIR, seasonalFileName),
      buildSeasonalPayload('player', year, playerResult.rows, playerResult.ratedMatchCount, yearMatches.length, buildStamp)
    );
    writeJsonIfChanged(
      path.join(PLAYER_ON_DECK_SEASONAL_DIR, seasonalFileName),
      buildSeasonalPayload('player-on-deck', year, deckResult.rows, deckResult.ratedMatchCount, yearMatches.length, buildStamp)
    );
  }

  for (const range of ranges) {
    const rangeMatches = filterMatchesForRange(allMatches, range.startYear, range.endYear);

    const playerContinuous = processWindow(rangeMatches, {
      entityMode: 'player',
      seasonKeyGetter: () => range.key,
      seasonYearGetter: () => 'All-time'
    });
    const playerResetRows = years
      .filter(year => year >= range.startYear && year <= range.endYear)
      .map(year => processWindow(filterMatchesForYear(rangeMatches, year), {
        entityMode: 'player',
        seasonKeyGetter: () => String(year),
        seasonYearGetter: () => String(year)
      }).rows);

    const deckContinuous = processWindow(rangeMatches, {
      entityMode: 'player_on_deck',
      seasonKeyGetter: () => range.key,
      seasonYearGetter: () => 'All-time'
    });
    const deckResetRows = years
      .filter(year => year >= range.startYear && year <= range.endYear)
      .map(year => processWindow(filterMatchesForYear(rangeMatches, year), {
        entityMode: 'player_on_deck',
        seasonKeyGetter: () => String(year),
        seasonYearGetter: () => String(year)
      }).rows);

    const continuousFileName = `${range.key}_continuous.json`;
    const resetFileName = `${range.key}_reset.json`;
    keepPlayerMultiYear.add(continuousFileName);
    keepPlayerMultiYear.add(resetFileName);
    keepPlayerOnDeckMultiYear.add(continuousFileName);
    keepPlayerOnDeckMultiYear.add(resetFileName);

    writeJsonIfChanged(
      path.join(PLAYER_MULTI_YEAR_DIR, continuousFileName),
      buildMultiYearPayload('player', range.startYear, range.endYear, 'continuous', playerContinuous.rows, playerContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
    );
    writeJsonIfChanged(
      path.join(PLAYER_MULTI_YEAR_DIR, resetFileName),
      buildMultiYearPayload('player', range.startYear, range.endYear, 'reset', flattenResetRows(playerResetRows), playerContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
    );
    writeJsonIfChanged(
      path.join(PLAYER_ON_DECK_MULTI_YEAR_DIR, continuousFileName),
      buildMultiYearPayload('player-on-deck', range.startYear, range.endYear, 'continuous', deckContinuous.rows, deckContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
    );
    writeJsonIfChanged(
      path.join(PLAYER_ON_DECK_MULTI_YEAR_DIR, resetFileName),
      buildMultiYearPayload('player-on-deck', range.startYear, range.endYear, 'reset', flattenResetRows(deckResetRows), deckContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
    );
  }

  pruneOutputDirectory(PLAYER_SEASONAL_DIR, keepPlayerSeasonal);
  pruneOutputDirectory(PLAYER_MULTI_YEAR_DIR, keepPlayerMultiYear);
  pruneOutputDirectory(PLAYER_ON_DECK_SEASONAL_DIR, keepPlayerOnDeckSeasonal);
  pruneOutputDirectory(PLAYER_ON_DECK_MULTI_YEAR_DIR, keepPlayerOnDeckMultiYear);

  const overallStateMap = new Map();
  const byDeckStateMap = new Map();
  applyMatchesToRollingState(overallStateMap, allMatches, 'player');
  applyMatchesToRollingState(byDeckStateMap, allMatches, 'player_on_deck');
  writePrettyJson(OVERALL_STATE_PATH, buildRollingStatePayload(overallStateMap));
  writePrettyJson(DECK_STATE_PATH, buildRollingStatePayload(byDeckStateMap));

  const latestMatch = allMatches.length > 0 ? allMatches[allMatches.length - 1] : null;
  const meta = {
    lastProcessedEventId: latestMatch ? (getSortValue(latestMatch, ['event_id', 'eventId']) || '') : '',
    lastProcessedDate: latestMatch ? getMatchDate(latestMatch) : '',
    activeYear: Number.isInteger(activeYear) ? activeYear : null
  };
  writePrettyJson(MANIFEST_PATH, buildPrecalculatedManifest(sourceManifest, buildStamp, years, ranges));
  writePrettyJson(META_PATH, meta);

  return meta;
}

function writeIncrementalOutputs(allMatches, existingMeta, buildStamp, sourceManifest) {
  const years = buildYearSet(allMatches);
  const ranges = buildRangeDescriptors(years);
  const incrementalContext = deriveIncrementalContext(allMatches, existingMeta);
  const activeYear = incrementalContext.activeYear;

  ensureDir(PLAYER_SEASONAL_DIR);
  ensureDir(PLAYER_MULTI_YEAR_DIR);
  ensureDir(PLAYER_ON_DECK_SEASONAL_DIR);
  ensureDir(PLAYER_ON_DECK_MULTI_YEAR_DIR);
  ensureDir(STATE_DIR);

  if (Number.isInteger(activeYear)) {
    const activeYearMatches = filterMatchesForYear(allMatches, activeYear);
    const playerSeasonal = processWindow(activeYearMatches, {
      entityMode: 'player',
      seasonKeyGetter: () => String(activeYear),
      seasonYearGetter: () => String(activeYear)
    });
    const deckSeasonal = processWindow(activeYearMatches, {
      entityMode: 'player_on_deck',
      seasonKeyGetter: () => String(activeYear),
      seasonYearGetter: () => String(activeYear)
    });

    writeJsonIfChanged(
      path.join(PLAYER_SEASONAL_DIR, `${activeYear}.json`),
      buildSeasonalPayload('player', activeYear, playerSeasonal.rows, playerSeasonal.ratedMatchCount, activeYearMatches.length, buildStamp)
    );
    writeJsonIfChanged(
      path.join(PLAYER_ON_DECK_SEASONAL_DIR, `${activeYear}.json`),
      buildSeasonalPayload('player-on-deck', activeYear, deckSeasonal.rows, deckSeasonal.ratedMatchCount, activeYearMatches.length, buildStamp)
    );

    const affectedRanges = ranges.filter(range => range.startYear <= activeYear && range.endYear >= activeYear);
    for (const range of affectedRanges) {
      const rangeMatches = filterMatchesForRange(allMatches, range.startYear, range.endYear);
      const yearsInRange = years.filter(year => year >= range.startYear && year <= range.endYear);

      const playerContinuous = processWindow(rangeMatches, {
        entityMode: 'player',
        seasonKeyGetter: () => range.key,
        seasonYearGetter: () => 'All-time'
      });
      const playerResetRows = yearsInRange.map(year => processWindow(filterMatchesForYear(rangeMatches, year), {
        entityMode: 'player',
        seasonKeyGetter: () => String(year),
        seasonYearGetter: () => String(year)
      }).rows);
      const deckContinuous = processWindow(rangeMatches, {
        entityMode: 'player_on_deck',
        seasonKeyGetter: () => range.key,
        seasonYearGetter: () => 'All-time'
      });
      const deckResetRows = yearsInRange.map(year => processWindow(filterMatchesForYear(rangeMatches, year), {
        entityMode: 'player_on_deck',
        seasonKeyGetter: () => String(year),
        seasonYearGetter: () => String(year)
      }).rows);

      writeJsonIfChanged(
        path.join(PLAYER_MULTI_YEAR_DIR, `${range.key}_continuous.json`),
        buildMultiYearPayload('player', range.startYear, range.endYear, 'continuous', playerContinuous.rows, playerContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
      );
      writeJsonIfChanged(
        path.join(PLAYER_MULTI_YEAR_DIR, `${range.key}_reset.json`),
        buildMultiYearPayload('player', range.startYear, range.endYear, 'reset', flattenResetRows(playerResetRows), playerContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
      );
      writeJsonIfChanged(
        path.join(PLAYER_ON_DECK_MULTI_YEAR_DIR, `${range.key}_continuous.json`),
        buildMultiYearPayload('player-on-deck', range.startYear, range.endYear, 'continuous', deckContinuous.rows, deckContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
      );
      writeJsonIfChanged(
        path.join(PLAYER_ON_DECK_MULTI_YEAR_DIR, `${range.key}_reset.json`),
        buildMultiYearPayload('player-on-deck', range.startYear, range.endYear, 'reset', flattenResetRows(deckResetRows), deckContinuous.ratedMatchCount, rangeMatches.length, buildStamp)
      );
    }
  }

  const overallStateMap = cloneStateMapFromFile(readJsonIfExists(OVERALL_STATE_PATH, createEmptyState()));
  const byDeckStateMap = cloneStateMapFromFile(readJsonIfExists(DECK_STATE_PATH, createEmptyState()));
  const canUseExistingState =
    incrementalContext.canIncrementallyApplyState &&
    fs.existsSync(OVERALL_STATE_PATH) &&
    fs.existsSync(DECK_STATE_PATH);

  if (canUseExistingState) {
    applyMatchesToRollingState(overallStateMap, incrementalContext.newMatches, 'player');
    applyMatchesToRollingState(byDeckStateMap, incrementalContext.newMatches, 'player_on_deck');
  } else {
    overallStateMap.clear();
    byDeckStateMap.clear();
    applyMatchesToRollingState(overallStateMap, allMatches, 'player');
    applyMatchesToRollingState(byDeckStateMap, allMatches, 'player_on_deck');
  }

  writePrettyJson(OVERALL_STATE_PATH, buildRollingStatePayload(overallStateMap));
  writePrettyJson(DECK_STATE_PATH, buildRollingStatePayload(byDeckStateMap));

  const latestEvent = incrementalContext.latestEvent;
  const meta = {
    lastProcessedEventId: latestEvent ? latestEvent.eventId : '',
    lastProcessedDate: latestEvent ? latestEvent.date : '',
    activeYear: Number.isInteger(activeYear) ? activeYear : null
  };
  writePrettyJson(MANIFEST_PATH, buildPrecalculatedManifest(sourceManifest, buildStamp, years, ranges));
  writePrettyJson(META_PATH, meta);

  return meta;
}

function main() {
  const isFullRebuild = process.argv.includes('--full-rebuild');
  console.log(isFullRebuild ? 'Running full rebuild...' : 'Running incremental update...');
  console.log(`Reading matchup source from ${path.relative(PROJECT_ROOT, MATCHUP_ROOT)}`);
  console.log(`Writing precalculated Elo output to ${path.relative(PROJECT_ROOT, OUTPUT_ROOT)}`);

  const dataset = loadMatchDataset();
  const allMatches = dataset.matches;
  const latestMatch = allMatches.length > 0 ? allMatches[allMatches.length - 1] : null;
  const activeYear = latestMatch ? getMatchYear(latestMatch) : null;

  if (isFullRebuild) {
    writeFullOutputs(allMatches, activeYear, dataset.buildStamp, dataset.sourceManifest);
    return;
  }

  const existingMeta = readJsonIfExists(META_PATH, null);
  writeIncrementalOutputs(allMatches, existingMeta, dataset.buildStamp, dataset.sourceManifest);
}

main();
