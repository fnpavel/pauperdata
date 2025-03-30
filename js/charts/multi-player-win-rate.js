import { setChartLoading } from '../utils/dom.js';
import { getDeckEvolutionChartData } from '../modules/filters.js'; // Reusing this as it applies position filters
import { calculateMultiPlayerWinRateStats } from "../utils/data-chart.js";

export let multiPlayerWinRateChart = null;

export function updateMultiPlayerWinRateChart(sortBy = 'winRate') {
  console.log("updateMultiPlayerWinRateChart called...", { sortBy });
  setChartLoading("multiPlayerWinRateChart", true);

  const chartData = getDeckEvolutionChartData(); // Already filtered with positionStart/End
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

  const playerData = calculateMultiPlayerWinRateStats(chartData);
  const sortedPlayerData = playerData.sort((a, b) => {
    if (sortBy === 'winRate') {
      return b.avgWinRate - a.avgWinRate || b.eventCount - a.eventCount;
    } else {
      return b.eventCount - a.eventCount || b.avgWinRate - a.avgWinRate;
    }
  });

  const topN = 10;
  const topPlayers = sortedPlayerData.slice(0, topN);
  const labels = topPlayers.map(p => p.player);
  const winRates = topPlayers.map(p => p.avgWinRate);
  const eventCounts = topPlayers.map(p => p.eventCount);
  const maxEvents = Math.max(...eventCounts, 1);

  if (multiPlayerWinRateChart) multiPlayerWinRateChart.destroy();
  const multiPlayerWinRateCtx = document.getElementById("multiPlayerWinRateChart");
  if (!multiPlayerWinRateCtx) {
    console.error("Multi-Event Player Win Rate Chart canvas not found!");
    setChartLoading("multiPlayerWinRateChart", false);
    return;
  }

  try {
    multiPlayerWinRateChart = new Chart(multiPlayerWinRateCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: "Events Played",
            data: eventCounts.map(count => (count / maxEvents) * 100),
            backgroundColor: '#A9A9A9',
            borderColor: '#808080',
            borderWidth: 1,
            barPercentage: 0.8,
            categoryPercentage: 0.9
          },
          {
            label: "Average Win Rate (%)",
            data: winRates,
            backgroundColor: '#CCAC00',
            borderColor: '#B59400',
            borderWidth: 1,
            barPercentage: 0.6,
            categoryPercentage: 0.9
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: false,
            max: 100,
            title: {
              display: true,
              text: "Percentage (%)",
              color: '#FFFFFF',
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#FFFFFF',
              font: { size: 12, family: "'Bitter', serif" },
              callback: value => `${value}%`
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
              borderDash: [5, 5],
              borderColor: '#FFFFFF'
            }
          },
          y: {
            title: {
              display: true,
              text: `Top Players by ${sortBy === 'winRate' ? 'Win Rate' : 'Events'}`,
              color: '#FFFFFF',
              font: { size: 16, weight: 'bold', family: "'Bitter', serif" }
            },
            ticks: {
              color: '#FFFFFF',
              font: { size: 12, family: "'Bitter', serif" }
            },
            grid: { display: false }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#e0e0e0',
              font: { size: 12, family: "'Bitter', serif" },
              padding: 10,
              boxWidth: 20,
              usePointStyle: true
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { family: "'Bitter', serif", size: 14, weight: 'bold' },
            bodyFont: { family: "'Bitter', serif", size: 12 },
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
            callbacks: {
              label: context => {
                const datasetLabel = context.dataset.label;
                const value = context.raw.toFixed(2);
                const playerIndex = context.dataIndex;
                const winRate = winRates[playerIndex].toFixed(2);
                const eventCount = eventCounts[playerIndex];
                if (datasetLabel === "Events Played") {
                  return `Events: ${eventCount} (${value}% of max)`;
                }
                return `Avg Win Rate: ${winRate}% (Events: ${eventCount})`;
              }
            },
            borderColor: '#FFD700',
            borderWidth: 1,
            padding: 10
          }
        },
        animation: { duration: 1000, easing: 'easeOutQuart' },
        elements: { bar: { borderRadius: 4, borderSkipped: false } }
      }
    });
  } catch (error) {
    console.error("Error initializing Multi-Event Player Win Rate Chart:", error);
  }

  const chartContainer = document.querySelector('#multiPlayerWinRateChart').parentElement;
  let toggleDiv = chartContainer.querySelector('.sort-toggle');
  if (!toggleDiv) {
    toggleDiv = document.createElement('div');
    toggleDiv.className = 'sort-toggle';
    toggleDiv.innerHTML = `
      <button class="table-toggle-btn ${sortBy === 'winRate' ? 'active' : ''}" data-sort="winRate">Sort by Win Rate</button>
      <button class="table-toggle-btn ${sortBy === 'events' ? 'active' : ''}" data-sort="events">Sort by Events</button>
    `;
    chartContainer.insertBefore(toggleDiv, multiPlayerWinRateCtx);
    
    toggleDiv.querySelectorAll('.table-toggle-btn').forEach(button => {
      button.addEventListener('click', () => {
        toggleDiv.querySelectorAll('.table-toggle-btn').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        updateMultiPlayerWinRateChart(button.dataset.sort);
      });
    });
  }

  setChartLoading("multiPlayerWinRateChart", false);
}