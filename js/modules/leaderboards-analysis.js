import { getAnalysisRows } from '../utils/analysis-data.js';
import {
  getDefaultQuickViewYear,
  getLatestSetQuickViewPresetId,
  getQuickViewPresetDefinitionById,
  getQuickViewPresetDefinitionsByIds,
  getQuickViewPresetEventTypes,
  getQuickViewPresetRows,
  getQuickViewPresetSuggestedRange,
  getQuickViewPresetYearOptions,
  getSetQuickViewPresetDefinitions,
  getStaticQuickViewPresetDefinitions,
  normalizeQuickViewPresetIds,
  shiftDateByDays
} from '../utils/quick-view-presets.js';
import { renderDateRangeCalendar } from './date-range-calendar.js';
import { setChartLoading, triggerUpdateAnimation, updateElementHTML, updateElementText } from '../utils/dom.js';
import { formatDate, formatDateRange, formatEventName } from '../utils/format.js';
import { formatGroupDisplayLabel, getEventGroupInfo } from '../utils/event-groups.js';
import { buildPlayerFilterOptions, getPlayerIdentityKey, normalizePlayerName } from '../utils/player-names.js';
import { renderLeaderboardOverviewChart } from './leaderboards-chart.js';

const DEFAULT_EVENT_TYPE = 'online';
const LEADERBOARD_SCORING = {
  top1: 10,
  top8: 6,
  top9_16: 3,
  top17_32: 1
};
const LEADERBOARD_STAT_CARD_IDS = [
  'leaderboardTotalEventsCard',
  'leaderboardTrackedPlayersCard',
  'leaderboardLeaderCard',
  'leaderboardMostTrophiesCard',
  'leaderboardMostMatchWinsCard'
];
const LEADERBOARD_DRILLDOWN_CONFIG = {
  totalEvents: {
    cardId: 'leaderboardTotalEventsCard',
    title: 'Selected Events',
    emptyMessage: 'No events are available for the current Leaderboards filters.'
  },
  trackedPlayers: {
    cardId: 'leaderboardTrackedPlayersCard',
    title: 'Tracked Players',
    emptyMessage: 'No players are available for the current Leaderboards filters.'
  },
  leader: {
    cardId: 'leaderboardLeaderCard',
    title: 'Current Leader',
    emptyMessage: 'No leaderboard leader is available for the current filters.'
  },
  mostTrophies: {
    cardId: 'leaderboardMostTrophiesCard',
    title: 'Most Trophies',
    emptyMessage: 'No trophy leaders are available for the current Leaderboards filters.'
  },
  mostMatchWins: {
    cardId: 'leaderboardMostMatchWinsCard',
    title: 'Most Match Wins',
    emptyMessage: 'No match-win leaders are available for the current Leaderboards filters.'
  }
};

let activeQuickViewYear = '';
let leaderboardGroupSelectionInitialized = false;
let activeLeaderboardGroupKeys = new Set();
let leaderboardGroupSelectionContextKey = '';
let currentLeaderboardRows = [];
let currentLeaderboardSourceRows = [];
let leaderboardTableSort = {
  key: 'score',
  direction: 'desc'
};
let activeLeaderboardDrilldownCategory = '';
let activeLeaderboardPlayerDrilldownKey = '';
let leaderboardDeckResultsSort = 'events';

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

function getLeaderboardsSection() {
  return document.getElementById('leaderboardsSection');
}

function getLeaderboardDrilldownElements() {
  return {
    overlay: document.getElementById('leaderboardStatDrilldownOverlay'),
    title: document.getElementById('leaderboardStatDrilldownTitle'),
    subtitle: document.getElementById('leaderboardStatDrilldownSubtitle'),
    content: document.getElementById('leaderboardStatDrilldownContent'),
    closeButton: document.getElementById('leaderboardStatDrilldownClose')
  };
}

function getLeaderboardQuickViewRoot() {
  return document.getElementById('leaderboardQuickViewButtons');
}

function getLeaderboardSelectionElements() {
  return {
    panels: document.getElementById('leaderboardSelectionPanels'),
    summary: document.getElementById('leaderboardSelectionSummary'),
    summaryContent: document.getElementById('leaderboardSelectionSummaryContent'),
    listBox: document.getElementById('leaderboardSelectionListBox'),
    list: document.getElementById('leaderboardSelectionList')
  };
}

function getLeaderboardEventTypeButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('.event-type-filter') || []);
}

function getSelectedLeaderboardEventTypes() {
  return getLeaderboardEventTypeButtons()
    .filter(button => button.classList.contains('active'))
    .map(button => String(button.dataset.type || '').toLowerCase())
    .filter(Boolean);
}

function setLeaderboardEventType(nextType = DEFAULT_EVENT_TYPE) {
  const normalizedType = String(nextType || '').toLowerCase();
  const buttons = getLeaderboardEventTypeButtons();
  const fallbackType =
    buttons.find(button => String(button.dataset.type || '').toLowerCase() === DEFAULT_EVENT_TYPE)?.dataset.type?.toLowerCase()
    || buttons[0]?.dataset.type?.toLowerCase()
    || '';
  const resolvedType = buttons.some(button => String(button.dataset.type || '').toLowerCase() === normalizedType)
    ? normalizedType
    : fallbackType;

  buttons.forEach(button => {
    button.classList.toggle('active', String(button.dataset.type || '').toLowerCase() === resolvedType);
  });
}

function getLeaderboardStartDateSelect() {
  return document.getElementById('leaderboardStartDateSelect');
}

function getLeaderboardEndDateSelect() {
  return document.getElementById('leaderboardEndDateSelect');
}

function createQuickViewButton(preset) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bubble-button leaderboard-preset-button';
  button.dataset.leaderboardPreset = preset.id;
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

