import { updateElementText, updateElementHTML } from '../utils/dom.js';
import { formatDate, formatDateRange, formatEventName } from '../utils/format.js';
import { getPlayerIdentityKey } from '../utils/player-names.js';
import { getFilteredMultiEventRows } from './filters/selection-summaries.js';
import {
  DEFAULT_RANKINGS_OPTIONS,
  buildRankingsDataset,
  getRankingsAvailableDates
} from '../utils/rankings-data.js';
import { getChartTheme } from '../utils/theme.js';

const MAX_MULTI_EVENT_ELO_CACHE_ENTRIES = 12;
const multiEventAggregateRankingsDatasetCache = new Map();
let activePlayerAggregateRequestId = 0;
let multiPlayerAggregateModalChart = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rememberLimitedCacheEntry(cache, key, value, maxEntries = MAX_MULTI_EVENT_ELO_CACHE_ENTRIES) {
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

function getSelectedMultiEventTypes() {
  const eventAnalysisSection = document.getElementById('eventAnalysisSection');
  return Array.from(eventAnalysisSection?.querySelectorAll('.event-type-filter.active') || []).map(button =>
    String(button.dataset.type || '').trim().toLowerCase()
  ).filter(Boolean);
}

function getSelectedMultiEventDateWindow() {
  return {
    startDate: String(document.getElementById('startDateSelect')?.value || '').trim(),
    endDate: String(document.getElementById('endDateSelect')?.value || '').trim()
  };
}

function getPlayerAggregateModalElements() {
  return {
    overlay: document.getElementById('multiPlayerAggregateOverlay'),
    title: document.getElementById('multiPlayerAggregateTitle'),
    subtitle: document.getElementById('multiPlayerAggregateSubtitle'),
    content: document.getElementById('multiPlayerAggregateContent'),
    closeButton: document.getElementById('multiPlayerAggregateClose')
  };
}

function ensurePlayerAggregateOverlayHost(overlay) {
  if (!overlay || !document.body) {
    return;
  }

  if (overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
}

function closeMultiEventPlayerAggregateModal() {
  const { overlay, content } = getPlayerAggregateModalElements();
  if (!overlay) {
    return;
  }

  destroyMultiPlayerAggregateModalChart();
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  if (content) {
    content.innerHTML = '';
  }
  document.body.classList.remove('modal-open');
}

function ensureMultiEventPlayerAggregateModalListeners() {
  const { overlay, closeButton } = getPlayerAggregateModalElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', closeMultiEventPlayerAggregateModal);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeMultiEventPlayerAggregateModal();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.hidden !== true) {
      closeMultiEventPlayerAggregateModal();
    }
  });
}

function formatWinRatePercent(wins = 0, losses = 0) {
  const totalMatches = Number(wins) + Number(losses);
  if (totalMatches <= 0) {
    return 'N/A';
  }

  return `${((Number(wins) / totalMatches) * 100).toFixed(1)}%`;
}

function formatRecord(wins = 0, losses = 0, draws = 0) {
  const normalizedWins = Number(wins) || 0;
  const normalizedLosses = Number(losses) || 0;
  const normalizedDraws = Number(draws) || 0;
  return normalizedDraws > 0
    ? `${normalizedWins}-${normalizedLosses}-${normalizedDraws}`
    : `${normalizedWins}-${normalizedLosses}`;
}

function formatEloValue(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : 'N/A';
}

function formatEloChange(value) {
  if (!Number.isFinite(Number(value))) {
    return 'N/A';
  }

  const roundedValue = Math.round(Number(value));
  return roundedValue > 0 ? `+${roundedValue}` : String(roundedValue);
}

function sortHistoryEntriesAscending(a, b) {
  return (
    String(a?.date || '').localeCompare(String(b?.date || '')) ||
    String(a?.eventId || '').localeCompare(String(b?.eventId || '')) ||
    String(a?.event || '').localeCompare(String(b?.event || '')) ||
    Number(a?.round || 0) - Number(b?.round || 0)
  );
}

function getNormalizedEventTypesKey(eventTypes = []) {
  return [...new Set(
    (Array.isArray(eventTypes) ? eventTypes : [eventTypes])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )].sort().join(',');
}

