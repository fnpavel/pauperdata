import { setChartLoading } from '../utils/dom.js';
import { getPlayerDeckPerformanceChartData } from '../modules/filters.js';
import { calculatePlayerDeckPerformanceStats } from "../utils/data-chart.js";

export let playerDeckPerformanceChart = null;

export function updatePlayerDeckPerformanceChart() {
  console.log("updatePlayerDeckPerformanceChart called...");
  setChartLoading("playerDeckPerformanceChart", true);

  const filteredData = getPlayerDeckPerformanceChartData();
  if (!filteredData.length) {
    console.log("No data condition triggered");
    if (playerDeckPerformanceChart) playerDeckPerformanceChart.destroy();
    const ctx = document.getElementById("playerDeckPerformanceChart");
    if (ctx) {
      const playerFilterMenu = document.getElementById("playerFilterMenu");
      const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
      const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active')).length;
      const label = !selectedPlayer ? "No Player Selected" : 
                    selectedEventTypes === 0 ? "No Event Type Selected" : 
                    "No Data Available";
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
              title: { display: true, text: "Number of Events", color: '#fff' }, 
              ticks: { color: '#fff' },
              min: 0,
              max: 1
            },
            y: { 
              beginAtZero: true, 
              max: 100, 
              title: { display: true, text: "Overall Win Rate %", color: '#fff' }, 
              ticks: { color: '#fff' } 
            }
          },
          plugins: {
            legend: { position: 'top', labels: { color: '#e0e0e0', font: { size: 14 } } },
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
  const maxEvents = Math.max(...deckStats.map(stats => stats.eventCount));
  const xAxisMax = maxEvents + 1;

  const colors = [
    '#FFD700', '#FF6347', '#00CED1', '#32CD32', '#9370DB', 
    '#FF69B4', '#20B2AA', '#FFA500', '#4682B4', '#9ACD32',
    '#DC143C', '#7B68EE', '#ADFF2F', '#FF4500', '#6A5ACD'
  ];

  let colorIndex = 0;
  const datasets = deckStats.map(stats => {
    const color = colors[colorIndex++ % colors.length];
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
            title: { display: true, text: "Number of Events", color: '#fff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            ticks: { color: '#fff', stepSize: 1, beginAtZero: true },
            min: 0,
            max: xAxisMax
          },
          y: {
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "Overall Win Rate %", color: '#fff' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            ticks: { color: '#fff' }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { 
              color: '#e0e0e0', 
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
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { size: 14, weight: 'bold' },
            bodyFont: { size: 12 },
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
            borderColor: '#FFD700',
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
            color: '#fff',
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