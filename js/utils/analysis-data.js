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

// Exposes the event names removed by the quality rule so UI summaries/tooltips
// can explain what changed.
export function getUnknownHeavyBelowTop32ExcludedEventNames() {
  return unknownHeavyBelowTop32EventNames;
}
