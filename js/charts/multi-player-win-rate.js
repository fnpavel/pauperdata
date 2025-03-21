// js/charts/multi-player-win-rate.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export let multiPlayerWinRateChart = null;

export function updateMultiPlayerWinRateChart(sortBy = 'winRate') {
  console.log("updateMultiPlayerWinRateChart called...", { sortBy });
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

  // Aggregate player stats
  const playerStats = chartData.reduce((acc, row) => {
    if (!acc[row.Player]) {
      acc[row.Player] = { totalWinRate: 0, eventCount: 0, events: new Set() };
    }
    acc[row.Player].totalWinRate += row["Win Rate"] * 100;
    acc[row.Player].events.add(row.Event);
    return acc;
  }, {});

  // Calculate averages
  const playerData = Object.entries(playerStats)
    .map(([player, stats]) => {
      stats.eventCount = stats.events.size;
      const avgWinRate = stats.eventCount > 0 ? stats.totalWinRate / stats.eventCount : 0;
      return { player, avgWinRate, eventCount: stats.eventCount };
    });

  // Sort based on user selection
  const sortedPlayerData = playerData.sort((a, b) => {
    if (sortBy === 'winRate') {
      return b.avgWinRate - a.avgWinRate || b.eventCount - a.eventCount; // Win rate, then events
    } else {
      return b.eventCount - a.eventCount || b.avgWinRate - a.avgWinRate; // Events, then win rate
    }
  });

  // Take top 10 players
  const topN = 10;
  const topPlayers = sortedPlayerData.slice(0, topN);
  const labels = topPlayers.map(p => p.player);
  const winRates = topPlayers.map(p => p.avgWinRate);
  const eventCounts = topPlayers.map(p => p.eventCount);
  const maxEvents = Math.max(...eventCounts, 1); // Avoid division by 0

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
            data: eventCounts.map(count => (count / maxEvents) * 100), // Normalize to 100%
            backgroundColor: '#A9A9A9', // Muted gray
            borderColor: '#808080',
            borderWidth: 1,
            barPercentage: 0.8,
            categoryPercentage: 0.9
          },
          {
            label: "Average Win Rate (%)",
            data: winRates,
            backgroundColor: '#CCAC00', // Muted gold
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
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
        elements: {
          bar: {
            borderRadius: 4,
            borderSkipped: false
          }
        }
      }
    });
  } catch (error) {
    console.error("Error initializing Multi-Event Player Win Rate Chart:", error);
  }

  // Add toggle buttons if not already present
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
    
    // Add event listeners
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