function createQuickViewYearButton(year, isActive) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bubble-button quick-view-year-button${isActive ? ' active' : ''}`;
  button.dataset.quickViewYear = year;
  button.textContent = year;
  return button;
}

function getActiveLeaderboardPreset() {
  const activePresetValue = getLeaderboardQuickViewRoot()?.dataset.activePreset || '';
  if (activePresetValue) {
    return activePresetValue;
  }

  return Array.from(document.querySelectorAll('.leaderboard-preset-button.active'))
    .map(button => button.dataset.leaderboardPreset)
    .filter(Boolean)
    .join(',');
}

function getActiveLeaderboardPresetIds() {
  return normalizeQuickViewPresetIds(getActiveLeaderboardPreset());
}

function getResolvedQuickViewYear(activePresetIds = []) {
  const analysisRows = getAnalysisRows();
  const yearOptions = getQuickViewPresetYearOptions(analysisRows);
  if (yearOptions.length === 0) {
    return '';
  }

  const activePreset = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true }))
    .find(Boolean);
  const presetYear = activePreset?.releaseYear || '';
  const currentYear = activeQuickViewYear || getDefaultQuickViewYear(analysisRows);

  if (currentYear && yearOptions.includes(currentYear)) {
    return currentYear;
  }

  if (presetYear && yearOptions.includes(presetYear)) {
    return presetYear;
  }

  return yearOptions[0] || '';
}

function renderQuickViewButtons() {
  const container = getLeaderboardQuickViewRoot();
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const analysisRows = getAnalysisRows();
  const activePresetIds = getActiveLeaderboardPresetIds();
  const activePresets = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true }))
    .filter(Boolean);
  const staticPresets = getStaticQuickViewPresetDefinitions();
  const setPresetDefinitions = getSetQuickViewPresetDefinitions(analysisRows);
  const yearOptions = getQuickViewPresetYearOptions(analysisRows);
  const resolvedYear = getResolvedQuickViewYear(activePresetIds);
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

  activeQuickViewYear = resolvedYear;
  container.dataset.activePreset = activePresetIds.join(',');

  if (staticPresets.length > 0) {
    const staticRow = document.createElement('div');
    staticRow.className = 'bubble-menu quick-view-static-list';

    staticPresets.forEach(preset => {
      const button = createQuickViewButton(preset);
      button.classList.toggle('active', activePresetIds.includes(preset.id));
      staticRow.appendChild(button);
    });

    container.appendChild(staticRow);
  }

  if (yearOptions.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'quick-view-divider';
    divider.innerHTML = `
      <span class="quick-view-divider-line"></span>
      <span class="quick-view-divider-label">Specific Sets</span>
      <span class="quick-view-divider-line"></span>
    `;
    container.appendChild(divider);

    const setHelper = document.createElement('div');
    setHelper.className = 'quick-view-set-helper';
    setHelper.textContent = 'Choose a set year, then select one or more set windows.';
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
      yearRow.appendChild(createQuickViewYearButton(year, highlightedYears.has(year)));
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
    const button = createQuickViewButton(preset);
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

function setLeaderboardPresetButtonState(activePresetId = '') {
  const root = getLeaderboardQuickViewRoot();
  const activePresetIds = normalizeQuickViewPresetIds(activePresetId);
  const serializedPresetIds = activePresetIds.join(',');

  if (root) {
    root.dataset.activePreset = serializedPresetIds;
  }

  const preset = activePresetIds
    .map(presetId => getQuickViewPresetDefinitionById(presetId, getAnalysisRows(), { includeFuture: true }))
    .find(candidate => candidate?.releaseYear);
  if (preset?.releaseYear) {
    activeQuickViewYear = preset.releaseYear;
  }

  renderQuickViewButtons();
}

function clearLeaderboardPresetButtonState() {
  setLeaderboardPresetButtonState('');
}

function ensureDefaultLeaderboardPreset() {
  const activePresetId = getActiveLeaderboardPreset();
  if (activePresetId) {
    return activePresetId;
  }

  const defaultPresetId = getLatestSetQuickViewPresetId(getAnalysisRows());
  setLeaderboardPresetButtonState(defaultPresetId);
  return defaultPresetId;
}

function resolvePresetEventTypeSelection(currentTypes = [], presetEventTypes = [], defaultType = DEFAULT_EVENT_TYPE) {
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

function getScopedLeaderboardRows(selectedEventTypes = getSelectedLeaderboardEventTypes()) {
  return getQuickViewPresetRows(selectedEventTypes, getActiveLeaderboardPreset(), getAnalysisRows());
}

function applyActiveLeaderboardPresetDateRange() {
  const activePreset = getActiveLeaderboardPreset();
  const startDateSelect = getLeaderboardStartDateSelect();
  const endDateSelect = getLeaderboardEndDateSelect();

  if (!activePreset || !startDateSelect || !endDateSelect) {
    return false;
  }

  const range = getQuickViewPresetSuggestedRange({
    selectedEventTypes: getSelectedLeaderboardEventTypes(),
    presetId: activePreset,
    rows: getAnalysisRows()
  });

  if (!range.startDate || !range.endDate) {
    startDateSelect.value = '';
    endDateSelect.value = '';
    updateLeaderboardDateOptions();
    return false;
  }

  startDateSelect.value = range.startDate;
  endDateSelect.value = range.endDate;
  updateLeaderboardDateOptions();
  return true;
}

function applyLeaderboardPreset(presetId) {
  const analysisRows = getAnalysisRows();
  const preset = getQuickViewPresetDefinitionById(presetId, analysisRows, { includeFuture: true });
  const presetEventTypes = getQuickViewPresetEventTypes(presetId, analysisRows);

  if (presetEventTypes) {
    const nextType = resolvePresetEventTypeSelection(getSelectedLeaderboardEventTypes(), presetEventTypes);
    setLeaderboardEventType(nextType);
  }

  if (!preset) {
    return;
  }

  const fallbackPresetId = getStaticQuickViewPresetDefinitions()[0]?.id || '';
  let nextPresetIds = [];

  if (preset.kind !== 'set-window') {
    nextPresetIds = [preset.id];
  } else {
    const activeSetWindowIds = getActiveLeaderboardPresetIds().filter(activePresetId => {
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

  setLeaderboardPresetButtonState(nextPresetIds);
  resetLeaderboardDateRange();
  updateLeaderboardDateOptions();
  applyActiveLeaderboardPresetDateRange();

  if (getTopMode() === 'leaderboard') {
    updateLeaderboardAnalytics();
  }
}

function setQuickViewYearSelection(year) {
  activeQuickViewYear = year;
  renderQuickViewButtons();
}

function resetLeaderboardGroupFilterState() {
  leaderboardGroupSelectionInitialized = false;
  activeLeaderboardGroupKeys = new Set();
  leaderboardGroupSelectionContextKey = '';
  syncLeaderboardGroupDataset();
}

function syncLeaderboardGroupDataset() {
  const panels = document.getElementById('leaderboardSelectionPanels');
  if (!panels) {
    return;
  }

  panels.dataset.groupFilterInitialized = leaderboardGroupSelectionInitialized ? 'true' : 'false';
  panels.dataset.activeGroupKeys = Array.from(activeLeaderboardGroupKeys).join(',');
}

function resetLeaderboardDateRange() {
  const startDateSelect = getLeaderboardStartDateSelect();
  const endDateSelect = getLeaderboardEndDateSelect();
  if (startDateSelect) {
    startDateSelect.value = '';
  }
  if (endDateSelect) {
    endDateSelect.value = '';
  }
  resetLeaderboardGroupFilterState();
}

function getDefaultLeaderboardRange(dates) {
  if (dates.length === 0) {
    return { startDate: '', endDate: '' };
  }

  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1]
  };
}

function buildLeaderboardSelectionListHTML(entries = []) {
  if (!entries.length) {
    return '<div>No events selected</div>';
  }

  return entries
    .map(entry => {
      const formattedEventName = formatEventName(entry.name) || entry.name || 'Unknown Event';
      const dateLabel = entry.date ? formatDate(entry.date) : '--';
      const metaLabel = entry.groupShortLabel || entry.groupLabel || '--';

      return `
        <button
          type="button"
          class="player-event-history-item"
          data-leaderboard-history-event="${escapeHtml(String(entry.name || '').trim())}"
          data-leaderboard-history-date="${escapeHtml(String(entry.date || '').trim())}"
          aria-label="${escapeHtml(`${formattedEventName} on ${dateLabel} in ${metaLabel}`)}"
        >
          <span class="player-event-history-item-date">${escapeHtml(dateLabel)}</span>
          <span class="player-event-history-item-main">${escapeHtml(formattedEventName)}</span>
          <span class="player-event-history-item-meta">${escapeHtml(metaLabel)}</span>
        </button>
      `;
    })
    .join('');
}

function getBaseLeaderboardRows() {
  const startDate = getLeaderboardStartDateSelect()?.value || '';
  const endDate = getLeaderboardEndDateSelect()?.value || '';
  const selectedEventTypes = getSelectedLeaderboardEventTypes();
  const scopedRows = getScopedLeaderboardRows(selectedEventTypes);

  if (!startDate || !endDate || selectedEventTypes.length === 0) {
    return [];
  }

  return scopedRows.filter(row => row.Date >= startDate && row.Date <= endDate);
}

function getLeaderboardSelectedEventEntries(rows = getBaseLeaderboardRows()) {
  const events = new Map();

  rows.forEach(row => {
    const eventKey = `${row.Date || ''}::${row.Event || ''}`;
    if (events.has(eventKey)) {
      return;
    }

    const groupInfo = getEventGroupInfo(row.Event);
    events.set(eventKey, {
      name: row.Event,
      date: row.Date || '',
      groupKey: groupInfo.key,
      groupLabel: groupInfo.label,
      groupShortLabel: groupInfo.shortLabel,
      groupOrder: groupInfo.order
    });
  });

  return Array.from(events.values()).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function getLeaderboardEventGroupSummaries(rows = getBaseLeaderboardRows()) {
  const groups = new Map();

  getLeaderboardSelectedEventEntries(rows).forEach(entry => {
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

function getLeaderboardGroupContextKey(rows = getBaseLeaderboardRows()) {
  const startDate = getLeaderboardStartDateSelect()?.value || '';
  const endDate = getLeaderboardEndDateSelect()?.value || '';
  const selectedEventTypes = getSelectedLeaderboardEventTypes().slice().sort().join(',');
  const activePreset = getActiveLeaderboardPreset();
  const eventKeys = getLeaderboardSelectedEventEntries(rows)
    .map(entry => `${entry.date || ''}::${entry.name || ''}`)
    .join('|');

  return [startDate, endDate, selectedEventTypes, activePreset, eventKeys].join('@@');
}

function syncLeaderboardGroupFilterState(groupSummaries, contextKey = '') {
  if (groupSummaries.length === 0) {
    resetLeaderboardGroupFilterState();
    return;
  }

  const availableKeys = new Set(groupSummaries.map(group => group.key));
  const hasContextChanged = Boolean(contextKey) && contextKey !== leaderboardGroupSelectionContextKey;

  if (!leaderboardGroupSelectionInitialized || hasContextChanged) {
    activeLeaderboardGroupKeys = new Set(availableKeys);
    leaderboardGroupSelectionInitialized = true;
    leaderboardGroupSelectionContextKey = contextKey;
    syncLeaderboardGroupDataset();
    return;
  }

  activeLeaderboardGroupKeys = new Set(
    Array.from(activeLeaderboardGroupKeys).filter(groupKey => availableKeys.has(groupKey))
  );
  leaderboardGroupSelectionContextKey = contextKey || leaderboardGroupSelectionContextKey;
  syncLeaderboardGroupDataset();
}

function getFilteredLeaderboardRows() {
  const baseRows = getBaseLeaderboardRows();
  if (baseRows.length === 0) {
    resetLeaderboardGroupFilterState();
    return [];
  }

  const groupSummaries = getLeaderboardEventGroupSummaries(baseRows);
  const contextKey = getLeaderboardGroupContextKey(baseRows);
  syncLeaderboardGroupFilterState(groupSummaries, contextKey);

  return baseRows.filter(row => activeLeaderboardGroupKeys.has(getEventGroupInfo(row.Event).key));
}

function toggleLeaderboardEventGroupFilter(groupKey) {
  const baseRows = getBaseLeaderboardRows();
  const groupSummaries = getLeaderboardEventGroupSummaries(baseRows);
  const contextKey = getLeaderboardGroupContextKey(baseRows);
  syncLeaderboardGroupFilterState(groupSummaries, contextKey);

  if (activeLeaderboardGroupKeys.has(groupKey)) {
    activeLeaderboardGroupKeys.delete(groupKey);
  } else {
    activeLeaderboardGroupKeys.add(groupKey);
  }

  leaderboardGroupSelectionInitialized = true;
  leaderboardGroupSelectionContextKey = contextKey;
  syncLeaderboardGroupDataset();
  updateLeaderboardSelectionSummary();

  if (getTopMode() === 'leaderboard') {
    updateLeaderboardAnalytics();
  }
}

function updateLeaderboardSelectionSummary() {
  const { panels, summary, summaryContent, listBox, list } = getLeaderboardSelectionElements();
  if (!panels || !summary || !summaryContent || !listBox || !list) {
    return;
  }

  const shouldShow = getTopMode() === 'leaderboard';
  panels.style.display = shouldShow ? 'flex' : 'none';

  if (!shouldShow) {
    return;
  }

  const baseRows = getBaseLeaderboardRows();
  const groupSummaries = getLeaderboardEventGroupSummaries(baseRows);
  const contextKey = getLeaderboardGroupContextKey(baseRows);
  syncLeaderboardGroupFilterState(groupSummaries, contextKey);
  const filteredRows = getFilteredLeaderboardRows();

  if (groupSummaries.length === 0) {
    summaryContent.innerHTML = 'No events selected';
    list.innerHTML = '<div>No events selected</div>';
    triggerUpdateAnimation('leaderboardSelectionSummary');
    triggerUpdateAnimation('leaderboardSelectionListBox');
    return;
  }

  summaryContent.innerHTML = groupSummaries
    .map(group => {
      const isActive = activeLeaderboardGroupKeys.has(group.key);
      const countLabel = formatGroupDisplayLabel(group.count === 1 ? group.label : `${group.label}s`);

      return `
        <button type="button" class="multi-event-group-card ${isActive ? 'active' : ''}" data-group-key="${group.key}">
          <span class="multi-event-group-card-count">${group.count}</span>
          <span class="multi-event-group-card-label">${countLabel}</span>
        </button>
      `;
    })
    .join('');

  summaryContent.querySelectorAll('.multi-event-group-card').forEach(button => {
    button.addEventListener('click', () => toggleLeaderboardEventGroupFilter(button.dataset.groupKey));
  });

  if (!groupSummaries.some(group => activeLeaderboardGroupKeys.has(group.key))) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-event-group-empty';
    emptyState.textContent = 'No events selected';
    summaryContent.appendChild(emptyState);
  }

  const selectedEntries = getLeaderboardSelectedEventEntries(filteredRows);
  list.innerHTML = buildLeaderboardSelectionListHTML(selectedEntries);
  triggerUpdateAnimation('leaderboardSelectionSummary');
  triggerUpdateAnimation('leaderboardSelectionListBox');
}

function setLeaderboardDateSelection(type, value, options = {}) {
  const { clearPreset = false } = options;
  const startDateSelect = getLeaderboardStartDateSelect();
  const endDateSelect = getLeaderboardEndDateSelect();

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  if (clearPreset) {
    clearLeaderboardPresetButtonState();
  }

  if (type === 'start') {
    startDateSelect.value = value;
  } else {
    endDateSelect.value = value;
  }

  updateLeaderboardDateOptions();

  if (getTopMode() === 'leaderboard') {
    updateLeaderboardAnalytics();
  }
}

function updateLeaderboardDateOptions() {
  const startDateSelect = getLeaderboardStartDateSelect();
  const endDateSelect = getLeaderboardEndDateSelect();

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  const selectedEventTypes = getSelectedLeaderboardEventTypes();
  const scopedRows = getScopedLeaderboardRows(selectedEventTypes);
  const dates = [...new Set(scopedRows.map(row => row.Date))].sort((a, b) => new Date(a) - new Date(b));
  const activePreset = getActiveLeaderboardPreset();

  if (dates.length === 0) {
    startDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    endDateSelect.innerHTML = '<option value="">Select Offline or Online Event first</option>';
    renderDateRangeCalendar({
      containerId: 'leaderboardDateRangeCalendar',
      dates: [],
      startDate: '',
      endDate: '',
      emptyMessage: 'Select an Event Type first.',
      onSelectStartDate: dateString => setLeaderboardDateSelection('start', dateString, { clearPreset: true }),
      onSelectEndDate: dateString => setLeaderboardDateSelection('end', dateString, { clearPreset: true })
    });
    updateLeaderboardSelectionSummary();
    return;
  }

  let currentStartDate = dates.includes(startDateSelect.value) ? startDateSelect.value : '';
  let currentEndDate = dates.includes(endDateSelect.value) ? endDateSelect.value : '';

  if (!currentStartDate && !currentEndDate) {
    const presetRange = activePreset
      ? getQuickViewPresetSuggestedRange({
          selectedEventTypes,
          presetId: activePreset,
          rows: getAnalysisRows()
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
      const defaultRange = getDefaultLeaderboardRange(dates);
      currentStartDate = defaultRange.startDate;
      currentEndDate = defaultRange.endDate;
    }
  } else if (!currentStartDate) {
    currentStartDate = currentEndDate;
  } else if (!currentEndDate) {
    currentEndDate = currentStartDate;
  }

  if (currentStartDate) {
    const validEndDates = dates.filter(date => date >= currentStartDate);
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      validEndDates
        .map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  } else {
    endDateSelect.innerHTML =
      '<option value="">Select End Date</option>' +
      dates
        .map(date => `<option value="${date}" ${date === currentEndDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  }

  if (currentEndDate) {
    const validStartDates = dates.filter(date => date <= currentEndDate);
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      validStartDates
        .map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  } else {
    startDateSelect.innerHTML =
      '<option value="">Select Start Date</option>' +
      dates
        .map(date => `<option value="${date}" ${date === currentStartDate ? 'selected' : ''}>${date}</option>`)
        .join('');
  }

  startDateSelect.value = currentStartDate;
  endDateSelect.value = currentEndDate;

  renderDateRangeCalendar({
    containerId: 'leaderboardDateRangeCalendar',
    dates,
    startDate: currentStartDate,
    endDate: currentEndDate,
    onSelectStartDate: dateString => setLeaderboardDateSelection('start', dateString, { clearPreset: true }),
    onSelectEndDate: dateString => setLeaderboardDateSelection('end', dateString, { clearPreset: true })
  });

  updateLeaderboardSelectionSummary();
}

