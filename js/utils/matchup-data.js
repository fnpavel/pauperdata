// Loads the matchup archive in two phases: a lightweight catalog first, then
// per-year match/round files for the active date window. This keeps initial page
// load smaller while still allowing large matchup matrices when requested.
import { getQuickViewPresetDefinitionsByIds } from './quick-view-presets.js';

const MATCHUP_DATA_ROOT = new URL('../../data/matchups/', import.meta.url);

const EMPTY_MANIFEST = Object.freeze({
  years: [],
  events_file: 'events.json',
  round_files_by_year: {},
  match_files_by_year: {}
});

let matchupManifest = EMPTY_MANIFEST;
let matchupEvents = [];
let matchupRounds = [];
let matchupMatches = [];
let matchupCatalogPromise = null;
let loadedMatchYearsKey = '';
let loadedRoundYearsKey = '';

const matchYearsCache = new Map();
const roundYearsCache = new Map();

function getRecordDate(record) {
  return String(record?.date || record?.Date || '').trim();
}

function getRecordEventType(record) {
  return String(record?.event_type || record?.EventType || '').trim().toLowerCase();
}

function getYearFromDate(dateValue = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '').trim())
    ? String(dateValue).slice(0, 4)
    : '';
}

function getYearsForRange(startDate = '', endDate = '') {
  const availableYears = Array.isArray(matchupManifest?.years) ? matchupManifest.years : [];
  if (!startDate || !endDate) {
    return availableYears;
  }

  const startYear = getYearFromDate(startDate);
  const endYear = getYearFromDate(endDate);
  if (!startYear || !endYear) {
    return availableYears;
  }

  return availableYears.filter(year => year >= startYear && year <= endYear);
}

function matchesQuickViewPreset(record, presetId = '') {
  const presets = getQuickViewPresetDefinitionsByIds(presetId);
  if (presets.length === 0 || presets.some(preset => preset.kind === 'static')) {
    return true;
  }

  const recordDate = getRecordDate(record);
  if (!recordDate) {
    return false;
  }

  const calendarYearPresets = presets.filter(preset => preset.kind === 'calendar-year');
  if (calendarYearPresets.length > 0) {
    return calendarYearPresets.some(preset => recordDate >= preset.startDate && recordDate <= preset.endDate);
  }

  const setWindowPresets = presets.filter(preset => preset.kind === 'set-window');
  if (setWindowPresets.length > 0) {
    return setWindowPresets.some(preset => {
      return recordDate >= preset.releaseDate && (!preset.nextReleaseDate || recordDate < preset.nextReleaseDate);
    });
  }

  return true;
}

async function fetchMatchupJsonFile(relativePath = '') {
  const response = await fetch(new URL(relativePath, MATCHUP_DATA_ROOT));
  if (!response.ok) {
    throw new Error(`Failed to load matchup data file: ${relativePath} (${response.status})`);
  }

  return response.json();
}

async function loadYearDataset(year = '', fileMap = {}, cache = new Map()) {
  const normalizedYear = String(year || '').trim();
  if (!normalizedYear) {
    return [];
  }

  if (!cache.has(normalizedYear)) {
    // Store promises, not just resolved arrays, so concurrent calls for the same
    // year share one network request.
    const relativePath = String(fileMap?.[normalizedYear] || '').trim();
    if (!relativePath) {
      cache.set(normalizedYear, Promise.resolve([]));
    } else {
      cache.set(
        normalizedYear,
        fetchMatchupJsonFile(relativePath)
          .then(payload => Array.isArray(payload) ? payload : [])
          .catch(() => [])
      );
    }
  }

  return cache.get(normalizedYear);
}

function getYearCacheKey(years = []) {
  return [...new Set((Array.isArray(years) ? years : []).filter(Boolean))].join('|');
}

// Loads the matchup manifest and event catalog once.
export async function ensureMatchupCatalogLoaded() {
  if (!matchupCatalogPromise) {
    matchupCatalogPromise = Promise.all([
      fetchMatchupJsonFile('manifest.json'),
      fetchMatchupJsonFile('events.json')
    ]).then(([manifest, events]) => {
      matchupManifest = manifest && typeof manifest === 'object'
        ? {
            ...EMPTY_MANIFEST,
            ...manifest
          }
        : EMPTY_MANIFEST;
      matchupEvents = Array.isArray(events) ? events : [];
      return {
        manifest: matchupManifest,
        events: matchupEvents
      };
    }).catch(error => {
      matchupCatalogPromise = null;
      throw error;
    });
  }

  return matchupCatalogPromise;
}

// Loads match and/or round records for the years touched by the active window.
export async function ensureMatchupWindowLoaded({
  startDate = '',
  endDate = '',
  includeMatches = true,
  includeRounds = false
} = {}) {
  await ensureMatchupCatalogLoaded();
  const yearsToLoad = getYearsForRange(startDate, endDate);
  const yearsKey = getYearCacheKey(yearsToLoad);

  if (includeMatches) {
    if (yearsKey !== loadedMatchYearsKey) {
      // Only reload when the set of years changes. Date filtering happens below
      // in memory, so sliding within the same year range is cheap.
      const matchGroups = await Promise.all(
        yearsToLoad.map(year => loadYearDataset(year, matchupManifest.match_files_by_year, matchYearsCache))
      );
      matchupMatches = matchGroups.flat();
      loadedMatchYearsKey = yearsKey;
    }
  } else {
    matchupMatches = [];
    loadedMatchYearsKey = '';
  }

  if (includeRounds) {
    if (yearsKey !== loadedRoundYearsKey) {
      const roundGroups = await Promise.all(
        yearsToLoad.map(year => loadYearDataset(year, matchupManifest.round_files_by_year, roundYearsCache))
      );
      matchupRounds = roundGroups.flat();
      loadedRoundYearsKey = yearsKey;
    }
  } else {
    matchupRounds = [];
    loadedRoundYearsKey = '';
  }

  return {
    manifest: matchupManifest,
    events: matchupEvents,
    matches: matchupMatches,
    rounds: matchupRounds,
    years: yearsToLoad
  };
}

// Returns the currently loaded matchup manifest.
export function getMatchupManifest() {
  return matchupManifest;
}

// Returns the matchup event catalog loaded by ensureMatchupCatalogLoaded().
export function getMatchupEvents() {
  return matchupEvents;
}

// Returns currently loaded round records for the active window.
export function getMatchupRounds() {
  return matchupRounds;
}

// Returns currently loaded match records for the active window.
export function getMatchupMatches() {
  return matchupMatches;
}

// Filters loaded matchup records by event type, date window, and quick-view
// preset.
export function filterMatchupRecords(
  records = [],
  {
    eventTypes = [],
    startDate = '',
    endDate = '',
    quickViewPresetId = ''
  } = {}
) {
  // The archive uses normalized ISO dates, so string comparisons are safe and
  // faster than constructing Date objects for every record.
  const selectedEventTypes = Array.isArray(eventTypes)
    ? eventTypes.map(value => String(value || '').toLowerCase()).filter(Boolean)
    : [];

  return (records || []).filter(record => {
    const recordDate = getRecordDate(record);
    const recordEventType = getRecordEventType(record);

    if (selectedEventTypes.length > 0 && !selectedEventTypes.includes(recordEventType)) {
      return false;
    }

    if (startDate && recordDate < startDate) {
      return false;
    }

    if (endDate && recordDate > endDate) {
      return false;
    }

    if (quickViewPresetId && !matchesQuickViewPreset(record, quickViewPresetId)) {
      return false;
    }

    return true;
  });
}
