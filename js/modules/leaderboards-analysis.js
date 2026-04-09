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

let activeQuickViewYear = '';
let leaderboardGroupSelectionInitialized = false;
let activeLeaderboardGroupKeys = new Set();
let leaderboardGroupSelectionContextKey = '';
let currentLeaderboardRows = [];
let leaderboardTableSort = {
  key: 'score',
  direction: 'desc'
};

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
        bestFinish: Number.isFinite(entry.bestFinish) ? entry.bestFinish : Number.POSITIVE_INFINITY,
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
  updateElementText('leaderboardLeaderName', leader?.player || '--');
  updateElementText(
    'leaderboardLeaderDetails',
    leader
      ? `${leader.score} pts / ${leader.top1} Top 1 / ${formatLeaderboardPercentage(leader.winRate)} WR`
      : '0 pts / --'
  );
  updateElementText('leaderboardMostTrophiesName', formatDisplayNames(trophyLeaders.map(row => row.player)));
  updateElementText(
    'leaderboardMostTrophiesDetails',
    topTrophyValue > 0
      ? `${topTrophyValue} win${topTrophyValue === 1 ? '' : 's'} / ${trophyLeaders[0]?.top8 || 0} Top 8`
      : '0 wins'
  );
  updateElementText('leaderboardMostMatchWinsName', formatDisplayNames(matchWinLeaders.map(row => row.player)));
  updateElementText(
    'leaderboardMostMatchWinsDetails',
    topMatchWinValue > 0
      ? `${topMatchWinValue} wins / ${formatLeaderboardPercentage(matchWinLeaders[0]?.winRate || 0)} WR`
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
  updateLeaderboardSelectionSummary();
  console.log('Leaderboards initialized');
}

export function updateLeaderboardAnalytics() {
  renderQuickViewButtons();
  updateLeaderboardDateOptions();

  const filteredRows = getFilteredLeaderboardRows();
  currentLeaderboardRows = calculateLeaderboardRows(filteredRows);
  populateLeaderboardStats(currentLeaderboardRows, filteredRows);
  const startDate = getLeaderboardStartDateSelect()?.value || '';
  const endDate = getLeaderboardEndDateSelect()?.value || '';
  const activeWindowLabel = getActivePresetDisplayLabel();
  renderLeaderboardOverviewChart(currentLeaderboardRows, filteredRows, startDate, endDate, activeWindowLabel);
  renderLeaderboardTable();
  updateLeaderboardSelectionSummary();
}