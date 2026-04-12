import { eloManifest } from '../elo-data/manifest.js';

const DEFAULT_EVENT_TYPE = 'online';
const yearModuleCache = new Map();

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
  const availableYears = Array.isArray(eloManifest?.years) ? eloManifest.years : [];
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
  const normalizedYear = String(year || '').trim();
  if (!normalizedYear) {
    return [];
  }

  if (!yearModuleCache.has(normalizedYear)) {
    yearModuleCache.set(
      normalizedYear,
      import(`../elo-data/${normalizedYear}.js`)
        .then(module => Array.isArray(module.eloMatches) ? module.eloMatches : [])
        .catch(() => [])
    );
  }

  return yearModuleCache.get(normalizedYear);
}

export function getEloManifest() {
  return eloManifest;
}

export function getEloEventTypes() {
  return Object.keys(eloManifest?.availableDatesByEventType || {}).sort((a, b) => a.localeCompare(b));
}

export function getEloAvailableDates(eventTypes = [DEFAULT_EVENT_TYPE]) {
  const normalizedEventTypes = normalizeEventTypes(eventTypes);
  const datesByEventType = eloManifest?.availableDatesByEventType || {};

  return [...new Set(
    normalizedEventTypes.flatMap(eventType => Array.isArray(datesByEventType[eventType]) ? datesByEventType[eventType] : [])
  )].sort((a, b) => a.localeCompare(b));
}

export async function getEloMatches({
  eventTypes = [DEFAULT_EVENT_TYPE],
  startDate = '',
  endDate = ''
} = {}) {
  const normalizedEventTypes = normalizeEventTypes(eventTypes);
  const yearsToLoad = getYearsForWindow(startDate, endDate);
  const yearMatchGroups = await Promise.all(yearsToLoad.map(loadYearMatches));
  const loadedMatches = yearMatchGroups.flat();

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
