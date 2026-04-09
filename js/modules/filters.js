import { updateEventAnalytics, updateMultiEventAnalytics } from './event-analysis.js';
import { updatePlayerAnalytics } from './player-analysis.js';
import { updateLeaderboardAnalytics } from './leaderboards-analysis.js';
import { updateEventMetaWinRateChart } from '../charts/single-meta-win-rate.js';
import { updateMultiMetaWinRateChart } from '../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../charts/multi-player-win-rate.js';
import { updateEventFunnelChart } from '../charts/single-funnel.js';
import { updateDeckEvolutionChart } from '../charts/multi-deck-evolution.js';
import { updatePlayerDeckPerformanceChart } from '../charts/player-deck-performance.js';
import { updatePlayerWinRateChart } from '../charts/player-win-rate.js';
import { hideAboutSection } from './about.js';
import { buildPlayerEventHistoryHTML } from '../utils/data-cards.js';
import { triggerUpdateAnimation } from '../utils/dom.js';
import {
  getDefaultQuickViewYear,
  getLatestSetQuickViewPresetId,
  getQuickViewPresetDefinitionById,
  getQuickViewPresetYearOptions,
  normalizeQuickViewPresetIds,
  getSetQuickViewPresetDefinitions,
  getStaticQuickViewPresetDefinitions,
  shiftDateByDays
} from '../utils/quick-view-presets.js';
import { formatGroupDisplayLabel, getEventGroupInfo } from '../utils/event-groups.js';
import {
  renderEventFilterCalendar,
  resetEventFilterCalendarState,
  primeEventFilterCalendarSelection
} from './event-filter-calendar.js';
import { renderMultiEventDateRangeCalendar, renderPlayerDateRangeCalendar } from './date-range-calendar.js';
import {
  buildPlayerFilterOptions,
  getPlayerIdentityKey,
  rowMatchesPlayerKey
} from '../utils/player-names.js';
import {
  getPlayerAnalysisActivePreset,
  getPlayerAnalysisActivePresetIds,
  getPlayerPresetEventTypes,
  getPlayerPresetRows,
  getPlayerPresetSuggestedRange
} from '../utils/player-analysis-presets.js';
import {
  getMultiEventPresetEventTypes,
  getMultiEventPresetRows,
  getMultiEventPresetSuggestedRange
} from '../utils/multi-event-presets.js';
import { formatDate, formatEventName } from '../utils/format.js';
import {
  getAnalysisRows,
  isUnknownHeavyBelowTop32FilterEnabled,
  setUnknownHeavyBelowTop32FilterEnabled
} from '../utils/analysis-data.js';

let filteredData = [];
let lastSingleEventType = '';
let multiEventGroupSelectionInitialized = false;
let activeMultiEventGroupKeys = new Set();
let activeMultiEventQuickViewYear = '';
let activePlayerQuickViewYear = '';
let playerEventGroupSelectionInitialized = false;
let activePlayerEventGroupKeys = new Set();
let playerEventGroupSelectionContextKey = '';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTopMode() {
  return document.querySelector('.top-mode-button.active')?.dataset.topMode || 'event';
}

function getAnalysisMode() {
  return document.querySelector('.analysis-mode.active')?.dataset.mode || 'single';
}

function getAnalysisQualityToggleButtons() {
  return Array.from(document.querySelectorAll('[data-analysis-quality-toggle="unknown-heavy-below-top32"]'));
}

function syncAnalysisQualityToggleButtons() {
  const isEnabled = isUnknownHeavyBelowTop32FilterEnabled();

  getAnalysisQualityToggleButtons().forEach(button => {
    button.classList.toggle('active', isEnabled);
    button.setAttribute('aria-pressed', String(isEnabled));

    const stateElement = button.querySelector('[data-analysis-quality-state]');
    if (stateElement) {
      stateElement.textContent = isEnabled ? 'On' : 'Off';
    }
  });
}

function refreshAnalysisQualityToggleState() {
  const selectedSingleEvent = document.getElementById('eventFilterMenu')?.value || '';
  const selectedEventType = getSingleEventSelectedType();
  const activeMultiEventPreset = getActiveMultiEventPreset();
  const activePlayerPreset = getPlayerAnalysisActivePreset();

  syncAnalysisQualityToggleButtons();
  renderQuickViewButtons('multi');
  renderQuickViewButtons('player');
  updateEventFilter(selectedSingleEvent, Boolean(selectedSingleEvent));
  if (selectedEventType && !document.getElementById('eventFilterMenu')?.value) {
    const fallbackEvent = buildSingleEventCalendarEntries(selectedEventType)[0]?.name || '';
    if (fallbackEvent) {
      updateEventFilter(fallbackEvent, true);
    }
  }
  updateDateOptions();
  updatePlayerDateOptions();

  if (activeMultiEventPreset) {
    applyActiveMultiEventPresetDateRange();
  }

  if (activePlayerPreset) {
    applyActivePlayerPresetDateRange();
  }

  updateAllCharts();
}

function setupAnalysisQualityToggleListeners() {
  getAnalysisQualityToggleButtons().forEach(button => {
    if (button.dataset.listenerAdded === 'true') {
      return;
    }

    button.addEventListener('click', () => {
      setUnknownHeavyBelowTop32FilterEnabled(!isUnknownHeavyBelowTop32FilterEnabled());
      refreshAnalysisQualityToggleState();
    });

    button.dataset.listenerAdded = 'true';
  });

  syncAnalysisQualityToggleButtons();
}

function getEventAnalysisSection() {
  return document.getElementById('eventAnalysisSection');
}

function getPlayerAnalysisSection() {
  return document.getElementById('playerAnalysisSection');
}

function getSectionEventTypeButtons(sectionElement) {
  return Array.from(sectionElement?.querySelectorAll('.event-type-filter') || []);
}

function getActiveSectionEventTypes(sectionElement) {
  return getSectionEventTypeButtons(sectionElement)
    .filter(button => button.classList.contains('active'))
    .map(button => button.dataset.type.toLowerCase());
}

function setSectionEventType(sectionElement, nextType = 'online') {
  const buttons = getSectionEventTypeButtons(sectionElement);
  const normalizedRequestedType = String(nextType || '').toLowerCase();
  const hasRequestedType = buttons.some(button => button.dataset.type.toLowerCase() === normalizedRequestedType);
  const resolvedType = hasRequestedType
    ? normalizedRequestedType
    : buttons.find(button => button.dataset.type.toLowerCase() === 'online')?.dataset.type.toLowerCase()
      || buttons[0]?.dataset.type.toLowerCase()
      || '';

  buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.type.toLowerCase() === resolvedType);
  });
}

function setDefaultSectionEventType(sectionElement, defaultType = 'online') {
  setSectionEventType(sectionElement, defaultType);
}

function clearSectionEventTypes(sectionElement) {
  const buttons = getSectionEventTypeButtons(sectionElement);
  buttons.forEach(button => {
    button.classList.remove('active');
  });
}

function getSingleEventSelectedType() {
  return getActiveSectionEventTypes(getEventAnalysisSection())[0] || '';
}

function getEventAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getEventAnalysisSection());
}