function getActivePresetDisplayLabel() {
  const presets = getQuickViewPresetDefinitionsByIds(getActiveLeaderboardPresetIds(), getAnalysisRows(), { includeFuture: true });
  if (presets.length === 0) {
    return 'Manual Range';
  }

  if (presets.some(preset => preset.kind === 'static')) {
    return presets[0]?.label || 'All Period';
  }

  return presets.map(preset => preset.buttonLabel || preset.label).join(' + ');
}

function buildPlayerLabelMap(rows = []) {
  const labelMap = new Map();
  buildPlayerFilterOptions(rows).forEach(option => {
    labelMap.set(option.key, option.label);
  });
  return labelMap;
}

function compareLeaderboardRows(a, b) {
  return (
    b.score - a.score ||
    b.top1 - a.top1 ||
    b.top8 - a.top8 ||
    b.wins - a.wins ||
    b.winRate - a.winRate ||
    a.averageFinish - b.averageFinish ||
    b.events - a.events ||
    String(a.player).localeCompare(String(b.player), undefined, { sensitivity: 'base' }) ||
    String(a.player).localeCompare(String(b.player))
  );
}

function calculateLeaderboardRows(rows = []) {
  const playerLabelMap = buildPlayerLabelMap(rows);
  const statsByPlayer = new Map();

  rows.forEach(row => {
    const playerKey = getPlayerIdentityKey(row.Player);
    if (!playerKey) {
      return;
    }

    const rank = Number(row.Rank);
    const wins = Number(row.Wins) || 0;
    const losses = Number(row.Losses) || 0;
    const deckName = String(row.Deck || '').trim();
    const entry = statsByPlayer.get(playerKey) || {
      playerKey,
      player: playerLabelMap.get(playerKey) || normalizePlayerName(row.Player),
      events: new Set(),
      decks: new Set(),
      wins: 0,
      losses: 0,
      top1: 0,
      top8: 0,
      top9_16: 0,
      top17_32: 0,
      top33Plus: 0,
      totalRank: 0,
      resultCount: 0,
      bestFinish: Number.POSITIVE_INFINITY,
      worstFinish: 0,
      latestDate: ''
    };

    entry.player = playerLabelMap.get(playerKey) || entry.player || normalizePlayerName(row.Player);
    entry.events.add(String(row.Event || '').trim());
    if (deckName && deckName !== 'No Show') {
      entry.decks.add(deckName);
    }
    entry.wins += wins;
    entry.losses += losses;
    if (Number.isFinite(rank) && rank > 0) {
      entry.resultCount += 1;
      entry.totalRank += rank;
      entry.bestFinish = Math.min(entry.bestFinish, rank);
      entry.worstFinish = Math.max(entry.worstFinish, rank);

      if (rank === 1) {
        entry.top1 += 1;
        entry.top8 += 1;
      } else if (rank >= 2 && rank <= 8) {
        entry.top8 += 1;
      } else if (rank >= 9 && rank <= 16) {
        entry.top9_16 += 1;
      } else if (rank >= 17 && rank <= 32) {
        entry.top17_32 += 1;
      } else if (rank > 32) {
        entry.top33Plus += 1;
      }
    }

    const eventDate = String(row.Date || '').trim();
    if (eventDate.localeCompare(entry.latestDate) > 0) {
      entry.latestDate = eventDate;
    }

    statsByPlayer.set(playerKey, entry);
  });

  return Array.from(statsByPlayer.values())
    .map(entry => {
      const totalMatches = entry.wins + entry.losses;
      const winRate = totalMatches > 0 ? (entry.wins / totalMatches) * 100 : 0;
      const averageFinish = entry.resultCount > 0 ? entry.totalRank / entry.resultCount : Number.POSITIVE_INFINITY;
      const score =
        (entry.top1 * LEADERBOARD_SCORING.top1) +
        (Math.max(entry.top8 - entry.top1, 0) * LEADERBOARD_SCORING.top8) +
        (entry.top9_16 * LEADERBOARD_SCORING.top9_16) +
        (entry.top17_32 * LEADERBOARD_SCORING.top17_32);

      return {
        playerKey: entry.playerKey,
        player: entry.player,
        events: entry.events.size,
        uniqueDecks: entry.decks.size,
        wins: entry.wins,
        losses: entry.losses,
        top1: entry.top1,
        top8: entry.top8,
        top9_16: entry.top9_16,
        top17_32: entry.top17_32,
        top33Plus: entry.top33Plus,
        score,
        winRate,
        averageFinish,
        resultCount: entry.resultCount,
        bestFinish: Number.isFinite(entry.bestFinish) ? entry.bestFinish : Number.POSITIVE_INFINITY,
        worstFinish: entry.resultCount > 0 ? entry.worstFinish : Number.POSITIVE_INFINITY,
        latestDate: entry.latestDate
      };
    })
    .sort(compareLeaderboardRows)
    .map((row, index) => ({
      ...row,
      displayRank: index + 1
    }));
}

function formatDisplayNames(names = [], limit = 2) {
  const normalizedNames = [...new Set(names.filter(Boolean))];
  if (normalizedNames.length === 0) {
    return '--';
  }

  if (normalizedNames.length <= limit) {
    return normalizedNames.join(', ');
  }

  return `${normalizedNames.slice(0, limit).join(', ')} +${normalizedNames.length - limit} more`;
}

function formatDisplayNamesWithAndMore(names = [], limit = 2) {
  const normalizedNames = [...new Set(names.filter(Boolean))];
  if (normalizedNames.length === 0) {
    return '--';
  }

  if (normalizedNames.length <= limit) {
    return normalizedNames.join(', ');
  }

  return `${normalizedNames.slice(0, limit).join(', ')} and ${normalizedNames.length - limit} more`;
}

function formatPlayerDeckHeaderLabel(deckGroups = []) {
  const deckNames = deckGroups.map(group => group.deck).filter(Boolean);
  if (deckNames.length === 0) {
    return '';
  }

  return ` (${formatDisplayNamesWithAndMore(deckNames)})`;
}

function getRowsAtMaxValue(rows = [], metricKey) {
  if (!rows.length) {
    return [];
  }

  const maxValue = Math.max(...rows.map(row => Number(row[metricKey]) || 0));
  return rows.filter(row => (Number(row[metricKey]) || 0) === maxValue);
}

function formatAverageFinish(value) {
  if (!Number.isFinite(value) || value === Number.POSITIVE_INFINITY) {
    return '--';
  }

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `#${rounded}` : `#${rounded.toFixed(1)}`;
}

function formatLeaderboardPercentage(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${Number(value).toFixed(2)}%`;
}

function formatLeaderboardAverageFinish(value) {
  if (!Number.isFinite(value) || value === Number.POSITIVE_INFINITY) {
    return '--';
  }

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `#${rounded}` : `#${rounded.toFixed(1)}`;
}

function getLeaderboardPlayerRows(playerKey, rows = currentLeaderboardSourceRows) {
  return (rows || [])
    .filter(row => getPlayerIdentityKey(row.Player) === playerKey)
    .sort((a, b) => {
      const dateComparison = String(b.Date || '').localeCompare(String(a.Date || ''));
      if (dateComparison !== 0) {
        return dateComparison;
      }

      const rankComparison = Number(a.Rank) - Number(b.Rank);
      if (rankComparison !== 0) {
        return rankComparison;
      }

      return String(a.Event || '').localeCompare(String(b.Event || ''));
    });
}