function getCachedMultiEventAggregateRankingsDataset({
  eventTypes = [],
  startDate = '',
  endDate = '',
  entityMode = 'player'
} = {}) {
  const cacheKey = [
    entityMode,
    getNormalizedEventTypesKey(eventTypes),
    String(startDate || '').trim(),
    String(endDate || '').trim()
  ].join('::');

  if (multiEventAggregateRankingsDatasetCache.has(cacheKey)) {
    return rememberLimitedCacheEntry(
      multiEventAggregateRankingsDatasetCache,
      cacheKey,
      multiEventAggregateRankingsDatasetCache.get(cacheKey)
    );
  }

  const datasetPromise = buildRankingsDataset({
    eventTypes,
    startDate,
    endDate
  }, {
    resetByYear: false,
    entityMode
  }).catch(error => {
    multiEventAggregateRankingsDatasetCache.delete(cacheKey);
    throw error;
  });

  return rememberLimitedCacheEntry(multiEventAggregateRankingsDatasetCache, cacheKey, datasetPromise);
}

function getEventRowKey(row = {}) {
  return `${String(row?.Date || '').trim()}|||${String(row?.Event || '').trim()}`;
}

function buildFinishBreakdown(rows = []) {
  return rows.reduce((counts, row) => {
    const rank = Number(row?.Rank);

    if (!Number.isFinite(rank)) {
      return counts;
    }

    if (rank === 1) {
      counts.trophies += 1;
    } else if (rank >= 2 && rank <= 8) {
      counts.top2To8 += 1;
    } else if (rank >= 9 && rank <= 16) {
      counts.top16 += 1;
    } else if (rank >= 17 && rank <= 32) {
      counts.top32 += 1;
    } else if (rank > 32) {
      counts.belowTop32 += 1;
    }

    return counts;
  }, {
    trophies: 0,
    top2To8: 0,
    top16: 0,
    top32: 0,
    belowTop32: 0
  });
}

function getRowWinRate(row = {}) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  return (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
}

function pickBestFinishRow(rows = []) {
  if (!rows.length) {
    return null;
  }

  return rows.reduce((bestRow, row) => {
    const rowRank = Number(row?.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(bestRow?.Rank) || Number.POSITIVE_INFINITY;
    if (rowRank !== bestRank) {
      return rowRank < bestRank ? row : bestRow;
    }

    const rowWinRate = getRowWinRate(row);
    const bestWinRate = getRowWinRate(bestRow);
    if (rowWinRate !== bestWinRate) {
      return rowWinRate > bestWinRate ? row : bestRow;
    }

    return String(row?.Event || '').localeCompare(String(bestRow?.Event || '')) < 0 ? row : bestRow;
  }, rows[0]);
}

function pickWorstFinishRow(rows = []) {
  if (!rows.length) {
    return null;
  }

  return rows.reduce((worstRow, row) => {
    const rowRank = Number(row?.Rank) || Number.NEGATIVE_INFINITY;
    const worstRank = Number(worstRow?.Rank) || Number.NEGATIVE_INFINITY;
    if (rowRank !== worstRank) {
      return rowRank > worstRank ? row : worstRow;
    }

    const rowWinRate = getRowWinRate(row);
    const worstWinRate = getRowWinRate(worstRow);
    if (rowWinRate !== worstWinRate) {
      return rowWinRate < worstWinRate ? row : worstRow;
    }

    return String(row?.Event || '').localeCompare(String(worstRow?.Event || '')) < 0 ? row : worstRow;
  }, rows[0]);
}

function formatAverageFinish(value) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  const roundedValue = Math.round(value * 10) / 10;
  return Number.isInteger(roundedValue) ? `#${roundedValue}` : `#${roundedValue.toFixed(1)}`;
}

function formatResultSummary(row) {
  if (!row) {
    return 'N/A';
  }

  return `${buildFinishLabel(row)} | ${getDeckDisplayName(row?.Deck)} | ${formatRecord(row?.Wins, row?.Losses, row?.Draws)} | ${row?.Date ? formatDate(row.Date) : '--'}`;
}

