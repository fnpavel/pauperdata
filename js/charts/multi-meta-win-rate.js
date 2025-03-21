// js/charts/multi-meta-win-rate.js
import { setChartLoading } from '../utils/dom.js';
import { cleanedData } from '../data.js';

export let metaWinRateChart = null;

export function updateMultiMetaWinRateChart(sortBy = 'meta') {
  console.log("updateMultiMetaWinRateChart called...", { sortBy });
  setChartLoading("metaWinRateChart", true);

  const startDate = document.getElementById("startDateSelect").value;
  const endDate = document.getElementById("endDateSelect").value;
  const selectedEventTypes = Array.from(document.querySelectorAll('.event-type-filter.active'))
    .map(button => button.dataset.type);

  const filteredData = (startDate && endDate && selectedEventTypes.length > 0) 
    ? cleanedData.filter(row => row.Date >= startDate && row.Date <= endDate && selectedEventTypes.includes(row.EventType))
    : [];

  if (filteredData.length === 0) {
    console.log("No filtered data, skipping chart creation...");
    if (metaWinRateChart) metaWinRateChart.destroy();
    setChartLoading("metaWinRateChart", false);
    return;
  }

  const totalPlayers = filteredData.length;
  const deckStats = filteredData.reduce((acc, row) => {
    if (!acc[row.Deck]) acc[row.Deck] = { wins: 0, losses: 0, count: 0 };
    acc[row.Deck].wins += row.Wins;
    acc[row.Deck].losses += row.Losses;
    acc[row.Deck].count += 1;
    return acc;
  }, {});

  const decks = Object.keys(deckStats);
  const deckData = decks.map(deck => ({
    deck,
    meta: (deckStats[deck].count / totalPlayers) * 100,
    winRate: (deckStats[deck].wins + deckStats[deck].losses) > 0 
      ? (deckStats[deck].wins / (deckStats[deck].wins + deckStats[deck].losses)) * 100 
      : 0
  }));

  // Sort decks based on sortBy
  const sortedDecks = deckData.sort((a, b) => {
    if (sortBy === 'meta') {
      return b.meta - a.meta || a.deck.localeCompare(b.deck);
    } else {
      return b.winRate - a.winRate || a.deck.localeCompare(b.deck);
    }
  });

  const deckNames = sortedDecks.map(d => d.deck);
  const metaPercentages = sortedDecks.map(d => d.meta);
  const winRates = sortedDecks.map(d => d.winRate);
  const metaMin = Math.max(0, Math.min(...metaPercentages) - 5);
  const metaMax = Math.max(...metaPercentages) + 5;

  if (deckNames.length === 0) {
    console.log("No decks, skipping chart creation...");
    if (metaWinRateChart) metaWinRateChart.destroy();
    setChartLoading("metaWinRateChart", false);
    return;
  }

  const datasets = [
    {
      type: 'bar',
      label: 'Meta %',
      data: metaPercentages,
      backgroundColor: '#CC3700', // Muted tomato
      borderColor: '#A32C00',
      borderWidth: 1,
      yAxisID: 'y',
      order: 2
    },
    {
      type: 'bar',
      label: 'Win Rate %',
      data: winRates,
      backgroundColor: '#326789', // Muted steel blue
      borderColor: '#2A566F',
      borderWidth: 1,
      yAxisID: 'y2',
      order: 1
    }
  ];

  if (metaWinRateChart) metaWinRateChart.destroy();
  const metaWinRateMultiCtx = document.getElementById("metaWinRateChart");
  if (!metaWinRateMultiCtx) {
    console.error("Meta Win Rate Chart (Multi-Event) canvas not found!");
    setChartLoading("metaWinRateChart", false);
    return;
  }

  try {
    metaWinRateChart = new Chart(metaWinRateMultiCtx, {
      data: { labels: deckNames, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            min: metaMin, 
            max: metaMax, 
            title: { display: true, text: "Meta %", color: '#fff' }, 
            grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
            ticks: { color: '#fff' } 
          },
          y2: { 
            position: 'right', 
            beginAtZero: true, 
            max: 100, 
            title: { display: true, text: "Win Rate %", color: '#fff' }, 
            grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
            ticks: { color: '#fff' } 
          },
          x: { 
            title: { 
              display: true, 
              text: `Decks (Sorted by ${sortBy === 'meta' ? 'Meta %' : 'Win Rate %'})`, 
              color: '#fff' 
            }, 
            grid: { borderDash: [5, 5], color: 'rgba(255, 255, 255, 0.1)' }, 
            ticks: { color: '#fff', autoSkip: false, maxRotation: 45, minRotation: 45 } 
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { 
              color: '#e0e0e0', 
              font: { size: 14, family: "'Bitter', serif" },
              boxWidth: 20,
              padding: 10
            }
          },
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label}: ${context.raw.toFixed(2)}%`
            },
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: { family: "'Bitter', serif", size: 14, weight: 'bold' },
            bodyFont: { family: "'Bitter', serif", size: 12 },
            titleColor: '#FFFFFF',
            bodyColor: '#FFFFFF',
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
    console.error("Error initializing Multi-Event Meta/Win Rate Chart:", error);
  }

  // Add toggle buttons if not already present
  const chartContainer = document.querySelector('#metaWinRateChart').parentElement;
  let toggleDiv = chartContainer.querySelector('.sort-toggle');
  if (!toggleDiv) {
    toggleDiv = document.createElement('div');
    toggleDiv.className = 'sort-toggle';
    toggleDiv.innerHTML = `
      <button class="table-toggle-btn ${sortBy === 'meta' ? 'active' : ''}" data-sort="meta">Sort by Meta</button>
      <button class="table-toggle-btn ${sortBy === 'winRate' ? 'active' : ''}" data-sort="winRate">Sort by Win Rate</button>
    `;
    chartContainer.insertBefore(toggleDiv, metaWinRateMultiCtx);

    toggleDiv.querySelectorAll('.table-toggle-btn').forEach(button => {
      button.addEventListener('click', () => {
        toggleDiv.querySelectorAll('.table-toggle-btn').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        updateMultiMetaWinRateChart(button.dataset.sort);
      });
    });
  }

  setChartLoading("metaWinRateChart", false);
}