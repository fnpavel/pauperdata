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
            zoom: { zoom: { enabled: false }, pan: { enabled: false } }
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
            enabled: true,  // Enable built-in tooltip
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
                const allDecks = point.decks.join(', ');
                const eventCount = point.x;
                const winRate = point.y.toFixed(2);
                const { wins, losses } = point;
                return [
                  allDecks,
                  `Events: ${eventCount}`,
                  `Wins: ${wins}, Losses: ${losses} (WR: ${winRate}%)`
                ];
              }
            }
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
                speed: 0.1
              },
              drag: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 255, 0.3)',
                borderColor: 'rgba(0, 0, 255, 0.8)',
                borderWidth: 1
              },
              mode: 'xy'
            },
            pan: {
              enabled: true,
              mode: 'xy'
            },
            limits: {
              x: { min: 0, max: xAxisMax },
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