// Multi-event deck evolution chart. It follows one deck across dates and keeps
// the multi-event table synchronized with the focused deck.
import { setChartLoading } from '../utils/dom.js';
import { getDeckEvolutionChartData } from '../modules/filters/filter-index.js';
import { calculateDeckEvolutionStats } from "../utils/data-chart.js";
import { updateMultiEventTables } from '../modules/event-analysis.js';
import { getChartTheme } from '../utils/theme.js';
import { formatDate, formatEventName } from '../utils/format.js';

export let deckEvolutionChart = null;
let deckEvolutionModalChart = null;
// Empty means hover controls the detail panel; otherwise the clicked date remains
// pinned so the user can compare the chart with the table below.
let pinnedDeckEvolutionPointKey = '';
let pinnedDeckEvolutionModalPointKey = '';

const DECK_EVOLUTION_DEFAULT_PLACEHOLDER = 'Hover a date to inspect the selected deck across that day. Click a bar or point to lock it.';

function normalizeDeckName(value) {
  return String(value || '').trim();
}

function setMultiEventTableToggleState(tableType = 'aggregate') {
  const toggleButtons = document.querySelectorAll('#multiEventCharts .table-toggle-btn');
  toggleButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.table === tableType);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDeckEvolutionTargets(target = 'main') {
  if (target === 'modal') {
    return {
      target,
      canvasId: 'deckEvolutionFocusChart',
      loadingId: 'deckEvolutionFocusChartLoading',
      detailsId: 'deckEvolutionFocusDetails'
    };
  }

  return {
    target: 'main',
    canvasId: 'deckEvolutionChart',
    loadingId: 'deckEvolutionChartLoading',
    detailsId: 'deckEvolutionEventDetails'
  };
}

function getDeckEvolutionChartInstance(target = 'main') {
  return target === 'modal' ? deckEvolutionModalChart : deckEvolutionChart;
}

function setDeckEvolutionChartInstance(target = 'main', chartInstance = null) {
  if (target === 'modal') {
    deckEvolutionModalChart = chartInstance;
    return;
  }

  deckEvolutionChart = chartInstance;
}

function getPinnedDeckEvolutionPointKey(target = 'main') {
  return target === 'modal' ? pinnedDeckEvolutionModalPointKey : pinnedDeckEvolutionPointKey;
}

function setPinnedDeckEvolutionPointKey(target = 'main', pointKey = '') {
  if (target === 'modal') {
    pinnedDeckEvolutionModalPointKey = pointKey;
    return;
  }

  pinnedDeckEvolutionPointKey = pointKey;
}

function destroyDeckEvolutionChart(target = 'main') {
  const chartInstance = getDeckEvolutionChartInstance(target);
  if (chartInstance) {
    chartInstance.destroy();
  }

  setDeckEvolutionChartInstance(target, null);
}

function setDeckEvolutionDetailsMarkup(markup, { detailsId = 'deckEvolutionEventDetails' } = {}) {
  const detailsEl = document.getElementById(detailsId);
  if (!detailsEl) {
    return;
  }

  detailsEl.innerHTML = markup;
}

function renderDeckEvolutionDetailsPlaceholder(
  message,
  { detailsId = 'deckEvolutionEventDetails' } = {}
) {
  setDeckEvolutionDetailsMarkup(`
    <div class="player-chart-event-placeholder">${escapeHtml(message)}</div>
  `, { detailsId });
}

function getDeckEvolutionPointKey(point) {
  return String(point?.date || '').trim();
}

function getDeckEvolutionPointByKey(pointDetails, pointKey) {
  return pointDetails.find(point => getDeckEvolutionPointKey(point) === pointKey) || null;
}

function getPointRowWinRate(row) {
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

    const rowWinRate = getPointRowWinRate(row);
    const bestWinRate = getPointRowWinRate(bestRow);
    if (rowWinRate !== bestWinRate) {
      return rowWinRate > bestWinRate ? row : bestRow;
    }

    return String(row?.Player || '').localeCompare(String(bestRow?.Player || '')) < 0 ? row : bestRow;
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

    const rowWinRate = getPointRowWinRate(row);
    const worstWinRate = getPointRowWinRate(worstRow);
    if (rowWinRate !== worstWinRate) {
      return rowWinRate < worstWinRate ? row : worstRow;
    }

    return String(row?.Player || '').localeCompare(String(worstRow?.Player || '')) < 0 ? row : worstRow;
  }, rows[0]);
}

