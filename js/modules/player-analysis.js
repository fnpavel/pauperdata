// Renders Player Analysis: summary cards, Elo-specific controls, event history,
// raw tables, and the async state needed to keep drilldowns in sync.
import { getAnalysisRows } from '../utils/analysis-data.js';
import { updatePlayerWinRateChart } from '../charts/player-win-rate.js';
import { updatePlayerDeckPerformanceChart } from '../charts/player-deck-performance.js';
import { triggerUpdateAnimation, updateElementHTML } from '../utils/dom.js';
import { calculatePlayerStats } from '../utils/data-cards.js';
import { getSelectedPlayerDeck, setSelectedPlayerDeck } from '../utils/player-deck-filter.js';
import { calculatePlayerEventTable, calculatePlayerDeckTable } from '../utils/data-tables.js';
import { countUniqueEvents, formatDate, formatEventName } from '../utils/format.js';
import { getEventGroupInfo } from '../utils/event-groups.js';
import { isUnknownHeavyBelowTop32FilterEnabled } from '../utils/analysis-data.js';
import { buildRankingsDataset, getRankingsAvailableDates } from '../utils/rankings-data.js';
import { getPlayerIdentityKey, getSelectedPlayerLabel, rowMatchesPlayerKey } from '../utils/player-names.js';
import { getPlayerAnalysisActivePreset, getPlayerPresetRows } from '../utils/player-analysis-presets.js';
import { setSingleEventType, setSelectedSingleEvent, updateEventFilter } from './filters/filter-index.js';
import { downloadPlayerAnalysisCsv } from './export-table-csv.js';

function getSelectedPlayerEventTypes() {
  const playerAnalysisSection = document.getElementById('playerAnalysisSection');
  return Array.from(playerAnalysisSection?.querySelectorAll('.event-type-filter.active') || []).map(button =>
    button.dataset.type.toLowerCase()
  );
}

