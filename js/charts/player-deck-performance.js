// js/charts/player-deck-performance.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export let playerDeckPerformanceChart = null;

export function updatePlayerDeckPerformanceChart() {
  console.log("updatePlayerDeckPerformanceChart called...");
  setChartLoading("playerDeckPerformanceChart", true);

  const startDate = document.getElementById("playerStartDateSelect").value;
  const endDate = document.getElementById("playerEndDateSelect").value;
  const playerFilterMenu = document.getElementById("playerFilterMenu");
  const selectedPlayer = playerFilterMenu ? playerFilterMenu.value : null;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);

  console.log("Filters:", { startDate, endDate, selectedPlayer, selectedEventTypes });
  console.log("Raw cleanedData length:", cleanedData.length);

  const baseFilteredData = selectedPlayer && startDate && endDate && selectedEventTypes.length > 0
    ? cleanedData.filter(row => 
        row.Date >= startDate && 
        row.Date <= endDate && 
        row.Player === selectedPlayer && 
        selectedEventTypes.includes(row.EventType)
      )
    : [];

  console.log("baseFilteredData length:", baseFilteredData.length);

  const filteredData = baseFilteredData.filter(row => row.Deck !== "No Show");
  console.log("filteredData length (no 'No Show'):", filteredData.length);

  if (!selectedPlayer || !startDate || !endDate || selectedEventTypes.length === 0 || filteredData.length === 0) {
    console.log("No data condition triggered:", { selectedPlayer, startDate, endDate, eventTypes: selectedEventTypes.length, filteredDataLength: filteredData.length });
    if (playerDeckPerformanceChart) playerDeckPerformanceChart.destroy();
    const ctx = document.getElementById("playerDeckPerformanceChart");
    if (ctx) {
      const label = !selectedPlayer ? "No Player Selected" : 
                    selectedEventTypes.length === 0 ? "No Event Type Selected" : 
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
            zoom: { // Zoom disabled for "No Data" case
              zoom: { enabled: false },
              pan: { enabled: false }
            }
          }
        }
      });
    }
    setChartLoading("playerDeckPerformanceChart", false);
    return;
  }

  // Aggregate deck stats: number of events, total wins, total losses
  const deckStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Deck]) {
      acc[row.Deck] = {
        events: new Set(),
        wins: 0,
        losses: 0
      };
    }
    acc[row.Deck].events.add(row.Event);
    acc[row.Deck].wins += row.Wins || 0;
    acc[row.Deck].losses += row.Losses || 0;
    return acc;
  }, {});
  console.log("deckStats:", deckStats);

  // Calculate the maximum number of events across all decks
  const maxEvents = Math.max(...Object.values(deckStats).map(stats => stats.events.size));
  const xAxisMax = maxEvents + 1;
  console.log("Calculated xAxisMax:", xAxisMax);

  // Define a color palette for decks
  const colors = [
    '#FFD700', '#FF6347', '#00CED1', '#32CD32', '#9370DB', 
    '#FF69B4', '#20B2AA', '#FFA500', '#4682B4', '#9ACD32',
    '#DC143C', '#7B68EE', '#ADFF2F', '#FF4500', '#6A5ACD'
  ];

  // Aggregate points by (X, Y) coordinates for clustering
  const pointMap = {};
  let colorIndex = 0;
  Object.keys(deckStats).forEach((deck) => {
    const stats = deckStats[deck];
    const totalGames = stats.wins + stats.losses;
    const winRate = totalGames > 0 ? (stats.wins / totalGames) * 100 : 0;
    const x = stats.events.size;
    const y = winRate;
    const key = `${x},${y}`;
    if (!pointMap[key]) {
      pointMap[key] = {
        x,
        y,
        decks: [],
        color: colors[colorIndex++ % colors.length],
        wins: 0,
        losses: 0
      };
    }
    pointMap[key].decks.push(deck);
    pointMap[key].wins += stats.wins;
    pointMap[key].losses += stats.losses;
  });

  // Create datasets for each unique (X, Y) point
  const datasets = Object.values(pointMap).map((point) => ({
    label: point.decks.join(', '),
    data: [{
      x: point.x,
      y: point.y,
      decks: point.decks,
      wins: point.wins,
      losses: point.losses
    }],
    backgroundColor: point.color,
    borderColor: point.color,
    borderWidth: 1,
    pointRadius: 5 + (point.decks.length - 1) * 2,
    pointHoverRadius: 7 + (point.decks.length - 1) * 2
  }));

  console.log("Datasets with clustered labels:", datasets);

  if (playerDeckPerformanceChart) playerDeckPerformanceChart.destroy();
  const ctx = document.getElementById("playerDeckPerformanceChart");
  if (!ctx) {
    console.error("Player Deck Performance Chart canvas not found!");
    setChartLoading("playerDeckPerformanceChart", false);
    return;
  }

  const tooltipHandler = function(context) {
    const tooltipModel = context.tooltip;
    let tooltipEl = document.getElementById('chartjs-tooltip-deck');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chartjs-tooltip-deck';
      tooltipEl.style.background = 'rgba(0, 0, 0, 0.8)';
      tooltipEl.style.color = '#fff';
      tooltipEl.style.padding = '10px';
      tooltipEl.style.borderRadius = '5px';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.zIndex = '9999';
      tooltipEl.style.fontSize = '12px';
      tooltipEl.style.transition = 'all 0.1s ease';
      document.body.appendChild(tooltipEl);
    }

    const detailsEl = document.getElementById('playerDeckPerformanceDetails');
    if (!tooltipModel.opacity) {
      tooltipEl.style.opacity = 0;
      if (detailsEl) detailsEl.innerHTML = "";
      return;
    }

    tooltipEl.style.opacity = 1;
    const chartArea = context.chart.chartArea;
    const canvasPosition = context.chart.canvas.getBoundingClientRect();
    const tooltipWidth = tooltipEl.offsetWidth;
    const tooltipHeight = tooltipEl.offsetHeight;

    let left = canvasPosition.left + chartArea.left + tooltipModel.caretX + 10;
    let top = canvasPosition.top + chartArea.top + tooltipModel.caretY - (tooltipHeight / 2);

    if (left + tooltipWidth > canvasPosition.right) {
      left = canvasPosition.left + chartArea.left + tooltipModel.caretX - tooltipWidth - 10;
    }
    if (top < canvasPosition.top) {
      top = canvasPosition.top + 5;
    } else if (top + tooltipHeight > canvasPosition.bottom) {
      top = canvasPosition.bottom - tooltipHeight - 5;
    }

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;

    const datasetIndex = tooltipModel.dataPoints[0].datasetIndex;
    const point = datasets[datasetIndex].data[0];
    const allDecks = point.decks;
    const eventCount = point.x;
    const winRate = point.y.toFixed(2);
    const { wins, losses } = point;

    tooltipEl.innerHTML = `${allDecks.join(', ')}<br>Events: ${eventCount}<br>Wins: ${wins}, Losses: ${losses} (WR: ${winRate}%)`;

    if (detailsEl) {
      detailsEl.innerHTML = `${allDecks.join(', ')}<br>Events: ${eventCount}<br>Wins: ${wins}, Losses: ${losses} (WR: ${winRate}%)`;
    }
  };

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
            ticks: { 
              color: '#fff', 
              stepSize: 1, 
              beginAtZero: true 
            },
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
            enabled: false,
            external: tooltipHandler,
            mode: 'nearest',
            intersect: true
          },
          datalabels: {
            display: true,
            color: '#fff',
            font: {
              size: 12,
              weight: 'bold'
            },
            formatter: (value) => value.decks.join(', '),
            align: 'top',
            offset: 4
          },
          zoom: {
            zoom: {
              wheel: {
                enabled: true, 
                speed: 0.1   // Adjust zoom speed (0.1 = 10% per scroll)
              },
              drag: {
                enabled: true, // Enable drag-to-zoom
                backgroundColor: 'rgba(0, 0, 255, 0.3)', // Blue tint for selection area
                borderColor: 'rgba(0, 0, 255, 0.8)',
                borderWidth: 1
              },
              mode: 'xy' // Zoom both axes
            },
            pan: {
              enabled: true, // Enable panning after zooming
              mode: 'xy'    // Pan both axes
            },
            limits: {
              x: { min: 0, max: xAxisMax }, // Restrict zoom/pan to original range
              y: { min: 0, max: 100 }
            }
          }
        },
        hover: { mode: 'nearest', intersect: true }
      }
    });

    // Add double-click to reset zoom
    ctx.ondblclick = () => {
      playerDeckPerformanceChart.resetZoom();
    };

    console.log("Chart initialized with datasets:", datasets);
  } catch (error) {
    console.error("Error initializing Player Deck Performance Chart:", error);
  }
  setChartLoading("playerDeckPerformanceChart", false);
}