// Renders the Event Analysis view for both single-event and multi-event modes:
// stat cards, drilldowns, tables, and the data snapshots that support exports.
import {
  getAnalysisRowsForDateRange,
  getAnalysisRowsForSingleEvent
} from '../utils/analysis-data.js';
import { updateEventMetaWinRateChart } from '../charts/single-meta-win-rate.js';
import { updateEventFunnelChart } from '../charts/single-funnel.js';
import { updateMultiMetaWinRateChart } from '../charts/multi-meta-win-rate.js';
import { updateMultiPlayerWinRateChart } from '../charts/multi-player-win-rate.js';
import { updateDeckEvolutionChart } from '../charts/multi-deck-evolution.js';
import { toggleStatCardVisibility, triggerUpdateAnimation, updateElementText, updateElementHTML } from '../utils/dom.js';
import { calculateSingleEventStats, calculateMultiEventStats, calculateDeckStats } from '../utils/data-cards.js';
import { calculateSingleEventRawTable, calculateSingleEventAggregateTable, calculateMultiEventAggregateTable, calculateMultiEventDeckTable } from '../utils/data-tables.js';
import { formatDate, formatPercentage, formatDateRange, formatEventName } from '../utils/format.js';
import { getPlayerIdentityKey } from '../utils/player-names.js';
import { buildRankingsDataset, getRankingsAvailableDates } from '../utils/rankings-data.js';
import { downloadEventAnalysisCsv } from './export-table-csv.js';
import { setSingleEventType, updateEventFilter } from './filters/single-event.js';

function getSelectedEventAnalysisTypes() {
  const eventAnalysisSection = document.getElementById('eventAnalysisSection');
  return Array.from(eventAnalysisSection?.querySelectorAll('.event-type-filter.active') || []).map(button =>
    button.dataset.type.toLowerCase()
  );
}

const singleEventStatCardIds = [
  'singleEventInfoCard',
  'singleTopPlayerCard',
  'singleRunnerUpCard',
  'singleTopDecksCard',
  'singleMostCopiesCard'
];

const multiEventStatCardIds = [
  'multiTotalEventsCard',
  'multiMostPlayersCard',
  'multiLeastPlayersCard',
  'multiTopDecksCard',
  'multiMostCopiesCard'
];

// Keeping drilldown metadata declarative makes it easier to add or rename stat
// cards without having to thread labels and empty states through click handlers.
const SINGLE_EVENT_DRILLDOWN_CONFIG = {
  winner: {
    cardId: 'singleTopPlayerCard',
    title: 'Winner',
    emptyMessage: 'No winner data is available for the selected event.'
  },
  runnerUp: {
    cardId: 'singleRunnerUpCard',
    title: 'Runner-up',
    emptyMessage: 'No runner-up data is available for the selected event.'
  },
  topDecksByRange: {
    cardId: 'singleTopDecksCard',
    title: 'Decks with the most Copies',
    emptyMessage: 'No deck-range data is available for the selected event.'
  },
  mostPopularDeck: {
    cardId: 'singleMostCopiesCard',
    title: 'Most Popular Deck',
    emptyMessage: 'No deck data is available for the selected event.'
  },
  focusedPlayer: {
    cardId: '',
    title: 'Focused Player',
    emptyMessage: 'The selected player is not present in the selected event.'
  }
};

const MULTI_EVENT_DRILLDOWN_CONFIG = {
  totalEvents: {
    cardId: 'multiTotalEventsCard',
    title: 'Total Events',
    emptyMessage: 'No events are available for the current Multi-Event filters.'
  },
  mostPlayersEvent: {
    cardId: 'multiMostPlayersCard',
    title: 'Event with Most Players',
    emptyMessage: 'No event data is available for the current Multi-Event filters.'
  },
  leastPlayersEvent: {
    cardId: 'multiLeastPlayersCard',
    title: 'Event with Least Players',
    emptyMessage: 'No event data is available for the current Multi-Event filters.'
  },
  topDecksByRange: {
    cardId: 'multiTopDecksCard',
    title: 'Decks with the most Copies',
    emptyMessage: 'No deck-range data is available for the current Multi-Event filters.'
  }
};

// These snapshots back the currently visible tables, drilldowns, and CSV
// exports. They are updated only when the user changes the active selection.
let currentSingleEventRows = [];
let currentMultiEventRows = [];
let activeSingleEventDrilldownCategory = '';
let activeSingleEventDeckDrilldownName = '';
let activeSingleEventFocusedPlayerKey = '';
let activeMultiEventDrilldownState = null;
let pendingSingleEventFocusPlayerKey = '';
let singleEventAnalysisRequestId = 0;
let currentSingleEventTableState = {
  group: 'single',
  tableType: 'raw',
  title: 'single-event-table',
  rows: [],
  displayMode: 'percent',
  runningEloLabel: '2024-2026'
};
let currentSingleEventTableElo = createEmptySingleEventTableElo();
let currentMultiEventTableState = {
  group: 'multi',
  tableType: 'aggregate',
  title: 'multi-event-table',
  rows: [],
  displayMode: 'percent'
};

