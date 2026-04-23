// Coordinates the filter system: setup, listeners, chart refreshes, and date dropdown behavior.
import { updateEventAnalytics, updateMultiEventAnalytics } from '../event-analysis.js';
import { updatePlayerAnalytics } from '../player-analysis.js';
import { updateMatchupAnalytics } from '../matchup-analysis.js';
import { updateLeaderboardAnalytics } from '../leaderboards-analysis.js';
import { updateEventMetaWinRateChart } from '../../charts/single-meta-win-rate.js';
import { updateMultiMetaWinRateChart } from '../../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../../charts/multi-player-win-rate.js';
import { updateEventFunnelChart } from '../../charts/single-funnel.js';
import { updateDeckEvolutionChart } from '../../charts/multi-deck-evolution.js';
import { updatePlayerDeckPerformanceChart } from '../../charts/player-deck-performance.js';
import { updatePlayerWinRateChart } from '../../charts/player-win-rate.js';
import { hideAboutSection } from '../about.js';
import { renderMultiEventDateRangeCalendar, renderPlayerDateRangeCalendar } from './calendar-range-picker.js';
import {
  buildPlayerFilterOptions,
  getPlayerIdentityKey,
  rowMatchesPlayerKey
} from '../../utils/player-names.js';
import {
  getPlayerAnalysisActivePreset,
  getPlayerPresetSuggestedRange
} from '../../utils/player-analysis-presets.js';
import { getMultiEventPresetSuggestedRange } from '../../utils/multi-event-presets.js';
import {
  getAnalysisRows,
  isUnknownHeavyBelowTop32FilterEnabled,
  setUnknownHeavyBelowTop32FilterEnabled
} from '../../utils/analysis-data.js';
import {
  getTopMode,
  getAnalysisMode,
  getEventAnalysisSection,
  getPlayerAnalysisSection,
  getSectionEventTypeButtons,
  setDefaultSectionEventType,
  getSingleEventSelectedType,
  getEventAnalysisSelectedTypes,
  getPlayerAnalysisSelectedTypes,
  resetSelectValue
} from './shared.js';
import { filterState } from './state.js';
import { configureFilterRuntime } from './runtime.js';
import {
  renderQuickViewButtons,
  getMultiEventQuickViewRoot,
  getPlayerQuickViewRoot,
  getActiveMultiEventPreset,
  setMultiEventPresetButtonState,
  clearMultiEventPresetButtonState,
  getDefaultSetQuickViewPresetId,
  ensureDefaultMultiEventPreset,
  setQuickViewYearSelection,
  getScopedPlayerAnalysisRows,
  applyActiveMultiEventPresetDateRange,
  applyMultiEventPreset,
  setPlayerPresetButtonState,
  clearPlayerPresetButtonState,
  ensureDefaultPlayerPreset,
  applyActivePlayerPresetDateRange,
  applyPlayerAnalysisPreset,
  setEventAnalysisEventTypes,
  setPlayerAnalysisEventTypes
} from './quick-view.js';
import {
  buildSingleEventCalendarEntries,
  resetSingleEventCalendarSelection,
  updateEventFilter,
  updateSingleEventFilterVisibility,
  hasSelectedSingleEvent,
  applyLatestSingleEventSelection
} from './single-event.js';
import {
  getFilteredMultiEventRows,
  getFilteredPlayerAnalysisRows,
  updateMultiEventSelectionSummary,
  updatePlayerSelectionSummary,
  resetPlayerEventGroupFilterState,
  resetMultiEventGroupFilterState
} from './selection-summaries.js';

export { setSelectedSingleEvent, setSingleEventType, updateEventFilter } from './single-event.js';

// `filteredData` is the legacy shared snapshot used by some chart helpers. The
// rest of this module should prefer explicit selectors, but keeping this cache
// in sync prevents older code paths from drifting out of date.
let filteredData = [];
const EMPTY_ANALYSIS_ROWS = [];

// These caches are keyed by the exact rows array instance. When the quality
// toggle swaps datasets we get a new array identity, which naturally invalidates
// the old cached slices without extra bookkeeping.
const analysisRowsByEventTypesCache = new WeakMap();
const rowDateValuesCache = new WeakMap();
const playerRowDateValuesCache = new WeakMap();

// Refreshing the data-quality toggle touches several filter controls and can be
// triggered rapidly, so we keep handles to every scheduled pass and cancel the
// stale ones when a newer request arrives.
let analysisQualityRefreshRequestId = 0;
let analysisQualityRefreshFrameId = null;
let analysisQualityRefreshTimeoutId = null;
let analysisQualityRefreshIdleId = null;

function getResolvedAnalysisRows(rows = getAnalysisRows()) {
  return Array.isArray(rows) ? rows : EMPTY_ANALYSIS_ROWS;
}

