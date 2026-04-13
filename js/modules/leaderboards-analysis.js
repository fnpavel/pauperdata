import { escapeHtml, getTopMode } from './filters/shared.js';
import { updateElementHTML, updateElementText, triggerUpdateAnimation } from '../utils/dom.js';
import { formatDate, formatEventName } from '../utils/format.js';
import {
  DEFAULT_RANKINGS_OPTIONS,
  buildRankingsDataset,
  getRankingsAvailableDates
} from '../utils/rankings-data.js';
import {
  buildEventLevelEloPoints,
  buildLeaderboardTimeline,
  createLeaderboardPlayerEloChart,
  createLeaderboardTimelineChart,
  destroyLeaderboardChart,
  getLeaderboardTimelineColor,
  shouldShowLeaderboardYearBoundaries
} from '../charts/leaderboard-chart.js';
import {
  buildStructuredTableCsv,
  downloadCsvFile,
  sanitizeCsvFilename
} from './export-table-csv.js';

const DEFAULT_EVENT_TYPE = 'online';
const DEFAULT_LEADERBOARD_WINDOW_MODE = 'seasonal';
const DEFAULT_LEADERBOARD_RESET_MODE = 'continuous';
const LEADERBOARD_STAT_CARD_IDS = [
  'leaderboardDateRangeCard',
  'leaderboardRatedMatchesCard',
  'leaderboardTrackedPlayersCard',
  'leaderboardTopEloCard',
  'leaderboardPeakEloCard',
  'leaderboardMostActiveCard',
  'leaderboardBiggestSwingCard'
];
const LEADERBOARD_DRILLDOWN_CONFIG = {
  ratedMatches: {
    cardId: 'leaderboardRatedMatchesCard',
    title: 'Rated Matches',
    emptyMessage: 'No rated matches are available for the current Leaderboards filters.'
  },
  trackedPlayers: {
    cardId: 'leaderboardTrackedPlayersCard',
    title: 'Tracked Players',
    emptyMessage: 'No Elo players are available for the current Leaderboards filters.'
  },
  topElo: {
    cardId: 'leaderboardTopEloCard',
    title: 'Current Top Elo',
    emptyMessage: 'No Elo leader is available for the current Leaderboards filters.'
  },
  peakElo: {
    cardId: 'leaderboardPeakEloCard',
    title: 'Peak Elo',
    emptyMessage: 'No peak Elo result is available for the current Leaderboards filters.'
  },
  mostActive: {
    cardId: 'leaderboardMostActiveCard',
    title: 'Most Active',
    emptyMessage: 'No active player is available for the current Leaderboards filters.'
  },
  biggestSwing: {
    cardId: 'leaderboardBiggestSwingCard',
    title: 'Biggest Elo Gain / Loss',
    emptyMessage: 'No Elo swing is available for the current Leaderboards filters.'
  }
};

let activeLeaderboardWindowMode = DEFAULT_LEADERBOARD_WINDOW_MODE;
let activeLeaderboardSeasonYear = '';
let activeLeaderboardRangeStartYear = '';
let activeLeaderboardRangeEndYear = '';
let activeLeaderboardResetMode = DEFAULT_LEADERBOARD_RESET_MODE;
let currentLeaderboardRows = [];
let currentLeaderboardDataset = {
  summary: {
    selectedYears: [],
    selectedYearRangeLabel: '',
    ratedMatches: 0,
    selectedMatches: 0,
    skippedMatches: 0,
    uniquePlayers: 0,
    seasonEntries: 0,
    leader: null,
    mostActiveSeason: null,
    latestProcessedMatch: null
  },
  eventTypes: [DEFAULT_EVENT_TYPE],
  period: null,
  processedMatches: [],
  historyByPlayer: new Map()
};
let leaderboardTableSort = {
  key: 'rating',
  direction: 'desc'
};
let activeLeaderboardDrilldownCategory = '';
let activeLeaderboardSearchTerm = '';
let activeLeaderboardPlayerDrilldown = null;
let leaderboardDatasetRequestId = 0;
let shouldRestoreLeaderboardFullscreen = false;
let leaderboardPlayerEloChart = null;
let leaderboardTimelineChart = null;
let activeLeaderboardTimelineSelections = new Set();
let activeLeaderboardTimelineSearchTerm = '';

function getLeaderboardsSection() {
  return document.getElementById('leaderboardsSection');
}

function getLeaderboardDrilldownElements() {
  return {
    overlay: document.getElementById('leaderboardStatDrilldownOverlay'),
    title: document.getElementById('leaderboardStatDrilldownTitle'),
    subtitle: document.getElementById('leaderboardStatDrilldownSubtitle'),
    content: document.getElementById('leaderboardStatDrilldownContent'),
    closeButton: document.getElementById('leaderboardStatDrilldownClose'),
    historyDownloadButton: document.getElementById('leaderboardPlayerHistoryDownload')
  };
}

function getLeaderboardSearchInput() {
  return document.getElementById('leaderboardPlayerSearchInput');
}

function getLeaderboardSearchButton() {
  return document.getElementById('leaderboardSearchButton');
}

function getLeaderboardSearchStatus() {
  return document.getElementById('leaderboardTableSearchStatus');
}

function getLeaderboardDownloadButton() {
  return document.getElementById('leaderboardDownloadCsv');
}

function getLeaderboardFullscreenButton() {
  return document.getElementById('leaderboardFullscreenButton');
}

function getLeaderboardTableContainer() {
  return document.getElementById('leaderboardTableContainer');
}

function getLeaderboardTableScrollContainer() {
  return document.querySelector('#leaderboardsSection .player-data-table-scroll');
}

function getLeaderboardTimelineSection() {
  return document.getElementById('leaderboardTimelineSection');
}

function getLeaderboardTimelineChartCanvas() {
  return document.getElementById('leaderboardTimelineChart');
}

function getLeaderboardTimelineHelper() {
  return document.getElementById('leaderboardTimelineHelper');
}

function getLeaderboardTimelineSearchInput() {
  return document.getElementById('leaderboardTimelinePlayerSearchInput');
}

function getLeaderboardTimelineSearchDropdown() {
  return document.getElementById('leaderboardTimelineSearchDropdown');
}

function getLeaderboardTimelineChipPanel() {
  return document.getElementById('leaderboardTimelineChipPanel');
}

function getLeaderboardTimelineSearchStatus() {
  return document.getElementById('leaderboardTimelineSearchStatus');
}

function getLeaderboardEventTypeButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('.event-type-filter') || []);
}

function getLeaderboardWindowModeButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('[data-leaderboard-window-mode]') || []);
}

function getLeaderboardSeasonControlsSection() {
  return document.getElementById('leaderboardSeasonControlsSection');
}

function getLeaderboardSeasonYearRoot() {
  return document.getElementById('leaderboardSeasonYearButtons');
}

function getLeaderboardRangeControlsSection() {
  return document.getElementById('leaderboardRangeControlsSection');
}

function getLeaderboardRangeStartYearButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('[data-leaderboard-range-start-year]') || []);
}

function getLeaderboardRangeEndYearButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('[data-leaderboard-range-end-year]') || []);
}

function getLeaderboardResetModeSection() {
  return document.getElementById('leaderboardResetModeSection');
}

function getLeaderboardResetModeButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('[data-leaderboard-reset-mode]') || []);
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

function getAvailableLeaderboardDates() {
  return getRankingsAvailableDates(getSelectedLeaderboardEventTypes());
}