function getActivePlayerEventGroupFilter() {
  const selectionPanels = document.getElementById('playerSelectionPanels');
  const activeGroupKeys = String(selectionPanels?.dataset.activeGroupKeys || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  return {
    initialized: selectionPanels?.dataset.groupFilterInitialized === 'true',
    activeGroupKeys: new Set(activeGroupKeys)
  };
}

function applyPlayerEventGroupFilter(rows = []) {
  const { initialized, activeGroupKeys } = getActivePlayerEventGroupFilter();
  if (!initialized) {
    return rows;
  }

  if (activeGroupKeys.size === 0) {
    return [];
  }

  return rows.filter(row => activeGroupKeys.has(getEventGroupInfo(row.Event).key));
}

const playerSidebarCardIds = ['playerPeriodEloCard', 'playerPeakEloCard'];

const PLAYER_RANK_DRILLDOWN_CONFIG = {
  top1: {
    cardId: 'playerTop1Card',
    title: 'Top 1 Finishes',
    emptyMessage: 'No Top 1 finishes in the current Player Analysis filters.',
    predicate: row => Number(row.Rank) === 1,
    includeTop8: true
  },
  top1_8: {
    cardId: 'playerTop1_8Card',
    title: 'Top 2-8 Finishes',
    emptyMessage: 'No Top 2-8 finishes in the current Player Analysis filters.',
    predicate: row => {
      const rank = Number(row.Rank);
      return rank >= 2 && rank <= 8;
    },
    includeTop8: true
  },
  top9_16: {
    cardId: 'playerTop9_16Card',
    title: 'Top 9-16 Finishes',
    emptyMessage: 'No Top 9-16 finishes in the current Player Analysis filters.',
    predicate: row => {
      const rank = Number(row.Rank);
      return rank >= 9 && rank <= 16;
    },
    includeTop8: false
  },
  top17_32: {
    cardId: 'playerTop17_32Card',
    title: 'Top 17-32 Finishes',
    emptyMessage: 'No Top 17-32 finishes in the current Player Analysis filters.',
    predicate: row => {
      const rank = Number(row.Rank);
      return rank >= 17 && rank <= 32;
    },
    includeTop8: false
  },
  top33Plus: {
    cardId: 'playerTop33PlusCard',
    title: 'Top 33+ Finishes',
    emptyMessage: 'No Top 33+ finishes in the current Player Analysis filters.',
    predicate: row => Number(row.Rank) > 32,
    includeTop8: false
  }
};

const PLAYER_SUMMARY_DRILLDOWN_CONFIG = {
  totalEvents: {
    cardId: 'playerEventsCard',
    title: 'Event History',
    emptyMessage: 'No events in the current Player Analysis filters.'
  },
  eloForPeriod: {
    cardId: 'playerPeriodEloCard',
    title: 'Elo for the Period',
    emptyMessage: 'No Elo results are available for the current Player Analysis filters.'
  },
  peakElo: {
    cardId: 'playerPeakEloCard',
    title: 'Peak Elo',
    emptyMessage: 'No Elo peaks are available for the current Player Analysis filters.'
  },
  uniqueDecks: {
    cardId: 'playerUniqueDecksCard',
    title: 'Unique Decks Used',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  mostPlayedDecks: {
    cardId: 'playerMostPlayedCard',
    title: 'Most Played Decks',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  },
  leastPlayedDecks: {
    cardId: 'playerLeastPlayedCard',
    title: 'Least Played Decks',
    emptyMessage: 'No deck data in the current Player Analysis filters.'
  }
};

const PLAYER_SIDEBAR_DRILLDOWN_CONFIG = {};

// These snapshots support the currently visible Player Analysis view. Keeping
// them at module scope lets charts, cards, and drilldowns read one consistent
// state without repeatedly querying the DOM.
let currentPlayerAnalysisRows = [];
let activePlayerDrilldownCategory = '';
let activePlayerDeckStatsDrilldownDeck = '';
let currentPlayerEloInsights = createEmptyPlayerEloInsights();
let playerAnalyticsRequestId = 0;
let activePlayerPrimaryChartView = 'win-rate';
let currentPlayerRawTableState = {
  tableType: 'event',
  title: 'player-event-data',
  rows: []
};
const UNKNOWN_ELO_DECK_NAMES = new Set(['UNKNOWN', 'UNKNOWN DECK', 'UNKNOW']);

// Elo widgets derive several related views from the same normalized structure.
// An explicit empty object keeps the rendering code simple while async data is
// still loading or when a player has no tracked Elo history.
function createEmptyPlayerEloInsights() {
  return {
    dataset: null,
    overallDataset: null,
    deckDataset: null,
    periodRow: null,
    overallPeriodRow: null,
    historyEntries: [],
    overallHistoryEntries: [],
    availableDecks: [],
    selectedDeck: '',
    deckRows: [],
    deckGroups: [],
    peakEntries: [],
    tableElo: {
      eventLookup: new Map(),
      deckLookup: new Map(),
      rangeLabel: '2024-2026'
    }
  };
}

function createPlayerSearchEmptyState(message) {
  const emptyState = document.createElement('div');
  emptyState.className = 'player-search-empty';
  emptyState.textContent = message;
  return emptyState;
}

function getPlayerRawTableDownloadButton() {
  return document.getElementById('playerRawTableDownloadCsv');
}

function getPlayerRawTableFullscreenButton() {
  return document.getElementById('playerRawTableFullscreenButton');
}

function getPlayerRawTableContainer() {
  return document.getElementById('playerRawTableContainer');
}

function getPlayerDeckStatsCardsRoot() {
  return document.getElementById('playerDeckStatsCards');
}

function getPlayerPrimaryChartToggleRoot() {
  return document.getElementById('playerPrimaryChartToggle');
}

function getPlayerPrimaryChartPanel(view) {
  const panelMap = {
    'win-rate': document.getElementById('playerWinRatePanel'),
    'scatter': document.getElementById('playerScatterDeckPanel')
  };

  return panelMap[view] || null;
}

function syncPlayerPrimaryChartView({ refreshVisibleChart = false } = {}) {
  const toggleRoot = getPlayerPrimaryChartToggleRoot();
  const normalizedView = activePlayerPrimaryChartView === 'scatter' ? 'scatter' : 'win-rate';
  activePlayerPrimaryChartView = normalizedView;

  if (toggleRoot) {
    Array.from(toggleRoot.querySelectorAll('[data-player-chart-view]')).forEach(button => {
      const isActive = button.dataset.playerChartView === normalizedView;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  ['win-rate', 'scatter'].forEach(view => {
    const panel = getPlayerPrimaryChartPanel(view);
    if (!panel) {
      return;
    }

    const isActive = view === normalizedView;
    panel.hidden = !isActive;
    panel.dataset.active = isActive ? 'true' : 'false';
  });

  if (!refreshVisibleChart) {
    return;
  }

  if (normalizedView === 'scatter') {
    updatePlayerDeckPerformanceChart();
    return;
  }

  updatePlayerWinRateChart();
}

function setupPlayerPrimaryChartToggleListeners() {
  const root = getPlayerPrimaryChartToggleRoot();
  if (!root || root.dataset.listenerAdded === 'true') {
    syncPlayerPrimaryChartView();
    return;
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-player-chart-view]');
    if (!button) {
      return;
    }

    const requestedView = button.dataset.playerChartView === 'scatter' ? 'scatter' : 'win-rate';
    if (requestedView === activePlayerPrimaryChartView) {
      return;
    }

    activePlayerPrimaryChartView = requestedView;
    syncPlayerPrimaryChartView({ refreshVisibleChart: true });
  });

  root.dataset.listenerAdded = 'true';
  syncPlayerPrimaryChartView();
}

function renderPlayerDeckStatsCards(deckStatsCards = []) {
  const root = getPlayerDeckStatsCardsRoot();
  if (!root) {
    return;
  }

  if (!Array.isArray(deckStatsCards) || deckStatsCards.length === 0) {
    root.innerHTML = `
      <div class="stat-card combined player-deck-stats-card player-deck-stats-card-empty">
        <div class="stat-title">Deck Stats</div>
        <div class="stat-details">
          <div><span class="value">No deck data in the current Player Analysis filters.</span></div>
        </div>
        <div class="stat-icon">🃏</div>
      </div>
    `;
    return;
  }

  root.innerHTML = deckStatsCards.map((card, index) => `
    <div
      class="stat-card combined player-deck-stats-card"
      id="playerDeckStatsCard${index}"
      data-player-deck-stats-card="${index}"
      data-player-deck-stats-deck="${escapeHtml(card.name || '')}"
    >
      <div class="stat-title">${escapeHtml(card.title || 'Deck Stats')}</div>
      <div class="stat-value">${escapeHtml(card.name || '--')}</div>
      <div class="stat-details">
        <div><span class="label">Events:</span> <span class="value">${escapeHtml(card.events || '--')}</span></div>
        <div><span class="label">Match Record:</span> <span class="value">${escapeHtml(card.record || '--')}</span></div>
        <div><span class="label">Overall Win Rate:</span> <span class="value player-deck-stats-hover-percent" data-raw-value="${escapeHtml(card.overallWinRateRaw || '--')}" data-percent-value="${escapeHtml(card.overallWinRatePercent || '--')}">${escapeHtml(card.overallWinRateRaw || '--')}</span></div>
        <div><span class="label">Current Elo:</span> <span class="value">${escapeHtml(card.currentElo || '--')}</span></div>
        <div><span class="label">Peak Elo:</span> <span class="value">${escapeHtml(card.peakElo || '--')}</span></div>
        <div><span class="label">Best Win Rate:</span> <span class="value player-deck-stats-hover-percent" data-raw-value="${escapeHtml(card.bestWinRateRaw || '--')}" data-percent-value="${escapeHtml(card.bestWinRatePercent || '--')}">${escapeHtml(card.bestWinRateRaw || '--')}</span></div>
        <div><span class="label">Worst Win Rate:</span> <span class="value player-deck-stats-hover-percent" data-raw-value="${escapeHtml(card.worstWinRateRaw || '--')}" data-percent-value="${escapeHtml(card.worstWinRatePercent || '--')}">${escapeHtml(card.worstWinRateRaw || '--')}</span></div>
      </div>
      <div class="stat-icon">🃏</div>
    </div>
  `).join('');
}

function setPlayerDeckStatsCardHoverState(card, isHovering) {
  if (!card) {
    return;
  }

  card.querySelectorAll('.player-deck-stats-hover-percent').forEach(field => {
    field.classList.toggle('player-deck-stats-hover-percent-active', isHovering);
    const nextValue = isHovering
      ? String(field.dataset.percentValue || '').trim()
      : String(field.dataset.rawValue || '').trim();
    field.textContent = nextValue || '--';
  });
}

function exportPlayerRawTableCsv() {
  downloadPlayerAnalysisCsv(currentPlayerRawTableState, 'player-analysis-table');
}

function setupPlayerRawTableExportAction() {
  const downloadButton = getPlayerRawTableDownloadButton();
  if (!downloadButton || downloadButton.dataset.listenerAdded === 'true') {
    return;
  }

  downloadButton.addEventListener('click', exportPlayerRawTableCsv);
  downloadButton.dataset.listenerAdded = 'true';
}

function updatePlayerRawTableFullscreenButtonState() {
  const button = getPlayerRawTableFullscreenButton();
  const container = getPlayerRawTableContainer();
  if (!button || !container) {
    return;
  }

  button.textContent = document.fullscreenElement === container ? 'Exit Full Screen' : 'Full Screen';
}

async function togglePlayerRawTableFullscreen() {
  const container = getPlayerRawTableContainer();
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

function setupPlayerRawTableFullscreenAction() {
  const button = getPlayerRawTableFullscreenButton();
  if (button && button.dataset.listenerAdded !== 'true') {
    button.addEventListener('click', () => {
      togglePlayerRawTableFullscreen().catch(error => {
        console.error('Failed to toggle player table fullscreen mode.', error);
      });
    });
    button.dataset.listenerAdded = 'true';
  }

  if (document.body.dataset.playerRawTableFullscreenBound !== 'true') {
    document.addEventListener('fullscreenchange', updatePlayerRawTableFullscreenButtonState);
    document.body.dataset.playerRawTableFullscreenBound = 'true';
  }

  updatePlayerRawTableFullscreenButtonState();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSelectablePlayerEloDeck(deckName) {
  const normalizedDeck = String(deckName || '').trim();
  return normalizedDeck !== '' && !UNKNOWN_ELO_DECK_NAMES.has(normalizedDeck.toUpperCase());
}

function getPlayerEloDeckFilterTooltip(isAllDecks = false) {
  if (isAllDecks) {
    return 'All Decks always includes unknown matchups.';
  }

  return isUnknownHeavyBelowTop32FilterEnabled()
    ? 'Events with missing data below Top32 are being removed from the dataset. Check the Data Quality Toggle at the Top'
    : 'Includes events with missing data below Top32. Check the Data Quality Toggle at the Top';
}

function getPlayerEloDeckFilterRoot() {
  return document.getElementById('playerEloDeckFilter');
}

function readSelectedPlayerEloDeck() {
  return getSelectedPlayerDeck();
}

function writeSelectedPlayerEloDeck(selectedDeck) {
  setSelectedPlayerDeck(selectedDeck);
}

function renderPlayerEloDeckFilter(eloInsights = currentPlayerEloInsights) {
  const root = getPlayerEloDeckFilterRoot();
  if (!root) {
    return '';
  }

  // This filter only scopes Elo cards/drilldowns. The main Player Analysis
  // filters stay untouched so a deck comparison does not silently change the
  // rest of the page.
  const availableDecks = Array.isArray(eloInsights?.availableDecks)
    ? [...new Set(eloInsights.availableDecks.filter(isSelectablePlayerEloDeck))]
    : [];
  const selectedDeck = readSelectedPlayerEloDeck();
  const validSelectedDeck = availableDecks.includes(selectedDeck) ? selectedDeck : '';

  if (availableDecks.length === 0) {
    root.innerHTML = `
      <div class="player-chart-filter-header">
        <div class="player-chart-filter-copy">
          <span class="player-chart-filter-label">Elo Deck Filter</span>
          <span class="player-chart-filter-note">Applies to the Elo cards and Elo drilldowns.</span>
        </div>
      </div>
      <div class="player-chart-filter-empty">Deck-specific Elo appears here once the selected player has rated matches with deck names.</div>
    `;
    return '';
  }

  root.innerHTML = `
    <div class="player-chart-filter-header">
      <div class="player-chart-filter-copy">
        <span class="player-chart-filter-label">Elo Deck Filter</span>
        <span class="player-chart-filter-note">${escapeHtml(
          validSelectedDeck
            ? `Applies to the Elo cards and Elo drilldowns. Showing only ${validSelectedDeck}.`
            : `Applies to the Elo cards and Elo drilldowns. Showing all ${availableDecks.length} tracked decks.`
        )}</span>
      </div>
    </div>
    <div class="bubble-menu player-chart-filter-chips">
      <button
        type="button"
        class="bubble-button player-elo-deck-chip player-elo-deck-chip-reset analysis-filter-tooltip${!validSelectedDeck ? ' active' : ''}"
        data-player-elo-deck-reset="true"
        data-tooltip="${escapeHtml(getPlayerEloDeckFilterTooltip(true))}"
        aria-label="${escapeHtml(`All Decks. ${getPlayerEloDeckFilterTooltip(true)}`)}"
      >All Decks</button>
      ${availableDecks.map(deck => `
        <button
          type="button"
          class="bubble-button player-elo-deck-chip analysis-filter-tooltip${validSelectedDeck === deck ? ' active' : ''}"
          data-player-elo-deck="${escapeHtml(deck)}"
          data-tooltip="${escapeHtml(getPlayerEloDeckFilterTooltip(false))}"
          aria-label="${escapeHtml(`${deck}. ${getPlayerEloDeckFilterTooltip(false)}`)}"
        >${escapeHtml(deck)}</button>
      `).join('')}
    </div>
  `;

  return validSelectedDeck;
}

function setupPlayerEloDeckFilterListeners() {
  const root = getPlayerEloDeckFilterRoot();
  if (!root || root.dataset.listenerAdded === 'true') {
    return;
  }

  root.addEventListener('click', event => {
    const resetButton = event.target.closest('[data-player-elo-deck-reset="true"]');
    if (resetButton) {
      writeSelectedPlayerEloDeck('');
      updatePlayerAnalytics();
      return;
    }

    const deckButton = event.target.closest('[data-player-elo-deck]');
    if (!deckButton) {
      return;
    }

    const deckName = String(deckButton.dataset.playerEloDeck || '').trim();
    const currentDeck = readSelectedPlayerEloDeck();
    writeSelectedPlayerEloDeck(currentDeck === deckName ? '' : deckName);
    updatePlayerAnalytics();
  });

  root.dataset.listenerAdded = 'true';
}

function getPlayerRankDrilldownElements() {
  return {
    overlay: document.getElementById('playerRankDrilldownOverlay'),
    title: document.getElementById('playerRankDrilldownTitle'),
    subtitle: document.getElementById('playerRankDrilldownSubtitle'),
    content: document.getElementById('playerRankDrilldownContent'),
    closeButton: document.getElementById('playerRankDrilldownClose')
  };
}

function getSelectedPlayerTopFinishDeck() {
  return String(currentPlayerEloInsights?.selectedDeck || '').trim();
}

function getPlayerTopFinishRows(data = currentPlayerAnalysisRows) {
  const selectedDeck = getSelectedPlayerTopFinishDeck();
  if (!selectedDeck) {
    return Array.isArray(data) ? data : [];
  }

  return (Array.isArray(data) ? data : []).filter(row => String(row?.Deck || '').trim() === selectedDeck);
}

function getPlayerRankDrilldownMatches(categoryKey, data = currentPlayerAnalysisRows) {
  const config = PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey];
  if (!config) {
    return [];
  }

  return getPlayerTopFinishRows(data)
    .filter(config.predicate)
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

function getRowWinRateText(row) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const totalMatches = wins + losses;

  if (totalMatches === 0) {
    return '--';
  }

  return `${((wins / totalMatches) * 100).toFixed(1)}%`;
}

function getRowWinRateValue(row) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const totalMatches = wins + losses;

  if (totalMatches === 0) {
    return 0;
  }

  return (wins / totalMatches) * 100;
}

function formatAverageRankText(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `#${value.toFixed(1)}`;
}

function formatWinRatePercentage(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(1)}%`;
}

function formatEloRating(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '--';
}

function formatEloDelta(value) {
  if (!Number.isFinite(Number(value))) {
    return '--';
  }

  const roundedValue = Math.round(Number(value));
  return roundedValue > 0 ? `+${roundedValue}` : String(roundedValue);
}

function getPlayerEventDeckLookup(rows = []) {
  const deckLookup = new Map();

  (Array.isArray(rows) ? rows : []).forEach(row => {
    const eventName = String(row?.Event || '').trim();
    const eventDate = String(row?.Date || '').trim();
    const deckName = String(row?.Deck || '').trim();
    if (!eventName || !eventDate || !deckName) {
      return;
    }

    deckLookup.set(`${eventDate}|||${eventName}`, deckName);
  });

  return deckLookup;
}

function highlightDrilldownText(text, tone = 'reference') {
  return `<span class="player-rank-drilldown-emphasis player-rank-drilldown-emphasis-${tone}">${escapeHtml(text)}</span>`;
}

function highlightDrilldownLabel(text, tone = 'reference') {
  const normalizedText = String(text ?? '');
  if (/^Your\b/i.test(normalizedText)) {
    const suffix = normalizedText.replace(/^Your\b\s*/i, '');
    return `
      <span class="player-rank-drilldown-emphasis player-rank-drilldown-emphasis-${tone}">
        <strong>Your</strong>${suffix ? ` ${escapeHtml(suffix)}` : ''}
      </span>
    `;
  }

  return highlightDrilldownText(normalizedText, tone);
}

function describeWinRateComparison(subjectLabel, subjectValue, referenceLabel, referenceValue) {
  if (!Number.isFinite(subjectValue) || !Number.isFinite(referenceValue)) {
    return '';
  }

  const difference = subjectValue - referenceValue;
  if (Math.abs(difference) < 0.05) {
    return `${highlightDrilldownLabel(subjectLabel)} matches ${highlightDrilldownLabel(referenceLabel)}`;
  }

  const direction = difference > 0 ? 'above' : 'below';
  const directionTone = difference > 0 ? 'positive' : 'negative';
  return `${highlightDrilldownLabel(subjectLabel)} is ${highlightDrilldownText(`${Math.abs(difference).toFixed(1)} pp`, 'number')} ${highlightDrilldownText(direction, directionTone)} ${highlightDrilldownLabel(referenceLabel)}`;
}

function describeFinishComparison(subjectLabel, subjectRank, referenceLabel, referenceRank) {
  if (!Number.isFinite(subjectRank) || !Number.isFinite(referenceRank)) {
    return '';
  }

  const difference = referenceRank - subjectRank;
  if (Math.abs(difference) < 0.05) {
    return `${highlightDrilldownLabel(subjectLabel)} matches ${highlightDrilldownLabel(referenceLabel)}`;
  }

  const direction = difference > 0 ? 'better' : 'worse';
  const directionTone = difference > 0 ? 'positive' : 'negative';
  return `${highlightDrilldownLabel(subjectLabel)} is ${highlightDrilldownText(`${Math.abs(difference).toFixed(1)} places`, 'number')} ${highlightDrilldownText(direction, directionTone)} than ${highlightDrilldownLabel(referenceLabel)}`;
}

function buildTooltipText(parts) {
  return parts.filter(Boolean);
}

function hasDrilldownTooltipContent(tooltipText = []) {
  return Array.isArray(tooltipText) ? tooltipText.length > 0 : Boolean(tooltipText);
}

function buildDrilldownTooltipClasses(baseClasses, tooltipText = []) {
  return hasDrilldownTooltipContent(tooltipText) ? `${baseClasses} drilldown-tooltip` : baseClasses;
}

function buildDrilldownHoverNote(tooltipText = [], extraClasses = '', headerText = '') {
  const tooltipItems = Array.isArray(tooltipText)
    ? tooltipText.filter(Boolean)
    : [String(tooltipText)].filter(Boolean);

  if (tooltipItems.length === 0) {
    return '';
  }

  const noteClasses = ['player-rank-drilldown-hover-note', extraClasses]
    .filter(Boolean)
    .join(' ');

  return `
    <span class="${noteClasses}">
      ${headerText ? `<span class="player-rank-drilldown-hover-note-header">${escapeHtml(headerText)}</span>` : ''}
      <ul class="player-rank-drilldown-hover-note-list">
        ${tooltipItems.map(item => `<li>${item}</li>`).join('')}
      </ul>
    </span>
  `;
}

function buildEventRowsByName(eventNames) {
  // Drilldowns often need the full event field around the selected player's row
  // so they can show winner/top-table context.
  const eventNameSet = new Set(eventNames);
  const eventRowsByName = new Map();

  getAnalysisRows().forEach(row => {
    if (!eventNameSet.has(row.Event)) {
      return;
    }

    if (!eventRowsByName.has(row.Event)) {
      eventRowsByName.set(row.Event, []);
    }

    eventRowsByName.get(row.Event).push(row);
  });

  eventRowsByName.forEach(rows => {
    rows.sort((a, b) => {
      const rankComparison = Number(a.Rank) - Number(b.Rank);
      if (rankComparison !== 0) {
        return rankComparison;
      }

      return String(a.Player || '').localeCompare(String(b.Player || ''));
    });
  });

  return eventRowsByName;
}

function sortPlayerAnalysisRows(rows = []) {
  return [...rows].sort((a, b) => {
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

function getPlayerDeckRows(data = currentPlayerAnalysisRows) {
  return (data || []).filter(row => {
    const deckName = String(row?.Deck || '').trim();
    return deckName && deckName !== 'No Show';
  });
}

function getBestFinishRow(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((bestRow, row) => {
    const rowRank = Number(row.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(bestRow.Rank) || Number.POSITIVE_INFINITY;

    if (rowRank !== bestRank) {
      return rowRank < bestRank ? row : bestRow;
    }

    const rowWinRate = getRowWinRateValue(row);
    const bestWinRate = getRowWinRateValue(bestRow);
    if (rowWinRate !== bestWinRate) {
      return rowWinRate > bestWinRate ? row : bestRow;
    }

    return String(row.Event || '').localeCompare(String(bestRow.Event || '')) < 0 ? row : bestRow;
  }, rows[0]);
}

function getWorstFinishRow(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((worstRow, row) => {
    const rowRank = Number(row.Rank) || Number.NEGATIVE_INFINITY;
    const worstRank = Number(worstRow.Rank) || Number.NEGATIVE_INFINITY;

    if (rowRank !== worstRank) {
      return rowRank > worstRank ? row : worstRow;
    }

    const rowWinRate = getRowWinRateValue(row);
    const worstWinRate = getRowWinRateValue(worstRow);
    if (rowWinRate !== worstWinRate) {
      return rowWinRate < worstWinRate ? row : worstRow;
    }

    return String(row.Event || '').localeCompare(String(worstRow.Event || '')) < 0 ? row : worstRow;
  }, rows[0]);
}

function buildPlayerDeckGroups(data = currentPlayerAnalysisRows) {
  // Deck groups power several cards and drilldowns, so calculate wins/losses,
  // finish extremes, and average finish once in a shared model.
  const deckGroups = new Map();

  getPlayerDeckRows(data).forEach(row => {
    const deckName = String(row.Deck || '').trim();
    if (!deckGroups.has(deckName)) {
      deckGroups.set(deckName, []);
    }

    deckGroups.get(deckName).push(row);
  });

  return Array.from(deckGroups.entries())
    .map(([deck, rows]) => {
      const sortedRows = sortPlayerAnalysisRows(rows);
      const wins = sortedRows.reduce((sum, row) => sum + (Number(row.Wins) || 0), 0);
      const losses = sortedRows.reduce((sum, row) => sum + (Number(row.Losses) || 0), 0);
      const eventCount = countUniqueEvents(sortedRows);
      const averageFinish = sortedRows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / sortedRows.length;

      return {
        deck,
        rows: sortedRows,
        eventCount,
        wins,
        losses,
        overallWinRate: getRowWinRateValue({ Wins: wins, Losses: losses }),
        averageFinish,
        bestFinishRow: getBestFinishRow(sortedRows),
        worstFinishRow: getWorstFinishRow(sortedRows)
      };
    })
    .sort((a, b) => {
      if (b.eventCount !== a.eventCount) {
        return b.eventCount - a.eventCount;
      }

      if (b.overallWinRate !== a.overallWinRate) {
        return b.overallWinRate - a.overallWinRate;
      }

      return a.deck.localeCompare(b.deck);
    });
}

function sortDeckGroupsByOverallWinRate(groups = []) {
  return [...groups].sort((a, b) => {
    if (b.overallWinRate !== a.overallWinRate) {
      return b.overallWinRate - a.overallWinRate;
    }

    if (b.eventCount !== a.eventCount) {
      return b.eventCount - a.eventCount;
    }

    if (a.averageFinish !== b.averageFinish) {
      return a.averageFinish - b.averageFinish;
    }

    return a.deck.localeCompare(b.deck);
  });
}

function getPlayerDeckStatsDrilldownGroup(deckName = '', data = currentPlayerAnalysisRows) {
  const normalizedDeckName = String(deckName || '').trim();
  if (!normalizedDeckName) {
    return null;
  }

  return buildPlayerDeckGroups(data).find(group => String(group?.deck || '').trim() === normalizedDeckName) || null;
}

function getPlayerSummaryDrilldownItems(categoryKey, data = currentPlayerAnalysisRows) {
  switch (categoryKey) {
    case 'totalEvents':
      return sortPlayerAnalysisRows(data);
    case 'eloForPeriod':
      return currentPlayerEloInsights.periodRow ? [currentPlayerEloInsights.periodRow] : [];
    case 'peakElo':
      return currentPlayerEloInsights.peakEntries || [];
    case 'uniqueDecks':
      return buildPlayerDeckGroups(data);
    case 'mostPlayedDecks': {
      const deckGroups = buildPlayerDeckGroups(data);
      const maxEventCount = deckGroups.length > 0 ? Math.max(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === maxEventCount);
    }
    case 'leastPlayedDecks': {
      const deckGroups = buildPlayerDeckGroups(data);
      const minEventCount = deckGroups.length > 0 ? Math.min(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === minEventCount);
    }
    default:
      return [];
  }
}

function getPlayerSidebarDrilldownItems(categoryKey, data = currentPlayerAnalysisRows) {
  const deckGroups = buildPlayerDeckGroups(data);

  switch (categoryKey) {
    case 'overallWinRate':
      return sortDeckGroupsByOverallWinRate(deckGroups);
    case 'mostPlayedDeckStats': {
      const maxEventCount = deckGroups.length > 0 ? Math.max(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === maxEventCount);
    }
    case 'leastPlayedDeckStats': {
      const minEventCount = deckGroups.length > 0 ? Math.min(...deckGroups.map(group => group.eventCount)) : 0;
      return deckGroups.filter(group => group.eventCount === minEventCount);
    }
    case 'bestDeckStats': {
      const bestWinRate = deckGroups.length > 0 ? Math.max(...deckGroups.map(group => group.overallWinRate)) : Number.NEGATIVE_INFINITY;
      return deckGroups.filter(group => group.overallWinRate === bestWinRate);
    }
    case 'worstDeckStats': {
      const worstWinRate = deckGroups.length > 0 ? Math.min(...deckGroups.map(group => group.overallWinRate)) : Number.POSITIVE_INFINITY;
      return deckGroups.filter(group => group.overallWinRate === worstWinRate);
    }
    default:
      return [];
  }
}

function getPlayerEloMatchView(match, selectedPlayerKey = '', eventDeckLookup = new Map()) {
  const normalizedPlayerKey = String(selectedPlayerKey || '').trim();
  if (!normalizedPlayerKey || !match) {
    return null;
  }

  const playerAKey = String(match.player_a_key || match.player_key || '').trim();
  const playerBKey = String(match.player_b_key || match.opponent_key || '').trim();
  const eventDate = String(match.date || match.Date || '').trim();
  const eventName = String(match.event || match.Event || '').trim();
  const fallbackDeck = eventDeckLookup.get(`${eventDate}|||${eventName}`) || '';

  if (normalizedPlayerKey === playerAKey) {
    return {
      seasonKey: String(match.seasonKey || '').trim(),
      date: eventDate,
      event: eventName,
      round: Number.isFinite(Number(match.round)) ? Number(match.round) : null,
      deck: String(match.deck_a || match.deck || fallbackDeck).trim(),
      opponent: String(match.player_b || match.opponent || '').trim(),
      opponentDeck: String(match.deck_b || match.opponent_deck || '').trim(),
      resultType: String(match.outcome || '').trim() === 'player_a_win' ? 'win' : String(match.outcome || '').trim() === 'player_b_win' ? 'loss' : String(match.result_type || '').trim(),
      ratingBefore: Number(match.playerRatingBefore),
      ratingAfter: Number(match.playerRatingAfter),
      delta: Number(match.playerDelta)
    };
  }

  if (normalizedPlayerKey === playerBKey) {
    return {
      seasonKey: String(match.seasonKey || '').trim(),
      date: eventDate,
      event: eventName,
      round: Number.isFinite(Number(match.round)) ? Number(match.round) : null,
      deck: String(match.deck_b || match.opponent_deck || fallbackDeck).trim(),
      opponent: String(match.player_a || match.player || '').trim(),
      opponentDeck: String(match.deck_a || match.deck || '').trim(),
      resultType: String(match.outcome || '').trim() === 'player_b_win' ? 'win' : String(match.outcome || '').trim() === 'player_a_win' ? 'loss' : String(match.result_type || '').trim(),
      ratingBefore: Number(match.opponentRatingBefore),
      ratingAfter: Number(match.opponentRatingAfter),
      delta: Number(match.opponentDelta)
    };
  }

  return null;
}

function buildPlayerEloDeckGroups(matchViews = []) {
  // Deck-specific Elo cards are based on match history rather than event rows so
  // they can include per-round rating movement and peak Elo moments.
  const deckGroups = new Map();

  matchViews.forEach(matchView => {
    const deckName = String(matchView?.deck || '').trim();
    if (!deckName) {
      return;
    }

    if (!deckGroups.has(deckName)) {
      deckGroups.set(deckName, {
        deck: deckName,
        peakElo: Number.NEGATIVE_INFINITY,
        latestElo: Number.NaN,
        latestDate: '',
        bestMatch: null,
        matches: 0,
        wins: 0,
        losses: 0,
        rows: []
      });
    }

    const group = deckGroups.get(deckName);
    group.matches += 1;
    if (matchView.resultType === 'win') {
      group.wins += 1;
    } else if (matchView.resultType === 'loss') {
      group.losses += 1;
    }
    group.rows.push(matchView);

    if (Number.isFinite(matchView.ratingAfter) && matchView.ratingAfter > group.peakElo) {
      group.peakElo = matchView.ratingAfter;
      group.bestMatch = matchView;
    }

    if (!Number.isFinite(group.latestElo) || String(matchView.date || '').localeCompare(String(group.latestDate || '')) >= 0) {
      group.latestElo = Number.isFinite(matchView.ratingAfter) ? matchView.ratingAfter : group.latestElo;
      group.latestDate = String(matchView.date || '');
    }
  });

  return Array.from(deckGroups.values()).sort((a, b) => {
    return (
      Number(b.peakElo) - Number(a.peakElo) ||
      b.matches - a.matches ||
      a.deck.localeCompare(b.deck)
    );
  });
}

const MAX_PLAYER_ELO_CACHE_ENTRIES = 24;
const playerRankingsDatasetCache = new Map();
const playerEloInsightsCache = new Map();

function rememberLimitedCacheEntry(cache, key, value, maxEntries = MAX_PLAYER_ELO_CACHE_ENTRIES) {
  // Tiny LRU behavior keeps rapid filter toggling responsive without letting
  // long sessions accumulate unbounded cached Elo datasets.
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  return value;
}

function getNormalizedPlayerEventTypesKey(eventTypes = []) {
  return [...new Set(
    (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )].sort().join(',');
}

function getPlayerEloEventKey(record = {}) {
  return `${String(record?.Date || record?.date || '').trim()}|||${String(record?.Event || record?.event || '').trim()}`;
}

function getPlayerEloDeckLookupKey(record = {}) {
  return `${getPlayerEloEventKey(record)}|||${String(record?.Deck || record?.deck || '').trim()}`;
}

function comparePlayerEloHistoryEntriesAscending(a, b) {
  return (
    String(a?.date || '').localeCompare(String(b?.date || '')) ||
    String(a?.eventId || '').localeCompare(String(b?.eventId || '')) ||
    String(a?.event || '').localeCompare(String(b?.event || '')) ||
    Number(a?.round || 0) - Number(b?.round || 0)
  );
}

function sortPlayerEloHistoryEntries(entries = [], direction = 'desc') {
  const sortedEntries = [...(Array.isArray(entries) ? entries : [])].sort(comparePlayerEloHistoryEntriesAscending);
  return direction === 'asc' ? sortedEntries : sortedEntries.reverse();
}

function getPlayerEloHistoryEntryKey(entry = {}) {
  return `${String(entry?.date || '').trim()}|||${String(entry?.event || '').trim()}`;
}

function getFullPlayerEloDateWindow(eventTypes = []) {
  const dates = getRankingsAvailableDates(eventTypes);
  return {
    startDate: dates[0] || '',
    endDate: dates[dates.length - 1] || '',
    rangeLabel: dates.length > 0
      ? `${dates[0].slice(0, 4)}-${dates[dates.length - 1].slice(0, 4)}`
      : '2024-2026'
  };
}

function buildPlayerEloEventSummaryMap(entries = []) {
  const eventSummaryMap = new Map();

  sortPlayerEloHistoryEntries(entries, 'asc').forEach(entry => {
    const eventKey = getPlayerEloHistoryEntryKey(entry);
    if (!eventKey || eventKey === '|||') {
      return;
    }

    if (!eventSummaryMap.has(eventKey)) {
      eventSummaryMap.set(eventKey, {
        eloDelta: 0,
        finalElo: Number.NaN,
        matchCount: 0
      });
    }

    const summary = eventSummaryMap.get(eventKey);
    const delta = Number(entry?.delta);
    if (Number.isFinite(delta)) {
      summary.eloDelta += delta;
    }
    if (Number.isFinite(Number(entry?.ratingAfter))) {
      summary.finalElo = Number(entry.ratingAfter);
    }
    summary.matchCount += 1;
  });

  return eventSummaryMap;
}

function buildPlayerTableEloEventLookup({
  runningHistoryEntries = [],
  seasonalHistoryEntries = []
} = {}) {
  const runningSummaryMap = buildPlayerEloEventSummaryMap(runningHistoryEntries);
  const seasonalSummaryMap = buildPlayerEloEventSummaryMap(seasonalHistoryEntries);
  const eventLookup = new Map();

  new Set([...runningSummaryMap.keys(), ...seasonalSummaryMap.keys()]).forEach(eventKey => {
    const runningSummary = runningSummaryMap.get(eventKey) || {};
    const seasonalSummary = seasonalSummaryMap.get(eventKey) || {};
    eventLookup.set(eventKey, {
      seasonEloDelta: Number(seasonalSummary.eloDelta),
      runningElo: Number(runningSummary.finalElo),
      runningEloDelta: Number(runningSummary.eloDelta),
      seasonElo: Number(seasonalSummary.finalElo),
      matchCount: Number(runningSummary.matchCount || seasonalSummary.matchCount || 0)
    });
  });

  return eventLookup;
}

function buildPlayerTableDeckEloLookup({
  deckDataset = null,
  selectedPlayer = '',
  playerRows = []
} = {}) {
  const normalizedPlayerKey = String(selectedPlayer || '').trim();
  const deckEventKeys = new Map();

  (Array.isArray(playerRows) ? playerRows : []).forEach(row => {
    const deckName = String(row?.Deck || '').trim();
    const eventKey = getPlayerEloEventKey(row);
    if (!deckName || !eventKey || eventKey === '|||') {
      return;
    }

    if (!deckEventKeys.has(deckName)) {
      deckEventKeys.set(deckName, new Set());
    }
    deckEventKeys.get(deckName).add(eventKey);
  });

  const deckLookup = new Map();
  (deckDataset?.seasonRows || [])
    .filter(row => String(row?.basePlayerKey || '').trim() === normalizedPlayerKey)
    .forEach(row => {
      const deckName = String(row?.deck || '').trim();
      const relevantEventKeys = deckEventKeys.get(deckName);
      if (!isSelectablePlayerEloDeck(deckName) || !relevantEventKeys || relevantEventKeys.size === 0) {
        return;
      }

      const latestEntry = sortPlayerEloHistoryEntries(deckDataset?.historyByPlayer?.get(row.playerKey) || [])
        .find(entry => relevantEventKeys.has(getPlayerEloHistoryEntryKey(entry)));

      if (!latestEntry || !Number.isFinite(Number(latestEntry.ratingAfter))) {
        return;
      }

      deckLookup.set(deckName, {
        deckElo: Number(latestEntry.ratingAfter),
        latestDate: latestEntry.date || '',
        latestEvent: latestEntry.event || '',
        matchCount: relevantEventKeys.size
      });
    });

  return deckLookup;
}

function buildPlayerEloRowSignature(rows = [], keyBuilder = getPlayerEloEventKey) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => keyBuilder(row))
    .filter(value => value && value !== '|||')
    .join('@@');
}

function getCachedPlayerRankingsDataset({
  eventTypes = [],
  startDate = '',
  endDate = '',
  entityMode = 'player',
  resetByYear = false,
  matchFilterKey = '',
  matchFilter = null
} = {}) {
  const cacheKey = [
    entityMode,
    resetByYear ? 'seasonal' : 'running',
    getNormalizedPlayerEventTypesKey(eventTypes),
    String(startDate || '').trim(),
    String(endDate || '').trim(),
    String(matchFilterKey || '').trim() || 'all'
  ].join('::');

  if (playerRankingsDatasetCache.has(cacheKey)) {
    return rememberLimitedCacheEntry(
      playerRankingsDatasetCache,
      cacheKey,
      playerRankingsDatasetCache.get(cacheKey)
    );
  }

  const datasetPromise = buildRankingsDataset({
    eventTypes,
    startDate,
    endDate,
    matchFilter
  }, {
    resetByYear,
    entityMode
  }).catch(error => {
    playerRankingsDatasetCache.delete(cacheKey);
    throw error;
  });

  return rememberLimitedCacheEntry(playerRankingsDatasetCache, cacheKey, datasetPromise);
}

async function buildPlayerEloInsights({
  selectedPlayer = '',
  selectedEventTypes = [],
  startDate = '',
  endDate = '',
  playerRows = [],
  qualityScopedPlayerRows = [],
  selectedDeck = ''
} = {}) {
  // Player Analysis combines event rows with Elo match files. This function
  // returns one complete object for the cards, deck filter, and drilldowns.
  if (!selectedPlayer || !startDate || !endDate || !Array.isArray(selectedEventTypes) || selectedEventTypes.length === 0) {
    return createEmptyPlayerEloInsights();
  }

  const allowedDeckEventKeySignature = buildPlayerEloRowSignature(qualityScopedPlayerRows, getPlayerEloEventKey);
  const playerDeckLookupSignature = buildPlayerEloRowSignature(playerRows, getPlayerEloDeckLookupKey);
  const cacheKey = [
    String(selectedPlayer || '').trim(),
    getNormalizedPlayerEventTypesKey(selectedEventTypes),
    String(startDate || '').trim(),
    String(endDate || '').trim(),
    String(selectedDeck || '').trim(),
    allowedDeckEventKeySignature,
    playerDeckLookupSignature
  ].join('::');

  if (playerEloInsightsCache.has(cacheKey)) {
    return rememberLimitedCacheEntry(playerEloInsightsCache, cacheKey, playerEloInsightsCache.get(cacheKey));
  }

  const insightsPromise = (async () => {
    const fullEloWindow = getFullPlayerEloDateWindow(selectedEventTypes);
    const allowedDeckEventKeys = [...new Set(
      (Array.isArray(qualityScopedPlayerRows) ? qualityScopedPlayerRows : [])
        .map(row => getPlayerEloEventKey(row))
        .filter(value => value !== '|||')
    )];
    const allowedDeckEventKeySet = new Set(allowedDeckEventKeys);
    const deckMatchFilter = allowedDeckEventKeySet.size > 0
      ? match => allowedDeckEventKeySet.has(getPlayerEloEventKey(match))
      : null;

    // Load all-decks and deck-specific Elo datasets together because every
    // refresh needs both for comparison and filter options.
    const [
      overallDataset,
      deckDataset,
      runningAllTimeDataset,
      seasonalDataset,
      runningDeckDataset
    ] = await Promise.all([
      getCachedPlayerRankingsDataset({
        eventTypes: selectedEventTypes,
        startDate,
        endDate,
        entityMode: 'player'
      }),
      getCachedPlayerRankingsDataset({
        eventTypes: selectedEventTypes,
        startDate,
        endDate,
        entityMode: 'player_deck',
        matchFilterKey: allowedDeckEventKeys.join('@@'),
        matchFilter: deckMatchFilter
      }),
      getCachedPlayerRankingsDataset({
        eventTypes: selectedEventTypes,
        startDate: fullEloWindow.startDate,
        endDate: fullEloWindow.endDate,
        entityMode: 'player',
        resetByYear: false
      }),
      getCachedPlayerRankingsDataset({
        eventTypes: selectedEventTypes,
        startDate: fullEloWindow.startDate,
        endDate: fullEloWindow.endDate,
        entityMode: 'player',
        resetByYear: true
      }),
      getCachedPlayerRankingsDataset({
        eventTypes: selectedEventTypes,
        startDate: fullEloWindow.startDate,
        endDate: fullEloWindow.endDate,
        entityMode: 'player_deck',
        resetByYear: false
      })
    ]);
    const overallPeriodRow = (overallDataset?.seasonRows || []).find(row => String(row.playerKey || '').trim() === String(selectedPlayer || '').trim()) || null;
    const overallHistoryEntries = overallPeriodRow
      ? sortPlayerEloHistoryEntries(
          (overallDataset?.historyByPlayer?.get(selectedPlayer) || [])
            .filter(entry => String(entry.seasonKey || '').trim() === String(overallPeriodRow.seasonKey || '').trim())
        )
      : [];
    const deckRows = (deckDataset?.seasonRows || [])
      .filter(row => String(row.basePlayerKey || '').trim() === String(selectedPlayer || '').trim())
      .sort((a, b) => {
        return (
          Number(b.rating) - Number(a.rating) ||
          Number(b.matches) - Number(a.matches) ||
          String(a.deck || '').localeCompare(String(b.deck || ''), undefined, { sensitivity: 'base' })
        );
      });
    const availableDecks = [...new Set(
      deckRows
        .map(row => String(row.deck || '').trim())
        .filter(isSelectablePlayerEloDeck)
    )];
    const resolvedDeck = availableDecks.includes(String(selectedDeck || '').trim()) ? String(selectedDeck || '').trim() : '';
    const periodRow = resolvedDeck
      ? (deckRows.find(row => String(row.deck || '').trim() === resolvedDeck) || null)
      : overallPeriodRow;
    const historyEntries = resolvedDeck && periodRow
      ? sortPlayerEloHistoryEntries(
          (deckDataset?.historyByPlayer?.get(periodRow.playerKey) || [])
            .filter(entry => String(entry.seasonKey || '').trim() === String(periodRow.seasonKey || '').trim())
        )
      : overallHistoryEntries;
    const eventDeckLookup = getPlayerEventDeckLookup(playerRows);
    const historyWithDeckFallbacks = historyEntries.map(entry => {
      if (entry.deck) {
        return entry;
      }

      const fallbackDeck = eventDeckLookup.get(`${String(entry.date || '').trim()}|||${String(entry.event || '').trim()}`) || '';
      return {
        ...entry,
        deck: fallbackDeck
      };
    });
    const allDeckHistoryEntries = sortPlayerEloHistoryEntries(
      deckRows.flatMap(row => {
        const entries = deckDataset?.historyByPlayer?.get(row.playerKey) || [];
        return entries.filter(entry => String(entry.seasonKey || '').trim() === String(row.seasonKey || '').trim());
      })
    );
    const deckGroups = buildPlayerEloDeckGroups(allDeckHistoryEntries);
    const peakRating = historyWithDeckFallbacks.length > 0
      ? Math.max(...historyWithDeckFallbacks.map(entry => Number(entry.ratingAfter)).filter(Number.isFinite))
      : Number.NEGATIVE_INFINITY;
    const peakEntries = historyWithDeckFallbacks.filter(entry => Number(entry.ratingAfter) === peakRating);
    const runningTableHistoryEntries = sortPlayerEloHistoryEntries(runningAllTimeDataset?.historyByPlayer?.get(selectedPlayer) || []);
    const seasonalTableHistoryEntries = sortPlayerEloHistoryEntries(seasonalDataset?.historyByPlayer?.get(selectedPlayer) || []);

    return {
      dataset: resolvedDeck ? deckDataset : overallDataset,
      overallDataset,
      deckDataset,
      periodRow,
      overallPeriodRow,
      historyEntries: historyWithDeckFallbacks,
      overallHistoryEntries,
      availableDecks,
      selectedDeck: resolvedDeck,
      deckRows,
      deckGroups,
      peakEntries,
      tableElo: {
        eventLookup: buildPlayerTableEloEventLookup({
          runningHistoryEntries: runningTableHistoryEntries,
          seasonalHistoryEntries: seasonalTableHistoryEntries
        }),
        deckLookup: buildPlayerTableDeckEloLookup({
          deckDataset: runningDeckDataset,
          selectedPlayer,
          playerRows
        }),
        rangeLabel: fullEloWindow.rangeLabel
      }
    };
  })().catch(error => {
    playerEloInsightsCache.delete(cacheKey);
    throw error;
  });

  return rememberLimitedCacheEntry(playerEloInsightsCache, cacheKey, insightsPromise);
}

function buildPlayerEloMatchListHtml(rows = []) {
  // Renders Elo match history rows for period/peak Elo drilldowns.
  if (!rows.length) {
    return '<div class="player-rank-drilldown-empty">No rated Elo matches found for this period.</div>';
  }

  return `
    <div class="player-drilldown-event-list">
      ${rows.map(row => {
        const formattedEventName = formatEventName(row.event) || row.event || 'Unknown Event';
        const eventDate = row.date ? formatDate(row.date) : '--';
        const roundLabel = Number.isFinite(Number(row.round)) ? `R${Number(row.round)}` : 'Round --';
        const deckLabel = row.deck || '--';
        const opponentLabel = row.opponent || 'Unknown Opponent';
        const resultLabel = String(row.resultType || '--').toUpperCase();

        return `
          <div class="player-drilldown-event-list-item player-drilldown-event-list-item-mixed-average">
            <div class="player-drilldown-event-list-main">
              <strong>${escapeHtml(formattedEventName)}</strong>
              <span>${escapeHtml(`${eventDate} | ${roundLabel} | ${deckLabel} vs ${opponentLabel}`)}</span>
            </div>
            <div class="player-drilldown-event-list-meta">
              <span>${escapeHtml(resultLabel)}</span>
              <span>${escapeHtml(formatEloRating(row.ratingBefore))} -> ${escapeHtml(formatEloRating(row.ratingAfter))}</span>
              <span>${escapeHtml(formatEloDelta(row.delta))} Elo</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function buildPlayerPeriodEloDrilldownHtml() {
  // Builds the drilldown body for the selected period Elo card.
  const { periodRow, historyEntries, selectedDeck } = currentPlayerEloInsights;
  if (!periodRow) {
    return '<div class="player-rank-drilldown-empty">No Elo results are available for the current Player Analysis filters.</div>';
  }

  const firstMatch = historyEntries[historyEntries.length - 1] || null;
  const latestMatch = historyEntries[0] || null;
  const yearGroups = historyEntries.reduce((acc, entry) => {
    const yearKey = String(entry?.date || '').slice(0, 4);
    if (!yearKey) {
      return acc;
    }

    if (!acc.has(yearKey)) {
      acc.set(yearKey, {
        year: yearKey,
        peakElo: Number.NEGATIVE_INFINITY,
        lastElo: Number.NaN,
        matches: 0
      });
    }

    const group = acc.get(yearKey);
    group.matches += 1;
    if (Number.isFinite(Number(entry.ratingAfter))) {
      group.peakElo = Math.max(group.peakElo, Number(entry.ratingAfter));
      if (!Number.isFinite(group.lastElo) || String(entry.date || '').localeCompare(String(group.lastDate || '')) >= 0) {
        group.lastElo = Number(entry.ratingAfter);
        group.lastDate = String(entry.date || '');
      }
    }

    return acc;
  }, new Map());
  const yearCards = Array.from(yearGroups.values())
    .sort((a, b) => String(a.year).localeCompare(String(b.year)))
    .map(group => buildStatCardHtml({
      title: `Elo ${group.year}`,
      value: formatEloRating(group.lastElo),
      change: `${group.matches} rated matches | Peak ${formatEloRating(group.peakElo)}`,
      icon: '\u{1F4C6}'
    }));
  const uniqueDeckCards = (currentPlayerEloInsights.deckGroups || [])
    .map(group => buildStatCardHtml({
      title: group.deck,
      value: `${formatEloRating(group.peakElo)} Elo`,
      change: `${group.matches} rated matches | ${group.wins}-${group.losses}`,
      icon: '\u{1F0CF}'
    }))
    .join('');
  const peakElo = historyEntries.reduce((maxRating, entry) => {
    return Math.max(maxRating, Number(entry.ratingAfter) || Number.NEGATIVE_INFINITY);
  }, Number(periodRow.rating) || Number.NEGATIVE_INFINITY);

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">Current Filter Window</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(periodRow.displayName || periodRow.playerKey || 'Selected Player')}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(formatEloRating(periodRow.rating))} Elo</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item updated">
          <span class="player-rank-drilldown-summary-label">Current Elo</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatEloRating(periodRow.rating))}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Peak Elo</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(Number.isFinite(peakElo) ? formatEloRating(peakElo) : '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Rated Matches</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(periodRow.matches || 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Wins</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(periodRow.wins || 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Losses</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(periodRow.losses || 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Win Rate</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatWinRatePercentage((Number(periodRow.winRate) || 0) * 100))}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Period Window</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(firstMatch?.date && latestMatch?.date ? `${formatDate(firstMatch.date)} to ${formatDate(latestMatch.date)}` : '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Deck Scope</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(selectedDeck || 'All Decks')}</strong>
        </div>
      </div>
    </article>
    <div class="player-elo-drilldown-cards">
      ${yearCards.join('')}
      ${uniqueDeckCards}
    </div>
    <div class="player-rank-drilldown-context">
      <div class="player-rank-drilldown-context-header">
        <div class="player-rank-drilldown-context-title">Rated Elo Match History</div>
      </div>
      ${buildPlayerEloMatchListHtml(historyEntries)}
    </div>
  `;
}

function buildPlayerPeakEloDrilldownHtml() {
  // Builds the drilldown body for peak Elo moments in the selected filters.
  const peakEntries = currentPlayerEloInsights.peakEntries || [];
  if (!peakEntries.length) {
    return '<div class="player-rank-drilldown-empty">No Elo peaks are available for the current Player Analysis filters.</div>';
  }

  return peakEntries.map(entry => `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">Peak Elo Moment</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(formatEventName(entry.event) || entry.event || 'Unknown Event')}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(formatEloRating(entry.ratingAfter))} Elo</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item updated">
          <span class="player-rank-drilldown-summary-label">Peak Elo</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatEloRating(entry.ratingAfter))}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Event</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatEventName(entry.event) || entry.event || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Round</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(Number.isFinite(Number(entry.round)) ? `Round ${Number(entry.round)}` : '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Date</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(entry.date ? formatDate(entry.date) : '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Deck</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(entry.deck || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Peak Change</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(`${formatEloDelta(entry.delta)} vs ${entry.opponent || 'Unknown Opponent'}`)}</strong>
        </div>
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-header">
          <div class="player-rank-drilldown-context-title">Peak Match Context</div>
        </div>
        ${buildPlayerEloMatchListHtml([entry])}
      </div>
    </article>
  `).join('');
}

function getMostCommonDeckStats(rows = []) {
  const deckCounts = rows.reduce((acc, row) => {
    const deckName = String(row?.Deck || '').trim();
    if (!deckName || deckName === 'No Show') {
      return acc;
    }

    acc[deckName] = (acc[deckName] || 0) + 1;
    return acc;
  }, {});

  const deckEntries = Object.entries(deckCounts);
  if (deckEntries.length === 0) {
    return null;
  }

  const maxCount = Math.max(...deckEntries.map(([, count]) => count));
  const deckNames = deckEntries
    .filter(([, count]) => count === maxCount)
    .map(([deckName]) => deckName)
    .sort((a, b) => a.localeCompare(b));

  return {
    deckLabel: deckNames.join(', '),
    count: maxCount
  };
}

function buildPlayerRankCardHoverItems(categoryKey, data = currentPlayerAnalysisRows) {
  const rows = getPlayerRankDrilldownMatches(categoryKey, data);
  if (rows.length === 0) {
    return [];
  }

  const averageRank = rows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / rows.length;
  const averageWinRate = rows.reduce((sum, row) => sum + getRowWinRateValue(row), 0) / rows.length;
  const mostCommonDeck = getMostCommonDeckStats(rows);

  const items = [
    `${highlightDrilldownText('Average finish')} ${highlightDrilldownText(formatAverageRankText(averageRank), 'number')}`,
    `${highlightDrilldownText('Average WR')} ${highlightDrilldownText(formatWinRatePercentage(averageWinRate), 'number')}`
  ];

  if (mostCommonDeck) {
    items.push(
      `${highlightDrilldownText('Most played deck')} ${highlightDrilldownText(mostCommonDeck.deckLabel)} ${highlightDrilldownText(`(${mostCommonDeck.count}x)`, 'number')}`
    );
  }

  return items;
}

function updatePlayerRankCardHoverNotes(data = currentPlayerAnalysisRows) {
  Object.entries(PLAYER_RANK_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const hoverItems = buildPlayerRankCardHoverItems(categoryKey, data);
    const existingNote = card.querySelector('.player-stat-card-hover-note');

    if (hoverItems.length === 0) {
      card.classList.remove('drilldown-tooltip');
      existingNote?.remove();
      return;
    }

    card.classList.add('drilldown-tooltip');
    const hoverNoteMarkup = buildDrilldownHoverNote(hoverItems, 'player-stat-card-hover-note');

    if (existingNote) {
      existingNote.outerHTML = hoverNoteMarkup;
    } else {
      card.insertAdjacentHTML('beforeend', hoverNoteMarkup);
    }
  });
}

function getBestDeckPilotRow(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((bestRow, row) => {
    const rowRank = Number(row.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(bestRow.Rank) || Number.POSITIVE_INFINITY;

    if (rowRank !== bestRank) {
      return rowRank < bestRank ? row : bestRow;
    }

    const rowWinRate = getRowWinRateValue(row);
    const bestWinRate = getRowWinRateValue(bestRow);
    if (rowWinRate !== bestWinRate) {
      return rowWinRate > bestWinRate ? row : bestRow;
    }

    const rowWins = Number(row.Wins) || 0;
    const bestWins = Number(bestRow.Wins) || 0;
    if (rowWins !== bestWins) {
      return rowWins > bestWins ? row : bestRow;
    }

    return String(row.Player || '').localeCompare(String(bestRow.Player || '')) < 0 ? row : bestRow;
  }, rows[0]);
}

function getSameDeckEventComparisonData(eventRows, playerRow, selectedPlayerKey = '') {
  const playerDeck = String(playerRow?.Deck || '').trim();
  if (!playerDeck || !eventRows || eventRows.length === 0) {
    return null;
  }

  const sameDeckRows = eventRows.filter(row => String(row.Deck || '').trim() === playerDeck);
  if (sameDeckRows.length === 0) {
    return null;
  }

  const averageRank = sameDeckRows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / sameDeckRows.length;
  const averageDeckWinRate = sameDeckRows.reduce((sum, row) => sum + getRowWinRateValue(row), 0) / sameDeckRows.length;
  const bestDeckPilot = getBestDeckPilotRow(sameDeckRows);

  return {
    sameDeckRows,
    averageRank,
    averageDeckWinRate,
    bestDeckPilot,
    bestDeckPilotIsSelectedPlayer: bestDeckPilot && selectedPlayerKey
      ? rowMatchesPlayerKey(bestDeckPilot, selectedPlayerKey)
      : false,
    playerRank: Number(playerRow?.Rank) || Number.NaN,
    playerWinRateValue: getRowWinRateValue(playerRow),
    bestDeckPilotRank: Number(bestDeckPilot?.Rank) || Number.NaN,
    bestDeckPilotWinRate: getRowWinRateValue(bestDeckPilot)
  };
}

function isOnlyCopyDeckEventComparison(comparisonData) {
  return Array.isArray(comparisonData?.sameDeckRows) && comparisonData.sameDeckRows.length === 1;
}

function buildSameDeckEventComparisonNote(comparisonData) {
  if (!comparisonData) {
    return '';
  }

  if (isOnlyCopyDeckEventComparison(comparisonData)) {
    return buildTooltipText([
      'Only copy of this deck in this event.'
    ]);
  }

  return buildTooltipText([
    describeFinishComparison('Your Finish', comparisonData.playerRank, 'deck average finish', comparisonData.averageRank),
    describeFinishComparison('Your Finish', comparisonData.playerRank, 'best same-deck finish', comparisonData.bestDeckPilotRank),
    describeWinRateComparison('Your WR', comparisonData.playerWinRateValue, 'deck average WR', comparisonData.averageDeckWinRate),
    describeWinRateComparison('Your WR', comparisonData.playerWinRateValue, 'best same-deck WR', comparisonData.bestDeckPilotWinRate)
  ]);
}

function getMetricComparisonDirection(subjectValue, referenceValue, { lowerIsBetter = false, tolerance = 0.1 } = {}) {
  if (!Number.isFinite(subjectValue) || !Number.isFinite(referenceValue)) {
    return 'even';
  }

  const difference = subjectValue - referenceValue;
  if (Math.abs(difference) <= tolerance) {
    return 'even';
  }

  if (lowerIsBetter) {
    return difference < 0 ? 'better' : 'worse';
  }

  return difference > 0 ? 'better' : 'worse';
}

function getPlayerDeckEventComparisonTone(comparisonData) {
  if (!comparisonData) {
    return 'mixed-average';
  }

  const rankDirection = getMetricComparisonDirection(comparisonData.playerRank, comparisonData.averageRank, {
    lowerIsBetter: true,
    tolerance: 0.1
  });
  const winRateDirection = getMetricComparisonDirection(comparisonData.playerWinRateValue, comparisonData.averageDeckWinRate, {
    tolerance: 0.1
  });

  const betterCount = [rankDirection, winRateDirection].filter(direction => direction === 'better').length;
  const worseCount = [rankDirection, winRateDirection].filter(direction => direction === 'worse').length;

  if (betterCount > 0 && worseCount === 0) {
    return 'above-average';
  }

  if (worseCount > 0 && betterCount === 0) {
    return 'below-average';
  }

  return 'mixed-average';
}

function getPlayerDeckEventComparisonToneLabel(comparisonTone, comparisonData) {
  if (isOnlyCopyDeckEventComparison(comparisonData)) {
    return 'Only Copy';
  }

  switch (comparisonTone) {
    case 'above-average':
      return 'Above Avg';
    case 'below-average':
      return 'Below Avg';
    default:
      return 'Mixed';
  }
}

function buildPlayerDeckEventLegendHtml() {
  return `
    <div class="player-drilldown-event-legend">
      <div class="player-drilldown-event-legend-note">
        Colors compare each result against the same deck's average finish and win rate in that event. Single-pilot deck entries are labeled Only Copy.
      </div>
      <div class="player-drilldown-event-legend-items">
        <span class="player-drilldown-event-legend-chip player-drilldown-event-legend-chip-above-average">Above average</span>
        <span class="player-drilldown-event-legend-chip player-drilldown-event-legend-chip-mixed-average">Mixed</span>
        <span class="player-drilldown-event-legend-chip player-drilldown-event-legend-chip-below-average">Below average</span>
      </div>
    </div>
  `;
}

function buildDeckPilotsTooltipItems(rows = [], selectedPlayerKey = '') {
  return rows.map(row => {
    const playerName = String(row?.Player || '').trim() || '--';
    const isSelectedPlayer = selectedPlayerKey ? rowMatchesPlayerKey(row, selectedPlayerKey) : false;
    const playerLabel = isSelectedPlayer
      ? `${escapeHtml(playerName)} ${highlightDrilldownText('(You)', 'reference')}`
      : escapeHtml(playerName);

    return `${playerLabel}: ${highlightDrilldownText(`#${row?.Rank ?? '--'}`, 'number')} / ${highlightDrilldownText(String(row?.Wins ?? 0), 'number')} / ${highlightDrilldownText(String(row?.Losses ?? 0), 'number')} / ${highlightDrilldownText(getRowWinRateText(row), 'number')}`;
  });
}

function buildPlayerDeckEventContextHtml(eventRows, playerRow, selectedPlayerKey) {
  const comparisonData = getSameDeckEventComparisonData(eventRows, playerRow, selectedPlayerKey);
  if (!comparisonData) {
    return '';
  }

  const {
    sameDeckRows,
    averageRank,
    averageDeckWinRate,
    bestDeckPilot,
    bestDeckPilotIsSelectedPlayer,
    playerRank,
    playerWinRateValue,
    bestDeckPilotRank,
    bestDeckPilotWinRate
  } = comparisonData;
  const deckPilotsTooltip = buildDeckPilotsTooltipItems(sameDeckRows, selectedPlayerKey);
  const averageRankTooltip = buildTooltipText([
    describeFinishComparison('Deck average finish', averageRank, 'Your Finish', playerRank)
  ]);
  const averageDeckWinRateTooltip = buildTooltipText([
    describeWinRateComparison('Deck average WR', averageDeckWinRate, 'Your WR', playerWinRateValue)
  ]);
  const bestDeckResultTooltip = buildTooltipText([
    describeFinishComparison('Best same-deck finish', bestDeckPilotRank, 'Your Finish', playerRank),
    describeWinRateComparison('Best same-deck WR', bestDeckPilotWinRate, 'Your WR', playerWinRateValue)
  ]);
  const deckPilotsItemClasses = buildDrilldownTooltipClasses(
    'player-rank-drilldown-summary-item',
    deckPilotsTooltip
  );
  const averageRankItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', averageRankTooltip);
  const averageDeckWinRateItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', averageDeckWinRateTooltip);
  const bestDeckResultItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', bestDeckResultTooltip);

  return `
    <div class="player-rank-drilldown-context">
      <div class="player-rank-drilldown-context-title">Same-Deck Results in This Event</div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="${deckPilotsItemClasses}">
          <span class="player-rank-drilldown-summary-label">Deck Pilots</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(sameDeckRows.length)}</strong>
          ${buildDrilldownHoverNote(deckPilotsTooltip, 'player-rank-drilldown-hover-note-scrollable', 'Player / Position / Wins / Losses / WR')}
        </div>
        <div class="${averageRankItemClasses}">
          <span class="player-rank-drilldown-summary-label">Average Deck Finish</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatAverageRankText(averageRank))}</strong>
          ${buildDrilldownHoverNote(averageRankTooltip)}
        </div>
        <div class="${averageDeckWinRateItemClasses}">
          <span class="player-rank-drilldown-summary-label">Average Deck Win Rate</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatWinRatePercentage(averageDeckWinRate))}</strong>
          ${buildDrilldownHoverNote(averageDeckWinRateTooltip)}
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Best Deck Pilot</span>
          <div class="player-rank-drilldown-summary-value player-rank-drilldown-summary-value-stack">
            <span>${escapeHtml(bestDeckPilot?.Player || '--')}</span>
            ${bestDeckPilotIsSelectedPlayer ? '<span class="player-rank-drilldown-badge">You</span>' : ''}
          </div>
        </div>
        <div class="${bestDeckResultItemClasses}">
          <span class="player-rank-drilldown-summary-label">Best Deck Result</span>
          <div class="player-rank-drilldown-summary-value player-rank-drilldown-summary-value-stack">
            <span>#${escapeHtml(bestDeckPilot?.Rank ?? '--')} / ${escapeHtml(bestDeckPilot?.Wins ?? 0)}-${escapeHtml(bestDeckPilot?.Losses ?? 0)} / ${escapeHtml(getRowWinRateText(bestDeckPilot))}</span>
          </div>
          ${buildDrilldownHoverNote(bestDeckResultTooltip)}
        </div>
      </div>
    </div>
  `;
}

function buildPlayerRankTop8Html(eventRows, playerRow, selectedPlayerKey) {
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

  const playerDeck = String(playerRow?.Deck || '');
  const rowsHtml = top8Rows.map(row => {
    const isPlayerRow = selectedPlayerKey ? rowMatchesPlayerKey(row, selectedPlayerKey) : false;
    const isPlayerDeck = playerDeck && row.Deck === playerDeck;
    const rowClasses = [
      'player-rank-drilldown-top8-row',
      isPlayerDeck ? 'player-deck-highlight' : '',
      isPlayerRow ? 'player-row-highlight' : ''
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <tr class="${rowClasses}">
        <td>#${escapeHtml(row.Rank)}</td>
        <td>
          <div class="player-rank-drilldown-cell-stack">
            <span>${escapeHtml(row.Player || '--')}</span>
            ${isPlayerRow ? '<span class="player-rank-drilldown-badge">You</span>' : ''}
          </div>
        </td>
        <td>
          <div class="player-rank-drilldown-cell-stack">
            <span>${escapeHtml(row.Deck || '--')}</span>
            ${isPlayerDeck ? '<span class="player-rank-drilldown-badge player-rank-drilldown-badge-accent">Your Deck</span>' : ''}
          </div>
        </td>
        <td>${escapeHtml(row.Wins ?? 0)}</td>
        <td>${escapeHtml(row.Losses ?? 0)}</td>
        <td>${escapeHtml(getRowWinRateText(row))}</td>
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

function buildPlayerRankDrilldownHtml(categoryKey) {
  // Builds rank-band drilldowns such as Top 1, Top 2-8, and Below Top 32.
  const config = PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey];
  if (!config) {
    return '';
  }

  const matchingRows = getPlayerRankDrilldownMatches(categoryKey);
  if (matchingRows.length === 0) {
    return `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
  }

  const selectedPlayerKey = document.getElementById('playerFilterMenu')?.value || '';
  const eventRowsByName = buildEventRowsByName(matchingRows.map(row => row.Event));

  if (matchingRows.length > 1) {
    return buildPlayerEventAccordionListHtml(matchingRows, {
      includeTop8: config.includeTop8,
      selectedPlayerKey,
      eventRowsByName
    });
  }

  return matchingRows
    .map(playerRow => buildPlayerEventResultDrilldownHtml(playerRow, {
      includeTop8: config.includeTop8,
      selectedPlayerKey,
      eventRowsByName,
      actionButtonHtml: buildPlayerOpenEventAnalysisButtonHtml(playerRow)
    }))
    .join('');
}

function buildPlayerEventAccordionListHtml(
  rows,
  { includeTop8 = true, selectedPlayerKey = '', eventRowsByName = null } = {}
) {
  // Builds expandable event rows shared by rank and summary drilldowns.
  if (!rows || rows.length === 0) {
    return '<div class="player-rank-drilldown-empty">No events found.</div>';
  }

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">Expand an event to inspect the full challenge details, same-deck context, and Top 8.</div>
    </div>
    <div class="event-stat-drilldown-list player-summary-event-list">
      ${rows.map(row => {
        const formattedEventName = formatEventName(row.Event) || row.Event || 'Unknown Event';
        const eventDate = row.Date ? formatDate(row.Date) : '--';
        const eventBodyId = `playerBucketEvent-${String(row.Date || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Event || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Rank || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

        return `
          <article class="player-summary-event-item">
            <button
              type="button"
              class="event-stat-drilldown-list-item player-summary-event-toggle"
              data-player-summary-event-toggle="${escapeHtml(eventBodyId)}"
              aria-expanded="false"
              aria-controls="${escapeHtml(eventBodyId)}"
            >
              <span class="event-stat-drilldown-list-item-date">${escapeHtml(eventDate)}</span>
              <span class="event-stat-drilldown-list-item-main">${escapeHtml(formattedEventName)}</span>
              <span class="event-stat-drilldown-list-item-meta">${escapeHtml(`Finish: #${row.Rank || '--'} | Deck: ${row.Deck || '--'} | ${row.Wins ?? 0}-${row.Losses ?? 0} | ${getRowWinRateText(row)} WR`)}</span>
              <span class="player-summary-event-toggle-indicator drilldown-toggle-indicator" aria-hidden="true">+</span>
            </button>
            <div id="${escapeHtml(eventBodyId)}" class="leaderboard-event-drilldown-body" hidden>
              ${buildPlayerEventResultDrilldownHtml(row, {
                includeTop8,
                selectedPlayerKey,
                eventRowsByName,
                actionButtonHtml: buildPlayerOpenEventAnalysisButtonHtml(row)
              })}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function buildPlayerOpenEventAnalysisButtonHtml(playerRow) {
  if (!playerRow) {
    return '';
  }

  return `
    <div class="event-stat-drilldown-toolbar">
      <button
        type="button"
        class="bubble-button"
        data-player-open-event-analysis="${escapeHtml(String(playerRow.Event || '').trim())}"
        data-player-open-event-type="${escapeHtml(String(playerRow.EventType || '').toLowerCase())}"
      >
        Open in Event Analysis
      </button>
    </div>
  `;
}

function buildPlayerEventResultDrilldownHtml(
  playerRow,
  { includeTop8 = true, selectedPlayerKey = '', eventRowsByName = null, actionButtonHtml = '' } = {}
) {
  // Builds the event-result modal with surrounding deck/top-table context.
  if (!playerRow) {
    return '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
  }

  const formattedEventName = formatEventName(playerRow.Event) || playerRow.Event || 'Unknown Event';
  const eventDate = playerRow.Date ? formatDate(playerRow.Date) : '--';
  const resolvedEventRowsByName = eventRowsByName instanceof Map ? eventRowsByName : buildEventRowsByName([playerRow.Event]);
  const eventRows = resolvedEventRowsByName.get(playerRow.Event) || [];
  const playerRank = Number(playerRow?.Rank) || Number.NaN;
  const playerWinRateValue = getRowWinRateValue(playerRow);
  const playerDeck = String(playerRow?.Deck || '').trim();
  const sameDeckRows = eventRows.filter(row => String(row.Deck || '').trim() === playerDeck);
  const averageRank = sameDeckRows.length > 0
    ? sameDeckRows.reduce((sum, row) => sum + (Number(row.Rank) || 0), 0) / sameDeckRows.length
    : Number.NaN;
  const averageDeckWinRate = sameDeckRows.length > 0
    ? sameDeckRows.reduce((sum, row) => sum + getRowWinRateValue(row), 0) / sameDeckRows.length
    : Number.NaN;
  const bestDeckPilot = sameDeckRows.length > 0 ? getBestDeckPilotRow(sameDeckRows) : null;
  const bestDeckPilotRank = Number(bestDeckPilot?.Rank) || Number.NaN;
  const bestDeckPilotWinRate = getRowWinRateValue(bestDeckPilot);
  const playerRankTooltip = buildTooltipText([
    describeFinishComparison('Your Finish', playerRank, 'deck average finish', averageRank),
    describeFinishComparison('Your Finish', playerRank, 'best same-deck finish', bestDeckPilotRank)
  ]);
  const playerWinRateTooltip = buildTooltipText([
    describeWinRateComparison('Your WR', playerWinRateValue, 'deck average WR', averageDeckWinRate),
    describeWinRateComparison('Your WR', playerWinRateValue, 'best same-deck WR', bestDeckPilotWinRate)
  ]);
  const playerRankItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', playerRankTooltip);
  const playerWinRateItemClasses = buildDrilldownTooltipClasses('player-rank-drilldown-summary-item', playerWinRateTooltip);
  const deckEventContextHtml = buildPlayerDeckEventContextHtml(eventRows, playerRow, selectedPlayerKey);
  const top8Html = includeTop8
    ? buildPlayerRankTop8Html(eventRows, playerRow, selectedPlayerKey)
    : '';

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(eventDate)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(formattedEventName)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">#${escapeHtml(playerRow.Rank)}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="${playerRankItemClasses}">
          <span class="player-rank-drilldown-summary-label">Finish</span>
          <strong class="player-rank-drilldown-summary-value">#${escapeHtml(playerRow.Rank)}</strong>
          ${buildDrilldownHoverNote(playerRankTooltip)}
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Deck Played</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Deck || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Wins</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Wins ?? 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Losses</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow.Losses ?? 0)}</strong>
        </div>
        <div class="${playerWinRateItemClasses}">
          <span class="player-rank-drilldown-summary-label">Win Rate</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(getRowWinRateText(playerRow))}</strong>
          ${buildDrilldownHoverNote(playerWinRateTooltip)}
        </div>
      </div>
      ${deckEventContextHtml}
      ${actionButtonHtml}
      ${top8Html}
    </article>
  `;
}

function buildPlayerSummaryEventListHtml(rows) {
  if (!rows || rows.length === 0) {
    return '<div class="player-rank-drilldown-empty">No events found.</div>';
  }

  const selectedPlayerKey = document.getElementById('playerFilterMenu')?.value || '';
  const eventRowsByName = buildEventRowsByName(rows.map(row => row.Event));

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">Expand a challenge to inspect the event details, same-deck context, full Top 8, and open it in Event Analysis.</div>
    </div>
    <div class="event-stat-drilldown-list player-summary-event-list">
      ${rows.map(row => {
        const formattedEventName = formatEventName(row.Event) || row.Event || 'Unknown Event';
        const eventDate = row.Date ? formatDate(row.Date) : '--';
        const eventBodyId = `playerSummaryEvent-${String(row.Date || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Event || '').replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(row.Rank || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

        return `
          <article class="player-summary-event-item">
            <button
              type="button"
              class="event-stat-drilldown-list-item player-summary-event-toggle"
              data-player-summary-event-toggle="${escapeHtml(eventBodyId)}"
              aria-expanded="false"
              aria-controls="${escapeHtml(eventBodyId)}"
            >
              <span class="event-stat-drilldown-list-item-date">${escapeHtml(eventDate)}</span>
              <span class="event-stat-drilldown-list-item-main">${escapeHtml(formattedEventName)}</span>
              <span class="event-stat-drilldown-list-item-meta">${escapeHtml(`#${row.Rank || '--'} | ${row.Deck || '--'} | ${getRowWinRateText(row)} WR`)}</span>
              <span class="player-summary-event-toggle-indicator drilldown-toggle-indicator" aria-hidden="true">+</span>
            </button>
            <div id="${escapeHtml(eventBodyId)}" class="leaderboard-event-drilldown-body" hidden>
              ${buildPlayerEventResultDrilldownHtml(row, {
                includeTop8: true,
                selectedPlayerKey,
                eventRowsByName,
                actionButtonHtml: buildPlayerOpenEventAnalysisButtonHtml(row)
              })}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function buildPlayerDeckEventListHtml(rows, eventRowsByName = new Map()) {
  if (!rows || rows.length === 0) {
    return '<div class="player-drilldown-event-list-empty">No events found for this deck.</div>';
  }

  return `
    <div class="player-drilldown-event-list">
      ${rows.map(row => {
        const formattedEventName = formatEventName(row.Event) || row.Event || 'Unknown Event';
        const eventDate = row.Date ? formatDate(row.Date) : '--';
        const comparisonData = getSameDeckEventComparisonData(eventRowsByName.get(row.Event) || [], row);
        const comparisonNote = buildSameDeckEventComparisonNote(comparisonData);
        const comparisonTone = getPlayerDeckEventComparisonTone(comparisonData);
        const comparisonToneLabel = getPlayerDeckEventComparisonToneLabel(comparisonTone, comparisonData);
        const itemClasses = buildDrilldownTooltipClasses(
          `player-drilldown-event-list-item player-drilldown-event-list-item-${comparisonTone}`,
          comparisonNote
        );

        return `
          <div class="${itemClasses}">
            <div class="player-drilldown-event-list-main">
              <strong>${escapeHtml(formattedEventName)}</strong>
              <span>${escapeHtml(eventDate)}</span>
            </div>
            <div class="player-drilldown-event-list-meta">
              <span>#${escapeHtml(row.Rank)}</span>
              <span>${escapeHtml(row.Wins ?? 0)}-${escapeHtml(row.Losses ?? 0)}</span>
              <span>${escapeHtml(getRowWinRateText(row))}</span>
              <span class="player-drilldown-event-list-tone player-drilldown-event-list-tone-${comparisonTone}">${escapeHtml(comparisonToneLabel)}</span>
            </div>
            ${buildDrilldownHoverNote(comparisonNote)}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function buildPlayerDeckGroupDrilldownHtml(groups) {
  if (!groups || groups.length === 0) {
    return '<div class="player-rank-drilldown-empty">No deck data found.</div>';
  }

  return groups.map((group, index) => {
    const eventRowsByName = buildEventRowsByName(group.rows.map(row => row.Event));

    return `
      <article class="player-rank-drilldown-event">
        <div class="player-rank-drilldown-event-header">
          <div>
            <div class="player-rank-drilldown-event-date">Deck Summary</div>
            <h4 class="player-rank-drilldown-event-name">${escapeHtml(group.deck)}</h4>
          </div>
          <span class="player-rank-drilldown-rank-badge">${escapeHtml(group.eventCount)} Event${group.eventCount === 1 ? '' : 's'}</span>
        </div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Wins</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(group.wins)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Losses</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(group.losses)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Overall Win Rate</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatWinRatePercentage(group.overallWinRate))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Average Finish</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatAverageRankText(group.averageFinish))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Best Finish</span>
            <strong class="player-rank-drilldown-summary-value">
              #${escapeHtml(group.bestFinishRow?.Rank ?? '--')} ${group.bestFinishRow ? `(${escapeHtml(formatEventName(group.bestFinishRow.Event) || group.bestFinishRow.Event)})` : ''}
            </strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Worst Finish</span>
            <strong class="player-rank-drilldown-summary-value">
              #${escapeHtml(group.worstFinishRow?.Rank ?? '--')} ${group.worstFinishRow ? `(${escapeHtml(formatEventName(group.worstFinishRow.Event) || group.worstFinishRow.Event)})` : ''}
            </strong>
          </div>
        </div>
        <div class="player-rank-drilldown-context">
          <div class="player-rank-drilldown-context-header">
            <div class="player-rank-drilldown-context-title">Event Results</div>
            ${index === 0 ? buildPlayerDeckEventLegendHtml() : ''}
          </div>
          ${buildPlayerDeckEventListHtml(group.rows, eventRowsByName)}
        </div>
      </article>
    `;
  }).join('');
}

function buildPlayerSummaryDrilldownHtml(categoryKey) {
  // Builds summary-card drilldowns such as event history and deck usage.
  const config = PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey];
  if (!config) {
    return '';
  }

  if (categoryKey === 'eloForPeriod') {
    return buildPlayerPeriodEloDrilldownHtml();
  }

  if (categoryKey === 'peakElo') {
    return buildPlayerPeakEloDrilldownHtml();
  }

  const items = getPlayerSummaryDrilldownItems(categoryKey);
  if (items.length === 0) {
    return `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
  }

  if (categoryKey === 'totalEvents') {
    return buildPlayerSummaryEventListHtml(items);
  }

  return buildPlayerDeckGroupDrilldownHtml(items);
}

function updatePlayerRankDrilldownCardStates(data = currentPlayerAnalysisRows) {
  // Marks rank-band cards as clickable only when matching events exist.
  Object.entries(PLAYER_RANK_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const matchCount = getPlayerRankDrilldownMatches(categoryKey, data).length;
    const isDisabled = matchCount === 0;

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

function updatePlayerSummaryDrilldownCardStates(data = currentPlayerAnalysisRows) {
  // Marks main summary cards as clickable only when their drilldowns have items.
  Object.entries(PLAYER_SUMMARY_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const itemCount = getPlayerSummaryDrilldownItems(categoryKey, data).length;
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

function updatePlayerSidebarDrilldownCardStates(data = currentPlayerAnalysisRows) {
  // Marks sidebar deck-stat cards as clickable only when deck rows exist.
  Object.entries(PLAYER_SIDEBAR_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const itemCount = getPlayerSidebarDrilldownItems(categoryKey, data).length;
    const isDisabled = itemCount === 0;

    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
    const cardTitle = getPlayerSidebarCardTitle(config.cardId, config.fallbackTitle);
    card.title = isDisabled
      ? config.emptyMessage
      : `Open ${cardTitle.toLowerCase()} details`;
  });
}

function updatePlayerDeckStatsCardStates(data = currentPlayerAnalysisRows) {
  const cards = document.querySelectorAll('.player-deck-stats-card[data-player-deck-stats-deck]');
  cards.forEach(card => {
    const deckName = String(card.dataset.playerDeckStatsDeck || '').trim();
    const group = getPlayerDeckStatsDrilldownGroup(deckName, data);
    const isDisabled = !group || !Array.isArray(group.rows) || group.rows.length === 0;

    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('role', 'button');
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
    card.title = isDisabled
      ? 'No deck data in the current Player Analysis filters.'
      : `Open deck stats details for ${deckName}`;
  });
}

function renderPlayerRankDrilldown(categoryKey) {
  // Renders the modal for finish-band stat cards.
  const elements = getPlayerRankDrilldownElements();
  const config = PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';
  const matchCount = getPlayerRankDrilldownMatches(categoryKey).length;
  const eventLabel = `${matchCount} event${matchCount === 1 ? '' : 's'}`;
  const selectedDeck = getSelectedPlayerTopFinishDeck();

  elements.title.textContent = `${playerLabel} - ${config.title}${selectedDeck ? ` (${selectedDeck})` : ''}`;
  elements.subtitle.textContent = matchCount > 0
    ? `${eventLabel} in the current Player Analysis filters`
    : config.emptyMessage;
  elements.content.innerHTML = buildPlayerRankDrilldownHtml(categoryKey);
}

function renderPlayerSummaryDrilldown(categoryKey) {
  // Renders the modal for main Player Analysis summary cards.
  const elements = getPlayerRankDrilldownElements();
  const config = PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';
  const items = getPlayerSummaryDrilldownItems(categoryKey);
  const itemLabel = categoryKey === 'totalEvents'
    ? `${items.length} event${items.length === 1 ? '' : 's'}`
    : categoryKey === 'eloForPeriod'
      ? `${currentPlayerEloInsights.historyEntries.length} rated match${currentPlayerEloInsights.historyEntries.length === 1 ? '' : 'es'} in the current period`
      : categoryKey === 'peakElo'
        ? `${items.length} Elo peak${items.length === 1 ? '' : 's'} in the current period`
    : `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`;
  const titleSuffix = currentPlayerEloInsights.selectedDeck && (categoryKey === 'eloForPeriod' || categoryKey === 'peakElo')
    ? ` (${currentPlayerEloInsights.selectedDeck})`
    : '';

  elements.title.textContent = `${playerLabel} - ${config.title}${titleSuffix}`;
  elements.subtitle.textContent = items.length > 0
    ? `${itemLabel} in the current Player Analysis filters`
    : config.emptyMessage;
  elements.content.innerHTML = buildPlayerSummaryDrilldownHtml(categoryKey);
}

function getPlayerSidebarCardTitle(cardId, fallbackTitle = 'Details') {
  return document.getElementById(cardId)?.querySelector('.stat-title')?.textContent?.trim() || fallbackTitle;
}

function renderPlayerSidebarDrilldown(categoryKey) {
  // Renders the modal for right-sidebar deck-stat cards.
  const elements = getPlayerRankDrilldownElements();
  const config = PLAYER_SIDEBAR_DRILLDOWN_CONFIG[categoryKey];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';
  const items = getPlayerSidebarDrilldownItems(categoryKey);
  const itemLabel = `${items.length} deck ${items.length === 1 ? 'entry' : 'entries'}`;

  elements.title.textContent = `${playerLabel} - ${getPlayerSidebarCardTitle(config.cardId, config.fallbackTitle)}`;
  elements.subtitle.textContent = items.length > 0
    ? `${itemLabel} in the current Player Analysis filters`
    : config.emptyMessage;
  elements.content.innerHTML = items.length > 0
    ? buildPlayerDeckGroupDrilldownHtml(items)
    : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
}

function renderPlayerDeckStatsDrilldown(deckName = activePlayerDeckStatsDrilldownDeck) {
  const elements = getPlayerRankDrilldownElements();
  if (!elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';
  const group = getPlayerDeckStatsDrilldownGroup(deckName);

  elements.title.textContent = `${playerLabel} - Deck Stats`;
  elements.subtitle.textContent = group
    ? `${group.deck} | ${group.eventCount} event${group.eventCount === 1 ? '' : 's'} in the current Player Analysis filters`
    : 'No deck data in the current Player Analysis filters.';
  elements.content.innerHTML = group
    ? buildPlayerDeckGroupDrilldownHtml([group])
    : '<div class="player-rank-drilldown-empty">No deck data in the current Player Analysis filters.</div>';
}

function renderPlayerDrilldown(categoryKey) {
  // Delegates modal body rendering based on which Player Analysis card opened it.
  if (categoryKey === 'deckStatsCard') {
    renderPlayerDeckStatsDrilldown();
    return;
  }

  if (PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey]) {
    renderPlayerRankDrilldown(categoryKey);
    return;
  }

  if (PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey]) {
    renderPlayerSummaryDrilldown(categoryKey);
    return;
  }

  if (PLAYER_SIDEBAR_DRILLDOWN_CONFIG[categoryKey]) {
    renderPlayerSidebarDrilldown(categoryKey);
  }
}

function openPlayerDrilldown(categoryKey) {
  // Opens any Player Analysis stat-card drilldown.
  const elements = getPlayerRankDrilldownElements();
  const hasConfig =
    categoryKey === 'deckStatsCard' ||
    Boolean(PLAYER_RANK_DRILLDOWN_CONFIG[categoryKey]) ||
    Boolean(PLAYER_SUMMARY_DRILLDOWN_CONFIG[categoryKey]) ||
    Boolean(PLAYER_SIDEBAR_DRILLDOWN_CONFIG[categoryKey]);

  if (!elements.overlay || !hasConfig) {
    return;
  }

  activePlayerDrilldownCategory = categoryKey;
  renderPlayerDrilldown(categoryKey);
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function findPlayerEventHistoryRow({ eventName = '', eventDate = '', deckName = '', rank = '' } = {}) {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedEventDate = String(eventDate || '').trim();
  const normalizedDeckName = String(deckName || '').trim();
  const normalizedRank = String(rank || '').trim();

  return currentPlayerAnalysisRows.find(row => {
    return (
      String(row?.Event || '').trim() === normalizedEventName &&
      String(row?.Date || '').trim() === normalizedEventDate &&
      String(row?.Deck || '').trim() === normalizedDeckName &&
      String(row?.Rank ?? '').trim() === normalizedRank
    );
  }) || currentPlayerAnalysisRows.find(row => {
    return (
      String(row?.Event || '').trim() === normalizedEventName &&
      String(row?.Date || '').trim() === normalizedEventDate
    );
  }) || null;
}

function openPlayerEventHistoryDrilldown({ eventName = '', eventDate = '', deckName = '', rank = '' } = {}) {
  // Opens a focused drilldown from an event-history row.
  const elements = getPlayerRankDrilldownElements();
  if (!elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const playerRow = findPlayerEventHistoryRow({ eventName, eventDate, deckName, rank });
  const playerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'Selected Player';

  if (!playerRow) {
    elements.title.textContent = `${playerLabel} - Event History`;
    elements.subtitle.textContent = 'Event details are not available for the selected history entry.';
    elements.content.innerHTML = '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
    activePlayerDrilldownCategory = '';
    elements.overlay.hidden = false;
    document.body.classList.add('modal-open');
    return;
  }

  const formattedEventName = formatEventName(playerRow.Event) || playerRow.Event || 'Unknown Event';
  const eventDateLabel = playerRow.Date ? formatDate(playerRow.Date) : '--';
  const deckLabel = String(playerRow.Deck || '').trim() || '--';
  const rankLabel = playerRow.Rank ? `#${playerRow.Rank}` : '#--';

  elements.title.textContent = `${playerLabel} - ${formattedEventName}`;
  elements.subtitle.textContent = `${eventDateLabel} | ${deckLabel} | ${rankLabel} | ${getRowWinRateText(playerRow)} WR`;
  elements.content.innerHTML = buildPlayerEventResultDrilldownHtml(playerRow, { includeTop8: true });
  activePlayerDrilldownCategory = '';
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');

  // Add the "Open in Event Analysis" button
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'bubble-button';
  openBtn.textContent = 'Open in Event Analysis';
  openBtn.style.marginLeft = '10px';
  elements.title.appendChild(openBtn);

  openBtn.addEventListener('click', () => {
    // Switch to Event Analysis
    const eventBtn = document.querySelector('.top-mode-button[data-top-mode="event"]');
    if (eventBtn) eventBtn.click();

    // Set to single mode
    const singleBtn = document.querySelector('.analysis-mode[data-mode="single"]');
    if (singleBtn) singleBtn.click();

    // Set event type
    setSingleEventType(playerRow.EventType.toLowerCase());

    // Update the event filter to populate the menu with the correct events
    updateEventFilter(playerRow.Event, true);

    // Trigger the change event to update the charts
    const eventFilterMenu = document.getElementById('eventFilterMenu');
    if (eventFilterMenu) {
      eventFilterMenu.dispatchEvent(new Event('change'));
    }

    // Close the modal
    closePlayerRankDrilldown();

    // Scroll to top
    window.scrollTo(0, 0);
  });
}

function closePlayerRankDrilldown() {
  const { overlay } = getPlayerRankDrilldownElements();
  if (!overlay) {
    return;
  }

  overlay.hidden = true;
  activePlayerDrilldownCategory = '';
  document.body.classList.remove('modal-open');
}

function openPlayerDeckStatsDrilldown(deckName = '') {
  const normalizedDeckName = String(deckName || '').trim();
  if (!normalizedDeckName) {
    return;
  }

  const group = getPlayerDeckStatsDrilldownGroup(normalizedDeckName);
  if (!group) {
    return;
  }

  activePlayerDeckStatsDrilldownDeck = normalizedDeckName;
  openPlayerDrilldown('deckStatsCard');
}

function openPlayerEventInAnalysis(eventName = '', eventType = '') {
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

  if (normalizedEventType) {
    setSingleEventType(normalizedEventType);
  }

  updateEventFilter(normalizedEventName, true);

  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (eventFilterMenu) {
    eventFilterMenu.dispatchEvent(new Event('change'));
  }

  closePlayerRankDrilldown();
  window.scrollTo(0, 0);
}

function setupPlayerRankDrilldownModal() {
  // Wires close behavior for the Player Analysis drilldown modal.
  const { overlay, closeButton, content } = getPlayerRankDrilldownElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closePlayerRankDrilldown);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closePlayerRankDrilldown();
    }
  });

  content?.addEventListener('click', event => {
    const summaryToggleButton = event.target.closest('[data-player-summary-event-toggle]');
    if (summaryToggleButton) {
      const targetId = summaryToggleButton.dataset.playerSummaryEventToggle || '';
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) {
        return;
      }

      const shouldExpand = summaryToggleButton.getAttribute('aria-expanded') !== 'true';
      summaryToggleButton.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
      const indicator = summaryToggleButton.querySelector('.player-summary-event-toggle-indicator');
      if (indicator) {
        indicator.textContent = shouldExpand ? '-' : '+';
      }
      target.hidden = !shouldExpand;
      return;
    }

    const openEventAnalysisButton = event.target.closest('[data-player-open-event-analysis]');
    if (openEventAnalysisButton) {
      openPlayerEventInAnalysis(
        openEventAnalysisButton.dataset.playerOpenEventAnalysis,
        openEventAnalysisButton.dataset.playerOpenEventType
      );
      return;
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closePlayerRankDrilldown();
    }
  });
}

function setupPlayerRankDrilldownCards() {
  // Wires click/keyboard handlers for finish-band stat cards.
  Object.entries(PLAYER_RANK_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openPlayerDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openPlayerDrilldown(categoryKey);
      }
    });
  });
}

function setupPlayerEventHistoryInteractions() {
  // Uses event delegation so dynamically rendered history rows remain clickable.
  const eventHistoryList = document.getElementById('playerEventsDetails');
  if (!eventHistoryList || eventHistoryList.dataset.drilldownBound === 'true') {
    return;
  }

  eventHistoryList.dataset.drilldownBound = 'true';
  eventHistoryList.addEventListener('click', event => {
    const historyButton = event.target.closest('.player-event-history-item');
    if (!historyButton) {
      return;
    }

    openPlayerEventHistoryDrilldown({
      eventName: historyButton.dataset.playerHistoryEvent,
      eventDate: historyButton.dataset.playerHistoryDate,
      deckName: historyButton.dataset.playerHistoryDeck,
      rank: historyButton.dataset.playerHistoryRank
    });
  });
}

function setupPlayerSummaryDrilldownCards() {
  // Wires click/keyboard handlers for main Player Analysis summary cards.
  Object.entries(PLAYER_SUMMARY_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openPlayerDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openPlayerDrilldown(categoryKey);
      }
    });
  });
}