function normalizeSelectedEventTypes(selectedEventTypes = []) {
  return [...new Set(
    (Array.isArray(selectedEventTypes) ? selectedEventTypes : [selectedEventTypes])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )].sort();
}

function getSelectedEventTypesCacheKey(selectedEventTypes = []) {
  return normalizeSelectedEventTypes(selectedEventTypes).join('||');
}

function getRowsScopedToSelectedEventTypes(rows = getAnalysisRows(), selectedEventTypes = []) {
  const resolvedRows = getResolvedAnalysisRows(rows);
  const cacheKey = getSelectedEventTypesCacheKey(selectedEventTypes);

  if (!cacheKey) {
    return EMPTY_ANALYSIS_ROWS;
  }

  let scopedRowsCache = analysisRowsByEventTypesCache.get(resolvedRows);
  if (!scopedRowsCache) {
    scopedRowsCache = new Map();
    analysisRowsByEventTypesCache.set(resolvedRows, scopedRowsCache);
  }

  if (!scopedRowsCache.has(cacheKey)) {
    // Event-type scoping is reused by menus, calendars, and preset logic. Cache
    // it so those controls can be rebuilt without rescanning the same dataset.
    const selectedEventTypeSet = new Set(cacheKey.split('||'));
    scopedRowsCache.set(
      cacheKey,
      resolvedRows.filter(row => selectedEventTypeSet.has(String(row?.EventType || '').toLowerCase()))
    );
  }

  return scopedRowsCache.get(cacheKey) || EMPTY_ANALYSIS_ROWS;
}

