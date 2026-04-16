import { getEventRows } from './event-data.js';

// This toggle is persisted because it changes which events are eligible for analysis
// across Event Analysis, Multi-Event views, and Player Analysis.
const STORAGE_KEY = 'mtg-tracker-exclude-unknown-heavy-below-top32';
const UNKNOWN_DECK_NAMES = new Set(['UNKNOWN', 'UNKNOWN DECK', 'UNKNOW']);
const UNKNOWN_BELOW_TOP32_MIN_COUNT = 3;
const UNKNOWN_BELOW_TOP32_RATIO_THRESHOLD = 0.5;

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

export function isUnknownDeckName(deckName) {
  return UNKNOWN_DECK_NAMES.has(normalizeDeckName(deckName));
}

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

let rawCleanedData = [];
let eventRowsByName = new Map();
let unknownHeavyBelowTop32EventNames = new Set();
let filteredAnalysisRows = [];

function rebuildAnalysisCaches(rows = []) {
  rawCleanedData = Array.isArray(rows) ? rows : [];
  eventRowsByName = buildEventRowsByName(rawCleanedData);
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

export function setAnalysisDataRows(rows = []) {
  rebuildAnalysisCaches(rows);
}

export function isUnknownHeavyBelowTop32FilterEnabled() {
  return excludeUnknownHeavyBelowTop32Events;
}

export function setUnknownHeavyBelowTop32FilterEnabled(isEnabled) {
  excludeUnknownHeavyBelowTop32Events = Boolean(isEnabled);
  writeStoredBoolean(STORAGE_KEY, excludeUnknownHeavyBelowTop32Events);
}

export function getAnalysisRows() {
  // This is the single entry point the rest of the app uses when it needs rows
  // for analysis. On = dataset with low-quality events removed. Off = raw dataset.
  return excludeUnknownHeavyBelowTop32Events ? filteredAnalysisRows : rawCleanedData;
}

export function getUnknownHeavyBelowTop32ExcludedEventNames() {
  return unknownHeavyBelowTop32EventNames;
}
