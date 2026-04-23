// Manages quick-view preset buttons and preset-driven date/type selection for multi-event and player views.
import {
  getDefaultQuickViewYear,
  getLatestSetQuickViewPresetId,
  getQuickViewPresetDefinitionById,
  getQuickViewPresetYearOptions,
  normalizeQuickViewPresetIds,
  getSetQuickViewPresetDefinitions,
  getStaticQuickViewPresetDefinitions,
  shiftDateByDays
} from '../../utils/quick-view-presets.js';
import {
  getPlayerAnalysisActivePreset,
  getPlayerAnalysisActivePresetIds,
  getPlayerPresetEventTypes,
  getPlayerPresetRows,
  getPlayerPresetSuggestedRange
} from '../../utils/player-analysis-presets.js';
import {
  getMultiEventPresetEventTypes,
  getMultiEventPresetRows,
  getMultiEventPresetSuggestedRange
} from '../../utils/multi-event-presets.js';
import { getAnalysisRows } from '../../utils/analysis-data.js';
import { filterState } from './state.js';
import { filterRuntime } from './runtime.js';
import {
  getTopMode,
  getAnalysisMode,
  getEventAnalysisSection,
  getPlayerAnalysisSection,
  getEventAnalysisSelectedTypes,
  getPlayerAnalysisSelectedTypes,
  setSectionEventType
} from './shared.js';

// Returns the multi-event quick-view chip container.
export function getMultiEventQuickViewRoot() {
  return document.getElementById('multiEventQuickViewButtons');
}

// Returns the Player Analysis quick-view chip container.
export function getPlayerQuickViewRoot() {
  return document.getElementById('playerQuickViewButtons');
}

function getQuickViewRoot(scope) {
  return scope === 'multi' ? getMultiEventQuickViewRoot() : getPlayerQuickViewRoot();
}

function getActiveQuickViewYear(scope) {
  return scope === 'multi' ? filterState.activeMultiEventQuickViewYear : filterState.activePlayerQuickViewYear;
}

function setActiveQuickViewYear(scope, year) {
  if (scope === 'multi') {
    filterState.activeMultiEventQuickViewYear = year;
  } else {
    filterState.activePlayerQuickViewYear = year;
  }
}

function getQuickViewButtonClass(scope) {
  return scope === 'multi' ? 'multi-event-preset-button' : 'player-preset-button';
}

function getQuickViewDatasetKey(scope) {
  return scope === 'multi' ? 'multiEventPreset' : 'playerPreset';
}

function createQuickViewButton(preset, buttonClass, datasetKey) {
  // Button titles expose the exact date window for maintainers/users without
  // crowding the compact chip labels.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bubble-button ${buttonClass}`;
  button.dataset[datasetKey] = preset.id;
  button.textContent = preset.buttonLabel || preset.label;

  if (preset.kind === 'set-window') {
    const displayEndDate = preset.nextReleaseDate ? shiftDateByDays(preset.nextReleaseDate, -1) : 'Present';
    button.title = `${preset.label}: ${preset.releaseDate} to ${displayEndDate}`;
  } else if (preset.kind === 'calendar-year') {
    button.title = `${preset.label}: ${preset.startDate} to ${preset.endDate}`;
  } else {
    button.title = preset.label;
  }

  return button;
}