function setupPlayerSidebarDrilldownCards() {
  // Wires click/keyboard handlers for right-sidebar deck-stat cards.
  Object.entries(PLAYER_SIDEBAR_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openPlayerDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openPlayerDrilldown(categoryKey);
      }
    });
  });
}

function setupPlayerDeckStatsCardInteractions() {
  const root = getPlayerDeckStatsCardsRoot();
  if (!root || root.dataset.drilldownBound === 'true') {
    return;
  }

  const openFromTarget = target => {
    const card = target.closest('.player-deck-stats-card[data-player-deck-stats-deck]');
    if (!card || card.getAttribute('aria-disabled') === 'true') {
      return;
    }

    openPlayerDeckStatsDrilldown(card.dataset.playerDeckStatsDeck || '');
  };

  root.addEventListener('click', event => {
    openFromTarget(event.target);
  });

  root.addEventListener('mouseover', event => {
    const card = event.target.closest('.player-deck-stats-card[data-player-deck-stats-deck]');
    if (!card || card.contains(event.relatedTarget)) {
      return;
    }

    setPlayerDeckStatsCardHoverState(card, true);
  });

  root.addEventListener('mouseout', event => {
    const card = event.target.closest('.player-deck-stats-card[data-player-deck-stats-deck]');
    if (!card || card.contains(event.relatedTarget)) {
      return;
    }

    setPlayerDeckStatsCardHoverState(card, false);
  });

  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const card = event.target.closest('.player-deck-stats-card[data-player-deck-stats-deck]');
    if (!card || card.getAttribute('aria-disabled') === 'true') {
      return;
    }

    event.preventDefault();
    openPlayerDeckStatsDrilldown(card.dataset.playerDeckStatsDeck || '');
  });

  root.addEventListener('focusin', event => {
    const card = event.target.closest('.player-deck-stats-card[data-player-deck-stats-deck]');
    if (card) {
      setPlayerDeckStatsCardHoverState(card, true);
    }
  });

  root.addEventListener('focusout', event => {
    const card = event.target.closest('.player-deck-stats-card[data-player-deck-stats-deck]');
    if (card && !card.contains(event.relatedTarget)) {
      setPlayerDeckStatsCardHoverState(card, false);
    }
  });

  root.dataset.drilldownBound = 'true';
}

