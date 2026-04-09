import { getAnalysisRows } from './analysis-data.js';
import { setReleaseWindows } from '../config/set-release-windows.js';

const STATIC_QUICK_VIEW_PRESETS = [
  {
    id: 'all-period',
    label: 'All Period',
    buttonLabel: 'All Period',
    kind: 'static',
    eventTypes: ['online', 'offline']
  }
];

function getLatestRowDate(rows = getAnalysisRows()) {
  return rows.reduce((latestDate, row) => {
    return row.Date > latestDate ? row.Date : latestDate;
  }, '');
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
  return [...STATIC_QUICK_VIEW_PRESETS];
}

export function getSetQuickViewPresetDefinitions(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  return buildSetWindowPresets(rows, { includeFuture }).reverse();
}

export function getQuickViewPresetDefinitions(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  return [...getStaticQuickViewPresetDefinitions(), ...getSetQuickViewPresetDefinitions(rows, { includeFuture })];
}

export function getQuickViewPresetDefinitionById(presetId, rows = getAnalysisRows(), { includeFuture = true } = {}) {
  return getQuickViewPresetDefinitions(rows, { includeFuture }).find(preset => preset.id === presetId) || null;
}

export function getQuickViewPresetDefinitionsByIds(presetIds = [], rows = getAnalysisRows(), { includeFuture = true } = {}) {
  const presetsById = new Map(
    getQuickViewPresetDefinitions(rows, { includeFuture }).map(preset => [preset.id, preset])
  );

  return normalizeQuickViewPresetIds(presetIds)
    .map(presetId => presetsById.get(presetId))
    .filter(Boolean);
}

export function getQuickViewPresetYearOptions(rows = getAnalysisRows(), { includeFuture = false } = {}) {
  return [...new Set(getSetQuickViewPresetDefinitions(rows, { includeFuture }).map(preset => preset.releaseYear))]
    .sort((a, b) => Number(b) - Number(a));
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
  return getSetQuickViewPresetDefinitions(rows, { includeFuture })[0]?.id || 'all-period';
}

export function getQuickViewPresetEventTypes(presetId, rows = getAnalysisRows()) {
  const presets = getQuickViewPresetDefinitionsByIds(presetId, rows);
  if (presets.length === 0) {
    return null;
  }

  return [...new Set(presets.flatMap(preset => preset.eventTypes || []))];
}

export function getQuickViewPresetRows(selectedEventTypes = [], presetId = '', rows = getAnalysisRows()) {
  if (selectedEventTypes.length === 0) {
    return [];
  }

  const baseRows = rows.filter(row => selectedEventTypes.includes(String(row.EventType).toLowerCase()));
  const presets = getQuickViewPresetDefinitionsByIds(presetId, rows);

  if (presets.length === 0 || presets.some(preset => preset.kind === 'static')) {
    return baseRows;
  }

  const setWindowPresets = presets.filter(preset => preset.kind === 'set-window');

  if (setWindowPresets.length > 0) {
    return baseRows.filter(row => {
      return setWindowPresets.some(preset => {
        return row.Date >= preset.releaseDate && (!preset.nextReleaseDate || row.Date < preset.nextReleaseDate);
      });
    });
  }

  return baseRows;
}

export function getQuickViewPresetSuggestedRange({ selectedEventTypes = [], presetId = '', rows = getAnalysisRows() } = {}) {
  const scopedRows = getQuickViewPresetRows(selectedEventTypes, presetId, rows);
  const dates = [...new Set(scopedRows.map(row => row.Date))].sort((a, b) => new Date(a) - new Date(b));

  return {
    startDate: dates[0] || '',
    endDate: dates[dates.length - 1] || '',
    dateCount: dates.length
  };
}