function getLeaderboardHighlightBadgesForPlayer(playerName = '') {
  const playerKey = getPlayerIdentityKey(playerName);
  if (!playerKey) {
    return [];
  }

  const badges = [];
  const leaderRows = getRowsAtMaxValue(currentLeaderboardRows, 'score').filter(row => Number.isFinite(row.score));
  const trophyRows = getRowsAtMaxValue(currentLeaderboardRows, 'top1').filter(row => (Number(row.top1) || 0) > 0);
  const matchWinRows = getRowsAtMaxValue(currentLeaderboardRows, 'wins').filter(row => (Number(row.wins) || 0) > 0);
  const isLeaderTied = leaderRows.length > 1 && leaderRows.some(row => row.playerKey === playerKey);
  const isTrophyTied = trophyRows.length > 1 && trophyRows.some(row => row.playerKey === playerKey);
  const isMatchWinTied = matchWinRows.length > 1 && matchWinRows.some(row => row.playerKey === playerKey);

  if (leaderRows.some(row => row.playerKey === playerKey)) {
    badges.push({ label: 'Leader', accent: false });
    if (isLeaderTied) {
      badges.push({
        label: 'Tied',
        accent: false,
        tooltip: `Tied with ${leaderRows.length - 1} other${leaderRows.length - 1 === 1 ? '' : 's'}`
      });
    }
  }

  if (trophyRows.some(row => row.playerKey === playerKey)) {
    badges.push({ label: 'Trophy Lead', accent: true });
    if (isTrophyTied) {
      badges.push({
        label: 'Tied',
        accent: false,
        tooltip: `Tied with ${trophyRows.length - 1} other${trophyRows.length - 1 === 1 ? '' : 's'}`
      });
    }
  }

  if (matchWinRows.some(row => row.playerKey === playerKey)) {
    badges.push({ label: 'Match-Win Lead', accent: false });
    if (isMatchWinTied) {
      badges.push({
        label: 'Tied',
        accent: false,
        tooltip: `Tied with ${matchWinRows.length - 1} other${matchWinRows.length - 1 === 1 ? '' : 's'}`
      });
    }
  }

  return badges;
}

function buildLeaderboardHighlightBadgesHtml(playerName = '') {
  return getLeaderboardHighlightBadgesForPlayer(playerName)
    .map(badge => {
      const tooltipAttributes = badge.tooltip
        ? ` analysis-filter-tooltip" data-tooltip="${escapeHtml(badge.tooltip)}`
        : '';

      return `<span class="player-rank-drilldown-badge${badge.accent ? ' player-rank-drilldown-badge-accent' : ''}${tooltipAttributes}">${escapeHtml(badge.label)}</span>`;
    })
    .join('');
}

function getLeaderboardEventRows(eventName = '', eventDate = '') {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedEventDate = String(eventDate || '').trim();

  return currentLeaderboardSourceRows
    .filter(row => (
      String(row?.Event || '').trim() === normalizedEventName &&
      String(row?.Date || '').trim() === normalizedEventDate
    ))
    .sort((a, b) => {
      const rankComparison = Number(a?.Rank) - Number(b?.Rank);
      if (rankComparison !== 0) {
        return rankComparison;
      }

      return String(a?.Player || '').localeCompare(String(b?.Player || ''));
    });
}

function getLeaderboardEventHistoryRow({ eventName = '', eventDate = '', deckName = '', rank = '' } = {}) {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedEventDate = String(eventDate || '').trim();
  const normalizedDeckName = String(deckName || '').trim();
  const normalizedRank = String(rank || '').trim();

  return currentLeaderboardSourceRows.find(row => (
    String(row?.Event || '').trim() === normalizedEventName &&
    String(row?.Date || '').trim() === normalizedEventDate &&
    String(row?.Deck || '').trim() === normalizedDeckName &&
    String(row?.Rank ?? '').trim() === normalizedRank
  )) || currentLeaderboardSourceRows.find(row => (
    String(row?.Event || '').trim() === normalizedEventName &&
    String(row?.Date || '').trim() === normalizedEventDate
  )) || null;
}

function getLeaderboardRowWinRateText(row) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const totalMatches = wins + losses;

  if (totalMatches === 0) {
    return '--';
  }

  return `${((wins / totalMatches) * 100).toFixed(1)}%`;
}

function getLeaderboardWinnerRow(eventRows = []) {
  return (eventRows || []).find(row => Number(row?.Rank) === 1) || eventRows[0] || null;
}

function getLeaderboardRunnerUpRow(eventRows = []) {
  return (eventRows || []).find(row => Number(row?.Rank) === 2) || null;
}

function getLeaderboardMostPopularDeckSummary(eventRows = []) {
  const deckCounts = new Map();

  (eventRows || []).forEach(row => {
    const deckName = String(row?.Deck || '').trim();
    if (!deckName || deckName === 'No Show') {
      return;
    }

    deckCounts.set(deckName, (deckCounts.get(deckName) || 0) + 1);
  });

  if (deckCounts.size === 0) {
    return { deckNames: [], copyCount: 0 };
  }

  const maxCopies = Math.max(...Array.from(deckCounts.values()));
  const deckNames = Array.from(deckCounts.entries())
    .filter(([, count]) => count === maxCopies)
    .map(([deckName]) => deckName)
    .sort((a, b) => a.localeCompare(b));

  return {
    deckNames,
    copyCount: maxCopies
  };
}