function resolveEloMovement(entries = [], startDate = '', endDate = '') {
  const sortedEntries = [...(Array.isArray(entries) ? entries : [])]
    .filter(entry => String(entry?.date || '').trim() <= endDate)
    .sort(sortHistoryEntriesAscending);

  if (sortedEntries.length === 0) {
    return {
      startElo: Number.NaN,
      endElo: Number.NaN,
      change: Number.NaN
    };
  }

  const entriesBeforeStart = sortedEntries.filter(entry => String(entry?.date || '').trim() < startDate);
  const entriesInRange = sortedEntries.filter(entry => {
    const entryDate = String(entry?.date || '').trim();
    return entryDate >= startDate && entryDate <= endDate;
  });
  const latestBeforeStart = entriesBeforeStart[entriesBeforeStart.length - 1] || null;
  const firstInRange = entriesInRange[0] || null;
  const latestUpToEnd = sortedEntries[sortedEntries.length - 1] || null;
  const startingElo = latestBeforeStart && Number.isFinite(Number(latestBeforeStart.ratingAfter))
    ? Number(latestBeforeStart.ratingAfter)
    : firstInRange && Number.isFinite(Number(firstInRange.ratingBefore))
      ? Number(firstInRange.ratingBefore)
      : DEFAULT_RANKINGS_OPTIONS.startingRating;
  const endingElo = latestUpToEnd && Number.isFinite(Number(latestUpToEnd.ratingAfter))
    ? Number(latestUpToEnd.ratingAfter)
    : startingElo;

  return {
    startElo: startingElo,
    endElo: endingElo,
    change: endingElo - startingElo
  };
}

function getDeckDisplayName(deckName = '') {
  const normalized = String(deckName || '').trim();
  return normalized || 'Unknown';
}

function buildWinRateByDeck(rows = []) {
  const deckMap = new Map();

  rows.forEach(row => {
    const deckName = getDeckDisplayName(row?.Deck);
    if (!deckMap.has(deckName)) {
      deckMap.set(deckName, {
        deck: deckName,
        eventKeys: new Set(),
        wins: 0,
        losses: 0,
        draws: 0
      });
    }

    const deckSummary = deckMap.get(deckName);
    deckSummary.eventKeys.add(getEventRowKey(row));
    deckSummary.wins += Number(row?.Wins) || 0;
    deckSummary.losses += Number(row?.Losses) || 0;
    deckSummary.draws += Number(row?.Draws) || 0;
  });

  return Array.from(deckMap.values())
    .map(entry => ({
      deck: entry.deck,
      eventsPlayed: entry.eventKeys.size,
      wins: entry.wins,
      losses: entry.losses,
      draws: entry.draws,
      winRate: formatWinRatePercent(entry.wins, entry.losses)
    }))
    .sort((a, b) => (
      b.eventsPlayed - a.eventsPlayed ||
      b.wins - a.wins ||
      a.deck.localeCompare(b.deck)
    ));
}

function buildEventRows(rows = []) {
  return [...rows]
    .sort((a, b) => (
      String(b?.Date || '').localeCompare(String(a?.Date || '')) ||
      Number(a?.Rank || Number.POSITIVE_INFINITY) - Number(b?.Rank || Number.POSITIVE_INFINITY) ||
      String(a?.Event || '').localeCompare(String(b?.Event || ''))
    ))
    .map(row => ({
      event: formatEventName(row?.Event) || row?.Event || '--',
      date: row?.Date ? formatDate(row.Date) : '--',
      deck: getDeckDisplayName(row?.Deck),
      finish: buildFinishLabel(row),
      record: formatRecord(row?.Wins, row?.Losses, row?.Draws)
    }));
}

function buildEventWinRateTimeline(rows = []) {
  const eventMap = new Map();

  rows.forEach(row => {
    const eventKey = getEventRowKey(row);
    if (!eventMap.has(eventKey)) {
      eventMap.set(eventKey, {
        key: eventKey,
        event: formatEventName(row?.Event) || row?.Event || '--',
        date: String(row?.Date || '').trim(),
        wins: 0,
        losses: 0,
        draws: 0,
        decks: new Set(),
        bestRank: Number.POSITIVE_INFINITY
      });
    }

    const entry = eventMap.get(eventKey);
    entry.wins += Number(row?.Wins) || 0;
    entry.losses += Number(row?.Losses) || 0;
    entry.draws += Number(row?.Draws) || 0;
    entry.decks.add(getDeckDisplayName(row?.Deck));
    const rank = Number(row?.Rank);
    if (Number.isFinite(rank) && rank < entry.bestRank) {
      entry.bestRank = rank;
    }
  });

  return Array.from(eventMap.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.event.localeCompare(b.event))
    .map(entry => {
      const totalMatches = entry.wins + entry.losses;
      return {
        label: entry.event,
        event: entry.event,
        date: entry.date ? formatDate(entry.date) : '--',
        deck: [...entry.decks].sort((a, b) => a.localeCompare(b)).join(', '),
        record: formatRecord(entry.wins, entry.losses, entry.draws),
        winRate: totalMatches > 0 ? (entry.wins / totalMatches) * 100 : 0,
        finish: Number.isFinite(entry.bestRank) ? buildFinishLabel({ Rank: entry.bestRank }) : 'N/A'
      };
    });
}

