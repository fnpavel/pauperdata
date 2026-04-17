import { getAnalysisRows } from './analysis-data.js';
import { setReleaseWindows } from '../config/set-release-windows.js';

const EMPTY_ROWS = [];
const quickViewRowsCache = new WeakMap();

const STATIC_QUICK_VIEW_PRESETS = [
  {
    id: 'all-period',
    label: 'All Period',
    buttonLabel: 'All Period',
    kind: 'static',
    eventTypes: ['online', 'offline']
  }
];

function getResolvedRows(rows = getAnalysisRows()) {
  return Array.isArray(rows) ? rows : EMPTY_ROWS;
}

function getQuickViewRowsCache(rows = getAnalysisRows()) {
  const resolvedRows = getResolvedRows(rows);
  let cache = quickViewRowsCache.get(resolvedRows);

  if (!cache) {
    cache = {
      latestRowDate: '',
      setPresetDefinitions: new Map(),
      quickViewDefinitions: new Map(),
      presetDefinitionsByIds: new Map(),
      yearOptions: new Map(),
      latestSetPresetIds: new Map(),
      rowsByEventTypes: new Map(),
      presetRows: new Map(),
      suggestedRanges: new Map()
    };
    quickViewRowsCache.set(resolvedRows, cache);
  }

  return cache;
}

function normalizeEventTypesForCache(selectedEventTypes = []) {
  return [...new Set(
    (Array.isArray(selectedEventTypes) ? selectedEventTypes : [selectedEventTypes])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )].sort();
}

function getEventTypesCacheKey(selectedEventTypes = []) {
  return normalizeEventTypesForCache(selectedEventTypes).join('||');
}

function getPresetIdsCacheKey(presetIds = []) {
  return normalizeQuickViewPresetIds(presetIds).join('||');
}

function getRowsScopedToEventTypes(rows = getAnalysisRows(), selectedEventTypes = []) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const cacheKey = getEventTypesCacheKey(selectedEventTypes);

  if (!cacheKey) {
    return EMPTY_ROWS;
  }

  if (!cache.rowsByEventTypes.has(cacheKey)) {
    const selectedEventTypeSet = new Set(cacheKey.split('||'));
    cache.rowsByEventTypes.set(
      cacheKey,
      resolvedRows.filter(row => selectedEventTypeSet.has(String(row?.EventType || '').toLowerCase()))
    );
  }

  return cache.rowsByEventTypes.get(cacheKey) || EMPTY_ROWS;
}

function buildSuggestedRange(rows = []) {
  const seenDates = new Set();
  let startDate = '';
  let endDate = '';

  rows.forEach(row => {
    const dateValue = String(row?.Date || '').trim();
    if (!dateValue || seenDates.has(dateValue)) {
      return;
    }

    seenDates.add(dateValue);

    if (!startDate || dateValue.localeCompare(startDate) < 0) {
      startDate = dateValue;
    }

    if (!endDate || dateValue.localeCompare(endDate) > 0) {
      endDate = dateValue;
    }
  });

  return {
    startDate,
    endDate,
    dateCount: seenDates.size
  };
}

function getLatestRowDate(rows = getAnalysisRows()) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);

  if (!cache.latestRowDate) {
    cache.latestRowDate = resolvedRows.reduce((latestDate, row) => {
      return row.Date > latestDate ? row.Date : latestDate;
    }, '');
  }

  return cache.latestRowDate;
}

export function normalizeQuickViewPresetIds(presetIds = []) {
  const sourceValues = Array.isArray(presetIds) ? presetIds : [presetIds];
  const uniqueIds = new Set();

  sourceValues
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean)
    .forEach(value => uniqueIds.add(value));

  return Array.from(uniqueIds);
}

