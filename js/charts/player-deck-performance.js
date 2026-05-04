// Player Analysis scatter chart comparing each deck's event count against its
// overall win rate for the currently selected player and date/event filters.
import { setChartLoading } from '../utils/dom.js';
import { getPlayerDeckPerformanceChartData } from '../modules/filters/filter-index.js';
import { calculatePlayerDeckPerformanceStats } from "../utils/data-chart.js";
import { getSelectedPlayerLabel } from '../utils/player-names.js';
import { getChartTheme } from '../utils/theme.js';
import { getEloDeckOrder } from '../utils/player-deck-filter.js';
import { buildOrderedDeckColorMap } from '../utils/deck-colors.js';

export let playerDeckPerformanceChart = null;

function getSelectedPlayerEventTypeCount() {
  const playerAnalysisSection = document.getElementById('playerAnalysisSection');
  return Array.from(playerAnalysisSection?.querySelectorAll('.event-type-filter.active') || []).length;
}

// Redraws the selected player's deck-performance scatter chart.
export function updatePlayerDeckPerformanceChart() {
  console.log("updatePlayerDeckPerformanceChart called...");
  setChartLoading("playerDeckPerformanceChart", true);
  const theme = getChartTheme();

  const filteredData = getPlayerDeckPerformanceChartData();
  if (!filteredData.length) {
    // Render an inert placeholder chart instead of leaving stale data visible
    // when the player/date/event-type filters have no matching rows.
    console.log("No data condition triggered");
    if (playerDeckPerformanceChart) playerDeckPerformanceChart.destroy();
    const ctx = document.getElementById("playerDeckPerformanceChart");
    if (ctx) {
      const playerFilterMenu = document.getElementById("playerFilterMenu");
      const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
      const selectedPlayerLabel = getSelectedPlayerLabel(playerFilterMenu);
      const selectedEventTypes = getSelectedPlayerEventTypeCount();
      const label = !selectedPlayer ? "No Player Selected" : 
                    selectedEventTypes === 0 ? "No Event Type Selected" : 
                    `${selectedPlayerLabel || "Player"} - No Data Available`;
      playerDeckPerformanceChart = new Chart(ctx, {
        type: "scatter",
        data: {
          datasets: [{
            label: label,
            data: [{ x: 0, y: 0 }],
            backgroundColor: '#FFD700',
            borderColor: '#DAA520',
            borderWidth: 1,
            pointRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { 
              type: 'linear',
              title: { display: true, text: "Number of Events", color: theme.text },
              ticks: { color: theme.text },
              min: 0,
              max: 1
            },
            y: { 
              beginAtZero: true, 
              max: 100, 
              title: { display: true, text: "Overall Win Rate %", color: theme.text },
              ticks: { color: theme.text } 
            }
          },
          plugins: {
            legend: { position: 'top', labels: { color: theme.mutedText, font: { size: 14 } } },
            tooltip: { enabled: false },
            datalabels: { display: true },
            zoom: { zoom: { enabled: false }, pan: { enabled: false } }
          }
        }
      });
    }
    setChartLoading("playerDeckPerformanceChart", false);
    return;
  }

  const deckStats = calculatePlayerDeckPerformanceStats(filteredData);
  const deckColorMap = buildOrderedDeckColorMap(deckStats.map(stats => stats.deck), getEloDeckOrder());
  const orderedDeckStats = [...deckStats].sort((a, b) => {
    const orderedDecks = [...deckColorMap.keys()];
    return orderedDecks.indexOf(a.deck) - orderedDecks.indexOf(b.deck);
  });
  const maxEvents = Math.max(...orderedDeckStats.map(stats => stats.eventCount));
  const xAxisMax = maxEvents + 1;
  // Each deck gets its own one-point dataset so Chart.js can expose deck names
  // directly in the legend and let users toggle decks independently.
  const datasets = orderedDeckStats.map(stats => {
    const color = deckColorMap.get(stats.deck) || '#FFD700';
    return {
      label: stats.deck,
      data: [{
        x: stats.eventCount,
        y: stats.winRate,
        deck: stats.deck,
        wins: stats.wins,
        losses: stats.losses
      }],
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
      pointRadius: 5,
      pointHoverRadius: 7
    };
  });

  if (playerDeckPerformanceChart) playerDeckPerformanceChart.destroy();
  const ctx = document.getElementById("playerDeckPerformanceChart");
  if (!ctx) {
    console.error("Player Deck Performance Chart canvas not found!");
    setChartLoading("playerDeckPerformanceChart", false);
    return;
  }

  try {
    playerDeckPerformanceChart = new Chart(ctx, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: "Number of Events", color: theme.text },
            grid: { color: theme.grid },
            ticks: { color: theme.text, stepSize: 1, beginAtZero: true },
            min: 0,
            max: xAxisMax
          },
          y: {
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "Overall Win Rate %", color: theme.text },
            grid: { color: theme.grid },
            ticks: { color: theme.text }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { 
              color: theme.mutedText,
              font: { size: 14 },
              usePointStyle: true
            },
            onClick: (e, legendItem, legend) => {
              const index = legendItem.datasetIndex;
              const ci = legend.chart;
              const meta = ci.getDatasetMeta(index);
              meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
              ci.update();
            }
          },
          tooltip: {
            enabled: true,
            mode: 'nearest',
            intersect: true,
            backgroundColor: theme.tooltipBg,
            titleFont: { size: 14, weight: 'bold' },
            bodyFont: { size: 12 },
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (context) => {
                const point = context.raw;
                const deck = point.deck;
                const eventCount = point.x;
                const winRate = point.y.toFixed(2);
                const { wins, losses } = point;
                return [
                  deck,
                  `Events: ${eventCount}`,
                  `Wins: ${wins}, Losses: ${losses} (WR: ${winRate}%)`
                ];
              }
            }
          },
          datalabels: {
            display: true,
            color: theme.text,
            font: { size: 12, weight: 'bold' },
            formatter: (value) => value.deck,
            align: 'top',
            offset: 4
          },
          zoom: {
            zoom: {
              wheel: { enabled: true, speed: 0.1 },
              drag: { enabled: true, backgroundColor: 'rgba(0, 0, 255, 0.3)', borderColor: 'rgba(0, 0, 255, 0.8)', borderWidth: 1 },
              mode: 'xy'
            },
            pan: { enabled: true, mode: 'xy' },
            limits: { x: { min: 0, max: xAxisMax }, y: { min: 0, max: 100 } }
          }
        },
        hover: { mode: 'nearest', intersect: true }
      }
    });

    ctx.ondblclick = () => playerDeckPerformanceChart.resetZoom();
  } catch (error) {
    console.error("Error initializing Player Deck Performance Chart:", error);
  }
  setChartLoading("playerDeckPerformanceChart", false);
}
