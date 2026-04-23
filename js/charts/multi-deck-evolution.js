// Multi-event deck evolution chart. It follows one deck across dates and keeps
// the multi-event table synchronized with the focused deck.
import { setChartLoading } from '../utils/dom.js';
import { getDeckEvolutionChartData } from '../modules/filters/filter-index.js';
import { calculateDeckEvolutionStats } from "../utils/data-chart.js";
import { updateMultiEventTables } from '../modules/event-analysis.js';
import { getChartTheme } from '../utils/theme.js';
import { formatDate, formatEventName } from '../utils/format.js';

export let deckEvolutionChart = null;
// Empty means hover controls the detail panel; otherwise the clicked date remains
// pinned so the user can compare the chart with the table below.
let pinnedDeckEvolutionPointKey = '';

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

function setDeckEvolutionDetailsMarkup(markup) {
  const detailsEl = document.getElementById('deckEvolutionEventDetails');
  if (!detailsEl) {
    return;
  }

  detailsEl.innerHTML = markup;
}

function renderDeckEvolutionDetailsPlaceholder(message) {
  setDeckEvolutionDetailsMarkup(`
    <div class="player-chart-event-placeholder">${escapeHtml(message)}</div>
  `);
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
    const deckRows = dateRows.filter(row => String(row?.Deck || '').trim() === currentDeck);
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

function renderDeckEvolutionDetails(point, { pinned = false } = {}) {
  if (!point?.date) {
    renderDeckEvolutionDetailsPlaceholder('Hover a date to inspect the selected deck across that day. Click a bar or point to lock it.');
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
  `);
}

// Programmatically selects a deck in the multi-event deck evolution control and
// optionally scrolls the chart into view.
export function focusMultiEventDeck(deckName, { scrollIntoView = false } = {}) {
  const deckSelect = document.getElementById('deckEvolutionSelect');
  const normalizedDeckName = String(deckName || '').trim();

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
  console.log("updateDeckEvolutionChart called...");
  setChartLoading("deckEvolutionChart", true);
  const theme = getChartTheme();
  pinnedDeckEvolutionPointKey = '';

  const filteredData = getDeckEvolutionChartData();
  const deckSelect = document.getElementById("deckEvolutionSelect");
  if (!deckSelect) {
    console.error("Deck selection dropdown not found!");
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  const decks = [...new Set(filteredData.map(row => row.Deck))].sort((a, b) => a.localeCompare(b));
  const currentDeck = deckSelect.value || (decks.length > 0 ? decks[0] : "");
  deckSelect.innerHTML = decks.map(deck => 
    `<option value="${deck}" ${deck === currentDeck ? 'selected' : ''}>${deck}</option>`
  ).join("");

  if (!deckSelect.dataset.listenerAdded) {
    deckSelect.addEventListener("change", () => updateDeckEvolutionChart());
    deckSelect.dataset.listenerAdded = "true";
  }

  if (deckEvolutionChart) deckEvolutionChart.destroy();
  const deckEvolutionCtx = document.getElementById("deckEvolutionChart");
  if (!deckEvolutionCtx) {
    console.error("Deck Evolution Chart canvas not found!");
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  if (filteredData.length === 0 || !currentDeck) {
    renderDeckEvolutionDetailsPlaceholder('Choose a deck to inspect its date-by-date meta share and win rate.');
    deckEvolutionChart = new Chart(deckEvolutionCtx, {
      type: 'bar',
      data: {
        labels: ["No Data"],
        datasets: [{ label: "Meta Share %", data: [0], backgroundColor: '#808080' }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { display: false }, x: { ticks: { color: theme.text } } }
      }
    });
    updateMultiEventTables(filteredData, 'deck', currentDeck);
    setChartLoading("deckEvolutionChart", false);
    return;
  }

  const { dates, metaShares, winRates } = calculateDeckEvolutionStats(filteredData, currentDeck);
  const pointDetails = buildDeckEvolutionPointDetails(filteredData, currentDeck, dates, metaShares, winRates);
  const maxMetaShare = Math.max(...metaShares, 1);
  const metaShareMax = Math.ceil(maxMetaShare / 10) * 10;
  renderDeckEvolutionDetailsPlaceholder('Hover a date to inspect the selected deck across that day. Click a bar or point to lock it.');

  const datasets = [
    {
      label: `Meta Share %`,
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
      label: `Win Rate %`,
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
    deckEvolutionChart = new Chart(deckEvolutionCtx, {
      type: 'bar',
      data: { labels: dates, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            beginAtZero: true, 
            max: metaShareMax,
            title: { display: true, text: "Meta Share %", color: theme.text },
            grid: { color: theme.grid },
            ticks: { color: theme.text } 
          },
          y2: { 
            position: 'right', 
            beginAtZero: true, 
            max: 100,
            title: { display: true, text: "Win Rate %", color: theme.text },
            grid: { color: theme.grid },
            ticks: { color: theme.text } 
          },
          x: { 
            title: { display: true, text: "Date", color: theme.text },
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
                if (!pinnedDeckEvolutionPointKey) {
                  renderDeckEvolutionDetails(point);
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
          datalabels: {display: false}
        },
        onClick(event, activeElements) {
          if (!activeElements?.length) {
            if (pinnedDeckEvolutionPointKey) {
              pinnedDeckEvolutionPointKey = '';
              renderDeckEvolutionDetailsPlaceholder('Hover a date to inspect the selected deck across that day. Click a bar or point to lock it.');
            }
            return;
          }

          const point = pointDetails[activeElements[0].index];
          const pointKey = getDeckEvolutionPointKey(point);

          if (pinnedDeckEvolutionPointKey === pointKey) {
            pinnedDeckEvolutionPointKey = '';
            renderDeckEvolutionDetailsPlaceholder('Hover a date to inspect the selected deck across that day. Click a bar or point to lock it.');
            return;
          }

          pinnedDeckEvolutionPointKey = pointKey;
          renderDeckEvolutionDetails(point, { pinned: true });
        },
        onHover(event, activeElements) {
          deckEvolutionCtx.style.cursor = activeElements?.length ? 'pointer' : 'default';

          if (activeElements?.length) {
            const hoveredPoint = pointDetails[activeElements[0].index];
            const hoveredPointKey = getDeckEvolutionPointKey(hoveredPoint);

            if (pinnedDeckEvolutionPointKey === hoveredPointKey) {
              renderDeckEvolutionDetails(hoveredPoint, { pinned: true });
              return;
            }

            renderDeckEvolutionDetails(hoveredPoint);
            return;
          }

          if (pinnedDeckEvolutionPointKey) {
            const pinnedPoint = getDeckEvolutionPointByKey(pointDetails, pinnedDeckEvolutionPointKey);
            if (pinnedPoint) {
              renderDeckEvolutionDetails(pinnedPoint, { pinned: true });
              return;
            }

            pinnedDeckEvolutionPointKey = '';
            renderDeckEvolutionDetailsPlaceholder('Hover a date to inspect the selected deck across that day. Click a bar or point to lock it.');
            return;
          }

          renderDeckEvolutionDetailsPlaceholder('Hover a date to inspect the selected deck across that day. Click a bar or point to lock it.');
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Deck Evolution Chart:", error);
  }

  deckEvolutionCtx.style.cursor = 'default';

  updateMultiEventTables(filteredData, 'deck', currentDeck);

  const toggleButtons = document.querySelectorAll('#multiEventCharts .table-toggle-btn');
  toggleButtons.forEach(button => {
    button.onclick = () => {
      toggleButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const tableType = button.dataset.table;
      updateMultiEventTables(filteredData, tableType, currentDeck);
    };
  });

  setChartLoading("deckEvolutionChart", false);
}