function getMultiEventQuickViewRoot() {
  return document.getElementById('multiEventQuickViewButtons');
}

function getPlayerQuickViewRoot() {
  return document.getElementById('playerQuickViewButtons');
}

function getQuickViewRoot(scope) {
  return scope === 'multi' ? getMultiEventQuickViewRoot() : getPlayerQuickViewRoot();
}

function getActiveQuickViewYear(scope) {
  return scope === 'multi' ? activeMultiEventQuickViewYear : activePlayerQuickViewYear;
}

function setActiveQuickViewYear(scope, year) {
  if (scope === 'multi') {
    activeMultiEventQuickViewYear = year;
  } else {
    activePlayerQuickViewYear = year;
  }
}

function getQuickViewButtonClass(scope) {
  return scope === 'multi' ? 'multi-event-preset-button' : 'player-preset-button';
}

function getQuickViewDatasetKey(scope) {
  return scope === 'multi' ? 'multiEventPreset' : 'playerPreset';
}

function createQuickViewButton(preset, buttonClass, datasetKey) {
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

function renderQuickViewButtons(scope) {
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

function getActiveMultiEventPreset() {
  return getMultiEventQuickViewRoot()?.dataset.activePreset
    || Array.from(document.querySelectorAll('.multi-event-preset-button.active'))
      .map(button => button.dataset.multiEventPreset)
      .filter(Boolean)
      .join(',')
    || '';
}

function getActiveMultiEventPresetIds() {
  return normalizeQuickViewPresetIds(getActiveMultiEventPreset());
}

function setMultiEventPresetButtonState(activePresetId = '') {
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

function clearMultiEventPresetButtonState() {
  setMultiEventPresetButtonState('');
}

function getDefaultSetQuickViewPresetId() {
  return getLatestSetQuickViewPresetId(getAnalysisRows());
}

function ensureDefaultMultiEventPreset() {
  const activePresetId = getActiveMultiEventPreset();
  if (activePresetId) {
    return activePresetId;
  }

  const defaultPresetId = getDefaultSetQuickViewPresetId();
  setMultiEventPresetButtonState(defaultPresetId);
  return defaultPresetId;
}

function setQuickViewYearSelection(scope, year) {
  setActiveQuickViewYear(scope, year);
  renderQuickViewButtons(scope);
}

function setEventAnalysisEventTypes(nextTypes = []) {
  const requestedType = Array.isArray(nextTypes) ? nextTypes[0] : nextTypes;
  setSectionEventType(getEventAnalysisSection(), requestedType || 'online');
}

function getScopedMultiEventRows(selectedEventTypes = getEventAnalysisSelectedTypes()) {
  return getMultiEventPresetRows(selectedEventTypes, getActiveMultiEventPreset());
}

function applyActiveMultiEventPresetDateRange() {
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
    updateDateOptions();
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  updateDateOptions();
  return true;
}

function applyMultiEventPreset(presetId) {
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
  resetMultiDateRange();
  updateDateOptions();
  applyActiveMultiEventPresetDateRange();

  if (getTopMode() === 'event' && getAnalysisMode() === 'multi') {
    updateAllCharts();
  }
}

function getPlayerAnalysisSelectedTypes() {
  return getActiveSectionEventTypes(getPlayerAnalysisSection());
}

function syncPlayerEventGroupFilterDataset() {
  const panels = document.getElementById('playerSelectionPanels');
  if (!panels) {
    return;
  }

  panels.dataset.groupFilterInitialized = playerEventGroupSelectionInitialized ? 'true' : 'false';
  panels.dataset.activeGroupKeys = Array.from(activePlayerEventGroupKeys).join(',');
}

function resetPlayerEventGroupFilterState() {
  playerEventGroupSelectionInitialized = false;
  activePlayerEventGroupKeys = new Set();
  playerEventGroupSelectionContextKey = '';
  syncPlayerEventGroupFilterDataset();
}

function setPlayerPresetButtonState(activePresetId = '') {
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

function clearPlayerPresetButtonState() {
  setPlayerPresetButtonState('');
}

function ensureDefaultPlayerPreset() {
  const activePresetId = getPlayerAnalysisActivePreset();
  if (activePresetId) {
    return activePresetId;
  }

  const defaultPresetId = getDefaultSetQuickViewPresetId();
  setPlayerPresetButtonState(defaultPresetId);
  return defaultPresetId;
}

function setPlayerAnalysisEventTypes(nextTypes = []) {
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

function getScopedPlayerAnalysisRows(selectedEventTypes = getPlayerAnalysisSelectedTypes()) {
  return getPlayerPresetRows(selectedEventTypes, getPlayerAnalysisActivePreset());
}

function applyActivePlayerPresetDateRange() {
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
    updatePlayerDateOptions();
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  updatePlayerDateOptions();
  return true;
}

function applyPlayerAnalysisPreset(presetId) {
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
  resetPlayerDateRange();
  updatePlayerDateOptions();
  applyActivePlayerPresetDateRange();

  if (getTopMode() === 'player') {
    updateAllCharts();
  }
}

function getEventDate(eventName) {
  const match = eventName.match(/\((\d{4}-\d{2}-\d{2})\)$/);
  if (match) {
    return match[1];
  }

  return getAnalysisRows().find(row => row.Event === eventName)?.Date || '';
}

function buildSingleEventCalendarEntries(selectedEventType) {
  const entries = new Map();

  getAnalysisRows().forEach(row => {
    if (row.EventType.toLowerCase() !== selectedEventType || entries.has(row.Event)) {
      return;
    }

    const groupInfo = getEventGroupInfo(row.Event);

    entries.set(row.Event, {
      name: row.Event,
      date: row.Date || getEventDate(row.Event),
      groupKey: groupInfo.key,
      groupLabel: groupInfo.label,
      groupOrder: groupInfo.order,
      shortLabel: groupInfo.shortLabel
    });
  });

  return Array.from(entries.values()).sort((a, b) => {
    return b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
  });
}

function getLatestSingleEventEntry() {
  const entries = new Map();

  getAnalysisRows().forEach(row => {
    if (entries.has(row.Event)) {
      return;
    }

    entries.set(row.Event, {
      name: row.Event,
      date: row.Date || getEventDate(row.Event),
      eventType: row.EventType.toLowerCase()
    });
  });

  return Array.from(entries.values()).sort((a, b) => {
    return b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
  })[0] || null;
}

function populateEventFilterMenu(entries) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu) {
    return null;
  }

  eventFilterMenu.innerHTML = '';

  if (entries.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No events available';
    eventFilterMenu.appendChild(option);
    eventFilterMenu.value = '';
    return eventFilterMenu;
  }

  entries.forEach(entry => {
    const option = document.createElement('option');
    option.value = entry.name;
    option.textContent = entry.name;
    eventFilterMenu.appendChild(option);
  });

  return eventFilterMenu;
}

function setSelectedSingleEvent(eventName, dispatchChange = false) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu) {
    return;
  }

  const previousValue = eventFilterMenu.value;
  const hasOption = Array.from(eventFilterMenu.options).some(option => option.value === eventName);
  eventFilterMenu.value = hasOption ? eventName : '';

  if (dispatchChange && eventFilterMenu.value !== previousValue) {
    eventFilterMenu.dispatchEvent(new Event('change'));
  }
}

function setSingleEventType(eventType) {
  const buttons = getSectionEventTypeButtons(getEventAnalysisSection());
  buttons.forEach(button => {
    button.classList.toggle('active', button.dataset.type === eventType);
  });
}

function resetSelectValue(selectId) {
  const select = document.getElementById(selectId);
  if (select) {
    select.value = '';
  }
}

function resetMultiDateRange() {
  resetSelectValue('startDateSelect');
  resetSelectValue('endDateSelect');
  multiEventGroupSelectionInitialized = false;
  activeMultiEventGroupKeys = new Set();
}

function resetPlayerDateRange() {
  resetSelectValue('playerStartDateSelect');
  resetSelectValue('playerEndDateSelect');
  resetPlayerEventGroupFilterState();
}

function setPlayerFilterPlaceholder(playerFilterMenu, message) {
  if (!playerFilterMenu) {
    return;
  }

  playerFilterMenu.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = message;
  playerFilterMenu.appendChild(option);
  playerFilterMenu.value = '';
}

function populatePlayerFilterMenu(playerFilterMenu, playerOptions, selectedPlayerKey) {
  if (!playerFilterMenu) {
    return;
  }

  playerFilterMenu.innerHTML = '';

  playerOptions.forEach(playerOption => {
    const option = document.createElement('option');
    option.value = playerOption.key;
    option.textContent = playerOption.label;
    option.selected = playerOption.key === selectedPlayerKey;
    playerFilterMenu.appendChild(option);
  });

  playerFilterMenu.value = selectedPlayerKey;
}

function getLatestPlayerDefaultSelection(selectedEventTypes = ['online']) {
  const normalizedEventTypes =
    selectedEventTypes.length > 0 ? selectedEventTypes : ['online'];

  const latestWinner = getScopedPlayerAnalysisRows(normalizedEventTypes)
    .filter(row => {
      return Number(row.Rank) === 1;
    })
    .sort((a, b) => b.Date.localeCompare(a.Date) || a.Event.localeCompare(b.Event))[0];

  if (!latestWinner) {
    return {
      player: '',
      startDate: '',
      endDate: ''
    };
  }

  return {
    player: getPlayerIdentityKey(latestWinner.Player),
    startDate: latestWinner.Date,
    endDate: latestWinner.Date
  };
}

function getDefaultMultiEventRange(dates) {
  if (dates.length === 0) {
    return { startDate: '', endDate: '' };
  }

  return {
    startDate: dates[Math.max(0, dates.length - 2)],
    endDate: dates[dates.length - 1]
  };
}

function getMultiEventSelectionSummaryElements() {
  return {
    panels: document.getElementById('multiEventSelectionPanels'),
    summaryBox: document.getElementById('multiEventSelectionSummary'),
    listBox: document.getElementById('multiEventSelectionListBox'),
    content: document.getElementById('multiEventSelectionSummaryContent'),
    list: document.getElementById('multiEventSelectionList')
  };
}

function getPlayerSelectionSummaryElements() {
  return {
    panels: document.getElementById('playerSelectionPanels'),
    summaryBox: document.getElementById('playerSelectionSummary'),
    listBox: document.getElementById('playerEventHistoryBox'),
    content: document.getElementById('playerSelectionSummaryContent'),
    list: document.getElementById('playerEventsDetails')
  };
}

function buildMultiEventSelectionListHTML(entries = []) {
  if (!entries.length) {
    return '<div>No events selected</div>';
  }

  return entries
    .map(entry => {
      const formattedEventName = formatEventName(entry.name) || entry.name || 'Unknown Event';
      const dateLabel = entry.date ? formatDate(entry.date) : '--';
      const metaLabel = entry.groupShortLabel || entry.groupLabel || '--';

      return `
        <div
          class="player-event-history-item"
          aria-label="${escapeHtml(`${formattedEventName} on ${dateLabel} in ${metaLabel}`)}"
        >
          <span class="player-event-history-item-date">${escapeHtml(dateLabel)}</span>
          <span class="player-event-history-item-main">${escapeHtml(formattedEventName)}</span>
          <span class="player-event-history-item-meta">${escapeHtml(metaLabel)}</span>
        </div>
      `;
    })
    .join('');
}

function getBasePlayerAnalysisRows() {
  const startDate = document.getElementById('playerStartDateSelect')?.value || '';
  const endDate = document.getElementById('playerEndDateSelect')?.value || '';
  const selectedPlayer = document.getElementById('playerFilterMenu')?.value || '';
  const selectedEventTypes = getPlayerAnalysisSelectedTypes();
  const scopedRows = getScopedPlayerAnalysisRows(selectedEventTypes);

  if (!selectedPlayer || !startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  return scopedRows.filter(row => {
    return (
      row.Date >= startDate &&
      row.Date <= endDate &&
      rowMatchesPlayerKey(row, selectedPlayer) &&
      selectedEventTypes.includes(row.EventType.toLowerCase())
    );
  });
}

function getPlayerSelectedEventEntries(rows = getBasePlayerAnalysisRows()) {
  const events = new Map();

  rows.forEach(row => {
    const eventKey = `${row.Date || ''}::${row.Event || ''}`;
    if (events.has(eventKey)) {
      return;
    }

    const groupInfo = getEventGroupInfo(row.Event);
    events.set(eventKey, {
      name: row.Event,
      date: row.Date || getEventDate(row.Event),
      groupKey: groupInfo.key,
      groupLabel: groupInfo.label,
      groupOrder: groupInfo.order
    });
  });

  return Array.from(events.values()).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function getPlayerEventGroupSummaries(rows = getBasePlayerAnalysisRows()) {
  const groups = new Map();

  getPlayerSelectedEventEntries(rows).forEach(entry => {
    if (!groups.has(entry.groupKey)) {
      groups.set(entry.groupKey, {
        key: entry.groupKey,
        label: entry.groupLabel,
        order: entry.groupOrder,
        count: 0
      });
    }

    groups.get(entry.groupKey).count += 1;
  });

  return Array.from(groups.values()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function getPlayerEventGroupContextKey(rows = getBasePlayerAnalysisRows()) {
  const startDate = document.getElementById('playerStartDateSelect')?.value || '';
  const endDate = document.getElementById('playerEndDateSelect')?.value || '';
  const selectedPlayer = document.getElementById('playerFilterMenu')?.value || '';
  const selectedEventTypes = getPlayerAnalysisSelectedTypes().slice().sort().join(',');
  const activePreset = getPlayerAnalysisActivePreset();
  const eventKeys = getPlayerSelectedEventEntries(rows)
    .map(entry => `${entry.date || ''}::${entry.name || ''}`)
    .join('|');

  return [selectedPlayer, startDate, endDate, selectedEventTypes, activePreset, eventKeys].join('@@');
}

function syncPlayerEventGroupFilterState(groupSummaries, contextKey = '') {
  if (groupSummaries.length === 0) {
    resetPlayerEventGroupFilterState();
    return;
  }

  const availableKeys = new Set(groupSummaries.map(group => group.key));
  const hasContextChanged = Boolean(contextKey) && contextKey !== playerEventGroupSelectionContextKey;

  if (!playerEventGroupSelectionInitialized || hasContextChanged) {
    activePlayerEventGroupKeys = new Set(availableKeys);
    playerEventGroupSelectionInitialized = true;
    playerEventGroupSelectionContextKey = contextKey;
    syncPlayerEventGroupFilterDataset();
    return;
  }

  activePlayerEventGroupKeys = new Set(
    Array.from(activePlayerEventGroupKeys).filter(groupKey => availableKeys.has(groupKey))
  );
  playerEventGroupSelectionContextKey = contextKey || playerEventGroupSelectionContextKey;
  syncPlayerEventGroupFilterDataset();
}

function getFilteredPlayerAnalysisRows() {
  const baseRows = getBasePlayerAnalysisRows();
  if (baseRows.length === 0) {
    resetPlayerEventGroupFilterState();
    return [];
  }

  const groupSummaries = getPlayerEventGroupSummaries(baseRows);
  const contextKey = getPlayerEventGroupContextKey(baseRows);
  syncPlayerEventGroupFilterState(groupSummaries, contextKey);

  return baseRows.filter(row => activePlayerEventGroupKeys.has(getEventGroupInfo(row.Event).key));
}

function togglePlayerEventGroupFilter(groupKey) {
  const baseRows = getBasePlayerAnalysisRows();
  const groupSummaries = getPlayerEventGroupSummaries(baseRows);
  const contextKey = getPlayerEventGroupContextKey(baseRows);
  syncPlayerEventGroupFilterState(groupSummaries, contextKey);

  if (activePlayerEventGroupKeys.has(groupKey)) {
    activePlayerEventGroupKeys.delete(groupKey);
  } else {
    activePlayerEventGroupKeys.add(groupKey);
  }

  playerEventGroupSelectionInitialized = true;
  playerEventGroupSelectionContextKey = contextKey;
  syncPlayerEventGroupFilterDataset();
  updatePlayerSelectionSummary();
  updateAllCharts();
}

function updatePlayerSelectionSummary() {
  const { panels, summaryBox, listBox, content, list } = getPlayerSelectionSummaryElements();
  if (!panels || !summaryBox || !listBox || !content || !list) {
    return;
  }

  const shouldShow = getTopMode() === 'player';
  panels.style.display = shouldShow ? 'flex' : 'none';

  if (!shouldShow) {
    return;
  }

  const baseRows = getBasePlayerAnalysisRows();
  const groupSummaries = getPlayerEventGroupSummaries(baseRows);
  const contextKey = getPlayerEventGroupContextKey(baseRows);
  syncPlayerEventGroupFilterState(groupSummaries, contextKey);
  const filteredRows = getFilteredPlayerAnalysisRows();

  if (groupSummaries.length === 0) {
    content.innerHTML = 'No events selected';
    list.innerHTML = '<div>No events selected</div>';
    triggerUpdateAnimation('playerSelectionSummary');
    triggerUpdateAnimation('playerEventHistoryBox');
    return;
  }

  content.innerHTML = groupSummaries
    .map(group => {
      const isActive = activePlayerEventGroupKeys.has(group.key);
      const countLabel = formatGroupDisplayLabel(group.count === 1 ? group.label : `${group.label}s`);

      return `
        <button type="button" class="multi-event-group-card ${isActive ? 'active' : ''}" data-group-key="${group.key}">
          <span class="multi-event-group-card-count">${group.count}</span>
          <span class="multi-event-group-card-label">${countLabel}</span>
        </button>
      `;
    })
    .join('');

  content.querySelectorAll('.multi-event-group-card').forEach(button => {
    button.addEventListener('click', () => togglePlayerEventGroupFilter(button.dataset.groupKey));
  });

  if (!groupSummaries.some(group => activePlayerEventGroupKeys.has(group.key))) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-event-group-empty';
    emptyState.textContent = 'No events selected';
    content.appendChild(emptyState);
  }

  list.innerHTML = filteredRows.length > 0 ? buildPlayerEventHistoryHTML(filteredRows) : '<div>No events selected</div>';
  triggerUpdateAnimation('playerSelectionSummary');
  triggerUpdateAnimation('playerEventHistoryBox');
}

function getMultiEventSelectedEventEntries() {
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  const selectedEventTypes = getEventAnalysisSelectedTypes();

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  const events = new Map();

  getScopedMultiEventRows(selectedEventTypes).forEach(row => {
    if (
      row.Date >= startDate &&
      row.Date <= endDate &&
      !events.has(row.Event)
    ) {
      events.set(row.Event, row.Date || getEventDate(row.Event));
    }
  });

  return Array.from(events.entries())
    .map(([eventName, eventDate]) => {
      const groupInfo = getEventGroupInfo(eventName);
      return {
        name: eventName,
        date: eventDate,
        groupKey: groupInfo.key,
        groupLabel: groupInfo.label,
        groupShortLabel: groupInfo.shortLabel,
        groupOrder: groupInfo.order
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function getMultiEventGroupSummaries() {
  const groups = new Map();

  getMultiEventSelectedEventEntries().forEach(entry => {
    if (!groups.has(entry.groupKey)) {
      groups.set(entry.groupKey, {
        key: entry.groupKey,
        label: entry.groupLabel,
        order: entry.groupOrder,
        count: 0
      });
    }

    groups.get(entry.groupKey).count += 1;
  });

  return Array.from(groups.values()).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function syncMultiEventGroupFilterState(groupSummaries) {
  if (groupSummaries.length === 0) {
    multiEventGroupSelectionInitialized = false;
    activeMultiEventGroupKeys = new Set();
    return;
  }

  const availableKeys = new Set(groupSummaries.map(group => group.key));

  if (!multiEventGroupSelectionInitialized) {
    activeMultiEventGroupKeys = new Set(availableKeys);
    multiEventGroupSelectionInitialized = true;
    return;
  }

  activeMultiEventGroupKeys = new Set(
    Array.from(activeMultiEventGroupKeys).filter(groupKey => availableKeys.has(groupKey))
  );
}

function getFilteredMultiEventRows() {
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  const selectedEventTypes = getEventAnalysisSelectedTypes();
  const scopedRows = getScopedMultiEventRows(selectedEventTypes);

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  return scopedRows.filter(row => {
    return (
      row.Date >= startDate &&
      row.Date <= endDate &&
      activeMultiEventGroupKeys.has(getEventGroupInfo(row.Event).key)
    );
  });
}

function getFilteredMultiEventSelectedEventEntries() {
  return getMultiEventSelectedEventEntries().filter(entry => activeMultiEventGroupKeys.has(entry.groupKey));
}

function toggleMultiEventGroupFilter(groupKey) {
  clearMultiEventPresetButtonState();
  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  if (activeMultiEventGroupKeys.has(groupKey)) {
    activeMultiEventGroupKeys.delete(groupKey);
  } else {
    activeMultiEventGroupKeys.add(groupKey);
  }

  multiEventGroupSelectionInitialized = true;
  updateMultiEventSelectionSummary();
  updateAllCharts();
}

function updateMultiEventSelectionSummary() {
  const { panels, summaryBox, listBox, content, list } = getMultiEventSelectionSummaryElements();
  if (!panels || !summaryBox || !listBox || !content || !list) {
    return;
  }

  const shouldShow = getTopMode() === 'event' && getAnalysisMode() === 'multi';
  panels.style.display = shouldShow ? 'flex' : 'none';

  if (!shouldShow) {
    return;
  }

  const groupSummaries = getMultiEventGroupSummaries();
  syncMultiEventGroupFilterState(groupSummaries);

  if (groupSummaries.length === 0) {
    content.innerHTML = 'No events selected';
    list.innerHTML = 'No events selected';
    return;
  }

  content.innerHTML = groupSummaries
    .map(group => {
      const isActive = activeMultiEventGroupKeys.has(group.key);
      const countLabel = formatGroupDisplayLabel(group.count === 1 ? group.label : `${group.label}s`);

      return `
        <button type="button" class="multi-event-group-card ${isActive ? 'active' : ''}" data-group-key="${group.key}">
          <span class="multi-event-group-card-count">${group.count}</span>
          <span class="multi-event-group-card-label">${countLabel}</span>
        </button>
      `;
    })
    .join('');

  content.querySelectorAll('.multi-event-group-card').forEach(button => {
    button.addEventListener('click', () => toggleMultiEventGroupFilter(button.dataset.groupKey));
  });

  if (!groupSummaries.some(group => activeMultiEventGroupKeys.has(group.key))) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-event-group-empty';
    emptyState.textContent = 'No events selected';
    content.appendChild(emptyState);
  }

  const selectedEntries = getFilteredMultiEventSelectedEventEntries();
  list.innerHTML = buildMultiEventSelectionListHTML(selectedEntries);
}

function updateSingleEventFilterVisibility() {
  const eventTypeSection = document.getElementById('eventTypeFilterSection');
  const eventFilterSection = document.getElementById('eventFilterSection');
  const multiEventPresetSection = document.getElementById('multiEventPresetSection');
  const isSingleMode = getAnalysisMode() === 'single';

  if (eventTypeSection) {
    eventTypeSection.style.display = 'block';
  }

  if (eventFilterSection) {
    eventFilterSection.style.display = isSingleMode ? 'block' : 'none';
  }

  if (multiEventPresetSection) {
    multiEventPresetSection.style.display = isSingleMode ? 'none' : 'block';
  }

  updateMultiEventSelectionSummary();
}

function hasSelectedSingleEvent() {
  return Boolean(getSingleEventSelectedType() && document.getElementById('eventFilterMenu')?.value);
}

function applyLatestSingleEventSelection() {
  const latestEntry = getLatestSingleEventEntry();
  if (!latestEntry) {
    clearSectionEventTypes(getEventAnalysisSection());
    resetEventFilterCalendarState();
    setSelectedSingleEvent('', false);
    lastSingleEventType = '';
    updateSingleEventFilterVisibility();
    updateEventFilter();
    return;
  }

  setSingleEventType(latestEntry.eventType);
  resetEventFilterCalendarState();
  setSelectedSingleEvent('', false);
  lastSingleEventType = '';
  updateSingleEventFilterVisibility();
  updateEventFilter(latestEntry.name, true);
}

function setMultiEventDateSelection(type, value, options = {}) {
  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');
  const { clearPreset = false } = options;

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  if (clearPreset) {
    clearMultiEventPresetButtonState();
  }

  if (type === 'start') {
    startDateSelect.value = value;
  } else {
    endDateSelect.value = value;
  }

  updateDateOptions();
  updateAllCharts();
}

function setPlayerDateSelection(type, value, options = {}) {
  const startDateSelect = document.getElementById('playerStartDateSelect');
  const endDateSelect = document.getElementById('playerEndDateSelect');
  const { clearPreset = false } = options;

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  if (clearPreset) {
    clearPlayerPresetButtonState();
  }

  if (type === 'start') {
    startDateSelect.value = value;
  } else {
    endDateSelect.value = value;
  }

  updatePlayerDateOptions();
  updateAllCharts();
}

export function setupFilters() {
  console.log('Setting up filters...');

  const analysisRows = getAnalysisRows();
  setupAnalysisQualityToggleListeners();
  setActiveQuickViewYear('multi', getDefaultQuickViewYear(analysisRows));
  setActiveQuickViewYear('player', getDefaultQuickViewYear(analysisRows));
  renderQuickViewButtons('multi');
  renderQuickViewButtons('player');
  setDefaultSectionEventType(getPlayerAnalysisSection());
  setMultiEventPresetButtonState(getDefaultSetQuickViewPresetId());
  setPlayerPresetButtonState(getDefaultSetQuickViewPresetId());
  console.log(`Initial mode is ${getTopMode()}: Event Analysis loads the latest registered event by default`);

  applyLatestSingleEventSelection();

  const playerFilterMenu = document.getElementById('playerFilterMenu');
  if (playerFilterMenu) {
    playerFilterMenu.innerHTML = '';
    playerFilterMenu.value = '';
  }

  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');
  if (startDateSelect) {
    startDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
  }
  if (endDateSelect) {
    endDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
  }

  const playerStartDateSelect = document.getElementById('playerStartDateSelect');
  const playerEndDateSelect = document.getElementById('playerEndDateSelect');
  if (playerStartDateSelect) {
    playerStartDateSelect.innerHTML = '';
  }
  if (playerEndDateSelect) {
    playerEndDateSelect.innerHTML = '';
  }
  renderPlayerDateRangeCalendar({
    dates: [],
    startDate: '',
    endDate: ''
  });
  updatePlayerDateOptions();

  const activeAnalysisMode = getAnalysisMode();
  const singleEventStats = document.getElementById('singleEventStats');
  const multiEventStats = document.getElementById('multiEventStats');
  const singleEventCharts = document.getElementById('singleEventCharts');
  const multiEventCharts = document.getElementById('multiEventCharts');
  const eventFilterSection = document.getElementById('eventFilterSection');

  if (singleEventStats) {
    singleEventStats.style.display = activeAnalysisMode === 'single' ? 'grid' : 'none';
  }
  if (multiEventStats) {
    multiEventStats.style.display = activeAnalysisMode === 'multi' ? 'grid' : 'none';
  }
  if (singleEventCharts) {
    singleEventCharts.style.display = activeAnalysisMode === 'single' ? 'block' : 'none';
  }
  if (multiEventCharts) {
    multiEventCharts.style.display = activeAnalysisMode === 'multi' ? 'block' : 'none';
  }
  if (eventFilterSection) {
    eventFilterSection.style.display = 'none';
  }

  updateSingleEventFilterVisibility();
  updateMultiEventSelectionSummary();
  updateAllCharts();
}

export function updateAllCharts() {
  const activeTopMode = getTopMode();
  const activeAnalysisMode = getAnalysisMode();

  if (activeTopMode === 'event') {
    if (activeAnalysisMode === 'single') {
      const selectedEventType = getSingleEventSelectedType();
      const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';

      filteredData =
        selectedEventType && selectedEvent
          ? getAnalysisRows().filter(row => {
              return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
            })
          : [];

      updateEventMetaWinRateChart();
      updateEventFunnelChart();
      updateEventAnalytics();
    } else {
      const startDate = document.getElementById('startDateSelect')?.value || '';
      const endDate = document.getElementById('endDateSelect')?.value || '';
      const selectedEventTypes = getEventAnalysisSelectedTypes();

      filteredData = startDate && endDate && selectedEventTypes.length > 0 ? getFilteredMultiEventRows() : [];

      updateMultiMetaWinRateChart();
      updateMultiPlayerWinRateChart();
      updateDeckEvolutionChart();
      updateMultiEventAnalytics();
    }
  } else if (activeTopMode === 'player') {
    filteredData = getFilteredPlayerAnalysisRows();

    updatePlayerAnalytics();
    updatePlayerDeckPerformanceChart();
    updatePlayerWinRateChart();
  } else if (activeTopMode === 'leaderboard') {
    updateLeaderboardAnalytics();
  }

  updatePlayerSelectionSummary();
}

export function getFunnelChartData() {
  const selectedEventType = getSingleEventSelectedType();
  const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';
  const positionStart = parseInt(document.getElementById('positionStartSelect')?.value, 10) || 1;
  const positionEnd = parseInt(document.getElementById('positionEndSelect')?.value, 10) || Infinity;

  const filtered = getAnalysisRows().filter(row => {
    return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
  });

  return filtered.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

export function getMetaWinRateChartData() {
  const selectedEventType = getSingleEventSelectedType();
  const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';

  return getAnalysisRows().filter(row => {
    return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
  });
}

export function getMultiEventChartData() {
  return getFilteredMultiEventRows();
}

export function getDeckEvolutionChartData() {
  const positionStart = parseInt(document.getElementById('positionStartSelect')?.value, 10) || 1;
  const positionEnd = parseInt(document.getElementById('positionEndSelect')?.value, 10) || Infinity;
  const multiEventData = getMultiEventChartData();

  return multiEventData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

export function getPlayerDeckPerformanceChartData() {
  return getFilteredPlayerAnalysisRows().filter(row => row.Deck !== 'No Show');
}

export function getPlayerWinRateChartData() {
  return getPlayerDeckPerformanceChartData();
}

export function setupTopModeListeners() {
  const topModeButtons = document.querySelectorAll('.top-mode-button');
  const eventAnalysisSection = document.getElementById('eventAnalysisSection');
  const playerAnalysisSection = document.getElementById('playerAnalysisSection');
  const leaderboardsSection = document.getElementById('leaderboardsSection');
  const singleEventStats = document.getElementById('singleEventStats');
  const multiEventStats = document.getElementById('multiEventStats');
  const playerStats = document.getElementById('playerStats');
  const singleEventCharts = document.getElementById('singleEventCharts');
  const multiEventCharts = document.getElementById('multiEventCharts');
  const playerCharts = document.getElementById('playerCharts');

  topModeButtons.forEach(button => {
    button.addEventListener('click', () => {
      topModeButtons.forEach(modeButton => modeButton.classList.remove('active'));
      button.classList.add('active');

      const mode = button.dataset.topMode;
      console.log('Top mode changed to:', mode);

      hideAboutSection(mode);

      if (mode === 'event') {
        if (eventAnalysisSection) {
          eventAnalysisSection.style.display = 'block';
        }
        if (playerAnalysisSection) {
          playerAnalysisSection.style.display = 'none';
        }
        if (leaderboardsSection) {
          leaderboardsSection.style.display = 'none';
        }

        setDefaultSectionEventType(getEventAnalysisSection());
        console.log(
          "Event Analytics: Event type filters set to 'online'. Active types:",
          getEventAnalysisSelectedTypes()
        );

        const activeAnalysisMode = getAnalysisMode();
        if (activeAnalysisMode === 'single') {
          applyLatestSingleEventSelection();
        }

        if (singleEventStats) {
          singleEventStats.style.display = activeAnalysisMode === 'single' ? 'grid' : 'none';
        }
        if (multiEventStats) {
          multiEventStats.style.display = activeAnalysisMode === 'multi' ? 'grid' : 'none';
        }
        if (singleEventCharts) {
          singleEventCharts.style.display = activeAnalysisMode === 'single' ? 'block' : 'none';
        }
        if (multiEventCharts) {
          multiEventCharts.style.display = activeAnalysisMode === 'multi' ? 'block' : 'none';
        }

        updateSingleEventFilterVisibility();
        updateDateOptions();
        if (activeAnalysisMode === 'multi') {
          ensureDefaultMultiEventPreset();
          applyActiveMultiEventPresetDateRange();
        }
        updateMultiEventSelectionSummary();
        updateAllCharts();
      } else if (mode === 'player') {
        if (eventAnalysisSection) {
          eventAnalysisSection.style.display = 'none';
        }
        if (playerAnalysisSection) {
          playerAnalysisSection.style.display = 'block';
        }
        if (leaderboardsSection) {
          leaderboardsSection.style.display = 'none';
        }
        if (playerStats) {
          playerStats.style.display = 'grid';
        }
      if (playerCharts) {
          playerCharts.style.display = 'block';
        }

        setDefaultSectionEventType(getPlayerAnalysisSection());
        ensureDefaultPlayerPreset();
        console.log(
          "Player Analytics: Event type filters set to 'online'. Active types:",
          getPlayerAnalysisSelectedTypes()
        );

        resetPlayerDateRange();
        const playerFilterMenu = document.getElementById('playerFilterMenu');
        if (playerFilterMenu) {
          playerFilterMenu.value = '';
        }
        updatePlayerDateOptions();
        applyActivePlayerPresetDateRange();
        updatePlayerAnalytics();
      } else if (mode === 'leaderboard') {
        if (eventAnalysisSection) {
          eventAnalysisSection.style.display = 'none';
        }
        if (playerAnalysisSection) {
          playerAnalysisSection.style.display = 'none';
        }
        if (leaderboardsSection) {
          leaderboardsSection.style.display = 'block';
        }

        updateLeaderboardAnalytics();
      }
    });
  });
}

export function setupAnalysisModeListeners() {
  const analysisModeButtons = document.querySelectorAll('.analysis-mode');
  const singleEventStats = document.getElementById('singleEventStats');
  const multiEventStats = document.getElementById('multiEventStats');
  const singleEventCharts = document.getElementById('singleEventCharts');
  const multiEventCharts = document.getElementById('multiEventCharts');
  const eventFilterSection = document.getElementById('eventFilterSection');

  analysisModeButtons.forEach(button => {
    button.addEventListener('click', () => {
      analysisModeButtons.forEach(modeButton => modeButton.classList.remove('active'));
      button.classList.add('active');

      const mode = button.dataset.mode;
      console.log('Analysis mode changed to:', mode);

      if (singleEventStats) {
        singleEventStats.style.display = mode === 'single' ? 'grid' : 'none';
      }
      if (multiEventStats) {
        multiEventStats.style.display = mode === 'multi' ? 'grid' : 'none';
      }
      if (singleEventCharts) {
        singleEventCharts.style.display = mode === 'single' ? 'block' : 'none';
      }
      if (multiEventCharts) {
        multiEventCharts.style.display = mode === 'multi' ? 'block' : 'none';
      }
      if (eventFilterSection) {
        eventFilterSection.style.display = 'none';
      }

      if (mode === 'single') {
        applyLatestSingleEventSelection();
      } else {
        ensureDefaultMultiEventPreset();
        resetMultiDateRange();
      }

      updateSingleEventFilterVisibility();
      updateDateOptions();
      if (mode === 'multi') {
        applyActiveMultiEventPresetDateRange();
      }
      updatePlayerDateOptions();
      updateMultiEventSelectionSummary();
      updateAllCharts();
    });
  });
}

export function setupEventTypeListeners() {
  const eventAnalysisButtons = getSectionEventTypeButtons(getEventAnalysisSection());
  const playerAnalysisButtons = getSectionEventTypeButtons(getPlayerAnalysisSection());

  eventAnalysisButtons.forEach(button => {
    button.addEventListener('click', () => {
      setEventAnalysisEventTypes([button.dataset.type.toLowerCase()]);

      console.log(
        'After toggle - Event Analysis active Event Types:',
        getEventAnalysisSelectedTypes(),
        'Top Mode:',
        getTopMode(),
        'Analysis Mode:',
        getAnalysisMode()
      );

      if (getAnalysisMode() === 'single') {
        resetEventFilterCalendarState();
        setSelectedSingleEvent('', false);
        updateEventFilter();
      } else {
        resetMultiDateRange();
      }

      updateSingleEventFilterVisibility();
      updateDateOptions();
      if (getAnalysisMode() === 'multi' && getActiveMultiEventPreset()) {
        applyActiveMultiEventPresetDateRange();
      }
      updateMultiEventSelectionSummary();
      if (getAnalysisMode() !== 'single' || hasSelectedSingleEvent()) {
        updateAllCharts();
      }
    });
  });

  playerAnalysisButtons.forEach(button => {
    button.addEventListener('click', () => {
      setPlayerAnalysisEventTypes([button.dataset.type.toLowerCase()]);

      console.log(
        'After toggle - Player Analysis active Event Types:',
        getPlayerAnalysisSelectedTypes(),
        'Top Mode:',
        getTopMode()
      );

      resetPlayerDateRange();
      updatePlayerDateOptions();
      if (getPlayerAnalysisActivePreset()) {
        applyActivePlayerPresetDateRange();
      }

      if (getTopMode() === 'player') {
        updateAllCharts();
      }
    });
  });
}

export function setupEventFilterListeners() {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (eventFilterMenu) {
    eventFilterMenu.addEventListener('change', updateAllCharts);
  }
}

export function setupPlayerFilterListeners() {
  const playerFilterMenu = document.getElementById('playerFilterMenu');
  const playerStartDateSelect = document.getElementById('playerStartDateSelect');
  const playerEndDateSelect = document.getElementById('playerEndDateSelect');
  const playerQuickViewRoot = getPlayerQuickViewRoot();

  if (playerFilterMenu) {
    playerFilterMenu.addEventListener('change', () => {
      updatePlayerDateOptions();
      applyActivePlayerPresetDateRange();
      updatePlayerAnalytics();
    });
  }

  if (playerStartDateSelect) {
    playerStartDateSelect.addEventListener('change', () => {
      clearPlayerPresetButtonState();
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }

  if (playerEndDateSelect) {
    playerEndDateSelect.addEventListener('change', () => {
      clearPlayerPresetButtonState();
      updatePlayerDateOptions();
      updatePlayerAnalytics();
    });
  }

  if (playerQuickViewRoot) {
    playerQuickViewRoot.addEventListener('click', event => {
      const yearButton = event.target.closest('.quick-view-year-button');
      if (yearButton) {
        setQuickViewYearSelection('player', yearButton.dataset.quickViewYear || '');
        return;
      }

      const presetButton = event.target.closest('.player-preset-button');
      if (presetButton) {
        applyPlayerAnalysisPreset(presetButton.dataset.playerPreset);
      }
    });
  }
}

export function setupMultiEventPresetListeners() {
  const multiEventQuickViewRoot = getMultiEventQuickViewRoot();
  if (!multiEventQuickViewRoot) {
    return;
  }

  multiEventQuickViewRoot.addEventListener('click', event => {
    const yearButton = event.target.closest('.quick-view-year-button');
    if (yearButton) {
      setQuickViewYearSelection('multi', yearButton.dataset.quickViewYear || '');
      return;
    }

    const presetButton = event.target.closest('.multi-event-preset-button');
    if (presetButton) {
      applyMultiEventPreset(presetButton.dataset.multiEventPreset);
    }
  });
}

export function updateEventFilter(preferredEvent = '', expandPreferredEvent = false) {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (!eventFilterMenu || getAnalysisMode() !== 'single') {
    return;
  }

  const selectedEventType = getSingleEventSelectedType();
  const eventTypeChanged = selectedEventType !== lastSingleEventType;

  if (!selectedEventType) {
    lastSingleEventType = '';
    resetEventFilterCalendarState();
    setSelectedSingleEvent('', false);
    populateEventFilterMenu([]);
    renderEventFilterCalendar({
      entries: [],
      selectedEvent: '',
      onSelectEvent: eventName => setSelectedSingleEvent(eventName, true),
      emptyMessage: 'Select an Event Type first.'
    });
    return;
  }

  const entries = buildSingleEventCalendarEntries(selectedEventType);
  if (eventTypeChanged) {
    resetEventFilterCalendarState();
    setSelectedSingleEvent('', false);
  }

  if (expandPreferredEvent) {
    primeEventFilterCalendarSelection(preferredEvent, entries);
  }

  const currentSelectedEvent = preferredEvent || (eventTypeChanged ? '' : eventFilterMenu.value);

  populateEventFilterMenu(entries);

  const resolvedSelectedEvent = renderEventFilterCalendar({
    entries,
    selectedEvent: currentSelectedEvent,
    onSelectEvent: eventName => setSelectedSingleEvent(eventName, true),
    emptyMessage: 'No events available for the selected Event Type.'
  });

  lastSingleEventType = selectedEventType;
  setSelectedSingleEvent(resolvedSelectedEvent, false);
}

export function updateDateOptions() {
  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  const selectedEventTypes = getEventAnalysisSelectedTypes();
  const activePreset = getActiveMultiEventPreset();
  const eventTypeRows = getAnalysisRows().filter(row => selectedEventTypes.includes(String(row.EventType).toLowerCase()));
  const dates =
    selectedEventTypes.length > 0
      ? [
          ...new Set(
            eventTypeRows.map(row => row.Date)
          )
        ].sort((a, b) => new Date(a) - new Date(b))
      : [];

  console.log('Available dates for Multi-Event:', dates, 'Active preset:', activePreset);

  if (dates.length === 0) {
    startDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    endDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    renderMultiEventDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      onSelectStartDate: dateString => setMultiEventDateSelection('start', dateString, { clearPreset: true }),
      onSelectEndDate: dateString => setMultiEventDateSelection('end', dateString, { clearPreset: true })
    });
    return;
  }

  let currentStartDate = dates.includes(startDateSelect.value) ? startDateSelect.value : '';
  let currentEndDate = dates.includes(endDateSelect.value) ? endDateSelect.value : '';

  if (!currentStartDate && !currentEndDate) {
    const presetRange = activePreset
      ? getMultiEventPresetSuggestedRange({
          selectedEventTypes,
          presetId: activePreset
        })
      : null;

    if (
      presetRange?.startDate &&
      presetRange?.endDate &&
      dates.includes(presetRange.startDate) &&
      dates.includes(presetRange.endDate)
    ) {
      currentStartDate = presetRange.startDate;
      currentEndDate = presetRange.endDate;
    } else {
      const defaultRange = getDefaultMultiEventRange(dates);
      currentStartDate = defaultRange.startDate;
      currentEndDate = defaultRange.endDate;
    }
  }

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      validEndDates
        .map(date => {
          return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      dates
        .map(date => {
          return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      validStartDates
        .map(date => {
          return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      dates
        .map(date => {
          return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  }

  startDateSelect.value = currentStartDate;
  endDateSelect.value = currentEndDate;

  renderMultiEventDateRangeCalendar({
    dates,
    startDate: currentStartDate,
    endDate: currentEndDate,
    onSelectStartDate: dateString => setMultiEventDateSelection('start', dateString, { clearPreset: true }),
    onSelectEndDate: dateString => setMultiEventDateSelection('end', dateString, { clearPreset: true })
  });

  updateMultiEventSelectionSummary();
}

export function updatePlayerDateOptions() {
  const startDateSelect = document.getElementById('playerStartDateSelect');
  const endDateSelect = document.getElementById('playerEndDateSelect');
  const playerFilterMenu = document.getElementById('playerFilterMenu');

  if (!startDateSelect || !endDateSelect || !playerFilterMenu) {
    return;
  }

  const selectedEventTypes = getPlayerAnalysisSelectedTypes();
  const selectedPlayer = playerFilterMenu.value;
  const activePreset = getPlayerAnalysisActivePreset();
  const eventTypeRows = getAnalysisRows().filter(row => selectedEventTypes.includes(String(row.EventType).toLowerCase()));

  if (selectedEventTypes.length === 0) {
    setPlayerFilterPlaceholder(playerFilterMenu, 'No Players Available');
    startDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    endDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    renderPlayerDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'No dates available.',
      onSelectStartDate: dateString => setPlayerDateSelection('start', dateString),
      onSelectEndDate: dateString => setPlayerDateSelection('end', dateString)
    });
    updatePlayerSelectionSummary();
    return;
  }

  const defaultSelection = getLatestPlayerDefaultSelection(selectedEventTypes);
  const playerOptions = buildPlayerFilterOptions(eventTypeRows);
  const playerKeys = playerOptions.map(playerOption => playerOption.key);

  let currentPlayer = playerKeys.includes(selectedPlayer)
    ? selectedPlayer
    : playerKeys.includes(defaultSelection.player)
      ? defaultSelection.player
      : playerKeys[0] || '';

  if (playerOptions.length === 0) {
    setPlayerFilterPlaceholder(playerFilterMenu, 'No Players Available');
    startDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    endDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    renderPlayerDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'No dates available.',
      onSelectStartDate: dateString => setPlayerDateSelection('start', dateString),
      onSelectEndDate: dateString => setPlayerDateSelection('end', dateString)
    });
    updatePlayerSelectionSummary();
    return;
  }

  populatePlayerFilterMenu(playerFilterMenu, playerOptions, currentPlayer);

  const dates = [
    ...new Set(
      eventTypeRows
        .filter(row => {
          return rowMatchesPlayerKey(row, currentPlayer);
        })
        .map(row => row.Date)
    )
  ].sort((a, b) => new Date(a) - new Date(b));

  console.log('Available dates for Player Analysis:', dates, 'Selected Player:', currentPlayer, 'Active preset:', activePreset);

  if (dates.length === 0) {
    startDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    endDateSelect.innerHTML = '<option value="">No Dates Available</option>';
    renderPlayerDateRangeCalendar({
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'No dates available for this player.',
      onSelectStartDate: dateString => setPlayerDateSelection('start', dateString),
      onSelectEndDate: dateString => setPlayerDateSelection('end', dateString)
    });
    updatePlayerSelectionSummary();
    return;
  }

  const selectedStartDate = dates.includes(startDateSelect.value) ? startDateSelect.value : '';
  const selectedEndDate = dates.includes(endDateSelect.value) ? endDateSelect.value : '';
  const fallbackDate =
    currentPlayer === defaultSelection.player && dates.includes(defaultSelection.startDate)
      ? defaultSelection.startDate
      : dates[dates.length - 1];

  let currentStartDate = selectedStartDate;
  let currentEndDate = selectedEndDate;

  if (!currentStartDate && !currentEndDate) {
    const presetRange = activePreset
      ? getPlayerPresetSuggestedRange({
          selectedEventTypes,
          presetId: activePreset,
          playerKey: currentPlayer
        })
      : null;

    if (
      presetRange?.startDate &&
      presetRange?.endDate &&
      dates.includes(presetRange.startDate) &&
      dates.includes(presetRange.endDate)
    ) {
      currentStartDate = presetRange.startDate;
      currentEndDate = presetRange.endDate;
    } else {
      currentStartDate = fallbackDate;
      currentEndDate = fallbackDate;
    }
  } else if (!currentStartDate) {
    currentStartDate = currentEndDate;
  } else if (!currentEndDate) {
    currentEndDate = currentStartDate;
  }

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML =
      validEndDates
        .map(date => {
          return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    endDateSelect.innerHTML = dates
      .map(date => {
        return `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`;
      })
      .join('');
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML =
      validStartDates
        .map(date => {
          return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
        })
        .join('');
  } else {
    startDateSelect.innerHTML = dates
      .map(date => {
        return `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`;
      })
      .join('');
  }

  startDateSelect.value = currentStartDate;
  endDateSelect.value = currentEndDate;

  renderPlayerDateRangeCalendar({
    dates,
    startDate: currentStartDate,
    endDate: currentEndDate,
    onSelectStartDate: dateString => setPlayerDateSelection('start', dateString, { clearPreset: true }),
    onSelectEndDate: dateString => setPlayerDateSelection('end', dateString, { clearPreset: true })
  });

  updatePlayerSelectionSummary();
}

export function populateDateDropdowns(eventType) {
  const filteredDates = [
    ...new Set(
      getAnalysisRows()
        .filter(row => row.EventType.toLowerCase() === eventType.toLowerCase())
        .map(row => row.Date)
    )
  ].sort();

  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');

  if (!startDateSelect || !endDateSelect) {
    console.error('Date select elements not found!');
    return;
  }

  const options =
    "<option value=''>--Select--</option>" +
    filteredDates.map(date => `<option value="${date}">${date}</option>`).join('');

  startDateSelect.innerHTML = options;
  endDateSelect.innerHTML = options;
}