function buildFinishLabel(row = {}) {
  const rank = Number(row?.Rank);
  if (!Number.isFinite(rank)) {
    return 'N/A';
  }

  if (rank === 1) {
    return '#1 Trophy';
  }
  if (rank >= 2 && rank <= 8) {
    return `#${rank} Top 2-8`;
  }
  if (rank >= 9 && rank <= 16) {
    return `#${rank} Top 16`;
  }
  if (rank >= 17 && rank <= 32) {
    return `#${rank} Top 32`;
  }
  return `#${rank} Below Top 32`;
}

function buildEloByDeck(rows = [], playerKey = '', deckDataset = null, startDate = '', endDate = '') {
  const deckNames = [...new Set(rows.map(row => getDeckDisplayName(row?.Deck)).filter(Boolean))];
  const deckRows = (deckDataset?.seasonRows || []).filter(row =>
    String(row?.basePlayerKey || '').trim() === String(playerKey || '').trim()
  );
  const deckPlayerKeyByName = new Map(
    deckRows
      .map(row => [getDeckDisplayName(row?.deck), String(row?.playerKey || '').trim()])
      .filter(([, deckPlayerKey]) => deckPlayerKey)
  );

  return deckNames.map(deckName => {
    const deckPlayerKey = deckPlayerKeyByName.get(deckName);
    const historyEntries = deckPlayerKey
      ? deckDataset?.historyByPlayer?.get(deckPlayerKey) || []
      : [];
    const eloMovement = resolveEloMovement(historyEntries, startDate, endDate);

    return {
      deck: deckName,
      startElo: eloMovement.startElo,
      endElo: eloMovement.endElo,
      change: eloMovement.change
    };
  }).sort((a, b) => a.deck.localeCompare(b.deck));
}

