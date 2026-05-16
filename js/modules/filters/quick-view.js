// Manages quick-view preset buttons and preset-driven date/type selection for multi-event and player views.
import {
  getDefaultQuickViewYear,
  getQuickViewPresetAriaLabel,
  getQuickViewPresetDefinitionsByIds,
  getLatestSetQuickViewPresetId,
  getQuickViewPresetDefinitionById,
  getQuickViewPresetTooltipDateRange,
  getQuickViewPresetYearOptions,
  normalizeQuickViewPresetIds,
  getSetQuickViewPresetDefinitions,
  getStaticQuickViewPresetDefinitions,
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

function getMultiEventCurrentDateRange() {
  return {
    startDate: document.getElementById('startDateSelect')?.value || '',
    endDate: document.getElementById('endDateSelect')?.value || ''
  };
}

function setMultiEventRangeInputSource(source = 'filter') {
  filterState.activeMultiEventRangeInputSource = source === 'calendar' ? 'calendar' : 'filter';
}

function getMultiEventRangeInputSource() {
  return filterState.activeMultiEventRangeInputSource === 'calendar' ? 'calendar' : 'filter';
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

function createCustomRangeIndicator(scope, isActive) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bubble-button ${scope === 'multi' ? 'multi-event-custom-range-indicator' : 'player-custom-range-indicator'}${isActive ? ' active' : ''}`;
  button.textContent = 'Custom Range';
  button.disabled = true;
  button.setAttribute('aria-label', 'Custom range active');
  return button;
}

function createQuickViewButton(preset, buttonClass, datasetKey) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bubble-button ${buttonClass}`;
  button.dataset[datasetKey] = preset.id;
  button.textContent = preset.buttonLabel || preset.label;
  button.setAttribute('aria-label', preset.label);
  button.removeAttribute('data-tooltip');
  button.removeAttribute('title');

  return button;
}

function createSetWindowButton(preset, buttonClass, datasetKey) {
  const button = createQuickViewButton(preset, buttonClass, datasetKey);
  const tooltipDateRange = getQuickViewPresetTooltipDateRange(preset);

  button.classList.add('analysis-filter-tooltip');
  if (tooltipDateRange) {
    button.dataset.tooltip = tooltipDateRange;
    button.setAttribute('aria-label', getQuickViewPresetAriaLabel(preset));
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

function isExactMultiEventDateRangeMatch(startDate = '', endDate = '', range = {}) {
  return Boolean(startDate && endDate && range?.startDate && range?.endDate)
    && startDate === range.startDate
    && endDate === range.endDate;
}

function getDerivedMultiEventFilterUiState() {
  const analysisRows = getAnalysisRows();
  const selectedEventTypes = getEventAnalysisSelectedTypes();
  const { startDate, endDate } = getMultiEventCurrentDateRange();
  const emptyState = {
    presetIds: [],
    highlightedYears: new Set(),
    highlightedSetWindowIds: new Set(),
    customRangeActive: false
  };

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return emptyState;
  }

  const allPeriodRange = getMultiEventPresetSuggestedRange({
    selectedEventTypes,
    presetId: 'all-period'
  });
  if (isExactMultiEventDateRangeMatch(startDate, endDate, allPeriodRange)) {
    return {
      ...emptyState,
      presetIds: ['all-period']
    };
  }

  const exactCalendarYearPreset = getStaticQuickViewPresetDefinitions()
    .filter(preset => preset.kind === 'calendar-year')
    .find(preset => {
      const presetRange = getMultiEventPresetSuggestedRange({
        selectedEventTypes,
        presetId: preset.id
      });
      return isExactMultiEventDateRangeMatch(startDate, endDate, presetRange);
    });

  if (exactCalendarYearPreset?.releaseYear) {
    return {
      presetIds: [exactCalendarYearPreset.id],
      highlightedYears: new Set([exactCalendarYearPreset.releaseYear]),
      highlightedSetWindowIds: new Set(),
      customRangeActive: false
    };
  }

  const exactSetWindowIds = getSetQuickViewPresetDefinitions(analysisRows)
    .filter(preset => {
      const presetRange = getMultiEventPresetSuggestedRange({
        selectedEventTypes,
        presetId: preset.id
      });
      return isExactMultiEventDateRangeMatch(startDate, endDate, presetRange);
    })
    .map(preset => preset.id);

  if (exactSetWindowIds.length > 0) {
    const matchedPresets = getQuickViewPresetDefinitionsByIds(exactSetWindowIds, analysisRows, { includeFuture: true });
    const matchedYear = matchedPresets[0]?.releaseYear || '';

    return {
      presetIds: exactSetWindowIds,
      highlightedYears: matchedYear ? new Set([matchedYear]) : new Set(),
      highlightedSetWindowIds: new Set(exactSetWindowIds),
      customRangeActive: false
    };
  }

  return {
    ...emptyState,
    customRangeActive: true
  };
}

function getExplicitMultiEventFilterUiState(activePresetIds = []) {
  const analysisRows = getAnalysisRows();
  const activePresets = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true }))
    .filter(Boolean);
  const highlightedYears = new Set();
  const highlightedSetWindowIds = new Set();

  activePresets.forEach(preset => {
    if (preset.releaseYear) {
      highlightedYears.add(preset.releaseYear);
    }
    if (preset.kind === 'set-window') {
      highlightedSetWindowIds.add(preset.id);
    }
  });

  return {
    presetIds: activePresetIds,
    highlightedYears,
    highlightedSetWindowIds,
    customRangeActive: false
  };
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
  const explicitPresetValue = container.dataset.activePreset || '';
  const explicitPresetIds = getActiveQuickViewPresetIds(scope, explicitPresetValue);
  const uiState = scope === 'multi' && getMultiEventRangeInputSource() === 'calendar'
    ? getDerivedMultiEventFilterUiState()
    : scope === 'multi'
      ? getExplicitMultiEventFilterUiState(explicitPresetIds)
      : {
          presetIds: explicitPresetIds,
          highlightedYears: null,
          highlightedSetWindowIds: null,
          customRangeActive: false
        };
  const activePresetIds = uiState.presetIds;
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
  const highlightedYears = uiState.highlightedYears ? new Set(uiState.highlightedYears) : new Set();
  const highlightedSetWindowIds = uiState.highlightedSetWindowIds ? new Set(uiState.highlightedSetWindowIds) : new Set();

  // Calendar-year presets highlight every set chip in that year. A specific set
  // preset highlights only its own chip and parent year.
  if (scope !== 'multi' || getMultiEventRangeInputSource() !== 'calendar') {
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
  } else if (activePresetIds.length === 0 && resolvedYear) {
    highlightedYears.add(resolvedYear);
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

    if (scope === 'multi') {
      staticRow.appendChild(createCustomRangeIndicator(scope, Boolean(uiState.customRangeActive)));
    }

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
    const button = createSetWindowButton(preset, buttonClass, datasetKey);
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
  if (getMultiEventRangeInputSource() === 'calendar') {
    return getDerivedMultiEventFilterUiState().presetIds.join(',');
  }

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

  setMultiEventRangeInputSource('filter');

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
  const root = getMultiEventQuickViewRoot();
  if (root) {
    root.dataset.activePreset = '';
  }

  renderQuickViewButtons('multi');
}

