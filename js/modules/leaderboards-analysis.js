// Renders the Leaderboards view: Elo controls, sortable table, stat cards,
// player drilldowns, timeline charts, CSV exports, and PDF season reports.
import { escapeHtml, getTopMode } from './filters/shared.js';
import { updateElementHTML, updateElementText, triggerUpdateAnimation } from '../utils/dom.js';
import { countUniqueEvents, formatDate, formatEventName } from '../utils/format.js';
import {
  DEFAULT_RANKINGS_OPTIONS,
  buildRankingsDataset,
  getRankingsKFactor,
  getRankingsAvailableDates
} from '../utils/rankings-data.js';
import { buildYearlyEloRatings } from '../utils/elo-rating.js';
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
import { downloadTextPdfReport } from './export-pdf-report.js';
import { openSingleEventPlayerInAnalysis } from './event-analysis.js';
import { getAnalysisRows } from '../utils/analysis-data.js';
import { getPlayerIdentityKey } from '../utils/player-names.js';
import { getEventGroupInfo } from '../utils/event-groups.js';

const DEFAULT_EVENT_TYPE = 'online';
const DEFAULT_LEADERBOARD_WINDOW_MODE = 'seasonal';
const DEFAULT_LEADERBOARD_RESET_MODE = 'continuous';
const LEADERBOARD_PLAYER_TOTAL_SCOPE = '__all_decks__';
const LEADERBOARD_REPORT_TOTAL_ELO_COLOR = '#d4a657';
const LEADERBOARD_REPORT_FOCUSED_DECK_COLOR = '#5aa9e6';
const LEADERBOARD_ELO_UNKNOWN_DECK_NOTE = 'Elo always includes UNKNOWN decks (player vs player), so the Data Quality toggle is not available.';
const LEADERBOARD_SORTABLE_KEYS = Object.freeze({
  elo: new Set(['displayName', 'seasonYear', 'rating', 'eventCount', 'matches', 'wins', 'losses', 'winRate', 'top8Conversion', 'challengeWins', 'lastActiveDate'])
});
// Threshold controls are generated from this config so adding a new Elo filter
// only requires one key with DOM ids, label text, and a row-value accessor.
const LEADERBOARD_ELO_THRESHOLD_CONFIG = Object.freeze({
  minEvents: {
    inputId: 'leaderboardMinEventsInput',
    sliderId: 'leaderboardMinEventsSlider',
    rangeId: 'leaderboardMinEventsRange',
    label: 'Events',
    step: 1,
    getRowValue: row => Number(row?.eventCount || 0)
  },
  minMatches: {
    inputId: 'leaderboardMinMatchesInput',
    sliderId: 'leaderboardMinMatchesSlider',
    rangeId: 'leaderboardMinMatchesRange',
    label: 'Matches',
    step: 1,
    getRowValue: row => Number(row?.matches || 0)
  },
  minElo: {
    inputId: 'leaderboardMinEloInput',
    sliderId: 'leaderboardMinEloSlider',
    rangeId: 'leaderboardMinEloRange',
    label: 'Elo',
    step: 1,
    getRowValue: row => Number(row?.rating || 0)
  },
  minTopConversion: {
    inputId: 'leaderboardMinTopConversionInput',
    sliderId: 'leaderboardMinTopConversionSlider',
    rangeId: 'leaderboardMinTopConversionRange',
    label: 'Top 8 Conversion',
    step: 0.1,
    getRowValue: row => Number(row?.top8Conversion || 0) * 100
  }
});
const LEADERBOARD_ELO_THRESHOLD_QUICK_VIEW_OPTIONS = Object.freeze([1, 10, 50, 90, 99]);
const LEADERBOARD_STAT_CARD_IDS = [
  'leaderboardDateRangeCard',
  'leaderboardEventsCard',
  'leaderboardRatedMatchesCard',
  'leaderboardTrackedPlayersCard',
  'leaderboardTopEloCard',
  'leaderboardPeakEloCard',
  'leaderboardMostActiveCard',
  'leaderboardBiggestSwingCard'
];
// Drilldown copy stays declarative so card wiring and empty states remain in
// sync when cards are renamed or rearranged.
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

// Module-level state mirrors the currently selected controls and the dataset
// rendered on screen. Keeping it here avoids repeatedly scraping the DOM when
// sorting, exporting, opening drilldowns, or redrawing charts.
let activeLeaderboardWindowMode = DEFAULT_LEADERBOARD_WINDOW_MODE;
let activeLeaderboardSeasonYear = '';
let activeLeaderboardRangeStartYear = '';
let activeLeaderboardRangeEndYear = '';
let activeLeaderboardResetMode = DEFAULT_LEADERBOARD_RESET_MODE;
let activeLeaderboardEloThresholds = {
  minEvents: 0,
  minMatches: 0,
  minElo: 0,
  minTopConversion: 0
};
let currentLeaderboardBaseRows = [];
let currentLeaderboardRows = [];
let currentLeaderboardDataset = {
  mode: 'elo',
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
  historyByPlayer: new Map(),
  eventResultLookup: new Map(),
  deckDataset: {
    seasonRows: [],
    historyByPlayer: new Map(),
    processedMatches: []
  }
};
let leaderboardTableSort = {
  key: 'rating',
  direction: 'desc'
};
let activeLeaderboardDrilldownCategory = '';
let activeSearchTerm = '';
let selectedDeck = LEADERBOARD_PLAYER_TOTAL_SCOPE;
let activeLeaderboardPlayerDrilldown = null;
let activeLeaderboardPlayerDeckScope = LEADERBOARD_PLAYER_TOTAL_SCOPE;
let leaderboardDatasetRequestId = 0;
let shouldRestoreLeaderboardFullscreen = false;
let leaderboardPlayerEloChart = null;
let leaderboardTimelineChart = null;
let activeLeaderboardTimelineSelections = new Set();
let activeLeaderboardTimelineSearchTerm = '';

function getLeaderboardsSection() {
  return document.getElementById('leaderboardsSection');
}

function getLeaderboardEloThresholdControlsAnchor() {
  return document.getElementById('leaderboardEloThresholdControlsAnchor');
}

function getLeaderboardDrilldownElements() {
  return {
    overlay: document.getElementById('leaderboardStatDrilldownOverlay'),
    modal: document.getElementById('leaderboardStatDrilldownModal'),
    title: document.getElementById('leaderboardStatDrilldownTitle'),
    subtitle: document.getElementById('leaderboardStatDrilldownSubtitle'),
    content: document.getElementById('leaderboardStatDrilldownContent'),
    closeButton: document.getElementById('leaderboardStatDrilldownClose'),
    fullscreenButton: document.getElementById('leaderboardStatDrilldownFullscreen'),
    reportDownloadButton: document.getElementById('leaderboardPlayerSeasonReportDownload'),
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

function getLeaderboardTableToolbar() {
  return document.getElementById('leaderboardTableToolbar');
}

function getLeaderboardTitleBadgeRow() {
  return document.getElementById('leaderboardTitleBadgeRow');
}

function getLeaderboardFullscreenBadgeStrip() {
  return document.getElementById('leaderboardFullscreenBadgeStrip');
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

function getLeaderboardTimelineShowAllLinesButton() {
  return document.getElementById('leaderboardTimelineShowAllLinesButton');
}

function getLeaderboardTimelineHideAllLinesButton() {
  return document.getElementById('leaderboardTimelineHideAllLinesButton');
}

function getLeaderboardPlayerChartShowAllLinesButton() {
  return document.getElementById('leaderboardPlayerChartShowAllLinesButton');
}

function getLeaderboardPlayerChartHideAllLinesButton() {
  return document.getElementById('leaderboardPlayerChartHideAllLinesButton');
}

function getLeaderboardEventTypeButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('.event-type-filter') || []);
}

function getLeaderboardModeButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('[data-leaderboard-mode]') || []);
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

function getLeaderboardPerformanceControlsSection() {
  return document.getElementById('leaderboardPerformanceControlsSection');
}

function getLeaderboardPerformanceMinEventButtons() {
  return Array.from(getLeaderboardsSection()?.querySelectorAll('[data-leaderboard-performance-min-events]') || []);
}

function getLeaderboardEloThresholdControlsSection() {
  return document.getElementById('leaderboardEloThresholdControlsSection');
}

function getLeaderboardEloThresholdResetButton() {
  return document.getElementById('leaderboardEloThresholdResetButton');
}

function getLeaderboardEloThresholdControls() {
  // The threshold UI has input, range, label, and quick buttons per metric; this
  // lookup keeps sync/setup functions generic across every metric.
  return Object.entries(LEADERBOARD_ELO_THRESHOLD_CONFIG).reduce((controls, [key, config]) => {
    controls[key] = {
      input: document.getElementById(config.inputId),
      slider: document.getElementById(config.sliderId),
      rangeLabel: document.getElementById(config.rangeId),
      quickButtons: Array.from(getLeaderboardsSection()?.querySelectorAll(`[data-leaderboard-threshold-quick="${key}"]`) || [])
    };
    return controls;
  }, {});
}

function getLeaderboardTableClickHint() {
  return document.getElementById('leaderboardTableClickHint');
}

function isPerformanceLeaderboardMode() {
  return false;
}

function setLeaderboardMode() {
  leaderboardTableSort = getDefaultLeaderboardSortState('elo');
}

function setLeaderboardPerformanceMinEvents() {
}

function sanitizeLeaderboardThresholdValue(key = '', value = 0) {
  const numericValue = Number.parseFloat(value);
  const normalizedValue = Number.isFinite(numericValue) ? numericValue : 0;
  const step = Number(LEADERBOARD_ELO_THRESHOLD_CONFIG[key]?.step) || 1;
  const clampedValue = key === 'minTopConversion'
    ? Math.max(0, Math.min(100, normalizedValue))
    : Math.max(0, normalizedValue);
  const roundedValue = Math.round(clampedValue / step) * step;
  return Number(roundedValue.toFixed(step < 1 ? 1 : 0));
}

function roundLeaderboardThresholdMetricValue(key = '', value = 0, strategy = 'round') {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  const step = Number(LEADERBOARD_ELO_THRESHOLD_CONFIG[key]?.step) || 1;
  const precision = step < 1 ? 1 : 0;
  let roundedValue;

  if (strategy === 'min') {
    roundedValue = Math.floor(numericValue / step) * step;
  } else if (strategy === 'max') {
    roundedValue = Math.ceil(numericValue / step) * step;
  } else {
    roundedValue = Math.round(numericValue / step) * step;
  }

  return Number(roundedValue.toFixed(precision));
}

function formatLeaderboardThresholdMetricValue(key = '', value = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '--';
  }

  if (key === 'minTopConversion') {
    return `${roundLeaderboardThresholdMetricValue(key, numericValue).toFixed(1)}%`;
  }

  const roundedValue = roundLeaderboardThresholdMetricValue(key, numericValue);
  return Number.isInteger(roundedValue) ? String(roundedValue) : roundedValue.toFixed(1);
}

function getLeaderboardEloThresholdRanges(rows = currentLeaderboardBaseRows) {
  const resolvedRows = Array.isArray(rows) ? rows : [];

  return Object.entries(LEADERBOARD_ELO_THRESHOLD_CONFIG).reduce((ranges, [key, config]) => {
    // Ranges are derived from the unfiltered base rows so sliders expose the full
    // available span before the active threshold cuts rows down.
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;
    let hasRows = false;

    resolvedRows.forEach(row => {
      const nextValue = Number(config.getRowValue(row));
      if (!Number.isFinite(nextValue)) {
        return;
      }

      hasRows = true;
      minValue = Math.min(minValue, nextValue);
      maxValue = Math.max(maxValue, nextValue);
    });

    const availableMin = hasRows ? roundLeaderboardThresholdMetricValue(key, minValue, 'min') : 0;
    const availableMax = hasRows ? roundLeaderboardThresholdMetricValue(key, maxValue, 'max') : 0;
    const activeValue = sanitizeLeaderboardThresholdValue(key, activeLeaderboardEloThresholds[key] ?? 0);

    ranges[key] = {
      hasRows,
      availableMin,
      availableMax,
      sliderMax: Math.max(activeValue, availableMax, 0),
      step: config.step
    };
    return ranges;
  }, {});
}

function getLeaderboardEloThresholdQuickViewValue(key = '', topPercent = 0, rows = currentLeaderboardBaseRows) {
  if (!Object.prototype.hasOwnProperty.call(LEADERBOARD_ELO_THRESHOLD_CONFIG, key)) {
    return 0;
  }

  const normalizedPercent = Number(topPercent);
  if (!Number.isFinite(normalizedPercent) || normalizedPercent <= 0) {
    return 0;
  }

  const resolvedPercent = LEADERBOARD_ELO_THRESHOLD_QUICK_VIEW_OPTIONS.includes(normalizedPercent)
    ? normalizedPercent
    : Math.min(Math.max(normalizedPercent, 0), 100);
  const rangeInfo = getLeaderboardEloThresholdRanges(rows)[key];

  if (!rangeInfo?.hasRows) {
    return 0;
  }

  const span = Number(rangeInfo.availableMax) - Number(rangeInfo.availableMin);
  // "Top N%" quick buttons translate into a minimum threshold value at the
  // corresponding percentile of the current row span.
  const thresholdValue = Number(rangeInfo.availableMax) - (span * resolvedPercent / 100);
  return sanitizeLeaderboardThresholdValue(key, thresholdValue);
}

function areLeaderboardThresholdValuesEqual(key = '', leftValue = 0, rightValue = 0) {
  const step = Number(LEADERBOARD_ELO_THRESHOLD_CONFIG[key]?.step) || 1;
  return Math.abs(Number(leftValue) - Number(rightValue)) < (step / 2);
}

function buildLeaderboardEloThresholdRangeLabel(key = '', rangeInfo = null) {
  if (!rangeInfo?.hasRows) {
    return 'Current range: no Elo rows';
  }

  return `Current range: ${formatLeaderboardThresholdMetricValue(key, rangeInfo.availableMin)}-${formatLeaderboardThresholdMetricValue(key, rangeInfo.availableMax)}`;
}