function formatAverageFinish(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const roundedValue = Math.round(value * 10) / 10;
  return Number.isInteger(roundedValue) ? `#${roundedValue}` : `#${roundedValue.toFixed(1)}`;
}

function formatDeckPilotSummary(row) {
  const wins = Number(row?.Wins) || 0;
  const losses = Number(row?.Losses) || 0;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const formattedEventName = formatEventName(row?.Event) || row?.Event || '--';

  return {
    name: row?.Player || '--',
    finish: Number.isFinite(Number(row?.Rank)) ? `#${row.Rank}` : '--',
    event: formattedEventName,
    record: `${wins}-${losses}`,
    winRate: `${winRate}% WR`
  };
}

function buildDeckEvolutionPointDetails(filteredData, currentDeck, dates, metaShares, winRates) {
  // The chart plots only meta/win-rate series, but the details panel needs event
  // counts, pilots, finish extremes, and records for the same date.
  return dates.map((date, index) => {
    const dateRows = filteredData.filter(row => row.Date === date);
    const deckRows = dateRows.filter(row => normalizeDeckName(row?.Deck) === currentDeck);
    const eventNames = [...new Set(dateRows.map(row => String(row?.Event || '').trim()).filter(Boolean))];
    const totalPlayers = dateRows.length;
    const deckCopies = deckRows.length;
    const deckWins = deckRows.reduce((sum, row) => sum + (Number(row?.Wins) || 0), 0);
    const deckLosses = deckRows.reduce((sum, row) => sum + (Number(row?.Losses) || 0), 0);
    const averageFinish = deckRows.length > 0
      ? deckRows.reduce((sum, row) => sum + (Number(row?.Rank) || 0), 0) / deckRows.length
      : Number.NaN;
    const bestFinishRow = pickBestFinishRow(deckRows);
    const worstFinishRow = pickWorstFinishRow(deckRows);
    const eventSummaries = eventNames.map(eventName => {
      const eventRows = dateRows.filter(row => String(row?.Event || '').trim() === eventName);
      const winnerRow = pickBestFinishRow(eventRows);

      return {
        eventName,
        formattedEventName: formatEventName(eventName) || eventName || '--',
        winnerRow
      };
    });

    return {
      date,
      deck: currentDeck,
      eventCount: eventNames.length,
      totalPlayers,
      deckCopies,
      deckWins,
      deckLosses,
      metaShare: metaShares[index] || 0,
      winRate: winRates[index] || 0,
      averageFinish,
      bestFinishRow,
      worstFinishRow,
      eventSummaries
    };
  });
}

