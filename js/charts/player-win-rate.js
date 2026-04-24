// Player Analysis win-rate timeline. The chart uses one point per event and a
// local deck chip filter that does not mutate the global Player Analysis filters.
import { setChartLoading, triggerUpdateAnimation } from '../utils/dom.js';
import { getPlayerWinRateChartData } from '../modules/filters/filter-index.js';
import { calculatePlayerWinRateStats } from "../utils/data-chart.js";
import { getAnalysisRowsForEvent } from '../utils/analysis-data.js';
import { getSelectedPlayerLabel } from '../utils/player-names.js';
import { getChartTheme } from '../utils/theme.js';
import { formatDate, formatEventName } from '../utils/format.js';

export let playerWinRateChart = null;
// Empty means the detail card follows hover; a value means a clicked event stays
// pinned until another point or reset action replaces it.
let pinnedPlayerPointKey = '';
const PLAYER_WIN_RATE_DECK_FILTER_EMPTY_MESSAGE = 'Deck chips appear here once the current player filters include deck results.';

const playerSummaryStatCardIds = [
  'playerEventsCard',
  'playerUniqueDecksCard',
  'playerMostPlayedCard',
  'playerLeastPlayedCard',
  'playerTop1Card',
  'playerTop1_8Card',
  'playerTop9_16Card',
  'playerTop17_32Card',
  'playerTop33PlusCard'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPlayerWinRateDeckFilterRoot() {
  return document.getElementById('playerWinRateDeckFilter');
}

function readSelectedPlayerWinRateDeck() {
  const root = getPlayerWinRateDeckFilterRoot();
  if (!root) {
    return '';
  }

  const directSelection = String(root.dataset.selectedDeck || '').trim();
  if (directSelection) {
    return directSelection;
  }

  try {
    // Older UI state stored this as a JSON array. Keep reading it so stale DOM
    // state from a hot reload does not lose the user's selection.
    const parsed = JSON.parse(root.dataset.selectedDecks || '[]');
    return Array.isArray(parsed) ? String(parsed[0] || '').trim() : '';
  } catch (error) {
    console.warn('Unable to parse player win-rate deck filter state:', error);
    return '';
  }
}

function writeSelectedPlayerWinRateDeck(selectedDeck) {
  const root = getPlayerWinRateDeckFilterRoot();
  if (!root) {
    return;
  }

  const normalizedSelection = String(selectedDeck || '').trim();
  root.dataset.selectedDeck = normalizedSelection;
  root.dataset.selectedDecks = JSON.stringify(normalizedSelection ? [normalizedSelection] : []);
}

function isSelectablePlayerWinRateDeck(deckName) {
  const normalizedDeck = String(deckName || '').trim();
  return normalizedDeck !== '' && normalizedDeck !== 'No Show' && normalizedDeck.toUpperCase() !== 'UNKNOWN';
}

function getPlayerWinRateBaseData() {
  return getPlayerWinRateChartData().filter(row => isSelectablePlayerWinRateDeck(row.Deck));
}

function renderPlayerWinRateDeckFilter(baseData) {
  const root = getPlayerWinRateDeckFilterRoot();
  if (!root) {
    return '';
  }

  const availableDecks = [...new Set(
    (baseData || [])
      .map(row => String(row.Deck || '').trim())
      .filter(isSelectablePlayerWinRateDeck)
  )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const currentSelectedDeck = readSelectedPlayerWinRateDeck();
  const validSelectedDeck = availableDecks.includes(currentSelectedDeck) ? currentSelectedDeck : '';
  writeSelectedPlayerWinRateDeck(validSelectedDeck);

  if (availableDecks.length === 0) {
    root.innerHTML = `
      <div class="player-chart-filter-header">
        <div class="player-chart-filter-copy">
          <span class="player-chart-filter-label">Deck Filter</span>
          <span class="player-chart-filter-note">Applies only to this chart.</span>
        </div>
      </div>
      <div class="player-chart-filter-empty">${escapeHtml(PLAYER_WIN_RATE_DECK_FILTER_EMPTY_MESSAGE)}</div>
    `;
    return '';
  }

  const filterSummary = validSelectedDeck
    ? `Applies only to this chart. Showing only ${validSelectedDeck} in the current time span.`
    : `Applies only to this chart. Showing all ${availableDecks.length} decks in the current time span.`;

  root.innerHTML = `
    <div class="player-chart-filter-header">
      <div class="player-chart-filter-copy">
        <span class="player-chart-filter-label">Deck Filter</span>
        <span class="player-chart-filter-note">${escapeHtml(filterSummary)}</span>
      </div>
    </div>
    <div class="bubble-menu player-chart-filter-chips">
      <button type="button" class="bubble-button player-win-rate-deck-chip player-win-rate-deck-chip-reset${!validSelectedDeck ? ' active' : ''}" data-player-win-rate-reset="true">All Decks</button>
      ${availableDecks.map(deck => `
        <button
          type="button"
          class="bubble-button player-win-rate-deck-chip${validSelectedDeck === deck ? ' active' : ''}"
          data-player-win-rate-deck="${escapeHtml(deck)}"
        >${escapeHtml(deck)}</button>
      `).join('')}
    </div>
  `;

  return validSelectedDeck;
}

function setupPlayerWinRateDeckFilterListeners() {
  const root = getPlayerWinRateDeckFilterRoot();
  if (!root || root.dataset.listenerAdded === 'true') {
    return;
  }

  root.addEventListener('click', event => {
    const resetButton = event.target.closest('[data-player-win-rate-reset="true"]');
    if (resetButton) {
      writeSelectedPlayerWinRateDeck('');
      updatePlayerWinRateChart();
      return;
    }

    const deckButton = event.target.closest('[data-player-win-rate-deck]');
    if (!deckButton) {
      return;
    }

    const deckName = String(deckButton.dataset.playerWinRateDeck || '').trim();
    if (!isSelectablePlayerWinRateDeck(deckName)) {
      return;
    }

    const currentSelectedDeck = readSelectedPlayerWinRateDeck();
    writeSelectedPlayerWinRateDeck(currentSelectedDeck === deckName ? '' : deckName);
    updatePlayerWinRateChart();
  });

  root.dataset.listenerAdded = 'true';
}

function filterPlayerWinRateDataByDeck(baseData, selectedDeck) {
  if (!selectedDeck) {
    return baseData;
  }

  return baseData.filter(row => String(row.Deck || '').trim() === selectedDeck);
}

function formatShortChartDate(dateStr, includeYear = false) {
  if (!dateStr) {
    return '--';
  }

  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (!year || !month || !day) {
    return String(dateStr);
  }

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: '2-digit' } : {})
  });
}