function buildPlayerAggregateModalHtml(model) {
  const finishBreakdown = model.finishBreakdown;
  const overallRecord = formatRecord(model.wins, model.losses, model.draws);

  return `
    <article class="player-rank-drilldown-event multi-player-aggregate-modal-body">
      <div class="player-rank-drilldown-event-header">
        <div>
          <div class="player-rank-drilldown-event-date">${escapeHtml(model.periodLabel)}</div>
          <h4 class="player-rank-drilldown-event-name">${escapeHtml(model.playerName)}</h4>
        </div>
        <span class="player-rank-drilldown-rank-badge">${escapeHtml(model.totalEvents)} Event${model.totalEvents === 1 ? '' : 's'}</span>
      </div>

      <div class="player-rank-drilldown-summary-grid">
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Avg Event WR</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.averageEventWinRate)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Average Finish</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.averageFinish)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Decks Used</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.uniqueDeckCount)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Trophies</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(finishBreakdown.trophies)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Top 2-8</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(finishBreakdown.top2To8)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Top 16</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(finishBreakdown.top16)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Top 32</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(finishBreakdown.top32)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Below Top 32</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(finishBreakdown.belowTop32)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Most Played Deck</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.mostPlayedDeck)}</strong>
        </div>
        <div class="player-rank-drilldown-summary-item">
          <span class="player-rank-drilldown-summary-label">Least Played Deck</span>
          <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.leastPlayedDeck)}</strong>
        </div>
      </div>

      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Overall Win Rate</div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Match Win Rate</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.overallWinRate)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Record</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(overallRecord)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Wins</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.wins)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Losses</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.losses)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Draws</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.draws)}</strong>
          </div>
        </div>
      </div>

      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Player Snapshot</div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Best Result</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.bestResultSummary)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Worst Result</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.worstResultSummary)}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Latest Result</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(model.latestResultSummary)}</strong>
          </div>
        </div>
      </div>

      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Player Win Rate by Event</div>
        <div class="chart-container multi-player-aggregate-chart-shell">
          ${model.eventWinRateTimeline.length > 0
            ? '<canvas id="multiPlayerAggregateEventChart"></canvas>'
            : '<div class="player-rank-drilldown-empty">No per-event win-rate data is available for this player in the selected period.</div>'}
        </div>
      </div>

      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Win Rate by Deck</div>
        ${buildScrollableTableHtml(`
          <table class="player-rank-drilldown-top8-table">
            <thead>
              <tr>
                <th>Deck</th>
                <th>Events</th>
                <th>Record</th>
                <th>Win Rate</th>
              </tr>
            </thead>
            <tbody>
              ${model.winRateByDeck.length > 0 ? model.winRateByDeck.map(entry => `
                <tr>
                  <td>${escapeHtml(entry.deck)}</td>
                  <td>${escapeHtml(entry.eventsPlayed)}</td>
                  <td>${escapeHtml(formatRecord(entry.wins, entry.losses, entry.draws))}</td>
                  <td>${escapeHtml(entry.winRate)}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="4">No deck performance data available for this period.</td></tr>
              `}
            </tbody>
          </table>
        `)}
      </div>

      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Overall Elo Movement</div>
        <div class="player-rank-drilldown-summary-grid">
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Start Elo</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatEloValue(model.overallElo.startElo))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">End Elo</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatEloValue(model.overallElo.endElo))}</strong>
          </div>
          <div class="player-rank-drilldown-summary-item">
            <span class="player-rank-drilldown-summary-label">Elo Change</span>
            <strong class="player-rank-drilldown-summary-value">${escapeHtml(formatEloChange(model.overallElo.change))}</strong>
          </div>
        </div>
      </div>

      <div class="player-rank-drilldown-context">
        <div class="player-rank-drilldown-context-title">Elo Movement by Deck</div>
        ${buildScrollableTableHtml(`
          <table class="player-rank-drilldown-top8-table">
            <thead>
              <tr>
                <th>Deck</th>
                <th>Start Elo</th>
                <th>End Elo</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              ${model.eloByDeck.length > 0 ? model.eloByDeck.map(entry => `
                <tr>
                  <td>${escapeHtml(entry.deck)}</td>
                  <td>${escapeHtml(formatEloValue(entry.startElo))}</td>
                  <td>${escapeHtml(formatEloValue(entry.endElo))}</td>
                  <td>${escapeHtml(formatEloChange(entry.change))}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="4">No deck Elo data available for this period.</td></tr>
              `}
            </tbody>
          </table>
        `)}
      </div>

      <details class="player-rank-drilldown-context multi-player-aggregate-events">
        <summary class="multi-player-aggregate-events-summary">Events Played (${escapeHtml(model.eventsPlayed.length)})</summary>
        ${buildScrollableTableHtml(`
          <table class="player-rank-drilldown-top8-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Event</th>
                <th>Deck</th>
                <th>Finish</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              ${model.eventsPlayed.length > 0 ? model.eventsPlayed.map(entry => `
                <tr>
                  <td>${escapeHtml(entry.date)}</td>
                  <td>${escapeHtml(entry.event)}</td>
                  <td>${escapeHtml(entry.deck)}</td>
                  <td>${escapeHtml(entry.finish)}</td>
                  <td>${escapeHtml(entry.record)}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="5">No events found for this player in the selected period.</td></tr>
              `}
            </tbody>
          </table>
        `)}
      </details>
    </article>
  `;
}

function buildScrollableTableHtml(innerHtml) {
  return `<div class="player-rank-drilldown-top8"><div class="player-rank-drilldown-top8-scroll">${innerHtml}</div></div>`;
}

function destroyMultiPlayerAggregateModalChart() {
  if (multiPlayerAggregateModalChart) {
    multiPlayerAggregateModalChart.destroy();
    multiPlayerAggregateModalChart = null;
  }
}

function renderMultiPlayerAggregateModalChart(model) {
  destroyMultiPlayerAggregateModalChart();

  const canvas = document.getElementById('multiPlayerAggregateEventChart');
  if (!canvas || !globalThis.Chart || !Array.isArray(model?.eventWinRateTimeline) || model.eventWinRateTimeline.length === 0) {
    return;
  }

  const theme = getChartTheme();
  multiPlayerAggregateModalChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: model.eventWinRateTimeline.map(point => point.label),
      datasets: [{
        label: 'Player Win Rate by Event',
        data: model.eventWinRateTimeline.map(point => point.winRate),
        borderColor: '#d4a657',
        backgroundColor: 'rgba(212, 166, 87, 0.18)',
        pointBackgroundColor: '#d4a657',
        pointBorderColor: '#f5f0e6',
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.2,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            color: theme.text,
            maxRotation: 35,
            minRotation: 20
          },
          grid: {
            color: theme.grid
          },
          title: {
            display: true,
            text: 'Events',
            color: theme.text
          }
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: theme.text,
            callback(value) {
              return `${value}%`;
            }
          },
          grid: {
            color: theme.grid
          },
          title: {
            display: true,
            text: 'Win Rate',
            color: theme.text
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          titleColor: '#FFD700',
          bodyColor: theme.tooltipText,
          borderColor: theme.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            title(items) {
              const point = model.eventWinRateTimeline[items[0]?.dataIndex];
              return point?.event || '';
            },
            label(context) {
              const point = model.eventWinRateTimeline[context.dataIndex];
              if (!point) {
                return [];
              }

              return [
                `Date: ${point.date}`,
                `Deck: ${point.deck || 'N/A'}`,
                `Record: ${point.record}`,
                `Win Rate: ${point.winRate.toFixed(1)}%`,
                `Finish: ${point.finish}`
              ];
            }
          }
        }
      }
    }
  });
}