function initPlayerSearchDropdown() {
  const playerFilterMenu = document.getElementById('playerFilterMenu');
  if (!playerFilterMenu || playerFilterMenu.dataset.searchEnhanced === 'true') {
    return;
  }

  playerFilterMenu.dataset.searchEnhanced = 'true';
  playerFilterMenu.classList.add('player-filter-select-hidden');
  playerFilterMenu.tabIndex = -1;
  playerFilterMenu.setAttribute('aria-hidden', 'true');

  const searchSelect = document.createElement('div');
  searchSelect.className = 'player-search-select';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'player-search-input';
  searchInput.placeholder = 'Search players...';
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-expanded', 'false');

  const dropdown = document.createElement('div');
  dropdown.id = 'playerFilterMenuDropdown';
  dropdown.className = 'player-search-dropdown';
  dropdown.setAttribute('role', 'listbox');

  searchInput.setAttribute('aria-controls', dropdown.id);

  searchSelect.appendChild(searchInput);
  searchSelect.appendChild(dropdown);
  playerFilterMenu.insertAdjacentElement('afterend', searchSelect);

  let filteredOptions = [];
  let activeIndex = -1;

  const getSelectableOptions = () =>
    Array.from(playerFilterMenu.options)
      .filter(option => option.value && !option.disabled)
      .map(option => ({
        label: option.textContent || option.value,
        value: option.value
      }));

  const getSelectedLabel = () => {
    const selectedOption = playerFilterMenu.selectedOptions[0];
    return selectedOption && selectedOption.value ? selectedOption.textContent || selectedOption.value : '';
  };

  const setDropdownOpen = isOpen => {
    dropdown.classList.toggle('open', isOpen && !searchInput.disabled);
    searchInput.setAttribute('aria-expanded', dropdown.classList.contains('open') ? 'true' : 'false');
  };

  const updateActiveOption = () => {
    const optionElements = dropdown.querySelectorAll('.player-search-option');

    optionElements.forEach((optionElement, index) => {
      const isActive = index === activeIndex;
      optionElement.classList.toggle('active', isActive);
      optionElement.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (activeIndex >= 0 && optionElements[activeIndex]) {
      const activeElement = optionElements[activeIndex];
      searchInput.setAttribute('aria-activedescendant', activeElement.id);
      activeElement.scrollIntoView({ block: 'nearest' });
    } else {
      searchInput.removeAttribute('aria-activedescendant');
    }
  };

  const syncInputFromSelect = () => {
    const selectableOptions = getSelectableOptions();
    const selectedLabel = getSelectedLabel();
    const emptyMessage = playerFilterMenu.options.length > 0
      ? playerFilterMenu.options[0].textContent || 'No Players Available'
      : 'No Players Available';

    if (selectableOptions.length === 0 || !selectedLabel) {
      searchInput.disabled = true;
      searchInput.value = '';
      searchInput.placeholder = emptyMessage;
      dropdown.innerHTML = '';
      filteredOptions = [];
      activeIndex = -1;
      searchInput.removeAttribute('aria-activedescendant');
      setDropdownOpen(false);
      return;
    }

    searchInput.disabled = false;
    searchInput.placeholder = 'Search players...';
    searchInput.value = selectedLabel;

    if (dropdown.classList.contains('open')) {
      renderOptions(searchInput.value.trim().toLowerCase());
    }
  };

  const selectOption = option => {
    if (!option) {
      return;
    }

    const didChange = playerFilterMenu.value !== option.value;
    playerFilterMenu.value = option.value;
    searchInput.value = option.label;
    activeIndex = -1;
    setDropdownOpen(false);

    if (didChange) {
      playerFilterMenu.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  function renderOptions(searchTerm = '') {
    const selectableOptions = getSelectableOptions();
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();

    dropdown.innerHTML = '';

    if (selectableOptions.length === 0) {
      filteredOptions = [];
      activeIndex = -1;
      searchInput.removeAttribute('aria-activedescendant');
      setDropdownOpen(false);
      return;
    }

    filteredOptions = selectableOptions.filter(option => option.label.toLowerCase().includes(normalizedSearchTerm));

    if (filteredOptions.length === 0) {
      activeIndex = -1;
      dropdown.appendChild(createPlayerSearchEmptyState('No matching players.'));
      searchInput.removeAttribute('aria-activedescendant');
      setDropdownOpen(true);
      return;
    }

    const selectedIndex = filteredOptions.findIndex(option => option.value === playerFilterMenu.value);
    if (activeIndex < 0 || activeIndex >= filteredOptions.length) {
      activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    }

    filteredOptions.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.id = `${dropdown.id}-option-${index}`;
      optionElement.className = 'player-search-option';
      optionElement.textContent = option.label;
      optionElement.setAttribute('role', 'option');

      optionElement.addEventListener('mousedown', event => {
        event.preventDefault();
        selectOption(option);
      });

      dropdown.appendChild(optionElement);
    });

    updateActiveOption();
    setDropdownOpen(true);
  }

  searchInput.addEventListener('focus', () => {
    if (searchInput.disabled) {
      return;
    }

    renderOptions('');
    searchInput.select();
  });

  searchInput.addEventListener('click', () => {
    if (searchInput.disabled) {
      return;
    }

    renderOptions('');
  });

  searchInput.addEventListener('input', event => {
    activeIndex = -1;
    renderOptions(event.target.value);
  });

  searchInput.addEventListener('keydown', event => {
    if (searchInput.disabled) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!dropdown.classList.contains('open')) {
        renderOptions(searchInput.value);
        return;
      }

      activeIndex = Math.min(activeIndex + 1, filteredOptions.length - 1);
      updateActiveOption();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!dropdown.classList.contains('open')) {
        renderOptions(searchInput.value);
        return;
      }

      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveOption();
      return;
    }

    if (event.key === 'Enter') {
      if (dropdown.classList.contains('open') && activeIndex >= 0) {
        event.preventDefault();
        selectOption(filteredOptions[activeIndex]);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      syncInputFromSelect();
      setDropdownOpen(false);
    }
  });

  document.addEventListener('mousedown', event => {
    if (!searchSelect.contains(event.target)) {
      syncInputFromSelect();
      setDropdownOpen(false);
    }
  });

  playerFilterMenu.addEventListener('change', syncInputFromSelect);

  const observer = new MutationObserver(() => {
    activeIndex = -1;
    syncInputFromSelect();
  });

  observer.observe(playerFilterMenu, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled']
  });

  syncInputFromSelect();
}

