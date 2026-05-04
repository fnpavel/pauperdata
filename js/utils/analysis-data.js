// Maintains the canonical event rows used by every analysis surface and the
// optional data-quality filter that excludes events with too much unknown deck
// data below Top 32.
import { getEventRows } from './event-data.js';

// This module is the single source of truth for "analysis rows". Callers do
// not need to know whether they are reading the raw event dataset or the
// quality-filtered dataset that excludes badly tracked events.

// This toggle is persisted because it changes which events are eligible for analysis
// across Event Analysis, Multi-Event views, and Player Analysis.
const STORAGE_KEY = 'mtg-tracker-exclude-unknown-heavy-below-top32';
const UNKNOWN_DECK_NAMES = new Set(['UNKNOWN', 'UNKNOWN DECK', 'UNKNOW']);
const UNKNOWN_BELOW_TOP32_MIN_COUNT = 3;
const UNKNOWN_BELOW_TOP32_RATIO_THRESHOLD = 0.5;
const EMPTY_ROWS = [];
const analysisIndexCache = new WeakMap();

function readStoredBoolean(key, fallbackValue = false) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallbackValue;
  }

  try {
    const storedValue = window.localStorage.getItem(key);
    if (storedValue === null) {
      return fallbackValue;
    }

    return storedValue === 'true';
  } catch (error) {
    return fallbackValue;
  }
}

function writeStoredBoolean(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(key, String(Boolean(value)));
  } catch (error) {
    // Ignore storage failures and keep the in-memory state.
  }
}

function normalizeDeckName(deckName) {
  return String(deckName ?? '').trim().toUpperCase();
}

function normalizeEventName(eventName) {
  return String(eventName ?? '').trim();
}

function normalizeEventType(eventType) {
  return String(eventType ?? '').trim().toLowerCase();
}

function normalizeDateValue(dateValue) {
  return String(dateValue ?? '').trim();
}

function getNormalizedEventTypes(selectedEventTypes = []) {
  return [...new Set(
    (Array.isArray(selectedEventTypes) ? selectedEventTypes : [selectedEventTypes])
      .map(normalizeEventType)
      .filter(Boolean)
  )].sort();
}