async function buildPlayerAggregateModel(playerName = '') {
  const normalizedPlayerName = String(playerName || '').trim();
  const normalizedPlayerKey = getPlayerIdentityKey(normalizedPlayerName);
  const { startDate, endDate } = getSelectedMultiEventDateWindow();
  const periodLabel = formatDateRange(startDate, endDate) || 'Selected Multi-Event Span';
  const eventTypes = getSelectedMultiEventTypes();
  const positionStart = parseInt(document.getElementById('positionStartSelect')?.value, 10) || 1;
  const positionEnd = parseInt(document.getElementById('positionEndSelect')?.value, 10) || Infinity;
  const rows = getFilteredMultiEventRows().filter(row => {
    const rank = Number(row?.Rank);
    return Number.isFinite(rank) && rank >= positionStart && rank <= positionEnd;
  });
  const playerRows = rows.filter(row => getPlayerIdentityKey(row?.Player) === normalizedPlayerKey);

  if (!normalizedPlayerKey || !startDate || !endDate || playerRows.length === 0) {
    return {
      playerName: normalizedPlayerName || 'Player Aggregate',
      periodLabel,
      totalEvents: 0,
      finishBreakdown: buildFinishBreakdown([]),
      wins: 0,
      losses: 0,
      draws: 0,
      averageEventWinRate: 'N/A',
      averageFinish: 'N/A',
      uniqueDeckCount: 0,
      mostPlayedDeck: 'N/A',
      leastPlayedDeck: 'N/A',
      bestResultSummary: 'N/A',
      worstResultSummary: 'N/A',
      latestResultSummary: 'N/A',
      overallWinRate: 'N/A',
      winRateByDeck: [],
      overallElo: {
        startElo: Number.NaN,
        endElo: Number.NaN,
        change: Number.NaN
      },
      eloByDeck: [],
      eventsPlayed: [],
      eventWinRateTimeline: []
    };
  }

  const totalEvents = new Set(playerRows.map(row => getEventRowKey(row))).size;
  const wins = playerRows.reduce((sum, row) => sum + (Number(row?.Wins) || 0), 0);
  const losses = playerRows.reduce((sum, row) => sum + (Number(row?.Losses) || 0), 0);
  const draws = playerRows.reduce((sum, row) => sum + (Number(row?.Draws) || 0), 0);
  const averageFinishValue = playerRows.length > 0
    ? playerRows.reduce((sum, row) => sum + (Number(row?.Rank) || 0), 0) / playerRows.length
    : Number.NaN;
  const eventWinRateTimeline = buildEventWinRateTimeline(playerRows);
  const averageEventWinRateValue = eventWinRateTimeline.length > 0
    ? eventWinRateTimeline.reduce((sum, point) => sum + point.winRate, 0) / eventWinRateTimeline.length
    : Number.NaN;
  const deckEventCounts = buildWinRateByDeck(playerRows);
  const mostPlayedDeck = deckEventCounts[0]
    ? `${deckEventCounts[0].deck} (${deckEventCounts[0].eventsPlayed})`
    : 'N/A';
  const leastPlayedDeck = deckEventCounts.length > 0
    ? (() => {
        const leastEntry = [...deckEventCounts].sort((a, b) => a.eventsPlayed - b.eventsPlayed || a.deck.localeCompare(b.deck))[0];
        return `${leastEntry.deck} (${leastEntry.eventsPlayed})`;
      })()
    : 'N/A';
  const availableDates = getRankingsAvailableDates(eventTypes);
  const fullRangeStartDate = availableDates[0] || startDate;
  const [overallDataset, deckDataset] = await Promise.all([
    getCachedMultiEventAggregateRankingsDataset({
      eventTypes,
      startDate: fullRangeStartDate,
      endDate,
      entityMode: 'player'
    }),
    getCachedMultiEventAggregateRankingsDataset({
      eventTypes,
      startDate: fullRangeStartDate,
      endDate,
      entityMode: 'player_deck'
    })
  ]);

  const overallHistoryEntries = overallDataset?.historyByPlayer?.get(normalizedPlayerKey) || [];
  const sortedPlayerRowsByDate = [...playerRows].sort((a, b) => (
    String(b?.Date || '').localeCompare(String(a?.Date || '')) ||
    Number(a?.Rank || Number.POSITIVE_INFINITY) - Number(b?.Rank || Number.POSITIVE_INFINITY)
  ));

  return {
    playerName: playerRows[0]?.Player || normalizedPlayerName,
    periodLabel,
    totalEvents,
    finishBreakdown: buildFinishBreakdown(playerRows),
    wins,
    losses,
    draws,
    averageEventWinRate: Number.isFinite(averageEventWinRateValue) ? `${averageEventWinRateValue.toFixed(1)}%` : 'N/A',
    averageFinish: formatAverageFinish(averageFinishValue),
    uniqueDeckCount: deckEventCounts.length,
    mostPlayedDeck,
    leastPlayedDeck,
    bestResultSummary: formatResultSummary(pickBestFinishRow(playerRows)),
    worstResultSummary: formatResultSummary(pickWorstFinishRow(playerRows)),
    latestResultSummary: formatResultSummary(sortedPlayerRowsByDate[0] || null),
    overallWinRate: formatWinRatePercent(wins, losses),
    winRateByDeck: deckEventCounts,
    overallElo: resolveEloMovement(overallHistoryEntries, startDate, endDate),
    eloByDeck: buildEloByDeck(playerRows, normalizedPlayerKey, deckDataset, startDate, endDate),
    eventsPlayed: buildEventRows(playerRows),
    eventWinRateTimeline
  };
}

