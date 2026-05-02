// Provides lazy access to matchup-backed Elo match files. The metadata comes
// from the split matchup manifest, while the per-year match datasets are loaded
// on demand from data/matchups.
import { ensureMatchupCatalogLoaded, getMatchupManifest } from './matchup-data.js';

const DEFAULT_EVENT_TYPE = 'online';
const yearModuleCache = new Map();
const MATCHUP_DATA_ROOT = new URL('../../data/matchups/', import.meta.url);

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeEventTypes(eventTypes = []) {
  const normalizedTypes = (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
    .map(value => normalizeText(value).toLowerCase())
    .filter(Boolean);

  return normalizedTypes.length > 0 ? normalizedTypes : [DEFAULT_EVENT_TYPE];
}

function getMatchDate(record) {
  return normalizeText(record?.date || record?.Date);
}

function getMatchEventType(record) {
  return normalizeText(record?.event_type || record?.EventType).toLowerCase();
}

function getYearFromDate(dateValue = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '').trim())
    ? String(dateValue).slice(0, 4)
    : '';
}

function getYearsForWindow(startDate = '', endDate = '') {
  const matchupManifest = getMatchupManifest();
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

async function loadYearMatches(year = '') {
  const matchupManifest = getMatchupManifest();
  const normalizedYear = String(year || '').trim();
  if (!normalizedYear) {
    return [];
  }

  if (!yearModuleCache.has(normalizedYear)) {
    const relativePath = String(matchupManifest?.match_files_by_year?.[normalizedYear] || '').trim();
    yearModuleCache.set(
      normalizedYear,
      (relativePath
        ? fetch(new URL(relativePath, MATCHUP_DATA_ROOT))
            .then(response => {
              if (!response.ok) {
                throw new Error(`Failed to load matchup matches for ${normalizedYear}`);
              }

              return response.json();
            })
            .then(payload => Array.isArray(payload) ? payload : [])
        : Promise.resolve([]))
        .catch(() => [])
    );
  }

  return yearModuleCache.get(normalizedYear);
}

// Returns the generated manifest that lists available Elo years and dates.
export function getEloManifest() {
  return getMatchupManifest();
}

// Lists event-type buckets present in the generated Elo manifest.
export function getEloEventTypes() {
  const matchupManifest = getMatchupManifest();
  return Object.keys(matchupManifest?.available_dates_by_event_type || {}).sort((a, b) => a.localeCompare(b));
}

// Returns the union of available Elo dates for the selected event types.
export function getEloAvailableDates(eventTypes = [DEFAULT_EVENT_TYPE]) {
  const matchupManifest = getMatchupManifest();
  const normalizedEventTypes = normalizeEventTypes(eventTypes);
  const datesByEventType = matchupManifest?.available_dates_by_event_type || {};

  return [...new Set(
    normalizedEventTypes.flatMap(eventType => Array.isArray(datesByEventType[eventType]) ? datesByEventType[eventType] : [])
  )].sort((a, b) => a.localeCompare(b));
}

// Loads and filters Elo match records for the selected event types/date window.
export async function getEloMatches({
  eventTypes = [DEFAULT_EVENT_TYPE],
  startDate = '',
  endDate = ''
} = {}) {
  await ensureMatchupCatalogLoaded();
  const normalizedEventTypes = normalizeEventTypes(eventTypes);
  const yearsToLoad = getYearsForWindow(startDate, endDate);
  const yearMatchGroups = await Promise.all(yearsToLoad.map(loadYearMatches));
  const loadedMatches = yearMatchGroups.flat();

  // Final filtering happens after loading because the files are year-based while
  // UI windows can be arbitrary date ranges inside those years.
  return loadedMatches.filter(match => {
    const matchDate = getMatchDate(match);
    const matchEventType = getMatchEventType(match);

    if (normalizedEventTypes.length > 0 && !normalizedEventTypes.includes(matchEventType)) {
      return false;
    }

    if (startDate && matchDate < startDate) {
      return false;
    }

    if (endDate && matchDate > endDate) {
      return false;
    }

    return true;
  });
}