function renderDeckEvolutionDetails(
  point,
  {
    pinned = false,
    detailsId = 'deckEvolutionEventDetails'
  } = {}
) {
  if (!point?.date) {
    renderDeckEvolutionDetailsPlaceholder(DECK_EVOLUTION_DEFAULT_PLACEHOLDER, { detailsId });
    return;
  }

  const bestPilotSummary = point.bestFinishRow ? formatDeckPilotSummary(point.bestFinishRow) : null;
  const worstPilotSummary = point.worstFinishRow ? formatDeckPilotSummary(point.worstFinishRow) : null;
  const deckRecord = `${point.deckWins}-${point.deckLosses}`;
  const formattedDate = formatDate(point.date);
  const title = point.eventCount === 1
    ? point.eventSummaries[0]?.formattedEventName || 'Selected Event'
    : `${point.eventCount} events on this date`;
  const winnersPreview = point.eventSummaries
    .filter(summary => summary.winnerRow)
    .slice(0, 3)
    .map(summary => {
      const winnerRow = summary.winnerRow;
      const wins = Number(winnerRow?.Wins) || 0;
      const losses = Number(winnerRow?.Losses) || 0;
      const winnerWinRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

      return `${summary.formattedEventName}: ${winnerRow?.Player || '--'} (${winnerRow?.Deck || '--'} | ${wins}-${losses} | ${winnerWinRate}% WR)`;
    });
  const winnersOverflow = Math.max(0, point.eventSummaries.filter(summary => summary.winnerRow).length - winnersPreview.length);

  setDeckEvolutionDetailsMarkup(`
    <div class="player-chart-event-card${pinned ? ' player-chart-event-card-pinned' : ''}">
      <div class="player-chart-event-header">
        <div class="player-chart-event-date">${escapeHtml(formattedDate)}</div>
        <div class="player-chart-event-title">${escapeHtml(title)}</div>
      </div>
      <div class="player-chart-event-grid">
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Deck</span>
          <strong class="player-chart-event-value">${escapeHtml(point.deck)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Events</span>
          <strong class="player-chart-event-value">${escapeHtml(point.eventCount)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Copies</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.deckCopies}/${point.totalPlayers} pilots`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Meta Share</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.metaShare.toFixed(1)}%`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Record</span>
          <strong class="player-chart-event-value">${escapeHtml(deckRecord)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Deck WR</span>
          <strong class="player-chart-event-value">${escapeHtml(`${point.winRate.toFixed(1)}%`)}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Average Finish</span>
          <strong class="player-chart-event-value">${escapeHtml(formatAverageFinish(point.averageFinish))}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Best Finish</span>
          <strong class="player-chart-event-value">${escapeHtml(point.bestFinishRow ? `${point.bestFinishRow.Player || '--'} (#${point.bestFinishRow.Rank ?? '--'})` : '--')}</strong>
        </div>
        <div class="player-chart-event-item">
          <span class="player-chart-event-label">Worst Finish</span>
          <strong class="player-chart-event-value">${escapeHtml(point.worstFinishRow ? `${point.worstFinishRow.Player || '--'} (#${point.worstFinishRow.Rank ?? '--'})` : '--')}</strong>
        </div>
      </div>
      <div class="player-chart-event-standouts">
        <div class="player-chart-event-standout-card">
          <span class="player-chart-event-label">Best Deck Result</span>
          <strong class="player-chart-event-value">${escapeHtml(bestPilotSummary?.name || '--')}</strong>
          <span class="player-chart-event-standout-meta">${escapeHtml(bestPilotSummary ? `${bestPilotSummary.finish} | ${bestPilotSummary.event}` : '--')}</span>
          <span class="player-chart-event-standout-meta">${escapeHtml(bestPilotSummary ? `${bestPilotSummary.record} | ${bestPilotSummary.winRate}` : '--')}</span>
        </div>
        <div class="player-chart-event-standout-card player-chart-event-standout-card-worst">
          <span class="player-chart-event-label">Worst Deck Result</span>
          <strong class="player-chart-event-value">${escapeHtml(worstPilotSummary?.name || '--')}</strong>
          <span class="player-chart-event-standout-meta">${escapeHtml(worstPilotSummary ? `${worstPilotSummary.finish} | ${worstPilotSummary.event}` : '--')}</span>
          <span class="player-chart-event-standout-meta">${escapeHtml(worstPilotSummary ? `${worstPilotSummary.record} | ${worstPilotSummary.winRate}` : '--')}</span>
        </div>
      </div>
      <div class="player-chart-event-winner">
        ${point.eventCount === 1
          ? `Event Winner: <strong>${escapeHtml(point.eventSummaries[0]?.winnerRow?.Player || '--')}</strong> with <strong>${escapeHtml(point.eventSummaries[0]?.winnerRow?.Deck || '--')}</strong>`
          : `Date Winners: <strong>${escapeHtml(winnersPreview.join(' | ') || '--')}</strong>${winnersOverflow > 0 ? escapeHtml(` | +${winnersOverflow} more`) : ''}`
        }
      </div>
    </div>
  `, { detailsId });
}

function setDeckEvolutionChartFocus(chartInstance, pointDetails, pointIndex) {
  if (!chartInstance || !Array.isArray(pointDetails) || pointIndex < 0 || pointIndex >= pointDetails.length) {
    return;
  }

  const preferredDatasetIndex = chartInstance.data?.datasets?.length > 1 ? 1 : 0;
  const element = chartInstance.getDatasetMeta(preferredDatasetIndex)?.data?.[pointIndex];
  if (!element) {
    return;
  }

  const activeElements = [{ datasetIndex: preferredDatasetIndex, index: pointIndex }];
  const position = typeof element.getCenterPoint === 'function'
    ? element.getCenterPoint()
    : { x: element.x, y: element.y };

  chartInstance.setActiveElements(activeElements);
  if (chartInstance.tooltip?.setActiveElements) {
    chartInstance.tooltip.setActiveElements(activeElements, position);
  }
  chartInstance.update();
}

function bindMainDeckEvolutionTableToggles(filteredData, currentDeck) {
  const toggleButtons = document.querySelectorAll('#multiEventCharts .table-toggle-btn');
  toggleButtons.forEach(button => {
    button.onclick = () => {
      toggleButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const tableType = button.dataset.table;
      updateMultiEventTables(filteredData, tableType, currentDeck);
    };
  });
}

function renderDeckEvolutionChartView({
  target = 'main',
  filteredData = [],
  currentDeck = '',
  syncTables = false,
  persistentFocusOnOpen = false,
  emptyStateMessage = 'Choose a deck to inspect its date-by-date meta share and win rate.'
} = {}) {
  const { canvasId, loadingId, detailsId } = getDeckEvolutionTargets(target);
  const theme = getChartTheme();
  const canvas = document.getElementById(canvasId);

  setChartLoading(loadingId, true);

  if (!canvas) {
    console.error(`Deck Evolution Chart canvas not found for target "${target}"!`);
    setChartLoading(loadingId, false);
    return;
  }

  destroyDeckEvolutionChart(target);
  setPinnedDeckEvolutionPointKey(target, '');

  const normalizedCurrentDeck = normalizeDeckName(currentDeck);
  const hasDeckRows = normalizedCurrentDeck
    ? filteredData.some(row => normalizeDeckName(row?.Deck) === normalizedCurrentDeck)
    : false;

  if (filteredData.length === 0 || !normalizedCurrentDeck || !hasDeckRows) {
    renderDeckEvolutionDetailsPlaceholder(
      normalizedCurrentDeck
        ? `No evolution data is available for ${normalizedCurrentDeck} in the current multi-event filters.`
        : emptyStateMessage,
      { detailsId }
    );

    const emptyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['No Data'],
        datasets: [{ label: 'Meta Share %', data: [0], backgroundColor: '#808080' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { display: false }, x: { ticks: { color: theme.text } } }
      }
    });

    setDeckEvolutionChartInstance(target, emptyChart);
    if (syncTables) {
      updateMultiEventTables(filteredData, 'deck', normalizedCurrentDeck);
      bindMainDeckEvolutionTableToggles(filteredData, normalizedCurrentDeck);
    }
    setChartLoading(loadingId, false);
    return;
  }

  const { dates, metaShares, winRates } = calculateDeckEvolutionStats(filteredData, normalizedCurrentDeck);
  const pointDetails = buildDeckEvolutionPointDetails(filteredData, normalizedCurrentDeck, dates, metaShares, winRates);
  const maxMetaShare = Math.max(...metaShares, 1);
  const metaShareMax = Math.ceil(maxMetaShare / 10) * 10;
  const initialFocusIndex = pointDetails.length > 0 ? pointDetails.length - 1 : -1;

  if (persistentFocusOnOpen && initialFocusIndex >= 0) {
    const focusedPoint = pointDetails[initialFocusIndex];
    setPinnedDeckEvolutionPointKey(target, getDeckEvolutionPointKey(focusedPoint));
    renderDeckEvolutionDetails(focusedPoint, { pinned: true, detailsId });
  } else {
    renderDeckEvolutionDetailsPlaceholder(DECK_EVOLUTION_DEFAULT_PLACEHOLDER, { detailsId });
  }

  const datasets = [
    {
      label: 'Meta Share %',
      data: metaShares,
      backgroundColor: '#FF6347',
      borderColor: '#FF6347',
      borderWidth: 1,
      barPercentage: 0.5,
      categoryPercentage: 0.8,
      yAxisID: 'y'
    },
    {
      type: 'line',
      label: 'Win Rate %',
      data: winRates,
      borderColor: '#FFD700',
      backgroundColor: '#FFD700',
      pointBackgroundColor: '#FFD700',
      pointBorderColor: '#FFD700',
      pointRadius: 4,
      pointHoverRadius: 6,
      pointHitRadius: 18,
      fill: false,
      tension: 0.2,
      yAxisID: 'y2'
    }
  ];

  try {
    const chartInstance = new Chart(canvas, {
      type: 'bar',
      data: { labels: dates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: metaShareMax,
            title: { display: true, text: 'Meta Share %', color: theme.text },
            grid: { color: theme.grid },
            ticks: { color: theme.text }
          },
          y2: {
            position: 'right',
            beginAtZero: true,
            max: 100,
            title: { display: true, text: 'Win Rate %', color: theme.text },
            grid: { color: theme.grid },
            ticks: { color: theme.text }
          },
          x: {
            title: { display: true, text: 'Date', color: theme.text },
            grid: { borderDash: [5, 5], color: theme.grid },
            ticks: { color: theme.text, autoSkip: true, maxRotation: 45, minRotation: 0 }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: theme.mutedText, font: { size: 12 }, boxWidth: 20, padding: 10 }
          },
          tooltip: {
            mode: 'nearest',
            intersect: true,
            displayColors: false,
            callbacks: {
              title: tooltipItems => formatDate(tooltipItems[0]?.label || ''),
              beforeBody: tooltipItems => {
                const point = pointDetails[tooltipItems[0]?.dataIndex];
                if (!point) {
                  return [];
                }

                return [
                  point.eventCount === 1
                    ? (point.eventSummaries[0]?.formattedEventName || 'Selected Event')
                    : `${point.eventCount} events on this date`
                ];
              },
              label: context => {
                const point = pointDetails[context.dataIndex];
                if (!point) {
                  return '';
                }

                return context.datasetIndex === 0
                  ? [`Deck: ${point.deck}`, `Meta Share: ${point.metaShare.toFixed(1)}%`, `Copies: ${point.deckCopies}/${point.totalPlayers}`]
                  : [`Deck: ${point.deck}`, `Win Rate: ${point.winRate.toFixed(1)}%`, `Record: ${point.deckWins}-${point.deckLosses}`];
              },
              afterBody(context) {
                const point = pointDetails[context[0]?.dataIndex];
                if (!getPinnedDeckEvolutionPointKey(target)) {
                  renderDeckEvolutionDetails(point, { detailsId });
                }
                return '';
              }
            },
            backgroundColor: theme.tooltipBg,
            titleFont: { size: 14, weight: 'bold' },
            bodyFont: { size: 12 },
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10
          },
          datalabels: { display: false }
        },
        onClick(_event, activeElements) {
          if (!activeElements?.length) {
            if (getPinnedDeckEvolutionPointKey(target)) {
              setPinnedDeckEvolutionPointKey(target, '');
              renderDeckEvolutionDetailsPlaceholder(DECK_EVOLUTION_DEFAULT_PLACEHOLDER, { detailsId });
            }
            return;
          }

          const point = pointDetails[activeElements[0].index];
          const pointKey = getDeckEvolutionPointKey(point);

          if (getPinnedDeckEvolutionPointKey(target) === pointKey) {
            setPinnedDeckEvolutionPointKey(target, '');
            renderDeckEvolutionDetailsPlaceholder(DECK_EVOLUTION_DEFAULT_PLACEHOLDER, { detailsId });
            return;
          }

          setPinnedDeckEvolutionPointKey(target, pointKey);
          renderDeckEvolutionDetails(point, { pinned: true, detailsId });
        },
        onHover(_event, activeElements) {
          canvas.style.cursor = activeElements?.length ? 'pointer' : 'default';

          if (activeElements?.length) {
            const hoveredPoint = pointDetails[activeElements[0].index];
            const hoveredPointKey = getDeckEvolutionPointKey(hoveredPoint);

            if (getPinnedDeckEvolutionPointKey(target) === hoveredPointKey) {
              renderDeckEvolutionDetails(hoveredPoint, { pinned: true, detailsId });
              return;
            }

            renderDeckEvolutionDetails(hoveredPoint, { detailsId });
            return;
          }

          if (getPinnedDeckEvolutionPointKey(target)) {
            const pinnedPoint = getDeckEvolutionPointByKey(pointDetails, getPinnedDeckEvolutionPointKey(target));
            if (pinnedPoint) {
              renderDeckEvolutionDetails(pinnedPoint, { pinned: true, detailsId });
              return;
            }

            setPinnedDeckEvolutionPointKey(target, '');
          }

          renderDeckEvolutionDetailsPlaceholder(DECK_EVOLUTION_DEFAULT_PLACEHOLDER, { detailsId });
        },
        animation: {
          duration: target === 'modal' ? 0 : 1000,
          easing: 'easeOutQuart'
        }
      }
    });

    setDeckEvolutionChartInstance(target, chartInstance);

    if (persistentFocusOnOpen && initialFocusIndex >= 0) {
      requestAnimationFrame(() => {
        setDeckEvolutionChartFocus(chartInstance, pointDetails, initialFocusIndex);
      });
    }
  } catch (error) {
    console.error(`Error initializing Deck Evolution Chart for target "${target}":`, error);
  }

  canvas.style.cursor = 'default';

  if (syncTables) {
    updateMultiEventTables(filteredData, 'deck', normalizedCurrentDeck);
    bindMainDeckEvolutionTableToggles(filteredData, normalizedCurrentDeck);
  }

  setChartLoading(loadingId, false);
}

function getDeckEvolutionModalElements() {
  return {
    overlay: document.getElementById('deckEvolutionFocusOverlay'),
    title: document.getElementById('deckEvolutionFocusTitle'),
    subtitle: document.getElementById('deckEvolutionFocusSubtitle'),
    closeButton: document.getElementById('deckEvolutionFocusClose')
  };
}

function closeMultiEventDeckEvolutionModal() {
  const { overlay } = getDeckEvolutionModalElements();
  if (!overlay) {
    return;
  }

  overlay.hidden = true;
  setPinnedDeckEvolutionPointKey('modal', '');
  destroyDeckEvolutionChart('modal');
  setDeckEvolutionDetailsMarkup('', { detailsId: 'deckEvolutionFocusDetails' });
  document.body.classList.remove('modal-open');
}

function ensureDeckEvolutionModalListeners() {
  const { overlay, closeButton } = getDeckEvolutionModalElements();
  if (!overlay || overlay.dataset.initialized === 'true') {
    return;
  }

  overlay.dataset.initialized = 'true';

  closeButton?.addEventListener('click', () => {
    closeMultiEventDeckEvolutionModal();
  });

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeMultiEventDeckEvolutionModal();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) {
      closeMultiEventDeckEvolutionModal();
    }
  });
}

export function openMultiEventDeckEvolutionModal(deckName) {
  const normalizedDeckName = normalizeDeckName(deckName);
  const { overlay, title, subtitle } = getDeckEvolutionModalElements();
  if (!overlay || !normalizedDeckName) {
    return false;
  }

  ensureDeckEvolutionModalListeners();

  if (title) {
    title.textContent = `${normalizedDeckName} Deck Evolution`;
  }
  if (subtitle) {
    subtitle.textContent = 'Meta share and win rate across the current multi-event window.';
  }

  overlay.hidden = false;
  document.body.classList.add('modal-open');

  renderDeckEvolutionChartView({
    target: 'modal',
    filteredData: getDeckEvolutionChartData(),
    currentDeck: normalizedDeckName,
    syncTables: false,
    persistentFocusOnOpen: true,
    emptyStateMessage: `No evolution data is available for ${normalizedDeckName} in the current multi-event filters.`
  });

  return true;
}

// Programmatically selects a deck in the multi-event deck evolution control and
// optionally scrolls the chart into view.
export function focusMultiEventDeck(deckName, { scrollIntoView = false } = {}) {
  const deckSelect = document.getElementById('deckEvolutionSelect');
  const normalizedDeckName = normalizeDeckName(deckName);

  if (!deckSelect || !normalizedDeckName) {
    return false;
  }

  deckSelect.value = normalizedDeckName;
  setMultiEventTableToggleState('deck');
  updateDeckEvolutionChart();

  if (scrollIntoView) {
    deckSelect.closest('.chart-container')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  return true;
}

// Redraws the selected deck's date-by-date meta share and win-rate evolution.
export function updateDeckEvolutionChart() {
  const deckSelect = document.getElementById("deckEvolutionSelect");
  const deckEvolutionCanvas = document.getElementById('deckEvolutionChart');
  if (!deckSelect || !deckEvolutionCanvas) {
    return;
  }

  console.log("updateDeckEvolutionChart called...");
  setChartLoading("deckEvolutionChart", true);
  const filteredData = getDeckEvolutionChartData();

  const decks = [...new Set(filteredData.map(row => normalizeDeckName(row?.Deck)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const selectedDeck = normalizeDeckName(deckSelect.value);
  const currentDeck = selectedDeck || (decks.length > 0 ? decks[0] : '');

  deckSelect.innerHTML = decks.map(deck =>
    `<option value="${deck}" ${deck === currentDeck ? 'selected' : ''}>${deck}</option>`
  ).join("");

  if (!deckSelect.dataset.listenerAdded) {
    deckSelect.addEventListener("change", () => updateDeckEvolutionChart());
    deckSelect.dataset.listenerAdded = "true";
  }

  renderDeckEvolutionChartView({
    target: 'main',
    filteredData,
    currentDeck,
    syncTables: true,
    persistentFocusOnOpen: false,
    emptyStateMessage: 'Choose a deck to inspect its date-by-date meta share and win rate.'
  });
}
