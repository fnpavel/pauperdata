// Loads the matchup archive in two phases: a lightweight catalog first, then
// per-year match/round files for the active date window. This keeps initial page
// load smaller while still allowing large matchup matrices when requested.
import { getQuickViewPresetDefinitionsByIds, shiftDateByDays } from './quick-view-presets.js';

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
const matchupRecordIndexCache = new WeakMap();

function getRecordDate(record) {
  return String(record?.date || record?.Date || '').trim();
}

function getRecordEventType(record) {
  return String(record?.event_type || record?.EventType || '').trim().toLowerCase();
}

function getNormalizedEventTypes(eventTypes = []) {
  return [...new Set(
    (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )].sort();
}

function lowerBound(values = [], target = '') {
  let left = 0;
  let right = values.length;

  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (values[middle] < target) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  return left;
}

function upperBound(values = [], target = '') {
  let left = 0;
  let right = values.length;

  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (values[middle] <= target) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  return left;
}

function buildMatchupRecordIndex(records = []) {
  const resolvedRecords = Array.isArray(records) ? records : [];
  const index = {
    rowOrder: new WeakMap(),
    rowsByEventType: new Map(),
    rowsByEventTypeAndDate: new Map(),
    dateSetsByEventType: new Map(),
    dateValuesByEventType: new Map(),
    combinedRowsByEventTypes: new Map(),
    rowsByDateRange: new Map()
  };

  resolvedRecords.forEach((record, recordIndex) => {
    const eventType = getRecordEventType(record);
    const recordDate = getRecordDate(record);

    index.rowOrder.set(record, recordIndex);

    if (!eventType) {
      return;
    }

    if (!index.rowsByEventType.has(eventType)) {
      index.rowsByEventType.set(eventType, []);
    }
    index.rowsByEventType.get(eventType).push(record);

    if (!recordDate) {
      return;
    }

    if (!index.rowsByEventTypeAndDate.has(eventType)) {
      index.rowsByEventTypeAndDate.set(eventType, new Map());
    }
    if (!index.rowsByEventTypeAndDate.get(eventType).has(recordDate)) {
      index.rowsByEventTypeAndDate.get(eventType).set(recordDate, []);
    }
    index.rowsByEventTypeAndDate.get(eventType).get(recordDate).push(record);

    if (!index.dateSetsByEventType.has(eventType)) {
      index.dateSetsByEventType.set(eventType, new Set());
    }
    index.dateSetsByEventType.get(eventType).add(recordDate);
  });

  index.dateSetsByEventType.forEach((dateSet, eventType) => {
    index.dateValuesByEventType.set(
      eventType,
      Array.from(dateSet).sort((dateA, dateB) => dateA.localeCompare(dateB))
    );
  });

  return index;
}

function getMatchupRecordIndex(records = []) {
  const resolvedRecords = Array.isArray(records) ? records : [];
  if (!matchupRecordIndexCache.has(resolvedRecords)) {
    matchupRecordIndexCache.set(resolvedRecords, buildMatchupRecordIndex(resolvedRecords));
  }

  return matchupRecordIndexCache.get(resolvedRecords);
}

function compareMatchupRecordsByOriginalOrder(index, recordA, recordB) {
  return (index.rowOrder.get(recordA) ?? 0) - (index.rowOrder.get(recordB) ?? 0);
}

function getMatchupRowsForEventTypes(records = [], eventTypes = []) {
  const normalizedEventTypes = getNormalizedEventTypes(eventTypes);
  if (normalizedEventTypes.length === 0) {
    return Array.isArray(records) ? records : [];
  }

  const index = getMatchupRecordIndex(records);
  const cacheKey = normalizedEventTypes.join('||');
  if (index.combinedRowsByEventTypes.has(cacheKey)) {
    return index.combinedRowsByEventTypes.get(cacheKey) || [];
  }

  if (normalizedEventTypes.length === 1) {
    const eventTypeRows = index.rowsByEventType.get(normalizedEventTypes[0]) || [];
    index.combinedRowsByEventTypes.set(cacheKey, eventTypeRows);
    return eventTypeRows;
  }

  const combinedRows = normalizedEventTypes
    .flatMap(eventType => index.rowsByEventType.get(eventType) || [])
    .sort((recordA, recordB) => compareMatchupRecordsByOriginalOrder(index, recordA, recordB));

  index.combinedRowsByEventTypes.set(cacheKey, combinedRows);
  return combinedRows;
}

function getMatchupRowsForDateRange(records = [], { eventTypes = [], startDate = '', endDate = '' } = {}) {
  const normalizedEventTypes = getNormalizedEventTypes(eventTypes);
  const normalizedStartDate = String(startDate || '').trim();
  const normalizedEndDate = String(endDate || '').trim();

  if (!normalizedStartDate && !normalizedEndDate) {
    return getMatchupRowsForEventTypes(records, normalizedEventTypes);
  }

  if (normalizedEventTypes.length === 0) {
    return (Array.isArray(records) ? records : []).filter(record => {
      const recordDate = getRecordDate(record);
      if (!recordDate) {
        return false;
      }

      if (normalizedStartDate && recordDate < normalizedStartDate) {
        return false;
      }

      if (normalizedEndDate && recordDate > normalizedEndDate) {
        return false;
      }

      return true;
    });
  }

  const index = getMatchupRecordIndex(records);
  const cacheKey = `${normalizedEventTypes.join('||')}::${normalizedStartDate}::${normalizedEndDate}`;
  if (index.rowsByDateRange.has(cacheKey)) {
    return index.rowsByDateRange.get(cacheKey) || [];
  }

  const rangedRows = normalizedEventTypes.flatMap(eventType => {
    const dateValues = index.dateValuesByEventType.get(eventType) || [];
    const rowsByDate = index.rowsByEventTypeAndDate.get(eventType) || new Map();
    const startIndex = normalizedStartDate ? lowerBound(dateValues, normalizedStartDate) : 0;
    const endIndex = normalizedEndDate ? upperBound(dateValues, normalizedEndDate) : dateValues.length;
    const scopedRows = [];

    for (let indexPosition = startIndex; indexPosition < endIndex; indexPosition += 1) {
      scopedRows.push(...(rowsByDate.get(dateValues[indexPosition]) || []));
    }

    return scopedRows;
  });

  const sortedRows = normalizedEventTypes.length > 1
    ? rangedRows.sort((recordA, recordB) => compareMatchupRecordsByOriginalOrder(index, recordA, recordB))
    : rangedRows;

  index.rowsByDateRange.set(cacheKey, sortedRows);
  return sortedRows;
}

function getQuickViewPresetRange(presets = []) {
  if (!Array.isArray(presets) || presets.length !== 1) {
    return null;
  }

  const preset = presets[0];
  if (!preset || preset.kind === 'static') {
    return null;
  }

  if (preset.kind === 'calendar-year') {
    return {
      startDate: preset.startDate,
      endDate: preset.endDate
    };
  }

  if (preset.kind === 'set-window') {
    return {
      startDate: preset.releaseDate,
      endDate: preset.nextReleaseDate ? shiftDateByDays(preset.nextReleaseDate, -1) : ''
    };
  }

  return null;
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

function matchesQuickViewPreset(record, presetId = '', presets = getQuickViewPresetDefinitionsByIds(presetId)) {
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
  const resolvedRecords = Array.isArray(records) ? records : [];
  const selectedEventTypes = getNormalizedEventTypes(eventTypes);
  const presets = quickViewPresetId ? getQuickViewPresetDefinitionsByIds(quickViewPresetId) : [];
  const presetRange = (!startDate && !endDate) ? getQuickViewPresetRange(presets) : null;
  const baseRecords = (startDate || endDate || selectedEventTypes.length > 0 || presetRange)
    ? getMatchupRowsForDateRange(resolvedRecords, {
        eventTypes: selectedEventTypes,
        startDate: startDate || presetRange?.startDate || '',
        endDate: endDate || presetRange?.endDate || ''
      })
    : resolvedRecords;

  if (!quickViewPresetId) {
    return baseRecords;
  }

  return baseRecords.filter(record => matchesQuickViewPreset(record, quickViewPresetId, presets));
}
