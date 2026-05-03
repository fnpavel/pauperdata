// Multi-event player performance scatter chart. It aggregates the selected event
// window by player, then provides hover/click detail cards for individual runs.
import { setChartLoading } from '../utils/dom.js';
import { getDeckEvolutionChartData } from '../modules/filters/filter-index.js';
import { calculateMultiPlayerWinRateStats } from "../utils/data-chart.js";
import { getChartTheme } from '../utils/theme.js';
import { formatDate, formatEventName } from '../utils/format.js';
import { buildSharedMultiScatterYAxis } from './multi-scatter-shared.js';
import { openMultiEventPlayerAggregateModal } from '../modules/multi-player-aggregate-modal.js';
import { renderMultiEventPeriodSummaryBadge } from '../utils/multi-event-period-badge.js';

export let multiPlayerWinRateChart = null;
// Empty means hover controls the details panel; a value means the clicked point
// stays pinned until another point or reset action changes it.
let pinnedMultiPlayerPointKey = '';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setMultiPlayerWinRateDetailsMarkup(markup) {
  const detailsEl = document.getElementById('multiPlayerWinRateDetails');
  if (!detailsEl) {
    return;
  }

  detailsEl.innerHTML = markup;
}

function ensureMultiPlayerWinRateDetailsInteractions() {
  const detailsEl = document.getElementById('multiPlayerWinRateDetails');
  if (!detailsEl || detailsEl.dataset.aggregateModalBound === 'true') {
    return;
  }

  detailsEl.dataset.aggregateModalBound = 'true';
  detailsEl.addEventListener('click', event => {
    const trigger = event.target.closest('[data-multi-player-aggregate-open]');
    if (!trigger) {
      return;
    }

    openMultiEventPlayerAggregateModal(trigger.dataset.multiPlayerAggregateOpen || '');
  });
}

function renderMultiPlayerWinRateDetailsPlaceholder(message) {
  setMultiPlayerWinRateDetailsMarkup(`
    <div class="player-chart-event-placeholder">${escapeHtml(message)}</div>
  `);
}

function getMultiPlayerPointKey(point) {
  return String(point?.player || '').trim();
}

function getMultiPlayerPointByKey(pointDetails, pointKey) {
  return pointDetails.find(point => getMultiPlayerPointKey(point) === pointKey) || null;
}

function getRowWinRate(row) {
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
    return '--';
  }

  const roundedValue = Math.round(value * 10) / 10;
  return Number.isInteger(roundedValue) ? `#${roundedValue}` : `#${roundedValue.toFixed(1)}`;
}

function formatPlayerResultSummary(row) {
  if (!row) {
    return null;
  }

  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const eventWinRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  return {
    event: formatEventName(row?.Event) || row?.Event || '--',
    deck: row?.Deck || '--',
    finish: Number.isFinite(Number(row?.Rank)) ? `#${row.Rank}` : '--',
    record: `${wins}-${losses}`,
    winRate: `${eventWinRate}% WR`,
    date: row?.Date ? formatDate(row.Date) : '--'
  };
}

function getRankBucketCounts(rows = []) {
  return rows.reduce((counts, row) => {
    const rank = Number(row?.Rank);

    if (rank === 1) {
      counts.top8 += 1;
    } else if (rank >= 2 && rank <= 8) {
      counts.top8 += 1;
    } else if (rank >= 9 && rank <= 16) {
      counts.top9_16 += 1;
    } else if (rank >= 17 && rank <= 32) {
      counts.top17_32 += 1;
    } else {
      counts.belowTop32 += 1;
    }

    return counts;
  }, {
    top8: 0,
    top9_16: 0,
    top17_32: 0,
    belowTop32: 0
  });
}