// Wires Player Analysis controls, drilldown modals, card handlers, and exports.
export function initPlayerAnalysis() {
  initPlayerSearchDropdown();
  setupPlayerRawTableFullscreenAction();
  setupPlayerPrimaryChartToggleListeners();
  setupPlayerRankDrilldownModal();
  setupPlayerRankDrilldownCards();
  setupPlayerEventHistoryInteractions();
  setupPlayerSummaryDrilldownCards();
  setupPlayerSidebarDrilldownCards();
  setupPlayerDeckStatsCardInteractions();
  setupPlayerEloDeckFilterListeners();
  document.addEventListener('playerDeckFilterChanged', event => {
    const requestedDeck = String(event?.detail?.selectedDeck || '').trim();
    if (requestedDeck === readSelectedPlayerEloDeck()) {
      return;
    }

    writeSelectedPlayerEloDeck(requestedDeck);
    updatePlayerAnalytics();
  });
  updatePlayerRankDrilldownCardStates();
  updatePlayerSummaryDrilldownCardStates();
  updatePlayerSidebarDrilldownCardStates();
  updatePlayerDeckStatsCardStates();
  console.log('Player Analysis initialized');
}

// Stores the visible Player Analysis rows and refreshes dependent charts/cards.
export function updatePlayerAnalysis(data, eloInsights = currentPlayerEloInsights) {
  // Store the visible rows before asking child charts/cards to render so each
  // component reads the same snapshot.
  currentPlayerAnalysisRows = Array.isArray(data) ? [...data] : [];
  currentPlayerEloInsights = eloInsights || createEmptyPlayerEloInsights();
  populatePlayerAnalysisRawData(data, currentPlayerEloInsights);
  populatePlayerStats(data, currentPlayerEloInsights);
  syncPlayerPrimaryChartView({ refreshVisibleChart: true });
}