function getAvailableLeaderboardYearsFromDates(dates = []) {
  return [...new Set(
    (Array.isArray(dates) ? dates : [])
      .map(date => String(date || '').slice(0, 4))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function getLeaderboardDateRangeForYear(dates = [], year = '') {
  const normalizedYear = String(year || '').trim();
  const yearDates = (Array.isArray(dates) ? dates : [])
    .filter(date => String(date || '').startsWith(`${normalizedYear}-`))
    .sort((a, b) => a.localeCompare(b));

  return {
    startDate: yearDates[0] || '',
    endDate: yearDates[yearDates.length - 1] || ''
  };
}

function getLeaderboardYearRangeLabel(years = []) {
  const normalizedYears = [...new Set((Array.isArray(years) ? years : []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (normalizedYears.length === 0) {
    return '';
  }

  if (normalizedYears.length === 1) {
    return normalizedYears[0];
  }

  return `${normalizedYears[0]}-${normalizedYears[normalizedYears.length - 1]}`;
}

function getLeaderboardSelectedYears(dataset = currentLeaderboardDataset) {
  const years = dataset?.summary?.selectedYears;
  if (Array.isArray(years) && years.length > 0) {
    return years;
  }

  const periodYears = dataset?.period?.years;
  return Array.isArray(periodYears) ? periodYears : [];
}

function getLeaderboardSelectedYearsLabel(dataset = currentLeaderboardDataset) {
  return getLeaderboardYearRangeLabel(getLeaderboardSelectedYears(dataset));
}

function getLeaderboardSelectedYearGainColumns(dataset = currentLeaderboardDataset) {
  const years = Array.isArray(dataset?.summary?.selectedYears) ? dataset.summary.selectedYears.filter(Boolean) : [];
  if (dataset.resetByYear || years.length === 0) {
    return [];
  }

  return [...new Set(years)].sort((a, b) => a.localeCompare(b));
}

function getLeaderboardRowYearGainValue(row = {}, year = '') {
  const normalizedYear = String(year || '').trim();
  if (!normalizedYear) {
    return '--';
  }

  const historyEntries = currentLeaderboardDataset.historyByPlayer?.get(row.playerKey) || [];
  const yearTotals = historyEntries.reduce((totals, entry) => {
    const entryYear = String(entry.date || '').slice(0, 4);
    if (entryYear !== normalizedYear || !Number.isFinite(Number(entry.delta))) {
      return totals;
    }

    totals[entryYear] = (totals[entryYear] || 0) + Number(entry.delta);
    return totals;
  }, {});

  return Object.prototype.hasOwnProperty.call(yearTotals, normalizedYear)
    ? formatRatingDelta(yearTotals[normalizedYear])
    : '--';
}

function getLeaderboardEntryLabel(row = {}) {
  return row.displaySeasonYear || row.seasonYear || (currentLeaderboardDataset.resetByYear ? 'Unknown Season' : 'Selected Range');
}

function getLeaderboardEntryFieldLabel(dataset = currentLeaderboardDataset) {
  return dataset.resetByYear ? 'Season' : 'Window';
}

function getLeaderboardWindowModeLabel(period = currentLeaderboardDataset.period) {
  return period?.windowMode === 'range' ? 'Multi-Year' : 'Seasonal';
}

function getLeaderboardContinuityLabel(dataset = currentLeaderboardDataset) {
  if (dataset?.period?.windowMode === 'seasonal') {
    return 'Seasonal Reset';
  }

  return dataset.resetByYear ? 'Reset each year' : 'Carry across range';
}

function getLeaderboardViewTitle(dataset = currentLeaderboardDataset) {
  if (dataset?.period?.windowMode === 'seasonal') {
    return 'Seasonal Elo Leaderboard';
  }

  return dataset.resetByYear ? 'Multi-Year Elo Leaderboard' : 'Continuous Elo Leaderboard';
}

function getLeaderboardRowCollectionLabel(count = 0, dataset = currentLeaderboardDataset) {
  const safeCount = Number(count) || 0;
  if (!dataset.resetByYear) {
    return `${safeCount} continuous ladder entr${safeCount === 1 ? 'y' : 'ies'}`;
  }

  if (dataset?.period?.windowMode === 'range') {
    return `${safeCount} season entr${safeCount === 1 ? 'y' : 'ies'}`;
  }

  return `${safeCount} leaderboard row${safeCount === 1 ? '' : 's'}`;
}

function buildLeaderboardTableHelperText(dataset = currentLeaderboardDataset) {
  if ((dataset?.summary?.ratedMatches || 0) === 0) {
    return buildEmptyStateMessage(dataset?.eventTypes);
  }

  const yearsLabel = getLeaderboardSelectedYearsLabel(dataset) || 'the selected years';
  if (dataset?.period?.windowMode === 'seasonal') {
    return `Rows are ranked by Elo for the ${yearsLabel} season only. Ratings start at ${DEFAULT_RANKINGS_OPTIONS.startingRating} on January 1.`;
  }

  if (dataset.resetByYear) {
    return `Rows are ranked across ${yearsLabel} with a January 1 reset each year, so players can appear once per season.`;
  }

  return `Rows are ranked across ${yearsLabel} as one continuous ladder, so each player appears once for the selected range.`;
}

function ensureActiveLeaderboardWindow() {
  const availableDates = getAvailableLeaderboardDates();
  const availableYears = getAvailableLeaderboardYearsFromDates(availableDates);

  if (!availableYears.includes(activeLeaderboardSeasonYear)) {
    activeLeaderboardSeasonYear = availableYears[availableYears.length - 1] || '';
  }

  if (!availableYears.includes(activeLeaderboardRangeStartYear)) {
    activeLeaderboardRangeStartYear = availableYears[0] || '';
  }

  if (!availableYears.includes(activeLeaderboardRangeEndYear)) {
    activeLeaderboardRangeEndYear = availableYears[availableYears.length - 1] || '';
  }

  if (!['seasonal', 'range'].includes(activeLeaderboardWindowMode)) {
    activeLeaderboardWindowMode = DEFAULT_LEADERBOARD_WINDOW_MODE;
  }

  if (!['yearly', 'continuous'].includes(activeLeaderboardResetMode)) {
    activeLeaderboardResetMode = DEFAULT_LEADERBOARD_RESET_MODE;
  }

  if (availableYears.length < 2 && activeLeaderboardWindowMode === 'range') {
    activeLeaderboardWindowMode = 'seasonal';
  }

  if (availableYears.length === 0) {
    return {
      availableDates,
      availableYears,
      activeWindow: null
    };
  }

  if (activeLeaderboardWindowMode === 'seasonal') {
    const selectedYear = activeLeaderboardSeasonYear || availableYears[availableYears.length - 1];
    const { startDate, endDate } = getLeaderboardDateRangeForYear(availableDates, selectedYear);

    return {
      availableDates,
      availableYears,
      activeWindow: {
        id: `season-${selectedYear}`,
        label: `${selectedYear} Season`,
        years: [selectedYear],
        year: selectedYear,
        windowMode: 'seasonal',
        resetMode: 'yearly',
        resetByYear: true,
        startDate,
        endDate
      }
    };
  }

  const startIndex = Math.max(0, availableYears.indexOf(activeLeaderboardRangeStartYear));
  const endIndex = Math.max(startIndex, availableYears.indexOf(activeLeaderboardRangeEndYear));
  const selectedYears = availableYears.slice(startIndex, endIndex + 1);
  const rangeLabel = getLeaderboardYearRangeLabel(selectedYears);
  const startRange = getLeaderboardDateRangeForYear(availableDates, selectedYears[0]);
  const endRange = getLeaderboardDateRangeForYear(availableDates, selectedYears[selectedYears.length - 1]);
  const isContinuous = activeLeaderboardResetMode === 'continuous';

  return {
    availableDates,
    availableYears,
    activeWindow: {
      id: `range-${rangeLabel || 'selected'}-${isContinuous ? 'continuous' : 'yearly'}`,
      label: rangeLabel || 'Selected Range',
      years: selectedYears,
      startYear: selectedYears[0] || '',
      endYear: selectedYears[selectedYears.length - 1] || '',
      windowMode: 'range',
      resetMode: isContinuous ? 'continuous' : 'yearly',
      resetByYear: !isContinuous,
      startDate: startRange.startDate,
      endDate: endRange.endDate
    }
  };
}

function renderLeaderboardWindowModeButtons(availableYears = []) {
  const hasMultiYearWindow = availableYears.length > 1;

  getLeaderboardWindowModeButtons().forEach(button => {
    const mode = String(button.dataset.leaderboardWindowMode || '');
    button.classList.toggle('active', mode === activeLeaderboardWindowMode);
    button.disabled = mode === 'range' && !hasMultiYearWindow;
  });
}

function renderLeaderboardSeasonYearButtons(availableYears = []) {
  const root = getLeaderboardSeasonYearRoot();
  const section = getLeaderboardSeasonControlsSection();
  if (!root) {
    return;
  }

  section?.classList.toggle('hidden', activeLeaderboardWindowMode !== 'seasonal');
  root.innerHTML = '';

  if (availableYears.length === 0) {
    root.innerHTML = '<div class="quick-view-empty">No rated seasons are available.</div>';
    return;
  }

  const buttonRow = document.createElement('div');
  buttonRow.className = 'bubble-menu quick-view-static-list quick-view-year-list';

  [...availableYears].reverse().forEach(year => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `bubble-button quick-view-year-button leaderboard-season-year-button${year === activeLeaderboardSeasonYear ? ' active' : ''}`;
    button.dataset.leaderboardSeasonYear = year;
    button.textContent = year;
    buttonRow.appendChild(button);
  });

  root.appendChild(buttonRow);
}

function renderLeaderboardRangeControls(availableYears = [], activeWindow = null) {
  const section = getLeaderboardRangeControlsSection();
  const startRoot = document.getElementById('leaderboardRangeStartYearButtons');
  const endRoot = document.getElementById('leaderboardRangeEndYearButtons');
  const showRangeControls = activeLeaderboardWindowMode === 'range';
  const startYear = activeWindow?.startYear || activeLeaderboardRangeStartYear || availableYears[0] || '';
  const endYear = activeWindow?.endYear || activeLeaderboardRangeEndYear || availableYears[availableYears.length - 1] || '';

  section?.classList.toggle('hidden', !showRangeControls);

  if (!startRoot || !endRoot) {
    return;
  }

  startRoot.innerHTML = '';
  endRoot.innerHTML = '';

  if (availableYears.length === 0) {
    startRoot.innerHTML = '<div class="quick-view-empty">No available years.</div>';
    endRoot.innerHTML = '<div class="quick-view-empty">No available years.</div>';
    return;
  }

  const startButtonRow = document.createElement('div');
  startButtonRow.className = 'bubble-menu quick-view-static-list quick-view-year-list';
  const endButtonRow = document.createElement('div');
  endButtonRow.className = 'bubble-menu quick-view-static-list quick-view-year-list';

  [...availableYears].forEach(year => {
    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = `bubble-button leaderboard-range-year-button${year === startYear ? ' active' : ''}`;
    startButton.dataset.leaderboardRangeStartYear = year;
    startButton.textContent = year;
    startButtonRow.appendChild(startButton);

    const endButton = document.createElement('button');
    endButton.type = 'button';
    endButton.className = `bubble-button leaderboard-range-year-button${year === endYear ? ' active' : ''}`;
    endButton.dataset.leaderboardRangeEndYear = year;
    endButton.textContent = year;
    endButtonRow.appendChild(endButton);
  });

  startRoot.appendChild(startButtonRow);
  endRoot.appendChild(endButtonRow);
}

function renderLeaderboardResetModeButtons(activeWindow = null) {
  const section = getLeaderboardResetModeSection();
  const shouldShowResetModes = activeWindow?.windowMode === 'range';

  section?.classList.toggle('hidden', !shouldShowResetModes);

  getLeaderboardResetModeButtons().forEach(button => {
    const mode = String(button.dataset.leaderboardResetMode || '');
    button.classList.toggle('active', mode === activeLeaderboardResetMode);
    button.disabled = !shouldShowResetModes;
  });
}

function buildLeaderboardWindowModeSummary(activeWindow = null) {
  if (!activeWindow) {
    return 'Choose Seasonal or Multi-Year to build Elo from the rated matchup archive.';
  }

  if (activeWindow.windowMode === 'seasonal') {
    return `Seasonal view isolates the ${activeWindow.year || 'selected'} calendar year. Elo always starts at ${DEFAULT_RANKINGS_OPTIONS.startingRating} on January 1 in this mode.`;
  }

  return 'Multi-Year view lets you span several years. After choosing the range, decide whether Elo resets each January or carries across the full window.';
}

function buildLeaderboardRangeSummary(activeWindow = null) {
  if (!activeWindow || activeWindow.windowMode !== 'range') {
    return 'Pick the first and last year included in the Elo window.';
  }

  const yearsLabel = getLeaderboardYearRangeLabel(activeWindow.years) || 'Selected range';
  const seasonCount = activeWindow.years?.length || 0;
  return `${yearsLabel} selected across ${seasonCount} calendar year${seasonCount === 1 ? '' : 's'}.`;
}

function buildLeaderboardResetModeSummary(activeWindow = null) {
  if (!activeWindow || activeWindow.windowMode !== 'range') {
    return 'Seasonal view always resets to 1500 on January 1. Switch to Multi-Year to choose between yearly resets and a continuous ladder.';
  }

  const selectedYears = activeWindow.years || [];
  if (activeWindow.resetMode === 'continuous') {
    return selectedYears.length <= 1
      ? 'With one year selected, continuous carry matches the seasonal numbers. It matters once the range spans multiple years.'
      : 'Carry across range keeps one Elo trail per player from the first selected year through the last.';
  }

  return selectedYears.length <= 1
    ? 'Reset each year matches the seasonal result for a single year. Add more years to compare separate player-season entries.'
    : 'This option lets you compare players\' seasonal Elo ratings, allowing you to evaluate a player\'s peak in one year against other players\' peaks from different years';
}

function buildLeaderboardSystemSummary(activeWindow = null) {
  if (!activeWindow) {
    return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${DEFAULT_RANKINGS_OPTIONS.kFactor}. (same as the Vintage Leaderboards)`;
  }

  if (activeWindow.windowMode === 'seasonal') {
    return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${DEFAULT_RANKINGS_OPTIONS.kFactor}. (same as the Vintage Leaderboards) Seasonal Elo resets on January 1.`;
  }

  if (activeWindow.resetMode === 'continuous') {
    return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${DEFAULT_RANKINGS_OPTIONS.kFactor}. (same as the Vintage Leaderboards) Ratings carry across the selected multi-year range with no January reset inside that window.`;
  }

  return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${DEFAULT_RANKINGS_OPTIONS.kFactor}. (same as the Vintage Leaderboards) Multi-Year Elo resets on January 1, so seasons stay separate.`;
}

function renderLeaderboardWindowControls() {
  const { availableYears, activeWindow } = ensureActiveLeaderboardWindow();

  renderLeaderboardWindowModeButtons(availableYears);
  renderLeaderboardSeasonYearButtons(availableYears);
  renderLeaderboardRangeControls(availableYears, activeWindow);
  renderLeaderboardResetModeButtons(activeWindow);

  updateElementText('leaderboardWindowModeSummary', buildLeaderboardWindowModeSummary(activeWindow));
  updateElementText('leaderboardRangeSummary', buildLeaderboardRangeSummary(activeWindow));
  updateElementText('leaderboardResetModeSummary', buildLeaderboardResetModeSummary(activeWindow));
  updateElementText('leaderboardSystemSummary', buildLeaderboardSystemSummary(activeWindow));

  return activeWindow;
}

function formatRating(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue).toString() : '--';
}

function formatRatingDelta(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? `${numericValue > 0 ? '+' : ''}${numericValue.toFixed(1)}`
    : '--';
}

function formatWinRate(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${(numericValue * 100).toFixed(1)}%` : '0.0%';
}

function formatWindowRange(startDate = '', endDate = '') {
  if (!startDate || !endDate) {
    return 'Choose a window';
  }

  if (startDate === endDate) {
    return formatDate(startDate);
  }

  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function getWindowLabel(period, selectedYears = [], startDate = '', endDate = '') {
  if (period?.label) {
    return period.label;
  }

  if (selectedYears.length === 1) {
    return `${selectedYears[0]} Season`;
  }

  if (selectedYears.length > 1) {
    return `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]}`;
  }

  if (startDate && endDate) {
    return 'Selected Window';
  }

  return 'Selected Window';
}

function buildEmptyStateMessage(selectedEventTypes = []) {
  if (selectedEventTypes.length === 1 && selectedEventTypes[0] === 'offline') {
    return 'No offline matchup records are available yet, so Elo leaderboards can only be computed for online events right now.';
  }

  return 'No rated matchup records are available for the selected filters.';
}

function buildSummaryText(dataset) {
  const { summary, resetByYear, processedMatches = [] } = dataset;

  if (summary.ratedMatches === 0) {
    return buildEmptyStateMessage(dataset.eventTypes);
  }

  const firstMatch = processedMatches[0] || null;
  const lastMatch = processedMatches[processedMatches.length - 1] || summary.latestProcessedMatch || null;
  const firstMatchLabel = firstMatch?.date
    ? `${formatEventName(firstMatch.event) || firstMatch.event || 'Unknown Event'} on ${formatDate(firstMatch.date)}`
    : '';
  const lastMatchLabel = lastMatch?.date
    ? `${formatEventName(lastMatch.event) || lastMatch.event || 'Unknown Event'} on ${formatDate(lastMatch.date)}`
    : '';
  const selectedYearsLabel = getLeaderboardSelectedYearsLabel(dataset);
  const resetNote = resetByYear
    ? 'Rating resets to 1500 when the calendar year changes.'
    : 'Rating carries across the full selected window.';
  const modeNote = dataset?.period?.windowMode === 'seasonal'
    ? (selectedYearsLabel ? ` This view isolates the ${selectedYearsLabel} season.` : '')
    : (
      resetByYear
        ? (selectedYearsLabel ? ` This window spans ${selectedYearsLabel} and keeps separate Elo entries for each season.` : ' This window keeps separate Elo entries for each season.')
        : (selectedYearsLabel ? ` This window spans ${selectedYearsLabel} as one continuous Elo ladder.` : ' This window uses one continuous Elo ladder.')
    );
  const skipNote = summary.skippedMatches > 0
    ? ` ${summary.skippedMatches} selected pairings were skipped because they were byes or had unknown results.`
    : '';

  return `${resetNote}${modeNote}${skipNote}${firstMatchLabel ? ` First rated match: ${firstMatchLabel}.` : ''}${lastMatchLabel ? ` Last rated match: ${lastMatchLabel}.` : ''}`;
}

function getRowsAtMaxValue(rows = [], key = '') {
  const maxValue = rows.reduce((currentMax, row) => {
    const numericValue = Number(row?.[key]);
    return Number.isFinite(numericValue) ? Math.max(currentMax, numericValue) : currentMax;
  }, Number.NEGATIVE_INFINITY);

  if (!Number.isFinite(maxValue)) {
    return [];
  }

  return rows.filter(row => Number(row?.[key]) === maxValue);
}

function formatNameList(names = [], maxVisible = 3) {
  const cleanedNames = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))];
  if (cleanedNames.length === 0) {
    return '--';
  }

  if (cleanedNames.length === 1) {
    return cleanedNames[0];
  }

  if (cleanedNames.length === 2) {
    return `${cleanedNames[0]} & ${cleanedNames[1]}`;
  }

  if (cleanedNames.length <= maxVisible) {
    return cleanedNames.join(', ');
  }

  return `${cleanedNames.slice(0, maxVisible).join(', ')} +${cleanedNames.length - maxVisible} more`;
}

function formatShortDate(dateString = '') {
  if (!dateString) {
    return '--';
  }

  const [year, month, day] = String(dateString).split('-').map(Number);
  const safeDate = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  return safeDate.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
}

function formatResultLabel(resultType = '') {
  const normalizedResultType = String(resultType || '').trim().toLowerCase();
  if (!normalizedResultType) {
    return 'Unknown';
  }

  return `${normalizedResultType.charAt(0).toUpperCase()}${normalizedResultType.slice(1)}`;
}

function buildHistoryContextLabel(entry = {}) {
  const roundLabel = Number.isFinite(Number(entry.round)) ? `Round ${Number(entry.round)}` : 'Unknown Round';
  const eventLabel = formatEventName(entry.event) || entry.event || 'Unknown Event';
  const dateLabel = entry.date ? formatShortDate(entry.date) : '--';
  return `${roundLabel} of ${dateLabel} ${eventLabel}`;
}

function normalizeLeaderboardSearchText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function updateLeaderboardSearchStatus(message = '') {
  const statusElement = getLeaderboardSearchStatus();
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function renderLeaderboardLoadingState(message = 'Loading Elo leaderboard...') {
  destroyLeaderboardTimelineChart();
  updateElementText('leaderboardTableTitle', 'Elo Leaderboard');
  updateElementText('leaderboardTableHelper', message);
  updateElementText('leaderboardEntryColumnLabel', 'Season');
  updateElementHTML('leaderboardTableBody', "<tr><td colspan='9'>Loading Elo leaderboard...</td></tr>");
  updateLeaderboardSearchStatus(message);
  const timelineSection = getLeaderboardTimelineSection();
  if (timelineSection) {
    timelineSection.hidden = true;
  }
}

function renderLeaderboardErrorState(message = 'Unable to load Elo leaderboard data.') {
  destroyLeaderboardTimelineChart();
  updateElementText('leaderboardTableHelper', message);
  updateElementHTML('leaderboardTableBody', `<tr><td colspan='9'>${escapeHtml(message)}</td></tr>`);
  updateLeaderboardSearchStatus(message);
  const timelineSection = getLeaderboardTimelineSection();
  if (timelineSection) {
    timelineSection.hidden = true;
  }
}

function clearLeaderboardSearchHighlights() {
  document
    .querySelectorAll('#leaderboardTableBody tr.leaderboard-search-match, #leaderboardTableBody tr.leaderboard-search-match-primary')
    .forEach(row => {
      row.classList.remove('leaderboard-search-match', 'leaderboard-search-match-primary');
    });
}

function compareRows(a, b, key) {
  const resolvedKey = key === 'displayRank' ? 'rating' : key;

  if (resolvedKey === 'displayName') {
    return (
      String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
      String(a.playerKey).localeCompare(String(b.playerKey))
    );
  }

  if (resolvedKey === 'seasonYear' || resolvedKey === 'lastActiveDate') {
    const leftValue = resolvedKey === 'seasonYear' ? getLeaderboardEntryLabel(a) : String(a[resolvedKey] || '');
    const rightValue = resolvedKey === 'seasonYear' ? getLeaderboardEntryLabel(b) : String(b[resolvedKey] || '');
    return String(leftValue).localeCompare(String(rightValue || ''));
  }

  return Number(a[resolvedKey] || 0) - Number(b[resolvedKey] || 0);
}

function sortLeaderboardRows(rows = []) {
  const sortedRows = [...rows];

  sortedRows.sort((a, b) => {
    return (
      Number(b.rating) - Number(a.rating) ||
      Number(b.matches) - Number(a.matches) ||
      Number(b.wins) - Number(a.wins) ||
      Number(a.losses) - Number(b.losses) ||
      String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }) ||
      String(a.playerKey).localeCompare(String(b.playerKey))
    );
  });

  return sortedRows;
}

function getPrimaryLeaderboardSearchMatch(rows = [], normalizedSearchTerm = '') {
  if (!normalizedSearchTerm) {
    return null;
  }

  return (
    rows.find(row => row.dataset.leaderboardPlayerName === normalizedSearchTerm) ||
    rows.find(row => String(row.dataset.leaderboardPlayerName || '').startsWith(normalizedSearchTerm)) ||
    rows[0] ||
    null
  );
}

function applyLeaderboardTableSearch(searchTerm = '', { scrollIntoView = true } = {}) {
  const normalizedSearchTerm = normalizeLeaderboardSearchText(searchTerm);
  const tableRows = Array.from(document.querySelectorAll('#leaderboardTableBody tr[data-leaderboard-player-name]'));

  clearLeaderboardSearchHighlights();
  activeLeaderboardSearchTerm = normalizedSearchTerm;

  if (!normalizedSearchTerm) {
    updateLeaderboardSearchStatus('');
    return [];
  }

  const matchingRows = tableRows.filter(row => {
    return String(row.dataset.leaderboardPlayerName || '').includes(normalizedSearchTerm);
  });

  if (matchingRows.length === 0) {
    updateLeaderboardSearchStatus(`No Elo player matched "${searchTerm.trim()}".`);
    return [];
  }

  matchingRows.forEach(row => {
    row.classList.add('leaderboard-search-match');
  });

  const primaryMatch = getPrimaryLeaderboardSearchMatch(matchingRows, normalizedSearchTerm);
  if (primaryMatch) {
    primaryMatch.classList.add('leaderboard-search-match-primary');
  }

  updateLeaderboardSearchStatus(
    `${matchingRows.length} player${matchingRows.length === 1 ? '' : 's'} highlighted for "${searchTerm.trim()}".`
  );

  if (scrollIntoView && primaryMatch) {
    const scrollContainer = getLeaderboardTableScrollContainer();
    scrollContainer?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    primaryMatch.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }

  return matchingRows;
}

function getSortedLeaderboardRowsWithRank() {
  return sortLeaderboardRows(currentLeaderboardRows).map((row, index) => ({
    ...row,
    displayRank: index + 1
  }));
}

function getLeaderboardCsvMetadata(dataset = currentLeaderboardDataset) {
  const metadataRows = [
    ['View', getLeaderboardViewTitle(dataset)],
    ['Window Type', getLeaderboardWindowModeLabel(dataset.period)],
    ['Rating Continuity', getLeaderboardContinuityLabel(dataset)],
    ['Selected Window', getWindowLabel(dataset.period, dataset.summary.selectedYears, dataset.startDate, dataset.endDate)],
    ['Selected Years', getLeaderboardSelectedYearsLabel(dataset) || '--'],
    ['Date Range', formatWindowRange(dataset.startDate, dataset.endDate)],
    ['Event Types', (dataset.eventTypes || []).join(', ') || DEFAULT_EVENT_TYPE],
    ['Rated Matches', String(dataset.summary.ratedMatches || 0)],
    ['Tracked Players', String(dataset.summary.uniquePlayers || 0)],
    ['Leaderboard Rows', String(dataset.summary.seasonEntries || 0)]
  ];

  if (dataset.summary.latestProcessedMatch?.date) {
    metadataRows.push([
      'Latest Rated Match',
      `${formatEventName(dataset.summary.latestProcessedMatch.event) || dataset.summary.latestProcessedMatch.event || 'Unknown Event'} on ${formatDate(dataset.summary.latestProcessedMatch.date)}`
    ]);
  }

  return metadataRows;
}

function exportLeaderboardCsv() {
  const rowsWithRank = getSortedLeaderboardRowsWithRank();
  if (rowsWithRank.length === 0) {
    return;
  }

  const yearGainColumns = getLeaderboardSelectedYearGainColumns(currentLeaderboardDataset);
  const csvText = buildStructuredTableCsv(
    [
      { header: 'Rank', value: row => row.displayRank },
      { header: 'Player', value: row => row.displayName },
      { header: getLeaderboardEntryFieldLabel(currentLeaderboardDataset), value: row => getLeaderboardEntryLabel(row) },
      { header: 'Elo', value: row => formatRating(row.rating) },
      ...yearGainColumns.map(year => ({
        header: `${year} Gains`,
        value: row => getLeaderboardRowYearGainValue(row, year)
      })),
      { header: 'Total Matches', value: row => row.matches },
      { header: 'Wins', value: row => row.wins },
      { header: 'Losses', value: row => row.losses },
      { header: 'Win Rate', value: row => formatWinRate(row.winRate) },
      { header: 'Last Match', value: row => (row.lastActiveDate ? formatDate(row.lastActiveDate) : '--') }
    ],
    rowsWithRank,
    getLeaderboardCsvMetadata()
  );

  const windowLabel = sanitizeCsvFilename(
    getWindowLabel(
      currentLeaderboardDataset.period,
      currentLeaderboardDataset.summary.selectedYears,
      currentLeaderboardDataset.startDate,
      currentLeaderboardDataset.endDate
    )
  );
  const viewLabel = sanitizeCsvFilename(getLeaderboardViewTitle(currentLeaderboardDataset) || 'elo-leaderboard');
  downloadCsvFile(`${viewLabel || 'elo-leaderboard'}-${windowLabel || 'selected-window'}.csv`, csvText);
}

function getAllLeaderboardHistoryEntries() {
  return currentLeaderboardRows.flatMap(row => getPlayerHistoryForRow(row));
}

function getPeakEloEntries() {
  const allEntries = getAllLeaderboardHistoryEntries().filter(entry => Number.isFinite(Number(entry.ratingAfter)));
  if (allEntries.length === 0) {
    return [];
  }

  const maxRating = allEntries.reduce((currentMax, entry) => {
    return Math.max(currentMax, Number(entry.ratingAfter));
  }, Number.NEGATIVE_INFINITY);

  return allEntries.filter(entry => Number(entry.ratingAfter) === maxRating);
}

function getBiggestGainEntries() {
  const allEntries = getAllLeaderboardHistoryEntries().filter(entry => Number.isFinite(Number(entry.delta)));
  const gainEntries = allEntries.filter(entry => Number(entry.delta) > 0);
  if (gainEntries.length === 0) {
    return [];
  }

  const maxGain = gainEntries.reduce((currentMax, entry) => {
    return Math.max(currentMax, Number(entry.delta));
  }, Number.NEGATIVE_INFINITY);

  return gainEntries.filter(entry => Number(entry.delta) === maxGain);
}

function getBiggestLossEntries() {
  const allEntries = getAllLeaderboardHistoryEntries().filter(entry => Number.isFinite(Number(entry.delta)));
  const lossEntries = allEntries.filter(entry => Number(entry.delta) < 0);
  if (lossEntries.length === 0) {
    return [];
  }

  const minLoss = lossEntries.reduce((currentMin, entry) => {
    return Math.min(currentMin, Number(entry.delta));
  }, Number.POSITIVE_INFINITY);

  return lossEntries.filter(entry => Number(entry.delta) === minLoss);
}

function getLeaderboardRowByKeys(playerKey = '', seasonKey = '') {
  const normalizedPlayerKey = String(playerKey || '').trim();
  const normalizedSeasonKey = String(seasonKey || '').trim();

  return currentLeaderboardRows.find(row => {
    return String(row.playerKey || '').trim() === normalizedPlayerKey
      && String(row.seasonKey || '').trim() === normalizedSeasonKey;
  }) || null;
}

function getPlayerHistoryForRow(row) {
  const historyEntries = currentLeaderboardDataset.historyByPlayer?.get(row.playerKey) || [];

  return [...historyEntries]
    .filter(entry => String(entry.seasonKey || '') === String(row.seasonKey || ''))
    .sort((a, b) => {
      return (
        String(b.date || '').localeCompare(String(a.date || '')) ||
        Number(b.round || 0) - Number(a.round || 0) ||
        String(b.eventId || '').localeCompare(String(a.eventId || ''))
      );
    });
}

function getLeaderboardRowSelectionKey(row = {}) {
  return `${String(row.seasonKey || '').trim()}:::${String(row.playerKey || '').trim()}`;
}

function getLeaderboardRowsBySelectionKeys(selectionKeys = activeLeaderboardTimelineSelections) {
  const selectedKeySet = selectionKeys instanceof Set ? selectionKeys : new Set(selectionKeys);
  return getSortedLeaderboardRowsWithRank().filter(row => selectedKeySet.has(getLeaderboardRowSelectionKey(row)));
}

function getLeaderboardPlayerHistoryAscending(row) {
  return getPlayerHistoryForRow(row).slice().sort((a, b) => {
    return (
      String(a.date || '').localeCompare(String(b.date || '')) ||
      String(a.eventId || '').localeCompare(String(b.eventId || '')) ||
      Number(a.round || 0) - Number(b.round || 0)
    );
  });
}

function destroyLeaderboardPlayerEloChart() {
  leaderboardPlayerEloChart = destroyLeaderboardChart(leaderboardPlayerEloChart);
}

function destroyLeaderboardTimelineChart() {
  leaderboardTimelineChart = destroyLeaderboardChart(leaderboardTimelineChart);
}

function shouldShowLeaderboardYearBoundaryMarkers(dataset = currentLeaderboardDataset) {
  return shouldShowLeaderboardYearBoundaries(dataset);
}

function buildLeaderboardPlayerHistoryCsvMetadata(row, historyEntries = []) {
  return [
    ['View', `${getLeaderboardViewTitle(currentLeaderboardDataset)} Match History`],
    ['Player', row.displayName || row.playerKey || '--'],
    [getLeaderboardEntryFieldLabel(currentLeaderboardDataset), getLeaderboardEntryLabel(row)],
    ['Current Elo', formatRating(row.rating)],
    ['Matches', String(row.matches || 0)],
    ['Wins', String(row.wins || 0)],
    ['Losses', String(row.losses || 0)],
    ['Win Rate', formatWinRate(row.winRate)],
    ['History Rows', String(historyEntries.length || 0)],
    ['Window Type', getLeaderboardWindowModeLabel(currentLeaderboardDataset.period)],
    ['Rating Continuity', getLeaderboardContinuityLabel(currentLeaderboardDataset)],
    ['Leaderboard Window', getWindowLabel(currentLeaderboardDataset.period, currentLeaderboardDataset.summary.selectedYears, currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate)],
    ['Date Range', formatWindowRange(currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate)],
    ['Event Types', (currentLeaderboardDataset.eventTypes || []).join(', ') || DEFAULT_EVENT_TYPE]
  ];
}

function exportLeaderboardPlayerHistoryCsv(playerKey = '', seasonKey = '') {
  const row = getLeaderboardRowByKeys(playerKey, seasonKey);
  if (!row) {
    return;
  }

  const historyEntries = getPlayerHistoryForRow(row);
  if (historyEntries.length === 0) {
    return;
  }

  const csvText = buildStructuredTableCsv(
    [
      { header: 'Date', value: entry => (entry.date ? formatDate(entry.date) : '--') },
      { header: 'Event', value: entry => formatEventName(entry.event) || entry.event || 'Unknown Event' },
      { header: 'Round', value: entry => (Number.isFinite(Number(entry.round)) ? Number(entry.round) : '--') },
      { header: 'Opponent', value: entry => entry.opponent || entry.opponentKey || 'Unknown Opponent' },
      { header: 'Result', value: entry => String(entry.resultType || 'unknown').toUpperCase() },
      { header: 'Elo Before', value: entry => formatRating(entry.ratingBefore) },
      { header: 'Elo After', value: entry => formatRating(entry.ratingAfter) },
      { header: 'Delta', value: entry => formatRatingDelta(entry.delta) }
    ],
    historyEntries,
    buildLeaderboardPlayerHistoryCsvMetadata(row, historyEntries)
  );

  const playerLabel = sanitizeCsvFilename(row.displayName || row.playerKey || 'player');
  const seasonLabel = sanitizeCsvFilename(getLeaderboardEntryLabel(row) || 'selected-range');
  downloadCsvFile(`elo-match-history-${playerLabel}-${seasonLabel}.csv`, csvText);
}

function buildLeaderboardPlayerDetailHtml(row) {
  const historyEntries = getPlayerHistoryForRow(row);
  const firstMatch = historyEntries[historyEntries.length - 1] || null;
  const latestMatch = historyEntries[0] || null;
  const peakRating = historyEntries.reduce((maxRating, entry) => {
    const ratings = [Number(entry.ratingBefore), Number(entry.ratingAfter)].filter(Number.isFinite);
    const entryPeak = ratings.length > 0 ? Math.max(...ratings) : Number.NEGATIVE_INFINITY;
    return Math.max(maxRating, entryPeak);
  }, Number(row.rating) || Number.NEGATIVE_INFINITY);
  const bestDelta = historyEntries.reduce((bestEntry, entry) => {
    return !bestEntry || Number(entry.delta) > Number(bestEntry.delta) ? entry : bestEntry;
  }, null);
  const worstDelta = historyEntries.reduce((worstEntry, entry) => {
    return !worstEntry || Number(entry.delta) < Number(worstEntry.delta) ? entry : worstEntry;
  }, null);

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(getWindowLabel(currentLeaderboardDataset.period, currentLeaderboardDataset.summary.selectedYears, currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate))}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(row.displayName || row.playerKey || 'Unknown Player')}</h4>
        </div>
      </div>
      <div class="player-rank-drilldown-summary-grid leaderboard-player-summary-grid">
        ${buildSummaryItemHtml(getLeaderboardEntryFieldLabel(currentLeaderboardDataset), getLeaderboardEntryLabel(row), { updated: true })}
        ${buildSummaryItemHtml('Current Elo', formatRating(row.rating), { updated: true })}
        ${buildSummaryItemHtml('Peak Elo', Number.isFinite(peakRating) ? formatRating(peakRating) : '--')}
        ${buildSummaryItemHtml('Matches', String(row.matches || 0), { updated: true })}
        ${buildSummaryItemHtml('Wins', String(row.wins || 0))}
        ${buildSummaryItemHtml('Losses', String(row.losses || 0))}
        ${buildSummaryItemHtml('Win Rate', formatWinRate(row.winRate))}
        ${buildSummaryItemHtml('First Match', firstMatch?.date ? formatDate(firstMatch.date) : '--')}
        ${buildSummaryItemHtml('Last Match', latestMatch?.date ? formatDate(latestMatch.date) : '--')}
        ${buildSummaryItemHtml('Best Gain', bestDelta ? `${formatRatingDelta(bestDelta.delta)} vs ${bestDelta.opponent || bestDelta.opponentKey || 'Unknown Opponent'}` : '--')}
        ${buildSummaryItemHtml('Biggest Drop', worstDelta ? `${formatRatingDelta(worstDelta.delta)} vs ${worstDelta.opponent || worstDelta.opponentKey || 'Unknown Opponent'}` : '--')}
        ${buildSummaryItemHtml('Latest Event', formatEventName(row.lastEvent) || row.lastEvent || '--')}
        ${buildLeaderboardPlayerSeasonEloSummaryItemsHtml(row)}
      </div>
      ${buildLeaderboardPlayerEventChangeCardsHtml(row)}
    </article>
    <div class="chart-container">
      <div class="leaderboard-chart-panel-header">
        <div>
          <div class="player-rank-drilldown-context-title">Elo Timeline</div>
          <div class="leaderboard-table-helper">Tracking this leaderboard entry across events in chronological order.</div>
        </div>
      </div>
      <canvas id="leaderboardPlayerEloChart"></canvas>
    </div>
    <div class="player-rank-drilldown-context">
      <div class="player-rank-drilldown-context-header leaderboard-player-results-header">
        <div class="player-rank-drilldown-context-title">Full Rated Match History</div>
        <div class="leaderboard-table-search-status">${escapeHtml(`${historyEntries.length} matchup${historyEntries.length === 1 ? '' : 's'} in this leaderboard entry`)}</div>
      </div>
      ${buildHistoryListHtml(historyEntries)}
    </div>
  `;
}

function updateLeaderboardPlayerHistoryDownloadButton(playerKey = '', seasonKey = '') {
  const { historyDownloadButton } = getLeaderboardDrilldownElements();
  if (!historyDownloadButton) {
    return;
  }

  const normalizedPlayerKey = String(playerKey || '').trim();
  const normalizedSeasonKey = String(seasonKey || '').trim();
  const shouldShow = Boolean(normalizedPlayerKey);

  historyDownloadButton.hidden = !shouldShow;
  historyDownloadButton.dataset.leaderboardDownloadHistory = shouldShow ? normalizedPlayerKey : '';
  historyDownloadButton.dataset.leaderboardDownloadHistorySeason = shouldShow ? normalizedSeasonKey : '';
}

function renderLeaderboardPlayerEloChart(row) {
  destroyLeaderboardPlayerEloChart();

  const canvas = document.getElementById('leaderboardPlayerEloChart');
  if (!canvas || !globalThis.Chart) {
    return;
  }

  const points = buildEventLevelEloPoints(getLeaderboardPlayerHistoryAscending(row));
  if (points.length === 0) {
    return;
  }
  leaderboardPlayerEloChart = createLeaderboardPlayerEloChart(canvas, {
    row,
    points,
    formatRating,
    showYearBoundaries: shouldShowLeaderboardYearBoundaryMarkers()
  });
}

function renderLeaderboardPlayerDrilldown(playerKey = '', seasonKey = '') {
  const elements = getLeaderboardDrilldownElements();
  const row = getLeaderboardRowByKeys(playerKey, seasonKey);
  if (!row || !elements.title || !elements.subtitle || !elements.content) {
    return false;
  }

  elements.title.textContent = row.displayName || row.playerKey || 'Elo Player';
  elements.subtitle.textContent = `${formatRating(row.rating)} Elo | ${row.matches} matches | ${formatWinRate(row.winRate)} WR | ${getLeaderboardEntryLabel(row)}`;
  elements.content.innerHTML = buildLeaderboardPlayerDetailHtml(row);
  renderLeaderboardPlayerEloChart(row);
  updateLeaderboardPlayerHistoryDownloadButton(row.playerKey, row.seasonKey);
  return true;
}

function shouldShowLeaderboardTimelineSection(dataset = currentLeaderboardDataset) {
  return !(dataset?.period?.windowMode === 'range' && dataset?.resetByYear);
}

function getDefaultLeaderboardTimelineSelectionKeys() {
  return new Set(
    getSortedLeaderboardRowsWithRank()
      .slice(0, 8)
      .map(row => getLeaderboardRowSelectionKey(row))
  );
}

function syncLeaderboardTimelineSelections() {
  const validKeys = new Set(getSortedLeaderboardRowsWithRank().map(row => getLeaderboardRowSelectionKey(row)));
  activeLeaderboardTimelineSelections = new Set(
    Array.from(activeLeaderboardTimelineSelections).filter(key => validKeys.has(key))
  );

  if (activeLeaderboardTimelineSelections.size === 0) {
    activeLeaderboardTimelineSelections = getDefaultLeaderboardTimelineSelectionKeys();
  }
}

function updateLeaderboardTimelineSearchStatus(message = '') {
  const status = getLeaderboardTimelineSearchStatus();
  if (status) {
    status.textContent = message;
  }
}

function renderLeaderboardTimelineChipPanel() {
  const chipPanel = getLeaderboardTimelineChipPanel();
  if (!chipPanel) {
    return;
  }

  const selectedRows = getLeaderboardRowsBySelectionKeys();
  chipPanel.innerHTML = selectedRows.length > 0
    ? selectedRows.map(row => `
      <span class="leaderboard-timeline-chip">
        <span>${escapeHtml(`${row.displayName} (${formatRating(row.rating)})`)}</span>
        <button
          type="button"
          data-leaderboard-timeline-remove="${escapeHtml(getLeaderboardRowSelectionKey(row))}"
          aria-label="${escapeHtml(`Remove ${row.displayName} from the Elo timeline`)}"
        >
          x
        </button>
      </span>
    `).join('')
    : '<div class="leaderboard-timeline-chip-empty">No players selected for the Elo timeline.</div>';
}

function renderLeaderboardTimelineSearchDropdown() {
  const dropdown = getLeaderboardTimelineSearchDropdown();
  if (!dropdown) {
    return;
  }

  const searchTerm = String(activeLeaderboardTimelineSearchTerm || '').trim().toLowerCase();

  if (!searchTerm) {
    dropdown.hidden = true;
    dropdown.classList.remove('open');
    dropdown.innerHTML = '';
    return;
  }

  const selectedKeys = activeLeaderboardTimelineSelections;
  const matches = getSortedLeaderboardRowsWithRank()
    .filter(row => !selectedKeys.has(getLeaderboardRowSelectionKey(row)))
    .filter(row => {
      const haystack = [
        row.displayName,
        row.playerKey,
        getLeaderboardEntryLabel(row)
      ].join(' ').toLowerCase();
      return haystack.includes(searchTerm);
    })
    .slice(0, 10);

  if (matches.length === 0) {
    dropdown.hidden = false;
    dropdown.classList.add('open');
    dropdown.innerHTML = '<div class="player-search-empty">No players matched the current search.</div>';
    return;
  }

  dropdown.hidden = false;
  dropdown.classList.add('open');
  dropdown.innerHTML = matches.map(row => `
    <button
      type="button"
      class="player-search-option"
      data-leaderboard-timeline-add="${escapeHtml(getLeaderboardRowSelectionKey(row))}"
    >
      ${escapeHtml(`${row.displayName} | ${formatRating(row.rating)} Elo | ${getLeaderboardEntryLabel(row)}`)}
    </button>
  `).join('');
}

function renderLeaderboardTimelineChart() {
  destroyLeaderboardTimelineChart();

  const section = getLeaderboardTimelineSection();
  const canvas = getLeaderboardTimelineChartCanvas();
  const helper = getLeaderboardTimelineHelper();
  const searchInput = getLeaderboardTimelineSearchInput();
  const dropdown = getLeaderboardTimelineSearchDropdown();
  if (!section || !canvas) {
    return;
  }

  if (!shouldShowLeaderboardTimelineSection()) {
    section.hidden = true;
    if (dropdown) {
      dropdown.hidden = true;
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
    }
    updateLeaderboardTimelineSearchStatus('');
    return;
  }

  section.hidden = false;
  syncLeaderboardTimelineSelections();
  renderLeaderboardTimelineChipPanel();
  renderLeaderboardTimelineSearchDropdown();

  const selectedRows = getLeaderboardRowsBySelectionKeys();
  const timeline = buildLeaderboardTimeline(currentLeaderboardDataset.processedMatches || []);
  const labels = timeline.map(point => point.label);
  const timelineIndexByKey = new Map(timeline.map(point => [point.key, point.index]));

  if (helper) {
    helper.textContent = selectedRows.length > 0
      ? `Tracking ${selectedRows.length} selected player${selectedRows.length === 1 ? '' : 's'} across ${timeline.length} event${timeline.length === 1 ? '' : 's'} in the current Elo window.`
      : 'Select at least one player to draw the Elo timeline.';
  }
  updateLeaderboardTimelineSearchStatus(
    selectedRows.length > 0
      ? `${selectedRows.length} player${selectedRows.length === 1 ? '' : 's'} shown`
      : 'No players selected'
  );
  if (searchInput) {
    searchInput.disabled = getSortedLeaderboardRowsWithRank().length === 0;
  }

  if (!globalThis.Chart || selectedRows.length === 0 || timeline.length === 0) {
    return;
  }

  const datasets = selectedRows.map((row, index) => {
    const color = getLeaderboardTimelineColor(index);
    const values = new Array(timeline.length).fill(null);
    buildEventLevelEloPoints(getLeaderboardPlayerHistoryAscending(row)).forEach(point => {
      const eventKey = [
        String(row.seasonKey || '').trim(),
        String(point.date || '').trim(),
        String(point.eventId || '').trim(),
        String(point.event || '').trim()
      ].join('|||');
      const timelineIndex = timelineIndexByKey.get(eventKey);
      if (typeof timelineIndex === 'number') {
        values[timelineIndex] = point.ratingAfter;
      }
    });

    return {
      label: row.displayName,
      data: values,
      borderColor: color,
      backgroundColor: `${color}22`,
      pointRadius: 2,
      pointHoverRadius: 4,
      borderWidth: 2,
      tension: 0.25,
      spanGaps: true
    };
  });

  leaderboardTimelineChart = createLeaderboardTimelineChart(canvas, {
    labels,
    datasets,
    timelineEntries: timeline,
    formatRating,
    showYearBoundaries: shouldShowLeaderboardYearBoundaryMarkers()
  });
}

function openLeaderboardPlayerDrilldown(playerKey = '', seasonKey = '') {
  const elements = getLeaderboardDrilldownElements();
  if (!elements.overlay) {
    return;
  }

  if (!renderLeaderboardPlayerDrilldown(playerKey, seasonKey)) {
    return;
  }

  activeLeaderboardDrilldownCategory = '';
  activeLeaderboardPlayerDrilldown = {
    playerKey: String(playerKey || '').trim(),
    seasonKey: String(seasonKey || '').trim()
  };
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function buildSummaryItemHtml(label, value, { updated = false } = {}) {
  return `
    <div class="player-rank-drilldown-summary-item${updated ? ' updated' : ''}">
      <span class="player-rank-drilldown-summary-label">${escapeHtml(label)}</span>
      <span class="player-rank-drilldown-summary-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function buildStatCardHtml({ title, value, change, icon }) {
  return `
    <div class="stat-card">
      <div class="stat-title">${escapeHtml(title)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      ${change ? `<div class="stat-change">${escapeHtml(change)}</div>` : ''}
      ${icon ? `<div class="stat-icon">${escapeHtml(icon)}</div>` : ''}
    </div>
  `;
}

function buildLeaderboardPlayerSeasonEloSummaryItemsHtml(row) {
  if (currentLeaderboardDataset.resetByYear || currentLeaderboardDataset.period?.windowMode !== 'range') {
    return '';
  }

  const selectedYears = getLeaderboardSelectedYears(currentLeaderboardDataset);
  if (!selectedYears.length) {
    return '';
  }

  const historyEntries = getPlayerHistoryForRow(row);
  const yearItems = selectedYears.map(year => {
    const yearHistory = historyEntries.filter(entry => String(entry.date || '').slice(0, 4) === String(year));
    if (yearHistory.length === 0) {
      return null;
    }

    const sortedYearHistory = [...yearHistory].sort((a, b) => {
      return (
        String(a.date || '').localeCompare(String(b.date || '')) ||
        Number(a.round || 0) - Number(b.round || 0)
      );
    });

    const finalEntry = sortedYearHistory[sortedYearHistory.length - 1];
    const yearGain = sortedYearHistory.reduce((total, entry) => {
      return total + (Number.isFinite(Number(entry.delta)) ? Number(entry.delta) : 0);
    }, 0);

    return buildSummaryItemHtml(
      `${year} End Elo`,
      `${formatRating(finalEntry.ratingAfter)} ${yearGain >= 0 ? `(+${formatRatingDelta(yearGain)})` : `(${formatRatingDelta(yearGain)})`}`
    );
  }).filter(Boolean).join('');

  return yearItems ? yearItems : '';
}

function buildLeaderboardPlayerEventChangeCardsHtml(row) {
  const historyEntries = getPlayerHistoryForRow(row)
    .filter(entry => Number.isFinite(Number(entry.delta)));

  if (historyEntries.length === 0) {
    return '';
  }

  const bestGain = historyEntries.reduce((bestEntry, entry) => {
    return !bestEntry || Number(entry.delta) > Number(bestEntry.delta) ? entry : bestEntry;
  }, null);
  const biggestLoss = historyEntries.reduce((worstEntry, entry) => {
    return !worstEntry || Number(entry.delta) < Number(worstEntry.delta) ? entry : worstEntry;
  }, null);

  const gainCard = buildStatCardHtml({
    title: 'Biggest Event Gain',
    value: bestGain ? formatRatingDelta(bestGain.delta) : '--',
    change: bestGain ? `${formatEventName(bestGain.event) || bestGain.event || 'Unknown Event'} on ${bestGain.date ? formatDate(bestGain.date) : 'Unknown Date'}` : '',
    icon: '\u{1F680}'
  });

  const lossCard = buildStatCardHtml({
    title: 'Biggest Loss of Elo',
    value: biggestLoss ? formatRatingDelta(biggestLoss.delta) : '--',
    change: biggestLoss ? `${formatEventName(biggestLoss.event) || biggestLoss.event || 'Unknown Event'} on ${biggestLoss.date ? formatDate(biggestLoss.date) : 'Unknown Date'}` : '',
    icon: '\u{1F4C9}'
  });

  return `
    <div class="stats-container">
      <div class="player-stats-row player-stats-row-secondary">
        ${gainCard}${lossCard}
      </div>
    </div>
  `;
}

function buildHistoryListHtml(entries = []) {
  if (entries.length === 0) {
    return '<div class="player-rank-drilldown-empty">No rated match history found for this leaderboard entry.</div>';
  }

  return `
    <div class="player-event-history-list">
      ${entries.map(entry => {
        const resultLabel = String(entry.resultType || 'unknown').toLowerCase();
        const roundLabel = Number.isFinite(Number(entry.round)) ? `Round ${Number(entry.round)}` : 'Round --';
        const eventLabel = formatEventName(entry.event) || entry.event || 'Unknown Event';
        const metaLabel = [
          `${resultLabel.charAt(0).toUpperCase()}${resultLabel.slice(1)} vs ${entry.opponent || entry.opponentKey || 'Unknown Opponent'}`,
          roundLabel,
          `${formatRating(entry.ratingBefore)} -> ${formatRating(entry.ratingAfter)} (${formatRatingDelta(entry.delta)} Elo)`
        ].join(' | ');

        return `
          <div class="player-event-history-item leaderboard-history-item-static">
            <span class="player-event-history-item-date">${escapeHtml(entry.date ? formatDate(entry.date) : '--')}</span>
            <span class="player-event-history-item-main">${escapeHtml(eventLabel)}</span>
            <span class="player-event-history-item-meta">${escapeHtml(metaLabel)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function buildHistoryHighlightCardsHtml(entries = [], badgeLabelBuilder = () => '') {
  if (entries.length === 0) {
    return '<div class="player-rank-drilldown-empty">No Elo history highlights found.</div>';
  }

  return entries.map(entry => {
    const relatedRow = getLeaderboardRowByKeys(entry.playerKey, entry.seasonKey);
    const badgeLabel = badgeLabelBuilder(entry);

    return `
      <article class="player-rank-drilldown-event">
        <div class="player-rank-drilldown-event-header">
          <div>
            <div class="player-rank-drilldown-event-date">${escapeHtml(entry.date ? formatDate(entry.date) : '--')}</div>
            <h4 class="player-rank-drilldown-event-name">${escapeHtml(entry.player || entry.playerKey || 'Unknown Player')}</h4>
          </div>
          <span class="player-rank-drilldown-rank-badge">${escapeHtml(badgeLabel)}</span>
        </div>
        <div class="player-rank-drilldown-summary-grid">
          ${buildSummaryItemHtml('When', buildHistoryContextLabel(entry))}
          ${buildSummaryItemHtml('Opponent', entry.opponent || entry.opponentKey || 'Unknown Opponent')}
          ${buildSummaryItemHtml('Result', formatResultLabel(entry.resultType))}
          ${buildSummaryItemHtml('Elo Before', formatRating(entry.ratingBefore))}
          ${buildSummaryItemHtml('Elo After', formatRating(entry.ratingAfter))}
          ${buildSummaryItemHtml('Current Elo', relatedRow ? formatRating(relatedRow.rating) : '--')}
        </div>
      </article>
    `;
  }).join('');
}

function buildLeaderboardPlayerSummaryHtml(rows = [], {
  collapsePlayers = true,
  collapseRecentResults = true
} = {}) {
  if (rows.length === 0) {
    return '<div class="player-rank-drilldown-empty">No Elo players found.</div>';
  }

  return rows.map(row => {
    const playerBodyId = `leaderboardPlayerBody-${String(row.seasonKey || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.playerKey || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const recentResultsId = `leaderboardRecentResults-${String(row.seasonKey || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.playerKey || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const recentHistory = getPlayerHistoryForRow(row).slice(0, 12);
    const latestEventLabel = formatEventName(row.lastEvent) || row.lastEvent || '--';
    const playerHeaderLabel = row.displayName || row.playerKey || 'Unknown Player';
    const playerMeta = `${formatRating(row.rating)} Elo | ${row.matches} matches | ${getLeaderboardEntryLabel(row)}`;

    return `
      <article class="player-rank-drilldown-event">
        <div class="player-rank-drilldown-event-header leaderboard-player-card-header leaderboard-player-card-header-collapsible">
          <button
            type="button"
            class="event-stat-drilldown-list-item player-summary-event-toggle leaderboard-player-card-toggle-row"
            data-leaderboard-player-toggle="${escapeHtml(playerBodyId)}"
            aria-expanded="${collapsePlayers ? 'false' : 'true'}"
            aria-controls="${escapeHtml(playerBodyId)}"
            title="${escapeHtml(playerMeta)}"
          >
            <span class="event-stat-drilldown-list-item-date">${escapeHtml(row.lastActiveDate ? formatDate(row.lastActiveDate) : 'No recent match')}</span>
            <span class="event-stat-drilldown-list-item-main">${escapeHtml(playerHeaderLabel)}</span>
            <span class="event-stat-drilldown-list-item-meta">${escapeHtml(playerMeta)}</span>
            <span class="player-summary-event-toggle-indicator drilldown-toggle-indicator">${collapsePlayers ? '+' : '-'}</span>
          </button>
        </div>
        <div id="${escapeHtml(playerBodyId)}" class="leaderboard-player-card-body"${collapsePlayers ? ' hidden' : ''}>
          <div class="player-rank-drilldown-summary-grid leaderboard-player-summary-grid">
            ${buildSummaryItemHtml(getLeaderboardEntryFieldLabel(currentLeaderboardDataset), getLeaderboardEntryLabel(row), { updated: true })}
            ${buildSummaryItemHtml('Current Elo', formatRating(row.rating), { updated: true })}
            ${buildSummaryItemHtml('Matches', String(row.matches || 0), { updated: true })}
            ${buildSummaryItemHtml('Wins', String(row.wins || 0))}
            ${buildSummaryItemHtml('Losses', String(row.losses || 0))}
            ${buildSummaryItemHtml('Win Rate', formatWinRate(row.winRate))}
            ${buildSummaryItemHtml('Last Match', row.lastActiveDate ? formatDate(row.lastActiveDate) : '--')}
            ${buildSummaryItemHtml('Latest Event', latestEventLabel)}
          </div>
          <div class="player-rank-drilldown-context">
            <div class="player-rank-drilldown-context-header leaderboard-player-results-header">
              <div class="player-rank-drilldown-context-title">Recent Rated Matches</div>
              <button
                type="button"
                class="leaderboard-results-toggle drilldown-toggle-indicator"
                data-leaderboard-results-toggle="${escapeHtml(recentResultsId)}"
                aria-expanded="${collapseRecentResults ? 'false' : 'true'}"
                aria-controls="${escapeHtml(recentResultsId)}"
                title="${collapseRecentResults ? 'Show recent rated matches' : 'Hide recent rated matches'}"
              >
                ${collapseRecentResults ? '+' : '-'}
              </button>
            </div>
            <div id="${escapeHtml(recentResultsId)}" class="leaderboard-player-results-body"${collapseRecentResults ? ' hidden' : ''}>
              ${buildHistoryListHtml(recentHistory)}
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function getRatedMatchEventSummaries() {
  const groups = new Map();

  (currentLeaderboardDataset.processedMatches || []).forEach(match => {
    const seasonYear = String(match.seasonYear || '').trim() || 'Unknown';
    const eventId = String(match.event_id || match.eventId || match.event || '').trim();
    const eventName = String(match.event || match.Event || eventId || 'Unknown Event').trim();
    const date = String(match.date || match.Date || '').trim();
    const calendarYear = date.slice(0, 4) || 'Unknown';
    const groupKey = [date, eventId].join('|||');

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        seasonYear,
        calendarYear,
        eventId,
        event: eventName,
        date,
        ratedMatches: 0,
        playerKeys: new Set(),
        latestRound: null
      });
    }

    const summary = groups.get(groupKey);
    summary.ratedMatches += 1;

    if (match.player_a_key) {
      summary.playerKeys.add(String(match.player_a_key).trim());
    }
    if (match.player_b_key) {
      summary.playerKeys.add(String(match.player_b_key).trim());
    }

    const roundValue = Number(match.round);
    if (Number.isFinite(roundValue)) {
      summary.latestRound = Number.isFinite(summary.latestRound)
        ? Math.max(summary.latestRound, roundValue)
        : roundValue;
    }
  });

  return Array.from(groups.values())
    .map(summary => ({
      ...summary,
      uniquePlayers: summary.playerKeys.size
    }))
    .sort((a, b) => {
      return (
        String(b.date || '').localeCompare(String(a.date || '')) ||
        Number(b.ratedMatches || 0) - Number(a.ratedMatches || 0) ||
        String(a.event || '').localeCompare(String(b.event || ''), undefined, { sensitivity: 'base' }) ||
        String(a.eventId || '').localeCompare(String(b.eventId || ''))
      );
    });
}

function buildRatedMatchEventListHtml(items = []) {
  if (items.length === 0) {
    return '<div class="player-rank-drilldown-empty">No rated events found.</div>';
  }

  return items.map(item => {
    const eventLabel = formatEventName(item.event) || item.event || 'Unknown Event';
    const roundLabel = Number.isFinite(item.latestRound) ? `Through round ${item.latestRound}` : 'Round data unavailable';

    return `
      <article class="player-rank-drilldown-event">
        <div class="player-rank-drilldown-event-header">
          <div>
            <div class="player-rank-drilldown-event-date">${escapeHtml(item.date ? formatDate(item.date) : '--')}</div>
            <h4 class="player-rank-drilldown-event-name">${escapeHtml(eventLabel)}</h4>
          </div>
          <span class="player-rank-drilldown-rank-badge">${item.ratedMatches} Rated</span>
        </div>
        <div class="player-rank-drilldown-summary-grid">
          ${buildSummaryItemHtml(currentLeaderboardDataset.resetByYear ? 'Season' : 'Calendar Year', currentLeaderboardDataset.resetByYear ? (item.seasonYear || 'Unknown') : (item.calendarYear || 'Unknown'))}
          ${buildSummaryItemHtml('Players Seen', String(item.uniquePlayers || 0))}
          ${buildSummaryItemHtml('Latest Round', roundLabel)}
        </div>
      </article>
    `;
  }).join('');
}

function getLeaderboardDrilldownItems(categoryKey) {
  switch (categoryKey) {
    case 'ratedMatches':
      return getRatedMatchEventSummaries();
    case 'trackedPlayers':
      return [...currentLeaderboardRows];
    case 'topElo':
      return getRowsAtMaxValue(currentLeaderboardRows, 'rating').filter(row => Number.isFinite(Number(row.rating)));
    case 'peakElo':
      return getPeakEloEntries();
    case 'mostActive':
      return getRowsAtMaxValue(currentLeaderboardRows, 'matches').filter(row => Number(row.matches) > 0);
    case 'biggestSwing':
      return [...getBiggestGainEntries(), ...getBiggestLossEntries()];
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

  destroyLeaderboardPlayerEloChart();
  updateLeaderboardPlayerHistoryDownloadButton();

  const items = getLeaderboardDrilldownItems(categoryKey);
  const summary = currentLeaderboardDataset.summary || {};
  elements.title.textContent = config.title;

  if (categoryKey === 'ratedMatches') {
    elements.subtitle.textContent = items.length > 0
      ? `${summary.ratedMatches || 0} rated matches across ${items.length} event${items.length === 1 ? '' : 's'}`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? buildRatedMatchEventListHtml(items)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'trackedPlayers') {
    const rowLabel = getLeaderboardRowCollectionLabel(summary.seasonEntries || 0, currentLeaderboardDataset);
    elements.subtitle.textContent = items.length > 0
      ? `${summary.uniquePlayers || 0} tracked player${summary.uniquePlayers === 1 ? '' : 's'} represented by ${rowLabel}`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? buildLeaderboardPlayerSummaryHtml(items, { collapsePlayers: true })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'topElo') {
    const topRating = items[0]?.rating;
    const shouldCollapseSinglePlayerSections = items.length !== 1;
    elements.subtitle.textContent = items.length > 0
      ? `${items.length} player${items.length === 1 ? '' : 's'} tied at ${formatRating(topRating)} Elo`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? buildLeaderboardPlayerSummaryHtml(items, {
        collapsePlayers: shouldCollapseSinglePlayerSections,
        collapseRecentResults: shouldCollapseSinglePlayerSections
      })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'peakElo') {
    const peakRating = items[0]?.ratingAfter;
    elements.subtitle.textContent = items.length > 0
      ? `${items.length} player${items.length === 1 ? '' : 's'} reached ${formatRating(peakRating)} Elo at the highest point in the selected Leaderboards window`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? buildHistoryHighlightCardsHtml(items, entry => `${formatRating(entry.ratingAfter)} Elo`)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  const topMatchCount = items[0]?.matches || 0;
  if (categoryKey === 'mostActive') {
    const shouldCollapseSinglePlayerSections = items.length !== 1;
    elements.subtitle.textContent = items.length > 0
      ? `${items.length} player${items.length === 1 ? '' : 's'} with ${topMatchCount} rated match${topMatchCount === 1 ? '' : 'es'}`
      : config.emptyMessage;
    elements.content.innerHTML = items.length > 0
      ? buildLeaderboardPlayerSummaryHtml(items, {
        collapsePlayers: shouldCollapseSinglePlayerSections,
        collapseRecentResults: shouldCollapseSinglePlayerSections
      })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  const biggestGainEntries = getBiggestGainEntries();
  const biggestLossEntries = getBiggestLossEntries();
  const biggestGain = biggestGainEntries[0]?.delta;
  const biggestLoss = biggestLossEntries[0]?.delta;

  elements.subtitle.textContent = items.length > 0
    ? `Largest single-match Elo swing in the selected Leaderboards window: ${formatRatingDelta(biggestGain)} / ${formatRatingDelta(biggestLoss)}`
    : config.emptyMessage;
  elements.content.innerHTML = items.length > 0
      ? `
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-header">
          <div class="player-rank-drilldown-context-title">Biggest Elo Gain</div>
        </div>
        ${buildHistoryHighlightCardsHtml(biggestGainEntries, entry => formatRatingDelta(entry.delta))}
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-header">
          <div class="player-rank-drilldown-context-title">Biggest Elo Loss</div>
        </div>
        ${buildHistoryHighlightCardsHtml(biggestLossEntries, entry => formatRatingDelta(entry.delta))}
      </div>
    `
    : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
}

function openLeaderboardDrilldown(categoryKey) {
  const elements = getLeaderboardDrilldownElements();
  if (!elements.overlay || !LEADERBOARD_DRILLDOWN_CONFIG[categoryKey]) {
    return;
  }

  activeLeaderboardDrilldownCategory = categoryKey;
  activeLeaderboardPlayerDrilldown = null;
  renderLeaderboardDrilldown(categoryKey);
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

async function closeLeaderboardDrilldown() {
  const { overlay } = getLeaderboardDrilldownElements();
  if (!overlay) {
    return;
  }

  destroyLeaderboardPlayerEloChart();
  overlay.hidden = true;
  activeLeaderboardDrilldownCategory = '';
  activeLeaderboardPlayerDrilldown = null;
  updateLeaderboardPlayerHistoryDownloadButton();
  document.body.classList.remove('modal-open');

  if (shouldRestoreLeaderboardFullscreen) {
    shouldRestoreLeaderboardFullscreen = false;
    const container = getLeaderboardTableContainer();
    if (container?.requestFullscreen) {
      try {
        await container.requestFullscreen();
      } catch (error) {
        console.error('Failed to restore leaderboard fullscreen mode.', error);
      }
    }
  }
}

function setupLeaderboardDrilldownModal() {
  const { overlay, closeButton, content, historyDownloadButton } = getLeaderboardDrilldownElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closeLeaderboardDrilldown);
  historyDownloadButton?.addEventListener('click', event => {
    exportLeaderboardPlayerHistoryCsv(
      event.currentTarget.dataset.leaderboardDownloadHistory,
      event.currentTarget.dataset.leaderboardDownloadHistorySeason
    );
  });

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeLeaderboardDrilldown();
    }
  });

  content?.addEventListener('click', event => {
    const downloadButton = event.target.closest('[data-leaderboard-download-history]');
    if (downloadButton) {
      exportLeaderboardPlayerHistoryCsv(
        downloadButton.dataset.leaderboardDownloadHistory,
        downloadButton.dataset.leaderboardDownloadHistorySeason
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
    toggleButton.title = shouldExpand ? 'Hide recent rated matches' : 'Show recent rated matches';
    target.hidden = !shouldExpand;
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeLeaderboardDrilldown();
    }
  });
}

function setupLeaderboardTableRowInteractions() {
  const tableBody = document.getElementById('leaderboardTableBody');
  if (!tableBody || tableBody.dataset.listenerAdded === 'true') {
    return;
  }

  const openRowDrilldown = async row => {
    if (!row) {
      return;
    }

    const container = getLeaderboardTableContainer();
    if (container && document.fullscreenElement === container && document.exitFullscreen) {
      shouldRestoreLeaderboardFullscreen = true;
      await document.exitFullscreen();
    } else {
      shouldRestoreLeaderboardFullscreen = false;
    }

    openLeaderboardPlayerDrilldown(
      row.dataset.leaderboardPlayerKey,
      row.dataset.leaderboardSeasonKey
    );
  };

  tableBody.addEventListener('click', event => {
    const row = event.target.closest('tr[data-leaderboard-player-key][data-leaderboard-season-key]');
    if (!row) {
      return;
    }

    openRowDrilldown(row).catch(error => {
      console.error('Failed to open leaderboard player drilldown.', error);
    });
  });

  tableBody.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const row = event.target.closest('tr[data-leaderboard-player-key][data-leaderboard-season-key]');
    if (!row) {
      return;
    }

    event.preventDefault();
    openRowDrilldown(row).catch(error => {
      console.error('Failed to open leaderboard player drilldown.', error);
    });
  });

  tableBody.dataset.listenerAdded = 'true';
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

function populateLeaderboardStats(dataset) {
  const { summary } = dataset;
  const topEloRows = getRowsAtMaxValue(currentLeaderboardRows, 'rating').filter(row => Number.isFinite(Number(row.rating)));
  const mostActiveRows = getRowsAtMaxValue(currentLeaderboardRows, 'matches').filter(row => Number(row.matches) > 0);
  const topEloNames = topEloRows.map(row => row.displayName).filter(Boolean);
  const mostActiveNames = mostActiveRows.map(row => row.displayName).filter(Boolean);
  const peakEloEntries = getPeakEloEntries();
  const biggestGainEntries = getBiggestGainEntries();
  const biggestLossEntries = getBiggestLossEntries();
  const topRating = topEloRows[0]?.rating;
  const peakRating = peakEloEntries[0]?.ratingAfter;
  const topMatchCount = mostActiveRows[0]?.matches || 0;
  const rowCollectionLabel = getLeaderboardRowCollectionLabel(summary.seasonEntries || 0, dataset);
  const selectedPairingsLabel = summary.selectedMatches > 0
    ? `${summary.selectedMatches} selected pairings${summary.skippedMatches > 0 ? ` / ${summary.skippedMatches} skipped due to byes or unknown results` : ''}`
    : 'No selected pairings';
  const selectedRangeLabel = getWindowLabel(dataset.period, dataset.summary.selectedYears, dataset.startDate, dataset.endDate) || '--';
  const selectedRangeDetails = formatWindowRange(dataset.startDate, dataset.endDate);

  updateElementText('leaderboardDateRangeValue', selectedRangeLabel);
  updateElementText('leaderboardDateRangeDetails', selectedRangeDetails || 'Choose a leaderboard window');
  updateElementText('leaderboardRatedMatches', String(summary.ratedMatches || 0));
  updateElementText('leaderboardRatedMatchesDetails', selectedPairingsLabel);
  updateElementText('leaderboardTrackedPlayers', String(summary.uniquePlayers || 0));
  updateElementText(
    'leaderboardTrackedPlayersDetails',
    rowCollectionLabel
  );
  updateElementText(
    'leaderboardTopEloName',
    topEloRows.length > 1 ? `${topEloRows.length} Players Tied` : (summary.leader?.displayName || '--')
  );
  updateElementText(
    'leaderboardTopEloDetails',
    topEloRows.length > 1
      ? `${formatRating(topRating)} Elo / ${formatNameList(topEloNames)}`
      : (
        summary.leader
          ? `${formatRating(summary.leader.rating)} Elo / ${summary.leader.matches} matches / ${getLeaderboardEntryLabel(summary.leader)}`
          : 'No leader yet'
      )
  );
  updateElementText(
    'leaderboardPeakEloName',
    peakEloEntries.length > 1
      ? `${peakEloEntries.length} Players Tied`
      : (peakEloEntries[0]?.player || peakEloEntries[0]?.playerKey || '--')
  );
  updateElementText(
    'leaderboardPeakEloDetails',
    peakEloEntries.length > 1
      ? (
        peakRating
          ? `${formatRating(peakRating)} Elo / ${formatNameList(peakEloEntries.map(entry => entry.player || entry.playerKey))}`
          : 'No peak yet'
      )
      : (
        peakEloEntries[0]
          ? `${formatRating(peakEloEntries[0].ratingAfter)} Elo in ${buildHistoryContextLabel(peakEloEntries[0])}`
          : 'No peak yet'
      )
  );
  updateElementText(
    'leaderboardMostActiveName',
    mostActiveRows.length > 1 ? `${mostActiveRows.length} Players Tied` : (summary.mostActiveSeason?.displayName || '--')
  );
  updateElementText(
    'leaderboardMostActiveDetails',
    mostActiveRows.length > 1
      ? `${topMatchCount} matches each / ${formatNameList(mostActiveRows.map(row => `${row.displayName} (${formatRating(row.rating)} Elo)`))}`
      : (
        summary.mostActiveSeason
          ? `${summary.mostActiveSeason.matches} matches / ${formatRating(summary.mostActiveSeason.rating)} Elo / ${formatWinRate(summary.mostActiveSeason.winRate)} WR / ${getLeaderboardEntryLabel(summary.mostActiveSeason)}`
          : 'No active player yet'
      )
  );
  updateElementText(
    'leaderboardBiggestSwingName',
    biggestGainEntries[0] && biggestLossEntries[0]
      ? `${formatRatingDelta(biggestGainEntries[0].delta)} / ${formatRatingDelta(biggestLossEntries[0].delta)}`
      : 'No swings yet'
  );
  updateElementText(
    'leaderboardBiggestSwingDetails',
    biggestGainEntries[0] && biggestLossEntries[0]
      ? `Gain: ${(biggestGainEntries[0].player || biggestGainEntries[0].playerKey || '--')} in ${buildHistoryContextLabel(biggestGainEntries[0])} | Loss: ${(biggestLossEntries[0].player || biggestLossEntries[0].playerKey || '--')} in ${buildHistoryContextLabel(biggestLossEntries[0])}`
      : 'No swings yet'
  );

  LEADERBOARD_STAT_CARD_IDS.forEach(triggerUpdateAnimation);
}

function renderLeaderboardTable(dataset) {
  const rowsWithRank = getSortedLeaderboardRowsWithRank();
  const entryFieldLabel = getLeaderboardEntryFieldLabel(dataset);
  const yearGainColumns = getLeaderboardSelectedYearGainColumns(dataset);
  const yearGainHeaderCells = yearGainColumns.map(year => `<th>${escapeHtml(`${year} Elo Gains`)}</th>`).join('');
  const totalColumns = 9 + yearGainColumns.length;

  updateElementText('leaderboardTableTitle', getLeaderboardViewTitle(dataset));
  updateElementText('leaderboardTableHelper', buildLeaderboardTableHelperText(dataset));
  updateElementHTML(
    'leaderboardTableHead',
    `
      <tr>
        <th>Rank</th>
        <th>Player</th>
        <th><span id="leaderboardEntryColumnLabel">${escapeHtml(entryFieldLabel)}</span></th>
        <th>Elo</th>
        ${yearGainHeaderCells}
        <th>Matches</th>
        <th>Wins</th>
        <th>Losses</th>
        <th>Win Rate</th>
        <th>Last Match</th>
      </tr>
    `
  );
  updateElementHTML(
    'leaderboardTableBody',
    rowsWithRank.length === 0
      ? `<tr><td colspan="${totalColumns}">No Elo leaderboard rows are available for the selected filters.</td></tr>`
      : rowsWithRank.map(row => `
        <tr
          class="leaderboard-player-row"
          data-leaderboard-player-name="${escapeHtml(normalizeLeaderboardSearchText(row.displayName))}"
          data-leaderboard-player-key="${escapeHtml(row.playerKey || '')}"
          data-leaderboard-season-key="${escapeHtml(row.seasonKey || '')}"
          tabindex="0"
          role="button"
          aria-label="${escapeHtml(`Open Elo details for ${row.displayName || row.playerKey || 'player'} in ${getLeaderboardEntryLabel(row)}`)}"
        >
          <td class="leaderboard-rank-cell">${row.displayRank}</td>
          <td>${escapeHtml(row.displayName)}</td>
          <td>${escapeHtml(getLeaderboardEntryLabel(row))}</td>
          <td>${formatRating(row.rating)}</td>
          ${yearGainColumns.map(year => `<td>${escapeHtml(getLeaderboardRowYearGainValue(row, year))}</td>`).join('')}
          <td>${row.matches}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${formatWinRate(row.winRate)}</td>
          <td>${row.lastActiveDate ? escapeHtml(formatDate(row.lastActiveDate)) : '--'}</td>
        </tr>
      `).join('')
  );
}

async function toggleLeaderboardFullscreen() {
  const container = getLeaderboardTableContainer();
  if (!container) {
    return;
  }

  if (document.fullscreenElement === container) {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
    return;
  }

  if (container.requestFullscreen) {
    await container.requestFullscreen();
  }
}

function updateLeaderboardFullscreenButtonState() {
  const button = getLeaderboardFullscreenButton();
  const container = getLeaderboardTableContainer();
  if (!button || !container) {
    return;
  }

  button.textContent = document.fullscreenElement === container ? 'Exit Full Screen' : 'Full Screen';
}

function setupLeaderboardTableActions() {
  const searchInput = getLeaderboardSearchInput();
  const downloadButton = getLeaderboardDownloadButton();
  const fullscreenButton = getLeaderboardFullscreenButton();

  if (searchInput && searchInput.dataset.listenerAdded !== 'true') {
    searchInput.addEventListener('input', () => {
      const currentValue = searchInput.value || '';
      if (!currentValue.trim()) {
        applyLeaderboardTableSearch('', { scrollIntoView: false });
        return;
      }

      applyLeaderboardTableSearch(currentValue, { scrollIntoView: true });
    });

    searchInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      applyLeaderboardTableSearch(searchInput.value || '', { scrollIntoView: true });
    });

    searchInput.dataset.listenerAdded = 'true';
  }

  if (downloadButton && downloadButton.dataset.listenerAdded !== 'true') {
    downloadButton.addEventListener('click', exportLeaderboardCsv);
    downloadButton.dataset.listenerAdded = 'true';
  }

  if (fullscreenButton && fullscreenButton.dataset.listenerAdded !== 'true') {
    fullscreenButton.addEventListener('click', () => {
      toggleLeaderboardFullscreen().catch(error => {
        console.error('Failed to toggle leaderboard fullscreen mode.', error);
      });
    });
    fullscreenButton.dataset.listenerAdded = 'true';
  }

  if (document.body.dataset.leaderboardFullscreenBound !== 'true') {
    document.addEventListener('fullscreenchange', updateLeaderboardFullscreenButtonState);
    document.body.dataset.leaderboardFullscreenBound = 'true';
  }

  updateLeaderboardFullscreenButtonState();
}

function setupLeaderboardTimelineInteractions() {
  const searchInput = getLeaderboardTimelineSearchInput();
  const dropdown = getLeaderboardTimelineSearchDropdown();
  const chipPanel = getLeaderboardTimelineChipPanel();

  if (searchInput && searchInput.dataset.listenerAdded !== 'true') {
    searchInput.addEventListener('input', () => {
      activeLeaderboardTimelineSearchTerm = searchInput.value || '';
      renderLeaderboardTimelineSearchDropdown();
    });

    searchInput.addEventListener('focus', () => {
      activeLeaderboardTimelineSearchTerm = searchInput.value || '';
      renderLeaderboardTimelineSearchDropdown();
    });

    searchInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        activeLeaderboardTimelineSearchTerm = '';
        searchInput.value = '';
        renderLeaderboardTimelineSearchDropdown();
        return;
      }

      if (event.key !== 'Enter') {
        return;
      }

      const firstMatch = getSortedLeaderboardRowsWithRank()
        .filter(row => !activeLeaderboardTimelineSelections.has(getLeaderboardRowSelectionKey(row)))
        .find(row => {
          const haystack = [
            row.displayName,
            row.playerKey,
            getLeaderboardEntryLabel(row)
          ].join(' ').toLowerCase();
          return haystack.includes(String(activeLeaderboardTimelineSearchTerm || '').trim().toLowerCase());
        });

      if (!firstMatch) {
        return;
      }

      event.preventDefault();
      activeLeaderboardTimelineSelections.add(getLeaderboardRowSelectionKey(firstMatch));
      activeLeaderboardTimelineSearchTerm = '';
      searchInput.value = '';
      renderLeaderboardTimelineChart();
    });

    searchInput.dataset.listenerAdded = 'true';
  }

  if (dropdown && dropdown.dataset.listenerAdded !== 'true') {
    dropdown.addEventListener('click', event => {
      const button = event.target.closest('[data-leaderboard-timeline-add]');
      if (!button) {
        return;
      }

      activeLeaderboardTimelineSelections.add(String(button.dataset.leaderboardTimelineAdd || ''));
      activeLeaderboardTimelineSearchTerm = '';
      const input = getLeaderboardTimelineSearchInput();
      if (input) {
        input.value = '';
      }
      dropdown.hidden = true;
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
      renderLeaderboardTimelineChart();
    });

    dropdown.dataset.listenerAdded = 'true';
  }

  if (chipPanel && chipPanel.dataset.listenerAdded !== 'true') {
    chipPanel.addEventListener('click', event => {
      const button = event.target.closest('[data-leaderboard-timeline-remove]');
      if (!button) {
        return;
      }

      activeLeaderboardTimelineSelections.delete(String(button.dataset.leaderboardTimelineRemove || ''));
      renderLeaderboardTimelineChart();
    });

    chipPanel.dataset.listenerAdded = 'true';
  }
}

function setupLeaderboardFilterListeners() {
  const eventTypeButtons = getLeaderboardEventTypeButtons();
  const windowModeButtons = getLeaderboardWindowModeButtons();
  const seasonYearRoot = getLeaderboardSeasonYearRoot();
  const rangeStartYearRoot = document.getElementById('leaderboardRangeStartYearButtons');
  const rangeEndYearRoot = document.getElementById('leaderboardRangeEndYearButtons');
  const resetModeButtons = getLeaderboardResetModeButtons();

  eventTypeButtons.forEach(button => {
    if (button.dataset.listenerAdded === 'true') {
      return;
    }

    button.addEventListener('click', () => {
      setLeaderboardEventType(button.dataset.type);
      renderLeaderboardWindowControls();

      if (getTopMode() === 'leaderboard') {
        updateLeaderboardAnalytics();
      }
    });

    button.dataset.listenerAdded = 'true';
  });

  windowModeButtons.forEach(button => {
    if (button.dataset.listenerAdded === 'true') {
      return;
    }

    button.addEventListener('click', () => {
      if (button.disabled) {
        return;
      }

      activeLeaderboardWindowMode = String(button.dataset.leaderboardWindowMode || DEFAULT_LEADERBOARD_WINDOW_MODE);
      renderLeaderboardWindowControls();

      if (getTopMode() === 'leaderboard') {
        updateLeaderboardAnalytics();
      }
    });

    button.dataset.listenerAdded = 'true';
  });

  if (seasonYearRoot && seasonYearRoot.dataset.listenerAdded !== 'true') {
    seasonYearRoot.addEventListener('click', event => {
      const yearButton = event.target.closest('[data-leaderboard-season-year]');
      if (!yearButton) {
        return;
      }

      activeLeaderboardSeasonYear = String(yearButton.dataset.leaderboardSeasonYear || '');
      renderLeaderboardWindowControls();

      if (getTopMode() === 'leaderboard') {
        updateLeaderboardAnalytics();
      }
    });

    seasonYearRoot.dataset.listenerAdded = 'true';
  }

  if (rangeStartYearRoot && rangeStartYearRoot.dataset.listenerAdded !== 'true') {
    rangeStartYearRoot.addEventListener('click', event => {
      const yearButton = event.target.closest('[data-leaderboard-range-start-year]');
      if (!yearButton) {
        return;
      }

      activeLeaderboardRangeStartYear = String(yearButton.dataset.leaderboardRangeStartYear || '');
      if (
        activeLeaderboardRangeEndYear
        && activeLeaderboardRangeStartYear
        && activeLeaderboardRangeStartYear.localeCompare(activeLeaderboardRangeEndYear) > 0
      ) {
        activeLeaderboardRangeEndYear = activeLeaderboardRangeStartYear;
      }

      renderLeaderboardWindowControls();

      if (getTopMode() === 'leaderboard') {
        updateLeaderboardAnalytics();
      }
    });

    rangeStartYearRoot.dataset.listenerAdded = 'true';
  }

  if (rangeEndYearRoot && rangeEndYearRoot.dataset.listenerAdded !== 'true') {
    rangeEndYearRoot.addEventListener('click', event => {
      const yearButton = event.target.closest('[data-leaderboard-range-end-year]');
      if (!yearButton) {
        return;
      }

      activeLeaderboardRangeEndYear = String(yearButton.dataset.leaderboardRangeEndYear || '');
      if (
        activeLeaderboardRangeStartYear
        && activeLeaderboardRangeEndYear
        && activeLeaderboardRangeEndYear.localeCompare(activeLeaderboardRangeStartYear) < 0
      ) {
        activeLeaderboardRangeStartYear = activeLeaderboardRangeEndYear;
      }

      renderLeaderboardWindowControls();

      if (getTopMode() === 'leaderboard') {
        updateLeaderboardAnalytics();
      }
    });

    rangeEndYearRoot.dataset.listenerAdded = 'true';
  }

  resetModeButtons.forEach(button => {
    if (button.dataset.listenerAdded === 'true') {
      return;
    }

    button.addEventListener('click', () => {
      if (button.disabled) {
        return;
      }

      activeLeaderboardResetMode = String(button.dataset.leaderboardResetMode || DEFAULT_LEADERBOARD_RESET_MODE);
      renderLeaderboardWindowControls();

      if (getTopMode() === 'leaderboard') {
        updateLeaderboardAnalytics();
      }
    });

    button.dataset.listenerAdded = 'true';
  });
}

export function initLeaderboards() {
  setLeaderboardEventType(DEFAULT_EVENT_TYPE);
  renderLeaderboardWindowControls();
  setupLeaderboardTableRowInteractions();
  setupLeaderboardTableActions();
  setupLeaderboardTimelineInteractions();
  setupLeaderboardFilterListeners();
  setupLeaderboardDrilldownModal();
  setupLeaderboardDrilldownCards();
}

export async function updateLeaderboardAnalytics() {
  const requestId = leaderboardDatasetRequestId + 1;
  leaderboardDatasetRequestId = requestId;
  const activeWindow = renderLeaderboardWindowControls();
  const searchInput = getLeaderboardSearchInput();
  const downloadButton = getLeaderboardDownloadButton();

  if (searchInput) {
    searchInput.disabled = true;
  }
  if (downloadButton) {
    downloadButton.disabled = true;
  }

  renderLeaderboardLoadingState();

  let dataset;
  try {
    dataset = await buildRankingsDataset({
      eventTypes: getSelectedLeaderboardEventTypes(),
      startDate: activeWindow?.startDate || '',
      endDate: activeWindow?.endDate || ''
    }, {
      resetByYear: activeWindow?.resetByYear
    });
  } catch (error) {
    if (requestId !== leaderboardDatasetRequestId) {
      return;
    }

    console.error('Failed to build Elo leaderboard dataset.', error);
    currentLeaderboardRows = [];
    renderLeaderboardErrorState('Unable to load Elo leaderboard data for the selected window.');
    return;
  }

  if (requestId !== leaderboardDatasetRequestId) {
    return;
  }

  currentLeaderboardDataset = {
    ...dataset,
    period: activeWindow
  };
  currentLeaderboardRows = dataset.seasonRows;

  populateLeaderboardStats(currentLeaderboardDataset);
  updateLeaderboardDrilldownCardStates();
  renderLeaderboardTable(currentLeaderboardDataset);
  renderLeaderboardTimelineChart();
  if (searchInput) {
    searchInput.disabled = currentLeaderboardRows.length === 0;
  }
  if (downloadButton) {
    downloadButton.disabled = currentLeaderboardRows.length === 0;
  }
  if (activeLeaderboardSearchTerm) {
    applyLeaderboardTableSearch(searchInput?.value || activeLeaderboardSearchTerm, { scrollIntoView: false });
  } else {
    clearLeaderboardSearchHighlights();
    updateLeaderboardSearchStatus('');
  }

  if (activeLeaderboardPlayerDrilldown?.playerKey && activeLeaderboardPlayerDrilldown?.seasonKey) {
    const didRenderPlayerDrilldown = renderLeaderboardPlayerDrilldown(
      activeLeaderboardPlayerDrilldown.playerKey,
      activeLeaderboardPlayerDrilldown.seasonKey
    );

    if (!didRenderPlayerDrilldown) {
      closeLeaderboardDrilldown();
    }
  } else if (activeLeaderboardDrilldownCategory) {
    renderLeaderboardDrilldown(activeLeaderboardDrilldownCategory);
  }
}