function getSortedUniqueDateValues(rows = []) {
  const resolvedRows = getResolvedAnalysisRows(rows);

  if (!rowDateValuesCache.has(resolvedRows)) {
    rowDateValuesCache.set(
      resolvedRows,
      [...new Set(
        resolvedRows
          .map(row => String(row?.Date || '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b))
    );
  }

  return rowDateValuesCache.get(resolvedRows) || [];
}

function getSortedUniquePlayerDateValues(rows = [], playerKey = '') {
  const resolvedRows = getResolvedAnalysisRows(rows);
  const normalizedPlayerKey = String(playerKey || '').trim();

  if (!normalizedPlayerKey) {
    return [];
  }

  let cache = playerRowDateValuesCache.get(resolvedRows);
  if (!cache) {
    cache = new Map();
    playerRowDateValuesCache.set(resolvedRows, cache);
  }

  if (!cache.has(normalizedPlayerKey)) {
    cache.set(
      normalizedPlayerKey,
      [...new Set(
        resolvedRows
          .filter(row => rowMatchesPlayerKey(row, normalizedPlayerKey))
          .map(row => String(row?.Date || '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b))
    );
  }

  return cache.get(normalizedPlayerKey) || [];
}

function cancelScheduledAnalysisQualityRefresh() {
  if (analysisQualityRefreshFrameId !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(analysisQualityRefreshFrameId);
  }

  if (analysisQualityRefreshTimeoutId !== null) {
    window.clearTimeout(analysisQualityRefreshTimeoutId);
  }

  if (analysisQualityRefreshIdleId !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(analysisQualityRefreshIdleId);
  }

  analysisQualityRefreshFrameId = null;
  analysisQualityRefreshTimeoutId = null;
  analysisQualityRefreshIdleId = null;
}

function scheduleAnalysisQualityRefreshOnNextFrame(callback) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    analysisQualityRefreshFrameId = window.requestAnimationFrame(() => {
      analysisQualityRefreshFrameId = null;
      callback();
    });
    return;
  }

  analysisQualityRefreshTimeoutId = window.setTimeout(() => {
    analysisQualityRefreshTimeoutId = null;
    callback();
  }, 0);
}

function scheduleAnalysisQualityRefreshWhenIdle(callback) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    analysisQualityRefreshIdleId = window.requestIdleCallback(() => {
      analysisQualityRefreshIdleId = null;
      callback();
    }, { timeout: 250 });
    return;
  }

  analysisQualityRefreshTimeoutId = window.setTimeout(() => {
    analysisQualityRefreshTimeoutId = null;
    callback();
  }, 0);
}

function getAnalysisQualityToggleButtons() {
  return Array.from(document.querySelectorAll('[data-analysis-quality-toggle="unknown-heavy-below-top32"]'));
}

function syncAnalysisQualityStatusChip(isEnabled) {
  const statusChip = document.getElementById('analysisQualityStatusChip');
  if (!statusChip) {
    return;
  }

  statusChip.classList.toggle('active', isEnabled);
  statusChip.setAttribute('aria-label', isEnabled ? 'Quality-filtered dataset active' : 'Full dataset active');

  const stateElement = statusChip.querySelector('.analysis-quality-status-chip-state');
  if (stateElement) {
    stateElement.textContent = isEnabled ? 'Quality-Filtered' : 'Full Dataset';
  }
}

function syncAnalysisQualityToggleButtons() {
  const isEnabled = isUnknownHeavyBelowTop32FilterEnabled();
  document.body.dataset.analysisQualityMode = isEnabled ? 'on' : 'off';
  syncAnalysisQualityStatusChip(isEnabled);

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
  const refreshRequestId = analysisQualityRefreshRequestId + 1;
  analysisQualityRefreshRequestId = refreshRequestId;

  syncAnalysisQualityToggleButtons();
  cancelScheduledAnalysisQualityRefresh();

  // Rebuild dependent controls on the next frame so the toggle itself updates
  // immediately, then let the more expensive chart redraw happen when idle.
  scheduleAnalysisQualityRefreshOnNextFrame(() => {
    if (refreshRequestId !== analysisQualityRefreshRequestId) {
      return;
    }

    renderQuickViewButtons('multi');
    renderQuickViewButtons('player');
    updateEventFilter(selectedSingleEvent, Boolean(selectedSingleEvent));
    if (selectedEventType && !document.getElementById('eventFilterMenu')?.value) {
      const fallbackEvent = buildSingleEventCalendarEntries(selectedEventType)[0]?.name || '';
      if (fallbackEvent) {
        updateEventFilter(fallbackEvent, true);
      }
    }

    if (activeMultiEventPreset) {
      applyActiveMultiEventPresetDateRange();
    } else {
      updateDateOptions();
    }

    updatePlayerDateOptions();
    if (activePlayerPreset) {
      applyActivePlayerPresetDateRange();
    }

    scheduleAnalysisQualityRefreshWhenIdle(() => {
      if (refreshRequestId !== analysisQualityRefreshRequestId) {
        return;
      }

      updateAllCharts();
    });
  });
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

function resetMultiDateRange() {
  resetSelectValue('startDateSelect');
  resetSelectValue('endDateSelect');
  resetMultiEventGroupFilterState();
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

configureFilterRuntime({
  updateAllCharts,
  updateDateOptions,
  updatePlayerDateOptions,
  updateMultiEventSelectionSummary,
  updatePlayerSelectionSummary,
  resetMultiDateRange,
  resetPlayerDateRange
});

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

// Initializes all filter controls to a coherent default state and triggers the
// first dashboard render.
export function setupFilters() {
  console.log('Setting up filters...');

  // Establish default control state before the first render so every module sees
  // a complete, valid filter selection.
  setupAnalysisQualityToggleListeners();
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

// Central render router called by filter interactions and theme refreshes.
export function updateAllCharts() {
  // This is the central render router for the dashboard. Filter interactions
  // funnel through here so each top-level mode can refresh from one shared,
  // consistent snapshot of the current selections.
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
  } else if (activeTopMode === 'deck-matchup' || activeTopMode === 'player-matchup') {
    updateMatchupAnalytics();
  } else if (activeTopMode === 'leaderboard') {
    updateLeaderboardAnalytics();
  }

  updatePlayerSelectionSummary();
}

// Returns rows for the single-event funnel chart.
export function getFunnelChartData() {
  // Funnel data is intentionally rebuilt from analysis rows rather than the
  // legacy filteredData cache because it also honors rank-range controls.
  const selectedEventType = getSingleEventSelectedType();
  const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';
  const positionStart = parseInt(document.getElementById('positionStartSelect')?.value, 10) || 1;
  const positionEnd = parseInt(document.getElementById('positionEndSelect')?.value, 10) || Infinity;

  const filtered = getAnalysisRows().filter(row => {
    return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
  });

  return filtered.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

// Returns rows for the single-event meta/win-rate chart.
export function getMetaWinRateChartData() {
  const selectedEventType = getSingleEventSelectedType();
  const selectedEvent = document.getElementById('eventFilterMenu')?.value || '';

  return getAnalysisRows().filter(row => {
    return row.EventType.toLowerCase() === selectedEventType && row.Event === selectedEvent;
  });
}

// Returns rows for charts that use the active multi-event window.
export function getMultiEventChartData() {
  return getFilteredMultiEventRows();
}

// Returns rows for the deck evolution chart.
export function getDeckEvolutionChartData() {
  const positionStart = parseInt(document.getElementById('positionStartSelect')?.value, 10) || 1;
  const positionEnd = parseInt(document.getElementById('positionEndSelect')?.value, 10) || Infinity;
  const multiEventData = getMultiEventChartData();

  return multiEventData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);
}

// Returns rows for the selected player's deck-performance chart.
export function getPlayerDeckPerformanceChartData() {
  return getFilteredPlayerAnalysisRows().filter(row => row.Deck !== 'No Show');
}

// Returns rows for the selected player's win-rate timeline.
export function getPlayerWinRateChartData() {
  return getPlayerDeckPerformanceChartData();
}

// Wires the top-mode navigation buttons.
export function setupTopModeListeners() {
  const topModeButtons = document.querySelectorAll('.top-mode-button');
  const eventAnalysisSection = document.getElementById('eventAnalysisSection');
  const playerAnalysisSection = document.getElementById('playerAnalysisSection');
  const matchupSection = document.getElementById('matchupSection');
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
        if (matchupSection) {
          matchupSection.style.display = 'none';
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
        if (matchupSection) {
          matchupSection.style.display = 'none';
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
      } else if (mode === 'deck-matchup' || mode === 'player-matchup') {
        if (eventAnalysisSection) {
          eventAnalysisSection.style.display = 'none';
        }
        if (playerAnalysisSection) {
          playerAnalysisSection.style.display = 'none';
        }
        if (matchupSection) {
          matchupSection.style.display = 'block';
        }
        if (leaderboardsSection) {
          leaderboardsSection.style.display = 'none';
        }

        updateMatchupAnalytics();
      } else if (mode === 'leaderboard') {
        if (eventAnalysisSection) {
          eventAnalysisSection.style.display = 'none';
        }
        if (playerAnalysisSection) {
          playerAnalysisSection.style.display = 'none';
        }
        if (matchupSection) {
          matchupSection.style.display = 'none';
        }
        if (leaderboardsSection) {
          leaderboardsSection.style.display = 'block';
        }

        updateLeaderboardAnalytics();
      }
    });
  });
}

// Wires Event Analysis single/multi mode buttons.
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

// Wires event-type buttons for Event and Player analysis sections.
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
        resetSingleEventCalendarSelection();
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

// Wires hidden single-event select changes for legacy compatibility.
export function setupEventFilterListeners() {
  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (eventFilterMenu) {
    eventFilterMenu.addEventListener('change', updateAllCharts);
  }
}

// Wires player filter changes.
export function setupPlayerFilterListeners() {
  const playerFilterMenu = document.getElementById('playerFilterMenu');
  const playerStartDateSelect = document.getElementById('playerStartDateSelect');
  const playerEndDateSelect = document.getElementById('playerEndDateSelect');
  const playerQuickViewRoot = getPlayerQuickViewRoot();

  if (playerFilterMenu) {
    playerFilterMenu.addEventListener('change', () => {
      filterState.playerSelectionInitialized = true;
      filterState.playerSelectionKey = playerFilterMenu.value || '';
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

// Wires quick-view preset buttons for multi-event/player views.
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

// Rebuilds multi-event date controls after event type or preset changes.
export function updateDateOptions() {
  const startDateSelect = document.getElementById('startDateSelect');
  const endDateSelect = document.getElementById('endDateSelect');

  if (!startDateSelect || !endDateSelect) {
    return;
  }

  const selectedEventTypes = getEventAnalysisSelectedTypes();
  const activePreset = getActiveMultiEventPreset();
  const eventTypeRows = getRowsScopedToSelectedEventTypes(getAnalysisRows(), selectedEventTypes);
  const dates = selectedEventTypes.length > 0 ? getSortedUniqueDateValues(eventTypeRows) : [];

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

  // Presets may seed the initial range, but any still-valid manual selection in
  // the controls wins so we do not unexpectedly overwrite the user's choice.
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

// Rebuilds Player Analysis player/date controls after event type or preset
// changes.
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
  const eventTypeRows = getRowsScopedToSelectedEventTypes(getAnalysisRows(), selectedEventTypes);

  // Player menus and player date ranges both depend on event-type scope, so we
  // recompute them together to avoid impossible combinations in the UI.
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

  const savedPlayer = filterState.playerSelectionInitialized && filterState.playerSelectionKey && playerKeys.includes(filterState.playerSelectionKey)
    ? filterState.playerSelectionKey
    : '';

  const currentPlayer = playerKeys.includes(selectedPlayer)
    ? selectedPlayer
    : savedPlayer
      ? savedPlayer
      : !filterState.playerSelectionInitialized && playerKeys.includes(defaultSelection.player)
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

  const dates = getSortedUniquePlayerDateValues(eventTypeRows, currentPlayer);

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

// Populates date dropdown options for the given event type.
export function populateDateDropdowns(eventType) {
  const filteredDates = getSortedUniqueDateValues(
    getRowsScopedToSelectedEventTypes(getAnalysisRows(), [eventType])
  );

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