// Resolves current player/date/type filters, builds Elo insights, and refreshes
// the Player Analysis view.
export async function updatePlayerAnalytics() {
  // Async Elo/rankings work can finish out of order if the user changes filters
  // quickly. Tag each refresh so stale responses cannot overwrite newer state.
  const requestId = playerAnalyticsRequestId + 1;
  playerAnalyticsRequestId = requestId;
  console.log("Updating player analytics...");
  const startDate = document.getElementById("playerStartDateSelect").value;
  const endDate = document.getElementById("playerEndDateSelect").value;
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
  const selectedPlayerLabel = getSelectedPlayerLabel(playerFilterMenu);
  const selectedEventTypes = getSelectedPlayerEventTypes();
  const scopedRows = getPlayerPresetRows(selectedEventTypes, getPlayerAnalysisActivePreset());

  console.log("Player Analytics Filters:", {
    startDate,
    endDate,
    selectedPlayer,
    selectedPlayerLabel,
    selectedEventTypes
  });

  const baseFilteredData = selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? scopedRows.filter(row => {
        return (
          row.Date >= startDate &&
          row.Date <= endDate &&
          rowMatchesPlayerKey(row, selectedPlayer) &&
          selectedEventTypes.includes(row.EventType.toLowerCase())
        );
      })
    : [];
  // Event-group chips only affect the visible Player Analysis rows. Elo deck
  // scoping still receives the ungrouped base rows for data-quality matching.
  const filteredData = applyPlayerEventGroupFilter(baseFilteredData);
  const selectedPlayerKey = selectedPlayer ? getPlayerIdentityKey(selectedPlayerLabel || selectedPlayer) : '';
  let eloInsights = createEmptyPlayerEloInsights();

  if (selectedPlayerKey && startDate && endDate && selectedEventTypes.length > 0) {
    try {
      eloInsights = await buildPlayerEloInsights({
        selectedPlayer: selectedPlayerKey,
        selectedEventTypes,
        startDate,
        endDate,
        playerRows: filteredData,
        qualityScopedPlayerRows: baseFilteredData,
        selectedDeck: readSelectedPlayerEloDeck()
      });
    } catch (error) {
      console.error('Failed to build player Elo insights.', error);
    }
  }

  if (requestId !== playerAnalyticsRequestId) {
    return;
  }

  console.log("baseFilteredData length in player-analysis:", baseFilteredData.length);
  updatePlayerAnalysis(filteredData, eloInsights);
}