// Rank buckets are shared across cards and drilldowns. Centralizing them keeps
// UI labels and filtering rules aligned when the bucket definitions change.
const TOP_DECK_RANGE_DEFINITIONS = [
  {
    key: 'Top 8',
    label: 'Top 8',
    maxEntries: 8,
    predicate: row => {
      const rank = Number(row?.Rank);
      return rank >= 1 && rank <= 8;
    }
  },
  {
    key: 'Top 16',
    label: 'Top 9-16',
    maxEntries: 8,
    predicate: row => {
      const rank = Number(row?.Rank);
      return rank >= 9 && rank <= 16;
    }
  },
  {
    key: 'Top 32',
    label: 'Top 17-32',
    maxEntries: 16,
    predicate: row => {
      const rank = Number(row?.Rank);
      return rank >= 17 && rank <= 32;
    }
  },
  {
    key: 'Below Top 32',
    label: 'Below Top 32',
    maxEntries: null,
    predicate: row => Number(row?.Rank) > 32
  }
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSingleEventDownloadButton() {
  return document.getElementById('singleEventTableDownloadCsv');
}

function getSingleEventFullscreenButton() {
  return document.getElementById('singleEventTableFullscreenButton');
}

function getSingleEventTableContainer() {
  return document.getElementById('singleEventTableContainer');
}

function getMultiEventDownloadButton() {
  return document.getElementById('multiEventTableDownloadCsv');
}

function exportSingleEventTableCsv() {
  downloadEventAnalysisCsv(currentSingleEventTableState, 'single-event-table');
}

function exportMultiEventTableCsv() {
  downloadEventAnalysisCsv(currentMultiEventTableState, 'multi-event-table');
}

function setupEventTableExportActions() {
  const singleButton = getSingleEventDownloadButton();
  const multiButton = getMultiEventDownloadButton();

  if (singleButton && singleButton.dataset.listenerAdded !== 'true') {
    singleButton.addEventListener('click', exportSingleEventTableCsv);
    singleButton.dataset.listenerAdded = 'true';
  }

  if (multiButton && multiButton.dataset.listenerAdded !== 'true') {
    multiButton.addEventListener('click', exportMultiEventTableCsv);
    multiButton.dataset.listenerAdded = 'true';
  }
}

function updateSingleEventFullscreenButtonState() {
  const button = getSingleEventFullscreenButton();
  const container = getSingleEventTableContainer();
  if (!button || !container) {
    return;
  }

  button.textContent = document.fullscreenElement === container ? 'Exit Full Screen' : 'Full Screen';
}

async function toggleSingleEventTableFullscreen() {
  const container = getSingleEventTableContainer();
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

function setupSingleEventTableFullscreenAction() {
  const button = getSingleEventFullscreenButton();
  if (button && button.dataset.listenerAdded !== 'true') {
    button.addEventListener('click', () => {
      toggleSingleEventTableFullscreen().catch(error => {
        console.error('Failed to toggle single-event table fullscreen mode.', error);
      });
    });
    button.dataset.listenerAdded = 'true';
  }

  if (document.body.dataset.singleEventTableFullscreenBound !== 'true') {
    document.addEventListener('fullscreenchange', updateSingleEventFullscreenButtonState);
    document.body.dataset.singleEventTableFullscreenBound = 'true';
  }

  updateSingleEventFullscreenButtonState();
}

function getSingleEventDrilldownElements() {
  return {
    overlay: document.getElementById('eventStatDrilldownOverlay'),
    title: document.getElementById('eventStatDrilldownTitle'),
    subtitle: document.getElementById('eventStatDrilldownSubtitle'),
    content: document.getElementById('eventStatDrilldownContent'),
    closeButton: document.getElementById('eventStatDrilldownClose')
  };
}

function sortSingleEventRows(rows = []) {
  return [...rows].sort((a, b) => {
    const rankComparison = Number(a?.Rank) - Number(b?.Rank);
    if (rankComparison !== 0) {
      return rankComparison;
    }

    return String(a?.Player || '').localeCompare(String(b?.Player || ''));
  });
}

function getSingleEventRowWinRateValue(row) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const totalMatches = wins + losses;

  if (totalMatches === 0) {
    return Number.NaN;
  }

  return (wins / totalMatches) * 100;
}

function getSingleEventRowWinRateText(row) {
  const winRateValue = getSingleEventRowWinRateValue(row);
  return Number.isFinite(winRateValue) ? formatPercentage(winRateValue) : '--';
}

function formatAverageFinish(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const roundedValue = Math.round(value * 10) / 10;
  return Number.isInteger(roundedValue) ? `#${roundedValue}` : `#${roundedValue.toFixed(1)}`;
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

function createEmptySingleEventTableElo(rangeLabel = '2024-2026') {
  return {
    playerLookup: new Map(),
    rangeLabel
  };
}

const MAX_SINGLE_EVENT_ELO_CACHE_ENTRIES = 12;
const singleEventRankingsDatasetCache = new Map();

function rememberLimitedCacheEntry(cache, key, value, maxEntries = MAX_SINGLE_EVENT_ELO_CACHE_ENTRIES) {
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

function getNormalizedEventTypesKey(eventTypes = []) {
  return [...new Set(
    (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )].sort().join(',');
}

function getFullSingleEventEloDateWindow(eventTypes = []) {
  const dates = getRankingsAvailableDates(eventTypes);
  return {
    startDate: dates[0] || '',
    endDate: dates[dates.length - 1] || '',
    rangeLabel: dates.length > 0
      ? `${dates[0].slice(0, 4)}-${dates[dates.length - 1].slice(0, 4)}`
      : '2024-2026'
  };
}

function getCachedSingleEventRankingsDataset({
  eventTypes = [],
  startDate = '',
  endDate = '',
  resetByYear = false
} = {}) {
  const cacheKey = [
    resetByYear ? 'seasonal' : 'running',
    getNormalizedEventTypesKey(eventTypes),
    String(startDate || '').trim(),
    String(endDate || '').trim()
  ].join('::');

  if (singleEventRankingsDatasetCache.has(cacheKey)) {
    return rememberLimitedCacheEntry(
      singleEventRankingsDatasetCache,
      cacheKey,
      singleEventRankingsDatasetCache.get(cacheKey)
    );
  }

  const datasetPromise = buildRankingsDataset({
    eventTypes,
    startDate,
    endDate
  }, {
    resetByYear,
    entityMode: 'player'
  }).catch(error => {
    singleEventRankingsDatasetCache.delete(cacheKey);
    throw error;
  });

  return rememberLimitedCacheEntry(singleEventRankingsDatasetCache, cacheKey, datasetPromise);
}

function getSingleEventEloEventKey(record = {}) {
  return `${String(record?.Date || record?.date || '').trim()}|||${String(record?.Event || record?.event || '').trim()}`;
}

function getSingleEventEloPlayerLookupKey(record = {}) {
  return `${getSingleEventEloEventKey(record)}|||${getPlayerIdentityKey(record?.Player || record?.player || '')}`;
}

function compareSingleEventEloHistoryEntriesAscending(a, b) {
  return (
    String(a?.date || '').localeCompare(String(b?.date || '')) ||
    String(a?.eventId || '').localeCompare(String(b?.eventId || '')) ||
    String(a?.event || '').localeCompare(String(b?.event || '')) ||
    Number(a?.round || 0) - Number(b?.round || 0)
  );
}

function summarizeSingleEventEloEntries(entries = [], eventRow = {}) {
  const eventKey = getSingleEventEloEventKey(eventRow);
  const matchingEntries = [...(Array.isArray(entries) ? entries : [])]
    .filter(entry => getSingleEventEloEventKey(entry) === eventKey)
    .sort(compareSingleEventEloHistoryEntriesAscending);

  if (matchingEntries.length === 0) {
    return {
      eloDelta: Number.NaN,
      finalElo: Number.NaN,
      matchCount: 0
    };
  }

  return matchingEntries.reduce((summary, entry) => {
    const delta = Number(entry?.delta);
    if (Number.isFinite(delta)) {
      summary.eloDelta += delta;
    }
    if (Number.isFinite(Number(entry?.ratingAfter))) {
      summary.finalElo = Number(entry.ratingAfter);
    }
    summary.matchCount += 1;
    return summary;
  }, {
    eloDelta: 0,
    finalElo: Number.NaN,
    matchCount: 0
  });
}

function buildSingleEventTableEloLookup(eventRows = [], {
  runningDataset = null,
  seasonalDataset = null
} = {}) {
  const playerLookup = new Map();

  (Array.isArray(eventRows) ? eventRows : []).forEach(row => {
    const playerKey = getPlayerIdentityKey(row?.Player);
    const lookupKey = getSingleEventEloPlayerLookupKey(row);
    if (!playerKey || !lookupKey || lookupKey.endsWith('|||')) {
      return;
    }

    const runningSummary = summarizeSingleEventEloEntries(
      runningDataset?.historyByPlayer?.get(playerKey) || [],
      row
    );
    const seasonalSummary = summarizeSingleEventEloEntries(
      seasonalDataset?.historyByPlayer?.get(playerKey) || [],
      row
    );

    if (runningSummary.matchCount === 0 && seasonalSummary.matchCount === 0) {
      return;
    }

    playerLookup.set(lookupKey, {
      seasonEloDelta: seasonalSummary.eloDelta,
      seasonElo: seasonalSummary.finalElo,
      runningEloDelta: runningSummary.eloDelta,
      runningElo: runningSummary.finalElo,
      matchCount: runningSummary.matchCount || seasonalSummary.matchCount || 0
    });
  });

  return playerLookup;
}

async function buildSingleEventTableElo(eventRows = [], eventTypes = []) {
  if (!Array.isArray(eventRows) || eventRows.length === 0) {
    return createEmptySingleEventTableElo();
  }

  const resolvedEventTypes = eventTypes.length > 0
    ? eventTypes
    : [...new Set(eventRows.map(row => String(row?.EventType || '').trim().toLowerCase()).filter(Boolean))];
  const fullEloWindow = getFullSingleEventEloDateWindow(resolvedEventTypes);

  if (!fullEloWindow.startDate || !fullEloWindow.endDate) {
    return createEmptySingleEventTableElo(fullEloWindow.rangeLabel);
  }

  const [runningDataset, seasonalDataset] = await Promise.all([
    getCachedSingleEventRankingsDataset({
      eventTypes: resolvedEventTypes,
      startDate: fullEloWindow.startDate,
      endDate: fullEloWindow.endDate,
      resetByYear: false
    }),
    getCachedSingleEventRankingsDataset({
      eventTypes: resolvedEventTypes,
      startDate: fullEloWindow.startDate,
      endDate: fullEloWindow.endDate,
      resetByYear: true
    })
  ]);

  return {
    playerLookup: buildSingleEventTableEloLookup(eventRows, {
      runningDataset,
      seasonalDataset
    }),
    rangeLabel: fullEloWindow.rangeLabel
  };
}

function getSelectedSingleEventLabel(rows = currentSingleEventRows) {
  const rawEventName = rows[0]?.Event || document.getElementById('eventFilterMenu')?.value || '';
  return formatEventName(rawEventName) || rawEventName || 'Selected Event';
}

function getSelectedSingleEventDateLabel(rows = currentSingleEventRows) {
  const rawDate = rows[0]?.Date || '';
  return rawDate ? formatDate(rawDate) : '--';
}

function getSingleEventWinnerRow(rows = currentSingleEventRows) {
  return sortSingleEventRows(rows).find(row => Number(row?.Rank) === 1) || null;
}

function getSingleEventRunnerUpRow(rows = currentSingleEventRows) {
  return sortSingleEventRows(rows).find(row => Number(row?.Rank) === 2) || null;
}

function getSingleEventMostPopularDeckSummary(rows = currentSingleEventRows) {
  const validRows = (rows || []).filter(row => {
    const deckName = String(row?.Deck || '').trim();
    return deckName && deckName !== 'UNKNOWN' && deckName !== 'No Show';
  });

  if (validRows.length === 0) {
    return {
      deckNames: [],
      copyCount: 0
    };
  }

  const deckCounts = validRows.reduce((acc, row) => {
    const deckName = String(row.Deck || '').trim();
    acc[deckName] = (acc[deckName] || 0) + 1;
    return acc;
  }, {});

  const copyCount = Math.max(...Object.values(deckCounts), 0);
  const deckNames = Object.entries(deckCounts)
    .filter(([, count]) => count === copyCount)
    .map(([deckName]) => deckName)
    .sort((a, b) => a.localeCompare(b));

  return {
    deckNames,
    copyCount
  };
}

function getSingleEventPlayerRowByKey(playerKey = '', rows = currentSingleEventRows) {
  const normalizedPlayerKey = String(playerKey || '').trim();
  if (!normalizedPlayerKey) {
    return null;
  }

  return (Array.isArray(rows) ? rows : []).find(row => {
    return getPlayerIdentityKey(row?.Player) === normalizedPlayerKey;
  }) || null;
}

function getSingleEventBestFinishRow(rows = []) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((bestRow, row) => {
    const rowRank = Number(row?.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(bestRow?.Rank) || Number.POSITIVE_INFINITY;

    if (rowRank !== bestRank) {
      return rowRank < bestRank ? row : bestRow;
    }

    const rowWinRate = getSingleEventRowWinRateValue(row);
    const bestWinRate = getSingleEventRowWinRateValue(bestRow);
    if (rowWinRate !== bestWinRate) {
      return rowWinRate > bestWinRate ? row : bestRow;
    }

    return String(row?.Player || '').localeCompare(String(bestRow?.Player || '')) < 0 ? row : bestRow;
  }, rows[0]);
}

function getSingleEventWorstFinishRow(rows = []) {
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows.reduce((worstRow, row) => {
    const rowRank = Number(row?.Rank) || Number.NEGATIVE_INFINITY;
    const worstRank = Number(worstRow?.Rank) || Number.NEGATIVE_INFINITY;

    if (rowRank !== worstRank) {
      return rowRank > worstRank ? row : worstRow;
    }

    const rowWinRate = getSingleEventRowWinRateValue(row);
    const worstWinRate = getSingleEventRowWinRateValue(worstRow);
    if (rowWinRate !== worstWinRate) {
      return rowWinRate < worstWinRate ? row : worstRow;
    }

    return String(row?.Player || '').localeCompare(String(worstRow?.Player || '')) < 0 ? row : worstRow;
  }, rows[0]);
}

function isTrackedDeckName(deckName) {
  const normalizedDeck = String(deckName || '').trim();
  return normalizedDeck !== '' && normalizedDeck !== 'UNKNOWN' && normalizedDeck !== 'No Show';
}

function getTopDeckRangeSummaries(rows = [], { scope = 'single' } = {}) {
  // Build one shared range model for stat cards and drilldowns. The model keeps
  // finish-band copy counts separate from whole-scope deck performance metrics.
  return TOP_DECK_RANGE_DEFINITIONS.map(definition => {
    const allRangeRows = (rows || []).filter(definition.predicate);
    const trackedRangeRows = allRangeRows.filter(row => isTrackedDeckName(row?.Deck));
    const deckCounts = trackedRangeRows.reduce((acc, row) => {
      const deckName = String(row?.Deck || '').trim();
      acc[deckName] = (acc[deckName] || 0) + 1;
      return acc;
    }, {});
    const maxCopies = Math.max(...Object.values(deckCounts), 0);
    const leadingDeckNames = Object.entries(deckCounts)
      .filter(([, count]) => count === maxCopies)
      .map(([deckName]) => deckName)
      .sort((a, b) => a.localeCompare(b));
    const uniqueDeckCount = Object.keys(deckCounts).length;
    const rangeEntryCount = allRangeRows.length;
    const trackedEntryCount = trackedRangeRows.length;
    const maxEntries = definition.maxEntries ?? rangeEntryCount;
    const isAllUnique = rangeEntryCount > 0 && uniqueDeckCount === trackedEntryCount && maxCopies === 1 && trackedEntryCount === maxEntries;
    const deckSummaries = leadingDeckNames.map(deckName => {
      const deckRangeRows = trackedRangeRows.filter(row => String(row?.Deck || '').trim() === deckName);
      const deckAllRows = (rows || []).filter(row => String(row?.Deck || '').trim() === deckName);
      const totalWins = deckAllRows.reduce((sum, row) => sum + (Number(row?.Wins) || 0), 0);
      const totalLosses = deckAllRows.reduce((sum, row) => sum + (Number(row?.Losses) || 0), 0);
      const averageFinish = deckAllRows.length > 0
        ? deckAllRows.reduce((sum, row) => sum + (Number(row?.Rank) || 0), 0) / deckAllRows.length
        : Number.NaN;
      const overallStats = calculateDeckStats(rows, deckName, rows.length || 0);

      return {
        deckName,
        copiesInRange: deckRangeRows.length,
        rangeSharePercent: rangeEntryCount > 0 ? (deckRangeRows.length / rangeEntryCount) * 100 : 0,
        trackedRangeSharePercent: trackedEntryCount > 0 ? (deckRangeRows.length / trackedEntryCount) * 100 : 0,
        overallMetaShare: overallStats.metaShare,
        overallWinRate: overallStats.winRate,
        averageFinish,
        bestFinishRow: getSingleEventBestFinishRow(deckRangeRows),
        worstFinishRow: getSingleEventWorstFinishRow(deckRangeRows),
        totalWins,
        totalLosses,
        eventCount: scope === 'multi' ? new Set(deckAllRows.map(row => String(row?.Event || '').trim())).size : 1
      };
    });

    return {
      key: definition.key,
      label: definition.label,
      rangeEntryCount,
      trackedEntryCount,
      uniqueDeckCount,
      maxEntries,
      maxCopies,
      leadingDeckNames,
      isAllUnique,
      deckSummaries
    };
  }).filter(summary => summary.rangeEntryCount > 0);
}

function buildTopDeckRangeSectionHtml(rangeSummary, { scope = 'single' } = {}) {
  const deckCountLabel = rangeSummary.leadingDeckNames.length === 1 ? 'Leading Deck' : 'Leading Decks';
  const rangeStatus = rangeSummary.isAllUnique
    ? 'All tracked decks in this band were unique.'
    : `${rangeSummary.leadingDeckNames.length} deck${rangeSummary.leadingDeckNames.length === 1 ? '' : 's'} tied for the lead in this band.`;
  const bandLabel = rangeSummary.label;
  const scopeMetaLabel = scope === 'multi' ? 'Selected-Span Meta Share' : 'Event Meta Share';
  const scopeFinishLabel = scope === 'multi' ? 'Events in Span' : 'Average Finish';

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(rangeStatus)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(rangeSummary.label)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(rangeSummary.rangeEntryCount)} Entries</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">${deckCountLabel}</span>
          <strong class="player-rank-drilldown-summary-value">
            ${rangeSummary.isAllUnique ? 'All Unique Decks' : escapeHtml(rangeSummary.leadingDeckNames.join(', ') || '--')}
          </strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Top Copy Count</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(rangeSummary.maxCopies || 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Tracked Deck Entries</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(rangeSummary.trackedEntryCount)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Unique Decks</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(rangeSummary.uniqueDeckCount)}</strong>
        </div>
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-header">
          <div class="player-rank-drilldown-context-title">Leading Deck Snapshots</div>
        </div>
        <div class="player-drilldown-event-list">
          ${rangeSummary.deckSummaries.map(deckSummary => `
            <div class="player-drilldown-event-list-item">
              <div class="player-drilldown-event-list-main">
                <strong>${escapeHtml(deckSummary.deckName)}</strong>
                <div class="player-drilldown-event-list-main-lines">
                  <span>Best in ${escapeHtml(bandLabel)}: ${deckSummary.bestFinishRow ? `${escapeHtml(deckSummary.bestFinishRow.Player || '--')} (#${escapeHtml(deckSummary.bestFinishRow.Rank ?? '--')})` : '--'}</span>
                  <span>Worst in ${escapeHtml(bandLabel)}: ${deckSummary.worstFinishRow ? `${escapeHtml(deckSummary.worstFinishRow.Player || '--')} (#${escapeHtml(deckSummary.worstFinishRow.Rank ?? '--')})` : '--'}</span>
                </div>
              </div>
              <div class="player-drilldown-event-list-topics">
                <div class="player-drilldown-event-list-topic">${escapeHtml(`Copies in ${bandLabel}: ${deckSummary.copiesInRange}`)}</div>
                <div class="player-drilldown-event-list-topic">${escapeHtml(`Share of ${bandLabel}: ${formatPercentage(deckSummary.rangeSharePercent)}`)}</div>
                <div class="player-drilldown-event-list-topic">${escapeHtml(`${scopeMetaLabel}: ${formatPercentage(deckSummary.overallMetaShare)}`)}</div>
                <div class="player-drilldown-event-list-topic">${escapeHtml(`Overall Win Rate: ${formatPercentage(deckSummary.overallWinRate)}`)}</div>
                <div class="player-drilldown-event-list-topic">${escapeHtml(scope === 'multi' ? `${scopeFinishLabel}: ${deckSummary.eventCount}` : `${scopeFinishLabel}: ${formatAverageFinish(deckSummary.averageFinish)}`)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </article>
  `;
}

function buildTopDeckRangeDrilldownHtml(rows = [], { scope = 'single' } = {}) {
  // The same renderer supports single-event and multi-event ranges; copy changes
  // by scope explain whether percentages refer to one event or the selected span.
  const rangeSummaries = getTopDeckRangeSummaries(rows, { scope });
  if (rangeSummaries.length === 0) {
    return '<div class="player-rank-drilldown-empty">No deck-range data found.</div>';
  }

  const noteText = scope === 'multi'
    ? 'Each section is a finish band. "Copies in band" counts how many results for that deck landed there, "Share of band" shows its slice of that band, and "Selected-Span Meta Share" uses the full current multi-event sample.'
    : 'Each section is a finish band. "Copies in band" counts how many results for that deck landed there, "Share of band" shows its slice of that band, and "Event Meta Share" uses the full selected event.';

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">${escapeHtml(noteText)}</div>
    </div>
    ${rangeSummaries.map(rangeSummary => buildTopDeckRangeSectionHtml(rangeSummary, { scope })).join('')}
  `;
}

function buildSingleEventTop8Html(
  eventRows = currentSingleEventRows,
  { selectedPlayerName = '', highlightedDeckName = '' } = {}
) {
  // Builds the contextual Top 8 table embedded in player/deck drilldowns.
  const top8Rows = sortSingleEventRows(eventRows.filter(row => Number(row?.Rank) >= 1 && Number(row?.Rank) <= 8)).slice(0, 8);
  if (top8Rows.length === 0) {
    return `
      <div class="player-rank-drilldown-top8">
        <div class="player-rank-drilldown-top8-title">Full Top 8</div>
        <div class="player-rank-drilldown-top8-empty">Top 8 data is not available for this event.</div>
      </div>
    `;
  }

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
            ${top8Rows.map(row => {
              const isSelectedPlayer = selectedPlayerName && String(row?.Player || '').trim() === selectedPlayerName;
              const isHighlightedDeck = highlightedDeckName && String(row?.Deck || '').trim() === highlightedDeckName;
              const rowClasses = [
                'player-rank-drilldown-top8-row',
                isSelectedPlayer ? 'player-row-highlight' : '',
                isHighlightedDeck ? 'player-deck-highlight' : ''
              ].filter(Boolean).join(' ');

              return `
                <tr class="${rowClasses}">
                  <td>#${escapeHtml(row?.Rank ?? '--')}</td>
                  <td>
                    <div class="player-rank-drilldown-cell-stack">
                      ${escapeHtml(row?.Player || '--')}
                      ${isSelectedPlayer ? '<span class="player-rank-drilldown-badge">Focus</span>' : ''}
                    </div>
                  </td>
                  <td>
                    <div class="player-rank-drilldown-cell-stack">
                      ${escapeHtml(row?.Deck || '--')}
                      ${isHighlightedDeck ? '<span class="player-rank-drilldown-badge player-rank-drilldown-badge-accent">Focus Deck</span>' : ''}
                    </div>
                  </td>
                  <td>${escapeHtml(row?.Wins ?? 0)}</td>
                  <td>${escapeHtml(row?.Losses ?? 0)}</td>
                  <td>${escapeHtml(getSingleEventRowWinRateText(row))}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildSingleEventDeckPilotsHtml(deckRows = []) {
  // Lists every pilot for a deck in the selected event, ordered by finish.
  if (deckRows.length === 0) {
    return `
      <div class="player-rank-drilldown-top8">
        <div class="player-rank-drilldown-top8-title">Deck Pilots</div>
        <div class="player-rank-drilldown-top8-empty">No pilots found for this deck in the selected event.</div>
      </div>
    `;
  }

  return `
    <div class="player-rank-drilldown-top8">
      <div class="player-rank-drilldown-top8-title">Deck Pilots</div>
      <div class="player-rank-drilldown-top8-scroll">
        <table class="player-rank-drilldown-top8-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Wins</th>
              <th>Losses</th>
              <th>Win Rate</th>
            </tr>
          </thead>
          <tbody>
            ${deckRows.map(row => `
              <tr>
                <td>#${escapeHtml(row?.Rank ?? '--')}</td>
                <td>${escapeHtml(row?.Player || '--')}</td>
                <td>${escapeHtml(row?.Wins ?? 0)}</td>
                <td>${escapeHtml(row?.Losses ?? 0)}</td>
                <td>${escapeHtml(getSingleEventRowWinRateText(row))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildSingleEventPlayerDrilldownHtml(playerRow) {
  // Builds the modal body for winner/runner-up/focused-player cards.
  if (!playerRow) {
    return '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
  }

  const eventRows = currentSingleEventRows;
  const playerDeck = String(playerRow?.Deck || '').trim();
  const sameDeckRows = sortSingleEventRows(eventRows.filter(row => String(row?.Deck || '').trim() === playerDeck));
  const deckStats = calculateDeckStats(eventRows, playerDeck, eventRows.length);
  const averageDeckFinish = sameDeckRows.length > 0
    ? sameDeckRows.reduce((sum, row) => sum + (Number(row?.Rank) || 0), 0) / sameDeckRows.length
    : Number.NaN;
  const bestDeckFinish = getSingleEventBestFinishRow(sameDeckRows);

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(getSelectedSingleEventDateLabel())}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(playerRow?.Player || '--')}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">#${escapeHtml(playerRow?.Rank ?? '--')}</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Deck Played</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerDeck || '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Wins</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow?.Wins ?? 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Losses</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(playerRow?.Losses ?? 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Win Rate</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(getSingleEventRowWinRateText(playerRow))}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Deck Meta Share</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatPercentage(deckStats.metaShare))}</strong>
        </div>
      </div>
      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Same-Deck Field</div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Copies</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(sameDeckRows.length)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Aggregate Deck WR</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatPercentage(deckStats.winRate))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Average Deck Finish</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatAverageFinish(averageDeckFinish))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Best Same-Deck Finish</span>
            <strong class="player-rank-drilldown-summary-value">
              ${bestDeckFinish ? `${escapeHtml(bestDeckFinish.Player || '--')} (#${escapeHtml(bestDeckFinish.Rank ?? '--')})` : '--'}
            </strong>
          </div>
        </div>
      </div>
      ${buildSingleEventTop8Html(eventRows, {
        selectedPlayerName: String(playerRow?.Player || '').trim(),
        highlightedDeckName: playerDeck
      })}
    </article>
  `;
}

function buildSingleEventDeckDrilldownHtml(deckNames = [], copyCount = 0) {
  // Builds the modal body for most-popular-deck cards and chart deck clicks.
  if (deckNames.length === 0) {
    return '<div class="player-rank-drilldown-empty">No deck data found.</div>';
  }

  return deckNames.map(deckName => {
    const deckRows = sortSingleEventRows(currentSingleEventRows.filter(row => String(row?.Deck || '').trim() === deckName));
    const totalWins = deckRows.reduce((sum, row) => sum + (Number(row?.Wins) || 0), 0);
    const totalLosses = deckRows.reduce((sum, row) => sum + (Number(row?.Losses) || 0), 0);
    const deckStats = calculateDeckStats(currentSingleEventRows, deckName, currentSingleEventRows.length);
    const averageFinish = deckRows.length > 0
      ? deckRows.reduce((sum, row) => sum + (Number(row?.Rank) || 0), 0) / deckRows.length
      : Number.NaN;
    const bestFinish = getSingleEventBestFinishRow(deckRows);
    const worstFinish = getSingleEventWorstFinishRow(deckRows);

    return `
      <article class="player-rank-drilldown-event">
        <div class="player-rank-drilldown-event-header">
          <div>
            <div class="player-rank-drilldown-event-date">${escapeHtml(getSelectedSingleEventDateLabel())}</div>
            <h4 class="player-rank-drilldown-event-name">${escapeHtml(deckName)}</h4>
          </div>
          <span class="player-rank-drilldown-rank-badge">${escapeHtml(copyCount)} Cop${copyCount === 1 ? 'y' : 'ies'}</span>
        </div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Meta Share</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatPercentage(deckStats.metaShare))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Aggregate Win Rate</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatPercentage(deckStats.winRate))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Average Finish</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatAverageFinish(averageFinish))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Wins</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(totalWins)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Losses</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(totalLosses)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Best Finish</span>
            <strong class="player-rank-drilldown-summary-value">
              ${bestFinish ? `${escapeHtml(bestFinish.Player || '--')} (#${escapeHtml(bestFinish.Rank ?? '--')})` : '--'}
            </strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Worst Finish</span>
            <strong class="player-rank-drilldown-summary-value">
              ${worstFinish ? `${escapeHtml(worstFinish.Player || '--')} (#${escapeHtml(worstFinish.Rank ?? '--')})` : '--'}
            </strong>
          </div>
        </div>
        ${buildSingleEventDeckPilotsHtml(deckRows)}
        ${buildSingleEventTop8Html(currentSingleEventRows, { highlightedDeckName: deckName })}
      </article>
    `;
  }).join('');
}

function getMultiEventDateRangeLabel() {
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  return formatDateRange(startDate, endDate);
}

function getMultiEventSummaries(rows = currentMultiEventRows) {
  // Collapses selected rows into one event summary each for multi-event cards and
  // drilldowns.
  const events = new Map();

  (rows || []).forEach(row => {
    const eventName = String(row?.Event || '').trim();
    if (!eventName) {
      return;
    }

    if (!events.has(eventName)) {
      events.set(eventName, {
        name: eventName,
        date: String(row?.Date || '').trim(),
        rows: []
      });
    }

    events.get(eventName).rows.push(row);
  });

  return Array.from(events.values())
    .map(summary => ({
      ...summary,
      count: summary.rows.length,
      rows: sortSingleEventRows(summary.rows)
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.name || '').localeCompare(String(b.name || '')));
}

function getMultiEventExtremeSummary(categoryKey, summaries = getMultiEventSummaries()) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return null;
  }

  const rankedSummaries = [...summaries].sort((a, b) => {
    const countComparison = categoryKey === 'leastPlayersEvent'
      ? a.count - b.count
      : b.count - a.count;
    if (countComparison !== 0) {
      return countComparison;
    }

    const dateComparison = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateComparison !== 0) {
      return dateComparison;
    }

    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return rankedSummaries[0] || null;
}

function getMultiEventSummaryByName(eventName, summaries = getMultiEventSummaries()) {
  const normalizedEventName = String(eventName || '').trim();
  return summaries.find(summary => String(summary?.name || '').trim() === normalizedEventName) || null;
}

function buildMultiEventEventOverviewHtml(summary) {
  // Builds the detail card for one event inside a multi-event drilldown.
  if (!summary || !Array.isArray(summary.rows) || summary.rows.length === 0) {
    return '<div class="player-rank-drilldown-empty">Event details are unavailable.</div>';
  }

  const eventRows = summary.rows;
  const winnerRow = getSingleEventWinnerRow(eventRows);
  const runnerUpRow = getSingleEventRunnerUpRow(eventRows);
  const deckSummary = getSingleEventMostPopularDeckSummary(eventRows);
  const popularDeckDetails = deckSummary.deckNames.length > 0
    ? deckSummary.deckNames.map(deckName => {
        const deckStats = calculateDeckStats(eventRows, deckName, eventRows.length);
        return `${deckName} (${formatPercentage(deckStats.metaShare)} meta / ${formatPercentage(deckStats.winRate)} WR)`;
      }).join(', ')
    : '--';

  return `
    <article class="player-rank-drilldown-event">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(getSelectedSingleEventDateLabel(eventRows))}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(getSelectedSingleEventLabel(eventRows))}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(summary.count)} Players</span>
      </div>
      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Winner</span>
          <strong class="player-rank-drilldown-summary-value">
            ${winnerRow ? `${escapeHtml(winnerRow.Player || '--')} / ${escapeHtml(winnerRow.Deck || '--')}` : '--'}
          </strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Winner WR</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(winnerRow ? getSingleEventRowWinRateText(winnerRow) : '--')}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Runner-up</span>
          <strong class="player-rank-drilldown-summary-value">
            ${runnerUpRow ? `${escapeHtml(runnerUpRow.Player || '--')} / ${escapeHtml(runnerUpRow.Deck || '--')}` : '--'}
          </strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Most Popular Deck</span>
          <strong class="player-rank-drilldown-summary-value">
            ${deckSummary.deckNames.length > 0 ? escapeHtml(deckSummary.deckNames.join(', ')) : '--'}
          </strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Popular Deck Copies</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(deckSummary.copyCount || 0)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Popular Deck Snapshot</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(popularDeckDetails)}</strong>
        </div>
      </div>
      ${buildSingleEventTop8Html(eventRows)}
    </article>
  `;
}

function buildMultiEventListHtml(summaries = []) {
  // Renders a sorted event list for multi-event stat-card drilldowns.
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '<div class="player-rank-drilldown-empty">No events found.</div>';
  }

  return `
    <div class="event-stat-drilldown-toolbar">
      <div class="event-stat-drilldown-toolbar-note">Click an event to inspect its winner, most popular deck, and full top 8.</div>
    </div>
    <div class="event-stat-drilldown-list">
      ${summaries.map(summary => {
        const winnerRow = getSingleEventWinnerRow(summary.rows);
        const winnerText = winnerRow ? `${winnerRow.Player || '--'} / ${winnerRow.Deck || '--'}` : '--';

        return `
          <button
            type="button"
            class="event-stat-drilldown-list-item"
            data-event-drilldown-event="${escapeHtml(summary.name)}"
          >
            <span class="event-stat-drilldown-list-item-date">${escapeHtml(getSelectedSingleEventDateLabel(summary.rows))}</span>
            <span class="event-stat-drilldown-list-item-main">${escapeHtml(getSelectedSingleEventLabel(summary.rows))}</span>
            <span class="event-stat-drilldown-list-item-meta">${escapeHtml(`${summary.count} Players | Winner: ${winnerText}`)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderSingleEventDrilldown(categoryKey) {
  // Rebuilds the currently open single-event modal when data/filter state changes.
  const elements = getSingleEventDrilldownElements();
  const config = SINGLE_EVENT_DRILLDOWN_CONFIG[categoryKey];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const eventLabel = getSelectedSingleEventLabel();
  const eventDateLabel = getSelectedSingleEventDateLabel();

  if (categoryKey === 'focusedPlayer') {
    const playerRow = getSingleEventPlayerRowByKey(activeSingleEventFocusedPlayerKey);
    elements.title.textContent = playerRow
      ? `${eventLabel} - ${playerRow.Player || config.title}`
      : `${eventLabel} - ${config.title}`;
    elements.subtitle.textContent = playerRow
      ? `${eventDateLabel} | ${playerRow.Deck || '--'} | #${playerRow.Rank ?? '--'} | ${getSingleEventRowWinRateText(playerRow)} WR`
      : config.emptyMessage;
    elements.content.innerHTML = playerRow
      ? buildSingleEventPlayerDrilldownHtml(playerRow)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'topDecksByRange') {
    const rangeSummaries = getTopDeckRangeSummaries(currentSingleEventRows, { scope: 'single' });
    elements.title.textContent = `${eventLabel} - ${config.title}`;
    elements.subtitle.textContent = rangeSummaries.length > 0
      ? `${eventDateLabel} | ${rangeSummaries.length} finish band${rangeSummaries.length === 1 ? '' : 's'} with tracked deck leaders`
      : config.emptyMessage;
    elements.content.innerHTML = rangeSummaries.length > 0
      ? buildTopDeckRangeDrilldownHtml(currentSingleEventRows, { scope: 'single' })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (categoryKey === 'winner' || categoryKey === 'runnerUp') {
    const playerRow = categoryKey === 'winner'
      ? getSingleEventWinnerRow()
      : getSingleEventRunnerUpRow();

    elements.title.textContent = `${eventLabel} - ${config.title}`;
    elements.subtitle.textContent = playerRow
      ? `${eventDateLabel} | ${playerRow.Player || '--'} with ${playerRow.Deck || '--'} | ${getSingleEventRowWinRateText(playerRow)} WR`
      : config.emptyMessage;
    elements.content.innerHTML = playerRow
      ? buildSingleEventPlayerDrilldownHtml(playerRow)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  const deckSummary = getSingleEventMostPopularDeckSummary();
  const selectedDeckName = String(activeSingleEventDeckDrilldownName || '').trim();
  const selectedDeckCopyCount = selectedDeckName
    ? currentSingleEventRows.filter(row => String(row?.Deck || '').trim() === selectedDeckName).length
    : 0;

  if (selectedDeckName) {
    const selectedDeckStats = calculateDeckStats(currentSingleEventRows, selectedDeckName, currentSingleEventRows.length);
    const selectedDeckSubtitle = selectedDeckCopyCount > 0
      ? `${eventDateLabel} | ${selectedDeckCopyCount} cop${selectedDeckCopyCount === 1 ? 'y' : 'ies'} | ${formatPercentage(selectedDeckStats.metaShare)} Meta | ${formatPercentage(selectedDeckStats.winRate)} WR`
      : `${eventDateLabel} | No entries found for ${selectedDeckName}`;

    elements.title.textContent = `${eventLabel} - ${selectedDeckName}`;
    elements.subtitle.textContent = selectedDeckSubtitle;
    elements.content.innerHTML = selectedDeckCopyCount > 0
      ? buildSingleEventDeckDrilldownHtml([selectedDeckName], selectedDeckCopyCount)
      : `<div class="player-rank-drilldown-empty">${escapeHtml(`${selectedDeckName} is not present in the selected event.`)}</div>`;
    return;
  }

  const deckLabel = deckSummary.deckNames.length > 1 ? 'Most Popular Decks' : config.title;
  const subtitle = deckSummary.deckNames.length > 0
    ? `${eventDateLabel} | ${deckSummary.deckNames.length} deck${deckSummary.deckNames.length === 1 ? '' : 's'} at ${deckSummary.copyCount} cop${deckSummary.copyCount === 1 ? 'y' : 'ies'}`
    : config.emptyMessage;

  elements.title.textContent = `${eventLabel} - ${deckLabel}`;
  elements.subtitle.textContent = subtitle;
  elements.content.innerHTML = deckSummary.deckNames.length > 0
    ? buildSingleEventDeckDrilldownHtml(deckSummary.deckNames, deckSummary.copyCount)
    : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
}

function renderMultiEventDrilldown(state = activeMultiEventDrilldownState) {
  // Rebuilds the currently open multi-event modal from its saved drilldown state.
  const elements = getSingleEventDrilldownElements();
  const config = MULTI_EVENT_DRILLDOWN_CONFIG[state?.category];

  if (!config || !elements.overlay || !elements.title || !elements.subtitle || !elements.content) {
    return;
  }

  const summaries = getMultiEventSummaries();
  const rangeLabel = getMultiEventDateRangeLabel();

  if (state?.category === 'topDecksByRange') {
    const rangeSummaries = getTopDeckRangeSummaries(currentMultiEventRows, { scope: 'multi' });
    elements.title.textContent = `Multi-Event - ${config.title}`;
    elements.subtitle.textContent = rangeSummaries.length > 0
      ? `${rangeSummaries.length} finish band${rangeSummaries.length === 1 ? '' : 's'} across ${rangeLabel}`
      : config.emptyMessage;
    elements.content.innerHTML = rangeSummaries.length > 0
      ? buildTopDeckRangeDrilldownHtml(currentMultiEventRows, { scope: 'multi' })
      : `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  if (state?.category === 'totalEvents' && state?.view !== 'event') {
    elements.title.textContent = `Multi-Event - ${config.title}`;
    elements.subtitle.textContent = summaries.length > 0
      ? `${summaries.length} tournament${summaries.length === 1 ? '' : 's'} in ${rangeLabel}`
      : config.emptyMessage;
    elements.content.innerHTML = buildMultiEventListHtml(summaries);
    return;
  }

  const summary = state?.eventName
    ? getMultiEventSummaryByName(state.eventName, summaries)
    : getMultiEventExtremeSummary(state?.category, summaries);

  if (!summary) {
    elements.title.textContent = `Multi-Event - ${config.title}`;
    elements.subtitle.textContent = config.emptyMessage;
    elements.content.innerHTML = `<div class="player-rank-drilldown-empty">${escapeHtml(config.emptyMessage)}</div>`;
    return;
  }

  const showBackButton = state?.category === 'totalEvents' && state?.view === 'event';
  elements.title.textContent = `Multi-Event - ${getSelectedSingleEventLabel(summary.rows)}`;
  elements.subtitle.textContent = `${getSelectedSingleEventDateLabel(summary.rows)} | ${summary.count} Players | ${rangeLabel}`;
  elements.content.innerHTML = `
    ${showBackButton ? `
      <div class="event-stat-drilldown-toolbar">
        <button type="button" class="bubble-button" data-event-drilldown-back="true">Back to Event List</button>
      </div>
    ` : ''}
    ${buildMultiEventEventOverviewHtml(summary)}
  `;
}

function openSingleEventDrilldown(categoryKey) {
  // Opens a stat-card drilldown for the active single event.
  const elements = getSingleEventDrilldownElements();
  if (!elements.overlay || !SINGLE_EVENT_DRILLDOWN_CONFIG[categoryKey]) {
    return;
  }

  activeMultiEventDrilldownState = null;
  activeSingleEventDrilldownCategory = categoryKey;
  activeSingleEventDeckDrilldownName = '';
  activeSingleEventFocusedPlayerKey = '';
  renderSingleEventDrilldown(categoryKey);
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function openSingleEventPlayerDrilldown(playerName = '') {
  const elements = getSingleEventDrilldownElements();
  const focusedPlayerKey = getPlayerIdentityKey(playerName);
  if (!elements.overlay || !focusedPlayerKey || !getSingleEventPlayerRowByKey(focusedPlayerKey)) {
    return false;
  }

  activeMultiEventDrilldownState = null;
  activeSingleEventDeckDrilldownName = '';
  activeSingleEventFocusedPlayerKey = focusedPlayerKey;
  activeSingleEventDrilldownCategory = 'focusedPlayer';
  renderSingleEventDrilldown('focusedPlayer');
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
  return true;
}

// Opens a single-event deck drilldown from chart clicks or stat-card actions.
export function openSingleEventDeckDrilldown(deckName) {
  const elements = getSingleEventDrilldownElements();
  const normalizedDeckName = String(deckName || '').trim();
  const deckCopyCount = currentSingleEventRows.filter(row => String(row?.Deck || '').trim() === normalizedDeckName).length;

  if (!elements.overlay || !normalizedDeckName || deckCopyCount === 0) {
    return;
  }

  activeMultiEventDrilldownState = null;
  activeSingleEventDrilldownCategory = 'mostPopularDeck';
  activeSingleEventDeckDrilldownName = normalizedDeckName;
  activeSingleEventFocusedPlayerKey = '';
  renderSingleEventDrilldown('mostPopularDeck');
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function openMultiEventDrilldown(categoryKey, options = {}) {
  const elements = getSingleEventDrilldownElements();
  if (!elements.overlay || !MULTI_EVENT_DRILLDOWN_CONFIG[categoryKey]) {
    return;
  }

  activeSingleEventDrilldownCategory = '';
  activeSingleEventFocusedPlayerKey = '';
  activeMultiEventDrilldownState = {
    category: categoryKey,
    view: options.view || (categoryKey === 'totalEvents' ? 'list' : 'event'),
    eventName: options.eventName || ''
  };
  renderMultiEventDrilldown(activeMultiEventDrilldownState);
  elements.overlay.hidden = false;
  document.body.classList.add('modal-open');
}

function closeSingleEventDrilldown() {
  const { overlay } = getSingleEventDrilldownElements();
  if (!overlay) {
    return;
  }

  overlay.hidden = true;
  activeSingleEventDrilldownCategory = '';
  activeSingleEventDeckDrilldownName = '';
  activeSingleEventFocusedPlayerKey = '';
  activeMultiEventDrilldownState = null;
  document.body.classList.remove('modal-open');
}

function applyPendingSingleEventPlayerFocus() {
  const focusedPlayerKey = String(pendingSingleEventFocusPlayerKey || '').trim();
  if (!focusedPlayerKey) {
    return false;
  }

  pendingSingleEventFocusPlayerKey = '';
  const playerRow = getSingleEventPlayerRowByKey(focusedPlayerKey);
  if (!playerRow) {
    activeSingleEventFocusedPlayerKey = '';
    return false;
  }

  return openSingleEventPlayerDrilldown(playerRow.Player || '');
}

function setupSingleEventDrilldownModal() {
  // Wires modal close affordances once.
  const { overlay, closeButton, content } = getSingleEventDrilldownElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closeSingleEventDrilldown);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeSingleEventDrilldown();
    }
  });

  content?.addEventListener('click', event => {
    const backButton = event.target.closest('[data-event-drilldown-back="true"]');
    if (backButton && activeMultiEventDrilldownState?.category === 'totalEvents') {
      activeMultiEventDrilldownState = {
        category: 'totalEvents',
        view: 'list',
        eventName: ''
      };
      renderMultiEventDrilldown(activeMultiEventDrilldownState);
      return;
    }

    const eventButton = event.target.closest('[data-event-drilldown-event]');
    if (eventButton && activeMultiEventDrilldownState?.category === 'totalEvents') {
      activeMultiEventDrilldownState = {
        category: 'totalEvents',
        view: 'event',
        eventName: String(eventButton.dataset.eventDrilldownEvent || '')
      };
      renderMultiEventDrilldown(activeMultiEventDrilldownState);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeSingleEventDrilldown();
    }
  });
}

function updateSingleEventDrilldownCardStates(data = currentSingleEventRows) {
  // Enables only single-event cards whose drilldowns have backing data.
  const winnerRow = getSingleEventWinnerRow(data);
  const runnerUpRow = getSingleEventRunnerUpRow(data);
  const topDeckRangeSummaries = getTopDeckRangeSummaries(data, { scope: 'single' });
  const deckSummary = getSingleEventMostPopularDeckSummary(data);
  const availability = {
    winner: Boolean(winnerRow),
    runnerUp: Boolean(runnerUpRow),
    topDecksByRange: topDeckRangeSummaries.length > 0,
    mostPopularDeck: deckSummary.deckNames.length > 0
  };

  Object.entries(SINGLE_EVENT_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const isDisabled = !availability[categoryKey];
    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
  });
}

function updateMultiEventDrilldownCardStates(data = currentMultiEventRows) {
  const summaries = getMultiEventSummaries(data);
  const mostPlayersSummary = getMultiEventExtremeSummary('mostPlayersEvent', summaries);
  const leastPlayersSummary = getMultiEventExtremeSummary('leastPlayersEvent', summaries);
  const topDeckRangeSummaries = getTopDeckRangeSummaries(data, { scope: 'multi' });
  const availability = {
    totalEvents: summaries.length > 0,
    mostPlayersEvent: Boolean(mostPlayersSummary),
    leastPlayersEvent: Boolean(leastPlayersSummary),
    topDecksByRange: topDeckRangeSummaries.length > 0
  };

  Object.entries(MULTI_EVENT_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card) {
      return;
    }

    const isDisabled = !availability[categoryKey];
    card.classList.add('drilldown-card');
    card.classList.toggle('drilldown-disabled', isDisabled);
    card.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
    card.tabIndex = isDisabled ? -1 : 0;
  });
}

function setupSingleEventDrilldownCards() {
  // Attaches click and keyboard handlers to single-event stat cards.
  Object.entries(SINGLE_EVENT_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openSingleEventDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openSingleEventDrilldown(categoryKey);
      }
    });
  });
}

function setupMultiEventDrilldownCards() {
  Object.entries(MULTI_EVENT_DRILLDOWN_CONFIG).forEach(([categoryKey, config]) => {
    const card = document.getElementById(config.cardId);
    if (!card || card.dataset.drilldownBound === 'true') {
      return;
    }

    card.dataset.drilldownBound = 'true';

    const openIfEnabled = () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        return;
      }

      openMultiEventDrilldown(categoryKey);
    };

    card.addEventListener('click', openIfEnabled);
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && card.getAttribute('aria-disabled') !== 'true') {
        event.preventDefault();
        openMultiEventDrilldown(categoryKey);
      }
    });
  });
}

// Wires Event Analysis modals, stat-card click targets, and CSV export buttons.
export function initEventAnalysis() {
  setupSingleEventTableFullscreenAction();
  setupSingleEventDrilldownModal();
  setupSingleEventDrilldownCards();
  setupMultiEventDrilldownCards();
  updateSingleEventDrilldownCardStates();
  updateMultiEventDrilldownCardStates();
  console.log('Event Analysis initialized');
}

// Stores single-event rows and refreshes cards/tables for the selected event.
export function updateSingleEventAnalysis(data, totalPlayers) {
  const requestId = singleEventAnalysisRequestId + 1;
  singleEventAnalysisRequestId = requestId;
  if (activeMultiEventDrilldownState) {
    closeSingleEventDrilldown();
  }

  currentSingleEventRows = Array.isArray(data) ? [...data] : [];
  currentSingleEventTableElo = createEmptySingleEventTableElo();
  updateEventMetaWinRateChart();
  updateEventFunnelChart();
  updateSingleEventTables(data, 'raw', currentSingleEventTableElo);
  populateSingleEventStats(data);

  buildSingleEventTableElo(currentSingleEventRows, getSelectedEventAnalysisTypes())
    .then(eloInsights => {
      if (requestId !== singleEventAnalysisRequestId) {
        return;
      }

      currentSingleEventTableElo = eloInsights || createEmptySingleEventTableElo();
      const activeTableType = document.querySelector('#singleEventCharts .table-toggle-btn.active')?.dataset.table || 'raw';
      if (activeTableType === 'raw') {
        updateSingleEventTables(currentSingleEventRows, 'raw', currentSingleEventTableElo);
      }
    })
    .catch(error => {
      if (requestId === singleEventAnalysisRequestId) {
        console.error('Failed to build single-event Elo table data.', error);
      }
    });
}

// Stores multi-event rows and refreshes cards/tables for the selected date span.
export function updateMultiEventAnalysis(data) {
  if (activeSingleEventDrilldownCategory) {
    closeSingleEventDrilldown();
  }

  currentMultiEventRows = Array.isArray(data) ? [...data] : [];
  updateMultiMetaWinRateChart();
  updateMultiPlayerWinRateChart();
  updateDeckEvolutionChart();
  updateMultiEventTables(data, 'aggregate');
  populateMultiEventStats(data);
}

// Resolves current single-event filters and refreshes Single Event Analysis.
export function updateEventAnalytics() {
  console.log("Updating event analytics...");
  const selectedEventType = getSelectedEventAnalysisTypes()[0] || "";
  const eventFilterMenu = document.getElementById("eventFilterMenu");
  const selectedEvent = eventFilterMenu?.value || '';
  // Single-event mode always resolves to one event-type bucket plus one event
  // selection, even though the UI uses the shared analysis dataset underneath.
  const eventData = selectedEventType && selectedEvent
    ? getAnalysisRowsForSingleEvent({
        eventType: selectedEventType,
        eventName: selectedEvent
      })
    : [];
  updateSingleEventAnalysis(eventData, eventData.length);
}

// Resolves current multi-event filters and refreshes Multi-Event Analysis.
export function updateMultiEventAnalytics() {
  console.log("Updating multi-event analytics...");
  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = getSelectedEventAnalysisTypes();
  // Multi-event mode keeps the broader date window and event-type scope so the
  // downstream cards and charts all aggregate over the same row subset.
  const filteredData = (startDate && endDate && selectedEventTypes.length > 0) 
    ? getAnalysisRowsForDateRange({
        eventTypes: selectedEventTypes,
        startDate,
        endDate
      })
    : [];
  updateMultiEventAnalysis(filteredData);
}

function setSingleEventTableToggleState(tableType = 'raw') {
  const toggleContainer = document.querySelector('#singleEventCharts .table-toggle');
  if (!toggleContainer) {
    return;
  }

  toggleContainer.querySelectorAll('.table-toggle-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.table === tableType);
  });
}

function setupSingleEventTableToggle() {
  const toggleContainer = document.querySelector('#singleEventCharts .table-toggle');
  if (!toggleContainer || toggleContainer.dataset.listenerAdded === 'true') {
    return;
  }

  toggleContainer.addEventListener('click', event => {
    const button = event.target.closest('.table-toggle-btn');
    if (!button || !toggleContainer.contains(button)) {
      return;
    }

    updateSingleEventTables(currentSingleEventRows, button.dataset.table, currentSingleEventTableElo);
  });
  toggleContainer.dataset.listenerAdded = 'true';
}

function renderSingleEventStandingsRows(rows = []) {
  return rows.map(row => `
    <tr>
      <td>${row.rank}</td>
      <td>${row.player}</td>
      <td>${row.deck}</td>
      <td>${row.wins}</td>
      <td>${row.losses}</td>
      <td>${row.winRate.toFixed(2)}%</td>
      <td>${formatEloDelta(row.seasonEloDelta)}</td>
      <td>${formatEloRating(row.seasonElo)}</td>
      <td>${formatEloDelta(row.runningEloDelta)}</td>
      <td>${formatEloRating(row.runningElo)}</td>
    </tr>
  `).join("");
}

// Renders the single-event table in raw or aggregate mode.
export function updateSingleEventTables(eventData, tableType = 'raw', tableElo = currentSingleEventTableElo) {
  const tableElement = document.getElementById("singleEventTable");
  const tableHead = document.getElementById("singleEventTableHead");
  const tableBody = document.getElementById("singleEventTableBody");
  const tableTitle = document.getElementById("singleEventTableTitle");
  if (!tableElement || !tableHead || !tableBody || !tableTitle) {
    console.error("Single event table elements not found!");
    return;
  }

  tableElement.dataset.view = tableType;
  setSingleEventTableToggleState(tableType);

  if (tableType === 'raw') {
    updateElementHTML("singleEventTableHead", `
      <tr>
        <th data-sort="rank">Rank <span class="sort-arrow"></span></th>
        <th data-sort="player">Player <span class="sort-arrow"></span></th>
        <th data-sort="deck">Deck <span class="sort-arrow"></span></th>
        <th data-sort="wins">Wins <span class="sort-arrow"></span></th>
        <th data-sort="losses">Losses <span class="sort-arrow"></span></th>
        <th data-sort="winRate">Win Rate <span class="sort-arrow"></span></th>
        <th data-sort="seasonEloDelta">Season Elo Gained <span class="sort-arrow"></span></th>
        <th data-sort="seasonElo">Season Elo <span class="sort-arrow"></span></th>
        <th data-sort="runningEloDelta">Running Elo Gained <span class="sort-arrow"></span></th>
        <th data-sort="runningElo">Running Elo (${tableElo?.rangeLabel || '2024-2026'}) <span class="sort-arrow"></span></th>
      </tr>
    `);
    let rawEventName = eventData.length > 0 ? eventData[0].Event : "";
    const eventName = formatEventName(rawEventName);
    updateElementText("singleEventTableTitle", eventName ? `Standings for ${eventName} on ${formatDate(eventData[0].Date)}` : "No Data Available");

    const rows = calculateSingleEventRawTable(eventData, {
      eloPlayerLookup: tableElo?.playerLookup
    });
    const renderTableBody = () => updateElementHTML(
      "singleEventTableBody",
      rows.length === 0 ? "<tr><td colspan='10'>No data available for the selected event.</td></tr>" : renderSingleEventStandingsRows(rows)
    );

    renderTableBody();

    currentSingleEventTableState = {
      group: 'single',
      tableType,
      title: tableTitle.textContent || 'single-event-table',
      rows,
      displayMode: 'raw',
      runningEloLabel: tableElo?.rangeLabel || '2024-2026'
    };
    setupTableSorting(tableHead, tableBody, rows, tableType, () => renderTableBody());
  } else if (tableType === 'aggregate') {
    updateElementHTML("singleEventTableHead", `
      <tr>
        <th rowspan="2" data-sort="deck">Deck <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="count">Number of Players <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="metaShare">% of Meta <span class="sort-arrow"></span></th>
        <th rowspan="2" data-sort="winRate">Win Rate % <span class="sort-arrow"></span></th>
        <th colspan="4" class="top-conversion-header">Top Conversion
          <div class="bubble-menu display-toggle">
            <button class="bubble-button display-toggle-btn raw-btn" data-display="raw">Raw</button>
            <button class="bubble-button display-toggle-btn percent-btn active" data-display="percent">Percent</button>
          </div>
        </th>
      </tr>
      <tr>
        <th data-sort="top8">Top 8 <span class="sort-arrow"></span></th>
        <th data-sort="top16">Top 9-16 <span class="sort-arrow"></span></th>
        <th data-sort="top32">Top 17-32 <span class="sort-arrow"></span></th>
        <th data-sort="belowTop32">Below Top 32 <span class="sort-arrow"></span></th>
      </tr>
    `);
    let rawEventName = eventData.length > 0 ? eventData[0].Event : "";
    const eventName = formatEventName(rawEventName);
    updateElementText("singleEventTableTitle", eventName ? `Aggregate Decks for ${eventName} on ${formatDate(eventData[0].Date)}` : "No Data Available");

    const rows = calculateSingleEventAggregateTable(eventData);
    let displayMode = 'percent';
    const renderTableBody = () => updateElementHTML("singleEventTableBody", rows.length === 0 ? "<tr><td colspan='8'>No data available for the selected event.</td></tr>" : rows.map(row => `
      <tr>
        <td>${row.deck}</td>
        <td>${row.count}</td>
        <td>${row.metaShare.toFixed(1)}%</td>
        <td>${row.winRate.toFixed(1)}%</td>
        <td>${displayMode === 'raw' ? row.top8 : row.top8Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top16 : row.top16Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top32 : row.top32Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.belowTop32 : row.belowTop32Percent.toFixed(1) + '%'}</td>
      </tr>
    `).join(""));

    renderTableBody();
    currentSingleEventTableState = {
      group: 'single',
      tableType,
      title: tableTitle.textContent || 'single-event-table',
      rows,
      displayMode
    };
    setupTableSorting(tableHead, tableBody, rows, tableType, () => renderTableBody());
    setupDisplayToggle(tableHead, () => { 
      displayMode = tableHead.querySelector('.display-toggle-btn.active').dataset.display; 
      currentSingleEventTableState.displayMode = displayMode;
      renderTableBody(); 
    });
  }

  setupEventTableExportActions();
  setupSingleEventTableToggle();
}

// Renders the multi-event table in aggregate mode or focused-deck timeline mode.
export function updateMultiEventTables(filteredData, tableType = 'aggregate', deckName = '') {
  const tableElement = document.getElementById("multiEventTable");
  const tableHead = document.getElementById("multiEventTableHead");
  const tableBody = document.getElementById("multiEventTableBody");
  const tableTitle = document.getElementById("multiEventTableTitle");
  const startDate = document.getElementById("startDateSelect")?.value;
  const endDate = document.getElementById("endDateSelect")?.value;
  if (!tableElement || !tableHead || !tableBody || !tableTitle) {
    console.error("Multi event table elements not found!");
    return;
  }

  const uniqueEvents = [...new Set(filteredData.map(row => row.Event))];
  tableElement.dataset.view = tableType;

  if (tableType === 'aggregate') {
    updateElementHTML("multiEventTableHead", `
      <tr>
        <th rowspan="2" class="multi-table-col-deck" data-sort="deck">Deck <span class="sort-arrow"></span></th>
        <th rowspan="2" class="multi-table-col-meta" data-sort="metaShare"><span class="multi-table-header-stack"><span>Agg.</span><span>Meta</span></span> <span class="sort-arrow"></span></th>
        <th rowspan="2" class="multi-table-col-winrate" data-sort="winRate"><span class="multi-table-header-stack"><span>Agg.</span><span>WR</span></span> <span class="sort-arrow"></span></th>
        <th colspan="4" class="top-conversion-header multi-table-col-conversion-group">
          <div class="multi-table-group-header">
            <span>Top Conversion</span>
            <div class="bubble-menu display-toggle">
              <button class="bubble-button display-toggle-btn raw-btn" data-display="raw">Raw</button>
              <button class="bubble-button display-toggle-btn percent-btn active" data-display="percent">Percent</button>
            </div>
          </div>
        </th>
      </tr>
      <tr>
        <th data-sort="top8">Top 8 <span class="sort-arrow"></span></th>
        <th data-sort="top16">Top 9-16 <span class="sort-arrow"></span></th>
        <th data-sort="top32">Top 17-32 <span class="sort-arrow"></span></th>
        <th data-sort="belowTop32">Below Top 32 <span class="sort-arrow"></span></th>
      </tr>
    `);
    updateElementText("multiEventTableTitle", startDate && endDate ? `Data for ${uniqueEvents.length} Tournaments from ${formatDate(startDate)} to ${formatDate(endDate)}` : "Please Select a Date Range");

    const rows = calculateMultiEventAggregateTable(filteredData);
    let displayMode = 'percent';
    const renderTableBody = () => updateElementHTML("multiEventTableBody", rows.length === 0 ? "<tr><td colspan='7'>No data available for the selected filters.</td></tr>" : rows.map(row => `
      <tr>
        <td>${row.deck}</td>
        <td>${row.metaShare.toFixed(1)}%</td>
        <td>${row.winRate.toFixed(1)}%</td>
        <td>${displayMode === 'raw' ? row.top8 : row.top8Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top16 : row.top16Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top32 : row.top32Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.belowTop32 : row.belowTop32Percent.toFixed(1) + '%'}</td>
      </tr>
    `).join(""));

    renderTableBody();
    currentMultiEventTableState = {
      group: 'multi',
      tableType,
      title: tableTitle.textContent || 'multi-event-table',
      rows,
      displayMode
    };
    setupTableSorting(tableHead, tableBody, rows, tableType, () => renderTableBody());
    setupDisplayToggle(tableHead, () => { 
      displayMode = tableHead.querySelector('.display-toggle-btn.active').dataset.display; 
      currentMultiEventTableState.displayMode = displayMode;
      renderTableBody(); 
    });
  } else if (tableType === 'deck') {
    updateElementHTML("multiEventTableHead", `
      <tr>
        <th rowspan="2" class="multi-table-col-date" data-sort="date">Date <span class="sort-arrow"></span></th>
        <th rowspan="2" class="multi-table-col-event" data-sort="event">Event <span class="sort-arrow"></span></th>
        <th rowspan="2" class="multi-table-col-meta" data-sort="metaShare"><span class="multi-table-header-stack"><span>Meta</span><span>Share</span></span> <span class="sort-arrow"></span></th>
        <th rowspan="2" class="multi-table-col-winrate" data-sort="winRate"><span class="multi-table-header-stack"><span>Win</span><span>Rate</span></span> <span class="sort-arrow"></span></th>
        <th colspan="4" class="top-conversion-header multi-table-col-conversion-group">
          <div class="multi-table-group-header">
            <span>Top Conversion</span>
            <div class="bubble-menu display-toggle">
              <button class="bubble-button display-toggle-btn raw-btn" data-display="raw">Raw</button>
              <button class="bubble-button display-toggle-btn percent-btn active" data-display="percent">Percent</button>
            </div>
          </div>
        </th>
      </tr>
      <tr>
        <th data-sort="top8">Top 8 <span class="sort-arrow"></span></th>
        <th data-sort="top16">Top 9-16 <span class="sort-arrow"></span></th>
        <th data-sort="top32">Top 17-32 <span class="sort-arrow"></span></th>
        <th data-sort="belowTop32">Below Top 32 <span class="sort-arrow"></span></th>
      </tr>
    `);
    updateElementText("multiEventTableTitle", startDate && endDate && deckName ? `Data for ${deckName} from ${formatDate(startDate)} to ${formatDate(endDate)}` : "Please Select a Date Range and Deck");

    const rows = calculateMultiEventDeckTable(filteredData, deckName);
    let displayMode = 'percent';
    const renderTableBody = () => updateElementHTML("multiEventTableBody", rows.length === 0 ? "<tr><td colspan='8'>No data available for the selected deck and filters.</td></tr>" : rows.map(row => `
      <tr>
        <td>${formatDate(row.date)}</td>
        <td class="event-tooltip" data-tooltip="${formatEventName(row.event)} had ${row.totalPlayers} Players, won by ${row.winner} w/ ${row.winnerDeck}">${formatEventName(row.event)}</td>
        <td>${row.metaShare.toFixed(1)}%</td>
        <td>${row.winRate.toFixed(1)}%</td>
        <td>${displayMode === 'raw' ? row.top8 : row.top8Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top16 : row.top16Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.top32 : row.top32Percent.toFixed(1) + '%'}</td>
        <td>${displayMode === 'raw' ? row.belowTop32 : row.belowTop32Percent.toFixed(1) + '%'}</td>
      </tr>
    `).join(""));

    renderTableBody();
    currentMultiEventTableState = {
      group: 'multi',
      tableType,
      title: tableTitle.textContent || 'multi-event-table',
      rows,
      displayMode
    };
    setupTableSorting(tableHead, tableBody, rows, tableType, () => renderTableBody());
    setupDisplayToggle(tableHead, () => { 
      displayMode = tableHead.querySelector('.display-toggle-btn.active').dataset.display; 
      currentMultiEventTableState.displayMode = displayMode;
      renderTableBody(); 
    });
  }

  setupEventTableExportActions();
}

// Fills the Single Event stat cards from filtered event rows.
export function populateSingleEventStats(filteredData) {
  const stats = calculateSingleEventStats(filteredData);
  toggleStatCardVisibility("singleEventInfoCard", true);
  updateElementText("eventInfoName", formatEventName(stats.eventName));
  updateElementText("eventInfoDate", formatDate(stats.eventDate));
  updateElementText("eventInfoPlayers", stats.totalPlayers);
  toggleStatCardVisibility("singleTopPlayerCard", true);
  updateElementText("singleTopPlayer", stats.topPlayer);
  updateElementText("singleTopPlayerDetails", stats.topPlayerDetails);
  toggleStatCardVisibility("singleRunnerUpCard", true);
  updateElementText("singleRunnerUp", stats.runnerUp);
  updateElementText("singleRunnerUpDetails", stats.runnerUpDetails);
  toggleStatCardVisibility("singleMostCopiesCard", true);
  updateElementText("singleMostCopiesDeck", stats.mostCopiesDeck);
  updateElementText("singleMostCopiesDetails", stats.mostCopiesDetails);
  toggleStatCardVisibility("singleTopDecksCard", true);
  updateElementHTML("singleTopDecksDetails", filteredData.length === 0 ? "No Data" : Object.entries(stats.topDecks)
    .map(([range, decks]) => {
      if (!decks || decks.length === 0) return "";
      const validDecks = decks.filter(deck => deck !== "UNKNOWN" && deck !== "No Show");
      if (validDecks.length === 0) return "";
      const deckCounts = stats.deckCountsByRange[range];
      const maxCopies = Math.max(...Object.values(deckCounts), 0);
      if (maxCopies === 0) return "";
      const mostPlayedDecks = Object.entries(deckCounts).filter(([_, count]) => count === maxCopies).map(([deck]) => deck);
      const rangeCount = {
        "Top 8": filteredData.filter(row => row.Rank >= 1 && row.Rank <= 8).length,
        "Top 16": filteredData.filter(row => row.Rank >= 9 && row.Rank <= 16).length,
        "Top 32": filteredData.filter(row => row.Rank >= 17 && row.Rank <= 32).length,
        "Below Top 32": filteredData.filter(row => row.Rank > 32).length
      }[range];
      const uniqueDecksCount = Object.keys(deckCounts).length;
      const maxEntries = range === "Top 8" ? 8 : range === "Top 16" ? 8 : range === "Top 32" ? 16 : rangeCount;
      const deckStatsText = rangeCount === maxEntries && uniqueDecksCount === rangeCount && maxCopies === 1 
        ? "All Unique Decks" 
        : mostPlayedDecks.map(deck => {
            const stats = calculateDeckStats(filteredData, deck, filteredData.length);
            return `${maxCopies} Copies of ${deck} (${formatPercentage(stats.winRate)} WR / ${formatPercentage(stats.metaShare)} Meta)`;
          }).join(", ");
      return `<div><span class="label">${range}:</span> <span class="value">${deckStatsText}</span></div>`;
    })
    .filter(Boolean)
    .join("") || "No Data");

  updateSingleEventDrilldownCardStates(filteredData);

  singleEventStatCardIds.forEach(triggerUpdateAnimation);

  if (applyPendingSingleEventPlayerFocus()) {
    return;
  }

  if (activeSingleEventDrilldownCategory) {
    renderSingleEventDrilldown(activeSingleEventDrilldownCategory);
  }
}

// Navigates from a player/event drilldown into Player Analysis with matching
// filters selected.
export function openSingleEventPlayerInAnalysis(eventName = '', eventType = '', playerName = '') {
  const normalizedEventName = String(eventName || '').trim();
  const normalizedEventType = String(eventType || '').trim().toLowerCase();
  if (!normalizedEventName) {
    return;
  }

  pendingSingleEventFocusPlayerKey = getPlayerIdentityKey(playerName);
  closeSingleEventDrilldown();

  const eventModeButton = document.querySelector('.top-mode-button[data-top-mode="event"]');
  if (eventModeButton) {
    eventModeButton.click();
  }

  const singleModeButton = document.querySelector('.analysis-mode[data-mode="single"]');
  if (singleModeButton) {
    singleModeButton.click();
  }

  if (normalizedEventType) {
    setSingleEventType(normalizedEventType);
  }

  updateEventFilter(normalizedEventName, true);

  const eventFilterMenu = document.getElementById('eventFilterMenu');
  if (eventFilterMenu) {
    eventFilterMenu.dispatchEvent(new Event('change'));
  }

  window.requestAnimationFrame(() => {
    window.scrollTo({
      top: 340,
      behavior: 'smooth'
    });
  });
}

// Fills the Multi-Event stat cards from filtered date-window rows.
export function populateMultiEventStats(filteredData) {
  const stats = calculateMultiEventStats(filteredData);
  const eventSummaries = getMultiEventSummaries(filteredData);
  const mostPlayersSummary = getMultiEventExtremeSummary('mostPlayersEvent', eventSummaries);
  const leastPlayersSummary = getMultiEventExtremeSummary('leastPlayersEvent', eventSummaries);
  updateElementText("totalEvents", stats.totalEvents);
  const card = document.getElementById("multiTotalEventsCard");
  if (card) {
    card.querySelector('.stat-change').textContent = formatDateRange(document.getElementById("startDateSelect")?.value, document.getElementById("endDateSelect")?.value);
  }
  updateElementText("mostPlayersEvent", formatEventName(mostPlayersSummary?.name || stats.mostPlayersEvent));
  updateElementText("mostPlayersCount", mostPlayersSummary ? `${mostPlayersSummary.count} Players` : stats.mostPlayersCount);
  updateElementText("leastPlayersEvent", formatEventName(leastPlayersSummary?.name || stats.leastPlayersEvent));
  updateElementText("leastPlayersCount", leastPlayersSummary ? `${leastPlayersSummary.count} Players` : stats.leastPlayersCount);
  updateElementText("multiMostCopiesDeck", stats.mostCopiesDeck);
  updateElementText("multiMostCopiesDetails", stats.mostCopiesDetails);
  updateElementHTML("multiTopDecksDetails", filteredData.length === 0 ? "--" : Object.entries(stats.topDecks)
    .map(([range, decks]) => {
      if (!decks || decks.length === 0) return "";
      const validDecks = decks.filter(deck => deck !== "UNKNOWN" && deck !== "No Show");
      if (validDecks.length === 0) return "";
      const deckCounts = stats.deckCountsByRange[range];
      const maxCopies = Math.max(...Object.values(deckCounts), 0);
      if (maxCopies === 0) return "";
      const mostPlayedDecks = Object.entries(deckCounts).filter(([_, count]) => count === maxCopies).map(([deck]) => deck);
      const rangeCount = {
        "Top 8": filteredData.filter(row => row.Rank >= 1 && row.Rank <= 8).length,
        "Top 16": filteredData.filter(row => row.Rank >= 9 && row.Rank <= 16).length,
        "Top 32": filteredData.filter(row => row.Rank >= 17 && row.Rank <= 32).length,
        "Below Top 32": filteredData.filter(row => row.Rank > 32).length
      }[range];
      const uniqueDecksCount = Object.keys(deckCounts).length;
      const maxEntries = range === "Top 8" ? 8 : range === "Top 16" ? 8 : range === "Top 32" ? 16 : rangeCount;
      const deckStatsText = rangeCount === maxEntries && uniqueDecksCount === rangeCount && maxCopies === 1 
        ? "All Unique Decks" 
        : mostPlayedDecks.map(deck => {
            const stats = calculateDeckStats(filteredData, deck, filteredData.length);
            return `${maxCopies} Copies of ${deck} (${formatPercentage(stats.winRate)} WR / ${formatPercentage(stats.metaShare)} Meta)`;
          }).join(", ");
      return `<div><span class="label">${range}:</span> <span class="value">${deckStatsText}</span></div>`;
    })
    .filter(Boolean)
    .join("") || "--");

  updateMultiEventDrilldownCardStates(filteredData);

  multiEventStatCardIds.forEach(triggerUpdateAnimation);

  if (activeMultiEventDrilldownState) {
    renderMultiEventDrilldown(activeMultiEventDrilldownState);
  }
}

// Helper Functions
function setupTableSorting(tableHead, tableBody, rows, tableType, renderCallback = null) {
  const headers = tableHead.querySelectorAll('th[data-sort]');
  headers.forEach(header => header.addEventListener('click', () => {
    const sortKey = header.dataset.sort;
    const isAscending = header.classList.contains('asc');
    headers.forEach(h => { h.classList.remove('asc', 'desc'); h.querySelector('.sort-arrow').textContent = ''; });
    rows.sort((a, b) => {
      const aVal = tableType === 'aggregate' && ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && tableHead.querySelector('.display-toggle-btn.active')?.dataset.display === 'percent' 
        ? a[sortKey + 'Percent'] 
        : a[sortKey];
      const bVal = tableType === 'aggregate' && ['top8', 'top16', 'top32', 'belowTop32'].includes(sortKey) && tableHead.querySelector('.display-toggle-btn.active')?.dataset.display === 'percent' 
        ? b[sortKey + 'Percent'] 
        : b[sortKey];
      const aSortVal = typeof aVal === 'string'
        ? aVal.toLowerCase()
        : Number.isFinite(Number(aVal)) ? Number(aVal) : Number.NEGATIVE_INFINITY;
      const bSortVal = typeof bVal === 'string'
        ? bVal.toLowerCase()
        : Number.isFinite(Number(bVal)) ? Number(bVal) : Number.NEGATIVE_INFINITY;

      if (aSortVal === bSortVal) {
        return 0;
      }

      return isAscending
        ? (aSortVal > bSortVal ? -1 : 1)
        : (aSortVal < bSortVal ? -1 : 1);
    });
    header.classList.add(isAscending ? 'desc' : 'asc');
    header.querySelector('.sort-arrow').textContent = isAscending ? '\u2193' : '\u2191';
    if (renderCallback) {
      renderCallback();
    } else {
      updateElementHTML(tableBody.id, rows.map(row => tableType === 'raw' ? renderSingleEventStandingsRows([row]) : `
        <tr>
          <td>${row.deck}</td>
          <td>${row.count || row.metaShare.toFixed(2) + '%'}</td>
          <td>${row.metaShare.toFixed(1) || row.winRate.toFixed(2)}%</td>
          <td>${row.winRate.toFixed(1) || row.top8Percent.toFixed(1) + '%'}</td>
          <td>${row.top8 || row.top16Percent.toFixed(1) + '%'}</td>
          <td>${row.top16 || row.top32Percent.toFixed(1) + '%'}</td>
          <td>${row.top32 || row.belowTop32Percent.toFixed(1) + '%'}</td>
          <td>${row.belowTop32 || ''}</td>
        </tr>
      `).join(""));
    }
  }));
}

function setupDisplayToggle(tableHead, callback) {
  const displayToggleButtons = tableHead.querySelectorAll('.display-toggle-btn');
  displayToggleButtons.forEach(button => button.addEventListener('click', () => {
    displayToggleButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    callback();
  }));
}