function buildCalendarYearPresets() {
  const releaseYears = [...new Set(
    setReleaseWindows
      .map(window => String(window.releaseDate || '').slice(0, 4))
      .filter(Boolean)
  )].sort((a, b) => Number(b) - Number(a));

  return releaseYears.map(year => ({
    id: `all-${year}`,
    label: `All ${year}`,
    buttonLabel: `All ${year}`,
    kind: 'calendar-year',
    eventTypes: ['online', 'offline'],
    releaseYear: year,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`
  }));
}

function buildSetWindowPresets(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  const sortedWindows = [...setReleaseWindows].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  const latestRowDate = getLatestRowDate(rows);

  return sortedWindows
    .map((window, index) => {
      const nextWindow = sortedWindows[index + 1];

      return {
        id: `set-window-${window.slug}`,
        label: window.label,
        buttonLabel: window.buttonLabel || window.label,
        kind: 'set-window',
        eventTypes: ['online', 'offline'],
        releaseDate: window.releaseDate,
        releaseYear: String(window.releaseDate).slice(0, 4),
        nextReleaseDate: nextWindow?.releaseDate || ''
      };
    })
    .filter(preset => includeFuture || !latestRowDate || preset.releaseDate <= latestRowDate);
}

export function shiftDateByDays(dateString, dayDelta) {
  if (!dateString) {
    return '';
  }

  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

export function getStaticQuickViewPresetDefinitions() {
  return [...STATIC_QUICK_VIEW_PRESETS, ...buildCalendarYearPresets()];
}

export function getSetQuickViewPresetDefinitions(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const cacheKey = includeFuture ? 'include-future' : 'current-only';

  if (!cache.setPresetDefinitions.has(cacheKey)) {
    cache.setPresetDefinitions.set(cacheKey, buildSetWindowPresets(resolvedRows, { includeFuture }).reverse());
  }

  return cache.setPresetDefinitions.get(cacheKey) || [];
}

export function getQuickViewPresetDefinitions(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const cacheKey = includeFuture ? 'include-future' : 'current-only';

  if (!cache.quickViewDefinitions.has(cacheKey)) {
    cache.quickViewDefinitions.set(
      cacheKey,
      [...getStaticQuickViewPresetDefinitions(), ...getSetQuickViewPresetDefinitions(resolvedRows, { includeFuture })]
    );
  }

  return cache.quickViewDefinitions.get(cacheKey) || [];
}

export function getQuickViewPresetDefinitionById(presetId, rows = getAnalysisRows(), { includeFuture = true } = {}) {
  return getQuickViewPresetDefinitions(rows, { includeFuture }).find(preset => preset.id === presetId) || null;
}

export function getQuickViewPresetDefinitionsByIds(presetIds = [], rows = getAnalysisRows(), { includeFuture = true } = {}) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const cacheKey = `${includeFuture ? 'include-future' : 'current-only'}::${getPresetIdsCacheKey(presetIds)}`;

  if (!cache.presetDefinitionsByIds.has(cacheKey)) {
    const presetsById = new Map(
      getQuickViewPresetDefinitions(resolvedRows, { includeFuture }).map(preset => [preset.id, preset])
    );

    cache.presetDefinitionsByIds.set(
      cacheKey,
      normalizeQuickViewPresetIds(presetIds)
        .map(presetId => presetsById.get(presetId))
        .filter(Boolean)
    );
  }

  return cache.presetDefinitionsByIds.get(cacheKey) || [];
}

export function getQuickViewPresetYearOptions(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const cacheKey = includeFuture ? 'include-future' : 'current-only';

  if (!cache.yearOptions.has(cacheKey)) {
    cache.yearOptions.set(
      cacheKey,
      [...new Set(getSetQuickViewPresetDefinitions(resolvedRows, { includeFuture }).map(preset => preset.releaseYear))]
        .sort((a, b) => Number(b) - Number(a))
    );
  }

  return cache.yearOptions.get(cacheKey) || [];
}

export function getDefaultQuickViewYear(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  const yearOptions = getQuickViewPresetYearOptions(rows, { includeFuture });
  const currentYear = String(new Date().getFullYear());

  if (yearOptions.includes(currentYear)) {
    return currentYear;
  }

  return yearOptions[0] || '';
}

export function getLatestSetQuickViewPresetId(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const cacheKey = includeFuture ? 'include-future' : 'current-only';

  if (!cache.latestSetPresetIds.has(cacheKey)) {
    cache.latestSetPresetIds.set(
      cacheKey,
      getSetQuickViewPresetDefinitions(resolvedRows, { includeFuture })[0]?.id || 'all-period'
    );
  }

  return cache.latestSetPresetIds.get(cacheKey) || 'all-period';
}

export function getQuickViewPresetEventTypes(presetId, rows = getAnalysisRows()) {
  const presets = getQuickViewPresetDefinitionsByIds(presetId, rows);
  if (presets.length === 0) {
    return null;
  }

  return [...new Set(presets.flatMap(preset => preset.eventTypes || []))];
}

export function getQuickViewPresetRows(selectedEventTypes = [], presetId = '', rows = getAnalysisRows()) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const eventTypesCacheKey = getEventTypesCacheKey(selectedEventTypes);

  if (!eventTypesCacheKey) {
    return EMPTY_ROWS;
  }

  const cacheKey = `${eventTypesCacheKey}::${getPresetIdsCacheKey(presetId)}`;
  if (cache.presetRows.has(cacheKey)) {
    return cache.presetRows.get(cacheKey) || EMPTY_ROWS;
  }

  const baseRows = getRowsScopedToEventTypes(resolvedRows, selectedEventTypes);
  const presets = getQuickViewPresetDefinitionsByIds(presetId, resolvedRows);

  if (presets.length === 0 || presets.some(preset => preset.kind === 'static')) {
    cache.presetRows.set(cacheKey, baseRows);
    return baseRows;
  }

  const calendarYearPresets = presets.filter(preset => preset.kind === 'calendar-year');

  if (calendarYearPresets.length > 0) {
    const scopedRows = baseRows.filter(row => {
      return calendarYearPresets.some(preset => row.Date >= preset.startDate && row.Date <= preset.endDate);
    });
    cache.presetRows.set(cacheKey, scopedRows);
    return scopedRows;
  }

  const setWindowPresets = presets.filter(preset => preset.kind === 'set-window');

  if (setWindowPresets.length > 0) {
    const scopedRows = baseRows.filter(row => {
      return setWindowPresets.some(preset => {
        return row.Date >= preset.releaseDate && (!preset.nextReleaseDate || row.Date < preset.nextReleaseDate);
      });
    });
    cache.presetRows.set(cacheKey, scopedRows);
    return scopedRows;
  }

  cache.presetRows.set(cacheKey, baseRows);
  return baseRows;
}

export function getQuickViewPresetSuggestedRange({ selectedEventTypes = [], presetId = '', rows = getAnalysisRows() } = {}) {
  const resolvedRows = getResolvedRows(rows);
  const cache = getQuickViewRowsCache(resolvedRows);
  const cacheKey = `${getEventTypesCacheKey(selectedEventTypes)}::${getPresetIdsCacheKey(presetId)}`;

  if (!cache.suggestedRanges.has(cacheKey)) {
    cache.suggestedRanges.set(
      cacheKey,
      buildSuggestedRange(getQuickViewPresetRows(selectedEventTypes, presetId, resolvedRows))
    );
  }

  return cache.suggestedRanges.get(cacheKey) || {
    startDate: '',
    endDate: '',
    dateCount: 0
  };
}