export async function openMultiEventPlayerAggregateModal(playerName = '') {
  const normalizedPlayerName = String(playerName || '').trim();
  const { overlay, title, subtitle, content } = getPlayerAggregateModalElements();
  if (!overlay || !title || !subtitle || !content || !normalizedPlayerName) {
    return;
  }

  ensurePlayerAggregateOverlayHost(overlay);
  ensureMultiEventPlayerAggregateModalListeners();
  const requestId = ++activePlayerAggregateRequestId;

  updateElementText('multiPlayerAggregateTitle', normalizedPlayerName);
  updateElementText('multiPlayerAggregateSubtitle', 'Loading player aggregate data...');
  updateElementHTML('multiPlayerAggregateContent', '<div class="player-rank-drilldown-empty">Loading player aggregate data...</div>');

  overlay.removeAttribute('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.hidden = false;
  document.body.classList.add('modal-open');

  try {
    const model = await buildPlayerAggregateModel(normalizedPlayerName);
    if (requestId !== activePlayerAggregateRequestId) {
      return;
    }

    title.textContent = model.playerName;
    subtitle.textContent = `${model.periodLabel} | ${model.totalEvents} event${model.totalEvents === 1 ? '' : 's'} played`;
    content.innerHTML = buildPlayerAggregateModalHtml(model);
    renderMultiPlayerAggregateModalChart(model);
  } catch (error) {
    console.error('Failed to build Multi-Event player aggregate modal.', error);
    if (requestId !== activePlayerAggregateRequestId) {
      return;
    }

    title.textContent = normalizedPlayerName;
    subtitle.textContent = 'Player aggregate data could not be loaded.';
    content.innerHTML = '<div class="player-rank-drilldown-empty">Player aggregate data is unavailable for the current Multi-Event filters.</div>';
    destroyMultiPlayerAggregateModalChart();
  }
}