function buildLeaderboardSingleEventTop8Html(eventRows = []) {
  const top8Rows = (eventRows || []).filter(row => {
    const rank = Number(row.Rank);
    return rank >= 1 && rank <= 8;
  });

  if (top8Rows.length === 0) {
    return `
      <div class="player-rank-drilldown-top8">
        <div class="player-rank-drilldown-top8-title">Full Top 8</div>
        <div class="player-rank-drilldown-top8-empty">Top 8 data is not available for this event.</div>
      </div>
    `;
  }

  const rowsHtml = top8Rows.map(row => {
    const highlightBadgesHtml = buildLeaderboardHighlightBadgesHtml(row?.Player);
    const rowClasses = [
      'player-rank-drilldown-top8-row',
      highlightBadgesHtml ? 'player-row-highlight' : ''
    ].filter(Boolean).join(' ');

    return `
      <tr class="${rowClasses}">
        <td>#${escapeHtml(row.Rank)}</td>
        <td>
          <div class="player-rank-drilldown-cell-stack">
            <span>${escapeHtml(row.Player || '--')}</span>
            ${highlightBadgesHtml}
          </div>
        </td>
        <td>${escapeHtml(row.Deck || '--')}</td>
        <td>${escapeHtml(row.Wins ?? 0)}</td>
        <td>${escapeHtml(row.Losses ?? 0)}</td>
        <td>${escapeHtml(getLeaderboardRowWinRateText(row))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="player-rank-drilldown-top8">
      <div class="player-rank-drilldown-top8-title">Full Top 8</div>
      <div class="player-rank-drilldown-top8-scroll">
        <table class="player-rank-drilldown-top8-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Deck</th>
              <th>Wins</th>
              <th>Losses</th>
              <th>Win Rate</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildLeaderboardPlayerNameWithBadges(playerName = '') {
  const badgesHtml = buildLeaderboardHighlightBadgesHtml(playerName);
  return `
    <div class="player-rank-drilldown-summary-value player-rank-drilldown-summary-value-stack">
      <span>${escapeHtml(playerName || '--')}</span>
      ${badgesHtml}
    </div>
  `;
}

function buildLeaderboardSelectedEventOverviewHtml(entry = {}) {
  const eventRows = getLeaderboardEventRows(entry.name, entry.date);
  if (!eventRows.length) {
    return '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
  }

  const winnerRow = getLeaderboardWinnerRow(eventRows);
  const runnerUpRow = getLeaderboardRunnerUpRow(eventRows);
  const deckSummary = getLeaderboardMostPopularDeckSummary(eventRows);
  const eventType = String(eventRows[0]?.EventType || '').toLowerCase();
  const openEventName = String(entry.name || '').trim();

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Winner</span>
          ${buildLeaderboardPlayerNameWithBadges(winnerRow?.Player || '--')}
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Winner Deck</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(winnerRow?.Deck || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Runner-up</span>
          ${buildLeaderboardPlayerNameWithBadges(runnerUpRow?.Player || '--')}
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Most Popular Deck</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(deckSummary.deckNames.join(', ') || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Popular Deck Copies</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(deckSummary.copyCount || 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Players</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(eventRows.length)}</strong>
        </div>
      </div>
      <div class="event-stat-drilldown-toolbar">
        <button
          type="button"
          class="bubble-button"
          data-leaderboard-open-event-analysis="${escapeHtml(openEventName)}"
          data-leaderboard-open-event-type="${escapeHtml(eventType)}"
        >
          Open in Event Analysis
        </button>
      </div>
      ${buildLeaderboardSingleEventTop8Html(eventRows)}
    </article>
  `;
}

function buildLeaderboardEventListHtml(entries = []) {
  if (!entries.length) {
    return '<div class="player-rank-drilldown-empty">No events found.</div>';
  }

  const shouldCollapseEvents = entries.length > 1;

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">Expand a challenge to inspect its winner, popular deck, leaderboard badges, and full Top 8.</div>
    </div>
    <div class="event-stat-drilldown-list leaderboard-event-drilldown-list">
      ${entries.map(entry => {
        const formattedEventName = formatEventName(entry.name) || entry.name || 'Unknown Event';
        const dateLabel = entry.date ? formatDate(entry.date) : '--';
        const metaLabel = entry.groupShortLabel || entry.groupLabel || '--';
        const eventRows = getLeaderboardEventRows(entry.name, entry.date);
        const winnerRow = getLeaderboardWinnerRow(eventRows);
        const runnerUpRow = getLeaderboardRunnerUpRow(eventRows);
        const summaryLabel = [
          `Winner: ${winnerRow?.Player || '--'}`,
          `Winner Deck: ${winnerRow?.Deck || '--'}`,
          `Runner-up: ${runnerUpRow?.Player || '--'}`,
          `Runner-up Deck: ${runnerUpRow?.Deck || '--'}`
        ].join(' | ');
        const eventBodyId = `leaderboardEventDetails-${String(entry.date || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(entry.name || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

        return `
          <article class="leaderboard-event-drilldown-item">
            <button
              type="button"
              class="event-stat-drilldown-list-item leaderboard-event-drilldown-toggle player-summary-event-toggle"
              data-leaderboard-event-toggle="${escapeHtml(eventBodyId)}"
              aria-expanded="${shouldCollapseEvents ? 'false' : 'true'}"
              aria-controls="${escapeHtml(eventBodyId)}"
            >
              <span class="event-stat-drilldown-list-item-date">${escapeHtml(dateLabel)}</span>
              <span class="event-stat-drilldown-list-item-main">${escapeHtml(formattedEventName)}</span>
              <span class="event-stat-drilldown-list-item-meta">${escapeHtml(`${metaLabel} | ${summaryLabel}`)}</span>
              <span class="player-summary-event-toggle-indicator drilldown-toggle-indicator" aria-hidden="true">${shouldCollapseEvents ? '+' : '-'}</span>
            </button>
            <div id="${escapeHtml(eventBodyId)}" class="leaderboard-event-drilldown-body"${shouldCollapseEvents ? ' hidden' : ''}>
              ${buildLeaderboardSelectedEventOverviewHtml(entry)}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function buildLeaderboardEventResultDrilldownHtml(playerRow) {
  if (!playerRow) {
    return '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
  }

  const eventRows = getLeaderboardEventRows(playerRow.Event, playerRow.Date);
  const playerDeck = String(playerRow?.Deck || '').trim();
  const sameDeckRows = eventRows.filter(row => String(row?.Deck || '').trim() === playerDeck);
  const averageDeckFinish = sameDeckRows.length > 0
    ? sameDeckRows.reduce((sum, row) => sum + (Number(row?.Rank) || 0), 0) / sameDeckRows.length
    : Number.NaN;
  const totalDeckWins = sameDeckRows.reduce((sum, row) => sum + (Number(row?.Wins) || 0), 0);
  const totalDeckLosses = sameDeckRows.reduce((sum, row) => sum + (Number(row?.Losses) || 0), 0);
  const bestDeckPilot = sameDeckRows.length > 0
    ? sameDeckRows.reduce((bestRow, row) => (Number(row?.Rank) < Number(bestRow?.Rank) ? row : bestRow), sameDeckRows[0])
    : null;
  const bestDeckPilotBadgesHtml = buildLeaderboardHighlightBadgesHtml(bestDeckPilot?.Player);

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(playerRow.Date ? formatDate(playerRow.Date) : '--')}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(formatEventName(playerRow.Event) || playerRow.Event || 'Unknown Event')}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">#${escapeHtml(playerRow.Rank ?? '--')}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Finish</span>
          <strong class="player-rank-drilldown-summary-value">#${escapeHtml(playerRow.Rank ?? '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Deck Played</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerDeck || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Wins</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Wins ?? 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Losses</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Losses ?? 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Win Rate</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(getLeaderboardRowWinRateText(playerRow))}</strong>
        </div>
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Same-Deck Results in This Event</div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Deck Pilots</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(sameDeckRows.length)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Average Deck Finish</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatLeaderboardAverageFinish(averageDeckFinish))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Aggregate Deck WR</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(getLeaderboardRowWinRateText({ Wins: totalDeckWins, Losses: totalDeckLosses }))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Best Deck Pilot</span>
            <div class="player-rank-drilldown-summary-value player-rank-drilldown-summary-value-stack">
              <span>${escapeHtml(bestDeckPilot?.Player || '--')}</span>
              ${bestDeckPilotBadgesHtml}
            </div>
          </div>
        </div>
      </div>
      ${buildLeaderboardSingleEventTop8Html(eventRows)}
    </article>
  `;
}

function getLeaderboardPlayerDeckGroups(rows = []) {
  const deckGroups = new Map();

  (rows || []).forEach(row => {
    const deckName = String(row?.Deck || '').trim();
    if (!deckName || deckName === 'No Show') {
      return;
    }

    if (!deckGroups.has(deckName)) {
      deckGroups.set(deckName, []);
    }

    deckGroups.get(deckName).push(row);
  });

  return Array.from(deckGroups.entries())
    .map(([deck, deckRows]) => {
      const sortedRows = [...deckRows].sort((a, b) => {
        const dateComparison = String(b.Date || '').localeCompare(String(a.Date || ''));
        if (dateComparison !== 0) {
          return dateComparison;
        }

        const rankComparison = Number(a.Rank) - Number(b.Rank);
        if (rankComparison !== 0) {
          return rankComparison;
        }

        return String(a.Event || '').localeCompare(String(b.Event || ''));
      });
      const wins = sortedRows.reduce((sum, row) => sum + (Number(row.Wins) || 0), 0);
      const losses = sortedRows.reduce((sum, row) => sum + (Number(row.Losses) || 0), 0);
      const events = new Set(sortedRows.map(row => `${row.Date || ''}::${row.Event || ''}`)).size;
      const validRanks = sortedRows
        .map(row => Number(row.Rank))
        .filter(rank => Number.isFinite(rank) && rank > 0);
      const averageFinish = validRanks.length > 0
        ? validRanks.reduce((sum, rank) => sum + rank, 0) / validRanks.length
        : Number.POSITIVE_INFINITY;
      const bestFinish = validRanks.length > 0 ? Math.min(...validRanks) : Number.POSITIVE_INFINITY;
      const worstFinish = validRanks.length > 0 ? Math.max(...validRanks) : Number.POSITIVE_INFINITY;
      const totalMatches = wins + losses;
      const winRate = totalMatches > 0 ? (wins / totalMatches) * 100 : 0;
      const top1 = validRanks.filter(rank => rank === 1).length;
      const top8 = validRanks.filter(rank => rank >= 1 && rank <= 8).length;
      const latestDate = sortedRows[0]?.Date || '';
      const deckLeadCount = sortedRows.filter(row => {
        const deckName = String(row?.Deck || '').trim();
        const eventName = String(row?.Event || '').trim();
        const eventDate = String(row?.Date || '').trim();
        const playerKey = getPlayerIdentityKey(row?.Player);
        const rank = Number(row?.Rank);

        if (!deckName || !eventName || !eventDate || !playerKey || !Number.isFinite(rank) || rank <= 0) {
          return false;
        }

        const matchingDeckRows = currentLeaderboardSourceRows.filter(sourceRow => {
          const sourceDeckName = String(sourceRow?.Deck || '').trim();
          const sourceEventName = String(sourceRow?.Event || '').trim();
          const sourceEventDate = String(sourceRow?.Date || '').trim();
          const sourceRank = Number(sourceRow?.Rank);

          return (
            sourceDeckName === deckName &&
            sourceEventName === eventName &&
            sourceEventDate === eventDate &&
            Number.isFinite(sourceRank) &&
            sourceRank > 0
          );
        });

        if (matchingDeckRows.length === 0) {
          return false;
        }

        const bestDeckRank = Math.min(...matchingDeckRows.map(sourceRow => Number(sourceRow.Rank)));
        return rank === bestDeckRank;
      }).length;

      return {
        deck,
        rows: sortedRows,
        events,
        wins,
        losses,
        winRate,
        averageFinish,
        bestFinish,
        worstFinish,
        top1,
        top8,
        deckLeadCount,
        deckLeadRate: events > 0 ? (deckLeadCount / events) * 100 : 0,
        latestDate
      };
    });
}

function sortLeaderboardDeckGroups(deckGroups = [], sortKey = leaderboardDeckResultsSort) {
  const normalizedSortKey = String(sortKey || 'events');
  const sortedGroups = [...deckGroups];

  sortedGroups.sort((a, b) => {
    switch (normalizedSortKey) {
      case 'top1':
        return (
          b.top1 - a.top1 ||
          b.events - a.events ||
          b.top8 - a.top8 ||
          b.winRate - a.winRate ||
          a.averageFinish - b.averageFinish ||
          a.deck.localeCompare(b.deck)
        );
      case 'top8':
        return (
          b.top8 - a.top8 ||
          b.top1 - a.top1 ||
          b.events - a.events ||
          b.winRate - a.winRate ||
          a.averageFinish - b.averageFinish ||
          a.deck.localeCompare(b.deck)
        );
      case 'winRate':
        return (
          b.winRate - a.winRate ||
          b.events - a.events ||
          b.top1 - a.top1 ||
          b.top8 - a.top8 ||
          a.averageFinish - b.averageFinish ||
          a.deck.localeCompare(b.deck)
        );
      case 'averageFinish':
        return (
          a.averageFinish - b.averageFinish ||
          b.events - a.events ||
          b.top1 - a.top1 ||
          b.top8 - a.top8 ||
          b.winRate - a.winRate ||
          a.deck.localeCompare(b.deck)
        );
      case 'events':
      default:
        return (
          b.events - a.events ||
          b.top1 - a.top1 ||
          b.top8 - a.top8 ||
          b.winRate - a.winRate ||
          a.averageFinish - b.averageFinish ||
          a.deck.localeCompare(b.deck)
        );
    }
  });

  return sortedGroups;
}

function buildLeaderboardPlayerEventListHtml(rows = []) {
  if (!rows.length) {
    return '<div class="player-rank-drilldown-empty">No event results found.</div>';
  }

  return `
    <div class="player-drilldown-event-list">
      ${rows.map(row => {
        const eventLabel = formatEventName(row.Event) || row.Event || 'Unknown Event';
        const dateLabel = row.Date ? formatDate(row.Date) : '--';
        const deckLabel = String(row.Deck || '').trim() || '--';
        const wins = Number(row.Wins) || 0;
        const losses = Number(row.Losses) || 0;

        return `
          <button
            type="button"
            class="player-event-history-item"
            data-leaderboard-history-event="${escapeHtml(String(row.Event || '').trim())}"
            data-leaderboard-history-date="${escapeHtml(String(row.Date || '').trim())}"
            data-leaderboard-history-deck="${escapeHtml(deckLabel)}"
            data-leaderboard-history-rank="${escapeHtml(String(row.Rank ?? '').trim())}"
          >
            <div class="player-drilldown-event-list-main">
              <strong>${escapeHtml(eventLabel)}</strong>
              <span>${escapeHtml(dateLabel)}</span>
            </div>
            <div class="player-drilldown-event-list-topics">
              <div class="player-drilldown-event-list-topic">${escapeHtml(`Finish: #${row.Rank || '--'}`)}</div>
              <div class="player-drilldown-event-list-topic">${escapeHtml(`Record: ${wins}-${losses}`)}</div>
              <div class="player-drilldown-event-list-topic">${escapeHtml(`Deck: ${deckLabel}`)}</div>
              <div class="player-drilldown-event-list-topic">${escapeHtml(`Event Type: ${row.EventType || '--'}`)}</div>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function buildLeaderboardDeckResultsHtml(deckGroups = []) {
  if (!deckGroups.length) {
    return '<div class="player-rank-drilldown-empty">No deck results found.</div>';
  }

  const sortedDeckGroups = sortLeaderboardDeckGroups(deckGroups);
  const shouldShowSortControls = deckGroups.length > 1;
  const totalEvents = deckGroups.reduce((sum, group) => sum + (Number(group?.events) || 0), 0);

  return `
    ${shouldShowSortControls ? `
      <div class="leaderboard-deck-results-sort">
        <span class="player-rank-drilldown-summary-label leaderboard-deck-results-sort-label">Sort Deck Results By</span>
        <div class="bubble-menu leaderboard-deck-results-sort-controls">
          <button type="button" class="bubble-button table-toggle-btn${leaderboardDeckResultsSort === 'events' ? ' active' : ''}" data-leaderboard-deck-sort="events">Events</button>
          <button type="button" class="bubble-button table-toggle-btn${leaderboardDeckResultsSort === 'top1' ? ' active' : ''}" data-leaderboard-deck-sort="top1">Top 1</button>
          <button type="button" class="bubble-button table-toggle-btn${leaderboardDeckResultsSort === 'top8' ? ' active' : ''}" data-leaderboard-deck-sort="top8">Top 8</button>
          <button type="button" class="bubble-button table-toggle-btn${leaderboardDeckResultsSort === 'winRate' ? ' active' : ''}" data-leaderboard-deck-sort="winRate">Win Rate</button>
          <button type="button" class="bubble-button table-toggle-btn${leaderboardDeckResultsSort === 'averageFinish' ? ' active' : ''}" data-leaderboard-deck-sort="averageFinish">Avg Finish</button>
        </div>
      </div>
    ` : ''}
    <div class="leaderboard-deck-results-grid">
      ${sortedDeckGroups.map(group => `
        ${(() => {
          const eventShare = totalEvents > 0 ? (group.events / totalEvents) * 100 : 0;
          const eventCountLabel = `${group.events} Events`;
          const shouldShowEventShare = !(totalEvents === 1 && group.events === 1);
          return `
        <article class="leaderboard-deck-result-card">
          <div class="leaderboard-deck-result-header">
            <div class="leaderboard-deck-result-heading">
              <div class="player-rank-drilldown-event-date">${escapeHtml(group.latestDate ? formatDate(group.latestDate) : 'No recent event')}</div>
              <h5 class="leaderboard-deck-result-name">${escapeHtml(group.deck)}</h5>
            </div>
            <span class="player-rank-drilldown-rank-badge leaderboard-deck-result-badge">
              <span>${escapeHtml(eventCountLabel)}</span>
              ${shouldShowEventShare ? `<span>${escapeHtml(`(${formatLeaderboardPercentage(eventShare)})`)}</span>` : ''}
            </span>
          </div>
          <div class="leaderboard-deck-result-stats">
            <div class="player-rank-drilldown-summary-item updated">
              <span class="player-rank-drilldown-summary-label">Wins / Losses</span>
              <strong class="player-rank-drilldown-summary-value">${escapeHtml(`${group.wins} / ${group.losses}`)}</strong>
            </div>
            <div class="player-rank-drilldown-summary-item updated">
              <span class="player-rank-drilldown-summary-label">Win Rate</span>
              <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatLeaderboardPercentage(group.winRate))}</strong>
            </div>
            <div class="player-rank-drilldown-summary-item updated">
              <span class="player-rank-drilldown-summary-label">Avg Finish</span>
              <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatLeaderboardAverageFinish(group.averageFinish))}</strong>
            </div>
            <div class="player-rank-drilldown-summary-item updated">
              <span class="player-rank-drilldown-summary-label">Best / Worst Finish</span>
              <strong class="player-rank-drilldown-summary-value">${escapeHtml(
                `${group.bestFinish === Number.POSITIVE_INFINITY ? '--' : `#${group.bestFinish}`} / ${group.worstFinish === Number.POSITIVE_INFINITY ? '--' : `#${group.worstFinish}`}`
              )}</strong>
            </div>
            <div class="player-rank-drilldown-summary-item updated">
              <span class="player-rank-drilldown-summary-label">Top 1 / Top 8</span>
              <strong class="player-rank-drilldown-summary-value">${escapeHtml(`${group.top1} / ${group.top8}`)}</strong>
            </div>
            <div
              class="player-rank-drilldown-summary-item updated analysis-filter-tooltip"
              data-tooltip="Counts events where this player had the best finish among all pilots of this same deck in the selected leaderboard filters."
            >
              <span class="player-rank-drilldown-summary-label">Deck Lead Finishes</span>
              <strong class="player-rank-drilldown-summary-value">${escapeHtml(`${group.deckLeadCount} (${formatLeaderboardPercentage(group.deckLeadRate)})`)}</strong>
            </div>
          </div>
        </article>
          `;
        })()}
      `).join('')}
    </div>
  `;
}

function buildLeaderboardPlayerSummaryHtml(rows = [], { collapsePlayers = true } = {}) {
  if (!rows.length) {
    return '<div class="player-rank-drilldown-empty">No leaderboard players found.</div>';
  }

  const shouldCollapsePlayers = collapsePlayers && rows.length > 1;

  return rows.map(row => {
    const playerRows = getLeaderboardPlayerRows(row.playerKey);
    const deckGroups = getLeaderboardPlayerDeckGroups(playerRows);
    const recentRows = playerRows.slice(0, 8);
    const playerBodyId = `leaderboardPlayerBody-${String(row.playerKey || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const recentResultsId = `leaderboardRecentResults-${String(row.playerKey || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const playerMeta = `${row.score} pts | ${row.top1} Top 1 | ${formatLeaderboardPercentage(row.winRate)} WR`;
    const playerHeaderLabel = `${row.player || '--'}${formatPlayerDeckHeaderLabel(deckGroups)}`;

    return `
      <article class="player-rank-drilldown-event">
        ${shouldCollapsePlayers ? `
          <button
            type="button"
              class="event-stat-drilldown-list-item player-summary-event-toggle leaderboard-player-card-toggle-row"
              data-leaderboard-player-toggle="${escapeHtml(playerBodyId)}"
              aria-expanded="false"
              aria-controls="${escapeHtml(playerBodyId)}"
            >
              <span class="event-stat-drilldown-list-item-date">${escapeHtml(row.latestDate ? formatDate(row.latestDate) : 'No recent event')}</span>
              <span class="event-stat-drilldown-list-item-main">${escapeHtml(playerHeaderLabel)}</span>
              <span class="event-stat-drilldown-list-item-meta">${escapeHtml(playerMeta)}</span>
              <span class="player-summary-event-toggle-indicator drilldown-toggle-indicator" aria-hidden="true">+</span>
            </button>
        ` : `
          <div class="player-rank-drilldown-event-header leaderboard-player-card-header">
            <div>
              <div class="player-rank-drilldown-event-date">${escapeHtml(row.latestDate ? formatDate(row.latestDate) : 'No recent event')}</div>
              <h4 class="player-rank-drilldown-event-name">${escapeHtml(playerHeaderLabel)}</h4>
            </div>
            <div class="leaderboard-player-card-header-actions">
              <span class="player-rank-drilldown-rank-badge">${escapeHtml(`${row.score} pts`)}</span>
            </div>
          </div>
        `}
        <div id="${escapeHtml(playerBodyId)}" class="leaderboard-player-card-body"${shouldCollapsePlayers ? ' hidden' : ''}>
        <div class="player-rank-drilldown-summary-grid leaderboard-player-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Events</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(row.events)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Wins</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(row.wins)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Losses</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(row.losses)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Win Rate</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatLeaderboardPercentage(row.winRate))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Top 1 / Top 8</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(`${row.top1} / ${row.top8}`)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Avg Finish</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatLeaderboardAverageFinish(row.averageFinish))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Best / Worst Finish</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(
              `${row.bestFinish === Number.POSITIVE_INFINITY ? '--' : `#${row.bestFinish}`} / ${row.worstFinish === Number.POSITIVE_INFINITY ? '--' : `#${row.worstFinish}`}`
            )}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Unique Decks</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(row.uniqueDecks)}</strong>
          </div>
        </div>
        <div class="player-rank-drilldown-context">
          <div class="player-rank-drilldown-context-title">Deck Results</div>
          ${buildLeaderboardDeckResultsHtml(deckGroups)}
        </div>
        <div class="player-rank-drilldown-context">
          <div class="player-rank-drilldown-context-header leaderboard-player-results-header">
            <div class="player-rank-drilldown-context-title">Recent Results</div>
            <button
              type="button"
              class="leaderboard-results-toggle drilldown-toggle-indicator"
              data-leaderboard-results-toggle="${escapeHtml(recentResultsId)}"
              aria-expanded="false"
              aria-controls="${escapeHtml(recentResultsId)}"
              title="Show recent results"
            >
              +
            </button>
          </div>
          <div id="${escapeHtml(recentResultsId)}" class="leaderboard-player-results-body" hidden>
            ${buildLeaderboardPlayerEventListHtml(recentRows)}
          </div>
        </div>
        </div>
      </article>
    `;
  }).join('');
}

function getLeaderboardDrilldownItems(categoryKey) {
  switch (categoryKey) {
    case 'totalEvents':
      return getLeaderboardSelectedEventEntries(currentLeaderboardSourceRows);
    case 'trackedPlayers':
      return [...currentLeaderboardRows].sort(compareLeaderboardRows);
    case 'leader': {
      const topRows = getRowsAtMaxValue(currentLeaderboardRows, 'score');
      return topRows.filter(row => Number.isFinite(row.score));
    }
    case 'mostTrophies': {
      const topRows = getRowsAtMaxValue(currentLeaderboardRows, 'top1');
      const maxValue = topRows[0]?.top1 || 0;
      return maxValue > 0 ? topRows : [];
    }
    case 'mostMatchWins': {
      const topRows = getRowsAtMaxValue(currentLeaderboardRows, 'wins');
      const maxValue = topRows[0]?.wins || 0;
      return maxValue > 0 ? topRows : [];
    }
    default:
      return [];
  }
}

function updateLeaderboardDrilldownCardStates() {
  Object.entries(LEADERBOARD_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const itemCount = getLeaderboardDrilldownItems(categoryKey).length;
    const isDisabled = itemCount === 0;

    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
    card.title = isDisabled
      ? config.emptyMessage
      : `Open ${config.title.toLowerCase()} details`;
  });
}

function renderLeaderboardDrilldown(categoryKey) {
  const elements = getLeaderboardDrilldownElements();
  const config = LEADERBOARD_DRILLDOWN_CONFIG[categoryKey];
  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const items = getLeaderboardDrilldownItems(categoryKey);
  elements.title.textContent = config.title;

  if (categoryKey === 'totalEvents') {
    const eventCount = items.length;
    elements.subtitle.textContent = eventCount > 0
      ? `${eventCount} event${eventCount === 1 ? '' : 's'} in the current Leaderboards filters`
      : config.emptyMessage;
    elements.content.innerHTML = eventCount > 0
      ? buildLeaderboardEventListHtml(items)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'trackedPlayers') {
    const playerCount = items.length;
    elements.subtitle.textContent = playerCount > 0
      ? `${playerCount} tracked player${playerCount === 1 ? '' : 's'} in the current Leaderboards filters`
      : config.emptyMessage;
    elements.content.innerHTML = playerCount > 0
      ? buildLeaderboardPlayerSummaryHtml(items, { collapsePlayers: true })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'leader') {
    const leaderCount = items.length;
    const topScore = items[0]?.score || 0;
    elements.subtitle.textContent = leaderCount > 0
      ? `${leaderCount} player${leaderCount === 1 ? '' : 's'} tied at ${topScore} point${topScore === 1 ? '' : 's'}`
      : config.emptyMessage;
    elements.content.innerHTML = leaderCount > 0
      ? buildLeaderboardPlayerSummaryHtml(items, { collapsePlayers: true })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'mostTrophies') {
    const playerCount = items.length;
    const trophyCount = items[0]?.top1 || 0;
    elements.subtitle.textContent = playerCount > 0
      ? `${playerCount} player${playerCount === 1 ? '' : 's'} with ${trophyCount} Top 1 finish${trophyCount === 1 ? '' : 'es'}`
      : config.emptyMessage;
    elements.content.innerHTML = playerCount > 0
      ? buildLeaderboardPlayerSummaryHtml(items, { collapsePlayers: true })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  const playerCount = items.length;
  const winCount = items[0]?.wins || 0;
  elements.subtitle.textContent = playerCount > 0
    ? `${playerCount} player${playerCount === 1 ? '' : 's'} with ${winCount} match win${winCount === 1 ? '' : 's'}`
    : config.emptyMessage;
  elements.content.innerHTML = playerCount > 0
    ? buildLeaderboardPlayerSummaryHtml(items, { collapsePlayers: true })
    : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
}

function openLeaderboardDrilldown(categoryKey) {
  const elements = getLeaderboardDrilldownElements();
  if (!elements.overlay || !LEADERBOARD_DRILLDOWN_CONFIG[categoryKey]) {
    return;
  }

  activeLeaderboardDrilldownCategory = categoryKey;
  renderLeaderboardDrilldown(categoryKey);
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function openLeaderboardPlayerStatsDrilldown(playerKey = '') {
  const normalizedPlayerKey = String(playerKey || '').trim();
  if (!normalizedPlayerKey) {
    return;
  }

  const elements = getLeaderboardDrilldownElements();
  if (!elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const matchingRow = currentLeaderboardRows.find(row => row.playerKey === normalizedPlayerKey);
  if (!matchingRow) {
    return;
  }

  elements.title.textContent = matchingRow.player || 'Leaderboard Player';
  elements.subtitle.textContent = `${matchingRow.score} pts | ${matchingRow.events} event${matchingRow.events === 1 ? '' : 's'} | ${formatLeaderboardPercentage(matchingRow.winRate)} WR`;
  elements.content.innerHTML = buildLeaderboardPlayerSummaryHtml([matchingRow], { collapsePlayers: false });
  activeLeaderboardDrilldownCategory = '';
  activeLeaderboardPlayerDrilldownKey = normalizedPlayerKey;
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function openLeaderboardEventHistoryDrilldown({ eventName = '', eventDate = '', deckName = '', rank = '' } = {}) {
  const elements = getLeaderboardDrilldownElements();
  if (!elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerRow = getLeaderboardEventHistoryRow({ eventName, eventDate, deckName, rank });
  if (!playerRow) {
    elements.title.textContent = 'Leaderboard Event Details';
    elements.subtitle.textContent = 'Event details are not available for the selected history entry.';
    elements.content.innerHTML = '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
    activeLeaderboardDrilldownCategory = '';
    activeLeaderboardPlayerDrilldownKey = '';
    elements.overlay.hidden = false;
    document.body.classList.add('modal-open');
    return;
  }

  const formattedEventName = formatEventName(playerRow.Event) || playerRow.Event || 'Unknown Event';
  const eventDateLabel = playerRow.Date ? formatDate(playerRow.Date) : '--';
  const deckLabel = String(playerRow.Deck || '').trim() || '--';
  const rankLabel = playerRow.Rank ? `#${playerRow.Rank}` : '#--';

  elements.title.textContent = `Leaderboard - ${formattedEventName}`;
  elements.subtitle.textContent = `${eventDateLabel} | ${deckLabel} | ${rankLabel} | ${getLeaderboardRowWinRateText(playerRow)} WR`;
  elements.content.innerHTML = buildLeaderboardEventResultDrilldownHtml(playerRow);
  activeLeaderboardDrilldownCategory = '';
  activeLeaderboardPlayerDrilldownKey = '';
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'bubble-button';
  openBtn.textContent = 'Open in Event Analysis';
  openBtn.style.marginLeft = '10px';
  elements.title.appendChild(openBtn);

  openBtn.addEventListener('click', () => {
    const eventBtn = document.querySelector('.top-mode-button[data-top-mode="event"]');
    if (eventBtn) {
      eventBtn.click();
    }

    const singleBtn = document.querySelector('.analysis-mode[data-mode="single"]');
    if (singleBtn) {
      singleBtn.click();
    }

    import('./filters.js').then(module => {
      if (playerRow.EventType) {
        module.setSingleEventType(String(playerRow.EventType).toLowerCase());
      }
      module.updateEventFilter(playerRow.Event, true);

      const eventFilterMenu = document.getElementById('eventFilterMenu');
      if (eventFilterMenu) {
        eventFilterMenu.dispatchEvent(new Event('change'));
      }

      closeLeaderboardDrilldown();
      window.scrollTo(0, 0);
    });
  });
}

function openLeaderboardEventInAnalysis(eventName = '', eventType = '') {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedEventType = String(eventType || '').trim().toLowerCase();
  if (!normalizedEventName) {
    return;
  }

  const eventBtn = document.querySelector('.top-mode-button[data-top-mode="event"]');
  if (eventBtn) {
    eventBtn.click();
  }

  const singleBtn = document.querySelector('.analysis-mode[data-mode="single"]');
  if (singleBtn) {
    singleBtn.click();
  }

  import('./filters.js').then(module => {
    if (normalizedEventType) {
      module.setSingleEventType(normalizedEventType);
    }
    module.updateEventFilter(normalizedEventName, true);

    const eventFilterMenu = document.getElementById('eventFilterMenu');
    if (eventFilterMenu) {
      eventFilterMenu.dispatchEvent(new Event('change'));
    }

    closeLeaderboardDrilldown();
    window.scrollTo(0, 0);
  });
}

function closeLeaderboardDrilldown() {
  const { overlay } = getLeaderboardDrilldownElements();
  if (!overlay) {
    return;
  }

  overlay.hidden = true;
  activeLeaderboardDrilldownCategory = '';
  activeLeaderboardPlayerDrilldownKey = '';
  document.body.classList.remove('modal-open');
}

function setupLeaderboardDrilldownModal() {
  const { overlay, closeButton, content } = getLeaderboardDrilldownElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closeLeaderboardDrilldown);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeLeaderboardDrilldown();
    }
  });

  content?.addEventListener('click', event => {
    const eventToggleButton = event.target.closest('[data-leaderboard-event-toggle]');
    if (eventToggleButton) {
      const targetId = eventToggleButton.dataset.leaderboardEventToggle || '';
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) {
        return;
      }

      const shouldExpand = eventToggleButton.getAttribute('aria-expanded') !== 'true';
      eventToggleButton.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
      const indicator = eventToggleButton.querySelector('.player-summary-event-toggle-indicator');
      if (indicator) {
        indicator.textContent = shouldExpand ? '-' : '+';
      }
      target.hidden = !shouldExpand;
      return;
    }

    const openEventAnalysisButton = event.target.closest('[data-leaderboard-open-event-analysis]');
    if (openEventAnalysisButton) {
      openLeaderboardEventInAnalysis(
        openEventAnalysisButton.dataset.leaderboardOpenEventAnalysis,
        openEventAnalysisButton.dataset.leaderboardOpenEventType
      );
      return;
    }

    const playerToggleButton = event.target.closest('[data-leaderboard-player-toggle]');
    if (playerToggleButton) {
      const targetId = playerToggleButton.dataset.leaderboardPlayerToggle || '';
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) {
        return;
      }

      const shouldExpand = playerToggleButton.getAttribute('aria-expanded') !== 'true';
      playerToggleButton.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
      const indicator = playerToggleButton.querySelector('.player-summary-event-toggle-indicator');
      if (indicator) {
        indicator.textContent = shouldExpand ? '-' : '+';
      }
      target.hidden = !shouldExpand;
      return;
    }

    const historyButton = event.target.closest('.player-event-history-item');
    if (historyButton) {
      openLeaderboardEventHistoryDrilldown({
        eventName: historyButton.dataset.leaderboardHistoryEvent,
        eventDate: historyButton.dataset.leaderboardHistoryDate,
        deckName: historyButton.dataset.leaderboardHistoryDeck,
        rank: historyButton.dataset.leaderboardHistoryRank
      });
      return;
    }

    const deckSortButton = event.target.closest('[data-leaderboard-deck-sort]');
    if (deckSortButton) {
      const nextSort = deckSortButton.dataset.leaderboardDeckSort || 'events';
      leaderboardDeckResultsSort = nextSort;
      if (activeLeaderboardDrilldownCategory) {
        renderLeaderboardDrilldown(activeLeaderboardDrilldownCategory);
      } else if (activeLeaderboardPlayerDrilldownKey) {
        openLeaderboardPlayerStatsDrilldown(activeLeaderboardPlayerDrilldownKey);
      }
      return;
    }

    const toggleButton = event.target.closest('[data-leaderboard-results-toggle]');
    if (!toggleButton) {
      return;
    }

    const targetId = toggleButton.dataset.leaderboardResultsToggle || '';
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) {
      return;
    }

    const shouldExpand = toggleButton.getAttribute('aria-expanded') !== 'true';
    toggleButton.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
    toggleButton.textContent = shouldExpand ? '-' : '+';
    toggleButton.title = shouldExpand ? 'Hide recent results' : 'Show recent results';
    target.hidden = !shouldExpand;
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeLeaderboardDrilldown();
    }
  });
}

function setupLeaderboardDrilldownCards() {
  Object.entries(LEADERBOARD_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openLeaderboardDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openLeaderboardDrilldown(categoryKey);
      }
    });
  });
}

function getLeaderboardStats(leaderboardRows = [], filteredRows = []) {
  const uniqueEvents = new Set(filteredRows.map(row => String(row.Event || '').trim()).filter(Boolean));
  const leader = leaderboardRows[0] || null;
  const mostTrophiesRows = getRowsAtMaxValue(leaderboardRows, 'top1');
  const mostMatchWinsRows = getRowsAtMaxValue(leaderboardRows, 'wins');

  return {
    totalEvents: uniqueEvents.size,
    trackedPlayers: leaderboardRows.length,
    leader,
    mostTrophiesRows,
    mostMatchWinsRows
  };
}

function populateLeaderboardStats(leaderboardRows = [], filteredRows = []) {
  const stats = getLeaderboardStats(leaderboardRows, filteredRows);
  const startDate = getLeaderboardStartDateSelect()?.value || '';
  const endDate = getLeaderboardEndDateSelect()?.value || '';
  const activeLabel = getActivePresetDisplayLabel();
  const leader = stats.leader;
  const tiedLeaders = getRowsAtMaxValue(leaderboardRows, 'score').filter(row => Number.isFinite(row.score));
  const leaderNames = tiedLeaders.map(row => row.player).filter(Boolean);
  const leaderHoverLabel = leaderNames.join(', ');
  const trophyLeaders = stats.mostTrophiesRows;
  const matchWinLeaders = stats.mostMatchWinsRows;
  const topTrophyValue = trophyLeaders[0]?.top1 || 0;
  const topMatchWinValue = matchWinLeaders[0]?.wins || 0;

  updateElementText('leaderboardTotalEvents', String(stats.totalEvents || 0));
  updateElementText(
    'leaderboardTotalEventsDetails',
    startDate && endDate ? formatDateRange(startDate, endDate) : 'Select a set window'
  );
  updateElementText('leaderboardTrackedPlayers', String(stats.trackedPlayers || 0));
  updateElementText(
    'leaderboardTrackedPlayersDetails',
    `${activeLabel}${stats.totalEvents ? ` / ${stats.totalEvents} event${stats.totalEvents === 1 ? '' : 's'}` : ''}`
  );
  updateElementText(
    'leaderboardLeaderName',
    tiedLeaders.length > 1 ? `${tiedLeaders.length} Players Tied` : (leader?.player || '--')
  );
  updateElementText(
    'leaderboardLeaderDetails',
    tiedLeaders.length > 1
      ? formatDisplayNamesWithAndMore(leaderNames)
      : (
        leader
          ? `${leader.score} pts / ${leader.top1} Top 1 / ${formatLeaderboardPercentage(leader.winRate)} WR`
          : '0 pts / --'
      )
  );
  const leaderCard = document.getElementById('leaderboardLeaderCard');
  const leaderNameElement = document.getElementById('leaderboardLeaderName');
  const leaderDetailsElement = document.getElementById('leaderboardLeaderDetails');
  const leaderTooltip = tiedLeaders.length > 1 && leaderHoverLabel
    ? `Tied leaders: ${leaderHoverLabel}`
    : (leader?.player || '');
  if (leaderCard) {
    leaderCard.title = leaderTooltip;
  }
  if (leaderNameElement) {
    leaderNameElement.title = leaderTooltip;
  }
  if (leaderDetailsElement) {
    leaderDetailsElement.title = leaderTooltip;
  }
  updateElementText(
    'leaderboardMostTrophiesName',
    trophyLeaders.length > 1 ? `${trophyLeaders.length} Players Tied` : formatDisplayNames(trophyLeaders.map(row => row.player))
  );
  updateElementText(
    'leaderboardMostTrophiesDetails',
    topTrophyValue > 0
      ? (
        trophyLeaders.length > 1
          ? formatDisplayNamesWithAndMore(trophyLeaders.map(row => row.player))
          : `${topTrophyValue} win${topTrophyValue === 1 ? '' : 's'} / ${trophyLeaders[0]?.top8 || 0} Top 8`
      )
      : '0 wins'
  );
  updateElementText(
    'leaderboardMostMatchWinsName',
    matchWinLeaders.length > 1 ? `${matchWinLeaders.length} Players Tied` : formatDisplayNames(matchWinLeaders.map(row => row.player))
  );
  updateElementText(
    'leaderboardMostMatchWinsDetails',
    topMatchWinValue > 0
      ? (
        matchWinLeaders.length > 1
          ? formatDisplayNamesWithAndMore(matchWinLeaders.map(row => row.player))
          : `${topMatchWinValue} wins / ${formatLeaderboardPercentage(matchWinLeaders[0]?.winRate || 0)} WR`
      )
      : '0 wins / 0.00% WR'
  );

  LEADERBOARD_STAT_CARD_IDS.forEach(triggerUpdateAnimation);
}

function sortLeaderboardRows(rows = []) {
  const sortedRows = [...rows];
  const { key, direction } = leaderboardTableSort;
  const multiplier = direction === 'asc' ? 1 : -1;

  sortedRows.sort((a, b) => {
    const aValue = a[key];
    const bValue = b[key];
    const aComparable = typeof aValue === 'string' ? aValue.toLowerCase() : aValue;
    const bComparable = typeof bValue === 'string' ? bValue.toLowerCase() : bValue;

    if (aComparable < bComparable) {
      return -1 * multiplier;
    }

    if (aComparable > bComparable) {
      return 1 * multiplier;
    }

    return compareLeaderboardRows(a, b);
  });

  return sortedRows;
}

function renderLeaderboardTable() {
  const tableHead = document.getElementById('leaderboardTableHead');
  const startDate = getLeaderboardStartDateSelect()?.value || '';
  const endDate = getLeaderboardEndDateSelect()?.value || '';
  const sortedRows = sortLeaderboardRows(currentLeaderboardRows);
  const activeWindowLabel = getActivePresetDisplayLabel();
  const eventCount = new Set(getFilteredLeaderboardRows().map(row => String(row.Event || '').trim()).filter(Boolean)).size;

  if (!tableHead) {
    return;
  }

  updateElementText(
    'leaderboardTableTitle',
    eventCount > 0
      ? `Leaderboard for ${activeWindowLabel}`
      : 'Set Leaderboard'
  );
  updateElementText(
    'leaderboardTableHelper',
    eventCount > 0 && startDate && endDate
      ? `Scoring: Top 1 = 10 pts, Top 2-8 = 6 pts, Top 9-16 = 3 pts, Top 17-32 = 1 pt. ${eventCount} event${eventCount === 1 ? '' : 's'} from ${formatDate(startDate)} to ${formatDate(endDate)}.`
      : 'Scoring: Top 1 = 10 pts, Top 2-8 = 6 pts, Top 9-16 = 3 pts, Top 17-32 = 1 pt.'
  );

  tableHead.querySelectorAll('th[data-sort]').forEach(header => {
    const isActive = header.dataset.sort === leaderboardTableSort.key;
    header.classList.toggle('asc', isActive && leaderboardTableSort.direction === 'asc');
    header.classList.toggle('desc', isActive && leaderboardTableSort.direction === 'desc');
    const arrow = header.querySelector('.sort-arrow');
    if (arrow) {
      arrow.textContent = isActive ? (leaderboardTableSort.direction === 'asc' ? '^' : 'v') : '';
    }
  });

  updateElementHTML(
    'leaderboardTableBody',
    sortedRows.length === 0
      ? "<tr><td colspan='13'>No leaderboard data available for the selected filters.</td></tr>"
      : sortedRows.map(row => `
        <tr>
          <td class="leaderboard-rank-cell">${row.displayRank}</td>
          <td>${escapeHtml(row.player)}</td>
          <td>${row.score}</td>
          <td>${row.events}</td>
          <td>${row.top1}</td>
          <td>${row.top8}</td>
          <td>${row.top9_16}</td>
          <td>${row.top17_32}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${formatLeaderboardPercentage(row.winRate)}</td>
          <td class="leaderboard-average-finish">${formatAverageFinish(row.averageFinish)}</td>
          <td>${row.bestFinish === Number.POSITIVE_INFINITY ? '--' : `#${row.bestFinish}`}</td>
        </tr>
      `).join('')
  );
}

function handleLeaderboardTableSort(sortKey) {
  if (leaderboardTableSort.key === sortKey) {
    leaderboardTableSort.direction = leaderboardTableSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    leaderboardTableSort.key = sortKey;
    leaderboardTableSort.direction = ['player', 'displayRank', 'averageFinish', 'bestFinish'].includes(sortKey)
      ? 'asc'
      : 'desc';
  }

  renderLeaderboardTable();
}

function setupLeaderboardTableSorting() {
  const tableHead = document.getElementById('leaderboardTableHead');
  if (!tableHead || tableHead.dataset.listenerAdded === 'true') {
    return;
  }

  tableHead.addEventListener('click', event => {
    const header = event.target.closest('th[data-sort]');
    if (!header) {
      return;
    }

    handleLeaderboardTableSort(header.dataset.sort);
  });

  tableHead.dataset.listenerAdded = 'true';
}

function setupLeaderboardFilterListeners() {
  const eventTypeButtons = getLeaderboardEventTypeButtons();
  const quickViewRoot = getLeaderboardQuickViewRoot();
  const selectionList = document.getElementById('leaderboardSelectionList');

  eventTypeButtons.forEach(button => {
    button.addEventListener('click', () => {
      setLeaderboardEventType(button.dataset.type.toLowerCase());
      resetLeaderboardDateRange();
      updateLeaderboardDateOptions();
      if (getActiveLeaderboardPreset()) {
        applyActiveLeaderboardPresetDateRange();
      }

      if (getTopMode() === 'leaderboard') {
        updateLeaderboardAnalytics();
      }
    });
  });

  if (quickViewRoot && quickViewRoot.dataset.listenerAdded !== 'true') {
    quickViewRoot.addEventListener('click', event => {
      const yearButton = event.target.closest('.quick-view-year-button');
      if (yearButton) {
        setQuickViewYearSelection(yearButton.dataset.quickViewYear || '');
        return;
      }

      const presetButton = event.target.closest('.leaderboard-preset-button');
      if (presetButton) {
        applyLeaderboardPreset(presetButton.dataset.leaderboardPreset);
      }
    });

    quickViewRoot.dataset.listenerAdded = 'true';
  }

  if (selectionList && selectionList.dataset.listenerAdded !== 'true') {
    selectionList.addEventListener('click', event => {
      const historyButton = event.target.closest('.player-event-history-item');
      if (!historyButton) {
        return;
      }

      openLeaderboardEventHistoryDrilldown({
        eventName: historyButton.dataset.leaderboardHistoryEvent,
        eventDate: historyButton.dataset.leaderboardHistoryDate
      });
    });

    selectionList.dataset.listenerAdded = 'true';
  }
}

export function initLeaderboards() {
  const analysisRows = getAnalysisRows();
  activeQuickViewYear = getDefaultQuickViewYear(analysisRows);
  setLeaderboardEventType(DEFAULT_EVENT_TYPE);
  renderQuickViewButtons();
  setLeaderboardPresetButtonState(getLatestSetQuickViewPresetId(analysisRows));
  ensureDefaultLeaderboardPreset();
  updateLeaderboardDateOptions();
  applyActiveLeaderboardPresetDateRange();
  setupLeaderboardTableSorting();
  setupLeaderboardFilterListeners();
  setupLeaderboardDrilldownModal();
  setupLeaderboardDrilldownCards();
  updateLeaderboardSelectionSummary();
  console.log('Leaderboards initialized');
}

export function updateLeaderboardAnalytics() {
  renderQuickViewButtons();
  updateLeaderboardDateOptions();

  const filteredRows = getFilteredLeaderboardRows();
  currentLeaderboardSourceRows = Array.isArray(filteredRows) ? [...filteredRows] : [];
  currentLeaderboardRows = calculateLeaderboardRows(filteredRows);
  populateLeaderboardStats(currentLeaderboardRows, filteredRows);
  updateLeaderboardDrilldownCardStates();
  const startDate = getLeaderboardStartDateSelect()?.value || '';
  const endDate = getLeaderboardEndDateSelect()?.value || '';
  const activeWindowLabel = getActivePresetDisplayLabel();
  renderLeaderboardOverviewChart(
    currentLeaderboardRows,
    filteredRows,
    startDate,
    endDate,
    activeWindowLabel,
    row => openLeaderboardPlayerStatsDrilldown(row.playerKey)
  );
  renderLeaderboardTable();
  updateLeaderboardSelectionSummary();

  if (activeLeaderboardDrilldownCategory) {
    renderLeaderboardDrilldown(activeLeaderboardDrilldownCategory);
  }
}