function getFallbackEventDate(eventName = '') {
  const match = normalizeEventName(eventName).match(/\((\d{4}-\d{2}-\d{2})\)$/);
  return match ? match[1] : '';
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

function compareRowsByOriginalOrder(index, rowA, rowB) {
  return (index.rowOrder.get(rowA) ?? 0) - (index.rowOrder.get(rowB) ?? 0);
}

// Returns true for placeholder deck names that should not be treated as tracked
// archetypes in quality checks.
export function isUnknownDeckName(deckName) {
  return UNKNOWN_DECK_NAMES.has(normalizeDeckName(deckName));
}

// Counts below-Top-32 known vs unknown rows for one event.
export function getUnknownBelowTop32Stats(eventRows = []) {
  // Only rows below Top 32 matter for this quality rule.
  const rowsBelowTop32 = (eventRows || []).filter(row => Number(row?.Rank) > 32);
  const unknownBelowTop32Count = rowsBelowTop32.filter(row => isUnknownDeckName(row?.Deck)).length;
  const belowTop32Count = rowsBelowTop32.length;
  const unknownBelowTop32Ratio = belowTop32Count > 0 ? unknownBelowTop32Count / belowTop32Count : 0;

  return {
    belowTop32Count,
    unknownBelowTop32Count,
    unknownBelowTop32Ratio
  };
}

// Applies the quality rule for excluding events with heavy unknown deck data
// below Top 32.
export function shouldExcludeEventForUnknownHeavyBelowTop32(eventRows = []) {
  const {
    belowTop32Count,
    unknownBelowTop32Count,
    unknownBelowTop32Ratio
  } = getUnknownBelowTop32Stats(eventRows);

  // A couple of UNKNOWN rows are tolerated. We only exclude events when the missing
  // data is substantial and represents the majority of the Below Top 32 section.
  if (belowTop32Count === 0 || unknownBelowTop32Count < UNKNOWN_BELOW_TOP32_MIN_COUNT) {
    return false;
  }

  return unknownBelowTop32Ratio > UNKNOWN_BELOW_TOP32_RATIO_THRESHOLD;
}

function buildEventRowsByName(rows = rawCleanedData) {
  const rowsByEventName = new Map();

  rows.forEach(row => {
    const eventName = String(row?.Event || '').trim();
    if (!eventName) {
      return;
    }

    if (!rowsByEventName.has(eventName)) {
      rowsByEventName.set(eventName, []);
    }

    rowsByEventName.get(eventName).push(row);
  });

  return rowsByEventName;
}

function buildAnalysisIndex(rows = []) {
  const resolvedRows = Array.isArray(rows) ? rows : EMPTY_ROWS;
  const index = {
    rowOrder: new WeakMap(),
    rowsByEventName: new Map(),
    rowsByEventType: new Map(),
    rowsByEventTypeAndEvent: new Map(),
    rowsByEventTypeAndDate: new Map(),
    dateSetsByEventType: new Map(),
    dateValuesByEventType: new Map(),
    combinedRowsByEventTypes: new Map(),
    rowsByDateRange: new Map(),
    dateValuesByEventTypes: new Map(),
    singleEventEntriesByType: new Map(),
    latestSingleEventEntry: null
  };
  const latestEntriesByName = new Map();
  const singleEventEntriesByType = new Map();

  resolvedRows.forEach((row, rowIndex) => {
    index.rowOrder.set(row, rowIndex);

    const eventName = normalizeEventName(row?.Event);
    const eventType = normalizeEventType(row?.EventType);
    const dateValue = normalizeDateValue(row?.Date) || getFallbackEventDate(eventName);

    if (eventName) {
      if (!index.rowsByEventName.has(eventName)) {
        index.rowsByEventName.set(eventName, []);
      }
      index.rowsByEventName.get(eventName).push(row);

      const latestEntry = latestEntriesByName.get(eventName);
      const nextEntry = {
        name: eventName,
        date: dateValue,
        eventType
      };
      if (
        !latestEntry
        || dateValue.localeCompare(latestEntry.date) > 0
        || (
          dateValue === latestEntry.date
          && compareRowsByOriginalOrder(index, row, latestEntry.row) > 0
        )
      ) {
        latestEntriesByName.set(eventName, {
          ...nextEntry,
          row
        });
      }
    }

    if (eventType) {
      if (!index.rowsByEventType.has(eventType)) {
        index.rowsByEventType.set(eventType, []);
      }
      index.rowsByEventType.get(eventType).push(row);

      if (eventName) {
        const eventCacheKey = `${eventType}::${eventName}`;
        if (!index.rowsByEventTypeAndEvent.has(eventCacheKey)) {
          index.rowsByEventTypeAndEvent.set(eventCacheKey, []);
        }
        index.rowsByEventTypeAndEvent.get(eventCacheKey).push(row);

        if (!singleEventEntriesByType.has(eventType)) {
          singleEventEntriesByType.set(eventType, new Map());
        }
        if (!singleEventEntriesByType.get(eventType).has(eventName)) {
          singleEventEntriesByType.get(eventType).set(eventName, {
            name: eventName,
            date: dateValue,
            eventType
          });
        }
      }

      if (dateValue) {
        if (!index.rowsByEventTypeAndDate.has(eventType)) {
          index.rowsByEventTypeAndDate.set(eventType, new Map());
        }
        if (!index.rowsByEventTypeAndDate.get(eventType).has(dateValue)) {
          index.rowsByEventTypeAndDate.get(eventType).set(dateValue, []);
        }
        index.rowsByEventTypeAndDate.get(eventType).get(dateValue).push(row);

        if (!index.dateSetsByEventType.has(eventType)) {
          index.dateSetsByEventType.set(eventType, new Set());
        }
        index.dateSetsByEventType.get(eventType).add(dateValue);
      }
    }
  });

  index.dateSetsByEventType.forEach((dateSet, eventType) => {
    index.dateValuesByEventType.set(
      eventType,
      Array.from(dateSet).sort((a, b) => a.localeCompare(b))
    );
  });

  singleEventEntriesByType.forEach((entries, eventType) => {
    index.singleEventEntriesByType.set(
      eventType,
      Array.from(entries.values()).sort((entryA, entryB) => {
        return entryB.date.localeCompare(entryA.date) || entryA.name.localeCompare(entryB.name);
      })
    );
  });

  index.latestSingleEventEntry = Array.from(latestEntriesByName.values())
    .map(({ row, ...entry }) => entry)
    .sort((entryA, entryB) => {
      return entryB.date.localeCompare(entryA.date) || entryA.name.localeCompare(entryB.name);
    })[0] || null;

  return index;
}

function getAnalysisIndex(rows = getAnalysisRows()) {
  const resolvedRows = Array.isArray(rows) ? rows : EMPTY_ROWS;

  if (!analysisIndexCache.has(resolvedRows)) {
    analysisIndexCache.set(resolvedRows, buildAnalysisIndex(resolvedRows));
  }

  return analysisIndexCache.get(resolvedRows);
}

// `rawCleanedData` always keeps the full dataset loaded from disk. The rest of
// the caches are derived from it so toggling the quality rule is just a cheap
// switch between precomputed row collections.
let rawCleanedData = [];
let eventRowsByName = new Map();
let unknownHeavyBelowTop32EventNames = new Set();
let filteredAnalysisRows = [];

function rebuildAnalysisCaches(rows = []) {
  rawCleanedData = Array.isArray(rows) ? rows : [];
  eventRowsByName = buildEventRowsByName(rawCleanedData);
  // Precompute excluded event names once so every chart/filter can do O(1)
  // membership checks instead of rerunning the data-quality rule on demand.
  unknownHeavyBelowTop32EventNames = new Set(
    Array.from(eventRowsByName.entries())
      .filter(([, eventRows]) => shouldExcludeEventForUnknownHeavyBelowTop32(eventRows))
      .map(([eventName]) => eventName)
  );
  filteredAnalysisRows = rawCleanedData.filter(row => {
    return !unknownHeavyBelowTop32EventNames.has(String(row?.Event || '').trim());
  });
}

rebuildAnalysisCaches(getEventRows());

let excludeUnknownHeavyBelowTop32Events = readStoredBoolean(STORAGE_KEY, false);

// Replaces the raw analysis dataset and rebuilds every derived cache.
export function setAnalysisDataRows(rows = []) {
  rebuildAnalysisCaches(rows);
}

// Reads the current persisted/in-memory setting for the unknown-heavy event
// exclusion rule.
export function isUnknownHeavyBelowTop32FilterEnabled() {
  return excludeUnknownHeavyBelowTop32Events;
}

// Toggles the unknown-heavy event exclusion rule and persists the choice.
export function setUnknownHeavyBelowTop32FilterEnabled(isEnabled) {
  excludeUnknownHeavyBelowTop32Events = Boolean(isEnabled);
  writeStoredBoolean(STORAGE_KEY, excludeUnknownHeavyBelowTop32Events);
}

// Returns the currently active row set: raw rows or quality-filtered rows.
export function getAnalysisRows() {
  // This is the single entry point the rest of the app uses when it needs rows
  // for analysis. On = dataset with low-quality events removed. Off = raw dataset.
  return excludeUnknownHeavyBelowTop32Events ? filteredAnalysisRows : rawCleanedData;
}

// Returns the full raw event dataset without applying optional data-quality
// exclusions. Leaderboards use this path so Elo-derived stats always include
// every event unless a record is missing required fields.
export function getAllAnalysisRows() {
  return rawCleanedData;
}

// Returns all rows for a specific event name.
export function getAnalysisRowsForEvent(eventName = '', rows = getAnalysisRows()) {
  const normalizedEventName = normalizeEventName(eventName);
  if (!normalizedEventName) {
    return EMPTY_ROWS;
  }

  return getAnalysisIndex(rows).rowsByEventName.get(normalizedEventName) || EMPTY_ROWS;
}

// Returns rows for one specific event-type/event selection.
export function getAnalysisRowsForSingleEvent(
  {
    eventType = '',
    eventName = ''
  } = {},
  rows = getAnalysisRows()
) {
  const normalizedEventType = normalizeEventType(eventType);
  const normalizedEventName = normalizeEventName(eventName);
  if (!normalizedEventType || !normalizedEventName) {
    return EMPTY_ROWS;
  }

  return getAnalysisIndex(rows).rowsByEventTypeAndEvent.get(`${normalizedEventType}::${normalizedEventName}`) || EMPTY_ROWS;
}

// Returns rows scoped to one or more event types.
export function getAnalysisRowsForEventTypes(selectedEventTypes = [], rows = getAnalysisRows()) {
  const normalizedEventTypes = getNormalizedEventTypes(selectedEventTypes);
  if (normalizedEventTypes.length === 0) {
    return EMPTY_ROWS;
  }

  const index = getAnalysisIndex(rows);
  const cacheKey = normalizedEventTypes.join('||');
  if (index.combinedRowsByEventTypes.has(cacheKey)) {
    return index.combinedRowsByEventTypes.get(cacheKey) || EMPTY_ROWS;
  }

  if (normalizedEventTypes.length === 1) {
    const eventTypeRows = index.rowsByEventType.get(normalizedEventTypes[0]) || EMPTY_ROWS;
    index.combinedRowsByEventTypes.set(cacheKey, eventTypeRows);
    return eventTypeRows;
  }

  const combinedRows = normalizedEventTypes
    .flatMap(eventType => index.rowsByEventType.get(eventType) || EMPTY_ROWS)
    .sort((rowA, rowB) => compareRowsByOriginalOrder(index, rowA, rowB));

  index.combinedRowsByEventTypes.set(cacheKey, combinedRows);
  return combinedRows;
}

// Returns rows scoped to event types and an inclusive date range.
export function getAnalysisRowsForDateRange(
  {
    eventTypes = [],
    startDate = '',
    endDate = ''
  } = {},
  rows = getAnalysisRows()
) {
  const normalizedStartDate = normalizeDateValue(startDate);
  const normalizedEndDate = normalizeDateValue(endDate);
  const normalizedEventTypes = getNormalizedEventTypes(eventTypes);

  if (!normalizedStartDate && !normalizedEndDate) {
    return normalizedEventTypes.length > 0
      ? getAnalysisRowsForEventTypes(normalizedEventTypes, rows)
      : (Array.isArray(rows) ? rows : EMPTY_ROWS);
  }

  if (normalizedEventTypes.length === 0) {
    return (Array.isArray(rows) ? rows : EMPTY_ROWS).filter(row => {
      const rowDate = normalizeDateValue(row?.Date);
      if (!rowDate) {
        return false;
      }

      if (normalizedStartDate && rowDate < normalizedStartDate) {
        return false;
      }

      if (normalizedEndDate && rowDate > normalizedEndDate) {
        return false;
      }

      return true;
    });
  }

  const index = getAnalysisIndex(rows);
  const cacheKey = `${normalizedEventTypes.join('||')}::${normalizedStartDate}::${normalizedEndDate}`;
  if (index.rowsByDateRange.has(cacheKey)) {
    return index.rowsByDateRange.get(cacheKey) || EMPTY_ROWS;
  }

  const rangedRows = normalizedEventTypes.flatMap(eventType => {
    const dateValues = index.dateValuesByEventType.get(eventType) || EMPTY_ROWS;
    const rowsByDate = index.rowsByEventTypeAndDate.get(eventType) || new Map();
    const startIndex = normalizedStartDate ? lowerBound(dateValues, normalizedStartDate) : 0;
    const endIndex = normalizedEndDate ? upperBound(dateValues, normalizedEndDate) : dateValues.length;
    const scopedRows = [];

    for (let indexPosition = startIndex; indexPosition < endIndex; indexPosition += 1) {
      scopedRows.push(...(rowsByDate.get(dateValues[indexPosition]) || EMPTY_ROWS));
    }

    return scopedRows;
  });

  const sortedRows = normalizedEventTypes.length > 1
    ? rangedRows.sort((rowA, rowB) => compareRowsByOriginalOrder(index, rowA, rowB))
    : rangedRows;

  index.rowsByDateRange.set(cacheKey, sortedRows);
  return sortedRows;
}

// Returns sorted unique dates for one or more event types.
export function getAnalysisDateValuesForEventTypes(selectedEventTypes = [], rows = getAnalysisRows()) {
  const normalizedEventTypes = getNormalizedEventTypes(selectedEventTypes);
  if (normalizedEventTypes.length === 0) {
    return EMPTY_ROWS;
  }

  const index = getAnalysisIndex(rows);
  const cacheKey = normalizedEventTypes.join('||');
  if (index.dateValuesByEventTypes.has(cacheKey)) {
    return index.dateValuesByEventTypes.get(cacheKey) || EMPTY_ROWS;
  }

  const dateValues = [...new Set(
    normalizedEventTypes.flatMap(eventType => index.dateValuesByEventType.get(eventType) || EMPTY_ROWS)
  )].sort((dateA, dateB) => dateA.localeCompare(dateB));

  index.dateValuesByEventTypes.set(cacheKey, dateValues);
  return dateValues;
}

// Returns sorted single-event picker entries for one event type.
export function getAnalysisSingleEventEntries(eventType = '', rows = getAnalysisRows()) {
  const normalizedEventType = normalizeEventType(eventType);
  if (!normalizedEventType) {
    return EMPTY_ROWS;
  }

  return getAnalysisIndex(rows).singleEventEntriesByType.get(normalizedEventType) || EMPTY_ROWS;
}

// Returns the latest single event entry across the active analysis rows.
export function getLatestAnalysisSingleEventEntry(rows = getAnalysisRows()) {
  return getAnalysisIndex(rows).latestSingleEventEntry;
}

// Exposes the event names removed by the quality rule so UI summaries/tooltips
// can explain what changed.
export function getUnknownHeavyBelowTop32ExcludedEventNames() {
  return unknownHeavyBelowTop32EventNames;
}
