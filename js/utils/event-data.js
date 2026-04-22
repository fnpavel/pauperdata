// Event results are split into a manifest plus per-year files. This module
// keeps one in-memory copy of that structure and memoizes year fetches so
// repeated UI refreshes do not hit the network again.
const EVENT_DATA_ROOT = new URL('../../data/events/', import.meta.url);

const EMPTY_MANIFEST = Object.freeze({
  years: [],
  last_updated_date: '',
  event_files_by_year: {},
  event_counts_by_year: {}
});

let eventManifest = EMPTY_MANIFEST;
let eventRows = [];
let eventDataPromise = null;

// year -> Promise<Array<eventRow>>
const eventYearsCache = new Map();

async function fetchEventJsonFile(relativePath = '') {
  const response = await fetch(new URL(relativePath, EVENT_DATA_ROOT));
  if (!response.ok) {
    throw new Error(`Failed to load event data file: ${relativePath} (${response.status})`);
  }

  return response.json();
}

async function loadYearDataset(year = '') {
  const normalizedYear = String(year || '').trim();
  if (!normalizedYear) {
    return [];
  }

  if (!eventYearsCache.has(normalizedYear)) {
    const relativePath = String(eventManifest?.event_files_by_year?.[normalizedYear] || '').trim();
    if (!relativePath) {
      eventYearsCache.set(normalizedYear, Promise.resolve([]));
    } else {
      eventYearsCache.set(
        normalizedYear,
        fetchEventJsonFile(relativePath)
          .then(payload => Array.isArray(payload) ? payload : [])
          .catch(() => [])
      );
    }
  }

  return eventYearsCache.get(normalizedYear);
}

export async function ensureEventDataLoaded() {
  if (!eventDataPromise) {
    // Single-flight loading: if several modules initialize at once, they all
    // await the same promise instead of refetching the manifest and year files.
    eventDataPromise = fetchEventJsonFile('manifest.json')
      .then(async manifest => {
        eventManifest = manifest && typeof manifest === 'object'
          ? {
              ...EMPTY_MANIFEST,
              ...manifest
            }
          : EMPTY_MANIFEST;

        const years = Array.isArray(eventManifest.years) ? eventManifest.years : [];
        const yearGroups = await Promise.all(years.map(year => loadYearDataset(year)));
        eventRows = yearGroups.flat();

        return {
          manifest: eventManifest,
          rows: eventRows
        };
      })
      .catch(error => {
        // Reset the memoized promise so a later retry can attempt loading again.
        eventDataPromise = null;
        throw error;
      });
  }

  return eventDataPromise;
}

export function getEventManifest() {
  return eventManifest;
}

export function getEventRows() {
  return eventRows;
}

export function getLastUpdatedDate() {
  return String(eventManifest?.last_updated_date || '').trim();
}