function buildMultiPlayerPointDetails(sortedPlayerData, chartData) {
  // Chart.js only needs average win rate/event count, but the side panel needs a
  // richer per-player model. Build it once from the same filtered rows.
  return sortedPlayerData.map(playerStat => {
    const playerRows = chartData.filter(row => String(row?.Player || '').trim() === playerStat.player);
    const wins = playerRows.reduce((sum, row) => sum + (Number(row?.Wins) || 0), 0);
    const losses = playerRows.reduce((sum, row) => sum + (Number(row?.Losses) || 0), 0);
    const totalGames = wins + losses;
    const overallWinRate = totalGames > 0 ? (wins / totalGames) * 100 : 0;
    const averageFinish = playerRows.length > 0
      ? playerRows.reduce((sum, row) => sum + (Number(row?.Rank) || 0), 0) / playerRows.length
      : Number.NaN;
    const bestFinishRow = pickBestFinishRow(playerRows);
    const worstFinishRow = pickWorstFinishRow(playerRows);
    const sortedRowsByDate = [...playerRows].sort((a, b) => {
      const dateCompare = String(b?.Date || '').localeCompare(String(a?.Date || ''));
      if (dateCompare !== 0) {
        return dateCompare;
      }

      return (Number(a?.Rank) || Number.POSITIVE_INFINITY) - (Number(b?.Rank) || Number.POSITIVE_INFINITY);
    });
    const latestRow = sortedRowsByDate[0] || null;
    const sortedDates = [...new Set(playerRows.map(row => String(row?.Date || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    const deckCounts = playerRows.reduce((acc, row) => {
      const deckName = String(row?.Deck || '').trim() || 'Unknown';
      acc[deckName] = (acc[deckName] || 0) + 1;
      return acc;
    }, {});

    const deckEntries = Object.entries(deckCounts);
    const [mostPlayedDeck = '--', mostPlayedDeckCount = 0] = deckEntries
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [];
    const [leastPlayedDeck = '--', leastPlayedDeckCount = 0] = [...deckEntries]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0] || [];
    const rankBucketCounts = getRankBucketCounts(playerRows);

    return {
      player: playerStat.player,
      eventCount: playerStat.eventCount,
      averageEventWinRate: playerStat.avgWinRate,
      overallWinRate,
      wins,
      losses,
      averageFinish,
      uniqueDeckCount: Object.keys(deckCounts).length,
      mostPlayedDeck,
      mostPlayedDeckCount,
      leastPlayedDeck,
      leastPlayedDeckCount,
      top8Count: rankBucketCounts.top8,
      top9_16Count: rankBucketCounts.top9_16,
      top17_32Count: rankBucketCounts.top17_32,
      belowTop32Count: rankBucketCounts.belowTop32,
      bestFinishRow,
      worstFinishRow,
      latestRow,
      firstDate: sortedDates[0] || '',
      lastDate: sortedDates[sortedDates.length - 1] || ''
    };
  });
}

function renderMultiPlayerWinRateDetails(point, { pinned = false } = {}) {
  if (!point?.player) {
    renderMultiPlayerWinRateDetailsPlaceholder('Hover a player point to inspect the aggregate result profile. Click a point to open the modal.');
    return;
  }

  const bestResult = formatPlayerResultSummary(point.bestFinishRow);
  const worstResult = formatPlayerResultSummary(point.worstFinishRow);
  const latestResult = formatPlayerResultSummary(point.latestRow);
  const spanLabel = point.firstDate && point.lastDate
    ? point.firstDate === point.lastDate
      ? formatDate(point.firstDate)
      : `${formatDate(point.firstDate)} - ${formatDate(point.lastDate)}`
    : 'Selected Multi-Event Span';

  setMultiPlayerWinRateDetailsMarkup(`
    <div class="player-chart-event-card${pinned ? ' player-chart-event-card-pinned' : ''}">
      <div class="player-chart-event-header">
        <div class="player-chart-event-date">${escapeHtml(spanLabel)}</div>
        <button type="button" class="player-chart-event-title player-chart-event-title-button" data-multi-player-aggregate-open="${escapeHtml(point.player)}">${escapeHtml(point.player)}</button>
      </div>
      <div class="player-chart-event-grid">
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Events</span>
          <strong class="player-chart-event-value">${escapeHtml(point.eventCount)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Record</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.wins}-${point.losses}`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Avg Event WR</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.averageEventWinRate.toFixed(1)}%`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Overall WR</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.overallWinRate.toFixed(1)}%`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Average Finish</span>
          <strong class="player-chart-event-value">${escapeHtml(formatAverageFinish(point.averageFinish))}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Most Played Deck</span>
          <strong class="player-chart-event-value">${escapeHtml(point.mostPlayedDeck === '--' ? '--' : `${point.mostPlayedDeck} (${point.mostPlayedDeckCount})`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Least Played Deck</span>
          <strong class="player-chart-event-value">${escapeHtml(point.leastPlayedDeck === '--' ? '--' : `${point.leastPlayedDeck} (${point.leastPlayedDeckCount})`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Decks Used</span>
          <strong class="player-chart-event-value">${escapeHtml(point.uniqueDeckCount)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Top 8s</span>
          <strong class="player-chart-event-value">${escapeHtml(point.top8Count)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Top 9-16</span>
          <strong class="player-chart-event-value">${escapeHtml(point.top9_16Count)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Top 17-32</span>
          <strong class="player-chart-event-value">${escapeHtml(point.top17_32Count)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Below Top 32</span>
          <strong class="player-chart-event-value">${escapeHtml(point.belowTop32Count)}</strong>
        </div>
      </div>
      <div class="player-chart-event-standouts">
        <div class="player-chart-event-standout-card">
          <span class="player-chart-event-label">Best Result</span>
          <strong class="player-chart-event-value">${escapeHtml(bestResult?.event || '--')}</strong>
          <span class="player-chart-event-standout-meta">${escapeHtml(bestResult ? `${bestResult.finish} | ${bestResult.deck}` : '--')}</span>
          <span class="player-chart-event-standout-meta">${escapeHtml(bestResult ? `${bestResult.record} | ${bestResult.winRate} | ${bestResult.date}` : '--')}</span>
        </div>
        <div class="player-chart-event-standout-card player-chart-event-standout-card-worst">
          <span class="player-chart-event-label">Worst Result</span>
          <strong class="player-chart-event-value">${escapeHtml(worstResult?.event || '--')}</strong>
          <span class="player-chart-event-standout-meta">${escapeHtml(worstResult ? `${worstResult.finish} | ${worstResult.deck}` : '--')}</span>
          <span class="player-chart-event-standout-meta">${escapeHtml(worstResult ? `${worstResult.record} | ${worstResult.winRate} | ${worstResult.date}` : '--')}</span>
        </div>
      </div>
      <div class="player-chart-event-winner">
        Latest Result:
        <strong>${escapeHtml(latestResult?.event || '--')}</strong>
        with <strong>${escapeHtml(latestResult?.deck || '--')}</strong> |
        ${escapeHtml(latestResult ? `${latestResult.finish} | ${latestResult.record} | ${latestResult.winRate}` : '--')}
      </div>
    </div>
  `);
}

// Redraws the aggregate player win-rate scatter chart for the active multi-event
// window.
export function updateMultiPlayerWinRateChart() {
  console.log("updateMultiPlayerWinRateChart called...");
  setChartLoading("multiPlayerWinRateChart", true);
  const theme = getChartTheme();
  const startDate = document.getElementById('startDateSelect')?.value || '';
  const endDate = document.getElementById('endDateSelect')?.value || '';
  const panel = document.getElementById('multiEventPlayerScatterPanel');
  pinnedMultiPlayerPointKey = '';
  ensureMultiPlayerWinRateDetailsInteractions();

  const chartData = getDeckEvolutionChartData();
  if (panel) {
    renderMultiEventPeriodSummaryBadge({
      container: panel,
      insertAfter: panel.querySelector('.player-search-container') || panel.querySelector('#multiPlayerWinRateChartLoading'),
      badgeId: 'multiEventPlayerScatterPeriodBadge',
      rows: chartData,
      startDate,
      endDate
    });
  }

  if (chartData.length === 0) {
    renderMultiPlayerWinRateDetailsPlaceholder('No player results are available for the current Multi-Event filters.');
    if (multiPlayerWinRateChart) multiPlayerWinRateChart.destroy();
    const multiPlayerWinRateCtx = document.getElementById("multiPlayerWinRateChart");
    if (multiPlayerWinRateCtx) {
      multiPlayerWinRateChart = new Chart(multiPlayerWinRateCtx, {
        type: 'scatter',
        data: {
          labels: ["No Data"],
          datasets: [{ label: "Average Win Rate (%)", data: [0], backgroundColor: '#808080' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { display: false }, x: { ticks: { color: theme.text } } }
        }
      });
    }
    setChartLoading("multiPlayerWinRateChart", false);
    return;
  }

  const playerData = calculateMultiPlayerWinRateStats(chartData);
  const sortedPlayerData = playerData.sort((a, b) => b.avgWinRate - a.avgWinRate || b.eventCount - a.eventCount);
  const pointDetails = buildMultiPlayerPointDetails(sortedPlayerData, chartData);
  const labels = pointDetails.map(point => point.player);
  const winRates = pointDetails.map(point => point.averageEventWinRate);
  const eventCounts = pointDetails.map(point => point.eventCount);

  if (multiPlayerWinRateChart) multiPlayerWinRateChart.destroy();
  const multiPlayerWinRateCtx = document.getElementById("multiPlayerWinRateChart");
  if (!multiPlayerWinRateCtx) {
    console.error("Multi-Event Player Win Rate Chart canvas not found!");
    setChartLoading("multiPlayerWinRateChart", false);
    return;
  }

  // Add searchable dropdown
  const chartContainer = multiPlayerWinRateCtx.parentElement;
  let searchContainer = chartContainer.querySelector('.player-search-container');
  if (!searchContainer) {
    searchContainer = document.createElement('div');
    searchContainer.className = 'player-search-container chart-search-container';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search players...';
    searchInput.className = 'player-search-input chart-search-input';
    
    const dropdown = document.createElement('div');
    dropdown.className = 'player-dropdown chart-search-dropdown';
    
    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(dropdown);
    chartContainer.insertBefore(searchContainer, multiPlayerWinRateCtx);

    // Add event listeners for search functionality
    searchInput.addEventListener('input', (e) => {
      const searchState = searchContainer._playerSearchState || { labels: [], eventCounts: [], winRates: [], pointDetails: [] };
      const searchTerm = e.target.value.toLowerCase();
      
      // If search input is cleared, reset the chart
      if (searchTerm === '') {
        const dataset = multiPlayerWinRateChart.data.datasets[0];
        // Reset all points to default size and color
        dataset.pointRadius = dataset.data.map(() => 8);
        dataset.pointHoverRadius = dataset.data.map(() => 10);
        dataset.backgroundColor = dataset.data.map(() => '#FFD700');
        dataset.borderColor = dataset.data.map(() => '#DAA520');
        dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
        
        // Reset zoom by setting axis limits directly
        multiPlayerWinRateChart.options.scales.x.min = 0;
        multiPlayerWinRateChart.options.scales.x.max = Math.max(...(searchState.eventCounts.length ? searchState.eventCounts : [0])) + 2;
        multiPlayerWinRateChart.options.scales.y.min = 0;
        multiPlayerWinRateChart.options.scales.y.max = 100;
        
        multiPlayerWinRateChart.update();
        dropdown.style.display = 'none';
        return;
      }
      
      const filteredPlayers = searchState.labels.filter(player => 
        player.toLowerCase().includes(searchTerm)
      );
      
      dropdown.innerHTML = '';
      dropdown.style.display = filteredPlayers.length > 0 ? 'block' : 'none';
      
      filteredPlayers.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'chart-search-option';
        playerDiv.textContent = player;
        
        playerDiv.addEventListener('click', () => {
          searchInput.value = player;
          dropdown.style.display = 'none';
          
          // Find and highlight the selected player's point
          const dataset = multiPlayerWinRateChart.data.datasets[0];
          const pointIndex = dataset.data.findIndex(d => d.label === player);
          if (pointIndex !== -1) {
            // Reset all points to default size and color
            dataset.pointRadius = dataset.data.map(() => 8);
            dataset.pointHoverRadius = dataset.data.map(() => 10);
            dataset.backgroundColor = dataset.data.map(() => '#FFD700');
            dataset.borderColor = dataset.data.map(() => '#DAA520');
            dataset.pointStyle = dataset.data.map(() => 'circle'); // Reset point style
            
            // Make selected point larger and red
            dataset.pointRadius[pointIndex] = 18;
            dataset.pointHoverRadius[pointIndex] = 20;
            dataset.backgroundColor[pointIndex] = '#FF0000';
            dataset.borderColor[pointIndex] = '#CC0000';
            dataset.pointStyle[pointIndex] = 'rectRot'; // Change shape to diamond
            
            // Update chart
            multiPlayerWinRateChart.update();
            
            // Center the view on the selected point
            const xValue = dataset.data[pointIndex].x;
            const yValue = dataset.data[pointIndex].y;
            
            // Calculate the range to show around the point
            const xRange = 5; // Show 5 events on each side
            const yRange = 20; // Show 20% win rate on each side
            
            // Round the zoom values to 2 decimal places
            multiPlayerWinRateChart.options.scales.x.min = Number(Math.max(0, xValue - xRange).toFixed(2));
            multiPlayerWinRateChart.options.scales.x.max = Number((xValue + xRange).toFixed(2));
            multiPlayerWinRateChart.options.scales.y.min = Number(Math.max(0, yValue - yRange).toFixed(2));
            multiPlayerWinRateChart.options.scales.y.max = Number(Math.min(100, yValue + yRange).toFixed(2));
            
            multiPlayerWinRateChart.update();

            const point = searchState.pointDetails[pointIndex];
            if (point) {
              pinnedMultiPlayerPointKey = getMultiPlayerPointKey(point);
              renderMultiPlayerWinRateDetails(point, { pinned: true });
            }
          }
        });
        
        dropdown.appendChild(playerDiv);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!searchContainer.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  searchContainer._playerSearchState = { labels, eventCounts, winRates, pointDetails };

  if (panel) {
    renderMultiEventPeriodSummaryBadge({
      container: panel,
      insertAfter: searchContainer,
      badgeId: 'multiEventPlayerScatterPeriodBadge',
      rows: chartData,
      startDate,
      endDate
    });
  }

  renderMultiPlayerWinRateDetailsPlaceholder('Hover a player point to inspect the aggregate result profile. Click a point to open the modal.');

  try {
    multiPlayerWinRateChart = new Chart(multiPlayerWinRateCtx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: "Players",
          data: pointDetails.map(point => ({
            x: point.eventCount,
            y: point.averageEventWinRate,
            label: point.player,
            events: point.eventCount,
            winRate: point.averageEventWinRate,
            record: `${point.wins}-${point.losses}`,
            overallWinRate: point.overallWinRate,
            mostPlayedDeck: point.mostPlayedDeck
          })),
          backgroundColor: '#FFD700',
          borderColor: '#DAA520',
          borderWidth: 1,
          pointRadius: 8,
          pointHoverRadius: 10,
          pointHitRadius: 18
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: "Events Played",
              color: theme.text,
              font: { size: 14, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: theme.text,
              font: { size: 12, family: "'Bitter', serif" },
              stepSize: 1
            },
            grid: { color: theme.grid },
            min: 0,
            max: Math.max(...eventCounts) + 1
          },
          y: buildSharedMultiScatterYAxis(theme)
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { 
              color: theme.mutedText,
              font: { size: 14, family: "'Bitter', serif" },
              boxWidth: 20,
              padding: 10
            }
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            mode: 'nearest',
            intersect: true,
            titleFont: { 
              family: "'Bitter', serif", 
              size: 14, 
              weight: 'bold',
              color: '#FFD700'
            },
            bodyFont: { 
              family: "'Bitter', serif", 
              size: 12,
              color: theme.tooltipText
            },
            titleColor: '#FFD700',
            bodyColor: theme.tooltipText,
            callbacks: {
              title: context => context[0]?.raw?.label || '',
              label: context => {
                if (!context.raw) return [];
                return [
                  `Events Played: ${context.raw.x}`,
                  `Average Event WR: ${context.raw.y.toFixed(2)}%`,
                  `Record: ${context.raw.record}`,
                  `Overall WR: ${context.raw.overallWinRate.toFixed(2)}%`
                ];
              },
              afterBody(context) {
                const point = pointDetails[context[0]?.dataIndex];
                if (!pinnedMultiPlayerPointKey) {
                  renderMultiPlayerWinRateDetails(point);
                }
                return '';
              }
            },
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            displayColors: true
          },
          datalabels: {
            display: true,
            color: theme.mutedText,
            font: { size: 10, family: "'Bitter', serif" },
            formatter: (value) => value.label,
            align: 'top',
            offset: 4
          },
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
            limits: {
              x: { min: 0, max: Math.max(...eventCounts) + 1 },
              y: { min: 0, max: 100 }
            }
          }
        },
        onClick(event, activeElements) {
          if (!activeElements?.length) {
            return;
          }

          const point = pointDetails[activeElements[0].index];
          pinnedMultiPlayerPointKey = '';
          openMultiEventPlayerAggregateModal(point.player);
        },
        onHover(event, activeElements) {
          multiPlayerWinRateCtx.style.cursor = activeElements?.length ? 'pointer' : 'default';

          if (activeElements?.length) {
            const hoveredPoint = pointDetails[activeElements[0].index];
            const hoveredPointKey = getMultiPlayerPointKey(hoveredPoint);

            if (pinnedMultiPlayerPointKey === hoveredPointKey) {
              renderMultiPlayerWinRateDetails(hoveredPoint, { pinned: true });
              return;
            }

            renderMultiPlayerWinRateDetails(hoveredPoint);
            return;
          }

          if (pinnedMultiPlayerPointKey) {
            const pinnedPoint = getMultiPlayerPointByKey(pointDetails, pinnedMultiPlayerPointKey);
            if (pinnedPoint) {
              renderMultiPlayerWinRateDetails(pinnedPoint, { pinned: true });
              return;
            }

            pinnedMultiPlayerPointKey = '';
            renderMultiPlayerWinRateDetailsPlaceholder('Hover a player point to inspect the aggregate result profile. Click a point to open the modal.');
            return;
          }

          renderMultiPlayerWinRateDetailsPlaceholder('Hover a player point to inspect the aggregate result profile. Click a point to open the modal.');
        },
        animation: { duration: 1000, easing: 'easeOutQuart' }
      }
    });

    // Add double-click to reset zoom
    multiPlayerWinRateCtx.ondblclick = () => {
      multiPlayerWinRateChart.resetZoom();
    };
    multiPlayerWinRateCtx.style.cursor = 'default';
  } catch (error) {
    console.error("Error initializing Multi-Event Player Win Rate Chart:", error);
  }

  setChartLoading("multiPlayerWinRateChart", false);
}