export function setMultiEventQuickViewRangeInputSource(source = 'filter') {
  setMultiEventRangeInputSource(source);
}

// Returns the default set-window quick-view preset for current analysis rows.
export function getDefaultSetQuickViewPresetId() {
  return getLatestSetQuickViewPresetId(getAnalysisRows());
}

// Returns the default Player Analysis preset, preferring the current calendar
// year's existing "All YYYY" quick view when available.
export function getDefaultPlayerPresetId() {
  const analysisRows = getAnalysisRows();
  const defaultYear = getDefaultQuickViewYear(analysisRows);
  const calendarYearPresetId = defaultYear ? `all-${defaultYear}` : '';

  if (calendarYearPresetId && getQuickViewPresetDefinitionById(calendarYearPresetId, analysisRows, { includeFuture: true })) {
    return calendarYearPresetId;
  }

  return getDefaultSetQuickViewPresetId();
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
    filterRuntime.updateDateOptions({ syncCalendarView: true });
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  filterRuntime.updateDateOptions({ syncCalendarView: true });
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

  const defaultPresetId = getDefaultPlayerPresetId();
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
    filterRuntime.updatePlayerDateOptions({ syncCalendarView: true });
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  filterRuntime.updatePlayerDateOptions({ syncCalendarView: true });
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