function renderPlayerEventTableRows(rows = []) {
  return rows.map(row => `
    <tr>
      <td>${row.date}</td>
      <td class="event-tooltip" data-tooltip="${row.tooltip}">${row.event}</td>
      <td>${row.players}</td>
      <td>${row.rank}</td>
      <td>${row.deck}</td>
      <td>${row.wins}</td>
      <td>${row.losses}</td>
      <td>${row.winRate.toFixed(1)}%</td>
      <td>${row.deckWinRate.toFixed(1)}%</td>
      <td>${row.deckMeta.toFixed(1)}%</td>
      <td>${formatEloDelta(row.seasonEloDelta)}</td>
      <td>${formatEloRating(row.seasonElo)}</td>
      <td>${formatEloDelta(row.runningEloDelta)}</td>
      <td>${formatEloRating(row.runningElo)}</td>
    </tr>
  `).join("");
}

function renderPlayerDeckTableRows(rows = []) {
  return rows.map(row => `
    <tr>
      <td>${row.deck}</td>
      <td>${row.events}</td>
      <td>${row.wins}</td>
      <td>${row.losses}</td>
      <td>${row.overallWinRate.toFixed(2)}%</td>
      <td class="event-tooltip" data-tooltip="${row.bestDate} - ${row.bestEvent}">${row.bestWinRate.toFixed(2)}%</td>
      <td class="event-tooltip" data-tooltip="${row.worstDate} - ${row.worstEvent}">${row.worstWinRate.toFixed(2)}%</td>
      <td>${formatEloRating(row.deckElo)}</td>
    </tr>
  `).join("");
}

