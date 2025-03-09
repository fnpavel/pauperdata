// js/charts/multi-player-win-rate.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export let multiPlayerWinRateChart = null;

export function updateMultiPlayerWinRateChart() {
  console.log("updateMultiPlayerWinRateChart called...");
  setChartLoading("multiPlayerWinRateChart", true);

  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);
  const positionStart = parseInt(document.getElementById("positionStartSelect")?.value) || 1;
  const positionEnd = parseInt(document.getElementById("positionEndSelect")?.value) || Infinity;

  const filteredData = (startDate && endDate && selectedEventTypes.length > 0) 
    ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
    : [];
  const chartData = filteredData.filter(row => row.Rank >= positionStart && row.Rank <= positionEnd);

  if (chartData.length === 0) {
    if (multiPlayerWinRateChart) multiPlayerWinRateChart.destroy();
    const multiPlayerWinRateCtx = document.getElementById("multiPlayerWinRateChart");
    if (multiPlayerWinRateCtx) {
      multiPlayerWinRateChart = new Chart(multiPlayerWinRateCtx, {
        type: 'bar',
        data: {
          labels: ["No Data"],
          datasets: [{ label: "Average Win Rate (%)", data: [0], backgroundColor: '#808080' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { display: false }, x: { ticks: { color: '#fff' } } }
        }
      });
    }
    setChartLoading("multiPlayerWinRateChart", false);
    return;
  }

  const playerStats = chartData.reduce((acc, row) => {
    if (!acc[row.Player]) {
      acc[row.Player] = { totalWinRate: 0, eventCount: 0, events: new Set() };
    }
    acc[row.Player].totalWinRate += row["Win Rate"] * 100;
    acc[row.Player].events.add(row.Event);
    return acc;
  }, {});

  const playerLabels = Object.keys(playerStats);
  const playerWinRates = playerLabels.map(player => {
    const stats = playerStats[player];
    stats.eventCount = stats.events.size;
    return stats.eventCount > 0 ? stats.totalWinRate / stats.eventCount : 0;
  });
  const playerEventCounts = playerLabels.map(player => playerStats[player].eventCount);

  if (multiPlayerWinRateChart) multiPlayerWinRateChart.destroy();
  const multiPlayerWinRateCtx = document.getElementById("multiPlayerWinRateChart");
  if (!multiPlayerWinRateCtx) {
    console.error("Multi-Event Player Win Rate Chart canvas not found!");
    setChartLoading("multiPlayerWinRateChart", false);
    return;
  }

  try {
    multiPlayerWinRateChart = new Chart(multiPlayerWinRateCtx, {
      type: "bar",
      data: {
        labels: playerLabels,
        datasets: [
          {
            label: "Average Win Rate (%)",
            data: playerWinRates,
            backgroundColor: "#FFD700"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            beginAtZero: true, 
            max: 100, 
            title: { display: true, text: "Average Win Rate (%)", color: '#fff' },
            ticks: { color: '#fff' }, 
            grid: { color: 'rgba(255, 255, 255, 0.1)' } 
          },
          x: { 
            title: { display: true, text: "Players", color: '#fff' },
            ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 }, 
            grid: { color: 'rgba(255, 255, 255, 0.1)' } 
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#e0e0e0', font: { size: 14, weight: 'bold' } }
          },
          tooltip: {
            callbacks: {
              label: context => {
                const playerIndex = context.dataIndex;
                const winRate = context.raw.toFixed(2);
                const eventCount = playerEventCounts[playerIndex];
                return `Avg Win Rate: ${winRate}% (Events: ${eventCount})`;
              }
            }
          }
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Multi-Event Player Win Rate Chart:", error);
  }
  setChartLoading("multiPlayerWinRateChart", false);
}