function createQuickViewYearButton(year, scope, isActive) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bubble-button quick-view-year-button${isActive ? ' active' : ''}`;
  button.dataset.quickViewYear = year;
  button.dataset.quickViewScope = scope;
  button.textContent = year;
  return button;
}

function getActiveQuickViewPresetIds(scope, activePresetValue = '') {
  if (scope === 'player') {
    return normalizeQuickViewPresetIds(activePresetValue || getPlayerAnalysisActivePreset());
  }

  return normalizeQuickViewPresetIds(activePresetValue);
}

function getResolvedQuickViewYear(scope, activePresetIds = []) {
  // Prefer the user's current year tab, then the active preset's year, then the
  // newest available year. This keeps set-window chips stable after rerenders.
  const analysisRows = getAnalysisRows();
  const yearOptions = getQuickViewPresetYearOptions(analysisRows);
  if (yearOptions.length === 0) {
    return '';
  }

  const resolvedPresetIds = Array.isArray(activePresetIds)
    ? activePresetIds
    : getActiveQuickViewPresetIds(scope, activePresetIds);
  const activePreset = resolvedPresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true }))
    .find(Boolean);
  const presetYear = activePreset?.releaseYear || '';
  const currentYear = getActiveQuickViewYear(scope) || getDefaultQuickViewYear(analysisRows);

  if (currentYear && yearOptions.includes(currentYear)) {
    return currentYear;
  }

  if (presetYear && yearOptions.includes(presetYear)) {
    return presetYear;
  }

  return yearOptions[0];
}

// Rebuilds quick-view chips for either multi-event or player scope.
export function renderQuickViewButtons(scope) {
  const container = getQuickViewRoot(scope);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const analysisRows = getAnalysisRows();
  const activePresetValue = container.dataset.activePreset || '';
  const activePresetIds = getActiveQuickViewPresetIds(scope, activePresetValue);
  const activePresets = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true }))
    .filter(Boolean);
  const buttonClass = getQuickViewButtonClass(scope);
  const datasetKey = getQuickViewDatasetKey(scope);
  const staticPresets = getStaticQuickViewPresetDefinitions();
  const setPresetDefinitions = getSetQuickViewPresetDefinitions(analysisRows);
  const yearOptions = getQuickViewPresetYearOptions(analysisRows);
  const resolvedYear = getResolvedQuickViewYear(scope, activePresetIds);
  const yearPresets = setPresetDefinitions.filter(preset => preset.releaseYear === resolvedYear);
  const hasAllPeriodPreset = activePresets.some(preset => preset.kind === 'static');
  const activeCalendarYearPresets = activePresets.filter(preset => preset.kind === 'calendar-year');
  const activeSetWindowPresets = activePresets.filter(preset => preset.kind === 'set-window');
  const highlightedYears = new Set();
  const highlightedSetWindowIds = new Set();

  // Calendar-year presets highlight every set chip in that year. A specific set
  // preset highlights only its own chip and parent year.
  if (!hasAllPeriodPreset) {
    if (activeCalendarYearPresets.length > 0) {
      activeCalendarYearPresets.forEach(preset => {
        if (preset.releaseYear) {
          highlightedYears.add(preset.releaseYear);
          setPresetDefinitions.forEach(setPreset => {
            if (setPreset.releaseYear === preset.releaseYear) {
              highlightedSetWindowIds.add(setPreset.id);
            }
          });
        }
      });
    } else {
      activeSetWindowPresets.forEach(preset => {
        if (preset.releaseYear) {
          highlightedYears.add(preset.releaseYear);
        }
        highlightedSetWindowIds.add(preset.id);
      });
    }
  }

  setActiveQuickViewYear(scope, resolvedYear);

  if (staticPresets.length > 0) {
    const staticRow = document.createElement('div');
    staticRow.className = 'bubble-menu quick-view-static-list';

    staticPresets.forEach(preset => {
      const button = createQuickViewButton(preset, buttonClass, datasetKey);
      button.classList.toggle('active', activePresetIds.includes(preset.id));
      staticRow.appendChild(button);
    });

    container.appendChild(staticRow);
  }

  if (yearOptions.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'quick-view-divider';

    const dividerLineBefore = document.createElement('span');
    dividerLineBefore.className = 'quick-view-divider-line';
    divider.appendChild(dividerLineBefore);

    const dividerLabel = document.createElement('span');
    dividerLabel.className = 'quick-view-divider-label';
    dividerLabel.textContent = 'Specific Sets';
    divider.appendChild(dividerLabel);

    const dividerLineAfter = document.createElement('span');
    dividerLineAfter.className = 'quick-view-divider-line';
    divider.appendChild(dividerLineAfter);

    container.appendChild(divider);

    const setHelper = document.createElement('div');
    setHelper.className = 'quick-view-set-helper';
    setHelper.textContent = 'Choose a set year, then select the set windows below.';
    container.appendChild(setHelper);

    const yearSection = document.createElement('div');
    yearSection.className = 'quick-view-year-section';

    const yearLabel = document.createElement('div');
    yearLabel.className = 'event-calendar-summary-label';
    yearLabel.textContent = 'Choose Set Year';
    yearSection.appendChild(yearLabel);

    const yearRow = document.createElement('div');
    yearRow.className = 'bubble-menu quick-view-year-list';
    yearOptions.forEach(year => {
      yearRow.appendChild(createQuickViewYearButton(year, scope, highlightedYears.has(year)));
    });

    yearSection.appendChild(yearRow);
    container.appendChild(yearSection);
  }

  const setSection = document.createElement('div');
  setSection.className = 'quick-view-set-section';

  if (resolvedYear) {
    const setLabel = document.createElement('div');
    setLabel.className = 'event-calendar-summary-label';
    setLabel.textContent = `${resolvedYear} Set Windows`;
    setSection.appendChild(setLabel);
  }

  const setRow = document.createElement('div');
  setRow.className = 'bubble-menu quick-view-set-list';

  yearPresets.forEach(preset => {
    const button = createQuickViewButton(preset, buttonClass, datasetKey);
    button.classList.toggle('active', highlightedSetWindowIds.has(preset.id));
    setRow.appendChild(button);
  });

  if (yearPresets.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'quick-view-empty';
    emptyState.textContent = 'No set windows available.';
    setRow.appendChild(emptyState);
  }

  setSection.appendChild(setRow);
  container.appendChild(setSection);
}

// Reads the active multi-event preset id from the quick-view container.
export function getActiveMultiEventPreset() {
  return getMultiEventQuickViewRoot()?.dataset.activePreset
    || Array.from(document.querySelectorAll('.multi-event-preset-button.active'))
      .map(button => button.dataset.multiEventPreset)
      .filter(Boolean)
      .join(',')
    || '';
}

// Reads active multi-event preset ids as a normalized list.
export function getActiveMultiEventPresetIds() {
  return normalizeQuickViewPresetIds(getActiveMultiEventPreset());
}

// Writes active state to the multi-event preset buttons and container dataset.
export function setMultiEventPresetButtonState(activePresetId = '') {
  const root = getMultiEventQuickViewRoot();
  const activePresetIds = normalizeQuickViewPresetIds(activePresetId);
  const serializedPresetIds = activePresetIds.join(',');

  if (root) {
    root.dataset.activePreset = serializedPresetIds;
  }

  const preset = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, getAnalysisRows(), { includeFuture: true }))
    .find(candidate => candidate?.releaseYear);
  if (preset?.releaseYear) {
    setActiveQuickViewYear('multi', preset.releaseYear);
  }

  renderQuickViewButtons('multi');
}

// Clears the active multi-event preset state after a manual date/type change.
export function clearMultiEventPresetButtonState() {
  setMultiEventPresetButtonState('');
}

// Returns the default set-window quick-view preset for current analysis rows.
export function getDefaultSetQuickViewPresetId() {
  return getLatestSetQuickViewPresetId(getAnalysisRows());
}

// Ensures multi-event controls have a preset before first render.
export function ensureDefaultMultiEventPreset() {
  const activePresetId = getActiveMultiEventPreset();
  if (activePresetId) {
    return activePresetId;
  }

  const defaultPresetId = getDefaultSetQuickViewPresetId();
  setMultiEventPresetButtonState(defaultPresetId);
  return defaultPresetId;
}

// Updates the selected quick-view year tab for a scope.
export function setQuickViewYearSelection(scope, year) {
  setActiveQuickViewYear(scope, year);
  renderQuickViewButtons(scope);
}

// Applies event-type button state in the Event Analysis section.
export function setEventAnalysisEventTypes(nextTypes = []) {
  const requestedType = Array.isArray(nextTypes) ? nextTypes[0] : nextTypes;
  setSectionEventType(getEventAnalysisSection(), requestedType || 'online');
}

// Returns rows scoped to Event Analysis event types and active preset.
export function getScopedMultiEventRows(selectedEventTypes = getEventAnalysisSelectedTypes()) {
  return getMultiEventPresetRows(selectedEventTypes, getActiveMultiEventPreset());
}

// Applies the active multi-event preset's suggested date range to date controls.
export function applyActiveMultiEventPresetDateRange() {
  const activePreset = getActiveMultiEventPreset();
  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');

  if (!activePreset || !startDateSelect || !endDateSelect) {
    return false;
  }

  const range = getMultiEventPresetSuggestedRange({
    selectedEventTypes: getEventAnalysisSelectedTypes(),
    presetId: activePreset
  });

  if (!range.startDate || !range.endDate) {
    startDateSelect.value = '';
    endDateSelect.value = '';
    filterRuntime.updateDateOptions();
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  filterRuntime.updateDateOptions();
  return true;
}

// Applies one multi-event preset, including event types, dates, button state, and
// chart refresh.
export function applyMultiEventPreset(presetId) {
  const analysisRows = getAnalysisRows();
  const preset = getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true });
  const presetEventTypes = getMultiEventPresetEventTypes(presetId);
  if (presetEventTypes) {
    const nextType = resolvePresetEventTypeSelection(getEventAnalysisSelectedTypes(), presetEventTypes);
    setEventAnalysisEventTypes([nextType]);
  }

  if (!preset) {
    return;
  }

  const fallbackPresetId = getStaticQuickViewPresetDefinitions()[0]?.id || '';
  let nextPresetIds = [];

  if (preset.kind !== 'set-window') {
    nextPresetIds = [preset.id];
  } else {
    const activeSetWindowIds = getActiveMultiEventPresetIds().filter(activePresetId => {
      const activePreset = getQuickViewPresetDefinitionById(activePresetId, analysisRows, { includeFuture: true });
      return activePreset?.kind === 'set-window' && activePreset.releaseYear === preset.releaseYear;
    });
    const nextPresetIdSet = new Set(activeSetWindowIds);

    if (nextPresetIdSet.has(preset.id)) {
      nextPresetIdSet.delete(preset.id);
    } else {
      nextPresetIdSet.add(preset.id);
    }

    nextPresetIds = Array.from(nextPresetIdSet);
    if (nextPresetIds.length === 0 && fallbackPresetId) {
      nextPresetIds = [fallbackPresetId];
    }
  }

  setMultiEventPresetButtonState(nextPresetIds);
  filterRuntime.resetMultiDateRange();
  filterRuntime.updateDateOptions();
  applyActiveMultiEventPresetDateRange();

  if (getTopMode() === 'event' && getAnalysisMode() === 'multi') {
    filterRuntime.updateAllCharts();
  }
}

// Writes active state to the Player Analysis preset buttons and container
// dataset.
export function setPlayerPresetButtonState(activePresetId = '') {
  const root = getPlayerQuickViewRoot();
  const activePresetIds = normalizeQuickViewPresetIds(activePresetId);
  const serializedPresetIds = activePresetIds.join(',');

  if (root) {
    root.dataset.activePreset = serializedPresetIds;
  }

  const preset = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, getAnalysisRows(), { includeFuture: true }))
    .find(candidate => candidate?.releaseYear);
  if (preset?.releaseYear) {
    setActiveQuickViewYear('player', preset.releaseYear);
  }

  renderQuickViewButtons('player');
}

// Clears the active Player Analysis preset after a manual date/type change.
export function clearPlayerPresetButtonState() {
  setPlayerPresetButtonState('');
}

// Ensures Player Analysis controls have a preset before first render.
export function ensureDefaultPlayerPreset() {
  const activePresetId = getPlayerAnalysisActivePreset();
  if (activePresetId) {
    return activePresetId;
  }

  const defaultPresetId = getDefaultSetQuickViewPresetId();
  setPlayerPresetButtonState(defaultPresetId);
  return defaultPresetId;
}

// Applies event-type button state in the Player Analysis section.
export function setPlayerAnalysisEventTypes(nextTypes = []) {
  const requestedType = Array.isArray(nextTypes) ? nextTypes[0] : nextTypes;
  setSectionEventType(getPlayerAnalysisSection(), requestedType || 'online');
}

function resolvePresetEventTypeSelection(currentTypes = [], presetEventTypes = [], defaultType = 'online') {
  const normalizedCurrentType = currentTypes.map(type => String(type || '').toLowerCase()).find(Boolean) || '';
  const normalizedPresetTypes = (Array.isArray(presetEventTypes) ? presetEventTypes : [presetEventTypes])
    .map(type => String(type || '').toLowerCase())
    .filter(Boolean);

  if (normalizedPresetTypes.length === 0) {
    return normalizedCurrentType || defaultType;
  }

  if (normalizedCurrentType && normalizedPresetTypes.includes(normalizedCurrentType)) {
    return normalizedCurrentType;
  }

  return normalizedPresetTypes[0] || defaultType;
}

// Returns rows scoped to Player Analysis event types and active preset.
export function getScopedPlayerAnalysisRows(selectedEventTypes = getPlayerAnalysisSelectedTypes()) {
  return getPlayerPresetRows(selectedEventTypes, getPlayerAnalysisActivePreset());
}

// Applies the active Player Analysis preset's suggested date range to controls.
export function applyActivePlayerPresetDateRange() {
  const activePreset = getPlayerAnalysisActivePreset();
  const playerFilterMenu = document.getElementById('playerFilterMenu');
  const startDateSelect = document.getElementById('playerStartDateSelect');
  const endDateSelect = document.getElementById('playerEndDateSelect');

  if (!activePreset || !playerFilterMenu || !startDateSelect || !endDateSelect) {
    return false;
  }

  const range = getPlayerPresetSuggestedRange({
    selectedEventTypes: getPlayerAnalysisSelectedTypes(),
    presetId: activePreset,
    playerKey: playerFilterMenu.value
  });

  if (!range.startDate || !range.endDate) {
    startDateSelect.value = '';
    endDateSelect.value = '';
    filterRuntime.updatePlayerDateOptions();
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  filterRuntime.updatePlayerDateOptions();
  return true;
}

// Applies one Player Analysis preset, including event types, dates, player menu
// refresh, and chart refresh.
export function applyPlayerAnalysisPreset(presetId) {
  const analysisRows = getAnalysisRows();
  const preset = getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true });
  const presetEventTypes = getPlayerPresetEventTypes(presetId);
  if (presetEventTypes) {
    const nextType = resolvePresetEventTypeSelection(getPlayerAnalysisSelectedTypes(), presetEventTypes);
    setPlayerAnalysisEventTypes([nextType]);
  }

  if (!preset) {
    return;
  }

  const fallbackPresetId = getStaticQuickViewPresetDefinitions()[0]?.id || '';
  let nextPresetIds = [];

  if (preset.kind !== 'set-window') {
    nextPresetIds = [preset.id];
  } else {
    const activeSetWindowIds = getPlayerAnalysisActivePresetIds().filter(activePresetId => {
      const activePreset = getQuickViewPresetDefinitionById(activePresetId, analysisRows, { includeFuture: true });
      return activePreset?.kind === 'set-window' && activePreset.releaseYear === preset.releaseYear;
    });
    const nextPresetIdSet = new Set(activeSetWindowIds);

    if (nextPresetIdSet.has(preset.id)) {
      nextPresetIdSet.delete(preset.id);
    } else {
      nextPresetIdSet.add(preset.id);
    }

    nextPresetIds = Array.from(nextPresetIdSet);
    if (nextPresetIds.length === 0 && fallbackPresetId) {
      nextPresetIds = [fallbackPresetId];
    }
  }

  setPlayerPresetButtonState(nextPresetIds);
  filterRuntime.resetPlayerDateRange();
  filterRuntime.updatePlayerDateOptions();
  applyActivePlayerPresetDateRange();

  if (getTopMode() === 'player') {
    filterRuntime.updateAllCharts();
  }
}