function setPlayerEventDetailsMarkup(markup) {
  const detailsEl = document.getElementById('playerEventDetails');
  if (!detailsEl) {
    console.warn("playerEventDetails element not found in DOM!");
    return;
  }

  detailsEl.innerHTML = markup;
}

function getPlayerPointKey(point) {
  return point?.event && point?.date ? `${point.date}::${point.event}` : '';
}

function renderPlayerEventDetailsPlaceholder(message) {
  setPlayerEventDetailsMarkup(`
    <div class="player-chart-event-placeholder">${escapeHtml(message)}</div>
  `);
}

function renderPlayerEventDetails(point, { pinned = false } = {}) {
  if (!point?.event) {
    renderPlayerEventDetailsPlaceholder('Hover a point to inspect the event, deck, and winner context. Click a point to pin it.');
    return;
  }

  const fullEventData = getAnalysisRowsForEvent(point.event);
  if (fullEventData.length === 0) {
    renderPlayerEventDetailsPlaceholder('Event data not found for the hovered point.');
    return;
  }

  const totalPlayers = fullEventData.length;
  const playerDeck = point.deck || 'N/A';
  const deckPlayersRows = fullEventData.filter(row => String(row.Deck || '').trim() === playerDeck);
  const deckPlayersCount = deckPlayersRows.length;
  const metaShare = totalPlayers > 0 ? ((deckPlayersCount / totalPlayers) * 100).toFixed(1) : '0.0';
  const deckWins = deckPlayersRows.reduce((sum, row) => sum + (Number(row.Wins) || 0), 0);
  const deckLosses = deckPlayersRows.reduce((sum, row) => sum + (Number(row.Losses) || 0), 0);
  const playerDeckWinRate = (deckWins + deckLosses) > 0
    ? ((deckWins / (deckWins + deckLosses)) * 100).toFixed(1)
    : '0.0';

  const bestSameDeckPlayer = deckPlayersRows.reduce((best, row) => {
    const rowRank = Number(row.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(best.Rank) || Number.POSITIVE_INFINITY;
    if (rowRank !== bestRank) {
      return rowRank < bestRank ? row : best;
    }

    const rowWinRate = (Number(row.Wins) || 0) + (Number(row.Losses) || 0) > 0
      ? (Number(row.Wins) || 0) / ((Number(row.Wins) || 0) + (Number(row.Losses) || 0))
      : -1;
    const bestWinRate = (Number(best.Wins) || 0) + (Number(best.Losses) || 0) > 0
      ? (Number(best.Wins) || 0) / ((Number(best.Wins) || 0) + (Number(best.Losses) || 0))
      : -1;

    return rowWinRate > bestWinRate ? row : best;
  }, deckPlayersRows[0]);
  const worstSameDeckPlayer = deckPlayersRows.reduce((worst, row) => {
    const rowRank = Number(row.Rank) || Number.NEGATIVE_INFINITY;
    const worstRank = Number(worst.Rank) || Number.NEGATIVE_INFINITY;
    if (rowRank !== worstRank) {
      return rowRank > worstRank ? row : worst;
    }

    const rowWinRate = (Number(row.Wins) || 0) + (Number(row.Losses) || 0) > 0
      ? (Number(row.Wins) || 0) / ((Number(row.Wins) || 0) + (Number(row.Losses) || 0))
      : Number.POSITIVE_INFINITY;
    const worstWinRate = (Number(worst.Wins) || 0) + (Number(worst.Losses) || 0) > 0
      ? (Number(worst.Wins) || 0) / ((Number(worst.Wins) || 0) + (Number(worst.Losses) || 0))
      : Number.POSITIVE_INFINITY;

    return rowWinRate < worstWinRate ? row : worst;
  }, deckPlayersRows[0]);
  const eventWinner = fullEventData.reduce((best, row) => {
    const rowRank = Number(row.Rank) || Number.POSITIVE_INFINITY;
    const bestRank = Number(best.Rank) || Number.POSITIVE_INFINITY;
    return rowRank < bestRank ? row : best;
  }, fullEventData[0]);

  const formatPlayerSummary = playerRow => {
    const wins = Number(playerRow?.Wins) || 0;
    const losses = Number(playerRow?.Losses) || 0;
    const winRate = (wins + losses) > 0
      ? ((wins / (wins + losses)) * 100).toFixed(1)
      : '0.0';
    const deckPlayers = fullEventData.filter(row => row.Deck === playerRow?.Deck).length;
    const deckMetaShare = totalPlayers > 0 ? ((deckPlayers / totalPlayers) * 100).toFixed(1) : '0.0';

    return {
      name: playerRow?.Player || '--',
      deck: playerRow?.Deck || '--',
      rank: Number.isFinite(Number(playerRow?.Rank)) ? `#${playerRow.Rank}` : '--',
      record: `${wins}-${losses}`,
      winRate: `${winRate}% WR`,
      deckMeta: `${deckMetaShare}% meta`
    };
  };

  const bestPlayerSummary = formatPlayerSummary(bestSameDeckPlayer);
  const worstPlayerSummary = formatPlayerSummary(worstSameDeckPlayer);
  const playerRankValue = Number(point.rank);
  const playerWinRateValue = Number(point.winRate) || 0;
  const bestSameDeckRank = Number(bestSameDeckPlayer?.Rank);
  const worstSameDeckRank = Number(worstSameDeckPlayer?.Rank);
  const bestSameDeckWinRateValue = (Number(bestSameDeckPlayer?.Wins) || 0) + (Number(bestSameDeckPlayer?.Losses) || 0) > 0
    ? ((Number(bestSameDeckPlayer?.Wins) || 0) / ((Number(bestSameDeckPlayer?.Wins) || 0) + (Number(bestSameDeckPlayer?.Losses) || 0))) * 100
    : 0;
  const worstSameDeckWinRateValue = (Number(worstSameDeckPlayer?.Wins) || 0) + (Number(worstSameDeckPlayer?.Losses) || 0) > 0
    ? ((Number(worstSameDeckPlayer?.Wins) || 0) / ((Number(worstSameDeckPlayer?.Wins) || 0) + (Number(worstSameDeckPlayer?.Losses) || 0))) * 100
    : 0;
  const formatGapValue = (rankDifference, winRateDifference, positiveWord, negativeWord) => {
    const rankText = Number.isFinite(rankDifference)
      ? rankDifference === 0
        ? 'No gap on finish'
        : `${Math.abs(rankDifference)} places ${rankDifference > 0 ? positiveWord : negativeWord}`
      : '--';
    const winRateText = Math.abs(winRateDifference) < 0.05
      ? 'No gap on WR'
      : `${Math.abs(winRateDifference).toFixed(1)} pp ${winRateDifference > 0 ? 'above' : 'below'}`;

    return `${rankText} | ${winRateText}`;
  };
  const gapToBestSameDeck = formatGapValue(
    bestSameDeckRank - playerRankValue,
    playerWinRateValue - bestSameDeckWinRateValue,
    'ahead',
    'behind'
  );
  const gapToWorstSameDeck = formatGapValue(
    worstSameDeckRank - playerRankValue,
    playerWinRateValue - worstSameDeckWinRateValue,
    'ahead',
    'behind'
  );

  const winnerDeckPlayers = fullEventData.filter(row => row.Deck === eventWinner.Deck).length;
  const winnerMetaShare = totalPlayers > 0 ? ((winnerDeckPlayers / totalPlayers) * 100).toFixed(1) : '0.0';
  const winnerWins = Number(eventWinner.Wins) || 0;
  const winnerLosses = Number(eventWinner.Losses) || 0;
  const winnerWinRate = (winnerWins + winnerLosses) > 0
    ? ((winnerWins / (winnerWins + winnerLosses)) * 100).toFixed(1)
    : '0.0';

  const formattedEventName = formatEventName(point.event) || point.event || 'Unknown Event';
  const formattedDate = formatDate(point.date);
  const finishText = Number.isFinite(point.rank) ? `#${point.rank}` : '--';

  setPlayerEventDetailsMarkup(`
    <div class="player-chart-event-card${pinned ? ' player-chart-event-card-pinned' : ''}">
      <div class="player-chart-event-header">
        <div class="player-chart-event-date">${escapeHtml(formattedDate)}</div>
        <div class="player-chart-event-title">${escapeHtml(formattedEventName)}</div>
      </div>
      <div class="player-chart-event-grid">
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Deck</span>
          <strong class="player-chart-event-value">${escapeHtml(playerDeck)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Finish</span>
          <strong class="player-chart-event-value">${escapeHtml(finishText)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Record</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.wins}-${point.losses}`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Win Rate</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.winRate.toFixed(1)}%`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Deck Meta</span>
          <strong class="player-chart-event-value">${escapeHtml(`${deckPlayersCount}/${totalPlayers} pilots | ${metaShare}%`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Deck WR</span>
          <strong class="player-chart-event-value">${escapeHtml(`${playerDeckWinRate}%`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Gap to Best</span>
          <strong class="player-chart-event-value">${escapeHtml(gapToBestSameDeck)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Gap to Worst</span>
          <strong class="player-chart-event-value">${escapeHtml(gapToWorstSameDeck)}</strong>
        </div>
      </div>
      <div class="player-chart-event-standouts">
        <div class="player-chart-event-standout-card">
          <span class="player-chart-event-label">Best Same-Deck Player</span>
          <strong class="player-chart-event-value">${escapeHtml(bestPlayerSummary.name)}</strong>
          <span class="player-chart-event-standout-meta">${escapeHtml(`${bestPlayerSummary.rank} | ${bestPlayerSummary.deck}`)}</span>
          <span class="player-chart-event-standout-meta">${escapeHtml(`${bestPlayerSummary.record} | ${bestPlayerSummary.winRate} | ${bestPlayerSummary.deckMeta}`)}</span>
        </div>
        <div class="player-chart-event-standout-card player-chart-event-standout-card-worst">
          <span class="player-chart-event-label">Worst Same-Deck Player</span>
          <strong class="player-chart-event-value">${escapeHtml(worstPlayerSummary.name)}</strong>
          <span class="player-chart-event-standout-meta">${escapeHtml(`${worstPlayerSummary.rank} | ${worstPlayerSummary.deck}`)}</span>
          <span class="player-chart-event-standout-meta">${escapeHtml(`${worstPlayerSummary.record} | ${worstPlayerSummary.winRate} | ${worstPlayerSummary.deckMeta}`)}</span>
        </div>
      </div>
      <div class="player-chart-event-winner">
        Event Winner: <strong>${escapeHtml(eventWinner.Player || '--')}</strong> with <strong>${escapeHtml(eventWinner.Deck || '--')}</strong> |
        ${escapeHtml(`${winnerWins}-${winnerLosses}`)} | ${escapeHtml(`${winnerWinRate}% WR`)} | ${escapeHtml(`${winnerMetaShare}% meta`)}
      </div>
    </div>
  `);
}