function renderPlayerRawTableRows(rows = [], tableType = 'event') {
  return tableType === 'event'
    ? renderPlayerEventTableRows(rows)
    : renderPlayerDeckTableRows(rows);
}

function getPlayerRawTableSortValue(row, sortKey) {
  const value = row?.[sortKey];
  if (typeof value === 'string') {
    return value.toLowerCase();
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NEGATIVE_INFINITY;
}

function sortPlayerRawTableRows(rows = [], sortKey = 'date', direction = 'asc') {
  const directionMultiplier = direction === 'desc' ? -1 : 1;

  rows.sort((a, b) => {
    const aVal = getPlayerRawTableSortValue(a, sortKey);
    const bVal = getPlayerRawTableSortValue(b, sortKey);

    if (aVal < bVal) {
      return -1 * directionMultiplier;
    }

    if (aVal > bVal) {
      return 1 * directionMultiplier;
    }

    return 0;
  });

  return rows;
}

function markPlayerRawTableSortHeader(tableHead, sortKey, direction) {
  const headers = tableHead.querySelectorAll('th[data-sort]');
  headers.forEach(header => {
    header.classList.remove('asc', 'desc');
    const arrow = header.querySelector('.sort-arrow');
    if (arrow) {
      arrow.textContent = '';
    }
  });

  const activeHeader = tableHead.querySelector(`th[data-sort="${sortKey}"]`);
  if (!activeHeader) {
    return;
  }

  activeHeader.classList.add(direction);
  const activeArrow = activeHeader.querySelector('.sort-arrow');
  if (activeArrow) {
    activeArrow.textContent = direction === 'desc' ? '\u2193' : '\u2191';
  }
}

// Renders the Player Analysis raw/deck data table and table mode controls.
export function populatePlayerAnalysisRawData(data, eloInsights = currentPlayerEloInsights) {
  const rawTableHead = document.getElementById("playerRawTableHead");
  const rawTableBody = document.getElementById("playerRawTableBody");
  const rawTableTitle = document.getElementById("playerRawTableTitle");
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = getSelectedPlayerLabel(playerFilterMenu) || "No Player Selected";
  const tableElo = eloInsights?.tableElo || createEmptyPlayerEloInsights().tableElo;
  const runningEloLabel = tableElo.rangeLabel || '2024-2026';

  rawTableTitle.textContent = `${selectedPlayer} - Event Data`;
  console.log("Setting initial table title:", rawTableTitle.textContent);

  let toggleContainer = document.querySelector('.player-table-toggle');
  if (!toggleContainer) {
    console.log("Creating toggle buttons...");
    toggleContainer = document.createElement('div');
    toggleContainer.className = 'bubble-menu player-table-toggle';
    toggleContainer.innerHTML = `
      <button class="bubble-button table-toggle-btn active" data-table="event">Event Data</button>
      <button class="bubble-button table-toggle-btn" data-table="deck">Deck Data</button>
    `;
    rawTableTitle.insertAdjacentElement('afterend', toggleContainer);
  }

  const updateTable = (tableType) => {
    if (tableType === 'event') {
      rawTableTitle.textContent = `${selectedPlayer} - Event Data`;
      rawTableHead.innerHTML = `
        <tr>
          <th data-sort="date">Date <span class="sort-arrow"></span></th>
          <th data-sort="event">Event <span class="sort-arrow"></span></th>
          <th data-sort="players">Number of Players <span class="sort-arrow"></span></th>
          <th data-sort="rank">Rank <span class="sort-arrow"></span></th>
          <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
          <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
          <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
          <th data-sort="winRate">Player Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="deckWinRate">Deck's Overall Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="deckMeta">Deck's Meta <span class="sort-arrow"></span></th>
          <th data-sort="seasonEloDelta">Season Elo Gained <span class="sort-arrow"></span></th>
          <th data-sort="seasonElo">Season Elo <span class="sort-arrow"></span></th>
          <th data-sort="runningEloDelta">Running Elo Gained <span class="sort-arrow"></span></th>
          <th data-sort="runningElo">Running Elo (${runningEloLabel}) <span class="sort-arrow"></span></th>
        </tr>
      `;

      const rows = sortPlayerRawTableRows(calculatePlayerEventTable(data, {
        eloEventLookup: tableElo.eventLookup
      }), 'date', 'desc');
      updateElementHTML(
        "playerRawTableBody",
        rows.length === 0 ? "<tr><td colspan='14'>No data available</td></tr>" : renderPlayerRawTableRows(rows, tableType)
      );
      markPlayerRawTableSortHeader(rawTableHead, 'date', 'desc');

      currentPlayerRawTableState = {
        tableType,
        title: rawTableTitle.textContent || 'player-event-data',
        rows,
        runningEloLabel
      };
      setupTableSorting(rawTableHead, rawTableBody, rows, tableType);
    } else if (tableType === 'deck') {
      rawTableTitle.textContent = `${selectedPlayer} - Deck Data`;
      rawTableHead.innerHTML = `
        <tr>
          <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
          <th data-sort="events">Number of Events <span class="sort-arrow"></span></th>
          <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
          <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
          <th data-sort="overallWinRate">Overall Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="bestWinRate">Best Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="worstWinRate">Worst Win Rate <span class="sort-arrow"></span></th>
          <th data-sort="deckElo">Elo Deck <span class="sort-arrow"></span></th>
        </tr>
      `;

      const rows = calculatePlayerDeckTable(data, {
        deckEloLookup: tableElo.deckLookup
      });
      updateElementHTML(
        "playerRawTableBody",
        rows.length === 0 ? "<tr><td colspan='8'>No data available</td></tr>" : renderPlayerRawTableRows(rows, tableType)
      );

      currentPlayerRawTableState = {
        tableType,
        title: rawTableTitle.textContent || 'player-deck-data',
        rows,
        runningEloLabel
      };
      setupTableSorting(rawTableHead, rawTableBody, rows, tableType);
    }
  };

  updateTable('event');
  setupPlayerRawTableExportAction();
  const toggleButtons = toggleContainer.querySelectorAll('.table-toggle-btn');
  toggleButtons.forEach(button => button.addEventListener('click', () => {
    console.log(`Toggle clicked: ${button.dataset.table}`);
    toggleButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    updateTable(button.dataset.table);
  }));
}

// Fills Player Analysis stat cards from selected player rows and Elo insights.
export function populatePlayerStats(data, eloInsights = currentPlayerEloInsights) {
  console.log("populatePlayerStats called with data:", data);
  const resolvedSelectedDeck = renderPlayerEloDeckFilter(eloInsights);
  const baseStats = calculatePlayerStats(data, {
    selectedTopFinishDeck: resolvedSelectedDeck
  });
  const deckEloMap = new Map(
    (Array.isArray(eloInsights?.deckGroups) ? eloInsights.deckGroups : []).map(group => [
      String(group?.deck || '').trim(),
      group
    ])
  );
  const stats = {
    ...baseStats,
    deckStatsCards: (Array.isArray(baseStats.deckStatsCards) ? baseStats.deckStatsCards : []).map(card => {
      const deckElo = deckEloMap.get(String(card?.name || '').trim());
      return {
        ...card,
        currentElo: Number.isFinite(Number(deckElo?.latestElo)) ? formatEloRating(deckElo.latestElo) : '--',
        peakElo: Number.isFinite(Number(deckElo?.peakElo)) ? formatEloRating(deckElo.peakElo) : '--'
      };
    })
  };
  const selectedPlayerLabel = getSelectedPlayerLabel(document.getElementById('playerFilterMenu')) || 'No Player Selected';
  const eloScopeLabel = resolvedSelectedDeck ? `Elo with ${resolvedSelectedDeck}` : 'Elo for the Period';
  const peakScopeLabel = resolvedSelectedDeck ? `Peak Elo with ${resolvedSelectedDeck}` : 'Peak Elo';
  const topFinishScopeSuffix = resolvedSelectedDeck ? ` (${resolvedSelectedDeck})` : '';

  // Ensure all stat cards are visible
  ['playerFocusedPlayerCard', 'playerEventsCard', 'playerOverallWinRateCard', 'playerUniqueDecksCard', 'playerMostPlayedCard', 'playerLeastPlayedCard',
   'playerPeriodEloCard', 'playerPeakEloCard', 'playerRankStatsCard'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.style.display = "block";
  });

  // Helper function to safely update DOM elements
  const updateElement = (id, value, property = "textContent") => {
    const element = document.getElementById(id);
    if (element) element[property] = value;
    else console.warn(`Element with ID '${id}' not found in the DOM`);
  };

  const updateQueryElement = (id, selector, value, property = "innerHTML") => {
    const parent = document.getElementById(id);
    if (parent) {
      const element = parent.querySelector(selector);
      if (element) element[property] = value;
      else console.warn(`Selector '${selector}' not found in element with ID '${id}'`);
    } else console.warn(`Parent element with ID '${id}' not found in the DOM`);
  };

  // Simple Cards
  updateQueryElement("playerFocusedPlayerCard", ".stat-value", selectedPlayerLabel);
  updateQueryElement("playerFocusedPlayerCard", ".stat-change", "Current player selection");
  updateQueryElement("playerEventsCard", ".stat-title", stats.eventsTitle);
  updateQueryElement("playerEventsCard", ".stat-value", stats.totalEvents);
  updateQueryElement("playerEventsCard", ".stat-change", stats.eventsDetails);
  updateQueryElement("playerOverallWinRateCard", ".stat-value", stats.overallWinRate);
  updateQueryElement("playerOverallWinRateCard", ".stat-change", stats.overallRecord);
  updateQueryElement("playerPeriodEloCard", ".stat-title", eloScopeLabel);
  updateQueryElement("playerPeriodEloCard", ".stat-value", eloInsights?.periodRow ? formatEloRating(eloInsights.periodRow.rating) : '--');
  updateQueryElement(
    "playerPeriodEloCard",
    ".stat-change",
    eloInsights?.periodRow
      ? `${eloInsights.periodRow.matches || 0} rated matches | ${formatWinRatePercentage((Number(eloInsights.periodRow.winRate) || 0) * 100)} WR${resolvedSelectedDeck ? '' : ` | ${eloInsights.availableDecks?.length || 0} decks tracked`}`
      : 'No rated Elo matches yet'
  );
  updateQueryElement("playerPeakEloCard", ".stat-title", peakScopeLabel);
  updateQueryElement(
    "playerPeakEloCard",
    ".stat-value",
    eloInsights?.peakEntries?.length
      ? formatEloRating(eloInsights.peakEntries[0].ratingAfter)
      : '--'
  );
  updateQueryElement(
    "playerPeakEloCard",
    ".stat-change",
    eloInsights?.peakEntries?.length
      ? `${formatEventName(eloInsights.peakEntries[0].event) || eloInsights.peakEntries[0].event || '--'} | ${Number.isFinite(Number(eloInsights.peakEntries[0].round)) ? `Round ${Number(eloInsights.peakEntries[0].round)}` : '--'}${eloInsights.peakEntries[0].deck ? ` | ${eloInsights.peakEntries[0].deck}` : ''}`
      : 'No Elo peak yet'
  );
  updateQueryElement("playerUniqueDecksCard", ".stat-value", stats.uniqueDecks);
  updateQueryElement("playerMostPlayedCard", ".stat-value", stats.mostPlayedDecks);
  updateQueryElement("playerMostPlayedCard", ".stat-change", stats.mostPlayedCount);
  updateQueryElement("playerLeastPlayedCard", ".stat-value", stats.leastPlayedDecks);
  updateQueryElement("playerLeastPlayedCard", ".stat-change", stats.leastPlayedCount);
  updateQueryElement("playerTop1Card", ".stat-title", `Number of Top 1${topFinishScopeSuffix}`);
  updateQueryElement("playerTop1_8Card", ".stat-title", `Number of Top 2-8${topFinishScopeSuffix}`);
  updateQueryElement("playerTop9_16Card", ".stat-title", `Number of Top 9-16${topFinishScopeSuffix}`);
  updateQueryElement("playerTop17_32Card", ".stat-title", `Number of Top 17-32${topFinishScopeSuffix}`);
  updateQueryElement("playerTop33PlusCard", ".stat-title", `Number of Top 33+${topFinishScopeSuffix}`);

  // Rank Stats
  updateElement("playerTop1", stats.rankStats.top1);
  updateElement("playerTop1_8", stats.rankStats.top1_8);
  updateElement("playerTop9_16", stats.rankStats.top9_16);
  updateElement("playerTop17_32", stats.rankStats.top17_32);
  updateElement("playerTop33Plus", stats.rankStats.top33Plus);
  updateElement("playerTop1%", stats.rankStats.top1Percent);
  updateElement("playerTop1_8%", stats.rankStats.top1_8Percent);
  updateElement("playerTop9_16%", stats.rankStats.top9_16Percent);
  updateElement("playerTop17_32%", stats.rankStats.top17_32Percent);
  updateElement("playerTop33Plus%", stats.rankStats.top33PlusPercent);
  renderPlayerDeckStatsCards(stats.deckStatsCards);

  playerSidebarCardIds.forEach(triggerUpdateAnimation);
  Array.from(document.querySelectorAll('.player-deck-stats-card')).forEach(card => {
    if (card.id) {
      triggerUpdateAnimation(card.id);
    }
  });
  updatePlayerRankDrilldownCardStates(data);
  updatePlayerRankCardHoverNotes(data);
  updatePlayerSummaryDrilldownCardStates(data);
  updatePlayerSidebarDrilldownCardStates(data);
  updatePlayerDeckStatsCardStates(data);

  if (activePlayerDrilldownCategory) {
    renderPlayerDrilldown(activePlayerDrilldownCategory);
  }

}

// Helper Function
function setupTableSorting(tableHead, tableBody, rows, tableType = 'event') {
  const headers = tableHead.querySelectorAll('th[data-sort]');
  headers.forEach(header => header.addEventListener('click', () => {
    const sortKey = header.dataset.sort;
    const isAscending = header.classList.contains('asc');
    headers.forEach(h => { h.classList.remove('asc', 'desc'); h.querySelector('.sort-arrow').textContent = ''; });
    sortPlayerRawTableRows(rows, sortKey, isAscending ? 'desc' : 'asc');
    header.classList.add(isAscending ? 'desc' : 'asc');
    header.querySelector('.sort-arrow').textContent = isAscending ? '\u2193' : '\u2191';
    updateElementHTML("playerRawTableBody", renderPlayerRawTableRows(rows, tableType));
  }));
}