function syncLeaderboardEloThresholdInputs() {
  const controls = getLeaderboardEloThresholdControls();
  const ranges = getLeaderboardEloThresholdRanges();

  Object.entries(controls).forEach(([key, control]) => {
    const config = LEADERBOARD_ELO_THRESHOLD_CONFIG[key];
    const rangeInfo = ranges[key];
    const activeValue = sanitizeLeaderboardThresholdValue(key, activeLeaderboardEloThresholds[key] ?? 0);
    const normalizedValue = roundLeaderboardThresholdMetricValue(key, activeValue);
    const sliderMax = Math.max(Number(rangeInfo?.sliderMax || 0), 0);

    if (control.input) {
      control.input.value = String(normalizedValue);
      control.input.min = '0';
      control.input.step = String(config?.step || 1);
      if (key === 'minTopConversion') {
        control.input.max = '100';
      } else {
        control.input.removeAttribute('max');
      }
    }

    if (control.slider) {
      control.slider.min = '0';
      control.slider.max = String(sliderMax);
      control.slider.step = String(config?.step || 1);
      control.slider.value = String(Math.min(normalizedValue, sliderMax));
      control.slider.disabled = !rangeInfo?.hasRows && normalizedValue === 0;
    }

    if (!control.rangeLabel) {
      if (Array.isArray(control.quickButtons)) {
        control.quickButtons.forEach(button => {
          const topPercent = Number(button.dataset.leaderboardThresholdTopPercent || 0);
          const quickValue = getLeaderboardEloThresholdQuickViewValue(key, topPercent);
          const isActive = rangeInfo?.hasRows && areLeaderboardThresholdValuesEqual(key, quickValue, normalizedValue);

          button.disabled = !rangeInfo?.hasRows;
          button.classList.toggle('active', isActive);
          button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
      }
      return;
    }

    control.rangeLabel.textContent = buildLeaderboardEloThresholdRangeLabel(key, rangeInfo);
    if (!Array.isArray(control.quickButtons)) {
      return;
    }

    control.quickButtons.forEach(button => {
      const topPercent = Number(button.dataset.leaderboardThresholdTopPercent || 0);
      const quickValue = getLeaderboardEloThresholdQuickViewValue(key, topPercent);
      const isActive = rangeInfo?.hasRows && areLeaderboardThresholdValuesEqual(key, quickValue, normalizedValue);

      button.disabled = !rangeInfo?.hasRows;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  });
}

function setLeaderboardEloThreshold(key = '', value = 0) {
  if (!Object.prototype.hasOwnProperty.call(activeLeaderboardEloThresholds, key)) {
    return;
  }

  activeLeaderboardEloThresholds = {
    ...activeLeaderboardEloThresholds,
    [key]: sanitizeLeaderboardThresholdValue(key, value)
  };
  syncLeaderboardEloThresholdInputs();
}

function getActiveLeaderboardEloThresholds() {
  return { ...activeLeaderboardEloThresholds };
}

function hasActiveLeaderboardEloThresholds() {
  return Object.values(activeLeaderboardEloThresholds).some(value => Number(value) > 0);
}

function resetLeaderboardEloThresholds() {
  activeLeaderboardEloThresholds = Object.keys(activeLeaderboardEloThresholds).reduce((thresholds, key) => {
    thresholds[key] = 0;
    return thresholds;
  }, {});
  syncLeaderboardEloThresholdInputs();
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
  if (dataset?.mode === 'performance') {
    return [];
  }

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

  const rowKey = String(row?.playerKey || '').trim();
  const historyMap = currentLeaderboardDataset.deckDataset?.historyByPlayer?.has(rowKey)
    ? currentLeaderboardDataset.deckDataset.historyByPlayer
    : currentLeaderboardDataset.historyByPlayer;
  const historyEntries = Array.isArray(historyMap?.get(rowKey)) ? historyMap.get(rowKey) : [];

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
  if (dataset?.mode === 'performance') {
    return dataset?.period?.windowMode === 'seasonal' ? 'Season' : 'Window';
  }

  return dataset.resetByYear ? 'Season' : 'Window';
}

function getLeaderboardWindowModeLabel(period = currentLeaderboardDataset.period) {
  return period?.windowMode === 'range' ? 'Multi-Year' : 'Seasonal';
}

function getLeaderboardContinuityLabel(dataset = currentLeaderboardDataset) {
  if (dataset?.mode === 'performance') {
    return 'Aggregated Range';
  }

  if (dataset?.period?.windowMode === 'seasonal') {
    return 'Seasonal Reset';
  }

  return dataset.resetByYear ? 'Reset each year' : 'Carry across range';
}

function getLeaderboardViewTitle(dataset = currentLeaderboardDataset) {
  if (dataset?.mode === 'performance') {
    return dataset?.period?.windowMode === 'seasonal'
      ? 'Seasonal Performance Leaderboard'
      : 'Multi-Year Performance Leaderboard';
  }

  if (dataset?.period?.windowMode === 'seasonal') {
    return 'Seasonal Elo Leaderboard';
  }

  return dataset.resetByYear ? 'Multi-Year Elo Leaderboard' : 'Continuous Elo Leaderboard';
}

function getLeaderboardRowCollectionLabel(count = 0, dataset = currentLeaderboardDataset) {
  const safeCount = Number(count) || 0;
  if (dataset?.mode === 'performance') {
    return `${safeCount} qualified player${safeCount === 1 ? '' : 's'}`;
  }

  if (!dataset.resetByYear) {
    return `${safeCount} continuous ladder entr${safeCount === 1 ? 'y' : 'ies'}`;
  }

  if (dataset?.period?.windowMode === 'range') {
    return `${safeCount} season entr${safeCount === 1 ? 'y' : 'ies'}`;
  }

  return `${safeCount} leaderboard row${safeCount === 1 ? '' : 's'}`;
}

function buildLeaderboardTableHelperText(dataset = currentLeaderboardDataset) {
  if (dataset?.mode === 'performance') {
    if ((dataset?.summary?.seasonEntries || 0) === 0) {
      return buildEmptyStateMessage(dataset?.eventTypes);
    }

    const yearsLabel = getLeaderboardSelectedYearsLabel(dataset) || 'the selected years';
    const minEvents = Number(dataset?.summary?.minEvents) || DEFAULT_LEADERBOARD_PERFORMANCE_MIN_EVENTS;
    return `Rows are ranked by Top 8 conversion across ${yearsLabel}. Players need at least ${minEvents} event${minEvents === 1 ? '' : 's'} in the selected window to qualify.`;
  }

  if ((dataset?.summary?.ratedMatches || 0) === 0) {
    return buildEmptyStateMessage(dataset?.eventTypes);
  }

  const yearsLabel = getLeaderboardSelectedYearsLabel(dataset) || 'the selected years';
  if (dataset?.period?.windowMode === 'seasonal') {
    return `Rows are ranked by Elo for the ${yearsLabel} season only. Ratings start at ${DEFAULT_RANKINGS_OPTIONS.startingRating} on January 1. Top 8 conversion and first-place finishes are shown from the same window.`;
  }

  if (dataset.resetByYear) {
    return `Rows are ranked across ${yearsLabel} with a January 1 reset each year, so players can appear once per season. Top 8 conversion and first-place finishes are scoped to each row's season.`;
  }

  return `Rows are ranked across ${yearsLabel} as one continuous ladder, so each player appears once for the selected range. Top 8 conversion and first-place finishes cover the same selected window.`;
}

function buildLeaderboardRatingBadgeHtml(label, value) {
  return `<span class="leaderboard-info-badge">${escapeHtml(`${label}: ${value}`)}</span>`;
}

function getLeaderboardResolvedKFactor(dataset = currentLeaderboardDataset, activeWindow = dataset?.period || null) {
  const datasetKFactor = Number(dataset?.kFactor);
  if (Number.isFinite(datasetKFactor)) {
    return datasetKFactor;
  }

  return getRankingsKFactor({ resetByYear: activeWindow?.resetByYear });
}

function buildLeaderboardRatingBadgeRowHtml(dataset = currentLeaderboardDataset) {
  return `
    <div class="leaderboard-info-badge-row">
      ${buildLeaderboardRatingBadgeHtml('Starting Rating', DEFAULT_RANKINGS_OPTIONS.startingRating)}
      ${buildLeaderboardRatingBadgeHtml('K-Factor', getLeaderboardResolvedKFactor(dataset))}
    </div>
  `;
}

function renderLeaderboardTitleBadgeRow(dataset = currentLeaderboardDataset) {
  const badgeRow = getLeaderboardTitleBadgeRow();
  const container = getLeaderboardTableContainer();
  if (!badgeRow || !container) {
    return;
  }

  const isFullscreen = document.fullscreenElement === container;
  if (dataset?.mode === 'performance' || isFullscreen) {
    badgeRow.innerHTML = '';
    badgeRow.hidden = true;
    return;
  }

  badgeRow.innerHTML = `
    <div class="leaderboard-info-badge-row">
      ${buildLeaderboardRatingBadgeHtml('Starting Rating', DEFAULT_RANKINGS_OPTIONS.startingRating)}
      ${buildLeaderboardRatingBadgeHtml('K-Factor', getLeaderboardResolvedKFactor(dataset))}
    </div>
  `;
  badgeRow.hidden = false;
}

function buildLeaderboardEloModeSentence(dataset = currentLeaderboardDataset) {
  const yearsLabel = getLeaderboardSelectedYearsLabel(dataset) || 'the selected years';

  if (dataset?.period?.windowMode === 'seasonal') {
    return `Ranked for the ${yearsLabel} season with a January 1 reset (one entry per player).`;
  }

  if (dataset?.resetByYear) {
    return `Ranked across ${yearsLabel} with a January 1 reset each season (players may appear once per year).`;
  }

  return `Ranked across ${yearsLabel} as a single continuous ladder (one entry per player).`;
}

function buildLeaderboardEloBehaviorNotes(dataset = currentLeaderboardDataset) {
  const notes = [];

  if (dataset?.period?.windowMode === 'seasonal') {
    notes.push('Top 8 conversions and wins use the same season.');
  } else if (dataset?.resetByYear) {
    notes.push('Top 8 conversions and wins are scoped per season.');
  } else {
    notes.push('Top 8 conversions and wins use the same window.');
  }

  if (hasActiveLeaderboardEloThresholds()) {
    notes.push('Current Elo minimum filters also apply to visible rows.');
  }

  return notes;
}

function buildLeaderboardTableHelperHtml(dataset = currentLeaderboardDataset) {
  if (dataset?.mode === 'performance') {
    return escapeHtml(buildLeaderboardTableHelperText(dataset));
  }

  if ((dataset?.summary?.ratedMatches || 0) === 0) {
    return escapeHtml(buildEmptyStateMessage(dataset?.eventTypes));
  }

  return `
    <div class="leaderboard-info-stack">
      <div class="leaderboard-info-title">Chronological Elo ladder</div>
      <div class="leaderboard-info-copy">Players are ranked by Elo from rated matches in chronological order.</div>
      <div class="leaderboard-info-copy">${escapeHtml(buildLeaderboardEloModeSentence(dataset))}</div>
    </div>
  `;
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

function buildLeaderboardEloThresholdSummary() {
  const thresholds = getActiveLeaderboardEloThresholds();
  const parts = [];

  if (thresholds.minEvents > 0) {
    parts.push(`${thresholds.minEvents}+ events`);
  }
  if (thresholds.minMatches > 0) {
    parts.push(`${thresholds.minMatches}+ matches`);
  }
  if (thresholds.minElo > 0) {
    parts.push(`${thresholds.minElo}+ Elo`);
  }
  if (thresholds.minTopConversion > 0) {
    parts.push(`${thresholds.minTopConversion}%+ Top 8 conversion`);
  }

  if (parts.length === 0) {
    return 'Drag a slider or type a minimum. Range labels reflect the full Elo window. Use 0 to disable a threshold.';
  }

  return `Active Elo minimums: ${parts.join(' | ')}. Drag or type to adjust them.`;
}

function renderLeaderboardEloThresholdControls() {
  const section = getLeaderboardEloThresholdControlsSection();
  const resetButton = getLeaderboardEloThresholdResetButton();
  section?.classList.remove('hidden');
  syncLeaderboardFullscreenLayout();
  syncLeaderboardEloThresholdInputs();
  if (resetButton) {
    resetButton.disabled = !hasActiveLeaderboardEloThresholds();
  }
  updateElementText('leaderboardEloThresholdSummary', buildLeaderboardEloThresholdSummary());
}

function buildLeaderboardModeSummary() {
  return isPerformanceLeaderboardMode()
    ? 'Performance ranks players by Top 8 conversion from event finishes. Elo stays available in the other mode.'
    : 'Elo uses the matchup archive to build rating ladders. Performance ranks players from event finishes instead.';
}

function buildLeaderboardEventTypeSummary() {
  return isPerformanceLeaderboardMode()
    ? 'Performance uses event-result rows, so it can rank either online or offline events when those finishes exist in the dataset.'
    : 'Elo leaderboards use matchup records. Right now the matchup archive is online-only.';
}

function buildLeaderboardWindowModeSummary(activeWindow = null) {
  if (isPerformanceLeaderboardMode()) {
    if (!activeWindow) {
      return 'Choose Seasonal or Multi-Year to rank players by Top 8 conversion.';
    }

    if (activeWindow.windowMode === 'seasonal') {
      return `Seasonal view isolates the ${activeWindow.year || 'selected'} calendar year and ranks players by Top 8 conversion inside that season.`;
    }

    return 'Multi-Year view combines the selected years into one performance table ranked by Top 8 conversion.';
  }

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
    return isPerformanceLeaderboardMode()
      ? 'Pick the first and last year included in the Performance window.'
      : 'Pick the first and last year included in the Elo window.';
  }

  const yearsLabel = getLeaderboardYearRangeLabel(activeWindow.years) || 'Selected range';
  const seasonCount = activeWindow.years?.length || 0;
  return `${yearsLabel} selected across ${seasonCount} calendar year${seasonCount === 1 ? '' : 's'}.`;
}

function buildLeaderboardResetModeSummary(activeWindow = null) {
  if (isPerformanceLeaderboardMode()) {
    return 'Performance mode always aggregates the selected window directly, so rating continuity does not apply here.';
  }

  if (!activeWindow || activeWindow.windowMode !== 'range') {
    return `Seasonal view always resets to ${DEFAULT_RANKINGS_OPTIONS.startingRating} on January 1. Switch to Multi-Year to choose between yearly resets and a continuous ladder.`;
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
  if (isPerformanceLeaderboardMode()) {
    const minEvents = activeLeaderboardPerformanceMinEvents;
    if (!activeWindow) {
      return `Performance mode ranks players by Top 8 conversion. Minimum sample is currently ${minEvents} event${minEvents === 1 ? '' : 's'}.`;
    }

    return `Performance mode ranks players by Top 8 conversion inside the selected window. Players need at least ${minEvents} event${minEvents === 1 ? '' : 's'} to qualify.`;
  }

  const kFactor = getLeaderboardResolvedKFactor(currentLeaderboardDataset, activeWindow);

  if (!activeWindow) {
    return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${kFactor}. (same as the Vintage Leaderboards)`;
  }

  if (activeWindow.windowMode === 'seasonal') {
    return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${kFactor}. (same as the Vintage Leaderboards) Seasonal Elo resets on January 1.`;
  }

  if (activeWindow.resetMode === 'continuous') {
    return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${kFactor}. (same as the Vintage Leaderboards) Ratings carry across the selected multi-year range with no January reset inside that window.`;
  }

  return `Starting rating ${DEFAULT_RANKINGS_OPTIONS.startingRating}, K-factor ${kFactor}. (same as the Vintage Leaderboards) Multi-Year Elo resets on January 1, so seasons stay separate.`;
}

function buildLeaderboardSystemSummaryHtml(activeWindow = null, dataset = currentLeaderboardDataset) {
  if (dataset?.mode === 'performance') {
    return escapeHtml(buildLeaderboardSystemSummary(activeWindow));
  }

  return `
    <div class="leaderboard-info-stack leaderboard-info-stack-compact">
      ${buildLeaderboardEloBehaviorNotes(dataset).map(note => `<div class="leaderboard-info-copy">${escapeHtml(note)}</div>`).join('')}
    </div>
  `;
}

function buildLeaderboardTableClickHintHtml(dataset = currentLeaderboardDataset) {
  if (dataset?.mode === 'performance') {
    return '<strong>Click a player row to open details.</strong>';
  }

  return `
    <div class="leaderboard-info-stack leaderboard-info-stack-compact">
      <div class="leaderboard-info-copy"><strong>Click a player row to open details.</strong></div>
      <div class="leaderboard-info-copy">${escapeHtml(LEADERBOARD_ELO_UNKNOWN_DECK_NOTE)}</div>
    </div>
  `;
}

function buildLeaderboardPerformanceSummary(activeWindow = null) {
  const minEvents = activeLeaderboardPerformanceMinEvents;
  if (!activeWindow) {
    return `Players need at least ${minEvents} event${minEvents === 1 ? '' : 's'} before their Top 8 conversion appears in the ranking.`;
  }

  const scopeLabel = activeWindow.windowMode === 'seasonal'
    ? `${activeWindow.year || 'selected'} season`
    : `${getLeaderboardYearRangeLabel(activeWindow.years) || 'selected range'} window`;
  return `Top 8 conversion = Top 8 finishes divided by total events in the ${scopeLabel}. Minimum sample: ${minEvents} event${minEvents === 1 ? '' : 's'}.`;
}

function formatLeaderboardFilterBadgeLabel(value = '') {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return '';
  }

  return normalizedValue
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function getLeaderboardFullscreenFilterBadges(activeWindow = currentLeaderboardDataset?.period || ensureActiveLeaderboardWindow().activeWindow) {
  const badges = [];
  const selectedEventTypes = getSelectedLeaderboardEventTypes();

  if (selectedEventTypes.length > 0) {
    badges.push(...selectedEventTypes.map(formatLeaderboardFilterBadgeLabel).filter(Boolean));
  }

  if (activeWindow?.windowMode === 'seasonal') {
    badges.push('Seasonal');
    if (activeWindow.year) {
      badges.push(`${activeWindow.year} Season`);
    }
  } else if (activeWindow?.windowMode === 'range') {
    badges.push('Multi-Year');

    if (activeWindow.startYear || activeWindow.endYear) {
      badges.push(`${activeWindow.startYear || '--'}-${activeWindow.endYear || '--'}`);
    }

    badges.push(activeWindow.resetMode === 'continuous' ? 'Carry Across Range' : 'Reset Each Year');
  }

  if (!isPerformanceLeaderboardMode()) {
    badges.push(
      `Starting Rating: ${DEFAULT_RANKINGS_OPTIONS.startingRating}`,
      `K-Factor: ${getLeaderboardResolvedKFactor(currentLeaderboardDataset, activeWindow)}`
    );
  }

  return badges.filter(Boolean);
}

function getLeaderboardFullscreenBadgeTooltip(label = '') {
  if (label === 'Carry Across Range') {
    return 'Maintains a single continuous Elo rating for each player across the selected years, carrying results forward from the first year to the last.';
  }

  if (label === 'Reset Each Year') {
    return 'Resets Elo at the start of each year, allowing direct comparison of players\' peak seasonal performance across different years.';
  }

  return '';
}

function renderLeaderboardFullscreenFilterBadges(activeWindow = currentLeaderboardDataset?.period || ensureActiveLeaderboardWindow().activeWindow) {
  const badgeStrip = getLeaderboardFullscreenBadgeStrip();
  const container = getLeaderboardTableContainer();
  if (!badgeStrip || !container) {
    return;
  }

  const isFullscreen = document.fullscreenElement === container;
  const badges = isFullscreen ? getLeaderboardFullscreenFilterBadges(activeWindow) : [];
  renderLeaderboardTitleBadgeRow(currentLeaderboardDataset);

  badgeStrip.hidden = badges.length === 0;
  updateElementHTML(
    'leaderboardFullscreenBadgeStrip',
    badges.map(label => {
      const tooltip = getLeaderboardFullscreenBadgeTooltip(label);
      const tooltipAttributes = tooltip
        ? ` data-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(`${label}. ${tooltip}`)}"`
        : '';
      const tooltipClassName = tooltip ? ' analysis-filter-tooltip' : '';
      return `<span class="leaderboard-fullscreen-filter-badge${tooltipClassName}"${tooltipAttributes}>${escapeHtml(label)}</span>`;
    }).join('')
  );
}

function syncLeaderboardModeDisplayHints(activeWindow = null) {
  const searchInput = getLeaderboardSearchInput();
  const clickHint = getLeaderboardTableClickHint();
  const timelineHelper = getLeaderboardTimelineHelper();

  if (searchInput) {
    const placeholderText = 'Find a player in the Elo table';
    searchInput.placeholder = placeholderText;
    searchInput.setAttribute('aria-label', placeholderText);
  }

  if (clickHint) {
    clickHint.hidden = false;
  }

  if (timelineHelper) {
    timelineHelper.textContent = 'Tracking the selected players across the current Elo window. Top 8 are shown by default.';
  }

  updateElementText('leaderboardModeSummary', buildLeaderboardModeSummary());
  updateElementText('leaderboardEventTypeSummary', buildLeaderboardEventTypeSummary());
  updateElementText('leaderboardEloThresholdSummary', buildLeaderboardEloThresholdSummary());
}

function renderLeaderboardWindowControls() {
  // Rebuilds season/range/reset controls and returns the resolved active window.
  const { availableYears, activeWindow } = ensureActiveLeaderboardWindow();

  renderLeaderboardEloThresholdControls();
  renderLeaderboardWindowModeButtons(availableYears);
  renderLeaderboardSeasonYearButtons(availableYears);
  renderLeaderboardRangeControls(availableYears, activeWindow);
  renderLeaderboardResetModeButtons(activeWindow);

  syncLeaderboardModeDisplayHints(activeWindow);
  updateElementText('leaderboardWindowModeSummary', buildLeaderboardWindowModeSummary(activeWindow));
  updateElementText('leaderboardRangeSummary', buildLeaderboardRangeSummary(activeWindow));
  updateElementText('leaderboardResetModeSummary', buildLeaderboardResetModeSummary(activeWindow));
  updateElementHTML('leaderboardSystemSummary', buildLeaderboardSystemSummaryHtml(activeWindow));
  renderLeaderboardFullscreenFilterBadges(activeWindow);

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

function pluralizeLeaderboardEventLabel(label = '', count = 0) {
  const safeLabel = String(label || '').trim() || 'Event';
  if (count === 1) {
    return safeLabel;
  }
  if (/[^aeiou]y$/i.test(safeLabel)) {
    return `${safeLabel.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/i.test(safeLabel)) {
    return `${safeLabel}es`;
  }
  return `${safeLabel}s`;
}

function resolveLeaderboardEventTypeMeta(eventName = '') {
  const rawName = String(eventName || '').trim();
  const normalizedName = rawName.toLowerCase();

  if (normalizedName.includes('challenge')) {
    return { key: 'challenge', label: 'Challenge', order: 0 };
  }
  if (normalizedName.includes('qualifier')) {
    return { key: 'qualifier', label: 'Qualifier', order: 1 };
  }
  if (normalizedName.includes('showcase')) {
    return { key: 'showcase', label: 'Showcase', order: 2 };
  }
  if (normalizedName.includes('super')) {
    return { key: 'super', label: 'Super', order: 3 };
  }

  const groupInfo = getEventGroupInfo(rawName);
  return {
    key: String(groupInfo?.key || rawName || 'event').trim(),
    label: String(groupInfo?.label || rawName || 'Event').trim() || 'Event',
    order: Number.isFinite(Number(groupInfo?.order)) ? Number(groupInfo.order) : 100
  };
}

function buildLeaderboardEventSummary(dataset = currentLeaderboardDataset) {
  const uniqueEvents = new Map();

  if (dataset?.mode === 'performance') {
    const eventRows = Array.isArray(getAnalysisRows()) ? getAnalysisRows() : [];
    const selectedEventTypes = new Set(
      (Array.isArray(dataset?.eventTypes) ? dataset.eventTypes : [])
        .map(type => String(type || '').trim().toLowerCase())
        .filter(Boolean)
    );

    eventRows.forEach(row => {
      const rowDate = String(row?.Date || '').trim();
      const eventName = String(row?.Event || '').trim();
      const eventType = String(row?.EventType || '').trim().toLowerCase();
      if (!rowDate || !eventName) {
        return;
      }
      if (dataset?.startDate && rowDate < dataset.startDate) {
        return;
      }
      if (dataset?.endDate && rowDate > dataset.endDate) {
        return;
      }
      if (selectedEventTypes.size > 0 && !selectedEventTypes.has(eventType)) {
        return;
      }

      uniqueEvents.set(`${rowDate}:::${eventName}`, resolveLeaderboardEventTypeMeta(eventName));
    });
  } else {
    const processedMatches = Array.isArray(dataset?.processedMatches) ? dataset.processedMatches : [];
    processedMatches.forEach(match => {
      const matchDate = String(match?.date || match?.Date || '').trim();
      const eventKey = String(match?.event_id || match?.eventId || match?.event || '').trim();
      const eventName = String(match?.event || match?.Event || eventKey).trim();
      if (!matchDate || !eventName) {
        return;
      }

      uniqueEvents.set(`${matchDate}:::${eventKey || eventName}`, resolveLeaderboardEventTypeMeta(eventName));
    });
  }

  const groupedCounts = new Map();
  uniqueEvents.forEach(eventTypeMeta => {
    const groupKey = String(eventTypeMeta?.key || eventTypeMeta?.label || 'event').trim();
    if (!groupedCounts.has(groupKey)) {
      groupedCounts.set(groupKey, {
        count: 0,
        label: eventTypeMeta?.label || 'Event',
        order: Number.isFinite(Number(eventTypeMeta?.order)) ? Number(eventTypeMeta.order) : 100
      });
    }

    groupedCounts.get(groupKey).count += 1;
  });

  const breakdown = [...groupedCounts.values()]
    .sort((left, right) => {
      return (
        Number(left.order) - Number(right.order) ||
        Number(right.count) - Number(left.count) ||
        String(left.label).localeCompare(String(right.label), undefined, { sensitivity: 'base' })
      );
    })
    .map(item => `${item.count} ${pluralizeLeaderboardEventLabel(item.label, item.count)}`)
    .join(', ');

  return {
    total: uniqueEvents.size,
    breakdown: breakdown || 'No events in selected window'
  };
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
  // Creates a helpful table empty-state message based on which filters removed
  // all rows.
  if (isPerformanceLeaderboardMode()) {
    if (selectedEventTypes.length === 1 && selectedEventTypes[0] === 'offline') {
      return 'No offline event finishes are available for the selected Performance window.';
    }

    return 'No player finishes are available for the selected Performance filters.';
  }

  if (selectedEventTypes.length === 1 && selectedEventTypes[0] === 'offline') {
    return 'No offline matchup records are available yet, so Elo leaderboards can only be computed for online events right now.';
  }

  return 'No rated matchup records are available for the selected filters.';
}

function applyLeaderboardRowFilters(rows = [], dataset = currentLeaderboardDataset) {
  const resolvedRows = Array.isArray(rows) ? rows : [];
  if (dataset?.mode !== 'elo') {
    return resolvedRows;
  }

  const thresholds = getActiveLeaderboardEloThresholds();
  return resolvedRows.filter(row => {
    return Number(row?.eventCount || 0) >= thresholds.minEvents
      && Number(row?.matches || 0) >= thresholds.minMatches
      && Number(row?.rating || 0) >= thresholds.minElo
      && (Number(row?.top8Conversion || 0) * 100) >= thresholds.minTopConversion;
  });
}

function buildSummaryText(dataset) {
  // Builds the small helper text under the leaderboard table title.
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
    ? `Rating resets to ${DEFAULT_RANKINGS_OPTIONS.startingRating} when the calendar year changes.`
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

function getHistoryResultTone(resultType = '') {
  const normalizedResultType = String(resultType || '').trim().toLowerCase();
  if (normalizedResultType === 'win') {
    return 'above-average';
  }
  if (normalizedResultType === 'loss') {
    return 'below-average';
  }
  if (normalizedResultType === 'draw') {
    return 'mixed-average';
  }

  return '';
}

function buildHistoryContextLabel(entry = {}) {
  const roundLabel = Number.isFinite(Number(entry.round)) ? `Round ${Number(entry.round)}` : 'Unknown Round';
  const eventLabel = formatEventName(entry.event) || entry.event || 'Unknown Event';
  const dateLabel = entry.date ? formatShortDate(entry.date) : '--';
  return `${roundLabel} of ${dateLabel} ${eventLabel}`;
}

function withAlpha(color = '', alpha = '22') {
  return /^#[\da-f]{6}$/i.test(String(color || '').trim())
    ? `${String(color).trim()}${alpha}`
    : color;
}

function normalizeLeaderboardDeckScopeKey(value = '') {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || LEADERBOARD_PLAYER_TOTAL_SCOPE;
}

function getLeaderboardDeckDisplayName(deck = '') {
  const normalizedDeck = String(deck || '').trim();
  return normalizedDeck || 'Unknown Deck';
}

function resolveRowRatingForScope(row = {}, dataset = currentLeaderboardDataset, deckScope = LEADERBOARD_PLAYER_TOTAL_SCOPE) {
  const normalizedScope = normalizeLeaderboardDeckScopeKey(deckScope);
  const normalizedSeasonKey = String(row?.seasonKey || '').trim();
  const playerKey = String(row?.playerKey || '').trim();

  const historyEntries = normalizedScope === LEADERBOARD_PLAYER_TOTAL_SCOPE
    ? Array.isArray(dataset?.historyByPlayer?.get(playerKey)) ? dataset.historyByPlayer.get(playerKey) : []
    : Array.isArray(dataset?.deckDataset?.historyByPlayer?.get(normalizedScope)) ? dataset.deckDataset.historyByPlayer.get(normalizedScope) : [];

  const scopeHistory = (Array.isArray(historyEntries) ? historyEntries : [])
    .filter(entry => String(entry?.seasonKey || '').trim() === normalizedSeasonKey)
    .sort(compareHistoryEntriesDescending);

  const latestEntry = scopeHistory[0];
  if (latestEntry && Number.isFinite(Number(latestEntry.ratingAfter))) {
    return Number(latestEntry.ratingAfter);
  }

  return Number.isFinite(Number(row?.rating)) ? Number(row.rating) : 0;
}

function compareHistoryEntriesDescending(a, b) {
  return (
    String(b?.date || '').localeCompare(String(a?.date || '')) ||
    Number(b?.round || 0) - Number(a?.round || 0) ||
    String(b?.eventId || '').localeCompare(String(a?.eventId || ''))
  );
}

function compareHistoryEntriesAscending(a, b) {
  return (
    String(a?.date || '').localeCompare(String(b?.date || '')) ||
    String(a?.eventId || '').localeCompare(String(b?.eventId || '')) ||
    Number(a?.round || 0) - Number(b?.round || 0)
  );
}

function getPeakRatingFromHistoryEntries(historyEntries = [], fallbackRating = Number.NEGATIVE_INFINITY) {
  return (Array.isArray(historyEntries) ? historyEntries : []).reduce((maxRating, entry) => {
    const ratings = [Number(entry?.ratingBefore), Number(entry?.ratingAfter)].filter(Number.isFinite);
    const entryPeak = ratings.length > 0 ? Math.max(...ratings) : Number.NEGATIVE_INFINITY;
    return Math.max(maxRating, entryPeak);
  }, Number.isFinite(Number(fallbackRating)) ? Number(fallbackRating) : Number.NEGATIVE_INFINITY);
}

function getHistoryDeltaHighlights(historyEntries = []) {
  return (Array.isArray(historyEntries) ? historyEntries : []).reduce((accumulator, entry) => {
    const entryDelta = Number(entry?.delta);
    if (!Number.isFinite(entryDelta)) {
      return accumulator;
    }

    return {
      bestDelta: !accumulator.bestDelta || entryDelta > Number(accumulator.bestDelta.delta) ? entry : accumulator.bestDelta,
      worstDelta: !accumulator.worstDelta || entryDelta < Number(accumulator.worstDelta.delta) ? entry : accumulator.worstDelta
    };
  }, {
    bestDelta: null,
    worstDelta: null
  });
}

function getHistoryTotalDelta(historyEntries = []) {
  return (Array.isArray(historyEntries) ? historyEntries : []).reduce((total, entry) => {
    const delta = Number(entry?.delta);
    return Number.isFinite(delta) ? total + delta : total;
  }, 0);
}

function buildLeaderboardScopeData({
  key = LEADERBOARD_PLAYER_TOTAL_SCOPE,
  type = 'all',
  label = getDeckDisplayName(LEADERBOARD_PLAYER_TOTAL_SCOPE),
  row = null,
  historyEntries = [],
  totalRow = null
} = {}) {
  // A "scope" is either all decks for the player or one deck-specific Elo slice.
  // Reports, cards, and charts all consume this same normalized shape.
  const sortedHistoryEntries = [...(Array.isArray(historyEntries) ? historyEntries : [])].sort(compareHistoryEntriesDescending);
  const historyEntriesAscending = [...sortedHistoryEntries].sort(compareHistoryEntriesAscending);
  const points = buildEventLevelEloPoints(historyEntriesAscending);
  const { bestDelta, worstDelta } = getHistoryDeltaHighlights(sortedHistoryEntries);

  return {
    key: normalizeLeaderboardDeckScopeKey(key),
    type,
    label,
    row,
    historyEntries: sortedHistoryEntries,
    historyEntriesAscending,
    points,
    bestDelta,
    worstDelta,
    peakRating: getPeakRatingFromHistoryEntries(sortedHistoryEntries, row?.rating),
    totalDelta: getHistoryTotalDelta(sortedHistoryEntries),
    firstMatch: sortedHistoryEntries[sortedHistoryEntries.length - 1] || null,
    latestMatch: sortedHistoryEntries[0] || null,
    totalReferenceRating: Number(totalRow?.rating),
    totalReferenceMatches: Number(totalRow?.matches) || 0,
    uniqueDeckCount: new Set(
      sortedHistoryEntries.map(entry => getLeaderboardDeckDisplayName(entry?.deck)).filter(Boolean)
    ).size
  };
}

function getLeaderboardDeckHistoryForRow(row) {
  const historyEntries = currentLeaderboardDataset.deckDataset?.historyByPlayer?.get(row?.playerKey) || [];

  return [...historyEntries]
    .filter(entry => String(entry.seasonKey || '') === String(row?.seasonKey || ''))
    .sort(compareHistoryEntriesDescending);
}

function getLeaderboardDeckSummariesForPlayerRow(row) {
  const basePlayerKey = String(row?.basePlayerKey || row?.playerKey || '').trim();
  const seasonKey = String(row?.seasonKey || '').trim();
  const deckRows = (currentLeaderboardDataset.deckDataset?.seasonRows || [])
    .filter(deckRow => {
      return String(deckRow?.basePlayerKey || '').trim() === basePlayerKey
        && String(deckRow?.seasonKey || '').trim() === seasonKey;
    })
    .sort((a, b) => {
      return (
        Number(b.matches || 0) - Number(a.matches || 0) ||
        Number(b.rating || 0) - Number(a.rating || 0) ||
        getLeaderboardDeckDisplayName(a.deck).localeCompare(getLeaderboardDeckDisplayName(b.deck), undefined, { sensitivity: 'base' })
      );
    });

  return deckRows
    .map(deckRow => buildLeaderboardScopeData({
      key: deckRow.playerKey,
      type: 'deck',
      label: getLeaderboardDeckDisplayName(deckRow.deck),
      row: deckRow,
      historyEntries: getLeaderboardDeckHistoryForRow(deckRow),
      totalRow: row
    }))
    .filter(scope => scope.historyEntries.length > 0);
}

function resolveActiveLeaderboardPlayerDeckScope(deckSummaries = []) {
  const normalizedScope = normalizeLeaderboardDeckScopeKey(activeLeaderboardPlayerDeckScope);
  if (normalizedScope === LEADERBOARD_PLAYER_TOTAL_SCOPE) {
    return LEADERBOARD_PLAYER_TOTAL_SCOPE;
  }

  return deckSummaries.some(scope => scope.key === normalizedScope)
    ? normalizedScope
    : LEADERBOARD_PLAYER_TOTAL_SCOPE;
}

function getLeaderboardPlayerDrilldownModel(row) {
  // Player drilldowns always include an all-decks scope plus optional per-deck
  // scopes so users can compare total Elo against deck-specific Elo.
  const totalScope = buildLeaderboardScopeData({
    key: LEADERBOARD_PLAYER_TOTAL_SCOPE,
    type: 'all',
    label: getDeckDisplayName(LEADERBOARD_PLAYER_TOTAL_SCOPE),
    row,
    historyEntries: getPlayerHistoryForRow(row),
    totalRow: row
  });
  const deckSummaries = getLeaderboardDeckSummariesForPlayerRow(row);
  totalScope.uniqueDeckCount = deckSummaries.length || totalScope.uniqueDeckCount;
  const activeScopeKey = resolveActiveLeaderboardPlayerDeckScope(deckSummaries);
  const activeScope = activeScopeKey === LEADERBOARD_PLAYER_TOTAL_SCOPE
    ? totalScope
    : deckSummaries.find(scope => scope.key === activeScopeKey) || totalScope;

  return {
    row,
    totalScope,
    deckSummaries,
    activeScopeKey,
    activeScope
  };
}

function normalizeLeaderboardSearchText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getLeaderboardEventKey(record = {}) {
  return `${String(record?.Date || record?.date || '').trim()}|||${String(record?.Event || record?.event || '').trim()}`;
}

function getLeaderboardEventResultLookupKey(record = {}, playerIdentityKey = '') {
  const eventKey = getLeaderboardEventKey(record);
  const normalizedPlayerKey = String(playerIdentityKey || '').trim();
  return eventKey && normalizedPlayerKey ? `${eventKey}|||${normalizedPlayerKey}` : '';
}

function getLeaderboardEventResultWinRate(row = {}) {
  const explicitWinRate = Number(row?.['Win Rate'] ?? row?.winRate);
  if (Number.isFinite(explicitWinRate)) {
    return explicitWinRate <= 1 ? explicitWinRate * 100 : explicitWinRate;
  }

  const wins = Number(row?.Wins ?? row?.wins) || 0;
  const losses = Number(row?.Losses ?? row?.losses) || 0;
  const totalMatches = wins + losses;
  return totalMatches > 0 ? (wins / totalMatches) * 100 : Number.NaN;
}

function buildLeaderboardEventResultLookup(dataset = currentLeaderboardDataset) {
  // Elo match records do not contain finish/rank details, so join back to the
  // event results dataset by event + normalized player identity.
  const eventRows = Array.isArray(getAnalysisRows()) ? getAnalysisRows() : [];
  const selectedEventTypes = new Set(
    (Array.isArray(dataset?.eventTypes) ? dataset.eventTypes : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const allowedEventKeys = new Set(
    (Array.isArray(dataset?.filteredMatches) ? dataset.filteredMatches : [])
      .map(match => getLeaderboardEventKey(match))
      .filter(Boolean)
  );

  return eventRows.reduce((lookup, row) => {
    const rowDate = String(row?.Date || '').trim();
    const rowEventType = String(row?.EventType || '').trim().toLowerCase();
    const rowEventKey = getLeaderboardEventKey(row);
    const playerIdentityKey = getPlayerIdentityKey(row?.Player);
    const lookupKey = getLeaderboardEventResultLookupKey(row, playerIdentityKey);

    if (!lookupKey || !rowDate) {
      return lookup;
    }

    if (dataset?.startDate && rowDate < dataset.startDate) {
      return lookup;
    }
    if (dataset?.endDate && rowDate > dataset.endDate) {
      return lookup;
    }
    if (selectedEventTypes.size > 0 && !selectedEventTypes.has(rowEventType)) {
      return lookup;
    }
    if (allowedEventKeys.size > 0 && !allowedEventKeys.has(rowEventKey)) {
      return lookup;
    }

    const normalizedResult = {
      player: String(row?.Player || '').trim(),
      event: String(row?.Event || '').trim(),
      date: rowDate,
      eventType: rowEventType,
      rank: Number(row?.Rank),
      wins: Number(row?.Wins) || 0,
      losses: Number(row?.Losses) || 0,
      winRate: getLeaderboardEventResultWinRate(row)
    };
    const existingResult = lookup.get(lookupKey);

    if (!existingResult) {
      lookup.set(lookupKey, normalizedResult);
      return lookup;
    }

    const currentRank = Number.isFinite(normalizedResult.rank) ? normalizedResult.rank : Number.POSITIVE_INFINITY;
    const existingRank = Number.isFinite(existingResult.rank) ? existingResult.rank : Number.POSITIVE_INFINITY;
    if (
      currentRank < existingRank ||
      (currentRank === existingRank && normalizedResult.wins > existingResult.wins) ||
      (currentRank === existingRank && normalizedResult.wins === existingResult.wins && normalizedResult.losses < existingResult.losses)
    ) {
      lookup.set(lookupKey, normalizedResult);
    }

    return lookup;
  }, new Map());
}

function getLeaderboardEventResultForEntry(entry = {}, eventResultLookup = currentLeaderboardDataset.eventResultLookup) {
  if (!entry || !(eventResultLookup instanceof Map) || eventResultLookup.size === 0) {
    return null;
  }

  const playerIdentityKey = getPlayerIdentityKey(entry.playerBaseName || entry.playerBaseKey || entry.player || entry.playerKey);
  const lookupKey = getLeaderboardEventResultLookupKey(
    {
      date: entry.date,
      event: entry.event
    },
    playerIdentityKey
  );

  return lookupKey ? (eventResultLookup.get(lookupKey) || null) : null;
}

function buildLeaderboardEventAnalysisDataAttributes(entry = {}) {
  const eventName = String(entry?.event || '').trim();
  if (!eventName) {
    return '';
  }

  const eventDate = String(entry?.date || '').trim();
  const playerLabel = String(entry?.playerBaseName || entry?.player || entry?.playerKey || '').trim();
  const eventLabel = formatEventName(eventName) || eventName;
  const eventDateLabel = eventDate ? formatDate(eventDate) : 'Unknown Date';

  return [
    'data-leaderboard-open-event-analysis="true"',
    `data-leaderboard-open-event-name="${escapeHtml(eventName)}"`,
    `data-leaderboard-open-event-date="${escapeHtml(eventDate)}"`,
    `data-leaderboard-open-event-player="${escapeHtml(playerLabel)}"`,
    `aria-label="${escapeHtml(`Open ${eventLabel} on ${eventDateLabel} in Event Analysis`)}"`
  ].join(' ');
}

function resolveLeaderboardEventAnalysisTarget({
  eventName = '',
  eventDate = '',
  playerName = ''
} = {}) {
  const fallbackEventName = String(eventName || '').trim();
  if (!fallbackEventName) {
    return null;
  }

  const fallbackPlayerName = String(playerName || '').trim();
  const matchedResult = getLeaderboardEventResultForEntry({
    event: fallbackEventName,
    date: String(eventDate || '').trim(),
    playerBaseName: fallbackPlayerName,
    player: fallbackPlayerName
  });

  return {
    eventName: matchedResult?.event || fallbackEventName,
    eventType: matchedResult?.eventType || String(currentLeaderboardDataset?.eventTypes?.[0] || DEFAULT_EVENT_TYPE).trim().toLowerCase(),
    playerName: matchedResult?.player || fallbackPlayerName
  };
}

async function openLeaderboardEventAnalysisShortcut({
  eventName = '',
  eventDate = '',
  playerName = ''
} = {}) {
  const target = resolveLeaderboardEventAnalysisTarget({ eventName, eventDate, playerName });
  if (!target?.eventName) {
    return;
  }

  shouldRestoreLeaderboardFullscreen = false;
  await closeLeaderboardDrilldown();
  openSingleEventPlayerInAnalysis(target.eventName, target.eventType, target.playerName);
}

function updateLeaderboardSearchStatus(message = '') {
  const statusElement = getLeaderboardSearchStatus();
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function getLeaderboardSortMode(dataset = currentLeaderboardDataset) {
  return 'elo';
}

function getDefaultLeaderboardSortState(mode = getLeaderboardSortMode()) {
  return { key: 'rating', direction: 'desc' };
}

function getLeaderboardSortDefaultDirection(sortKey = '') {
  switch (String(sortKey || '').trim()) {
    case 'displayName':
    case 'seasonYear':
      return 'asc';
    case 'lastActiveDate':
      return 'desc';
    default:
      return 'desc';
  }
}

function ensureLeaderboardSortState(dataset = currentLeaderboardDataset) {
  const mode = getLeaderboardSortMode(dataset);
  const validKeys = LEADERBOARD_SORTABLE_KEYS[mode] || LEADERBOARD_SORTABLE_KEYS.elo;
  const currentKey = String(leaderboardTableSort?.key || '').trim();
  const currentDirection = String(leaderboardTableSort?.direction || '').trim().toLowerCase();

  if (!validKeys.has(currentKey)) {
    leaderboardTableSort = getDefaultLeaderboardSortState(mode);
    return leaderboardTableSort;
  }

  if (!['asc', 'desc'].includes(currentDirection)) {
    leaderboardTableSort = {
      key: currentKey,
      direction: getLeaderboardSortDefaultDirection(currentKey)
    };
    return leaderboardTableSort;
  }

  return leaderboardTableSort;
}

function getLeaderboardComparableValue(row = {}, sortKey = '', dataset = currentLeaderboardDataset) {
  const resolvedSortKey = String(sortKey || '').trim();

  switch (resolvedSortKey) {
    case 'displayName':
      return String(row.displayName || '').toLowerCase();
    case 'seasonYear':
      return String(getLeaderboardEntryLabel(row) || '').toLowerCase();
    case 'lastActiveDate':
      return String(row.lastActiveDate || '');
    default:
      return Number(row?.[resolvedSortKey] || 0);
  }
}

function compareEloLeaderboardRows(a = {}, b = {}) {
  return (
    Number(b.rating || 0) - Number(a.rating || 0) ||
    Number(b.matches || 0) - Number(a.matches || 0) ||
    Number(b.wins || 0) - Number(a.wins || 0) ||
    Number(a.losses || 0) - Number(b.losses || 0) ||
    Number(b.top8Conversion || 0) - Number(a.top8Conversion || 0) ||
    Number(b.challengeWins || 0) - Number(a.challengeWins || 0) ||
    String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, { sensitivity: 'base' }) ||
    String(a.playerKey || '').localeCompare(String(b.playerKey || ''))
  );
}

function comparePerformanceLeaderboardRows(a = {}, b = {}) {
  return (
    Number(b.top8Conversion || 0) - Number(a.top8Conversion || 0) ||
    Number(b.top8Count || 0) - Number(a.top8Count || 0) ||
    Number(b.eventCount || 0) - Number(a.eventCount || 0) ||
    Number(b.matchCount || 0) - Number(a.matchCount || 0) ||
    Number(b.wins || 0) - Number(a.wins || 0) ||
    String(a.displayName || '').localeCompare(String(b.displayName || ''), undefined, { sensitivity: 'base' }) ||
    String(a.playerKey || '').localeCompare(String(b.playerKey || ''))
  );
}

function renderLeaderboardLoadingState(message = 'Loading Elo leaderboard...') {
  destroyLeaderboardTimelineChart();
  updateElementText('leaderboardTableTitle', 'Elo Leaderboard');
  renderLeaderboardTitleBadgeRow();
  updateElementText('leaderboardTableHelper', message);
  updateElementHTML('leaderboardTableClickHint', buildLeaderboardTableClickHintHtml());
  updateElementText('leaderboardEntryColumnLabel', 'Season');
  updateElementHTML(
    'leaderboardTableBody',
    `<tr><td colspan='11'>${escapeHtml(message)}</td></tr>`
  );
  updateLeaderboardSearchStatus(message);
  const timelineSection = getLeaderboardTimelineSection();
  if (timelineSection) {
    timelineSection.hidden = true;
  }
}

function renderLeaderboardErrorState(message = 'Unable to load Elo leaderboard data.') {
  destroyLeaderboardTimelineChart();
  renderLeaderboardTitleBadgeRow();
  updateElementText('leaderboardTableHelper', message);
  updateElementHTML('leaderboardTableClickHint', buildLeaderboardTableClickHintHtml());
  updateElementHTML('leaderboardTableBody', `<tr><td colspan='11'>${escapeHtml(message)}</td></tr>`);
  updateLeaderboardSearchStatus(message);
  const timelineSection = getLeaderboardTimelineSection();
  if (timelineSection) {
    timelineSection.hidden = true;
  }
}

function renderLeaderboardFromCurrentState() {
  // Re-render every dependent surface from the current dataset snapshot. This is
  // used after threshold changes, sorts, theme refreshes, and async data loads.
  const searchInput = getLeaderboardSearchInput();
  const downloadButton = getLeaderboardDownloadButton();

  // Reset the deck selection if the chosen deck no longer exists in the current dataset.
  const availableDecks = getAllDeckNamesFromDataset(currentLeaderboardDataset);
  if (selectedDeck !== LEADERBOARD_PLAYER_TOTAL_SCOPE && !availableDecks.includes(selectedDeck)) {
    selectedDeck = LEADERBOARD_PLAYER_TOTAL_SCOPE;
  }

  // Apply the selected deck filter first, then apply Elo thresholds.
  currentLeaderboardRows = selectedDeck === LEADERBOARD_PLAYER_TOTAL_SCOPE
    ? applyLeaderboardRowFilters(currentLeaderboardBaseRows, currentLeaderboardDataset)
    : applyLeaderboardRowFilters(buildDeckViewRows(selectedDeck, currentLeaderboardDataset), currentLeaderboardDataset);
  renderLeaderboardDeckButton();
  renderLeaderboardEloThresholdControls();

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

  if (activeSearchTerm) {
    applyLeaderboardTableSearch(searchInput?.value || activeSearchTerm, { scrollIntoView: false });
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
      closeLeaderboardDrilldown().catch(error => {
        console.error('Failed to close leaderboard drilldown after filters removed the active row.', error);
      });
    }
  } else if (activeLeaderboardDrilldownCategory) {
    renderLeaderboardDrilldown(activeLeaderboardDrilldownCategory);
  }
}

function clearLeaderboardSearchHighlights() {
  document
    .querySelectorAll('#leaderboardTableBody tr.leaderboard-search-match, #leaderboardTableBody tr.leaderboard-search-match-primary')
    .forEach(row => {
      row.classList.remove('leaderboard-search-match', 'leaderboard-search-match-primary');
    });
}

function sortLeaderboardRows(rows = []) {
  // Sorting is stable from a user perspective: selected column first, then the
  // default Elo ranking tie-breakers.
  const sortedRows = [...rows];
  const dataset = currentLeaderboardDataset;
  const mode = getLeaderboardSortMode(dataset);
  const sortState = ensureLeaderboardSortState(dataset);
  const tieBreaker = compareEloLeaderboardRows;
  const sortKey = sortState.key;
  const directionMultiplier = sortState.direction === 'asc' ? 1 : -1;

  sortedRows.sort((a, b) => {
    const leftValue = getLeaderboardComparableValue(a, sortKey, dataset);
    const rightValue = getLeaderboardComparableValue(b, sortKey, dataset);
    let comparison = 0;

    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      comparison = String(leftValue || '').localeCompare(String(rightValue || ''), undefined, { sensitivity: 'base' });
    } else {
      comparison = Number(leftValue || 0) - Number(rightValue || 0);
    }

    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    return tieBreaker(a, b);
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
  // Search is highlight-only. It preserves the active filters and sorted order so
  // a search never silently changes leaderboard rank context.
  const normalizedSearchTerm = normalizeLeaderboardSearchText(searchTerm);
  const tableRows = Array.from(document.querySelectorAll('#leaderboardTableBody tr[data-leaderboard-player-name]'));

  clearLeaderboardSearchHighlights();
  activeSearchTerm = normalizedSearchTerm;

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
  ensureLeaderboardSortState(currentLeaderboardDataset);
  return sortLeaderboardRows(currentLeaderboardRows).map((row, index) => ({
    ...row,
    displayRank: index + 1
  }));
}

function getLeaderboardStatsSeasonKey(rowDate = '', dataset = currentLeaderboardDataset) {
  const normalizedDate = String(rowDate || '').trim();
  if (!dataset?.resetByYear) {
    return 'all-time';
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)
    ? normalizedDate.slice(0, 4)
    : 'unknown-year';
}

function buildLeaderboardEventStatsLookup(dataset = currentLeaderboardDataset) {
  // Event-stat augmentation powers the Elo Events column plus Top 8 / 1st-place
  // summaries. Event participation comes from rated Elo history so it stays
  // internally consistent with the ladder itself, while placement summaries
  // still come from the standings dataset.
  const processedMatches = Array.isArray(dataset?.processedMatches) ? dataset.processedMatches : [];
  const ratedEventLookup = new Map();
  const registerRatedMatchEvent = (groupKey = '', match = null) => {
    if (!groupKey || !match) {
      return;
    }

    if (!ratedEventLookup.has(groupKey)) {
      ratedEventLookup.set(groupKey, []);
    }
    ratedEventLookup.get(groupKey).push(match);
  };

  processedMatches.forEach(match => {
    const seasonKey = String(match?.seasonKey || '').trim();
    const playerBaseKey = String(match?.playerBaseKey || '').trim();
    const opponentBaseKey = String(match?.opponentBaseKey || '').trim();
    if (!seasonKey) {
      return;
    }

    registerRatedMatchEvent(`${seasonKey}:::${playerBaseKey}`, match);
    registerRatedMatchEvent(`${seasonKey}:::${opponentBaseKey}`, match);
  });

  const eventRows = Array.isArray(getAnalysisRows()) ? getAnalysisRows() : [];
  const selectedEventTypes = new Set(
    (Array.isArray(dataset?.eventTypes) ? dataset.eventTypes : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const groupedEventRows = new Map();

  eventRows.forEach((row, index) => {
    const rowDate = String(row?.Date || '').trim();
    const eventType = String(row?.EventType || '').trim().toLowerCase();
    const playerKey = getPlayerIdentityKey(row?.Player);
    const seasonKey = getLeaderboardStatsSeasonKey(rowDate, dataset);
    const eventKey = `${rowDate}|||${String(row?.Event || '').trim()}`;
    const groupKey = `${seasonKey}:::${playerKey}`;

    if (!playerKey || !rowDate || !eventKey || eventKey === '|||' || !seasonKey) {
      return;
    }

    if (dataset?.startDate && rowDate < dataset.startDate) {
      return;
    }
    if (dataset?.endDate && rowDate > dataset.endDate) {
      return;
    }
    if (selectedEventTypes.size > 0 && !selectedEventTypes.has(eventType)) {
      return;
    }

    if (!groupedEventRows.has(groupKey)) {
      groupedEventRows.set(groupKey, new Map());
    }

    const eventMap = groupedEventRows.get(groupKey);
    const existing = eventMap.get(eventKey);
    const nextRank = Number(row?.Rank);
    const existingRank = Number(existing?.Rank);

    if (!existing) {
      eventMap.set(eventKey, { ...row, __sourceIndex: index });
      return;
    }

    if (
      !Number.isFinite(existingRank) ||
      (Number.isFinite(nextRank) && nextRank < existingRank) ||
      (Number.isFinite(nextRank) && nextRank === existingRank && index > Number(existing?.__sourceIndex || -1))
    ) {
      eventMap.set(eventKey, { ...row, __sourceIndex: index });
    }
  });

  return Array.from(groupedEventRows.entries()).reduce((lookup, [groupKey, eventMap]) => {
    const dedupedRows = Array.from(eventMap.values());
    const ratedEventCount = countUniqueEvents(
      ratedEventLookup.get(groupKey) || [],
      match => ({
        date: match?.date || match?.Date || '',
        event: match?.event_id || match?.eventId || match?.event || ''
      })
    );
    const top8Count = dedupedRows.filter(row => Number(row?.Rank) >= 1 && Number(row?.Rank) <= 8).length;
    const challengeWins = dedupedRows.filter(row => Number(row?.Rank) === 1).length;
    const eventCount = Math.max(ratedEventCount, top8Count);

    lookup.set(groupKey, {
      eventCount,
      top8Count,
      top8Conversion: eventCount > 0 ? top8Count / eventCount : 0,
      challengeWins
    });

    return lookup;
  }, new Map());
}

function augmentEloLeaderboardRowsWithEventStats(rows = [], dataset = currentLeaderboardDataset) {
  const statsLookup = buildLeaderboardEventStatsLookup(dataset);

  return (Array.isArray(rows) ? rows : []).map(row => {
    const playerKey = String(row?.basePlayerKey || row?.playerKey || '').trim();
    const seasonKey = String(row?.seasonKey || '').trim() || getLeaderboardStatsSeasonKey(row?.lastActiveDate, dataset);
    const rowStats = statsLookup.get(`${seasonKey}:::${playerKey}`) || {
      eventCount: countUniqueEvents(
        (Array.isArray(dataset?.processedMatches) ? dataset.processedMatches : []).filter(match => {
          const matchSeasonKey = String(match?.seasonKey || '').trim();
          return matchSeasonKey === seasonKey && (
            String(match?.playerBaseKey || '').trim() === playerKey
            || String(match?.opponentBaseKey || '').trim() === playerKey
          );
        }),
        match => ({
          date: match?.date || match?.Date || '',
          event: match?.event_id || match?.eventId || match?.event || ''
        })
      ),
      top8Count: 0,
      top8Conversion: 0,
      challengeWins: 0
    };

    return {
      ...row,
      eventCount: rowStats.eventCount,
      top8Count: rowStats.top8Count,
      top8Conversion: rowStats.top8Conversion,
      challengeWins: rowStats.challengeWins
    };
  });
}

function getLeaderboardRowByKeysWithRank(playerKey = '', seasonKey = '') {
  const normalizedPlayerKey = String(playerKey || '').trim();
  const normalizedSeasonKey = String(seasonKey || '').trim();

  return getSortedLeaderboardRowsWithRank().find(row => {
    return String(row.playerKey || '').trim() === normalizedPlayerKey
      && String(row.seasonKey || '').trim() === normalizedSeasonKey;
  }) || null;
}

// Formats a threshold value for CSV metadata and marks zero values as disabled.
// Formats one threshold value for CSV metadata, marking zero values as disabled.
function formatLeaderboardThresholdCsvValue(key = '', value = 0) {
  const normalizedValue = sanitizeLeaderboardThresholdValue(key, value);
  const formattedValue = formatLeaderboardThresholdMetricValue(key, normalizedValue);
  return normalizedValue > 0 ? formattedValue : `${formattedValue} (disabled)`;
}

// Builds the CSV metadata rows that describe active Elo minimum filters.
// Builds the CSV metadata rows that describe the active Elo minimum filters.
function getLeaderboardEloThresholdCsvMetadata() {
  const thresholds = getActiveLeaderboardEloThresholds();
  const activeThresholdRows = Object.entries(LEADERBOARD_ELO_THRESHOLD_CONFIG)
    .map(([key, config]) => {
      const value = sanitizeLeaderboardThresholdValue(key, thresholds[key] ?? 0);
      return {
        key,
        label: config.label,
        value,
        formattedValue: formatLeaderboardThresholdMetricValue(key, value)
      };
    })
    .filter(row => row.value > 0);

  return [
    ['Elo Minimum Filters', activeThresholdRows.length > 0 ? 'Active' : 'Inactive'],
    [
      'Elo Minimum Filters Summary',
      activeThresholdRows.length > 0
        ? activeThresholdRows.map(row => `${row.label} >= ${row.formattedValue}`).join(' | ')
        : 'No Elo minimum filters selected'
    ],
    ['Rows Before Elo Minimum Filters', String(currentLeaderboardBaseRows.length)],
    ['Rows After Elo Minimum Filters', String(currentLeaderboardRows.length)],
    ...Object.entries(LEADERBOARD_ELO_THRESHOLD_CONFIG).map(([key, config]) => [
      `Minimum ${config.label}`,
      formatLeaderboardThresholdCsvValue(key, thresholds[key] ?? 0)
    ])
  ];
}

function getLeaderboardCsvMetadata(dataset = currentLeaderboardDataset) {
  if (dataset?.mode === 'performance') {
    return [
      ['View', getLeaderboardViewTitle(dataset)],
      ['Window Type', getLeaderboardWindowModeLabel(dataset.period)],
      ['Selected Window', getWindowLabel(dataset.period, dataset.summary.selectedYears, dataset.startDate, dataset.endDate)],
      ['Selected Years', getLeaderboardSelectedYearsLabel(dataset) || '--'],
      ['Date Range', formatWindowRange(dataset.startDate, dataset.endDate)],
      ['Event Types', (dataset.eventTypes || []).join(', ') || DEFAULT_EVENT_TYPE],
      ['Metric', 'Top 8 Conversion'],
      ['Minimum Events', String(dataset.summary.minEvents || 0)],
      ['Tracked Players', String(dataset.summary.uniquePlayers || 0)],
      ['Qualified Rows', String(dataset.summary.seasonEntries || 0)],
      ['Unique Events', String(dataset.summary.totalEvents || 0)],
      ['Qualified Player Appearances', String(dataset.summary.playerAppearances || 0)]
    ];
  }

  const metadataRows = [
    ['Starting Rating', String(DEFAULT_RANKINGS_OPTIONS.startingRating)],
    ['kFactor', String(getLeaderboardResolvedKFactor(dataset, dataset.period))],
    ['View', getLeaderboardViewTitle(dataset)],
    ['Window Type', getLeaderboardWindowModeLabel(dataset.period)],
    ['Rating Continuity', getLeaderboardContinuityLabel(dataset)],
    ['Selected Window', getWindowLabel(dataset.period, dataset.summary.selectedYears, dataset.startDate, dataset.endDate)],
    ['Selected Years', getLeaderboardSelectedYearsLabel(dataset) || '--'],
    ['Date Range', formatWindowRange(dataset.startDate, dataset.endDate)],
    ['Event Types', (dataset.eventTypes || []).join(', ') || DEFAULT_EVENT_TYPE],
    ['Rated Matches', String(dataset.summary.ratedMatches || 0)],
    ['Tracked Players', String(dataset.summary.uniquePlayers || 0)],
    ['Leaderboard Rows', String(dataset.summary.seasonEntries || 0)],
    ...getLeaderboardEloThresholdCsvMetadata()
  ];

  if (dataset.summary.latestProcessedMatch?.date) {
    metadataRows.push([
      'Latest Rated Match',
      `${formatEventName(dataset.summary.latestProcessedMatch.event) || dataset.summary.latestProcessedMatch.event || 'Unknown Event'} on ${formatDate(dataset.summary.latestProcessedMatch.date)}`
    ]);
  }

  return metadataRows;
}

function applyLeaderboardTableSortHeaderState() {
  const tableHead = document.getElementById('leaderboardTableHead');
  if (!tableHead) {
    return;
  }

  const sortState = ensureLeaderboardSortState(currentLeaderboardDataset);
  tableHead.querySelectorAll('th[data-sort]').forEach(header => {
    const isActive = String(header.dataset.sort || '') === sortState.key;
    const arrow = header.querySelector('.sort-arrow');

    header.classList.remove('asc', 'desc');
    header.setAttribute('aria-sort', 'none');
    if (arrow) {
      arrow.textContent = '';
    }

    if (!isActive) {
      return;
    }

    header.classList.add(sortState.direction);
    header.setAttribute('aria-sort', sortState.direction === 'asc' ? 'ascending' : 'descending');
    if (arrow) {
      arrow.textContent = sortState.direction === 'asc' ? '\u2191' : '\u2193';
    }
  });
}

function setupLeaderboardTableSorting() {
  const tableHead = document.getElementById('leaderboardTableHead');
  if (!tableHead || tableHead.dataset.listenerAdded === 'true') {
    applyLeaderboardTableSortHeaderState();
    return;
  }

  tableHead.addEventListener('click', event => {
    const header = event.target.closest('th[data-sort]');
    if (!header) {
      return;
    }

    const sortKey = String(header.dataset.sort || '').trim();
    const defaultDirection = getLeaderboardSortDefaultDirection(sortKey);
    const isSameKey = leaderboardTableSort?.key === sortKey;

    leaderboardTableSort = {
      key: sortKey,
      direction: isSameKey
        ? (leaderboardTableSort.direction === 'asc' ? 'desc' : 'asc')
        : defaultDirection
    };

    renderLeaderboardTable(currentLeaderboardDataset);
    if (activeSearchTerm) {
      applyLeaderboardTableSearch(getLeaderboardSearchInput()?.value || activeSearchTerm, { scrollIntoView: false });
    } else {
      updateLeaderboardSearchStatus('');
    }
  });

  tableHead.dataset.listenerAdded = 'true';
  applyLeaderboardTableSortHeaderState();
}

function exportLeaderboardCsv() {
  const rowsWithRank = getSortedLeaderboardRowsWithRank();
  if (rowsWithRank.length === 0) {
    return;
  }

  const csvColumns = currentLeaderboardDataset?.mode === 'performance'
    ? [
      { header: 'Rank', value: row => row.displayRank },
      { header: 'Player', value: row => row.displayName },
      { header: getLeaderboardEntryFieldLabel(currentLeaderboardDataset), value: row => getLeaderboardEntryLabel(row) },
      { header: 'Top 8 Conversion', value: row => formatWinRate(row.top8Conversion) },
      { header: 'Top 8s', value: row => row.top8Count },
      { header: 'Events', value: row => row.eventCount },
      { header: 'Matches', value: row => row.matchCount },
      { header: 'Wins', value: row => row.wins },
      { header: 'Losses', value: row => row.losses },
      { header: 'Match Win Rate', value: row => formatWinRate(row.winRate) },
      { header: 'Last Event', value: row => (row.lastActiveDate ? formatDate(row.lastActiveDate) : '--') }
    ]
    : [
      { header: 'Rank', value: row => row.displayRank },
      { header: 'Player', value: row => row.displayName },
      { header: getLeaderboardEntryFieldLabel(currentLeaderboardDataset), value: row => getLeaderboardEntryLabel(row) },
      { header: 'Elo', value: row => formatRating(row.rating) },
      ...getLeaderboardSelectedYearGainColumns(currentLeaderboardDataset).map(year => ({
        header: `${year} Gains`,
        value: row => getLeaderboardRowYearGainValue(row, year)
      })),
      { header: 'Events', value: row => row.eventCount },
      { header: 'Total Matches', value: row => row.matches },
      { header: 'Wins', value: row => row.wins },
      { header: 'Losses', value: row => row.losses },
      { header: 'Win Rate', value: row => formatWinRate(row.winRate) },
      { header: 'Top 8 Conversion', value: row => formatWinRate(row.top8Conversion) },
      { header: '1st Places', value: row => row.challengeWins },
      { header: 'Last Match', value: row => (row.lastActiveDate ? formatDate(row.lastActiveDate) : '--') }
    ];
  const csvText = buildStructuredTableCsv(
    csvColumns,
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

  const fromVisible = currentLeaderboardRows.find(row => {
    return String(row.playerKey || '').trim() === normalizedPlayerKey
      && String(row.seasonKey || '').trim() === normalizedSeasonKey;
  });
  if (fromVisible) {
    return fromVisible;
  }

  return currentLeaderboardBaseRows.find(row => {
    return String(row.playerKey || '').trim() === normalizedPlayerKey
      && String(row.seasonKey || '').trim() === normalizedSeasonKey;
  }) || null;
}

function getPlayerHistoryForRow(row) {
  const historyEntries = currentLeaderboardDataset.historyByPlayer?.get(row.playerKey) || [];

  return [...historyEntries]
    .filter(entry => String(entry.seasonKey || '') === String(row.seasonKey || ''))
    .sort(compareHistoryEntriesDescending);
}

function getLeaderboardRowSelectionKey(row = {}) {
  return `${String(row.seasonKey || '').trim()}:::${String(row.playerKey || '').trim()}`;
}

function getLeaderboardRowsBySelectionKeys(selectionKeys = activeLeaderboardTimelineSelections) {
  const selectedKeySet = selectionKeys instanceof Set ? selectionKeys : new Set(selectionKeys);
  return getSortedLeaderboardRowsWithRank().filter(row => selectedKeySet.has(getLeaderboardRowSelectionKey(row)));
}

function getLeaderboardPlayerHistoryAscending(row) {
  return getPlayerHistoryForRow(row).slice().sort(compareHistoryEntriesAscending);
}

function destroyLeaderboardPlayerEloChart() {
  leaderboardPlayerEloChart = destroyLeaderboardChart(leaderboardPlayerEloChart);
  updateLeaderboardPlayerChartVisibilityButtons();
}

function destroyLeaderboardTimelineChart() {
  leaderboardTimelineChart = destroyLeaderboardChart(leaderboardTimelineChart);
}

function shouldShowLeaderboardYearBoundaryMarkers(dataset = currentLeaderboardDataset) {
  return shouldShowLeaderboardYearBoundaries(dataset);
}

function buildLeaderboardPlayerHistoryCsvMetadata(row, scope = null) {
  const resolvedScope = scope || buildLeaderboardPlayerDrilldownModel(row).activeScope;
  const historyEntries = resolvedScope?.historyEntries || [];
  const ratingLabel = resolvedScope?.type === 'deck' ? 'Deck Elo' : 'Total Elo';
  const scopeRow = resolvedScope?.row || row;

  return [
    ['View', `${getLeaderboardViewTitle(currentLeaderboardDataset)} Match History`],
    ['Player', row.displayName || row.playerKey || '--'],
    ['Deck Scope', resolvedScope?.label || getDeckDisplayName(LEADERBOARD_PLAYER_TOTAL_SCOPE)],
    ['Rating Type', ratingLabel],
    [getLeaderboardEntryFieldLabel(currentLeaderboardDataset), getLeaderboardEntryLabel(row)],
    [ratingLabel, formatRating(scopeRow.rating)],
    ['Matches', String(scopeRow.matches || 0)],
    ['Wins', String(scopeRow.wins || 0)],
    ['Losses', String(scopeRow.losses || 0)],
    ['Win Rate', formatWinRate(scopeRow.winRate)],
    ['History Rows', String(historyEntries.length || 0)],
    ['Window Type', getLeaderboardWindowModeLabel(currentLeaderboardDataset.period)],
    ['Rating Continuity', getLeaderboardContinuityLabel(currentLeaderboardDataset)],
    ['K-Factor', String(getLeaderboardResolvedKFactor(currentLeaderboardDataset, currentLeaderboardDataset.period))],
    ['Leaderboard Window', getWindowLabel(currentLeaderboardDataset.period, currentLeaderboardDataset.summary.selectedYears, currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate)],
    ['Date Range', formatWindowRange(currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate)],
    ['Event Types', (currentLeaderboardDataset.eventTypes || []).join(', ') || DEFAULT_EVENT_TYPE]
  ];
}

function exportLeaderboardPlayerHistoryCsv(playerKey = '', seasonKey = '', deckScopeKey = LEADERBOARD_PLAYER_TOTAL_SCOPE) {
  const row = getLeaderboardRowByKeys(playerKey, seasonKey);
  if (!row) {
    return;
  }

  const model = getLeaderboardPlayerDrilldownModel(row);
  const historyScope = normalizeLeaderboardDeckScopeKey(deckScopeKey) === LEADERBOARD_PLAYER_TOTAL_SCOPE
    ? model.totalScope
    : model.deckSummaries.find(scope => scope.key === normalizeLeaderboardDeckScopeKey(deckScopeKey)) || model.totalScope;
  const historyEntries = historyScope.historyEntries;
  if (historyEntries.length === 0) {
    return;
  }

  const ratingLabel = historyScope.type === 'deck' ? 'Deck Elo' : 'Total Elo';

  const csvText = buildStructuredTableCsv(
    [
      { header: 'Date', value: entry => (entry.date ? formatDate(entry.date) : '--') },
      { header: 'Event', value: entry => formatEventName(entry.event) || entry.event || 'Unknown Event' },
      { header: 'Round', value: entry => (Number.isFinite(Number(entry.round)) ? Number(entry.round) : '--') },
      { header: 'Deck', value: entry => getLeaderboardDeckDisplayName(entry.deck) },
      { header: 'Opponent', value: entry => entry.opponent || entry.opponentKey || 'Unknown Opponent' },
      { header: 'Opponent Deck', value: entry => getLeaderboardDeckDisplayName(entry.opponentDeck) },
      { header: 'Result', value: entry => String(entry.resultType || 'unknown').toUpperCase() },
      { header: `${ratingLabel} Before`, value: entry => formatRating(entry.ratingBefore) },
      { header: `${ratingLabel} After`, value: entry => formatRating(entry.ratingAfter) },
      { header: 'Delta', value: entry => formatRatingDelta(entry.delta) }
    ],
    historyEntries,
    buildLeaderboardPlayerHistoryCsvMetadata(row, historyScope)
  );

  const playerLabel = sanitizeCsvFilename(row.displayName || row.playerKey || 'player');
  const seasonLabel = sanitizeCsvFilename(getLeaderboardEntryLabel(row) || 'selected-range');
  const scopeLabel = sanitizeCsvFilename(historyScope.label || 'all-decks');
  downloadCsvFile(`elo-match-history-${playerLabel}-${seasonLabel}-${scopeLabel}.csv`, csvText);
}

function getLeaderboardPeakMoment(scope = {}) {
  const peakRating = Number(scope?.peakRating);
  if (!Number.isFinite(peakRating)) {
    return null;
  }

  const historyEntries = Array.isArray(scope?.historyEntriesAscending) && scope.historyEntriesAscending.length > 0
    ? scope.historyEntriesAscending
    : [...(scope?.historyEntries || [])].sort(compareHistoryEntriesAscending);

  const matchingEntry = historyEntries.find(entry => {
    return Math.abs(Number(entry?.ratingAfter) - peakRating) < 0.001
      || Math.abs(Number(entry?.ratingBefore) - peakRating) < 0.001;
  });

  if (!matchingEntry) {
    return null;
  }

  return {
    entry: matchingEntry,
    phase: Math.abs(Number(matchingEntry?.ratingAfter) - peakRating) < 0.001 ? 'after' : 'before',
    rating: peakRating
  };
}

function buildLeaderboardReportMomentLabel(entry = {}, { includeDelta = true } = {}) {
  if (!entry) {
    return '--';
  }

  const resultLabel = formatResultLabel(entry.resultType);
  const opponentLabel = entry.opponent || entry.opponentKey || 'Unknown Opponent';
  const contextLabel = buildHistoryContextLabel(entry);
  const deltaLabel = includeDelta && Number.isFinite(Number(entry.delta))
    ? ` | ${formatRating(entry.ratingBefore)} -> ${formatRating(entry.ratingAfter)} (${formatRatingDelta(entry.delta)})`
    : '';

  return `${resultLabel} vs ${opponentLabel} in ${contextLabel}${deltaLabel}`;
}

function buildLeaderboardDeckBreakdownReportRows(row, model) {
  if (!model?.deckSummaries?.length) {
    return [];
  }

  const totalMatches = Number(row?.matches) || 0;

  return model.deckSummaries.map(scope => {
    const scopeRow = scope?.row || {};
    const matchShare = totalMatches > 0
      ? `${(((Number(scopeRow.matches) || 0) / totalMatches) * 100).toFixed(1)}%`
      : '--';

    return {
      deck: scope.label || 'Unknown Deck',
      elo: formatRating(scopeRow.rating),
      peak: Number.isFinite(scope?.peakRating) ? formatRating(scope.peakRating) : '--',
      matches: String(scopeRow.matches || 0),
      record: formatLeaderboardRecord(scopeRow),
      winRate: formatWinRate(scopeRow.winRate),
      share: matchShare
    };
  });
}

function buildLeaderboardRecentHistoryReportCards(historyEntries = [], {
  ratingLabel = 'Total Elo',
  limit = 8,
  includeScopeNote = true
} = {}) {
  const resolvedEntries = Array.isArray(historyEntries) ? historyEntries : [];
  if (resolvedEntries.length === 0) {
    return [];
  }

  const resolvedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.floor(Number(limit))
    : resolvedEntries.length;

  const cards = resolvedEntries.slice(0, resolvedLimit).map(entry => {
    const eventLabel = formatEventName(entry.event) || entry.event || 'Unknown Event';
    const roundLabel = Number.isFinite(Number(entry.round)) ? `Round ${Number(entry.round)}` : 'Unknown Round';
    const deltaLabel = formatRatingDelta(entry.delta);
    const isPositive = Number(entry.delta) > 0;
    const isNegative = Number(entry.delta) < 0;

    return {
      title: `${formatResultLabel(entry.resultType)} vs ${entry.opponent || entry.opponentKey || 'Unknown Opponent'}`,
      subtitle: `${formatShortDate(entry.date)} | ${eventLabel} | ${roundLabel}`,
      detail: `${getLeaderboardDeckDisplayName(entry.deck)} vs ${getLeaderboardDeckDisplayName(entry.opponentDeck)} | ${ratingLabel}: ${formatRating(entry.ratingBefore)} -> ${formatRating(entry.ratingAfter)} (${deltaLabel})`,
      accentText: deltaLabel,
      accentColor: isPositive ? '#2f7d57' : isNegative ? '#a14848' : '#87631f'
    };
  });

  if (includeScopeNote && resolvedEntries.length > resolvedLimit) {
    cards.push({
      title: 'Report Scope Note',
      subtitle: 'Recent matches truncated for readability',
      detail: `Showing the most recent ${resolvedLimit} rated matches out of ${resolvedEntries.length} total entries in this scope.`,
      accentText: `${resolvedLimit}/${resolvedEntries.length}`,
      accentColor: '#87631f'
    });
  }

  return cards;
}

function buildLeaderboardDeckScopeSummaryRows(row, scope = {}) {
  const scopeRow = scope?.row || {};
  const matchShare = Number(row?.matches) > 0
    ? `${(((Number(scopeRow.matches) || 0) / Number(row.matches)) * 100).toFixed(1)}%`
    : '--';
  const firstMatchLabel = scope?.firstMatch
    ? buildLeaderboardReportMomentLabel(scope.firstMatch, { includeDelta: false })
    : '--';
  const latestMatchLabel = scope?.latestMatch
    ? buildLeaderboardReportMomentLabel(scope.latestMatch)
    : '--';

  return [
    { label: 'Focused Deck', value: scope.label || '--', valueColor: '#87631f' },
    { label: 'Deck Elo', value: formatRating(scopeRow.rating), valueColor: '#d4a657' },
    { label: 'Peak Deck Elo', value: Number.isFinite(scope?.peakRating) ? formatRating(scope.peakRating) : '--' },
    { label: 'Total Elo Reference', value: formatRating(row?.rating) },
    { label: 'Deck Record', value: formatLeaderboardRecord(scopeRow) },
    { label: 'Deck Win Rate', value: formatWinRate(scopeRow.winRate) },
    { label: 'Deck Matches', value: String(scopeRow.matches || 0) },
    { label: 'Deck Match Share', value: matchShare },
    { label: 'First Deck Match', value: firstMatchLabel },
    { label: 'Latest Deck Match', value: latestMatchLabel },
    { label: 'Best Deck Gain', value: scope?.bestDelta ? `${formatRatingDelta(scope.bestDelta.delta)} | ${buildLeaderboardReportMomentLabel(scope.bestDelta, { includeDelta: false })}` : '--', valueColor: '#2f7d57' },
    { label: 'Biggest Deck Drop', value: scope?.worstDelta ? `${formatRatingDelta(scope.worstDelta.delta)} | ${buildLeaderboardReportMomentLabel(scope.worstDelta, { includeDelta: false })}` : '--', valueColor: '#a14848' }
  ];
}

function buildLeaderboardPdfChartSection(row, model, reportScope, {
  title,
  subtitle,
  note,
  ...sectionOptions
} = {}) {
  const deckPointShapes = ['diamond', 'triangle', 'circle', 'cross', 'triangle-down'];
  const isDeckScope = reportScope?.type === 'deck';
  const chartData = buildLeaderboardPlayerChartData({
    row,
    totalScope: model.totalScope,
    deckSummaries: model.deckSummaries,
    activeScopeKey: reportScope?.key || LEADERBOARD_PLAYER_TOTAL_SCOPE,
    activeScope: reportScope || model.totalScope
  });

  const filteredDatasets = (chartData?.datasets || []).filter((dataset, index) => {
    if (!isDeckScope) {
      return true;
    }

    return index === 0 || (dataset?.label === reportScope?.label);
  });

  const series = filteredDatasets
    .map((dataset, index) => {
      const label = dataset.label || 'Elo';
      const isTotalSeries = label === 'Total Elo';
      const deckSeriesIndex = Math.max(0, isTotalSeries ? 0 : index - 1);
      const originalDeckIndex = isTotalSeries
        ? 0
        : Math.max(0, model.deckSummaries.findIndex(scope => scope.label === label));
      const resolvedColor = isDeckScope
        ? (isTotalSeries ? LEADERBOARD_REPORT_TOTAL_ELO_COLOR : LEADERBOARD_REPORT_FOCUSED_DECK_COLOR)
        : (isTotalSeries ? getLeaderboardTimelineColor(0) : getLeaderboardTimelineColor(originalDeckIndex + 1));
      const resolvedDash = isDeckScope
        ? (isTotalSeries ? [7, 5] : [])
        : (Array.isArray(dataset.borderDash) ? dataset.borderDash : []);
      const resolvedLineWidth = isDeckScope
        ? (isTotalSeries ? 2.2 : 3.1)
        : (Number(dataset.borderWidth) || (label === 'Total Elo' ? 3 : 2));

      return {
        label,
        color: resolvedColor,
        data: Array.isArray(dataset.data) ? dataset.data : [],
        dash: resolvedDash,
        pointShape: isTotalSeries
          ? 'square'
          : deckPointShapes[deckSeriesIndex % deckPointShapes.length],
        lineWidth: resolvedLineWidth
      };
    });

  const totalPointCount = model?.totalScope?.points?.length || 0;
  const startLabel = model?.totalScope?.firstMatch?.date ? formatShortDate(model.totalScope.firstMatch.date) : 'Start';
  const endLabel = model?.totalScope?.latestMatch?.date ? formatShortDate(model.totalScope.latestMatch.date) : 'End';
  const defaultSubtitle = isDeckScope
    ? `${reportScope.label} focus compared with total Elo only`
    : 'Season-long rating progression across all tracked decks';
  const defaultNote = (
    isDeckScope
      ? `${reportScope.label} is shown against the player's Total Elo reference across ${totalPointCount} tracked event${totalPointCount === 1 ? '' : 's'}.`
      : `Showing Total Elo together with every tracked deck Elo trail across ${totalPointCount} tracked event${totalPointCount === 1 ? '' : 's'}.`
  );

  return {
    type: 'lineChart',
    title: title === undefined ? 'Elo Trend' : title,
    subtitle: subtitle === undefined ? defaultSubtitle : subtitle,
    series,
    startLabel,
    endLabel,
    note: note === undefined ? defaultNote : note,
    emptyText: "Not enough Elo history is available to draw the player's trend chart.",
    connectDiscontinuities: isDeckScope,
    ...sectionOptions
  };
}

function updateLeaderboardPlayerReportDownloadButton(playerKey = '', seasonKey = '', deckScopeKey = LEADERBOARD_PLAYER_TOTAL_SCOPE) {
  const { reportDownloadButton } = getLeaderboardDrilldownElements();
  if (!reportDownloadButton) {
    return;
  }

  const normalizedPlayerKey = String(playerKey || '').trim();
  const normalizedSeasonKey = String(seasonKey || '').trim();
  const shouldShow = Boolean(normalizedPlayerKey);
  const entryFieldLabel = getLeaderboardEntryFieldLabel(currentLeaderboardDataset);
  const buttonLabel = `${entryFieldLabel} Full PDF Report`;

  reportDownloadButton.hidden = !shouldShow;
  reportDownloadButton.textContent = buttonLabel;
  reportDownloadButton.setAttribute('aria-label', shouldShow ? `Download ${buttonLabel.toLowerCase()}` : buttonLabel);
  reportDownloadButton.dataset.leaderboardDownloadReport = shouldShow ? normalizedPlayerKey : '';
  reportDownloadButton.dataset.leaderboardDownloadReportSeason = shouldShow ? normalizedSeasonKey : '';
  reportDownloadButton.dataset.leaderboardDownloadReportDeck = shouldShow ? normalizeLeaderboardDeckScopeKey(deckScopeKey) : LEADERBOARD_PLAYER_TOTAL_SCOPE;
}

function exportLeaderboardPlayerSeasonPdfReport(playerKey = '', seasonKey = '', deckScopeKey = LEADERBOARD_PLAYER_TOTAL_SCOPE) {
  const rankedRow = getLeaderboardRowByKeysWithRank(playerKey, seasonKey);
  const row = rankedRow || getLeaderboardRowByKeys(playerKey, seasonKey);
  if (!row) {
    return;
  }

  const model = getLeaderboardPlayerDrilldownModel(row);
  const normalizedScopeKey = normalizeLeaderboardDeckScopeKey(deckScopeKey);
  const totalScope = model.totalScope;
  const entryFieldLabel = getLeaderboardEntryFieldLabel(currentLeaderboardDataset);
  const entryLabel = getLeaderboardEntryLabel(row);
  const preferredDeckScope = normalizedScopeKey === LEADERBOARD_PLAYER_TOTAL_SCOPE
    ? null
    : model.deckSummaries.find(scope => scope.key === normalizedScopeKey) || null;
  const orderedDeckSummaries = preferredDeckScope
    ? [
        preferredDeckScope,
        ...model.deckSummaries.filter(scope => scope.key !== preferredDeckScope.key)
      ]
    : model.deckSummaries;
  const peakMoment = getLeaderboardPeakMoment(totalScope);
  const mostPlayedDeck = model.deckSummaries[0] || null;
  const strongestDeck = [...model.deckSummaries].sort((a, b) => {
    return Number(b?.peakRating || 0) - Number(a?.peakRating || 0)
      || Number(b?.row?.rating || 0) - Number(a?.row?.rating || 0)
      || Number(b?.row?.matches || 0) - Number(a?.row?.matches || 0);
  })[0] || null;
  const totalDeltaLabel = Number.isFinite(Number(totalScope?.totalDelta))
    ? formatRatingDelta(totalScope.totalDelta)
    : '--';
  const firstMatchLabel = totalScope?.firstMatch
    ? buildLeaderboardReportMomentLabel(totalScope.firstMatch)
    : '--';
  const latestMatchLabel = totalScope?.latestMatch
    ? buildLeaderboardReportMomentLabel(totalScope.latestMatch)
    : '--';
  const peakMomentLabel = peakMoment
    ? `${formatRating(peakMoment.rating)} ${peakMoment.phase === 'before' ? 'before' : 'after'} ${buildHistoryContextLabel(peakMoment.entry)}`
    : '--';
  const bestGainLabel = totalScope?.bestDelta
    ? `${formatRatingDelta(totalScope.bestDelta.delta)} | ${buildLeaderboardReportMomentLabel(totalScope.bestDelta, { includeDelta: false })}`
    : '--';
  const biggestDropLabel = totalScope?.worstDelta
    ? `${formatRatingDelta(totalScope.worstDelta.delta)} | ${buildLeaderboardReportMomentLabel(totalScope.worstDelta, { includeDelta: false })}`
    : '--';
  const mostPlayedDeckLabel = mostPlayedDeck
    ? `${mostPlayedDeck.label} | ${mostPlayedDeck.row?.matches || 0} matches | ${formatLeaderboardRecord(mostPlayedDeck.row)} | ${formatWinRate(mostPlayedDeck.row?.winRate)} WR | ${formatRating(mostPlayedDeck.row?.rating)} Elo`
    : '--';
  const strongestDeckLabel = strongestDeck
    ? `${strongestDeck.label} | Peak ${Number.isFinite(strongestDeck.peakRating) ? formatRating(strongestDeck.peakRating) : '--'} | ${formatRating(strongestDeck.row?.rating)} current Elo`
    : '--';
  const summaryRows = [
    { label: 'Final Total Elo', value: formatRating(row.rating), valueColor: '#d4a657' },
    { label: 'Peak Elo', value: `${Number.isFinite(totalScope?.peakRating) ? formatRating(totalScope.peakRating) : '--'} | ${peakMomentLabel}` },
    { label: 'Record', value: `${formatLeaderboardRecord(row)} across ${row.matches || 0} rated matches` },
    { label: 'Win Rate', value: formatWinRate(row.winRate) },
    { label: 'Total Elo Change', value: `${totalDeltaLabel} from the starting ${DEFAULT_RANKINGS_OPTIONS.startingRating}` },
    { label: 'Tracked Decks', value: String(model.deckSummaries.length || totalScope?.uniqueDeckCount || 0) },
    { label: 'First Rated Match', value: firstMatchLabel },
    { label: 'Latest Rated Match', value: latestMatchLabel }
  ];
  const highlightRows = [
    { label: 'Best Single-Match Gain', value: bestGainLabel, valueColor: '#2f7d57' },
    { label: 'Biggest Single-Match Drop', value: biggestDropLabel, valueColor: '#a14848' },
    { label: 'Most Played Deck', value: mostPlayedDeckLabel },
    { label: 'Highest Peak Deck', value: strongestDeckLabel }
  ];
  const deckBreakdownRows = buildLeaderboardDeckBreakdownReportRows(row, model);
  const recentMatchCards = buildLeaderboardRecentHistoryReportCards(totalScope?.historyEntries || [], {
    ratingLabel: 'Total Elo',
    limit: 8
  });
  const deckSections = orderedDeckSummaries.flatMap(scope => {
    const deckChartSection = buildLeaderboardPdfChartSection(row, model, scope, {
      title: '',
      subtitle: '',
      note: '',
      hideHeading: true,
      compact: true,
      trailingSpacing: 4
    });
    const deckSummaryRows = buildLeaderboardDeckScopeSummaryRows(row, scope);
    const deckRecentMatchCards = buildLeaderboardRecentHistoryReportCards(scope?.historyEntries || [], {
      ratingLabel: 'Deck Elo',
      limit: 40,
      includeScopeNote: false
    });

    return [
      {
        type: 'keyValueTable',
        title: `${scope.label} Deck Summary`,
        subtitle: 'Deck-specific snapshot with the focused Elo trend on the same page',
        bookmarkTitle: scope.label,
        rows: deckSummaryRows,
        pageBreakBefore: true,
        compact: true,
        reserveBelow: 240,
        trailingSpacing: 6
      },
      deckChartSection,
      {
        type: 'cards',
        title: `${scope.label} Rated Matches`,
        subtitle: 'Most recent results with this deck, packed to a single page',
        bookmarkTitle: 'Rated Matches',
        bookmarkLevel: 1,
        items: deckRecentMatchCards,
        emptyText: `No rated match history is available for ${scope.label} in this report.`,
        pageBreakBefore: true,
        compact: true,
        singlePage: true
      }
    ];
  });

  downloadTextPdfReport(
    `${sanitizeCsvFilename(`elo-full-report-${row.displayName || row.playerKey || 'player'}-${entryLabel}`)}.pdf`,
    {
      title: `${row.displayName || row.playerKey || 'Player'} ${entryFieldLabel} Full Report`,
      subtitle: `${getLeaderboardViewTitle(currentLeaderboardDataset)} | ${entryFieldLabel}: ${entryLabel} | All Decks plus every tracked deck page`,
      summaryStats: [
        { label: 'Leaderboard Rank', value: rankedRow?.displayRank ? `#${rankedRow.displayRank}` : '--' },
        { label: 'Final Elo', value: formatRating(row.rating), valueColor: '#d4a657' },
        { label: 'Record', value: formatLeaderboardRecord(row) },
        { label: 'Win Rate', value: formatWinRate(row.winRate) }
      ],
      metadata: [
        { label: 'Player', value: row.displayName || row.playerKey || '--' },
        { label: entryFieldLabel, value: entryLabel },
        { label: 'Leaderboard Rank', value: rankedRow?.displayRank ? `#${rankedRow.displayRank}` : '--' },
        { label: 'Report Type', value: 'All Decks overview plus one page per tracked deck' },
        { label: 'Deck Sections', value: String(model.deckSummaries.length || 0) },
        { label: 'Window Type', value: getLeaderboardWindowModeLabel(currentLeaderboardDataset.period) },
        { label: 'Rating Continuity', value: getLeaderboardContinuityLabel(currentLeaderboardDataset) },
        { label: 'Leaderboard Window', value: getWindowLabel(currentLeaderboardDataset.period, currentLeaderboardDataset.summary.selectedYears, currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate) },
        { label: 'Date Range', value: formatWindowRange(currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate) },
        { label: 'Event Types', value: (currentLeaderboardDataset.eventTypes || []).join(', ') || DEFAULT_EVENT_TYPE },
        { label: 'Generated', value: new Date().toLocaleString() }
      ],
      sections: [
        {
          type: 'keyValueTable',
          title: 'All Decks Snapshot',
          subtitle: 'Core season metrics at a glance',
          rows: summaryRows
        },
        {
          type: 'keyValueTable',
          title: 'All Decks Highlights',
          subtitle: 'Big swings, best deck peaks, and standout moments',
          rows: highlightRows
        },
        buildLeaderboardPdfChartSection(row, model, totalScope, {
          title: 'All Decks Elo Trend',
          subtitle: 'Total Elo plus every tracked deck Elo trail'
        }),
        {
          type: 'table',
          title: 'Deck Breakdown',
          subtitle: 'How each tracked deck contributed to the player season/window',
          columns: [
            { key: 'deck', label: 'Deck', width: 2.3 },
            { key: 'elo', label: 'Elo', width: 0.9 },
            { key: 'peak', label: 'Peak', width: 0.9 },
            { key: 'matches', label: 'Matches', width: 1.0 },
            { key: 'record', label: 'Record', width: 1.1 },
            { key: 'winRate', label: 'WR', width: 0.9 },
            { key: 'share', label: 'Share', width: 1.0 }
          ],
          rows: deckBreakdownRows,
          note: deckBreakdownRows.length > 0
            ? `Deck share is based on the player's ${row.matches || 0} rated matches in this ${entryFieldLabel.toLowerCase()}.`
            : 'No deck-specific Elo trails were tracked for this leaderboard entry.',
          emptyText: 'No deck-specific Elo trails were tracked for this leaderboard entry.'
        },
        {
          type: 'cards',
          title: 'Recent Rated Matches (All Decks)',
          subtitle: 'Most recent results across the full season/window',
          items: recentMatchCards,
          emptyText: 'No rated match history is available for this report scope.'
        },
        ...deckSections
      ],
      footer: 'Generated from the current Pauper MTG Analytics Elo leaderboard drilldown as a full season/window report.'
    }
  );
}

function formatLeaderboardRecord(row = {}) {
  const wins = Number(row.wins) || 0;
  const losses = Number(row.losses) || 0;
  const draws = Number(row.draws) || 0;
  return draws > 0
    ? `${wins}-${losses}-${draws}`
    : `${wins}-${losses}`;
}

function buildLeaderboardPlayerDeckCardHtml(scope, {
  active = false,
  totalScope = false
} = {}) {
  const row = scope?.row || {};
  const cardTitle = totalScope ? 'Total Player Elo' : 'Deck Elo Trail';
  const cardName = totalScope ? getDeckDisplayName(LEADERBOARD_PLAYER_TOTAL_SCOPE) : scope?.label || 'Unknown Deck';
  const deckRank = totalScope ? null : getLeaderboardPlayerDeckRank(scope, currentLeaderboardDataset);

  return `
    <button
      type="button"
      class="leaderboard-deck-result-card${active ? ' active' : ''}${totalScope ? ' leaderboard-deck-result-card-total' : ''}"
      data-leaderboard-player-deck-filter="${escapeHtml(scope?.key || LEADERBOARD_PLAYER_TOTAL_SCOPE)}"
      aria-pressed="${active ? 'true' : 'false'}"
      title="${escapeHtml(`View ${cardName}`)}"
    >
      <div class="leaderboard-deck-result-header">
        <div class="leaderboard-deck-result-heading">
          <div class="player-rank-drilldown-event-date">${escapeHtml(cardTitle)}</div>
          <h4 class="leaderboard-deck-result-name">${escapeHtml(cardName)}</h4>
        </div>
        ${deckRank ? `
          <span class="player-rank-drilldown-rank-badge leaderboard-deck-result-badge leaderboard-deck-rank-badge">
            ${escapeHtml(`#${deckRank}`)}
            <span>Deck Rank</span>
          </span>
        ` : ''}
        <span class="player-rank-drilldown-rank-badge leaderboard-deck-result-badge">
          ${escapeHtml(formatRating(row.rating))}
          <span>Elo</span>
        </span>
      </div>
      <div class="leaderboard-deck-result-stats">
        ${buildSummaryItemHtml('Matches', String(row.matches || 0), { updated: active })}
        ${buildSummaryItemHtml('Record', formatLeaderboardRecord(row))}
        ${buildSummaryItemHtml('Win Rate', formatWinRate(row.winRate))}
        ${buildSummaryItemHtml('Peak Elo', Number.isFinite(scope?.peakRating) ? formatRating(scope.peakRating) : '--')}
      </div>
    </button>
  `;
}

function buildLeaderboardPlayerDeckOverviewHtml(model) {
  if (!model.deckSummaries.length) {
    return '';
  }

  return `
    <div class="player-rank-drilldown-context">
      <div class="player-rank-drilldown-context-header leaderboard-player-results-header">
        <div class="leaderboard-elo-ladder-disclaimer">
          ${escapeHtml('Total Elo rates player vs player. Deck Elo rates player-on-deck vs opponent-on-deck, so deck and total ratings can differ even when a player only has one tracked deck.')}
        </div>
        <div class="player-rank-drilldown-context-title">Deck Breakdown</div>
        <div class="leaderboard-table-search-status">
          ${escapeHtml(`Click a deck card to focus the chart and match summary. ${model.deckSummaries.length} tracked deck${model.deckSummaries.length === 1 ? '' : 's'} in this window.`)}
        </div>
      </div>
      <div class="leaderboard-deck-results-grid">
        ${buildLeaderboardPlayerDeckCardHtml(model.totalScope, {
          active: model.activeScopeKey === LEADERBOARD_PLAYER_TOTAL_SCOPE,
          totalScope: true
        })}
        ${model.deckSummaries.map(scope => buildLeaderboardPlayerDeckCardHtml(scope, {
          active: scope.key === model.activeScopeKey
        })).join('')}
      </div>
    </div>
  `;
}

function buildLeaderboardPlayerScopeSubtitle(row, model) {
  const activeScope = model.activeScope;
  if (activeScope.type === 'deck') {
    return `${activeScope.label} | ${formatRating(activeScope.row?.rating)} deck Elo | ${formatRating(row.rating)} total Elo | ${activeScope.row?.matches || 0} matches | ${formatWinRate(activeScope.row?.winRate)} WR | ${getLeaderboardEntryLabel(row)}`;
  }

  return `${formatRating(row.rating)} total Elo | ${row.matches} matches | ${formatWinRate(row.winRate)} WR | ${model.deckSummaries.length} tracked deck${model.deckSummaries.length === 1 ? '' : 's'} | ${getLeaderboardEntryLabel(row)}`;
}

function buildLeaderboardPlayerChartHelperText(model) {
  if (!model.deckSummaries.length) {
    return `Tracking the player's total Elo across ${model.totalScope.points.length} tracked event${model.totalScope.points.length === 1 ? '' : 's'}.`;
  }

  if (model.activeScope.type === 'deck') {
    return `Comparing ${model.activeScope.label} deck Elo against the player's total Elo and the other tracked decks across ${model.totalScope.points.length} tracked event${model.totalScope.points.length === 1 ? '' : 's'}.`;
  }

  return `Comparing total Elo with ${model.deckSummaries.length} deck trail${model.deckSummaries.length === 1 ? '' : 's'} across ${model.totalScope.points.length} tracked event${model.totalScope.points.length === 1 ? '' : 's'}.`;
}

function buildLeaderboardPlayerChartData(model) {
  // Builds chart labels/datasets for all-decks and per-deck Elo scopes.
  const timelineEntries = model.totalScope.points || [];
  const labels = timelineEntries.map(point => point.label);
  const timelineIndexByKey = new Map(timelineEntries.map(point => [[
    String(model.row?.seasonKey || '').trim(),
    String(point.date || '').trim(),
    String(point.eventId || '').trim(),
    String(point.event || '').trim()
  ].join('|||'), point.index]));
  const showAllDecks = model.activeScopeKey === LEADERBOARD_PLAYER_TOTAL_SCOPE;
  const totalColor = getLeaderboardTimelineColor(0);
  const datasets = timelineEntries.length > 0
    ? [{
        label: 'Total Elo',
        data: timelineEntries.map(point => point.ratingAfter),
        borderColor: withAlpha(totalColor, showAllDecks ? 'ff' : '9a'),
        backgroundColor: withAlpha(totalColor, showAllDecks ? '2b' : '14'),
        pointRadius: showAllDecks ? 3 : 2,
        pointHoverRadius: 5,
        borderWidth: showAllDecks ? 3 : 2.4,
        borderDash: showAllDecks ? [] : [7, 5],
        tension: 0.25,
        fill: false,
        spanGaps: true,
        tooltipLabelPrefix: 'Total Elo'
      }]
    : [];

  const orderedDeckSummaries = showAllDecks
    ? model.deckSummaries
    : [
        ...model.deckSummaries.filter(scope => scope.key === model.activeScopeKey),
        ...model.deckSummaries.filter(scope => scope.key !== model.activeScopeKey)
      ];

  orderedDeckSummaries.forEach(scope => {
    const isActiveDeck = scope.key === model.activeScopeKey;
    const originalDeckIndex = Math.max(0, model.deckSummaries.findIndex(item => item.key === scope.key));
    const color = getLeaderboardTimelineColor(originalDeckIndex + 1);
    const values = new Array(timelineEntries.length).fill(null);
    scope.points.forEach(point => {
      const timelineIndex = timelineIndexByKey.get([
        String(scope.row?.seasonKey || model.row?.seasonKey || '').trim(),
        String(point.date || '').trim(),
        String(point.eventId || '').trim(),
        String(point.event || '').trim()
      ].join('|||'));

      if (typeof timelineIndex === 'number') {
        values[timelineIndex] = point.ratingAfter;
      }
    });

    datasets.push({
      label: scope.label,
      data: values,
      borderColor: withAlpha(color, isActiveDeck || showAllDecks ? 'ff' : '80'),
      backgroundColor: withAlpha(color, isActiveDeck || showAllDecks ? '24' : '12'),
      pointRadius: isActiveDeck || showAllDecks ? 3 : 1.5,
      pointHoverRadius: 5,
      borderWidth: isActiveDeck || showAllDecks ? 2.8 : 2,
      borderDash: !showAllDecks && !isActiveDeck ? [7, 5] : [],
      tension: 0.25,
      fill: false,
      spanGaps: true,
      tooltipLabelPrefix: `${scope.label} Deck Elo`
    });
  });

  return {
    labels,
    datasets,
    timelineEntries
  };
}

function buildLeaderboardPlayerScopeSummaryItemsHtml(row, model) {
  const activeScope = model.activeScope;
  const activeRow = activeScope.row || row;
  const emptyLabel = '---';
  const deckScopeLabel = activeScope.type === 'deck' ? activeScope.label : emptyLabel;
  const deckCurrentEloLabel = activeScope.type === 'deck' && Number.isFinite(Number(activeRow.rating))
    ? formatRating(activeRow.rating)
    : emptyLabel;
  const deckPeakEloLabel = activeScope.type === 'deck' && Number.isFinite(activeScope.peakRating)
    ? formatRating(activeScope.peakRating)
    : emptyLabel;
  const deckMatchShare = activeScope.type === 'deck' && Number(row.matches) > 0
    ? `${(((Number(activeRow.matches) || 0) / Number(row.matches)) * 100).toFixed(1)}%`
    : emptyLabel;
  const firstMatchLabel = activeScope.firstMatch?.date ? formatDate(activeScope.firstMatch.date) : emptyLabel;
  const lastMatchLabel = activeScope.latestMatch?.date ? formatDate(activeScope.latestMatch.date) : emptyLabel;
  const bestGainLabel = activeScope.bestDelta
    ? `${formatRatingDelta(activeScope.bestDelta.delta)} vs ${activeScope.bestDelta.opponent || activeScope.bestDelta.opponentKey || 'Unknown Opponent'}`
    : emptyLabel;
  const biggestDropLabel = activeScope.worstDelta
    ? `${formatRatingDelta(activeScope.worstDelta.delta)} vs ${activeScope.worstDelta.opponent || activeScope.worstDelta.opponentKey || 'Unknown Opponent'}`
    : emptyLabel;

  return [
    buildSummaryItemHtml(getLeaderboardEntryFieldLabel(currentLeaderboardDataset), getLeaderboardEntryLabel(row), { updated: true }),
    buildSummaryItemHtml('Viewing Deck', deckScopeLabel, { updated: activeScope.type === 'deck' }),
    buildSummaryItemHtml('Total Elo', Number.isFinite(Number(row.rating)) ? formatRating(row.rating) : emptyLabel, { updated: true }),
    buildSummaryItemHtml('Deck Elo', deckCurrentEloLabel, { updated: activeScope.type === 'deck' }),
    buildSummaryItemHtml('Peak Elo', Number.isFinite(model.totalScope?.peakRating) ? formatRating(model.totalScope.peakRating) : emptyLabel),
    buildSummaryItemHtml('Peak Deck Elo', deckPeakEloLabel),
    buildSummaryItemHtml('Matches', String(activeRow.matches || 0), { updated: true }),
    buildSummaryItemHtml('Wins', String(activeRow.wins || 0)),
    buildSummaryItemHtml('Losses', String(activeRow.losses || 0)),
    buildSummaryItemHtml('Win Rate', formatWinRate(activeRow.winRate)),
    buildSummaryItemHtml('Deck Match Share', deckMatchShare),
    buildSummaryItemHtml('Tracked Decks', String(model.deckSummaries.length || model.totalScope?.uniqueDeckCount || 0)),
    buildSummaryItemHtml('First Match', firstMatchLabel),
    buildSummaryItemHtml('Last Match', lastMatchLabel),
    buildSummaryItemHtml('Best Gain', bestGainLabel, {
      hoverItems: buildLeaderboardMatchMomentHoverItems(activeScope.bestDelta),
      eventAnalysisEntry: activeScope.bestDelta
    }),
    buildSummaryItemHtml('Biggest Drop', biggestDropLabel, {
      hoverItems: buildLeaderboardMatchMomentHoverItems(activeScope.worstDelta),
      eventAnalysisEntry: activeScope.worstDelta
    }),
    buildLeaderboardPlayerSeasonEloSummaryItemsHtml(activeScope)
  ].filter(Boolean).join('');
}

function buildLeaderboardPlayerDetailHtml(row, model) {
  // Builds the full player drilldown body: deck scope cards, summary metrics,
  // chart container, and match history.
  const activeScope = model.activeScope;
  const ratingLabel = activeScope.type === 'deck' ? 'Deck Elo' : 'Total Elo';

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(getWindowLabel(currentLeaderboardDataset.period, currentLeaderboardDataset.summary.selectedYears, currentLeaderboardDataset.startDate, currentLeaderboardDataset.endDate))}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(row.displayName || row.playerKey || 'Unknown Player')}</h4>
        </div>
      </div>
      <div class="player-rank-drilldown-summary-grid leaderboard-player-summary-grid">
        ${buildLeaderboardPlayerScopeSummaryItemsHtml(row, model)}
      </div>
      ${buildLeaderboardPlayerDeckOverviewHtml(model)}
      ${buildLeaderboardPlayerEventChangeCardsHtml(activeScope)}
    </article>
    <div class="chart-container">
      <div class="leaderboard-chart-panel-header">
        <div>
          <div class="player-rank-drilldown-context-title">Elo Timeline</div>
          <div class="leaderboard-table-helper">${escapeHtml(buildLeaderboardPlayerChartHelperText(model))}</div>
        </div>
        <div class="leaderboard-chart-toolbar-actions">
          <button
            type="button"
            class="bubble-button leaderboard-timeline-visibility-button"
            id="leaderboardPlayerChartShowAllLinesButton"
            data-leaderboard-player-chart-lines="show"
          >
            Show All Lines
          </button>
          <button
            type="button"
            class="bubble-button leaderboard-timeline-visibility-button"
            id="leaderboardPlayerChartHideAllLinesButton"
            data-leaderboard-player-chart-lines="hide"
          >
            Hide All Lines
          </button>
        </div>
      </div>
      <canvas id="leaderboardPlayerEloChart"></canvas>
    </div>
    <div class="player-rank-drilldown-context">
      <div class="player-rank-drilldown-context-header leaderboard-player-results-header">
        <div class="player-rank-drilldown-context-title">${escapeHtml(`Full Rated Match History (for ${activeScope.type === 'deck' ? `${activeScope.label} Elo` : 'Total Elo'})`)}</div>
        <div class="leaderboard-table-search-status">${escapeHtml(`${activeScope.historyEntries.length} matchup${activeScope.historyEntries.length === 1 ? '' : 's'} in this ${activeScope.type === 'deck' ? `${activeScope.label} deck` : 'total'} scope`)}</div>
      </div>
      ${buildHistoryListHtml(activeScope.historyEntries, { ratingLabel })}
    </div>
  `;
}

function updateLeaderboardPlayerHistoryDownloadButton(playerKey = '', seasonKey = '', deckScopeKey = LEADERBOARD_PLAYER_TOTAL_SCOPE) {
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
  historyDownloadButton.dataset.leaderboardDownloadHistoryDeck = shouldShow ? normalizeLeaderboardDeckScopeKey(deckScopeKey) : LEADERBOARD_PLAYER_TOTAL_SCOPE;
}

function renderLeaderboardPlayerEloChart(model) {
  // Recreates the player drilldown chart after scope changes or theme refreshes.
  destroyLeaderboardPlayerEloChart();

  const canvas = document.getElementById('leaderboardPlayerEloChart');
  if (!canvas || !globalThis.Chart || !model) {
    updateLeaderboardPlayerChartVisibilityButtons();
    return;
  }

  const chartData = buildLeaderboardPlayerChartData(model);
  if (chartData.labels.length === 0 || chartData.datasets.length === 0) {
    updateLeaderboardPlayerChartVisibilityButtons();
    return;
  }

  leaderboardPlayerEloChart = createLeaderboardPlayerEloChart(canvas, {
    labels: chartData.labels,
    datasets: chartData.datasets,
    timelineEntries: chartData.timelineEntries,
    formatRating,
    showYearBoundaries: shouldShowLeaderboardYearBoundaryMarkers(),
    onLegendToggle() {
      updateLeaderboardPlayerChartVisibilityButtons();
    }
  });
  updateLeaderboardPlayerChartVisibilityButtons();
}

function renderLeaderboardPlayerDrilldown(playerKey = '', seasonKey = '') {
  // Rebuilds an open player drilldown from the current table rows.
  const elements = getLeaderboardDrilldownElements();
  const row = getLeaderboardRowByKeys(playerKey, seasonKey);
  if (!row || !elements.title || !elements.subtitle || !elements.content) {
    return false;
  }

  const model = getLeaderboardPlayerDrilldownModel(row);
  activeLeaderboardPlayerDeckScope = model.activeScopeKey;
  elements.title.textContent = row.displayName || row.playerKey || 'Elo Player';
  elements.subtitle.textContent = buildLeaderboardPlayerScopeSubtitle(row, model);
  elements.content.innerHTML = buildLeaderboardPlayerDetailHtml(row, model);
  renderLeaderboardPlayerEloChart(model);
  updateLeaderboardPlayerReportDownloadButton(row.playerKey, row.seasonKey, model.activeScopeKey);
  updateLeaderboardPlayerHistoryDownloadButton(row.playerKey, row.seasonKey, model.activeScopeKey);
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

function getLeaderboardChartVisibleDatasetCount(chart = null) {
  if (!chart?.data?.datasets?.length) {
    return 0;
  }

  return chart.data.datasets.reduce((count, _dataset, index) => {
    if (typeof chart.isDatasetVisible === 'function') {
      return count + (chart.isDatasetVisible(index) ? 1 : 0);
    }

    const datasetMeta = typeof chart.getDatasetMeta === 'function'
      ? chart.getDatasetMeta(index)
      : null;
    const isHidden = datasetMeta
      ? datasetMeta.hidden === true
      : Boolean(chart.data.datasets[index]?.hidden);
    return count + (isHidden ? 0 : 1);
  }, 0);
}

function setLeaderboardChartLineVisibility(chart = null, shouldShow = true, {
  fast = false
} = {}) {
  if (!chart?.data?.datasets?.length) {
    return false;
  }

  chart.data.datasets.forEach((_dataset, index) => {
    if (typeof chart.setDatasetVisibility === 'function') {
      chart.setDatasetVisibility(index, shouldShow);
      return;
    }

    const datasetMeta = typeof chart.getDatasetMeta === 'function'
      ? chart.getDatasetMeta(index)
      : null;
    if (datasetMeta) {
      datasetMeta.hidden = shouldShow ? null : true;
    } else if (chart.data.datasets[index]) {
      chart.data.datasets[index].hidden = !shouldShow;
    }
  });

  chart.update(fast ? 'none' : undefined);
  return true;
}

function updateLeaderboardTimelineVisibilityButtons() {
  const showAllButton = getLeaderboardTimelineShowAllLinesButton();
  const hideAllButton = getLeaderboardTimelineHideAllLinesButton();
  const datasetCount = leaderboardTimelineChart?.data?.datasets?.length || 0;
  const visibleCount = getLeaderboardChartVisibleDatasetCount(leaderboardTimelineChart);

  if (showAllButton) {
    showAllButton.disabled = datasetCount === 0 || visibleCount === datasetCount;
  }

  if (hideAllButton) {
    hideAllButton.disabled = datasetCount === 0 || visibleCount === 0;
  }
}

function setLeaderboardTimelineLineVisibility(shouldShow = true) {
  if (!setLeaderboardChartLineVisibility(leaderboardTimelineChart, shouldShow, { fast: true })) {
    updateLeaderboardTimelineVisibilityButtons();
    return;
  }
  updateLeaderboardTimelineVisibilityButtons();
}

function updateLeaderboardPlayerChartVisibilityButtons() {
  const showAllButton = getLeaderboardPlayerChartShowAllLinesButton();
  const hideAllButton = getLeaderboardPlayerChartHideAllLinesButton();
  const datasetCount = leaderboardPlayerEloChart?.data?.datasets?.length || 0;
  const visibleCount = getLeaderboardChartVisibleDatasetCount(leaderboardPlayerEloChart);

  if (showAllButton) {
    showAllButton.disabled = datasetCount === 0 || visibleCount === datasetCount;
  }

  if (hideAllButton) {
    hideAllButton.disabled = datasetCount === 0 || visibleCount === 0;
  }
}

function setLeaderboardPlayerChartLineVisibility(shouldShow = true) {
  if (!setLeaderboardChartLineVisibility(leaderboardPlayerEloChart, shouldShow, { fast: true })) {
    updateLeaderboardPlayerChartVisibilityButtons();
    return;
  }

  updateLeaderboardPlayerChartVisibilityButtons();
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
  // Rebuilds the multi-player timeline chart from selected/visible leaderboard
  // rows.
  destroyLeaderboardTimelineChart();
  updateLeaderboardTimelineVisibilityButtons();

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
    updateLeaderboardTimelineVisibilityButtons();
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
    updateLeaderboardTimelineVisibilityButtons();
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
    showYearBoundaries: shouldShowLeaderboardYearBoundaryMarkers(),
    onLegendToggle() {
      updateLeaderboardTimelineVisibilityButtons();
    }
  });
  updateLeaderboardTimelineVisibilityButtons();
}

function openLeaderboardPlayerDrilldown(playerKey = '', seasonKey = '') {
  const elements = getLeaderboardDrilldownElements();
  if (!elements.overlay) {
    return;
  }

  activeLeaderboardPlayerDeckScope = LEADERBOARD_PLAYER_TOTAL_SCOPE;
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
  updateLeaderboardDrilldownFullscreenButtonState();
}

function hasLeaderboardHoverContent(hoverItems = []) {
  return Array.isArray(hoverItems)
    ? hoverItems.some(Boolean)
    : Boolean(hoverItems);
}

function buildLeaderboardHoverNote(hoverItems = [], extraClasses = 'player-stat-card-hover-note') {
  const items = Array.isArray(hoverItems)
    ? hoverItems.filter(Boolean)
    : [String(hoverItems || '')].filter(Boolean);

  if (items.length === 0) {
    return '';
  }

  const noteClasses = ['player-rank-drilldown-hover-note', extraClasses]
    .filter(Boolean)
    .join(' ');

  return `
    <span class="${noteClasses}">
      ${items.length === 1
        ? `<span class="player-rank-drilldown-hover-note-text">${escapeHtml(String(items[0]))}</span>`
        : `
      <ul class="player-rank-drilldown-hover-note-list">
        ${items.map(item => `<li>${escapeHtml(String(item))}</li>`).join('')}
      </ul>`}
    </span>
  `;
}

function buildLeaderboardMatchMomentHoverItems(entry = {}) {
  if (!entry) {
    return [];
  }

  const eventLabel = formatEventName(entry.event) || entry.event || 'Unknown Event';
  const eventDateLabel = entry.date ? formatDate(entry.date) : 'Unknown Date';

  return [
    `Click to open ${eventDateLabel} ${eventLabel} in Event Analysis`
  ].filter(Boolean);
}

function buildSummaryItemHtml(label, value, {
  updated = false,
  hoverItems = [],
  eventAnalysisEntry = null
} = {}) {
  const hasHoverNote = hasLeaderboardHoverContent(hoverItems);
  const hasEventAnalysisAction = Boolean(eventAnalysisEntry?.event);
  const classes = [
    'player-rank-drilldown-summary-item',
    updated ? 'updated' : '',
    hasHoverNote ? 'drilldown-tooltip' : '',
    hasEventAnalysisAction ? 'drilldown-tooltip-actionable' : ''
  ].filter(Boolean).join(' ');
  const actionAttributes = hasEventAnalysisAction ? buildLeaderboardEventAnalysisDataAttributes(eventAnalysisEntry) : '';
  const isFocusable = hasHoverNote || hasEventAnalysisAction;

  return `
    <div class="${classes}"${isFocusable ? ' tabindex="0"' : ''}${hasEventAnalysisAction ? ' role="button"' : ''}${actionAttributes ? ` ${actionAttributes}` : ''}>
      <span class="player-rank-drilldown-summary-label">${escapeHtml(label)}</span>
      <span class="player-rank-drilldown-summary-value">${escapeHtml(value)}</span>
      ${buildLeaderboardHoverNote(hoverItems)}
    </div>
  `;
}

function buildStatCardHtml({ title, value, change, icon, hoverItems = [], eventAnalysisEntry = null }) {
  const hasHoverNote = hasLeaderboardHoverContent(hoverItems);
  const hasEventAnalysisAction = Boolean(eventAnalysisEntry?.event);
  const classes = [
    'stat-card',
    hasHoverNote ? 'drilldown-tooltip' : '',
    hasEventAnalysisAction ? 'drilldown-tooltip-actionable' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const actionAttributes = hasEventAnalysisAction ? buildLeaderboardEventAnalysisDataAttributes(eventAnalysisEntry) : '';
  const isFocusable = hasHoverNote || hasEventAnalysisAction;

  return `
    <div class="${classes}"${isFocusable ? ' tabindex="0"' : ''}${hasEventAnalysisAction ? ' role="button"' : ''}${actionAttributes ? ` ${actionAttributes}` : ''}>
      <div class="stat-title">${escapeHtml(title)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      ${change ? `<div class="stat-change">${escapeHtml(change)}</div>` : ''}
      ${icon ? `<div class="stat-icon">${escapeHtml(icon)}</div>` : ''}
      ${buildLeaderboardHoverNote(hoverItems)}
    </div>
  `;
}

function buildLeaderboardPlayerSeasonEloSummaryItemsHtml(scope) {
  if (currentLeaderboardDataset.resetByYear || currentLeaderboardDataset.period?.windowMode !== 'range') {
    return '';
  }

  const selectedYears = getLeaderboardSelectedYears(currentLeaderboardDataset);
  if (!selectedYears.length) {
    return '';
  }

  const historyEntries = Array.isArray(scope?.historyEntries) ? scope.historyEntries : [];
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
      `${formatRating(finalEntry.ratingAfter)} (${formatRatingDelta(yearGain)})`
    );
  }).filter(Boolean).join('');

  return yearItems ? yearItems : '';
}

function buildLeaderboardPlayerEventChangeCardsHtml(scope) {
  const historyEntries = (Array.isArray(scope?.historyEntries) ? scope.historyEntries : [])
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
    icon: '\u{1F680}',
    hoverItems: buildLeaderboardMatchMomentHoverItems(bestGain),
    eventAnalysisEntry: bestGain
  });

  const lossCard = buildStatCardHtml({
    title: 'Biggest Loss of Elo',
    value: biggestLoss ? formatRatingDelta(biggestLoss.delta) : '--',
    change: biggestLoss ? `${formatEventName(biggestLoss.event) || biggestLoss.event || 'Unknown Event'} on ${biggestLoss.date ? formatDate(biggestLoss.date) : 'Unknown Date'}` : '',
    icon: '\u{1F4C9}',
    hoverItems: buildLeaderboardMatchMomentHoverItems(biggestLoss),
    eventAnalysisEntry: biggestLoss
  });

  return `
    <div class="stats-container">
      <div class="player-stats-row player-stats-row-secondary">
        ${gainCard}${lossCard}
      </div>
    </div>
  `;
}

function buildHistoryListHtml(entries = [], {
  ratingLabel = 'Elo'
} = {}) {
  if (entries.length === 0) {
    return '<div class="player-rank-drilldown-empty">No rated match history found for this leaderboard entry.</div>';
  }

  return `
    <div class="player-event-history-list">
      ${entries.map(entry => {
        const resultLabel = formatResultLabel(entry.resultType);
        const resultTone = getHistoryResultTone(entry.resultType);
        const roundLabel = Number.isFinite(Number(entry.round)) ? `Round ${Number(entry.round)}` : 'Round --';
        const eventLabel = formatEventName(entry.event) || entry.event || 'Unknown Event';
        const matchupLabel = [
          `${resultLabel} with ${getLeaderboardDeckDisplayName(entry.deck)}`,
          `vs ${entry.opponent || entry.opponentKey || 'Unknown Opponent'}`,
          `on ${getLeaderboardDeckDisplayName(entry.opponentDeck)}`
        ].join(' ');
        const metaLabel = [
          matchupLabel,
          roundLabel,
          `${ratingLabel} ${formatRating(entry.ratingBefore)} -> ${formatRating(entry.ratingAfter)} (${formatRatingDelta(entry.delta)})`
        ].join(' | ');

        return `
          <div class="player-event-history-item leaderboard-history-item-static${resultTone ? ` player-event-history-item-${resultTone}` : ''}">
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
  // Rebuilds stat-card drilldowns such as rated matches, top Elo, and peak Elo.
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
    const visiblePlayerCount = new Set(
      items
        .map(row => String(row?.playerKey || '').trim())
        .filter(Boolean)
    ).size;
    const rowLabel = getLeaderboardRowCollectionLabel(items.length, currentLeaderboardDataset);
    elements.subtitle.textContent = items.length > 0
      ? `${visiblePlayerCount} tracked player${visiblePlayerCount === 1 ? '' : 's'} represented by ${rowLabel}`
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
  activeLeaderboardPlayerDeckScope = LEADERBOARD_PLAYER_TOTAL_SCOPE;
  renderLeaderboardDrilldown(categoryKey);
  updateLeaderboardPlayerReportDownloadButton();
  updateLeaderboardPlayerHistoryDownloadButton();
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
  updateLeaderboardDrilldownFullscreenButtonState();
}

async function toggleLeaderboardDrilldownFullscreen() {
  const { modal } = getLeaderboardDrilldownElements();
  if (!modal) {
    return;
  }

  if (document.fullscreenElement === modal) {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
    return;
  }

  if (modal.requestFullscreen) {
    await modal.requestFullscreen();
  }
}

function updateLeaderboardDrilldownFullscreenButtonState() {
  const { modal, fullscreenButton } = getLeaderboardDrilldownElements();
  if (!modal || !fullscreenButton) {
    return;
  }

  fullscreenButton.textContent = document.fullscreenElement === modal ? 'Exit Full Screen' : 'Full Screen';
}

async function closeLeaderboardDrilldown() {
  const { overlay, modal } = getLeaderboardDrilldownElements();
  if (!overlay) {
    return;
  }

  if (modal && document.fullscreenElement === modal && document.exitFullscreen) {
    await document.exitFullscreen();
  }

  destroyLeaderboardPlayerEloChart();
  overlay.hidden = true;
  activeLeaderboardDrilldownCategory = '';
  activeLeaderboardPlayerDrilldown = null;
  activeLeaderboardPlayerDeckScope = LEADERBOARD_PLAYER_TOTAL_SCOPE;
  updateLeaderboardPlayerReportDownloadButton();
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
  const {
    overlay,
    closeButton,
    content,
    fullscreenButton,
    reportDownloadButton,
    historyDownloadButton
  } = getLeaderboardDrilldownElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closeLeaderboardDrilldown);
  fullscreenButton?.addEventListener('click', () => {
    toggleLeaderboardDrilldownFullscreen().catch(error => {
      console.error('Failed to toggle leaderboard drilldown fullscreen mode.', error);
    });
  });
  reportDownloadButton?.addEventListener('click', event => {
    exportLeaderboardPlayerSeasonPdfReport(
      event.currentTarget.dataset.leaderboardDownloadReport,
      event.currentTarget.dataset.leaderboardDownloadReportSeason,
      event.currentTarget.dataset.leaderboardDownloadReportDeck
    );
  });
  historyDownloadButton?.addEventListener('click', event => {
    exportLeaderboardPlayerHistoryCsv(
      event.currentTarget.dataset.leaderboardDownloadHistory,
      event.currentTarget.dataset.leaderboardDownloadHistorySeason,
      event.currentTarget.dataset.leaderboardDownloadHistoryDeck
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
        downloadButton.dataset.leaderboardDownloadHistorySeason,
        downloadButton.dataset.leaderboardDownloadHistoryDeck
      );
      return;
    }

    const openEventAnalysisTrigger = event.target.closest('[data-leaderboard-open-event-analysis="true"]');
    if (openEventAnalysisTrigger) {
      openLeaderboardEventAnalysisShortcut({
        eventName: openEventAnalysisTrigger.dataset.leaderboardOpenEventName,
        eventDate: openEventAnalysisTrigger.dataset.leaderboardOpenEventDate,
        playerName: openEventAnalysisTrigger.dataset.leaderboardOpenEventPlayer
      }).catch(error => {
        console.error('Failed to open leaderboard event in Event Analysis.', error);
      });
      return;
    }

    const deckScopeButton = event.target.closest('[data-leaderboard-player-deck-filter]');
    if (deckScopeButton) {
      if (!activeLeaderboardPlayerDrilldown?.playerKey || !activeLeaderboardPlayerDrilldown?.seasonKey) {
        return;
      }

      activeLeaderboardPlayerDeckScope = normalizeLeaderboardDeckScopeKey(deckScopeButton.dataset.leaderboardPlayerDeckFilter);
      renderLeaderboardPlayerDrilldown(
        activeLeaderboardPlayerDrilldown.playerKey,
        activeLeaderboardPlayerDrilldown.seasonKey
      );
      return;
    }

    const playerChartLineVisibilityButton = event.target.closest('[data-leaderboard-player-chart-lines]');
    if (playerChartLineVisibilityButton) {
      setLeaderboardPlayerChartLineVisibility(
        playerChartLineVisibilityButton.dataset.leaderboardPlayerChartLines === 'show'
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

  content?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const openEventAnalysisTrigger = event.target.closest('[data-leaderboard-open-event-analysis="true"]');
    if (!openEventAnalysisTrigger) {
      return;
    }

    event.preventDefault();
    openLeaderboardEventAnalysisShortcut({
      eventName: openEventAnalysisTrigger.dataset.leaderboardOpenEventName,
      eventDate: openEventAnalysisTrigger.dataset.leaderboardOpenEventDate,
      playerName: openEventAnalysisTrigger.dataset.leaderboardOpenEventPlayer
    }).catch(error => {
      console.error('Failed to open leaderboard event in Event Analysis.', error);
    });
  });

  if (document.body.dataset.leaderboardDrilldownFullscreenBound !== 'true') {
    document.addEventListener('fullscreenchange', updateLeaderboardDrilldownFullscreenButtonState);
    document.body.dataset.leaderboardDrilldownFullscreenBound = 'true';
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      const { modal } = getLeaderboardDrilldownElements();
      if (modal && document.fullscreenElement === modal) {
        return;
      }

      closeLeaderboardDrilldown();
    }
  });

  updateLeaderboardDrilldownFullscreenButtonState();
  updateLeaderboardPlayerReportDownloadButton();
  updateLeaderboardPlayerHistoryDownloadButton();
}

function setupLeaderboardTableRowInteractions() {
  // Uses delegated row clicks/keyboard events so re-rendered table rows stay
  // interactive.
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
  // Fills the leaderboard stat cards from the current Elo dataset summary.
  if (dataset?.mode === 'performance') {
    const { summary } = dataset;
    const eventSummary = buildLeaderboardEventSummary(dataset);
    const topConversionRows = getRowsAtMaxValue(currentLeaderboardRows, 'top8Conversion')
      .filter(row => Number(row.eventCount) >= (Number(summary.minEvents) || 1));
    const mostTop8Rows = getRowsAtMaxValue(currentLeaderboardRows, 'top8Count')
      .filter(row => Number(row.top8Count) > 0);
    const mostActiveRows = getRowsAtMaxValue(currentLeaderboardRows, 'eventCount')
      .filter(row => Number(row.eventCount) > 0);
    const bestMatchWinRateRows = getRowsAtMaxValue(currentLeaderboardRows, 'winRate')
      .filter(row => Number.isFinite(Number(row.winRate)) && Number(row.matchCount) > 0);
    const selectedRangeLabel = getWindowLabel(dataset.period, dataset.summary.selectedYears, dataset.startDate, dataset.endDate) || '--';
    const selectedRangeDetails = formatWindowRange(dataset.startDate, dataset.endDate);
    const rowCollectionLabel = getLeaderboardRowCollectionLabel(summary.seasonEntries || 0, dataset);

    const setCardTitle = (cardId, title) => {
      const titleElement = document.getElementById(cardId)?.querySelector('.stat-title');
      if (titleElement) {
        titleElement.textContent = title;
      }
    };

    setCardTitle('leaderboardDateRangeCard', 'Selected Range');
    setCardTitle('leaderboardEventsCard', 'Events');
    setCardTitle('leaderboardRatedMatchesCard', 'Minimum Events');
    setCardTitle('leaderboardTrackedPlayersCard', 'Tracked Players');
    setCardTitle('leaderboardTopEloCard', 'Best Top 8 Conversion');
    setCardTitle('leaderboardPeakEloCard', 'Most Top 8s');
    setCardTitle('leaderboardMostActiveCard', 'Most Active');
    setCardTitle('leaderboardBiggestSwingCard', 'Best Match Win Rate');

    updateElementText('leaderboardDateRangeValue', selectedRangeLabel);
    updateElementText('leaderboardDateRangeDetails', selectedRangeDetails || 'Choose a leaderboard window');
    updateElementText('leaderboardEventsValue', String(eventSummary.total || 0));
    updateElementText('leaderboardEventsBreakdown', eventSummary.breakdown);
    updateElementText('leaderboardRatedMatches', String(summary.minEvents || 0));
    updateElementText(
      'leaderboardRatedMatchesDetails',
      `${summary.totalEvents || 0} unique event${summary.totalEvents === 1 ? '' : 's'} in the selected window`
    );
    updateElementText('leaderboardTrackedPlayers', String(summary.uniquePlayers || 0));
    updateElementText(
      'leaderboardTrackedPlayersDetails',
      `${rowCollectionLabel} / ${summary.playerAppearances || 0} player appearance${summary.playerAppearances === 1 ? '' : 's'}`
    );
    updateElementText(
      'leaderboardTopEloName',
      topConversionRows.length > 1 ? `${topConversionRows.length} Players Tied` : (summary.leader?.displayName || '--')
    );
    updateElementText(
      'leaderboardTopEloDetails',
      topConversionRows.length > 1
        ? `${formatWinRate(topConversionRows[0]?.top8Conversion)} / ${formatNameList(topConversionRows.map(row => row.displayName))}`
        : (
          summary.leader
            ? `${formatWinRate(summary.leader.top8Conversion)} / ${summary.leader.top8Count} Top 8s in ${summary.leader.eventCount} events`
            : 'No qualified leader yet'
        )
    );
    updateElementText(
      'leaderboardPeakEloName',
      mostTop8Rows.length > 1 ? `${mostTop8Rows.length} Players Tied` : (mostTop8Rows[0]?.displayName || '--')
    );
    updateElementText(
      'leaderboardPeakEloDetails',
      mostTop8Rows.length > 1
        ? `${mostTop8Rows[0]?.top8Count || 0} Top 8s / ${formatNameList(mostTop8Rows.map(row => row.displayName))}`
        : (
          mostTop8Rows[0]
            ? `${mostTop8Rows[0].top8Count} Top 8s / ${formatWinRate(mostTop8Rows[0].top8Conversion)} conversion`
            : 'No Top 8 finishes yet'
        )
    );
    updateElementText(
      'leaderboardMostActiveName',
      mostActiveRows.length > 1 ? `${mostActiveRows.length} Players Tied` : (summary.mostActiveSeason?.displayName || '--')
    );
    updateElementText(
      'leaderboardMostActiveDetails',
      mostActiveRows.length > 1
        ? `${mostActiveRows[0]?.eventCount || 0} events each / ${formatNameList(mostActiveRows.map(row => row.displayName))}`
        : (
          summary.mostActiveSeason
            ? `${summary.mostActiveSeason.eventCount} events / ${summary.mostActiveSeason.matchCount} matches / ${formatWinRate(summary.mostActiveSeason.top8Conversion)} Top 8 conversion`
            : 'No active player yet'
        )
    );
    updateElementText(
      'leaderboardBiggestSwingName',
      bestMatchWinRateRows.length > 1 ? `${bestMatchWinRateRows.length} Players Tied` : (summary.bestMatchWinRate?.displayName || '--')
    );
    updateElementText(
      'leaderboardBiggestSwingDetails',
      bestMatchWinRateRows.length > 1
        ? `${formatWinRate(bestMatchWinRateRows[0]?.winRate)} WR / ${formatNameList(bestMatchWinRateRows.map(row => row.displayName))}`
        : (
          summary.bestMatchWinRate
            ? `${formatWinRate(summary.bestMatchWinRate.winRate)} WR / ${summary.bestMatchWinRate.wins}-${summary.bestMatchWinRate.losses} / ${summary.bestMatchWinRate.eventCount} events`
            : 'No recorded matches yet'
        )
    );

    LEADERBOARD_STAT_CARD_IDS.forEach(triggerUpdateAnimation);
    return;
  }

  const { summary } = dataset;
  const eventSummary = buildLeaderboardEventSummary(dataset);
  const topEloRows = getRowsAtMaxValue(currentLeaderboardRows, 'rating').filter(row => Number.isFinite(Number(row.rating)));
  const mostActiveRows = getRowsAtMaxValue(currentLeaderboardRows, 'matches').filter(row => Number(row.matches) > 0);
  const topEloNames = topEloRows.map(row => row.displayName).filter(Boolean);
  const peakEloEntries = getPeakEloEntries();
  const biggestGainEntries = getBiggestGainEntries();
  const biggestLossEntries = getBiggestLossEntries();
  const topRating = topEloRows[0]?.rating;
  const peakRating = peakEloEntries[0]?.ratingAfter;
  const topMatchCount = mostActiveRows[0]?.matches || 0;
  const visiblePlayerCount = new Set(
    currentLeaderboardRows
      .map(row => String(row?.playerKey || '').trim())
      .filter(Boolean)
  ).size;
  const totalPlayerCount = new Set(
    currentLeaderboardBaseRows
      .map(row => String(row?.playerKey || '').trim())
      .filter(Boolean)
  ).size;
  const visibleRowCount = currentLeaderboardRows.length;
  const totalRowCount = currentLeaderboardBaseRows.length;
  const rowCollectionLabel = getLeaderboardRowCollectionLabel(visibleRowCount, dataset);
  const totalRowCollectionLabel = getLeaderboardRowCollectionLabel(totalRowCount, dataset);
  const selectedPairingsLabel = summary.selectedMatches > 0
    ? `${summary.selectedMatches} selected pairings${summary.skippedMatches > 0 ? ` / ${summary.skippedMatches} skipped due to byes or unknown results` : ''}`
    : 'No selected pairings';
  const selectedRangeLabel = getWindowLabel(dataset.period, dataset.summary.selectedYears, dataset.startDate, dataset.endDate) || '--';
  const selectedRangeDetails = formatWindowRange(dataset.startDate, dataset.endDate);

  const setCardTitle = (cardId, title) => {
    const titleElement = document.getElementById(cardId)?.querySelector('.stat-title');
    if (titleElement) {
      titleElement.textContent = title;
    }
  };

  setCardTitle('leaderboardDateRangeCard', 'Selected Range');
  setCardTitle('leaderboardEventsCard', 'Events');
  setCardTitle('leaderboardRatedMatchesCard', 'Rated Matches');
  setCardTitle('leaderboardTrackedPlayersCard', 'Tracked Players');
  setCardTitle('leaderboardTopEloCard', 'Current Top Elo');
  setCardTitle('leaderboardPeakEloCard', 'Peak Elo');
  setCardTitle('leaderboardMostActiveCard', 'Most Active');
  setCardTitle('leaderboardBiggestSwingCard', 'Biggest Elo Gain / Loss');

  updateElementText('leaderboardDateRangeValue', selectedRangeLabel);
  updateElementText('leaderboardDateRangeDetails', selectedRangeDetails || 'Choose a leaderboard window');
  updateElementText('leaderboardEventsValue', String(eventSummary.total || 0));
  updateElementText('leaderboardEventsBreakdown', eventSummary.breakdown);
  updateElementText('leaderboardRatedMatches', String(summary.ratedMatches || 0));
  updateElementText('leaderboardRatedMatchesDetails', selectedPairingsLabel);
  updateElementText('leaderboardTrackedPlayers', String(visiblePlayerCount || 0));
  updateElementText(
    'leaderboardTrackedPlayersDetails',
    hasActiveLeaderboardEloThresholds()
      ? `${rowCollectionLabel} visible / ${totalRowCollectionLabel} total / ${totalPlayerCount} total player${totalPlayerCount === 1 ? '' : 's'}`
      : rowCollectionLabel
  );
  updateElementText(
    'leaderboardTopEloName',
    topEloRows.length > 1 ? `${topEloRows.length} Players Tied` : (topEloRows[0]?.displayName || '--')
  );
  updateElementText(
    'leaderboardTopEloDetails',
    topEloRows.length > 1
      ? `${formatRating(topRating)} Elo / ${formatNameList(topEloNames)}`
      : (
        topEloRows[0]
          ? `${formatRating(topEloRows[0].rating)} Elo / ${topEloRows[0].matches} matches / ${getLeaderboardEntryLabel(topEloRows[0])}`
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
    mostActiveRows.length > 1 ? `${mostActiveRows.length} Players Tied` : (mostActiveRows[0]?.displayName || '--')
  );
  updateElementText(
    'leaderboardMostActiveDetails',
    mostActiveRows.length > 1
      ? `${topMatchCount} matches each / ${formatNameList(mostActiveRows.map(row => `${row.displayName} (${formatRating(row.rating)} Elo)`))}`
      : (
        mostActiveRows[0]
          ? `${mostActiveRows[0].matches} matches / ${formatRating(mostActiveRows[0].rating)} Elo / ${formatWinRate(mostActiveRows[0].winRate)} WR / ${getLeaderboardEntryLabel(mostActiveRows[0])}`
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

function getLeaderboardRankMedal(rank) {
  switch (rank) {
    case 1:
      return '🥇';
    case 2:
      return '🥈';
    case 3:
      return '🥉';
    default:
      return '';
  }
}

function renderLeaderboardTable(dataset) {
  // Renders sorted leaderboard rows and keeps search/export/fullscreen controls in
  // sync with the current row set.
  ensureLeaderboardSortState(dataset);
  const rowsWithRank = getSortedLeaderboardRowsWithRank();
  const entryFieldLabel = getLeaderboardEntryFieldLabel(dataset);

  if (dataset?.mode === 'performance') {
    updateElementText('leaderboardTableTitle', getLeaderboardViewTitle(dataset));
    renderLeaderboardTitleBadgeRow(dataset);
    updateElementText('leaderboardTableHelper', buildLeaderboardTableHelperText(dataset));
    updateElementHTML('leaderboardTableClickHint', buildLeaderboardTableClickHintHtml(dataset));
    updateElementHTML(
      'leaderboardTableHead',
      `
        <tr>
          <th>Rank</th>
          <th data-sort="displayName">Player <span class="sort-arrow"></span></th>
          <th data-sort="seasonYear"><span id="leaderboardEntryColumnLabel">${escapeHtml(entryFieldLabel)}</span> <span class="sort-arrow"></span></th>
          <th data-sort="top8Conversion">Top 8 Conv <span class="sort-arrow"></span></th>
          <th data-sort="top8Count">Top 8s <span class="sort-arrow"></span></th>
          <th data-sort="eventCount">Events <span class="sort-arrow"></span></th>
          <th data-sort="matchCount">Matches <span class="sort-arrow"></span></th>
          <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
          <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
          <th data-sort="winRate">Match WR <span class="sort-arrow"></span></th>
          <th data-sort="lastActiveDate">Last Event <span class="sort-arrow"></span></th>
        </tr>
      `
    );
    updateElementHTML(
      'leaderboardTableBody',
      rowsWithRank.length === 0
        ? '<tr><td colspan="11">No Performance leaderboard rows are available for the selected filters.</td></tr>'
        : rowsWithRank.map(row => {
          const rankValue = Number(row.displayRank);
          const rankMedal = getLeaderboardRankMedal(rankValue);
          return `
          <tr
            data-leaderboard-player-name="${escapeHtml(normalizeLeaderboardSearchText(row.displayName))}"
          >
            <td class="leaderboard-rank-cell">${rankMedal ? `<span class="leaderboard-rank-medal" aria-hidden="true">${rankMedal}</span> ${rankValue}` : rankValue}</td>
            <td>${escapeHtml(row.displayName)}</td>
            <td>${escapeHtml(getLeaderboardEntryLabel(row))}</td>
            <td>${formatWinRate(row.top8Conversion)}</td>
            <td>${row.top8Count}</td>
            <td>${row.eventCount}</td>
            <td>${row.matchCount}</td>
            <td>${row.wins}</td>
            <td>${row.losses}</td>
            <td>${formatWinRate(row.winRate)}</td>
            <td>${row.lastActiveDate ? escapeHtml(formatDate(row.lastActiveDate)) : '--'}</td>
          </tr>
        `;
        }).join('')
    );
    applyLeaderboardTableSortHeaderState();
    return;
  }

  const yearGainColumns = getLeaderboardSelectedYearGainColumns(dataset);
  const yearGainHeaderCells = yearGainColumns.map(year => `<th>${escapeHtml(`${year} Elo Gains`)}</th>`).join('');
  const totalColumns = 12 + yearGainColumns.length;

  updateElementText('leaderboardTableTitle', getLeaderboardViewTitle(dataset));
  renderLeaderboardTitleBadgeRow(dataset);
  updateElementHTML('leaderboardTableHelper', buildLeaderboardTableHelperHtml(dataset));
  updateElementHTML('leaderboardTableClickHint', buildLeaderboardTableClickHintHtml(dataset));
  updateElementHTML(
    'leaderboardTableHead',
    `
      <tr>
        <th>Rank</th>
        <th data-sort="displayName">Player <span class="sort-arrow"></span></th>
        <th data-sort="seasonYear"><span id="leaderboardEntryColumnLabel">${escapeHtml(entryFieldLabel)}</span> <span class="sort-arrow"></span></th>
        <th data-sort="rating">Elo <span class="sort-arrow"></span></th>
        ${yearGainHeaderCells}
        <th data-sort="eventCount">Events <span class="sort-arrow"></span></th>
        <th data-sort="matches">Matches <span class="sort-arrow"></span></th>
        <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
        <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
        <th data-sort="winRate">Win Rate <span class="sort-arrow"></span></th>
        <th data-sort="top8Conversion">Top 8 Conv <span class="sort-arrow"></span></th>
        <th data-sort="challengeWins">1st Places <span class="sort-arrow"></span></th>
        <th data-sort="lastActiveDate">Last Match <span class="sort-arrow"></span></th>
      </tr>
    `
  );
  updateElementHTML(
    'leaderboardTableBody',
    rowsWithRank.length === 0
      ? `<tr><td colspan="${totalColumns}">${
        hasActiveLeaderboardEloThresholds() && currentLeaderboardBaseRows.length > 0
          ? 'No Elo leaderboard rows met the current minimum filters.'
          : 'No Elo leaderboard rows are available for the selected filters.'
      }</td></tr>`
      : rowsWithRank.map(row => {
          const rankValue = Number(row.displayRank);
          const rankMedal = getLeaderboardRankMedal(rankValue);
          return `
        <tr
          class="leaderboard-player-row"
          data-leaderboard-player-name="${escapeHtml(normalizeLeaderboardSearchText(row.displayName))}"
          data-leaderboard-player-key="${escapeHtml(row.playerKey || '')}"
          data-leaderboard-season-key="${escapeHtml(row.seasonKey || '')}"
          tabindex="0"
          role="button"
          aria-label="${escapeHtml(`Open Elo details for ${row.displayName || row.playerKey || 'player'} in ${getLeaderboardEntryLabel(row)}`)}"
        >
          <td class="leaderboard-rank-cell">${rankMedal ? `<span class="leaderboard-rank-medal" aria-hidden="true">${rankMedal}</span> ${rankValue}` : rankValue}</td>
          <td>${escapeHtml(row.displayName)}</td>
          <td>${escapeHtml(getLeaderboardEntryLabel(row))}</td>
          <td>${formatRating(row.rating)}</td>
          ${yearGainColumns.map(year => `<td>${escapeHtml(getLeaderboardRowYearGainValue(row, year))}</td>`).join('')}
          <td>${row.eventCount}</td>
          <td>${row.matches}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${formatWinRate(row.winRate)}</td>
          <td>${formatWinRate(row.top8Conversion)}</td>
          <td>${row.challengeWins}</td>
          <td>${row.lastActiveDate ? escapeHtml(formatDate(row.lastActiveDate)) : '--'}</td>
        </tr>
      `;
        }).join('')
  );
  applyLeaderboardTableSortHeaderState();
}

function syncLeaderboardFullscreenLayout() {
  const container = getLeaderboardTableContainer();
  const toolbar = getLeaderboardTableToolbar();
  const thresholdSection = getLeaderboardEloThresholdControlsSection();
  const thresholdAnchor = getLeaderboardEloThresholdControlsAnchor();

  if (!container || !toolbar || !thresholdSection || !thresholdAnchor) {
    return;
  }

  const fullscreenActive = document.fullscreenElement === container && !thresholdSection.classList.contains('hidden');
  if (fullscreenActive) {
    if (thresholdSection.parentElement !== container) {
      container.insertBefore(thresholdSection, toolbar);
    }
    thresholdSection.classList.add('leaderboard-elo-threshold-fullscreen');
    return;
  }

  if (thresholdSection.parentElement !== thresholdAnchor.parentElement) {
    thresholdAnchor.parentElement.insertBefore(thresholdSection, thresholdAnchor);
  }
  thresholdSection.classList.remove('leaderboard-elo-threshold-fullscreen');
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
  syncLeaderboardFullscreenLayout();
  renderLeaderboardFullscreenFilterBadges(currentLeaderboardDataset?.period || ensureActiveLeaderboardWindow().activeWindow);
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
  const showAllLinesButton = getLeaderboardTimelineShowAllLinesButton();
  const hideAllLinesButton = getLeaderboardTimelineHideAllLinesButton();

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

  if (showAllLinesButton && showAllLinesButton.dataset.listenerAdded !== 'true') {
    showAllLinesButton.addEventListener('click', () => {
      setLeaderboardTimelineLineVisibility(true);
    });
    showAllLinesButton.dataset.listenerAdded = 'true';
  }

  if (hideAllLinesButton && hideAllLinesButton.dataset.listenerAdded !== 'true') {
    hideAllLinesButton.addEventListener('click', () => {
      setLeaderboardTimelineLineVisibility(false);
    });
    hideAllLinesButton.dataset.listenerAdded = 'true';
  }

  updateLeaderboardTimelineVisibilityButtons();
}

function setupLeaderboardFilterListeners() {
  // Wires event type, window mode, range/reset, and threshold controls.
  const eventTypeButtons = getLeaderboardEventTypeButtons();
  const windowModeButtons = getLeaderboardWindowModeButtons();
  const seasonYearRoot = getLeaderboardSeasonYearRoot();
  const rangeStartYearRoot = document.getElementById('leaderboardRangeStartYearButtons');
  const rangeEndYearRoot = document.getElementById('leaderboardRangeEndYearButtons');
  const resetModeButtons = getLeaderboardResetModeButtons();
  const eloThresholdControls = getLeaderboardEloThresholdControls();
  const eloThresholdResetButton = getLeaderboardEloThresholdResetButton();

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

  Object.entries(eloThresholdControls).forEach(([key, control]) => {
    const applyThreshold = value => {
      setLeaderboardEloThreshold(key, value);
      renderLeaderboardEloThresholdControls();

      if (getTopMode() === 'leaderboard' && currentLeaderboardDataset?.mode === 'elo') {
        renderLeaderboardFromCurrentState();
      }
    };

    if (Array.isArray(control.quickButtons)) {
      control.quickButtons.forEach(button => {
        if (button.dataset.listenerAdded === 'true') {
          return;
        }

        button.addEventListener('click', () => {
          const topPercent = Number(button.dataset.leaderboardThresholdTopPercent || 0);
          const quickValue = getLeaderboardEloThresholdQuickViewValue(key, topPercent);
          const activeValue = getActiveLeaderboardEloThresholds()[key] ?? 0;
          applyThreshold(areLeaderboardThresholdValuesEqual(key, quickValue, activeValue) ? 0 : quickValue);
        });

        button.dataset.listenerAdded = 'true';
      });
    }

    if (control.slider && control.slider.dataset.listenerAdded !== 'true') {
      control.slider.addEventListener('input', () => {
        applyThreshold(control.slider.value);
      });
      control.slider.dataset.listenerAdded = 'true';
    }

    if (!control.input || control.input.dataset.listenerAdded === 'true') {
      return;
    }

    control.input.addEventListener('change', () => {
      applyThreshold(control.input.value);
    });

    control.input.addEventListener('blur', () => {
      applyThreshold(control.input.value);
    });

    control.input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      control.input.blur();
    });

    control.input.dataset.listenerAdded = 'true';
  });

  if (eloThresholdResetButton && eloThresholdResetButton.dataset.listenerAdded !== 'true') {
    eloThresholdResetButton.addEventListener('click', () => {
      resetLeaderboardEloThresholds();
      renderLeaderboardEloThresholdControls();

      if (getTopMode() === 'leaderboard' && currentLeaderboardDataset?.mode === 'elo') {
        renderLeaderboardFromCurrentState();
      }
    });

    eloThresholdResetButton.dataset.listenerAdded = 'true';
  }
}

// ─── Deck Selector ─────────────────────────────────────────────────────────
// Modal-based deck selection for the Elo leaderboard.

function getLeaderboardDeckSelectButton() {
  return document.getElementById('leaderboardDeckSelectButton');
}

function getLeaderboardDeckResetButton() {
  return document.getElementById('leaderboardDeckResetButton');
}

function getLeaderboardDeckModalBackdrop() {
  return document.getElementById('leaderboardDeckModalBackdrop');
}

function getLeaderboardDeckModalSearchInput() {
  return document.getElementById('leaderboardDeckModalSearchInput');
}

function getLeaderboardDeckModalList() {
  return document.getElementById('leaderboardDeckModalList');
}

function getDeckDisplayName(deckName) {
  return deckName === LEADERBOARD_PLAYER_TOTAL_SCOPE ? 'All Decks (Overall)' : String(deckName || '').trim();
}

function getAllDeckNamesFromDataset(dataset = currentLeaderboardDataset) {
  const rows = Array.isArray(dataset?.deckDataset?.seasonRows) ? dataset.deckDataset.seasonRows : [];
  return [...new Set(rows.map(row => String(row?.deck || '').trim()).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
}

function buildDeckViewRows(selectedDeckName = '', dataset = currentLeaderboardDataset) {
  const normalizedDeckName = String(selectedDeckName || '').trim();
  if (!normalizedDeckName || normalizedDeckName === LEADERBOARD_PLAYER_TOTAL_SCOPE) {
    return [];
  }

  const deckRows = (Array.isArray(dataset?.deckDataset?.seasonRows) ? dataset.deckDataset.seasonRows : [])
    .filter(row => String(row?.deck || '').trim() === normalizedDeckName);

  return augmentEloLeaderboardRowsWithEventStats(deckRows, dataset);
}

function getLeaderboardPlayerDeckRank(scope = {}, dataset = currentLeaderboardDataset) {
  if (!scope || scope.type !== 'deck' || !scope.label) {
    return null;
  }

  const deckRows = applyLeaderboardRowFilters(buildDeckViewRows(scope.label, dataset), dataset);
  if (!deckRows.length) {
    return null;
  }

  const sortedDeckRows = [...deckRows].sort(compareEloLeaderboardRows);
  const normalizedKey = String(scope.key || '').trim();
  const rankIndex = sortedDeckRows.findIndex(row => String(row.playerKey || '').trim() === normalizedKey);

  return rankIndex >= 0 ? rankIndex + 1 : null;
}

function renderLeaderboardDeckButton() {
  const button = getLeaderboardDeckSelectButton();
  const resetButton = getLeaderboardDeckResetButton();
  if (!button) {
    return;
  }

  button.textContent = `Deck: ${getDeckDisplayName(selectedDeck)}`;

  if (resetButton) {
    const isTotalScope = selectedDeck === LEADERBOARD_PLAYER_TOTAL_SCOPE;
    resetButton.hidden = isTotalScope;
    resetButton.disabled = isTotalScope;
  }
}

function renderLeaderboardDeckModal(dataset = currentLeaderboardDataset) {
  const backdrop = getLeaderboardDeckModalBackdrop();
  const list = getLeaderboardDeckModalList();
  const input = getLeaderboardDeckModalSearchInput();

  if (!backdrop || !list || !input) {
    return;
  }

  const filterTerm = String(input.value || '').trim().toLowerCase();
  const allDecks = getAllDeckNamesFromDataset(dataset);
  const options = [LEADERBOARD_PLAYER_TOTAL_SCOPE, ...allDecks];

  const filteredDecks = options.filter(deckKey => {
    if (deckKey === LEADERBOARD_PLAYER_TOTAL_SCOPE) {
      return true;
    }
    return String(deckKey).toLowerCase().includes(filterTerm);
  });

  list.innerHTML = filteredDecks.length > 0
    ? filteredDecks.map(deckKey => {
      const label = getDeckDisplayName(deckKey);
      const isActive = deckKey === selectedDeck;
      return `
        <button
          type="button"
          class="deck-selector-item${isActive ? ' active' : ''}"
          data-deck-name="${escapeHtml(deckKey)}"
        >
          ${escapeHtml(label)}
        </button>
      `;
    }).join('')
    : '<div class="deck-selector-empty">No decks matched the filter.</div>';
}

function openLeaderboardDeckModal() {
  const backdrop = getLeaderboardDeckModalBackdrop();
  const input = getLeaderboardDeckModalSearchInput();

  if (!backdrop || !input) {
    return;
  }

  backdrop.hidden = false;
  input.value = '';
  input.focus();
  renderLeaderboardDeckModal(currentLeaderboardDataset);
  document.body.style.overflow = 'hidden';
}

function closeLeaderboardDeckModal() {
  const backdrop = getLeaderboardDeckModalBackdrop();

  if (!backdrop) {
    return;
  }

  backdrop.hidden = true;
  document.body.style.overflow = '';
}

function selectLeaderboardDeck(deckName = '') {
  selectedDeck = deckName || LEADERBOARD_PLAYER_TOTAL_SCOPE;
  renderLeaderboardDeckButton();
  closeLeaderboardDeckModal();
  renderLeaderboardFromCurrentState();
}

function setupLeaderboardDeckSelector() {
  const button = getLeaderboardDeckSelectButton();
  const backdrop = getLeaderboardDeckModalBackdrop();
  const closeButton = document.getElementById('leaderboardDeckModalClose');
  const searchInput = getLeaderboardDeckModalSearchInput();
  const deckList = getLeaderboardDeckModalList();

  if (button && button.dataset.listenerAdded !== 'true') {
    button.addEventListener('click', openLeaderboardDeckModal);
    button.dataset.listenerAdded = 'true';
  }

  const resetButton = getLeaderboardDeckResetButton();
  if (resetButton && resetButton.dataset.listenerAdded !== 'true') {
    resetButton.addEventListener('click', event => {
      event.stopPropagation();
      selectLeaderboardDeck(LEADERBOARD_PLAYER_TOTAL_SCOPE);
    });
    resetButton.dataset.listenerAdded = 'true';
  }

  if (backdrop && backdrop.dataset.listenerAdded !== 'true') {
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) {
        closeLeaderboardDeckModal();
      }
    });
    backdrop.dataset.listenerAdded = 'true';
  }

  if (closeButton && closeButton.dataset.listenerAdded !== 'true') {
    closeButton.addEventListener('click', closeLeaderboardDeckModal);
    closeButton.dataset.listenerAdded = 'true';
  }

  if (searchInput && searchInput.dataset.listenerAdded !== 'true') {
    searchInput.addEventListener('input', () => renderLeaderboardDeckModal(currentLeaderboardDataset));
    searchInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLeaderboardDeckModal();
      }
    });
    searchInput.dataset.listenerAdded = 'true';
  }

  if (deckList && deckList.dataset.listenerAdded !== 'true') {
    deckList.addEventListener('click', event => {
      const option = event.target.closest('[data-deck-name]');
      if (!option) {
        return;
      }
      selectLeaderboardDeck(option.dataset.deckName || '');
    });
    deckList.dataset.listenerAdded = 'true';
  }

  if (document.body.dataset.deckModalKeyBound !== 'true') {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        const backdropElement = getLeaderboardDeckModalBackdrop();
        if (backdropElement && !backdropElement.hidden) {
          closeLeaderboardDeckModal();
        }
      }
    });
    document.body.dataset.deckModalKeyBound = 'true';
  }
}


// ─── End Deck Selector ───────────────────────────────────────────────────────

// Wires Leaderboard controls, table actions, drilldowns, and timeline
// interactions.
export function initLeaderboards() {
  setLeaderboardEventType(DEFAULT_EVENT_TYPE);
  renderLeaderboardWindowControls();
  setupLeaderboardTableSorting();
  setupLeaderboardTableRowInteractions();
  setupLeaderboardTableActions();
  setupLeaderboardTimelineInteractions();
  setupLeaderboardFilterListeners();
  setupLeaderboardDrilldownModal();
  setupLeaderboardDrilldownCards();
  setupLeaderboardDeckSelector();
}

// Builds the active Elo dataset and refreshes every Leaderboards surface.
export async function updateLeaderboardAnalytics() {
  // Async requests can overlap when filters change quickly. Incrementing this id
  // lets stale responses exit before overwriting the latest rendered dataset.
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

  try {
    const dataset = await buildRankingsDataset({
      eventTypes: getSelectedLeaderboardEventTypes(),
      startDate: activeWindow?.startDate || '',
      endDate: activeWindow?.endDate || ''
    }, {
      resetByYear: activeWindow?.resetByYear
    });

    if (requestId !== leaderboardDatasetRequestId) {
      return;
    }

    const deckDataset = buildYearlyEloRatings(dataset.filteredMatches || [], {
      // Build a second Elo model where each player/deck combination is its own
      // entity. Player drilldowns use it for deck-specific Elo comparisons.
      kFactor: getRankingsKFactor({ resetByYear: activeWindow?.resetByYear }),
      resetByYear: activeWindow?.resetByYear,
      entityMode: 'player_deck'
    });

    currentLeaderboardDataset = {
      ...dataset,
      mode: 'elo',
      period: activeWindow,
      eventResultLookup: buildLeaderboardEventResultLookup(dataset),
      deckDataset
    };
    currentLeaderboardBaseRows = augmentEloLeaderboardRowsWithEventStats(dataset.seasonRows, currentLeaderboardDataset);
    currentLeaderboardRows = applyLeaderboardRowFilters(currentLeaderboardBaseRows, currentLeaderboardDataset);

    renderLeaderboardFromCurrentState();
  } catch (error) {
    if (requestId !== leaderboardDatasetRequestId) {
      return;
    }

    console.error('Failed to build or render Elo leaderboard dataset.', error);
    currentLeaderboardBaseRows = [];
    currentLeaderboardRows = [];
    renderLeaderboardEloThresholdControls();
    renderLeaderboardErrorState('Unable to load Elo leaderboard data for the selected window.');

    if (searchInput) {
      searchInput.disabled = false;
    }
    if (downloadButton) {
      downloadButton.disabled = false;
    }
  }
}