function getSelectedPlayerEventTypeCount() {
  const playerAnalysisSection = document.getElementById('playerAnalysisSection');
  return Array.from(playerAnalysisSection?.querySelectorAll('.event-type-filter.active') || []).length;
}

// Redraws the selected player's event-by-event win-rate timeline.
export function updatePlayerWinRateChart() {
  console.log("updatePlayerWinRateChart called...");
  setChartLoading("playerWinRateChart", true);
  const theme = getChartTheme();
  pinnedPlayerPointKey = '';

  setupPlayerWinRateDeckFilterListeners();
  const baseData = getPlayerWinRateBaseData();
  const selectedDeck = renderPlayerWinRateDeckFilter(baseData);
  const filteredData = filterPlayerWinRateDataByDeck(baseData, selectedDeck);

  if (!filteredData.length) {
    renderPlayerEventDetailsPlaceholder('No event details available for the current filters.');
    if (playerWinRateChart) playerWinRateChart.destroy();
    const playerWinRateCtx = document.getElementById("playerWinRateChart");
    if (playerWinRateCtx) {
      const playerFilterMenu = document.getElementById("playerFilterMenu");
      const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
      const selectedPlayerLabel = getSelectedPlayerLabel(playerFilterMenu);
      const selectedEventTypes = getSelectedPlayerEventTypeCount();
      const label = !selectedPlayer ? "No Player Selected" : 
                    selectedEventTypes === 0 ? "No Event Type Selected" : 
                    `${selectedPlayerLabel || "Player"} - No Data`;
      playerWinRateChart = new Chart(playerWinRateCtx, {
        type: "line",
        data: {
          labels: [label],
          datasets: [{
            label: "Player Win Rate %",
            data: [0],
            backgroundColor: '#FFD700',
            borderColor: '#FFD700',       
            borderWidth: 2,               
            pointRadius: 5,
            pointHoverRadius: 7,
            pointHitRadius: 16,
            tension: 0.3,                 
            fill: false,                  
            linePercentage: 0.3,
            categoryPercentage: 0.8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, max: 100, title: { display: true, text: "Win Rate %", color: theme.text }, grid: { color: theme.grid }, ticks: { color: theme.text } },
            x: { title: { display: true, text: "Date", color: theme.text }, grid: { borderDash: [5, 5], color: theme.grid }, ticks: { color: theme.text, autoSkip: false, maxRotation: 45, minRotation: 45 } }
          },
          plugins: {
            legend: { position: 'top', labels: { color: theme.mutedText, font: { size: 14, weight: 'bold' } } },
            tooltip: { enabled: false },
            datalabels: { display: false },
            zoom: {
              zoom: {
                wheel: { enabled: true, speed: 0.1 },
                drag: {
                  enabled: true,
                  backgroundColor: 'rgba(0, 0, 255, 0.3)',
                  borderColor: 'rgba(0, 0, 255, 0.8)',
                  borderWidth: 1
                },
                mode: 'xy'
              },
              pan: { enabled: false },
              limits: { y: { min: 0, max: 100 } }
            }
          },
          animation: { onComplete: () => triggerUpdateAnimation('playerWinRateChartContainer') }
        }
      });

      playerWinRateCtx.ondblclick = () => {
        playerWinRateChart.resetZoom();
      };
    }
    setChartLoading("playerWinRateChart", false);
    return;
  }

  playerSummaryStatCardIds.forEach(cardId => triggerUpdateAnimation(cardId));

  const { dates, pointDetails } = calculatePlayerWinRateStats(filteredData);
  const winRates = pointDetails.map(point => point.winRate);
  const multiYearDates = new Set(dates.map(date => String(date || '').slice(0, 4))).size > 1;
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = getSelectedPlayerLabel(playerFilterMenu) || "Unknown";
  renderPlayerEventDetailsPlaceholder('Hover a point to inspect the event, deck, and winner context. Click a point to pin it.');

  if (playerWinRateChart) playerWinRateChart.destroy();
  const playerWinRateCtx = document.getElementById("playerWinRateChart");
  if (!playerWinRateCtx) {
    console.error("Player Win Rate Chart canvas not found!");
    setChartLoading("playerWinRateChart", false);
    return;
  }

  try {
    playerWinRateChart = new Chart(playerWinRateCtx, {
      type: "line",
      data: {
        labels: dates,
        datasets: [{
          label: `${selectedPlayer} Win Rate %`,
          data: winRates,
          backgroundColor: '#FFD700',
          borderColor: '#FFD700',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointHoverBorderWidth: 2,
          pointHitRadius: 18,
          tension: 0.3,
          fill: false,
          linePercentage: 0.5,
          categoryPercentage: 0.8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, title: { display: true, text: "Win Rate %", color: theme.text }, grid: { color: theme.grid }, ticks: { color: theme.text } },
          x: {
            title: { display: true, text: "Date", color: theme.text },
            grid: { borderDash: [5, 5], color: theme.grid },
            ticks: {
              color: theme.text,
              autoSkip: false,
              maxRotation: 45,
              minRotation: 45,
              callback(value) {
                return formatShortChartDate(this.getLabelForValue(value), multiYearDates);
              }
            }
          }
        },
        plugins: {
          legend: { position: 'top', labels: { color: theme.mutedText, font: { size: 14, weight: 'bold' } } },
          tooltip: {
            enabled: true,
            mode: 'nearest',
            intersect: true,
            displayColors: false,
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            callbacks: {
              title(context) {
                const point = pointDetails[context[0]?.dataIndex];
                return point ? (formatEventName(point.event) || point.event || 'Unknown Event') : '';
              },
              beforeBody(context) {
                const point = pointDetails[context[0]?.dataIndex];
                return point ? [`Date: ${formatDate(point.date)}`] : [];
              },
              label(context) {
                const point = pointDetails[context.dataIndex];
                if (!point) {
                  return '';
                }

                const labelLines = [
                  `Deck: ${point.deck || 'N/A'}`,
                  `Record: ${point.wins}-${point.losses}`,
                  `WR: ${point.winRate.toFixed(1)}%`
                ];

                if (Number.isFinite(point.rank)) {
                  labelLines.splice(1, 0, `Finish: #${point.rank}`);
                }

                return labelLines;
              },
              afterBody(context) {
                const point = pointDetails[context[0]?.dataIndex];
                if (!pinnedPlayerPointKey) {
                  renderPlayerEventDetails(point);
                }
                return "";
              }
            }
          },
          datalabels: { display: false },
          zoom: {
            zoom: {
              wheel: { enabled: true, speed: 0.1 },
              drag: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 255, 0.3)',
                borderColor: 'rgba(0, 0, 255, 0.8)',
                borderWidth: 1
              },
              mode: 'xy'
            },
            pan: { enabled: false },
            limits: { y: { min: 0, max: 100 } }
          }
        },
        onClick(event, activeElements) {
          if (!activeElements?.length) {
            if (pinnedPlayerPointKey) {
              pinnedPlayerPointKey = '';
              renderPlayerEventDetailsPlaceholder('Hover a point to inspect the event, deck, and winner context. Click a point to pin it.');
            }
            return;
          }

          const point = pointDetails[activeElements[0].index];
          const pointKey = getPlayerPointKey(point);

          if (pinnedPlayerPointKey === pointKey) {
            pinnedPlayerPointKey = '';
            renderPlayerEventDetailsPlaceholder('Hover a point to inspect the event, deck, and winner context. Click a point to pin it.');
            return;
          }

          pinnedPlayerPointKey = pointKey;
          renderPlayerEventDetails(point, { pinned: true });
        },
        onHover(event, activeElements) {
          if (activeElements?.length) {
            const hoveredPoint = pointDetails[activeElements[0].index];
            const hoveredPointKey = getPlayerPointKey(hoveredPoint);

            if (pinnedPlayerPointKey && pinnedPlayerPointKey !== hoveredPointKey) {
              pinnedPlayerPointKey = '';
              renderPlayerEventDetails(hoveredPoint);
              return;
            }

            if (pinnedPlayerPointKey === hoveredPointKey) {
              renderPlayerEventDetails(hoveredPoint, { pinned: true });
            }

            return;
          }

          if (pinnedPlayerPointKey) {
            return;
          }

          renderPlayerEventDetailsPlaceholder('Hover a point to inspect the event, deck, and winner context. Click a point to pin it.');
        },
        hover: { mode: 'nearest', intersect: true },
        animation: { onComplete: () => triggerUpdateAnimation('playerWinRateChartContainer') }
      }
    });

    playerWinRateCtx.ondblclick = () => {
      playerWinRateChart.resetZoom();
    };
  } catch (error) {
    console.error("Error initializing Player Win Rate Chart:", error);
  }
  setChartLoading("playerWinRateChart", false);
}
